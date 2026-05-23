(() => {
  const { Toast, apiPost, apiPut, apiDelete, formatDate, copyToClipboard, publicShortUrl, historyItemShortCode } = window.App;

  const startBtn = document.getElementById('startBtn');
  const heroStart = document.getElementById('heroStart');
  const form = document.getElementById('shortenForm');
  const result = document.getElementById('result');
  const resultUrl = document.getElementById('resultUrl');
  const resultLong = document.getElementById('resultLong');
  const resultTime = document.getElementById('resultTime');
  const resultStatsLink = document.getElementById('resultStatsLink');
  const copyBtn = document.getElementById('copyBtn');
  const newBtn = document.getElementById('newBtn');
  const qrImage = document.getElementById('qrImage');
  const qrDownload = document.getElementById('qrDownload');
  const recentSection = document.getElementById('recentSection');
  const recentList = document.getElementById('recentList');
  const recentCount = document.getElementById('recentCount');
  const editModal = document.getElementById('editModal');
  const editModalClose = document.getElementById('editModalClose');
  const editModalCancel = document.getElementById('editModalCancel');
  const editModalForm = document.getElementById('editModalForm');
  const editModalInput = document.getElementById('editModalInput');
  const customCodeField = document.getElementById('custom_code');
  const customCodeError = document.getElementById('customCodeError');

  if (!form) return;

  let lastShortUrl = '';
  let editingItem = null;
  let shortenSubmitting = false;
  const isAuthenticated = !!(startBtn && startBtn.dataset.authenticated === '1');
  const userEmail = (form.dataset.userEmail || '').trim().toLowerCase();
  const historyKey = 'shurly:history:' + (userEmail || 'guest');

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    try {
      localStorage.setItem(historyKey, JSON.stringify(items));
    } catch {
      // localStorage dolu olabilir; sessizce geç.
    }
  }

  function pushHistory(item) {
    const list = readHistory().filter((x) => x.short_url !== item.short_url);
    list.unshift(item);
    saveHistory(list.slice(0, 20));
    renderHistory();
  }

  function replaceHistoryItem(oldShortUrl, nextItem) {
    const list = readHistory();
    const idx = list.findIndex((x) => x.short_url === oldShortUrl);
    if (idx === -1) return;
    list[idx] = nextItem;
    saveHistory(list);
    renderHistory();
  }

  function removeHistoryItem(shortUrl) {
    const list = readHistory().filter((x) => x.short_url !== shortUrl);
    saveHistory(list);
    renderHistory();
  }

  function renderHistory() {
    if (!recentSection || !recentList || !recentCount) return;
    const items = readHistory();
    recentList.innerHTML = '';
    recentCount.textContent = items.length ? (items.length + ' kayıt') : '';

    if (!items.length) {
      recentSection.classList.add('hidden');
      return;
    }

    items.forEach((it) => {
      const li = document.createElement('li');
      li.className = 'recent-item';
      const shortHref = publicShortUrl(historyItemShortCode(it));
      li.innerHTML = `
        <div class="recent-main">
          <a class="recent-short" href="${shortHref}" target="_blank" rel="noopener">${shortHref}</a>
          <div class="recent-long">${it.long_url || '-'}</div>
        </div>
        <div class="recent-meta">
          <div class="recent-actions">
            <button type="button" class="icon-btn js-edit" title="Düzenle">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
              </svg>
            </button>
            <button type="button" class="icon-btn danger js-delete" title="Sil">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              </svg>
            </button>
            <a class="btn-tertiary" href="/stats?code=${encodeURIComponent(historyItemShortCode(it))}">İstatistik</a>
          </div>
          <span>${formatDate(it.created_at)}</span>
        </div>
      `;

      const editBtn = li.querySelector('.js-edit');
      const deleteBtn = li.querySelector('.js-delete');

      editBtn.addEventListener('click', () => openEditModal(it));

      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm('Bu kısa URL silinsin mi?')) return;
        try {
          await apiDelete('/api/url/' + encodeURIComponent(historyItemShortCode(it)));
          removeHistoryItem(it.short_url);
          Toast.show('Kısa URL silindi', 'success');
        } catch (err) {
          Toast.show(err.message || 'Silme yapılamadı', 'error');
        }
      });

      recentList.appendChild(li);
    });

    recentSection.classList.remove('hidden');
  }

  function showFormDirectly() {
    if (heroStart) heroStart.classList.add('hidden');
    form.classList.remove('hidden');
  }

  function normalizeCustomCode(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[ç]/g, 'c')
      .replace(/[ğ]/g, 'g')
      .replace(/[ı]/g, 'i')
      .replace(/[ö]/g, 'o')
      .replace(/[ş]/g, 's')
      .replace(/[ü]/g, 'u')
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s./\\]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function isValidHttpUrl(value) {
    try {
      const u = new URL(String(value || '').trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function openEditModal(item) {
    if (!editModal || !editModalInput) return;
    editingItem = item;
    editModalInput.value = historyItemShortCode(item);
    editModal.classList.remove('hidden');
    editModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => editModalInput.focus(), 0);
  }

  function closeEditModal() {
    if (!editModal) return;
    editingItem = null;
    editModal.classList.add('hidden');
    editModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function setCustomCodeError(message) {
    if (!customCodeError) return;
    customCodeError.textContent = message || '';
    customCodeError.classList.toggle('hidden', !message);
  }

  if (startBtn && heroStart) {
    startBtn.addEventListener('click', () => {
      if (!isAuthenticated) {
        window.location.href = '/login';
        return;
      }

      showFormDirectly();
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const longInput = document.getElementById('long_url');
      if (longInput) longInput.focus();
    });
  }

  async function handleShortenSubmit() {
    if (shortenSubmitting) return;
    const submitBtn = form.querySelector('button[type=submit]');
    const labelEl = submitBtn ? submitBtn.querySelector('.btn-label') : null;
    let submittedCustomCode = '';

    try {
      setCustomCodeError('');
      const formData = new FormData(form);
      const urlRaw = formData.get('url');
      const customRaw = formData.get('custom_code');
      const expRaw = formData.get('expires_in_days');

      const url = String(urlRaw || '').trim();
      const customCodeInput = String(customRaw || '');
      const customCode = normalizeCustomCode(customCodeInput);
      submittedCustomCode = customCode;
      const exp = String(expRaw || '');

      if (!url) {
        Toast.show('Lütfen bir URL girin.', 'error');
        document.getElementById('long_url')?.focus();
        return;
      }

      if (!isValidHttpUrl(url)) {
        Toast.show('Geçerli bir URL girin (http/https ile başlamalı).', 'error');
        document.getElementById('long_url')?.focus();
        return;
      }

      if (customCodeInput.trim() && !customCode) {
        Toast.show('Özel kod geçersiz. Harf/rakam ve tire kullanın.', 'error');
        customCodeField?.focus();
        return;
      }

      if (customCode && (customCode.length < 3 || customCode.length > 32)) {
        Toast.show('Özel kod 3-32 karakter olmalı.', 'error');
        customCodeField?.focus();
        return;
      }

      const payload = { url };
      if (customCode) payload.custom_code = customCode;
      if (exp) payload.expires_in_days = parseInt(exp, 10);

      if (submitBtn) submitBtn.disabled = true;
      if (labelEl) labelEl.textContent = 'Kısaltılıyor…';
      shortenSubmitting = true;

      const data = await apiPost('/api/shorten', payload);

      lastShortUrl = data.short_url;
      resultUrl.textContent = data.short_url;
      resultUrl.href = data.short_url;
      resultLong.textContent = data.long_url;
      resultTime.textContent = formatDate(data.created_at);
      resultStatsLink.href = '/stats?code=' + encodeURIComponent(data.short_code);

      // QR kodu yukle (SVG)
      const qrUrl = '/api/qr/' + encodeURIComponent(data.short_code) + '?size=320';
      qrImage.src = qrUrl;
      qrDownload.href = qrUrl;
      qrDownload.setAttribute('download', 'qr-' + data.short_code + '.svg');

      pushHistory({
        short_url: data.short_url,
        short_code: data.short_code,
        long_url: data.long_url,
        created_at: data.created_at,
      });

      result.classList.remove('hidden');
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      Toast.show('URL başarıyla kısaltıldı', 'success');
    } catch (err) {
      const isNameConflict = err.code === 'conflict' || (err.status === 409 && submittedCustomCode);
      const msg = err.code === 'rate_limited'
        ? 'Çok hızlı istek gönderdiniz. Bir dakika bekleyin.'
        : err.code === 'duplicate_url'
          ? 'Bu URL daha önce kısaltılmıştır.'
          : isNameConflict
            ? 'Bu isim zaten kullanılıyor.'
            : err.status === 409
              ? (submittedCustomCode ? 'Bu isim zaten kullanılıyor.' : 'Bu URL daha önce kısaltılmıştır.')
              : (err.message || 'Bir hata oluştu. Lütfen tekrar deneyin.');
      if (isNameConflict) {
        setCustomCodeError('Bu isim zaten kullanılıyor. Lütfen farklı bir kısa kod deneyin.');
        customCodeField?.focus();
      }
      Toast.show(msg, 'error');
    } finally {
      shortenSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
      if (labelEl) labelEl.textContent = 'Kısalt';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleShortenSubmit();
  });

  const submitBtnDirect = form.querySelector('button[type=submit]');
  if (submitBtnDirect) {
    submitBtnDirect.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleShortenSubmit();
    });
  }

  if (customCodeField) {
    customCodeField.addEventListener('input', () => setCustomCodeError(''));
    customCodeField.addEventListener('blur', () => {
      customCodeField.value = normalizeCustomCode(customCodeField.value);
    });
  }

  if (editModalForm && editModalInput) {
    editModalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editingItem) return;

      const newCode = normalizeCustomCode(editModalInput.value);
      if (!newCode) {
        Toast.show('Geçerli bir kod girin.', 'error');
        return;
      }

      try {
        const data = await apiPut('/api/url/' + encodeURIComponent(historyItemShortCode(editingItem)), {
          new_code: newCode,
        });
        const nextShortCode = data.short_code || newCode;
        const nextShortUrl = data.short_url || publicShortUrl(nextShortCode);
        replaceHistoryItem(editingItem.short_url, {
          ...editingItem,
          short_code: nextShortCode,
          short_url: nextShortUrl,
        });
        closeEditModal();
        Toast.show('Kısa kod güncellendi', 'success');
      } catch (err) {
        const msg = err.code === 'conflict'
          ? 'Bu isim zaten kullanılıyor.'
          : (err.message || 'Düzenleme yapılamadı');
        Toast.show(msg, 'error');
      }
    });
  }

  if (editModalClose) editModalClose.addEventListener('click', closeEditModal);
  if (editModalCancel) editModalCancel.addEventListener('click', closeEditModal);
  if (editModal) {
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) closeEditModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editModal && !editModal.classList.contains('hidden')) {
      closeEditModal();
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await copyToClipboard(lastShortUrl);
      Toast.show('Kopyalandi', 'success');
    } catch {
      Toast.show('Kopyalanamadi', 'error');
    }
  });

  newBtn.addEventListener('click', () => {
    form.reset();
    result.classList.add('hidden');
    document.getElementById('long_url').focus();
  });

  if (isAuthenticated) {
    showFormDirectly();
    renderHistory();
  }
})();
