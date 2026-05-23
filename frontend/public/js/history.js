(() => {
  const { Toast, apiGet, apiPut, apiDelete, formatDate, publicShortUrl, historyItemShortCode } = window.App;

  const historyRoot = document.getElementById('historyRoot');
  const recentSection = document.getElementById('recentSection');
  const recentList = document.getElementById('recentList');
  const recentCount = document.getElementById('recentCount');
  const empty = document.getElementById('historyEmpty');
  const searchInput = document.getElementById('historySearchInput');
  const clearBtn = document.getElementById('historyClearBtn');
  const pagination = document.getElementById('historyPagination');
  const prevBtn = document.getElementById('historyPrevBtn');
  const nextBtn = document.getElementById('historyNextBtn');
  const pageInfo = document.getElementById('historyPageInfo');
  const editModal = document.getElementById('editModal');
  const editModalClose = document.getElementById('editModalClose');
  const editModalCancel = document.getElementById('editModalCancel');
  const editModalForm = document.getElementById('editModalForm');
  const editModalInput = document.getElementById('editModalInput');
  const deleteModal = document.getElementById('deleteModal');
  const deleteModalClose = document.getElementById('deleteModalClose');
  const deleteModalCancel = document.getElementById('deleteModalCancel');
  const deleteModalConfirm = document.getElementById('deleteModalConfirm');

  if (!historyRoot || !recentSection || !recentList || !recentCount || !empty) return;

  let editingItem = null;
  let deletingItem = null;
  let searchTerm = '';
  let currentPage = 1;
  let historyItems = [];
  const PAGE_SIZE = 10;

  function readHistory() {
    return historyItems;
  }

  function saveHistory(items) {
    historyItems = items;
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

  function openEditModal(item) {
    editingItem = item;
    editModalInput.value = historyItemShortCode(item);
    editModal.classList.remove('hidden');
    editModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => editModalInput.focus(), 0);
  }

  function closeEditModal() {
    editingItem = null;
    editModal.classList.add('hidden');
    editModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function openDeleteModal(item) {
    deletingItem = item;
    deleteModal.classList.remove('hidden');
    deleteModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeDeleteModal() {
    deletingItem = null;
    deleteModal.classList.add('hidden');
    deleteModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
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
    const removedCode = historyItemShortCode({ short_url: shortUrl });
    const list = readHistory().filter((x) => historyItemShortCode(x) !== removedCode);
    saveHistory(list);
    renderHistory();
  }

  function renderHistory() {
    const allItems = readHistory();
    const normalized = searchTerm.trim().toLowerCase();
    const items = normalized
      ? allItems.filter((it) => {
        const shortCode = String(historyItemShortCode(it) || '').toLowerCase();
        const shortUrl = String(it.short_url || '').toLowerCase();
        const longUrl = String(it.long_url || '').toLowerCase();
        return shortCode.includes(normalized)
          || shortUrl.includes(normalized)
          || longUrl.includes(normalized);
      })
      : allItems;

    recentList.innerHTML = '';
    recentCount.textContent = items.length
      ? (items.length + (normalized ? ' sonuç' : ' kayıt'))
      : '';

    if (!items.length) {
      recentSection.classList.add('hidden');
      if (pagination) pagination.classList.add('hidden');
      empty.classList.remove('hidden');
      const emptyText = empty.querySelector('p');
      if (emptyText && normalized) {
        emptyText.textContent = 'Aramana uygun kayıt bulunamadı.';
      } else if (emptyText) {
        emptyText.textContent = 'Backend veritabanında kayıtlı URL bulunamadı.';
      }
      return;
    }

    empty.classList.add('hidden');
    recentSection.classList.remove('hidden');

    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    pageItems.forEach((it) => {
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
            <a class="btn-tertiary" href="/stats?code=${encodeURIComponent(historyItemShortCode(it))}&fromHistory=1">İstatistik</a>
          </div>
          <span>${it.owner_email ? `${it.owner_email} · ` : ''}${formatDate(it.created_at)}</span>
        </div>
      `;

      li.querySelector('.js-edit').addEventListener('click', () => openEditModal(it));
      li.querySelector('.js-delete').addEventListener('click', () => openDeleteModal(it));

      recentList.appendChild(li);
    });

    if (pagination && prevBtn && nextBtn && pageInfo) {
      if (totalPages <= 1) {
        pagination.classList.add('hidden');
      } else {
        pagination.classList.remove('hidden');
        pageInfo.textContent = `${currentPage} / ${totalPages}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= totalPages;
      }
    }
  }

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

  editModalClose.addEventListener('click', closeEditModal);
  editModalCancel.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });
  deleteModalClose.addEventListener('click', closeDeleteModal);
  deleteModalCancel.addEventListener('click', closeDeleteModal);
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });
  deleteModalConfirm.addEventListener('click', async () => {
    if (!deletingItem) return;
    try {
      await apiDelete('/api/url/' + encodeURIComponent(historyItemShortCode(deletingItem)));
      closeDeleteModal();
      await loadHistory();
      Toast.show('Kısa URL silindi', 'success');
    } catch (err) {
      Toast.show(err.message || 'Silme yapılamadı', 'error');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !editModal.classList.contains('hidden')) {
      closeEditModal();
    }
    if (e.key === 'Escape' && !deleteModal.classList.contains('hidden')) {
      closeDeleteModal();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value || '';
      currentPage = 1;
      renderHistory();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchTerm = '';
      currentPage = 1;
      renderHistory();
      if (searchInput) searchInput.focus();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      currentPage -= 1;
      renderHistory();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage += 1;
      renderHistory();
    });
  }

  async function loadHistory() {
    const emptyText = empty.querySelector('p');
    if (emptyText) emptyText.textContent = 'Kayıtlar yükleniyor...';

    try {
      const data = await apiGet('/api/history');
      historyItems = Array.isArray(data.urls) ? data.urls : [];
    } catch (err) {
      historyItems = [];
      Toast.show(err.message || 'Geçmiş kayıtları alınamadı', 'error');
      if (emptyText) emptyText.textContent = 'Geçmiş kayıtları alınamadı.';
    }

    currentPage = 1;
    renderHistory();
  }

  loadHistory();
})();
