(() => {
  const { Toast, apiGet, formatDate, formatNumber, truncate } = window.App;

  const form = document.getElementById('statsForm');
  const codeInput = document.getElementById('codeInput');
  const statsRoot = document.getElementById('statsRoot');
  const body = document.getElementById('statsBody');
  const empty = document.getElementById('statsEmpty');
  const personalOverview = document.getElementById('personalOverview');
  const ovUrls = document.getElementById('ovUrls');
  const ovClicks = document.getElementById('ovClicks');
  const ovPopular = document.getElementById('ovPopular');
  const ovTodayClicks = document.getElementById('ovTodayClicks');
  const ovTrendChart = document.getElementById('ovTrendChart');
  const ovTrendTitle = document.getElementById('ovTrendTitle');
  const ovTrendCaption = document.getElementById('ovTrendCaption');

  const sTotal = document.getElementById('sTotal');
  const s24h = document.getElementById('s24h');
  const sCreated = document.getElementById('sCreated');
  const sShort = document.getElementById('sShort');
  const sLong = document.getElementById('sLong');
  const sReferrers = document.getElementById('sReferrers');
  const sRefDonut = document.getElementById('sRefDonut');
  const sRefTotal = document.getElementById('sRefTotal');
  const sUserAgents = document.getElementById('sUserAgents');
  const sLocations = document.getElementById('sLocations');
  const sClicks = document.getElementById('sClicks');
  const sQr = document.getElementById('sQr');
  const sQrDownload = document.getElementById('sQrDownload');
  const REF_COLORS = ['#1d4ed8', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  const regionNames = (typeof Intl !== 'undefined' && Intl.DisplayNames)
    ? new Intl.DisplayNames(['tr'], { type: 'region' })
    : null;
  const rawPub = statsRoot ? String(statsRoot.dataset.publicBaseUrl || '').trim() : '';
  const globalPub = String(typeof window.__SHURLY_PUBLIC_BACKEND__ !== 'undefined' ? window.__SHURLY_PUBLIC_BACKEND__ : '').trim();
  const publicBaseUrl = (rawPub || globalPub || window.location.origin).replace(/\/$/, '');
  let overviewLoading = false;
  let selectedCode = '';
  let statsRequestSeq = 0;

  function detectBrowser(userAgent) {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return '(bilinmiyor)';

    // Sıralama önemli: Edge/Opera/Samsung gibi Chromium türevleri Chrome'dan önce kontrol edilir.
    if (ua.includes('edg/')) return 'Microsoft Edge';
    if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
    if (ua.includes('samsungbrowser/')) return 'Samsung Internet';
    if (ua.includes('brave/')) return 'Brave';
    if (ua.includes('firefox/') || ua.includes('fxios/')) return 'Firefox';
    if (ua.includes('crios/')) return 'Chrome (iOS)';
    if (ua.includes('chrome/') || ua.includes('chromium/')) return 'Chrome';
    if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('chromium/')) return 'Safari';
    if (ua.includes('msie') || ua.includes('trident/')) return 'Internet Explorer';
    return 'Diğer';
  }

  function renderKvList(el, items, keyName) {
    el.innerHTML = '';
    if (!items || items.length === 0) {
      el.innerHTML = '<li><span class="key">Veri yok</span><span class="val">-</span></li>';
      return;
    }
    const merged = new Map();
    items.forEach((it) => {
      const rawKey = it[keyName] || '';
      const key = keyName === 'user_agent'
        ? detectBrowser(rawKey)
        : (rawKey || '(bilinmiyor)');
      const count = Number(it.count || 0);
      merged.set(key, (merged.get(key) || 0) + count);
    });

    Array.from(merged.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, count]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="key">${escapeHtml(truncate(key, 60))}</span><span class="val">${formatNumber(count)}</span>`;
      el.appendChild(li);
    });
  }

  function renderClicks(el, clicks) {
    el.innerHTML = '';
    if (!clicks || clicks.length === 0) {
      el.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:24px">Henüz tıklama yok</td></tr>';
      return;
    }
    clicks.forEach((c) => {
      const browserName = detectBrowser(c.user_agent);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(c.clicked_at)}</td>
        <td><span class="code">${escapeHtml(c.ip_address || '-')}</span></td>
        <td><span class="truncate" title="${escapeHtml(c.user_agent || browserName)}">${escapeHtml(browserName)}</span></td>
        <td><span class="truncate">${escapeHtml(c.referrer || '-')}</span></td>
      `;
      el.appendChild(tr);
    });
  }

  function asSourceName(referrer) {
    if (!referrer) return 'Doğrudan';
    try {
      const url = new URL(referrer);
      return (url.hostname || referrer).replace(/^www\./i, '');
    } catch {
      return String(referrer).replace(/^https?:\/\//i, '').split('/')[0] || 'Diğer';
    }
  }

  function renderReferrerChart(topReferrers, totalClicks) {
    const total = Number(totalClicks || 0);
    sRefTotal.textContent = formatNumber(total);
    sReferrers.innerHTML = '';

    if (total <= 0) {
      sRefDonut.style.background = 'conic-gradient(#334155 0deg 360deg)';
      sReferrers.innerHTML = '<li><span class="dot" style="background:#334155"></span><span class="name">Veri yok</span><span class="pct">0%</span></li>';
      return;
    }

    const grouped = new Map();
    (topReferrers || []).forEach((item) => {
      const name = asSourceName(item.referrer);
      const count = Number(item.count || 0);
      grouped.set(name, (grouped.get(name) || 0) + count);
    });

    let segments = Array.from(grouped.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const known = segments.reduce((sum, item) => sum + item.count, 0);
    const directCount = Math.max(0, total - known);
    if (directCount > 0) {
      const i = segments.findIndex((s) => s.name === 'Doğrudan');
      if (i >= 0) segments[i].count += directCount;
      else segments.push({ name: 'Doğrudan', count: directCount });
    }

    segments = segments
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const shown = segments.reduce((sum, item) => sum + item.count, 0);
    if (total - shown > 0) segments.push({ name: 'Diğer', count: total - shown });

    let offset = 0;
    const gradientParts = [];
    segments.forEach((seg, idx) => {
      const angle = (seg.count / total) * 360;
      const end = offset + angle;
      const color = REF_COLORS[idx % REF_COLORS.length];
      gradientParts.push(`${color} ${offset.toFixed(2)}deg ${end.toFixed(2)}deg`);
      offset = end;

      const pct = Math.max(1, Math.round((seg.count / total) * 100));
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${color}"></span><span class="name">${escapeHtml(seg.name)}</span><span class="pct">${pct}%</span>`;
      sReferrers.appendChild(li);
    });

    sRefDonut.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  }

  function renderTopLocations(items, totalClicks) {
    sLocations.innerHTML = '';
    const total = Number(totalClicks || 0);
    if (!items || items.length === 0 || total <= 0) {
      sLocations.innerHTML = '<li class="locations-item"><div class="row"><span class="name">Veri yok</span><span class="value">0 (0%)</span></div><div class="track"><span class="fill" style="width:0%"></span></div></li>';
      return;
    }

    items.forEach((it) => {
      const name = formatCountryName(it.country);
      const count = Number(it.count || 0);
      const pct = Math.round((count / total) * 100);
      const li = document.createElement('li');
      li.className = 'locations-item';
      li.innerHTML = `
        <div class="row">
          <span class="name">${escapeHtml(name)}</span>
          <span class="value">${formatNumber(count)} (${pct}%)</span>
        </div>
        <div class="track">
          <span class="fill" style="width:${Math.max(2, pct)}%"></span>
        </div>
      `;
      sLocations.appendChild(li);
    });
  }

  function formatCountryName(country) {
    const raw = String(country || '').trim();
    if (!raw) return 'Bilinmiyor';

    if (regionNames && /^[A-Za-z]{2}$/.test(raw)) {
      const localized = regionNames.of(raw.toUpperCase());
      if (localized) return localized;
    }
    return raw;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function buildLast14Days(points) {
    const labels = [];
    const data = [];
    const map = new Map();
    const dateKey = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    (points || []).forEach((p) => {
      const d = new Date(p.day);
      const key = dateKey(d);
      map.set(key, Number(p.clicks || 0));
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      labels.push(d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }));
      data.push(map.get(key) || 0);
    }
    return { labels, data };
  }

  function renderOverviewChart(points) {
    if (!ovTrendChart || typeof Chart === 'undefined') return;
    const ctx2d = ovTrendChart.getContext('2d');
    const { labels, data } = buildLast14Days(points);
    const grad = ctx2d.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, 'rgba(124, 92, 255, 0.5)');
    grad.addColorStop(1, 'rgba(124, 92, 255, 0)');

    if (window._overviewTrendChart) window._overviewTrendChart.destroy();
    window._overviewTrendChart = new Chart(ovTrendChart, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Tıklamalar',
          data,
          borderColor: '#7c5cff',
          backgroundColor: grad,
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#5eead4',
          pointBorderColor: '#7c5cff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20,22,36,0.95)',
            borderColor: 'rgba(255,255,255,0.16)',
            borderWidth: 1,
            titleColor: '#e9ecf5',
            bodyColor: '#e9ecf5',
            padding: 10,
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#a0a6bd', maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#a0a6bd', precision: 0 },
          },
        },
      },
    });
  }

  async function loadPersonalOverview() {
    if (selectedCode) return;
    if (overviewLoading) return;
    if (!personalOverview || !ovUrls || !ovClicks || !ovPopular || !ovTodayClicks || !ovTrendChart) return;
    overviewLoading = true;

    try {
      const [overview, timeseries] = await Promise.all([
        apiGet('/api/overview'),
        apiGet('/api/timeseries?days=14'),
      ]);

      ovUrls.textContent = formatNumber(overview.total_urls || 0);
      ovClicks.textContent = formatNumber(overview.total_clicks || 0);
      ovTodayClicks.textContent = formatNumber(overview.clicks_last_24h || 0);

      const top = Array.isArray(overview.top_urls) ? overview.top_urls[0] : null;
      ovPopular.textContent = top && top.short_code ? (publicBaseUrl + '/' + top.short_code) : '-';

      if (ovTrendTitle) ovTrendTitle.textContent = 'Günlük Tıklanma Trendi (Tümü)';
      if (ovTrendCaption) ovTrendCaption.textContent = 'Son 14 gün';
      renderOverviewChart(Array.isArray(timeseries) ? timeseries : []);
      personalOverview.classList.remove('hidden');
    } finally {
      overviewLoading = false;
    }
  }

  async function loadStats(code) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) return;
    selectedCode = normalizedCode;
    const reqSeq = ++statsRequestSeq;

    try {
      const safeCode = encodeURIComponent(normalizedCode);
      const [data, trend, overview] = await Promise.all([
        apiGet('/api/stats/' + safeCode),
        apiGet('/api/stats/' + safeCode + '/timeseries?days=14'),
        apiGet('/api/overview'),
      ]);
      if (reqSeq !== statsRequestSeq) return;
      sTotal.textContent = formatNumber(data.click_count);
      s24h.textContent = formatNumber(data.last_24h_clicks);
      sCreated.textContent = formatDate(data.created_at);
      sShort.textContent = '/' + data.short_code;
      sShort.href = publicBaseUrl + '/' + data.short_code;
      sLong.textContent = data.long_url;
      sLong.href = data.long_url;

      renderReferrerChart(data.top_referrers, data.click_count);
      renderKvList(sUserAgents, data.top_user_agents, 'user_agent');
      renderTopLocations(data.top_locations, data.click_count);
      renderClicks(sClicks, data.recent_clicks);

      if (ovTrendTitle) ovTrendTitle.textContent = `Günlük Tıklanma Trendi (/${data.short_code})`;
      if (ovTrendCaption) ovTrendCaption.textContent = 'Seçili link - son 14 gün';
      if (ovUrls) ovUrls.textContent = '1';
      if (ovClicks) ovClicks.textContent = formatNumber(data.click_count || 0);
      if (ovTodayClicks) ovTodayClicks.textContent = formatNumber(data.last_24h_clicks || 0);
      if (ovPopular) {
        const top = Array.isArray(overview.top_urls) ? overview.top_urls[0] : null;
        ovPopular.textContent = top && top.short_code ? (publicBaseUrl + '/' + top.short_code) : '-';
      }
      renderOverviewChart(Array.isArray(trend) ? trend : []);
      if (personalOverview) personalOverview.classList.remove('hidden');

      const qrUrl = '/api/qr/' + encodeURIComponent(data.short_code) + '?size=360';
      sQr.src = qrUrl;
      sQrDownload.href = qrUrl;
      sQrDownload.setAttribute('download', 'qr-' + data.short_code + '.svg');

      empty.classList.add('hidden');
      body.classList.remove('hidden');
    } catch (err) {
      if (reqSeq !== statsRequestSeq) return;
      const msg = err.code === 'not_found'
        ? 'Bu kod için URL bulunamadı'
        : (err.message || 'Veri alinamadi');
      Toast.show(msg, 'error');
      selectedCode = '';
      loadPersonalOverview();
      body.classList.add('hidden');
      empty.classList.remove('hidden');
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value.trim();
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    history.replaceState({}, '', url.toString());
    loadStats(code);
  });

  // Sayfa acilisinda querystring'den kod gelmis olabilir
  if (codeInput.value.trim()) {
    loadStats(codeInput.value.trim());
  } else {
    loadPersonalOverview();
  }
  setInterval(loadPersonalOverview, 30000);
  window.addEventListener('focus', loadPersonalOverview);
})();
