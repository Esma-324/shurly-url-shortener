/**
 * URL Shortener Frontend (Node.js + Express + EJS)
 *
 * Bu sunucu:
 *  - EJS ile sunucu-tarafli render edilmis sayfalar dondurur (anasayfa, stats, admin)
 *  - /api/* yollarini Rust backend'ine proxy'ler (axios ile)
 *  - Rate-limit yanitlari ve hatalari kullaniciya nazikce iletir
 */

const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || BACKEND_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'shurly-dev-session-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@shurly.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/urlshortener';

const app = express();
const db = new Pool({
  connectionString: DATABASE_URL,
});

class PgSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sid, callback) {
    this.pool.query(
      'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW() LIMIT 1',
      [sid],
    )
      .then((result) => callback(null, result.rows[0] ? result.rows[0].sess : null))
      .catch((err) => callback(err));
  }

  set(sid, sess, callback) {
    const expire = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + 1000 * 60 * 60 * 24);

    this.pool.query(
      `
        INSERT INTO sessions (sid, sess, expire)
        VALUES ($1, $2, $3)
        ON CONFLICT (sid)
        DO UPDATE SET
          sess = EXCLUDED.sess,
          expire = EXCLUDED.expire
      `,
      [sid, sess, expire],
    )
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }

  destroy(sid, callback) {
    this.pool.query('DELETE FROM sessions WHERE sid = $1', [sid])
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }

  touch(sid, sess, callback) {
    const expire = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + 1000 * 60 * 60 * 24);

    this.pool.query('UPDATE sessions SET expire = $2 WHERE sid = $1', [sid, expire])
      .then(() => callback && callback())
      .catch((err) => callback && callback(err));
  }
}

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(session({
  name: 'shurly.sid',
  store: new PgSessionStore(db),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24, // 24 saat
  },
}));
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  immutable: true,
}));

// Backend HTTP client
const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 8000,
  validateStatus: () => true, // 4xx/5xx'i de yakalayalim
});

// Local helper: hata cevaplarini standardize et
function asJsonError(res, status, error, message) {
  return res.status(status).json({ error, message });
}

function hashPassword(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function normalizeShortCode(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s./\\]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function releaseUnownedShortCode(shortCode) {
  const code = normalizeShortCode(shortCode);
  if (!code) return;

  const result = await db.query(
    'SELECT owner_email FROM urls WHERE short_code = $1 LIMIT 1',
    [code],
  );
  const row = result.rows[0];
  if (!row || row.owner_email) return;

  await api.delete(`/api/url/${encodeURIComponent(code)}`);
}

async function initAuthStorage() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid VARCHAR PRIMARY KEY,
      sess JSONB NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS sessions_expire_idx
    ON sessions (expire);
  `);

  await db.query('DELETE FROM sessions WHERE expire <= NOW();');

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(320) NOT NULL UNIQUE,
      password_hash VARCHAR(64) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(
    `
      INSERT INTO users (email, password_hash, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (email)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = 'admin';
    `,
    [ADMIN_EMAIL.toLowerCase(), hashPassword(ADMIN_PASSWORD)],
  );
}

async function getUserByEmail(email) {
  const result = await db.query(
    'SELECT email, password_hash, role FROM users WHERE email = $1 LIMIT 1',
    [email],
  );
  return result.rows[0] || null;
}

async function canAccessUrlStats(user, code) {
  if (!user) return false;

  const result = await db.query(
    'SELECT owner_email FROM urls WHERE short_code = $1 LIMIT 1',
    [code],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (user.role === 'admin') return true;
  return row.owner_email && row.owner_email.toLowerCase() === user.email.toLowerCase();
}

function scopedUrlWhere(user, alias = 'u') {
  if (user.role === 'admin') {
    return { clause: '', params: [] };
  }

  return {
    clause: `WHERE ${alias}.owner_email = $1`,
    params: [user.email.toLowerCase()],
  };
}

function saveLoginSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) return reject(regenerateErr);

      req.session.user = { email: user.email, role: user.role };
      return req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        return resolve();
      });
    });
  });
}

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Yetkisiz Erişim',
      code: 403,
      message: 'Bu sayfaya sadece admin erişebilir.',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: '',
    });
  }
  return next();
}

// ============== SAYFALAR ==============

app.get('/', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin');
  }

  res.render('index', {
    title: 'Shurly · URL Kısaltma',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'home',
  });
});

app.get('/stats', requireAuth, (req, res) => {
  if (req.session.user.role === 'admin') {
    return res.redirect('/admin');
  }

  res.render('stats', {
    title: 'İstatistik · Shurly',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'stats',
    initialCode: req.query.code || '',
  });
});

app.get('/history', requireAuth, (req, res) => {
  if (req.session.user.role === 'admin') {
    return res.redirect('/admin');
  }

  res.render('history', {
    title: 'Geçmiş URL\'ler · Shurly',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'history',
  });
});

app.get('/admin', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  res.render('admin', {
    title: 'Admin Panel · Shurly',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'admin',
  });
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  return res.render('auth', {
    title: 'Login · Shurly',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'auth',
    mode: 'login',
    errorMessage: '',
    successMessage: req.query.registered ? 'Kayıt tamamlandı. Şimdi giriş yapabilirsiniz.' : '',
    adminLoginInfo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
});

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  return res.render('auth', {
    title: 'Register · Shurly',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: 'auth',
    mode: 'register',
    errorMessage: '',
    successMessage: '',
  });
});

app.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  let user;
  try {
    user = await getUserByEmail(email);
  } catch (err) {
    console.error('Login user query hatasi:', err.message);
    return res.status(500).render('auth', {
      title: 'Login · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'login',
      errorMessage: 'Geçici bir sunucu hatası oluştu. Lütfen tekrar deneyin.',
      successMessage: '',
      adminLoginInfo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
  }

  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).render('auth', {
      title: 'Login · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'login',
      errorMessage: 'E-posta veya şifre hatalı.',
      successMessage: '',
      adminLoginInfo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
  }

  try {
    await saveLoginSession(req, user);
  } catch (err) {
    console.error('Login session kaydetme hatasi:', err.message);
    return res.status(500).render('auth', {
      title: 'Login · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'login',
      errorMessage: 'Giriş oturumu başlatılamadı. Lütfen tekrar deneyin.',
      successMessage: '',
      adminLoginInfo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
  }

  if (user.role === 'admin') return res.redirect('/admin');
  return res.redirect('/');
});

app.post('/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const passwordAgain = String(req.body.passwordAgain || '');

  if (!email || !password) {
    return res.status(400).render('auth', {
      title: 'Register · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'register',
      errorMessage: 'Tüm alanları doldurun.',
      successMessage: '',
    });
  }

  if (!email.includes('@')) {
    return res.status(400).render('auth', {
      title: 'Register · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'register',
      errorMessage: 'Geçerli bir e-posta girin.',
      successMessage: '',
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth', {
      title: 'Register · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'register',
      errorMessage: 'Şifre en az 6 karakter olmalı.',
      successMessage: '',
    });
  }

  if (password !== passwordAgain) {
    return res.status(400).render('auth', {
      title: 'Register · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'register',
      errorMessage: 'Şifreler eşleşmiyor.',
      successMessage: '',
    });
  }

  try {
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).render('auth', {
        title: 'Register · Shurly',
        publicBackendUrl: PUBLIC_BACKEND_URL,
        page: 'auth',
        mode: 'register',
        errorMessage: 'Bu e-posta zaten kayıtlı.',
        successMessage: '',
      });
    }

    await db.query(
      `
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, 'user')
      `,
      [email, hashPassword(password)],
    );

    return res.redirect('/login?registered=1');
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).render('auth', {
        title: 'Register · Shurly',
        publicBackendUrl: PUBLIC_BACKEND_URL,
        page: 'auth',
        mode: 'register',
        errorMessage: 'Bu e-posta zaten kayıtlı.',
        successMessage: '',
      });
    }

    console.error('Register create user hatasi:', err.message);
    return res.status(500).render('auth', {
      title: 'Register · Shurly',
      publicBackendUrl: PUBLIC_BACKEND_URL,
      page: 'auth',
      mode: 'register',
      errorMessage: 'Geçici bir sunucu hatası oluştu. Lütfen tekrar deneyin.',
      successMessage: '',
    });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('shurly.sid');
    res.redirect('/login');
  });
});

// ============== API PROXY ==============

app.post('/api/shorten', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'URL kısaltmak için giriş yapmalısınız.',
      redirect: '/login',
    });
  }

  try {
    if (req.body && req.body.custom_code) {
      await releaseUnownedShortCode(req.body.custom_code);
    }

    const payload = {
      ...req.body,
      owner_email: req.session.user.email,
    };
    const r = await api.post('/api/shorten', payload, {
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    console.error('Shorten proxy hatasi:', err.message);
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.put('/api/url/:code', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'URL düzenlemek için giriş yapmalısınız.',
      redirect: '/login',
    });
  }

  try {
    const r = await api.put(`/api/url/${encodeURIComponent(req.params.code)}`, req.body, {
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.delete('/api/url/:code', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'URL silmek için giriş yapmalısınız.',
      redirect: '/login',
    });
  }

  try {
    if (!(await canAccessUrlStats(req.session.user, req.params.code))) {
      return asJsonError(res, 404, 'not_found', 'Bu kod için URL bulunamadı.');
    }

    const r = await api.delete(`/api/url/${encodeURIComponent(req.params.code)}`, {
      headers: forwardHeaders(req),
    });
    if (r.status === 204) return res.status(204).end();
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.get('/api/stats/:code', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'İstatistikleri görmek için giriş yapmalısınız.',
      redirect: '/login',
    });
  }

  try {
    if (!(await canAccessUrlStats(req.session.user, req.params.code))) {
      return asJsonError(res, 404, 'not_found', 'Bu kod için URL bulunamadı.');
    }

    const r = await api.get(`/api/stats/${encodeURIComponent(req.params.code)}`, {
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.get('/api/stats/:code/timeseries', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'İstatistikleri görmek için giriş yapmalısınız.',
      redirect: '/login',
    });
  }

  try {
    if (!(await canAccessUrlStats(req.session.user, req.params.code))) {
      return asJsonError(res, 404, 'not_found', 'Bu kod için URL bulunamadı.');
    }

    const r = await api.get(`/api/stats/${encodeURIComponent(req.params.code)}/timeseries`, {
      params: req.query,
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

// QR kod proxy'si (SVG dondugu icin response'u stream gibi geciriyoruz)
app.get('/api/qr/:code', async (req, res) => {
  try {
    const r = await api.get(`/api/qr/${encodeURIComponent(req.params.code)}`, {
      params: req.query,
      headers: forwardHeaders(req),
      responseType: 'arraybuffer',
    });
    res.status(r.status);
    if (r.headers['content-type']) res.set('Content-Type', r.headers['content-type']);
    if (r.headers['cache-control']) res.set('Cache-Control', r.headers['cache-control']);
    if (r.headers['content-disposition']) res.set('Content-Disposition', r.headers['content-disposition']);
    return res.send(Buffer.from(r.data));
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'QR servise ulaşılamadı.');
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.user.role === 'admin';
    const query = `
      SELECT short_code, long_url, click_count, created_at, expires_at, owner_email
      FROM urls
      ${isAdmin ? '' : 'WHERE owner_email = $1'}
      ORDER BY created_at DESC
    `;
    const params = isAdmin ? [] : [req.session.user.email.toLowerCase()];
    const result = await db.query(query, params);

    const urls = result.rows.map((row) => ({
      ...row,
      short_url: `${PUBLIC_BACKEND_URL}/${row.short_code}`,
    }));

    return res.json({
      total: urls.length,
      urls,
    });
  } catch (err) {
    console.error('History query hatasi:', err.message);
    return asJsonError(res, 500, 'history_unavailable', 'Geçmiş URL kayıtları alınamadı.');
  }
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const r = await api.get('/api/admin/overview', { headers: forwardHeaders(req) });
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.get('/api/admin/timeseries', requireAdmin, async (req, res) => {
  try {
    const r = await api.get('/api/admin/timeseries', {
      params: req.query,
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    return asJsonError(res, 502, 'backend_unreachable', 'Backend servise ulaşılamadı.');
  }
});

app.get('/api/admin/history', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT short_code, long_url, click_count, created_at, expires_at, owner_email
      FROM urls
      ORDER BY created_at DESC
    `);

    const urls = result.rows.map((row) => ({
      ...row,
      short_url: `${PUBLIC_BACKEND_URL}/${row.short_code}`,
    }));

    return res.json({
      total: urls.length,
      urls,
    });
  } catch (err) {
    console.error('Admin history query hatasi:', err.message);
    return asJsonError(res, 500, 'history_unavailable', 'Geçmiş URL kayıtları alınamadı.');
  }
});

app.get('/api/admin/clicks', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10) || 50));
    const result = await db.query(
      `
        SELECT
          c.clicked_at,
          host(c.ip_address)::text AS ip_address,
          c.user_agent,
          c.referrer,
          c.country,
          u.short_code,
          u.long_url,
          u.owner_email
        FROM click_events c
        JOIN urls u ON u.id = c.url_id
        ORDER BY c.clicked_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Admin clicks query hatasi:', err.message);
    return asJsonError(res, 500, 'clicks_unavailable', 'Tıklama kayıtları alınamadı.');
  }
});

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const [referrers, userAgents, locations] = await Promise.all([
      db.query(`
        SELECT referrer, COUNT(*)::int AS count
        FROM click_events
        GROUP BY referrer
        ORDER BY count DESC
        LIMIT 10
      `),
      db.query(`
        SELECT user_agent, COUNT(*)::int AS count
        FROM click_events
        WHERE user_agent IS NOT NULL
        GROUP BY user_agent
        ORDER BY count DESC
        LIMIT 10
      `),
      db.query(`
        SELECT COALESCE(NULLIF(country, ''), 'Bilinmiyor') AS country, COUNT(*)::int AS count
        FROM click_events
        GROUP BY COALESCE(NULLIF(country, ''), 'Bilinmiyor')
        ORDER BY count DESC
        LIMIT 8
      `),
    ]);

    return res.json({
      top_referrers: referrers.rows,
      top_user_agents: userAgents.rows,
      top_locations: locations.rows,
    });
  } catch (err) {
    console.error('Admin analytics query hatasi:', err.message);
    return asJsonError(res, 500, 'analytics_unavailable', 'Analitik veriler alınamadı.');
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        u.email,
        u.role,
        u.created_at,
        COUNT(urls.id)::int AS total_urls,
        COALESCE(SUM(urls.click_count), 0)::int AS total_clicks
      FROM users u
      LEFT JOIN urls ON lower(urls.owner_email) = lower(u.email)
      WHERE u.role = 'user'
      GROUP BY u.email, u.role, u.created_at
      ORDER BY u.email ASC
    `);

    return res.json(result.rows);
  } catch (err) {
    console.error('Admin users query hatasi:', err.message);
    return asJsonError(res, 500, 'users_unavailable', 'Kullanıcılar alınamadı.');
  }
});

app.get('/api/admin/users/:email/detail', requireAdmin, async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    const user = await getUserByEmail(email);
    if (!user || user.role !== 'user') {
      return asJsonError(res, 404, 'not_found', 'Kullanıcı bulunamadı.');
    }

    const [overview, history, clicks, timeseries] = await Promise.all([
      db.query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM urls WHERE lower(owner_email) = lower($1)) AS total_urls,
            (SELECT COALESCE(SUM(click_count), 0)::int FROM urls WHERE lower(owner_email) = lower($1)) AS total_clicks,
            (
              SELECT COUNT(c.id)::int
              FROM click_events c
              JOIN urls u ON u.id = c.url_id
              WHERE lower(u.owner_email) = lower($1)
                AND c.clicked_at >= CURRENT_DATE
            ) AS clicks_today
        `,
        [email],
      ),
      db.query(
        `
          SELECT short_code, long_url, click_count, created_at, expires_at, owner_email
          FROM urls
          WHERE lower(owner_email) = lower($1)
          ORDER BY created_at DESC
        `,
        [email],
      ),
      db.query(
        `
          SELECT
            c.clicked_at,
            host(c.ip_address)::text AS ip_address,
            c.user_agent,
            c.referrer,
            c.country,
            u.short_code,
            u.long_url,
            u.owner_email
          FROM click_events c
          JOIN urls u ON u.id = c.url_id
          WHERE lower(u.owner_email) = lower($1)
          ORDER BY c.clicked_at DESC
          LIMIT 50
        `,
        [email],
      ),
      db.query(
        `
          SELECT date_trunc('day', c.clicked_at) AS day, COUNT(c.id)::int AS clicks
          FROM click_events c
          JOIN urls u ON u.id = c.url_id
          WHERE lower(u.owner_email) = lower($1)
            AND c.clicked_at > NOW() - INTERVAL '14 days'
          GROUP BY day
          ORDER BY day ASC
        `,
        [email],
      ),
    ]);

    const urls = history.rows.map((row) => ({
      ...row,
      short_url: `${PUBLIC_BACKEND_URL}/${row.short_code}`,
    }));

    return res.json({
      user: { email: user.email, role: user.role },
      overview: overview.rows[0],
      history: { total: urls.length, urls },
      clicks: clicks.rows,
      timeseries: timeseries.rows,
    });
  } catch (err) {
    console.error('Admin user detail query hatasi:', err.message);
    return asJsonError(res, 500, 'user_detail_unavailable', 'Kullanıcı detayları alınamadı.');
  }
});

// Stats sayfasi icin auth kullanicilarina ozet/trend verisi
app.get('/api/overview', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const urlScope = scopedUrlWhere(user, 'u');
    const clickWhere = user.role === 'admin' ? '' : 'WHERE u.owner_email = $1';

    const [totalUrls, totalClicks, clicks24h, clicks7d, topUrls, recentUrls] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS count FROM urls u ${urlScope.clause}`,
        urlScope.params,
      ),
      db.query(
        `
          SELECT COUNT(c.id)::int AS count
          FROM click_events c
          JOIN urls u ON u.id = c.url_id
          ${clickWhere}
        `,
        urlScope.params,
      ),
      db.query(
        `
          SELECT COUNT(c.id)::int AS count
          FROM click_events c
          JOIN urls u ON u.id = c.url_id
          ${clickWhere ? `${clickWhere} AND` : 'WHERE'} c.clicked_at >= CURRENT_DATE
        `,
        urlScope.params,
      ),
      db.query(
        `
          SELECT COUNT(c.id)::int AS count
          FROM click_events c
          JOIN urls u ON u.id = c.url_id
          ${clickWhere ? `${clickWhere} AND` : 'WHERE'} c.clicked_at > NOW() - INTERVAL '7 days'
        `,
        urlScope.params,
      ),
      db.query(
        `
          SELECT
            u.short_code,
            u.long_url,
            COUNT(c.id)::int AS click_count,
            u.created_at
          FROM urls u
          JOIN click_events c ON c.url_id = u.id
          ${clickWhere}
          GROUP BY u.id, u.short_code, u.long_url, u.created_at
          ORDER BY COUNT(c.id) DESC, MAX(c.clicked_at) DESC, u.created_at DESC, u.short_code ASC
          LIMIT 10
        `,
        urlScope.params,
      ),
      db.query(
        `
          SELECT short_code, long_url, click_count, created_at, expires_at, owner_email
          FROM urls u
          ${urlScope.clause}
          ORDER BY created_at DESC
          LIMIT 20
        `,
        urlScope.params,
      ),
    ]);

    return res.json({
      total_urls: totalUrls.rows[0].count,
      total_clicks: totalClicks.rows[0].count,
      clicks_last_24h: clicks24h.rows[0].count,
      clicks_last_7d: clicks7d.rows[0].count,
      top_urls: topUrls.rows,
      recent_urls: recentUrls.rows,
    });
  } catch (err) {
    console.error('Scoped overview query hatasi:', err.message);
    return asJsonError(res, 500, 'overview_unavailable', 'Özet istatistikler alınamadı.');
  }
});

app.get('/api/timeseries', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || '7', 10) || 7));
    const isAdmin = user.role === 'admin';
    const params = isAdmin ? [String(days)] : [user.email.toLowerCase(), String(days)];
    const result = await db.query(
      `
        SELECT date_trunc('day', c.clicked_at) AS day, COUNT(c.id)::int AS clicks
        FROM click_events c
        JOIN urls u ON u.id = c.url_id
        WHERE ${isAdmin ? '' : 'u.owner_email = $1 AND'} c.clicked_at > NOW() - ($${isAdmin ? 1 : 2} || ' days')::interval
        GROUP BY day
        ORDER BY day ASC
      `,
      params,
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Scoped timeseries query hatasi:', err.message);
    return asJsonError(res, 500, 'timeseries_unavailable', 'Trend verisi alınamadı.');
  }
});

// ============== 404 ==============

app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 · Bulunamadi',
    code: 404,
    message: 'Aradığınız sayfa bulunamadı.',
    publicBackendUrl: PUBLIC_BACKEND_URL,
    page: '',
  });
});

function forwardHeaders(req) {
  const h = {};
  // Gercek istemci IP'sini Rust backend'in rate limiter'ina iletelim
  const xff = req.headers['x-forwarded-for'];
  h['X-Forwarded-For'] = xff
    ? `${xff}, ${req.ip}`
    : req.ip;
  if (req.headers['user-agent']) h['User-Agent'] = req.headers['user-agent'];
  if (req.headers['referer']) h['Referer'] = req.headers['referer'];
  if (req.headers['accept-language']) h['Accept-Language'] = req.headers['accept-language'];
  return h;
}

async function start() {
  try {
    await initAuthStorage();
    app.listen(PORT, () => {
      console.log('========================================');
      console.log(' Shurly Frontend');
      console.log('  http://localhost:' + PORT);
      console.log('  -> backend: ' + BACKEND_URL);
      console.log('  -> public : ' + PUBLIC_BACKEND_URL);
      console.log('  -> db     : ' + DATABASE_URL);
      console.log('========================================');
    });
  } catch (err) {
    console.error('Auth storage baslatma hatasi:', err.message);
    process.exit(1);
  }
}

start();
