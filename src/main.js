import './style.css';
import {
  parseDocumentFile,
  formatBytes,
  mergeDocuments,
  mergePagesGrid,
  generateSampleDocuments,
  renderPageThumbnail
} from './pdf-service.js';

/* ==========================================================================
   Application State
   ========================================================================== */
const state = {
  documents: [], // Array of document objects
  activeView: 'docListView', // 'docListView' | 'pageGridView'
  pageSize: 'sm', // 'sm' | 'md' | 'lg'
  deferredPrompt: null,
  mergedPdfBlob: null,
  mergedPdfUrl: null,
  draggedDocIndex: null,
  draggedPageFlatIndex: null
};

/* ==========================================================================
   DOM Element Selectors
   ========================================================================== */
const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  workspaceSection: document.getElementById('workspaceSection'),
  tabDocView: document.getElementById('tabDocView'),
  tabPageView: document.getElementById('tabPageView'),
  docListView: document.getElementById('docListView'),
  pageGridView: document.getElementById('pageGridView'),
  documentList: document.getElementById('documentList'),
  pagesGrid: document.getElementById('pagesGrid'),
  docCountBadge: document.getElementById('docCountBadge'),
  pageCountBadge: document.getElementById('pageCountBadge'),
  btnAddMore: document.getElementById('btnAddMore'),
  btnRotateAll: document.getElementById('btnRotateAll'),
  btnClearAll: document.getElementById('btnClearAll'),
  btnTrySample: document.getElementById('btnTrySample'),
  btnInstallPwa: document.getElementById('btnInstallPwa'),
  offlineStatusPill: document.getElementById('offlineStatusPill'),
  outputFilename: document.getElementById('outputFilename'),
  mergeSummaryText: document.getElementById('mergeSummaryText'),
  btnMerge: document.getElementById('btnMerge'),
  
  // Progress Modal
  progressModal: document.getElementById('progressModal'),
  progressBar: document.getElementById('progressBar'),
  progressMessage: document.getElementById('progressMessage'),
  progressPercent: document.getElementById('progressPercent'),
  
  // Result Modal
  resultModal: document.getElementById('resultModal'),
  resultFilename: document.getElementById('resultFilename'),
  resultPageCount: document.getElementById('resultPageCount'),
  resultFileSize: document.getElementById('resultFileSize'),
  btnDownloadResult: document.getElementById('btnDownloadResult'),
  btnPreviewResult: document.getElementById('btnPreviewResult'),
  btnShareResult: document.getElementById('btnShareResult'),
  btnCloseResult: document.getElementById('btnCloseResult'),
  
  // Toast
  toastContainer: document.getElementById('toastContainer')
};

/* ==========================================================================
   Toast Notification Helper
   ========================================================================== */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <span>${message}</span>
  `;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/* ==========================================================================
   PWA & Service Worker Registration
   ========================================================================== */
function initPwa() {
  // Register Service Worker for offline capability
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('DocuMerge ServiceWorker registered successfully:', reg.scope);
        })
        .catch((err) => {
          console.warn('DocuMerge ServiceWorker registration skipped/failed:', err);
        });
    });
  }

  // Handle PWA Install Prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    els.btnInstallPwa.classList.remove('hidden');
  });

  els.btnInstallPwa.addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('DocuMerge is installing to your device!', 'success');
      els.btnInstallPwa.classList.add('hidden');
    }
    state.deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    els.btnInstallPwa.classList.add('hidden');
    showToast('App installed successfully! Ready for offline use.', 'success');
  });

  // Track online/offline status
  const updateNetworkStatus = () => {
    if (navigator.onLine) {
      els.offlineStatusPill.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-label">100% Offline & Private</span>
      `;
    } else {
      els.offlineStatusPill.innerHTML = `
        <span class="status-dot" style="background:#e06d53;box-shadow:0 0 8px #e06d53"></span>
        <span class="status-label">Offline Mode Active</span>
      `;
    }
  };

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();
}

/* ==========================================================================
   File Handling & Upload Pipeline
   ========================================================================== */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  showProgressModal('Loading & Parsing Files...', 'Reading document structure locally...', 15);

  let addedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pct = Math.round(15 + ((i + 1) / files.length) * 75);
    updateProgress(pct, `Processing "${file.name}"...`);

    try {
      const doc = await parseDocumentFile(file, (p) => {
        if (p?.message) updateProgress(pct, p.message);
      });
      state.documents.push(doc);
      addedCount++;
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to process ${file.name}`, 'danger');
    }
  }

  hideProgressModal();

  if (addedCount > 0) {
    showToast(`Added ${addedCount} document${addedCount > 1 ? 's' : ''}`, 'success');
    renderWorkspace();
  }
}

/* ==========================================================================
   Sample Document Generation (Instant Demo)
   ========================================================================== */
async function loadSampleFiles() {
  showProgressModal('Generating Sample Files...', 'Creating styled test documents with Floral White theme...', 20);
  try {
    const sampleFiles = await generateSampleDocuments();
    for (let i = 0; i < sampleFiles.length; i++) {
      const sample = sampleFiles[i];
      updateProgress(40 + i * 35, `Embedding ${sample.name}...`);
      const file = new File([sample.bytes], sample.name, { type: 'application/pdf' });
      const doc = await parseDocumentFile(file);
      state.documents.push(doc);
    }
    updateProgress(100, 'Samples ready!');
    setTimeout(() => {
      hideProgressModal();
      showToast('Loaded 2 sample documents! You can now rearrange or merge them.', 'success');
      renderWorkspace();
    }, 300);
  } catch (err) {
    console.error(err);
    hideProgressModal();
    showToast('Failed to generate sample documents', 'danger');
  }
}

/* ==========================================================================
   Workspace Rendering
   ========================================================================== */
function renderWorkspace() {
  const hasDocs = state.documents.length > 0;
  els.workspaceSection.classList.toggle('hidden', !hasDocs);
  document.body.classList.toggle('has-documents', hasDocs);

  if (!hasDocs) {
    els.docCountBadge.textContent = '0';
    els.pageCountBadge.textContent = '0';
    return;
  }

  // Calculate totals
  const totalDocs = state.documents.length;
  let totalPages = 0;
  state.documents.forEach(d => {
    totalPages += d.pageCount;
  });

  els.docCountBadge.textContent = totalDocs;
  els.pageCountBadge.textContent = totalPages;
  els.mergeSummaryText.textContent = `${totalDocs} document${totalDocs > 1 ? 's' : ''} • ${totalPages} total pages`;

  if (state.activeView === 'docListView') {
    renderDocumentList();
  } else {
    renderPageGrid();
  }
}

/* ==========================================================================
   Document View (Mode A: Document Level Cards)
   ========================================================================== */
function renderDocumentList() {
  els.documentList.innerHTML = '';

  state.documents.forEach((doc, idx) => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.draggable = true;
    card.dataset.index = idx;

    // Up/down disabled states
    const isFirst = idx === 0;
    const isLast = idx === state.documents.length - 1;

    card.innerHTML = `
      <!-- Reorder Controls (Touch Friendly Arrow Buttons + Drag Handle) -->
      <div class="doc-reorder-controls">
        <button class="reorder-btn btn-move-up" ${isFirst ? 'disabled' : ''} title="Move Up" aria-label="Move Up">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
        </button>
        <div class="drag-handle" title="Drag to reorder" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
          </svg>
        </div>
        <button class="reorder-btn btn-move-down" ${isLast ? 'disabled' : ''} title="Move Down" aria-label="Move Down">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
      </div>

      <!-- Thumbnail Preview -->
      <div class="doc-thumb-preview">
        ${doc.thumbnail 
          ? `<img src="${doc.thumbnail}" alt="Preview of ${doc.name}" style="transform: rotate(${doc.docRotation || 0}deg)" />` 
          : `<div class="doc-thumb-fallback"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg></div>`}
      </div>

      <!-- Document Information -->
      <div class="doc-info">
        <div class="doc-title-row">
          <span class="doc-filename" title="${doc.name}">${doc.name}</span>
        </div>
        <div class="doc-meta-row">
          <span class="format-tag format-${(doc.formatType || 'pdf').toLowerCase()}">${doc.formatType || 'PDF'}</span>
          <span class="meta-pill font-mono">${doc.pageCount} ${doc.pageCount === 1 ? 'Page' : 'Pages'}</span>
          <span class="meta-pill">${formatBytes(doc.size)}</span>
          ${doc.docRotation ? `<span class="meta-pill text-accent">Rotated ${doc.docRotation}°</span>` : ''}
          ${doc.isImage ? `<span class="meta-pill" style="color:var(--color-accent-gold)">Auto-Converted</span>` : ''}
          ${doc.isDocx ? `<span class="meta-pill" style="color:#60a5fa">Word Converted</span>` : ''}
          ${doc.isPptx ? `<span class="meta-pill" style="color:#fdba74">Slides Converted</span>` : ''}
        </div>
      </div>

      <!-- Page Range Selector Input -->
      <div class="doc-page-range-wrapper">
        <label class="page-range-label" for="range_${doc.id}">Pages (e.g. 1-3, 5):</label>
        <input type="text" id="range_${doc.id}" class="page-range-input" value="${doc.pageRangeInput || 'all'}" placeholder="all or 1-3, 5" />
      </div>

      <!-- Document Actions -->
      <div class="doc-actions">
        <button class="action-icon-btn btn-rotate-doc" title="Rotate document 90° clockwise" aria-label="Rotate 90 degrees">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button class="action-icon-btn btn-duplicate-doc" title="Duplicate document" aria-label="Duplicate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="action-icon-btn danger btn-delete-doc" title="Remove document" aria-label="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;

    // Attach Event Listeners
    const btnUp = card.querySelector('.btn-move-up');
    const btnDown = card.querySelector('.btn-move-down');
    const rangeInput = card.querySelector('.page-range-input');
    const btnRotate = card.querySelector('.btn-rotate-doc');
    const btnDuplicate = card.querySelector('.btn-duplicate-doc');
    const btnDelete = card.querySelector('.btn-delete-doc');

    btnUp.addEventListener('click', () => moveDocument(idx, -1));
    btnDown.addEventListener('click', () => moveDocument(idx, 1));
    
    rangeInput.addEventListener('change', (e) => {
      doc.pageRangeInput = e.target.value.trim() || 'all';
      renderWorkspace();
    });

    btnRotate.addEventListener('click', () => {
      doc.docRotation = ((doc.docRotation || 0) + 90) % 360;
      showToast(`Rotated "${doc.name}" to ${doc.docRotation}°`);
      renderWorkspace();
    });

    btnDuplicate.addEventListener('click', () => {
      duplicateDocument(idx);
    });

    btnDelete.addEventListener('click', () => {
      removeDocument(idx);
    });

    // Drag and Drop (Desktop)
    card.addEventListener('dragstart', (e) => {
      state.draggedDocIndex = idx;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.doc-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      state.draggedDocIndex = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (state.draggedDocIndex === null || state.draggedDocIndex === idx) return;

      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < mid) {
        card.classList.add('drag-over-top');
      } else {
        card.classList.add('drag-over-bottom');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = state.draggedDocIndex;
      if (fromIdx === null || fromIdx === idx) return;

      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const targetIdx = e.clientY < mid ? idx : idx + 1;

      const [movedDoc] = state.documents.splice(fromIdx, 1);
      const insertAt = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
      state.documents.splice(insertAt, 0, movedDoc);

      renderWorkspace();
    });

    els.documentList.appendChild(card);
  });
}

function moveDocument(index, delta) {
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= state.documents.length) return;
  const temp = state.documents[index];
  state.documents[index] = state.documents[targetIndex];
  state.documents[targetIndex] = temp;
  renderWorkspace();
}

function duplicateDocument(index) {
  const original = state.documents[index];
  const copy = {
    ...original,
    id: 'doc_' + Math.random().toString(36).substring(2, 11),
    name: original.name.replace(/(\.[^.]+)$/, ' (Copy)$1'),
    pages: original.pages.map(p => ({ ...p }))
  };
  state.documents.splice(index + 1, 0, copy);
  showToast(`Duplicated "${original.name}"`);
  renderWorkspace();
}

function removeDocument(index) {
  const removed = state.documents.splice(index, 1)[0];
  showToast(`Removed "${removed.name}"`);
  renderWorkspace();
}

/* ==========================================================================
   Visual Page Grid View (Mode B: Page-Level Organizer)
   ========================================================================== */
function getFlattenedPages() {
  const flat = [];
  state.documents.forEach((doc) => {
    doc.pages.forEach((page) => {
      if (page.included !== false) {
        flat.push({
          docId: doc.id,
          docName: doc.name,
          docPdfBytes: doc.pdfBytes,
          pageIndex: page.pageIndex,
          pageNumber: page.pageNumber,
          rotation: ((doc.docRotation || 0) + (page.rotation || 0)) % 360,
          thumbnail: page.thumbnail,
          originalDoc: doc,
          originalPage: page
        });
      }
    });
  });
  return flat;
}

async function renderPageGrid() {
  els.pagesGrid.innerHTML = '';
  const flatPages = getFlattenedPages();

  if (flatPages.length === 0) {
    els.pagesGrid.innerHTML = `<div class="doc-list-instructions">No active pages to display.</div>`;
    return;
  }

  // Set card size
  els.pagesGrid.className = `pages-grid size-${state.pageSize}`;

  flatPages.forEach((item, flatIdx) => {
    const card = document.createElement('div');
    card.className = 'page-grid-item';
    card.draggable = true;
    card.dataset.flatIndex = flatIdx;

    card.innerHTML = `
      <div class="page-canvas-container">
        <span class="page-source-pill" title="${item.docName}">${item.docName}</span>
        ${item.thumbnail 
          ? `<img class="page-img" src="${item.thumbnail}" alt="Page ${item.pageNumber}" style="transform: rotate(${item.rotation || 0}deg)" />` 
          : `<div class="page-skeleton-loader"><div class="mini-spinner"></div></div>`}
      </div>
      <div class="page-card-footer">
        <span class="page-number-tag">P. ${item.pageNumber}</span>
        <div class="page-item-actions">
          <button class="page-btn btn-rotate-page" title="Rotate page 90°" aria-label="Rotate page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
          <button class="page-btn delete-btn btn-delete-page" title="Omit page from merge" aria-label="Delete page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
    `;

    // Lazy load thumbnail if not yet cached
    if (!item.thumbnail) {
      renderPageThumbnail(item.docPdfBytes, item.pageIndex + 1, 260).then(thumb => {
        if (thumb) {
          item.originalPage.thumbnail = thumb;
          item.thumbnail = thumb;
          const container = card.querySelector('.page-canvas-container');
          if (container) {
            const loader = container.querySelector('.page-skeleton-loader');
            if (loader) loader.remove();
            if (!container.querySelector('.page-img')) {
              const img = document.createElement('img');
              img.className = 'page-img';
              img.src = thumb;
              img.alt = `Page ${item.pageNumber}`;
              img.style.transform = `rotate(${item.rotation || 0}deg)`;
              container.appendChild(img);
            }
          }
        }
      });
    }

    // Rotate page
    const btnRotate = card.querySelector('.btn-rotate-page');
    btnRotate.addEventListener('click', (e) => {
      e.stopPropagation();
      item.originalPage.rotation = ((item.originalPage.rotation || 0) + 90) % 360;
      renderPageGrid();
    });

    // Delete / Omit page
    const btnDelete = card.querySelector('.btn-delete-page');
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      item.originalPage.included = false;
      showToast(`Omitted page ${item.pageNumber} of "${item.docName}"`);
      renderWorkspace();
    });

    // Drag and drop for page-level reordering
    card.addEventListener('dragstart', (e) => {
      state.draggedPageFlatIndex = flatIdx;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.page-grid-item').forEach(c => c.classList.remove('drag-over'));
      state.draggedPageFlatIndex = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (state.draggedPageFlatIndex === null || state.draggedPageFlatIndex === flatIdx) return;
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromIdx = state.draggedPageFlatIndex;
      if (fromIdx === null || fromIdx === flatIdx) return;

      // Swap or rearrange pages in flat list
      handlePageReorder(fromIdx, flatIdx);
    });

    els.pagesGrid.appendChild(card);
  });
}

function handlePageReorder(fromFlatIdx, toFlatIdx) {
  // If user is rearranging individual pages across docs,
  // we rebuild the internal document representation or handle custom merge sequence
  const flat = getFlattenedPages();
  const [moved] = flat.splice(fromFlatIdx, 1);
  flat.splice(toFlatIdx, 0, moved);

  // Store custom page sequence
  state.customPageSequence = flat;
  showToast('Reordered page sequence', 'info');
  renderPageGrid();
}

/* ==========================================================================
   Merge Execution Pipeline
   ========================================================================== */
async function executeMerge() {
  if (state.documents.length === 0) {
    showToast('Please add at least one document or image to merge.', 'warning');
    return;
  }

  showProgressModal('Merging Documents...', 'Assembling pages in memory...', 10);

  try {
    let result;
    const flatPages = state.customPageSequence || getFlattenedPages();
    const options = {
      addPageNumbers: document.getElementById('chkPageNumbers')?.checked || false,
      watermarkText: document.getElementById('inputWatermark')?.value || ''
    };

    if (state.activeView === 'pageGridView' && state.customPageSequence) {
      result = await mergePagesGrid(flatPages, options, (progress) => {
        updateProgress(progress.percent, progress.message);
      });
    } else {
      result = await mergeDocuments(state.documents, options, (progress) => {
        updateProgress(progress.percent, progress.message);
      });
    }

    // Create Blob
    const blob = new Blob([result.pdfBytes], { type: 'application/pdf' });
    if (state.mergedPdfUrl) {
      URL.revokeObjectURL(state.mergedPdfUrl);
    }
    state.mergedPdfBlob = blob;
    state.mergedPdfUrl = URL.createObjectURL(blob);

    // Get filename
    let outName = els.outputFilename.value.trim() || 'Merged_Document.pdf';
    if (!outName.toLowerCase().endsWith('.pdf')) {
      outName += '.pdf';
    }

    setTimeout(() => {
      hideProgressModal();
      showResultModal({
        filename: outName,
        totalPages: result.totalPages,
        size: result.size
      });
    }, 400);

  } catch (err) {
    console.error('Merge error:', err);
    hideProgressModal();
    showToast(err.message || 'Error occurred while merging documents.', 'danger');
  }
}

/* ==========================================================================
   Modals Management
   ========================================================================== */
function showProgressModal(title, message, percent = 10) {
  document.getElementById('progressTitle').textContent = title;
  els.progressMessage.textContent = message;
  els.progressBar.style.width = `${percent}%`;
  els.progressPercent.textContent = `${percent}%`;
  els.progressModal.classList.remove('hidden');
}

function updateProgress(percent, message) {
  els.progressBar.style.width = `${percent}%`;
  els.progressPercent.textContent = `${percent}%`;
  if (message) els.progressMessage.textContent = message;
}

function hideProgressModal() {
  els.progressModal.classList.add('hidden');
}

function showResultModal(info) {
  els.resultFilename.textContent = info.filename;
  els.resultPageCount.textContent = `${info.totalPages} ${info.totalPages === 1 ? 'Page' : 'Pages'}`;
  els.resultFileSize.textContent = formatBytes(info.size);

  // Check Web Share API (mobile phones)
  if (navigator.share && navigator.canShare) {
    els.btnShareResult.classList.remove('hidden');
  } else {
    els.btnShareResult.classList.add('hidden');
  }

  els.resultModal.classList.remove('hidden');
}

function hideResultModal() {
  els.resultModal.classList.add('hidden');
}

/* ==========================================================================
   Downloads & Sharing
   ========================================================================== */
function triggerDownload() {
  if (!state.mergedPdfBlob) return;
  const filename = els.resultFilename.textContent || 'Merged_Document.pdf';
  const a = document.createElement('a');
  a.href = state.mergedPdfUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Download started!', 'success');
}

function previewInTab() {
  if (!state.mergedPdfUrl) return;
  window.open(state.mergedPdfUrl, '_blank');
}

async function shareResult() {
  if (!state.mergedPdfBlob || !navigator.share) return;
  const filename = els.resultFilename.textContent || 'Merged_Document.pdf';
  const file = new File([state.mergedPdfBlob], filename, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
        text: 'Merged PDF Document generated offline with DocuMerge Studio'
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Share error:', err);
      }
    }
  }
}

/* ==========================================================================
   Event Listeners Initialization
   ========================================================================== */
function initEvents() {
  // Dropzone drag & drop
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });

  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
  });

  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  });

  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      els.fileInput.value = ''; // Reset so same file can be re-selected
    }
  });

  // Add more files button
  els.btnAddMore.addEventListener('click', () => els.fileInput.click());

  // Demo sample files (optional)
  els.btnTrySample?.addEventListener('click', loadSampleFiles);

  // Tabs
  els.tabDocView.addEventListener('click', () => {
    state.activeView = 'docListView';
    els.tabDocView.classList.add('active');
    els.tabDocView.setAttribute('aria-selected', 'true');
    els.tabPageView.classList.remove('active');
    els.tabPageView.setAttribute('aria-selected', 'false');
    els.docListView.classList.add('active');
    els.pageGridView.classList.remove('active');
    renderWorkspace();
  });

  els.tabPageView.addEventListener('click', () => {
    state.activeView = 'pageGridView';
    els.tabPageView.classList.add('active');
    els.tabPageView.setAttribute('aria-selected', 'true');
    els.tabDocView.classList.remove('active');
    els.tabDocView.setAttribute('aria-selected', 'false');
    els.pageGridView.classList.add('active');
    els.docListView.classList.remove('active');
    renderWorkspace();
  });

  // Rotate all
  els.btnRotateAll.addEventListener('click', () => {
    state.documents.forEach(doc => {
      doc.docRotation = ((doc.docRotation || 0) + 90) % 360;
    });
    showToast('Rotated all documents 90° clockwise');
    renderWorkspace();
  });

  // Clear all
  els.btnClearAll.addEventListener('click', () => {
    if (confirm('Clear all uploaded documents?')) {
      state.documents = [];
      state.customPageSequence = null;
      showToast('Workspace cleared');
      renderWorkspace();
    }
  });

  // Grid Zoom buttons
  document.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.pageSize = e.target.dataset.size;
      els.pagesGrid.className = `pages-grid size-${state.pageSize}`;
    });
  });

  // Theme toggle
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const themeLabel = document.getElementById('themeLabel');
  
  // Restore saved theme
  const savedTheme = localStorage.getItem('documerge_theme');
  if (savedTheme === 'light') {
    document.body.classList.add('theme-light');
    if (themeLabel) themeLabel.textContent = 'Dark Mode';
  }

  btnThemeToggle?.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('theme-light');
    localStorage.setItem('documerge_theme', isLight ? 'light' : 'dark');
    if (themeLabel) themeLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';
    showToast(isLight ? 'Floral Light mode enabled' : 'Black Olive dark mode enabled');
  });

  // Merge execution
  els.btnMerge.addEventListener('click', executeMerge);

  // Result actions
  els.btnDownloadResult.addEventListener('click', triggerDownload);
  els.btnPreviewResult.addEventListener('click', previewInTab);
  els.btnShareResult.addEventListener('click', shareResult);
  els.btnCloseResult.addEventListener('click', hideResultModal);
  els.resultModal.addEventListener('click', (e) => {
    if (e.target === els.resultModal) hideResultModal();
  });

  // Prevent background scroll when modal open
  const observer = new MutationObserver(() => {
    const isModalOpen = !els.progressModal.classList.contains('hidden') || !els.resultModal.classList.contains('hidden');
    document.body.style.overflow = isModalOpen ? 'hidden' : '';
  });
  observer.observe(els.progressModal, { attributes: true, attributeFilter: ['class'] });
  observer.observe(els.resultModal, { attributes: true, attributeFilter: ['class'] });
}

/* ==========================================================================
   Boot Application
   ========================================================================== */
initPwa();
initEvents();
renderWorkspace();
