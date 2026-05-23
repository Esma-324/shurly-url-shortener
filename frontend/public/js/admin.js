(() => {
  const { Toast, apiGet, formatDate, formatNumber, truncate } = window.App;

  const REF_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#64748b'];

  const aTotalUrls = document.getElementById('aTotalUrls');
  const aTotalClicks = document.getElementById('aTotalClicks');
  const a24h = document.getElementById('a24h');
  const a7d = document.getElementById('a7d');
  const aUsers = document.getElementById('aUsers');
  const aHistory = document.getElementById('aHistory');
  const aUserDetailTitle = document.getElementById('aUserDetailTitle');
  const aUserDetailSummary = document.getElementById('aUserDetailSummary');
  const adminSearchInput = document.getElementById('adminSearchInput');
  const adminSearchClear = document.getElementById('adminSearchClear');
  const adminTrendChart = document.getElementById('adminTrendChart');
  const aRefDonut = document.getElementById('aRefDonut');
  const aRefTotal = document.getElementById('aRefTotal');
  const aReferrers = document.getElementById('aReferrers');
  const aUserAgents = document.getElementById('aUserAgents');
  const aLocations = document.getElementById('aLocations');

  const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['tr'], { type: 'region' })
    : null;

  let selectedUserEmail = '';
  let trendChart = null;
  let latestUsers = [];
  let latestHistory = [];

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function normalizeText(value) {
    return String(value || '').toLocaleLowerCase('tr-TR');
  }

  function detectBrowser(userAgent) {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return '(bilinmiyor)';
    if (ua.includes('edg/')) return 'Microsoft Edge';
    if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
    if (ua.includes('samsungbrowser/')) return 'Samsung Internet';
    if (ua.includes('brave/')) return 'Brave';
    if (ua.includes('firefox/') || ua.includes('fxios/')) return 'Firefox';
    if (ua.includes('crios/')) return 'Chrome (iOS)';
    if (ua.includes('chrome/') || ua.includes('chromium/')) return 'Chrome';
    if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('chromium/')) return 'Safari';
    return 'Diğer';
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

  function formatCountryName(country) {
    const raw = String(country || '').trim();
    if (!raw) return 'Bilinmiyor';
    if (regionNames && /^[A-Za-z]{2}$/.test(raw)) {
      const localized = regionNames.of(raw.toUpperCase());
      if (localized) return localized;
    }
    return raw;
  }

  function buildLast14Days(points) {
    const map = new Map();
    (points || []).forEach((p) => map.set(String(p.day).slice(0, 10), Number(p.clicks || 0)));

    const labels = [];
    const values = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      labels.push(d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }));
      values.push(map.get(key) || 0);
    }

    return { labels, values };
  }

  function renderTrendChart(points) {
    if (!adminTrendChart || !window.Chart) return;
    const { labels, values } = buildLast14Days(points);
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(adminTrendChart, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Tıklama',
          data: values,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderReferrerChart(topReferrers, totalClicks) {
    if (!aRefDonut || !aRefTotal || !aReferrers) return;
    const total = Number(totalClicks || 0);
    aRefTotal.textContent = formatNumber(total);
    aReferrers.innerHTML = '';

    if (total <= 0) {
      aRefDonut.style.background = 'conic-gradient(#334155 0deg 360deg)';
      aReferrers.innerHTML = '<li><span class="dot" style="background:#334155"></span><span class="name">Veri yok</span><span class="pct">0%</span></li>';
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

    const shownCount = segments.reduce((sum, item) => sum + item.count, 0);
    if (total > shownCount) {
      segments.push({ name: 'Doğrudan', count: total - shownCount });
    }

    segments = segments.sort((a, b) => b.count - a.count).slice(0, 6);
    const visibleCount = segments.reduce((sum, item) => sum + item.count, 0);
    if (total > visibleCount) segments.push({ name: 'Diğer', count: total - visibleCount });

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
      aReferrers.appendChild(li);
    });

    aRefDonut.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  }

  function renderBrowsers(items) {
    if (!aUserAgents) return;
    aUserAgents.innerHTML = '';

    const merged = new Map();
    (items || []).forEach((item) => {
      const name = detectBrowser(item.user_agent);
      merged.set(name, (merged.get(name) || 0) + Number(item.count || 0));
    });

    const rows = Array.from(merged.entries()).sort((a, b) => b[1] - a[1]);
    if (!rows.length) {
      aUserAgents.innerHTML = '<li><span class="key">Veri yok</span><span class="val">-</span></li>';
      return;
    }

    rows.forEach(([name, count]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="key">${escapeHtml(name)}</span><span class="val">${formatNumber(count)}</span>`;
      aUserAgents.appendChild(li);
    });
  }

  function renderLocations(items, totalClicks) {
    if (!aLocations) return;
    const total = Number(totalClicks || 0);
    aLocations.innerHTML = '';

    if (!items || !items.length || total <= 0) {
      aLocations.innerHTML = '<li class="locations-item"><div class="row"><span class="name">Veri yok</span><span class="value">0 (0%)</span></div><div class="track"><span class="fill" style="width:0%"></span></div></li>';
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
      aLocations.appendChild(li);
    });
  }

  function renderUsers(rows) {
    latestUsers = rows || [];
    if (!aUsers) return;
    aUsers.innerHTML = '';

    const query = normalizeText(adminSearchInput && adminSearchInput.value);
    const filtered = query
      ? latestUsers.filter((u) => normalizeText(`${u.email} kullanıcı tablo`).includes(query))
      : latestUsers;

    if (!filtered.length) {
      aUsers.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:18px">Kullanıcı bulunamadı</td></tr>';
      return;
    }

    filtered.forEach((u) => {
      const tr = document.createElement('tr');
      tr.className = u.email === selectedUserEmail ? 'is-selected' : '';
      tr.innerHTML = `
        <td>
          <button type="button" class="btn-tertiary js-user-select" data-email="${escapeHtml(u.email)}">
            ${escapeHtml(u.email)}
          </button>
        </td>
        <td class="num">${formatNumber(u.total_urls || 0)}</td>
        <td class="num">${formatNumber(u.total_clicks || 0)}</td>
        <td>${formatDate(u.created_at)}</td>
      `;
      tr.querySelector('.js-user-select').addEventListener('click', () => loadUserDetail(u.email, latestUsers));
      aUsers.appendChild(tr);
    });
  }

  function renderHistory(data) {
    if (!aHistory) return;
    latestHistory = data && Array.isArray(data.urls) ? data.urls : [];
    aHistory.innerHTML = '';

    const query = normalizeText(adminSearchInput && adminSearchInput.value);
    const rows = query
      ? latestHistory.filter((r) => normalizeText(`${r.short_code} ${r.long_url} ${selectedUserEmail} geçmiş url hedef`).includes(query))
      : latestHistory;

    if (!rows.length) {
      aHistory.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:18px">URL bulunamadı</td></tr>';
      return;
    }

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="code">/${escapeHtml(r.short_code)}</span></td>
        <td>
          <a href="${escapeHtml(r.short_url || r.long_url)}" target="_blank" rel="noopener" class="truncate">
            ${escapeHtml(truncate(r.long_url, 80))}
          </a>
        </td>
        <td class="num">${formatNumber(r.click_count || 0)}</td>
        <td>${formatDate(r.created_at)}</td>
      `;
      aHistory.appendChild(tr);
    });
  }

  function applySearch() {
    const query = normalizeText(adminSearchInput && adminSearchInput.value);
    document.querySelectorAll('.admin-search-target').forEach((el) => {
      if (!query) {
        el.style.display = '';
        return;
      }
      const text = normalizeText(`${el.dataset.searchLabel || ''} ${el.textContent || ''}`);
      el.style.display = text.includes(query) ? '' : 'none';
    });

    renderUsers(latestUsers);
    renderHistory({ urls: latestHistory });
  }

  async function loadUserDetail(email, knownUsers) {
    selectedUserEmail = email;
    if (knownUsers) renderUsers(knownUsers);

    try {
      const detail = await apiGet('/api/admin/users/' + encodeURIComponent(email) + '/detail');
      const totalUrls = Number(detail.overview && detail.overview.total_urls ? detail.overview.total_urls : 0);
      const totalClicks = Number(detail.overview && detail.overview.total_clicks ? detail.overview.total_clicks : 0);

      if (aUserDetailTitle) aUserDetailTitle.textContent = `${email} URL Geçmişi`;
      if (aUserDetailSummary) {
        aUserDetailSummary.textContent = `${formatNumber(totalUrls)} kayıtlı URL · ${formatNumber(totalClicks)} toplam tıklama`;
      }

      renderHistory(detail.history);
      applySearch();
    } catch (err) {
      Toast.show(err.message || 'Kullanıcı detayları alınamadı', 'error');
    }
  }

  async function loadAll() {
    try {
      const [overview, timeseries, analytics, users] = await Promise.all([
        apiGet('/api/admin/overview'),
        apiGet('/api/admin/timeseries'),
        apiGet('/api/admin/analytics'),
        apiGet('/api/admin/users'),
      ]);

      aTotalUrls.textContent = formatNumber(overview.total_urls);
      aTotalClicks.textContent = formatNumber(overview.total_clicks);
      a24h.textContent = formatNumber(overview.clicks_last_24h);
      a7d.textContent = formatNumber(overview.clicks_last_7d);

      renderTrendChart(timeseries);
      renderReferrerChart(analytics.top_referrers, overview.total_clicks);
      renderBrowsers(analytics.top_user_agents);
      renderLocations(analytics.top_locations, overview.total_clicks);

      renderUsers(users);
      if (users && users.length) {
        const emailToOpen = selectedUserEmail || users[0].email;
        await loadUserDetail(emailToOpen, users);
      } else {
        renderHistory({ urls: [] });
      }
      applySearch();
    } catch (err) {
      Toast.show(err.message || 'Admin verileri alınamadı', 'error');
    }
  }

  if (adminSearchInput) {
    adminSearchInput.addEventListener('input', applySearch);
  }

  if (adminSearchClear) {
    adminSearchClear.addEventListener('click', () => {
      adminSearchInput.value = '';
      applySearch();
      adminSearchInput.focus();
    });
  }

  loadAll();
  setInterval(loadAll, 30000);
})();
