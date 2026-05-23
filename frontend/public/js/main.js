/* ===== Ortak yardimcilar ===== */

const Toast = (() => {
  const el = document.getElementById('toast');
  let hideTimer;
  function show(message, type = 'info') {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('error', 'success');
    if (type === 'error') el.classList.add('error');
    if (type === 'success') el.classList.add('success');
    el.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  return { show };
})();

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.redirect) {
    window.location.href = data.redirect;
    return new Promise(() => {});
  }
  if (!res.ok) {
    const err = new Error(data.message || 'Beklenmeyen hata');
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.redirect) {
    window.location.href = data.redirect;
    return new Promise(() => {});
  }
  if (!res.ok) {
    const err = new Error(data.message || 'Beklenmeyen hata');
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.redirect) {
    window.location.href = data.redirect;
    return new Promise(() => {});
  }
  if (!res.ok) {
    const err = new Error(data.message || 'Beklenmeyen hata');
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.redirect) {
    window.location.href = data.redirect;
    return new Promise(() => {});
  }
  if (!res.ok) {
    const err = new Error(data.message || 'Beklenmeyen hata');
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

function formatDate(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoString; }
}

function formatNumber(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('tr-TR').format(n);
}

function truncate(text, len = 60) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '…' : text;
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); resolve();
    } catch (e) { reject(e); }
  });
}

/** Gecmis kaydindan kisa kod (eski entry'lerde yalnizca short_url olabilir) */
function historyItemShortCode(item) {
  const direct = String(item && item.short_code ? item.short_code : '').trim();
  if (direct) return direct;
  const raw = String(item && item.short_url ? item.short_url : '').trim();
  if (!raw) return '';
  try {
    const seg = new URL(raw).pathname.replace(/^\/+/, '').split('/')[0];
    return seg ? decodeURIComponent(seg) : '';
  } catch {
    const m = raw.match(/\/([^/?#]+)\/?(?:\?|#|$)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
}

/** Kisa link tam URL (Rust redirect sunucusu — PUBLIC_BACKEND_URL / BASE_URL) */
function publicShortUrl(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  let base = '';
  try {
    base = String(window.__SHURLY_PUBLIC_BACKEND__ || '').trim().replace(/\/+$/, '');
  } catch {
    base = '';
  }
  if (!base) {
    try {
      base = window.location.origin.replace(/\/$/, '');
    } catch {
      base = '';
    }
  }
  return `${base}/${encodeURIComponent(c)}`;
}

window.App = {
  Toast,
  apiPost,
  apiGet,
  apiPut,
  apiDelete,
  formatDate,
  formatNumber,
  truncate,
  copyToClipboard,
  historyItemShortCode,
  publicShortUrl,
};
