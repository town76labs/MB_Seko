import { analyzeGuidedFrames } from './video-analysis-core.js?v=image-scan-1';

const VIEW_LABELS = {
  front: 'Ön',
  right: 'Sağ',
  top: 'Üst',
  back: 'Arka',
  left: 'Sol',
};

const VIEW_ORDER = Object.keys(VIEW_LABELS);
const ORIENTATION_LABELS = {
  floor: 'Yatay',
  front: 'Ön/Dikey',
  side: 'Yan/Dikey',
};
const MAX_IMAGES = VIEW_ORDER.length;
const MAX_IMAGE_EDGE = 960;

export function createImageScanner({ blockTypes, colors, onApply }) {
  const dom = collectDom();
  const state = {
    items: [],
    result: null,
    busy: false,
  };

  bindEvents();
  resetSession();

  return { open, close, destroy };

  function bindEvents() {
    dom.openButton.addEventListener('click', open);
    dom.closeButton.addEventListener('click', close);
    dom.cancelButton.addEventListener('click', close);
    dom.modal.addEventListener('click', (event) => {
      if (event.target === dom.modal && !state.busy) close();
    });
    dom.fileInput.addEventListener('change', () => addFiles([...dom.fileInput.files]));
    dom.addButton.addEventListener('click', () => dom.fileInput.click());
    dom.clearButton.addEventListener('click', resetSession);
    dom.dropzone.addEventListener('dragenter', onDragEnter);
    dom.dropzone.addEventListener('dragover', onDragEnter);
    dom.dropzone.addEventListener('dragleave', onDragLeave);
    dom.dropzone.addEventListener('drop', onDrop);
    dom.imageGrid.addEventListener('change', onImageGridChange);
    dom.imageGrid.addEventListener('click', onImageGridClick);
    dom.tolerance.addEventListener('input', () => {
      dom.toleranceValue.value = `${dom.tolerance.value}%`;
    });
    dom.analyzeButton.addEventListener('click', analyze);
    dom.applyButton.addEventListener('click', applyResult);
    dom.resultRows.addEventListener('change', onResultChange);
    dom.resultRows.addEventListener('click', onResultClick);
    window.addEventListener('keydown', onKeyDown);
  }

  function open() {
    dom.modal.classList.add('open');
    dom.modal.setAttribute('aria-hidden', 'false');
    if (!state.items.length) dom.fileInput.focus();
  }

  function close() {
    if (state.busy) return;
    dom.modal.classList.remove('open');
    dom.modal.setAttribute('aria-hidden', 'true');
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && dom.modal.classList.contains('open') && !state.busy) close();
  }

  function onDragEnter(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dom.dropzone.classList.add('dragging');
  }

  function onDragLeave(event) {
    if (!dom.dropzone.contains(event.relatedTarget)) dom.dropzone.classList.remove('dragging');
  }

  function onDrop(event) {
    event.preventDefault();
    dom.dropzone.classList.remove('dragging');
    addFiles([...event.dataTransfer.files]);
  }

  async function addFiles(files) {
    const imageFiles = files.filter(isImageFile);
    dom.fileInput.value = '';
    if (!imageFiles.length) {
      setProgress(0, 'Seçilen dosyalarda açılabilir bir görsel yok', 'error');
      return;
    }

    const freeSlots = MAX_IMAGES - state.items.length;
    if (freeSlots <= 0) {
      setProgress(10, 'En fazla 5 görünüş eklenebilir', 'error');
      return;
    }

    setBusy(true);
    setProgress(8, 'Görseller hazırlanıyor…');
    try {
      const decoded = await Promise.all(imageFiles.slice(0, freeSlots).map(async (file) => ({
        file,
        imageData: await imageDataFromFile(file),
      })));
      const usedViews = new Set(state.items.map((item) => item.view));
      decoded.forEach((item) => {
        item.view = VIEW_ORDER.find((view) => !usedViews.has(view)) || 'front';
        usedViews.add(item.view);
        state.items.push(item);
      });
      clearResult();
      renderImages();
      const skipped = imageFiles.length - decoded.length;
      setProgress(15, skipped
        ? `${decoded.length} görsel eklendi; ${skipped} görsel 5 görünüş sınırı nedeniyle atlandı`
        : `${state.items.length} görünüş hazır; açıları kontrol edip analizi başlatın`, skipped ? 'error' : 'good');
    } catch (error) {
      setProgress(0, `Görsel açılamadı: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function onImageGridChange(event) {
    const select = event.target.closest('[data-image-view]');
    if (!select) return;
    const index = Number(select.dataset.imageView);
    const item = state.items[index];
    if (!item || !VIEW_ORDER.includes(select.value)) return;
    const previousView = item.view;
    const duplicate = state.items.find((candidate, candidateIndex) => (
      candidateIndex !== index && candidate.view === select.value
    ));
    item.view = select.value;
    if (duplicate) duplicate.view = previousView;
    clearResult();
    renderImages();
    setProgress(15, 'Görünüş açıları güncellendi; yeniden analiz edin');
  }

  function onImageGridClick(event) {
    const button = event.target.closest('[data-remove-image]');
    if (!button || state.busy) return;
    state.items.splice(Number(button.dataset.removeImage), 1);
    clearResult();
    renderImages();
    setProgress(state.items.length ? 15 : 0, state.items.length
      ? `${state.items.length} görünüş hazır`
      : 'Görsel bekleniyor');
  }

  async function analyze() {
    if (!state.items.length || state.busy) return;
    setBusy(true);
    clearResult();
    setProgress(38, 'Renk alanları ve blok geometrileri analiz ediliyor…');
    await nextPaint();

    try {
      const frames = state.items.map((item) => ({ view: item.view, imageData: item.imageData }));
      state.result = analyzeGuidedFrames(frames, blockTypes, colors, {
        colorTolerance: numericValue(dom.tolerance, 26) / 100,
        minComponentPixels: Math.max(12, numericValue(dom.minRegion, 42)),
        pixelsPerUnit: Math.max(0, numericValue(dom.pixelsPerUnit, 0)),
        snap: 0.5,
      });
      if (state.items.length === 1) {
        state.result.warnings.unshift('Tek fotoğraf yalnızca seçilen görünüşü kesinleştirir; görünmeyen derinlik 0 kabul edilir.');
      }
      renderImages();
      renderResults();
      renderWarnings();
      const count = state.result.blocks.length;
      setProgress(100, count
        ? `${count} blok bulundu; sonucu kontrol edip sahneye aktarın`
        : 'Blok bulunamadı; görünüş açısını, ışığı veya renk toleransını değiştirin', count ? 'good' : 'error');
    } catch (error) {
      state.result = null;
      setProgress(0, `Analiz tamamlanamadı: ${error.message}`, 'error');
    } finally {
      setBusy(false);
      updateButtons();
    }
  }

  function renderImages() {
    dom.dropzone.hidden = Boolean(state.items.length);
    dom.workspace.hidden = !state.items.length;
    dom.imageGrid.replaceChildren();
    state.items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'image-source-card';
      card.innerHTML = `
        <canvas aria-label="${escapeHtml(item.file.name)} önizlemesi"></canvas>
        <div class="image-source-meta">
          <div><strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong><small>${item.imageData.width}×${item.imageData.height}</small></div>
          <label>Görünüş
            <select data-image-view="${index}" aria-label="${escapeHtml(item.file.name)} görünüşü">
              ${VIEW_ORDER.map((view) => `<option value="${view}"${item.view === view ? ' selected' : ''}>${VIEW_LABELS[view]}</option>`).join('')}
            </select>
          </label>
          <button class="icon image-remove" type="button" data-remove-image="${index}" aria-label="Görseli kaldır">×</button>
        </div>`;
      dom.imageGrid.appendChild(card);
      drawImageCard(card.querySelector('canvas'), item, state.result?.frames?.[item.view]);
    });
    dom.imageCount.textContent = `${state.items.length}/${MAX_IMAGES} görünüş`;
    updateButtons();
  }

  function drawImageCard(canvas, item, analysis) {
    canvas.width = item.imageData.width;
    canvas.height = item.imageData.height;
    const context = canvas.getContext('2d');
    context.putImageData(item.imageData, 0, 0);
    if (!analysis) return;
    context.lineWidth = Math.max(2, canvas.width / 320);
    context.font = `700 ${Math.max(11, canvas.width / 48)}px ui-sans-serif, system-ui`;
    analysis.regions.forEach((region) => {
      const { x, y, width, height } = region.bbox;
      const color = region.faceLike ? '#6BE38A' : '#F3C84B';
      context.strokeStyle = color;
      context.fillStyle = 'rgba(8, 12, 16, 0.82)';
      context.strokeRect(x, y, width, height);
      const label = region.typeId || 'kenar';
      const labelWidth = context.measureText(label).width + 9;
      context.fillRect(x, Math.max(0, y - 20), labelWidth, 19);
      context.fillStyle = color;
      context.fillText(label, x + 4, Math.max(13, y - 5));
    });
  }

  function renderResults() {
    const blocks = state.result?.blocks || [];
    dom.resultsPanel.hidden = !state.result;
    dom.resultRows.replaceChildren();
    const lowConfidence = blocks.filter((block) => block.confidence < 0.62).length;
    dom.resultSummary.textContent = blocks.length
      ? `${blocks.length} blok · ${lowConfidence} kontrol gerekli · ölçek ${state.result.pixelsPerUnit.toFixed(1)} px/birim`
      : 'Eşleşen blok bulunamadı';

    blocks.forEach((block, index) => {
      const row = document.createElement('tr');
      row.dataset.imageResultIndex = String(index);
      row.classList.toggle('low-confidence', block.confidence < 0.62);
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><select data-result-field="typeId">${blockTypeOptions(block.typeId)}</select></td>
        <td><input data-result-field="color" type="color" value="${normalizeHex(block.color)}" aria-label="Renk" /></td>
        <td><select data-result-field="orientation">${orientationOptions(block.orientation)}</select></td>
        <td><input data-result-field="position.x" type="number" step="0.5" value="${numberText(block.position.x)}" aria-label="X" /></td>
        <td><input data-result-field="position.y" type="number" step="0.5" value="${numberText(block.position.y)}" aria-label="Y" /></td>
        <td><input data-result-field="position.z" type="number" step="0.5" value="${numberText(block.position.z)}" aria-label="Z" /></td>
        <td><span class="confidence-value"><span class="confidence-dot ${confidenceClass(block.confidence)}"></span>${Math.round(block.confidence * 100)}%</span></td>
        <td><button class="video-row-delete" type="button" data-delete-image-result="${index}" aria-label="Algılanan bloğu sil">×</button></td>`;
      dom.resultRows.appendChild(row);
    });
    updateButtons();
  }

  function renderWarnings() {
    dom.warnings.replaceChildren();
    (state.result?.warnings || []).forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      dom.warnings.appendChild(item);
    });
  }

  function onResultChange(event) {
    const input = event.target.closest('[data-result-field]');
    const row = event.target.closest('[data-image-result-index]');
    if (!input || !row || !state.result) return;
    const block = state.result.blocks[Number(row.dataset.imageResultIndex)];
    if (!block) return;
    const field = input.dataset.resultField;
    if (field.startsWith('position.')) {
      block.position[field.split('.')[1]] = numericValue(input, 0);
    } else {
      block[field] = input.value;
    }
  }

  function onResultClick(event) {
    const button = event.target.closest('[data-delete-image-result]');
    if (!button || !state.result) return;
    state.result.blocks.splice(Number(button.dataset.deleteImageResult), 1);
    state.result.blocks.forEach((block, index) => { block.stepNumber = index + 1; });
    renderResults();
  }

  function applyResult() {
    const blocks = state.result?.blocks || [];
    if (!blocks.length) return;
    const validTypeIds = new Set(blockTypes.map((type) => type.id));
    const invalid = blocks.find((block) => (
      !validTypeIds.has(block.typeId)
      || !Object.hasOwn(ORIENTATION_LABELS, block.orientation)
      || ['x', 'y', 'z'].some((axis) => !Number.isFinite(Number(block.position?.[axis])))
    ));
    if (invalid) {
      setProgress(100, 'Sonuç tablosunda geçersiz tip, yön veya koordinat var', 'error');
      return;
    }

    onApply(blocks.map((block, index) => ({
      typeId: block.typeId,
      color: block.color,
      orientation: block.orientation,
      position: { ...block.position },
      rotation: { ...(block.rotation || { x: 0, y: 0, z: 0 }) },
      stepNumber: index + 1,
      confidence: block.confidence,
    })), {
      source: 'image',
      pixelsPerUnit: state.result.pixelsPerUnit,
      warnings: state.result.warnings,
      fileName: state.items[0]?.file.name || '',
      imageCount: state.items.length,
    });
    close();
  }

  function clearResult() {
    state.result = null;
    dom.resultsPanel.hidden = true;
    dom.resultRows.replaceChildren();
    dom.warnings.replaceChildren();
    updateButtons();
  }

  function resetSession() {
    state.items = [];
    state.result = null;
    dom.fileInput.value = '';
    dom.imageGrid.replaceChildren();
    dom.resultsPanel.hidden = true;
    dom.warnings.replaceChildren();
    dom.imageCount.textContent = `0/${MAX_IMAGES} görünüş`;
    dom.dropzone.hidden = false;
    dom.workspace.hidden = true;
    setProgress(0, 'Görsel bekleniyor');
    updateButtons();
  }

  function setProgress(value, text, kind = 'normal') {
    const progress = Math.max(0, Math.min(100, Math.round(value)));
    dom.progressBar.style.width = `${progress}%`;
    dom.progressText.textContent = `${progress}%`;
    dom.status.textContent = text;
    dom.status.style.color = kind === 'error' ? 'var(--danger)' : kind === 'good' ? 'var(--ok)' : '';
  }

  function setBusy(value) {
    state.busy = value;
    updateButtons();
  }

  function updateButtons() {
    dom.analyzeButton.disabled = state.busy || !state.items.length;
    dom.applyButton.disabled = state.busy || !(state.result?.blocks.length);
    dom.addButton.disabled = state.busy || state.items.length >= MAX_IMAGES;
    dom.clearButton.disabled = state.busy || !state.items.length;
    dom.closeButton.disabled = state.busy;
    dom.cancelButton.disabled = state.busy;
    dom.imageGrid.querySelectorAll('button, select').forEach((control) => { control.disabled = state.busy; });
  }

  function blockTypeOptions(selectedId) {
    return blockTypes.map((type) => (
      `<option value="${type.id}"${type.id === selectedId ? ' selected' : ''}>${escapeHtml(type.label)}</option>`
    )).join('');
  }
}

function collectDom() {
  const ids = {
    openButton: 'imageScanBtn',
    modal: 'imageScanModal',
    closeButton: 'closeImageScanBtn',
    cancelButton: 'cancelImageScanBtn',
    fileInput: 'imageFileInput',
    dropzone: 'imageDropzone',
    workspace: 'imageWorkspace',
    imageGrid: 'imagePreviewGrid',
    imageCount: 'imageCountLabel',
    addButton: 'addImagesBtn',
    clearButton: 'clearImagesBtn',
    tolerance: 'imageColorTolerance',
    toleranceValue: 'imageColorToleranceValue',
    minRegion: 'imageMinRegion',
    pixelsPerUnit: 'imagePixelsPerUnit',
    status: 'imageScanStatus',
    progressText: 'imageScanProgressText',
    progressBar: 'imageScanProgressBar',
    warnings: 'imageScanWarnings',
    resultsPanel: 'imageResultsPanel',
    resultSummary: 'imageResultSummary',
    resultRows: 'imageResultRows',
    analyzeButton: 'analyzeImageBtn',
    applyButton: 'applyImageResultBtn',
  };
  const result = {};
  for (const [key, id] of Object.entries(ids)) {
    result[key] = document.getElementById(id);
    if (!result[key]) throw new Error(`Görsel tarayıcı elementi bulunamadı: #${id}`);
  }
  return result;
}

async function imageDataFromFile(file) {
  let source;
  let release = () => {};
  if ('createImageBitmap' in window) {
    source = await createImageBitmap(file);
    release = () => source.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Tarayıcı bu görsel biçimini açamadı'));
      image.src = objectUrl;
    });
    release = () => URL.revokeObjectURL(objectUrl);
  }

  try {
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    release();
  }
}

function orientationOptions(selected) {
  return Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
    `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
  )).join('');
}

function confidenceClass(confidence) {
  if (confidence >= 0.78) return 'high';
  if (confidence >= 0.62) return 'medium';
  return '';
}

function isImageFile(file) {
  return Boolean(file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)));
}

function numericValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeHex(value) {
  const text = String(value || '#2196F3');
  return /^#[0-9a-f]{6}$/i.test(text) ? text : '#2196F3';
}

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 1000) / 1000) : '0';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
