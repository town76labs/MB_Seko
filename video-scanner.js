import { analyzeGuidedFrames } from './video-analysis-core.js?v=video-scan-2';
import {
  analyzeBuildFrames,
  detectStableSegments,
  makeFrameSignature,
} from './video-temporal-core.js?v=video-scan-2';

const VIEW_LABELS = {
  front: 'Ön',
  right: 'Sağ',
  back: 'Arka',
  left: 'Sol',
  top: 'Üst',
};

const VIEW_ORDER = Object.keys(VIEW_LABELS);
const MAX_FRAME_EDGE = 720;
const MOTION_FRAME_EDGE = 240;
const MAX_MOTION_SAMPLES = 240;
const MAX_KEYFRAMES = 90;

export function createVideoScanner({ blockTypes, colors, onApply }) {
  const dom = collectDom();
  const state = {
    mode: 'build',
    file: null,
    objectUrl: null,
    captures: new Map(),
    result: null,
    selectedOverlayView: null,
    busy: false,
    measuringScale: false,
    scalePoints: [],
    abortRequested: false,
    selectedEventIndex: -1,
  };

  bindEvents();
  resetSession();

  return {
    open,
    close,
    destroy,
  };

  function bindEvents() {
    dom.openButton.addEventListener('click', open);
    dom.closeButton.addEventListener('click', close);
    dom.cancelButton.addEventListener('click', close);
    dom.modal.addEventListener('click', (event) => {
      if (event.target === dom.modal && !state.busy) close();
    });
    dom.fileInput.addEventListener('change', () => loadFile(dom.fileInput.files?.[0]));
    dom.dropzone.addEventListener('dragenter', onDragEnter);
    dom.dropzone.addEventListener('dragover', onDragEnter);
    dom.dropzone.addEventListener('dragleave', onDragLeave);
    dom.dropzone.addEventListener('drop', onDrop);
    dom.mode.addEventListener('click', (event) => {
      const button = event.target.closest('[data-video-scan-mode]');
      if (button) setMode(button.dataset.videoScanMode);
    });
    dom.captureGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-capture-view]');
      if (button) captureCurrentFrame(button.dataset.captureView);
    });
    dom.autoCapture.addEventListener('click', autoCaptureViews);
    dom.replaceVideo.addEventListener('click', () => dom.fileInput.click());
    dom.clearCaptures.addEventListener('click', clearCaptures);
    dom.analyze.addEventListener('click', analyze);
    dom.stop.addEventListener('click', stopAnalysis);
    dom.apply.addEventListener('click', applyResult);
    dom.measureScale.addEventListener('click', toggleScaleMeasurement);
    dom.stage.addEventListener('pointerdown', onScalePoint, true);
    dom.tolerance.addEventListener('input', () => {
      dom.toleranceValue.value = `${dom.tolerance.value}%`;
    });
    dom.resultRows.addEventListener('change', onResultChange);
    dom.resultRows.addEventListener('click', onResultClick);
    dom.timeline.addEventListener('click', onTimelineClick);
    dom.video.addEventListener('loadedmetadata', updateVideoMetadata);
    dom.video.addEventListener('play', () => {
      cancelScaleMeasurement();
      clearOverlay();
    });
    dom.video.addEventListener('seeking', clearOverlay);
    dom.video.addEventListener('error', () => setProgress(0, 'Video tarayıcı tarafından açılamadı', 'error'));
    window.addEventListener('keydown', onKeyDown);
  }

  function setMode(mode) {
    if (state.busy || !['build', 'guided'].includes(mode) || state.mode === mode) return;
    state.mode = mode;
    state.result = null;
    state.selectedEventIndex = -1;
    dom.resultsPanel.hidden = true;
    clearOverlay();
    updateModeUI();
    renderResults();
    setProgress(
      state.file ? 5 : 0,
      state.file
        ? mode === 'build'
          ? 'Video hazır; otomatik yapım taramasını başlatın'
          : 'Video hazır; en az iki görünüş yakalayın'
        : 'Video bekleniyor',
    );
  }

  function updateModeUI() {
    const buildMode = state.mode === 'build';
    dom.buildPanel.hidden = !buildMode;
    dom.guidedPanel.hidden = buildMode;
    dom.samplingFps.closest('.field').hidden = !buildMode;
    dom.buildMode.classList.toggle('active', buildMode);
    dom.guidedMode.classList.toggle('active', !buildMode);
    dom.buildMode.setAttribute('aria-pressed', String(buildMode));
    dom.guidedMode.setAttribute('aria-pressed', String(!buildMode));
    dom.analyze.textContent = buildMode ? 'Videoyu Tara' : 'Görünüşleri Analiz Et';
    dom.meta.hidden = !buildMode;
    updateButtons();
  }

  function stopAnalysis() {
    if (!state.busy || state.mode !== 'build') return;
    state.abortRequested = true;
    dom.stop.disabled = true;
    setProgress(Number.parseFloat(dom.progressBar.style.width) || 0, 'Tarama güvenli noktada durduruluyor…');
  }

  function open() {
    dom.modal.classList.add('open');
    dom.modal.setAttribute('aria-hidden', 'false');
    if (!state.file) dom.fileInput.focus();
  }

  function close() {
    if (state.busy) return;
    dom.video.pause();
    dom.modal.classList.remove('open');
    dom.modal.setAttribute('aria-hidden', 'true');
  }

  function destroy() {
    revokeVideoUrl();
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
    loadFile([...event.dataTransfer.files].find(isVideoFile));
  }

  function loadFile(file) {
    if (!file) return;
    if (!isVideoFile(file)) {
      setProgress(0, 'Seçilen dosya video değil', 'error');
      return;
    }

    cancelScaleMeasurement();
    revokeVideoUrl();
    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    state.captures.clear();
    state.result = null;
    state.selectedOverlayView = null;
    state.abortRequested = false;
    state.selectedEventIndex = -1;
    dom.video.src = state.objectUrl;
    dom.video.load();
    dom.dropzone.hidden = true;
    dom.workspace.hidden = false;
    dom.resultsPanel.hidden = true;
    clearOverlay();
    dom.fileName.textContent = file.name;
    dom.fileMeta.textContent = formatBytes(file.size);
    setProgress(5, state.mode === 'build'
      ? 'Video hazır; otomatik yapım taramasını başlatın'
      : 'Video hazır; görünüşleri yakalayın');
    dom.meta.textContent = '0:00 / 0:00 · 0 adım · 0 olay';
    renderCaptureButtons();
    renderResults();
  }

  function updateVideoMetadata() {
    const duration = Number.isFinite(dom.video.duration) ? formatTime(dom.video.duration) : '–';
    const dimensions = dom.video.videoWidth && dom.video.videoHeight
      ? `${dom.video.videoWidth}×${dom.video.videoHeight}`
      : '–';
    dom.fileMeta.textContent = `${formatBytes(state.file?.size || 0)} · ${duration} · ${dimensions}`;
    dom.meta.textContent = `0:00 / ${duration} · 0 adım · 0 olay`;
    updateButtons();
  }

  function captureCurrentFrame(view) {
    if (!state.file || dom.video.readyState < 2) {
      setProgress(5, 'Önce video karesinin yüklenmesini bekleyin', 'error');
      return;
    }
    const capture = frameFromVideo(dom.video);
    state.captures.set(view, {
      view,
      time: dom.video.currentTime,
      imageData: capture.imageData,
    });
    state.selectedOverlayView = view;
    state.result = null;
    dom.resultsPanel.hidden = true;
    clearOverlay();
    renderCaptureButtons();
    setProgress(captureProgress(), `${VIEW_LABELS[view]} görünüşü ${formatTime(dom.video.currentTime)} konumundan yakalandı`);
  }

  async function autoCaptureViews() {
    if (!state.file || !Number.isFinite(dom.video.duration) || dom.video.duration <= 0) return;
    setBusy(true);
    try {
      const fractions = [0.04, 0.25, 0.49, 0.73, 0.94];
      for (let index = 0; index < VIEW_ORDER.length; index += 1) {
        const view = VIEW_ORDER[index];
        setProgress(10 + index * 10, `${VIEW_LABELS[view]} karesi alınıyor…`);
        await seekVideo(dom.video, Math.min(dom.video.duration - 0.04, dom.video.duration * fractions[index]));
        captureCurrentFrame(view);
      }
      setProgress(58, 'Beş görünüş otomatik dolduruldu; kareleri kontrol edin');
    } catch (error) {
      setProgress(0, `Kare çıkarma hatası: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function clearCaptures() {
    cancelScaleMeasurement();
    state.captures.clear();
    state.result = null;
    state.selectedOverlayView = null;
    dom.resultsPanel.hidden = true;
    clearOverlay();
    renderCaptureButtons();
    setProgress(5, 'Görünüşler temizlendi');
  }

  function toggleScaleMeasurement() {
    if (!state.file || dom.video.readyState < 2) return;
    if (state.measuringScale) {
      cancelScaleMeasurement();
      clearOverlay();
      return;
    }
    state.measuringScale = true;
    state.scalePoints = [];
    dom.stage.classList.add('measuring-scale');
    dom.measureScale.classList.add('active');
    setProgress(captureProgress(), 'Bilinen 1×1 karenin bir kenarındaki iki köşeye tıklayın');
  }

  function onScalePoint(event) {
    if (!state.measuringScale) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = dom.video.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(dom.video.videoWidth, dom.video.videoHeight));
    const point = {
      x: (event.clientX - rect.left) * (dom.video.videoWidth * scale) / rect.width,
      y: (event.clientY - rect.top) * (dom.video.videoHeight * scale) / rect.height,
    };
    state.scalePoints.push(point);
    drawScaleMeasurement();
    if (state.scalePoints.length < 2) {
      setProgress(captureProgress(), 'İlk köşe alındı; aynı kenarın diğer köşesine tıklayın');
      return;
    }
    const [first, second] = state.scalePoints;
    const pixels = Math.hypot(second.x - first.x, second.y - first.y);
    dom.pixelsPerUnit.value = String(Math.max(1, Math.round(pixels)));
    state.measuringScale = false;
    dom.stage.classList.remove('measuring-scale');
    dom.measureScale.classList.remove('active');
    setProgress(captureProgress(), `Ölçek ${Math.round(pixels)} piksel / blok olarak ayarlandı`, 'good');
  }

  function drawScaleMeasurement() {
    const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(dom.video.videoWidth, dom.video.videoHeight));
    dom.overlay.width = Math.max(1, Math.round(dom.video.videoWidth * scale));
    dom.overlay.height = Math.max(1, Math.round(dom.video.videoHeight * scale));
    const context = dom.overlay.getContext('2d');
    context.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
    context.strokeStyle = '#F3C84B';
    context.fillStyle = '#F3C84B';
    context.lineWidth = Math.max(2, dom.overlay.width / 360);
    state.scalePoints.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 6, 0, Math.PI * 2);
      context.fill();
    });
    if (state.scalePoints.length > 1) {
      context.beginPath();
      context.moveTo(state.scalePoints[0].x, state.scalePoints[0].y);
      context.lineTo(state.scalePoints[1].x, state.scalePoints[1].y);
      context.stroke();
    }
  }

  function cancelScaleMeasurement() {
    state.measuringScale = false;
    state.scalePoints = [];
    dom.stage.classList.remove('measuring-scale');
    dom.measureScale.classList.remove('active');
  }

  async function analyze() {
    if (state.busy) return;
    if (state.mode === 'build') {
      await analyzeBuildVideo();
      return;
    }
    await analyzeGuidedViews();
  }

  async function analyzeGuidedViews() {
    if (state.captures.size < 2) return;
    setBusy(true);
    setProgress(64, 'Renk bölgeleri ayrıştırılıyor…');
    await nextPaint();

    try {
      const frames = [...state.captures.values()].map(({ view, imageData }) => ({ view, imageData }));
      state.result = analyzeGuidedFrames(frames, blockTypes, colors, {
        colorTolerance: Number(dom.tolerance.value) / 100,
        minComponentPixels: clampNumber(dom.minRegion.value, 12, 5000, 42),
        pixelsPerUnit: clampNumber(dom.pixelsPerUnit.value, 0, 1000, 0),
        snap: 0.5,
      });
      setProgress(88, 'Görünüşler birleştiriliyor…');
      await nextPaint();
      dom.resultsPanel.hidden = false;
      renderResults();
      drawAnalysisOverlay(state.selectedOverlayView || firstCapturedView());
      const count = state.result.blocks.length;
      setProgress(100, count ? `${count} blok bulundu; sonucu kontrol edin` : 'Blok bulunamadı', count ? 'good' : 'error');
    } catch (error) {
      state.result = null;
      dom.resultsPanel.hidden = true;
      setProgress(0, `Analiz hatası: ${error.message}`, 'error');
    } finally {
      setBusy(false);
      updateButtons();
    }
  }

  async function analyzeBuildVideo() {
    if (!state.file || !Number.isFinite(dom.video.duration) || dom.video.duration <= 0) return;
    state.abortRequested = false;
    state.result = null;
    state.selectedEventIndex = -1;
    dom.resultsPanel.hidden = true;
    clearOverlay();
    setBusy(true);

    const duration = dom.video.duration;
    const requestedFps = clampNumber(dom.samplingFps.value, 0.5, 8, 2);
    const requestedSamples = Math.max(2, Math.ceil(duration * requestedFps) + 1);
    const sampleCount = Math.min(MAX_MOTION_SAMPLES, requestedSamples);
    const frameInterval = duration / Math.max(1, sampleCount - 1);
    const effectiveFps = Math.min(requestedFps, 1 / frameInterval);
    const sampleTimes = Array.from({ length: sampleCount }, (_, index) => (
      index === sampleCount - 1 ? Math.max(0, duration - 0.04) : index * frameInterval
    ));

    try {
      const motionFrames = [];
      for (let index = 0; index < sampleTimes.length; index += 1) {
        assertNotAborted();
        const time = sampleTimes[index];
        await seekVideo(dom.video, time);
        assertNotAborted();
        const imageData = frameFromVideo(dom.video, MOTION_FRAME_EDGE).imageData;
        motionFrames.push({
          index,
          time,
          signature: makeFrameSignature(imageData),
        });
        const progress = 7 + (index + 1) / sampleTimes.length * 48;
        setProgress(progress, `Video izleniyor · ${formatTime(time)} / ${formatTime(duration)}`);
        dom.meta.textContent = `${formatTime(time)} / ${formatTime(duration)} · sabit anlar aranıyor`;
        if (index % 4 === 0) await nextPaint();
      }

      const stableOptions = {
        stableDifference: 0.032,
        minStableFrames: Math.max(2, Math.ceil(effectiveFps * 0.55)),
      };
      const stableSegments = detectStableSegments(motionFrames, stableOptions);
      if (!stableSegments.length) {
        throw new Error('Videoda sabit bir an bulunamadı. Her bloktan sonra kısa süre bekleyin.');
      }

      let keyframeTimes = stableSegments.map((segment) => motionFrames[segment.endIndex].time);
      if (keyframeTimes.length > MAX_KEYFRAMES) {
        keyframeTimes = thinTimes(keyframeTimes, MAX_KEYFRAMES);
      }
      const keyframes = [];
      for (let index = 0; index < keyframeTimes.length; index += 1) {
        assertNotAborted();
        const time = keyframeTimes[index];
        await seekVideo(dom.video, time);
        assertNotAborted();
        keyframes.push({ time, imageData: frameFromVideo(dom.video, MAX_FRAME_EDGE).imageData });
        const progress = 57 + (index + 1) / keyframeTimes.length * 25;
        setProgress(progress, `Sabit an doğrulanıyor · ${index + 1} / ${keyframeTimes.length}`);
        dom.meta.textContent = `${formatTime(time)} / ${formatTime(duration)} · ${keyframeTimes.length} sabit an`;
        if (index % 2 === 0) await nextPaint();
      }

      setProgress(85, 'Kalıcı değişiklikler yapım adımlarına dönüştürülüyor…');
      await nextPaint();
      assertNotAborted();
      state.result = analyzeBuildFrames(keyframes, blockTypes, colors, {
        colorTolerance: Number(dom.tolerance.value) / 100,
        minComponentPixels: clampNumber(dom.minRegion.value, 12, 5000, 42),
        pixelsPerUnit: clampNumber(dom.pixelsPerUnit.value, 0, 1000, 0),
        snap: 0.5,
        framesAreStable: true,
      });
      state.result.diagnostics.sampledFrames = motionFrames.length;
      state.result.diagnostics.keyframes = keyframes.length;
      state.result.frameSize = keyframes[0]
        ? { width: keyframes[0].imageData.width, height: keyframes[0].imageData.height }
        : null;
      if (keyframeTimes.length === MAX_KEYFRAMES && stableSegments.length > MAX_KEYFRAMES) {
        state.result.warnings.push(`Çok uzun video nedeniyle sabit anlar ${MAX_KEYFRAMES} ana kareye seyreltildi.`);
      }
      if (effectiveFps + 0.01 < requestedFps) {
        state.result.warnings.push(`Video uzun olduğu için örnekleme hızı ${effectiveFps.toFixed(2)} kare/sn ile sınırlandı.`);
      }

      dom.resultsPanel.hidden = false;
      renderResults();
      const blockCount = state.result.blocks.length;
      const stepCount = uniqueStepCount(state.result.blocks);
      const eventCount = state.result.events?.length || 0;
      dom.meta.textContent = `${formatTime(duration)} / ${formatTime(duration)} · ${stepCount} adım · ${eventCount} olay`;
      setProgress(
        100,
        blockCount ? `${blockCount} blok, ${stepCount} yapım adımı bulundu` : 'Kalıcı blok ekleme adımı bulunamadı',
        blockCount ? 'good' : 'error',
      );
    } catch (error) {
      state.result = null;
      dom.resultsPanel.hidden = true;
      const cancelled = error?.name === 'AbortError';
      setProgress(0, cancelled ? 'Tarama durduruldu; hiçbir sonuç uygulanmadı' : `Analiz hatası: ${error.message}`, cancelled ? 'normal' : 'error');
      dom.meta.textContent = `0:00 / ${formatTime(duration)} · 0 adım · 0 olay`;
    } finally {
      state.abortRequested = false;
      setBusy(false);
      updateButtons();
    }
  }

  function assertNotAborted() {
    if (!state.abortRequested) return;
    const error = new Error('Tarama kullanıcı tarafından durduruldu');
    error.name = 'AbortError';
    throw error;
  }

  function renderCaptureButtons() {
    dom.captureGrid.querySelectorAll('[data-capture-view]').forEach((button) => {
      const capture = state.captures.get(button.dataset.captureView);
      button.classList.toggle('captured', Boolean(capture));
      button.querySelector('small').textContent = capture ? formatTime(capture.time) : 'Yakalanmadı';
      button.title = capture ? `${VIEW_LABELS[button.dataset.captureView]} görünüşünü mevcut kareyle değiştir` : 'Mevcut video karesini yakala';
    });
    updateButtons();
  }

  function renderResults() {
    dom.resultRows.replaceChildren();
    const blocks = state.result?.blocks || [];
    const lowConfidence = blocks.filter((block) => block.confidence < 0.62).length;
    const stepCount = uniqueStepCount(blocks);
    dom.resultSummary.textContent = blocks.length
      ? `${blocks.length} blok · ${stepCount} adım · ${lowConfidence} kontrol gerekli · ölçek ${state.result.pixelsPerUnit.toFixed(1)} px/birim`
      : 'Henüz analiz edilmedi';

    blocks.forEach((block, index) => {
      const row = document.createElement('tr');
      if (block.confidence < 0.62) row.classList.add('low-confidence');
      row.dataset.resultIndex = String(index);
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><input data-field="stepNumber" type="number" min="1" step="1" value="${block.stepNumber || index + 1}" aria-label="Yapım adımı" /></td>
        <td>${Number.isFinite(block.time)
          ? `<button class="video-result-time" type="button" data-result-time="${block.time}">${formatTimePrecise(block.time)}</button>`
          : '–'}</td>
        <td><select data-field="typeId">${blockTypeOptions(block.typeId)}</select></td>
        <td><input data-field="color" type="color" value="${block.color}" aria-label="Blok rengi" /></td>
        <td><select data-field="orientation">${orientationOptions(block.orientation)}</select></td>
        <td><input data-field="position.x" type="number" step="0.5" value="${block.position.x}" /></td>
        <td><input data-field="position.y" type="number" step="0.5" value="${block.position.y}" /></td>
        <td><input data-field="position.z" type="number" step="0.5" value="${block.position.z}" /></td>
        <td><span class="confidence-value"><span class="confidence-dot ${confidenceClass(block.confidence)}"></span>${Math.round(block.confidence * 100)}%</span></td>
        <td><button class="video-row-delete" data-delete-result="${index}" aria-label="Algılanan bloğu sil">×</button></td>
      `;
      dom.resultRows.appendChild(row);
    });

    renderTimeline();
    dom.warnings.replaceChildren();
    (state.result?.warnings || []).forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      dom.warnings.appendChild(item);
    });
    updateButtons();
  }

  function onResultChange(event) {
    const input = event.target.closest('[data-field]');
    const row = event.target.closest('[data-result-index]');
    if (!input || !row || !state.result) return;
    const block = state.result.blocks[Number(row.dataset.resultIndex)];
    if (!block) return;
    const field = input.dataset.field;
    if (field.startsWith('position.')) {
      block.position[field.split('.')[1]] = snapHalf(clampNumber(input.value, -100, 100, 0));
      input.value = block.position[field.split('.')[1]];
    } else if (field === 'stepNumber') {
      block.stepNumber = Math.round(clampNumber(input.value, 1, 9999, block.stepNumber || 1));
      input.value = block.stepNumber;
    } else {
      block[field] = input.value;
    }
    block.confidence = Math.max(block.confidence, 0.72);
    renderResults();
  }

  function onResultClick(event) {
    const timeButton = event.target.closest('[data-result-time]');
    if (timeButton) {
      showEventTime(Number(timeButton.dataset.resultTime));
      return;
    }
    const button = event.target.closest('[data-delete-result]');
    if (!button || !state.result) return;
    state.result.blocks.splice(Number(button.dataset.deleteResult), 1);
    if (state.mode === 'guided') {
      state.result.blocks.forEach((block, index) => {
        block.stepNumber = index + 1;
      });
    }
    renderResults();
  }

  function renderTimeline() {
    dom.timeline.replaceChildren();
    if (state.mode !== 'build') {
      dom.timeline.hidden = true;
      return;
    }
    dom.timeline.hidden = false;
    (state.result?.events || []).forEach((event, index) => {
      const item = document.createElement('li');
      item.className = 'video-timeline-item';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'video-timeline-event';
      button.dataset.eventIndex = String(index);
      button.dataset.eventKind = event.kind;
      button.setAttribute('aria-label', `${event.label}, ${formatTimePrecise(event.time)}`);
      if (index === state.selectedEventIndex) button.setAttribute('aria-current', 'step');
      const title = event.kind === 'add'
        ? `Adım ${event.stepNumber}`
        : event.kind === 'camera'
          ? 'Kamera dolaşımı'
          : 'Kontrol gerekli';
      button.innerHTML = `<strong>${title}</strong><span>${formatTimePrecise(event.time)} · ${Math.round((event.confidence || 0) * 100)}%</span>`;
      item.appendChild(button);
      dom.timeline.appendChild(item);
    });
  }

  function onTimelineClick(event) {
    const button = event.target.closest('[data-event-index]');
    if (!button || !state.result) return;
    const index = Number(button.dataset.eventIndex);
    const timelineEvent = state.result.events?.[index];
    if (!timelineEvent) return;
    state.selectedEventIndex = index;
    renderTimeline();
    showEventTime(timelineEvent.time, timelineEvent);
  }

  async function showEventTime(time, timelineEvent = null) {
    if (!state.file || !Number.isFinite(time)) return;
    try {
      await seekVideo(dom.video, time);
      drawTemporalEventOverlay(timelineEvent || eventNearTime(time));
      const label = timelineEvent?.label || 'Algılanan blok zamanı';
      setProgress(100, `${label} · ${formatTimePrecise(time)}`, 'good');
    } catch (error) {
      setProgress(100, `Olay karesi açılamadı: ${error.message}`, 'error');
    }
  }

  function eventNearTime(time) {
    return (state.result?.events || []).reduce((best, event) => (
      !best || Math.abs(event.time - time) < Math.abs(best.time - time) ? event : best
    ), null);
  }

  function applyResult() {
    if (!state.result?.blocks.length) return;
    const validation = validateBlocks(state.result.blocks, blockTypes);
    if (!validation.valid) {
      setProgress(100, validation.message, 'error');
      return;
    }
    onApply(state.result.blocks.map((block) => ({
      typeId: block.typeId,
      color: block.color,
      orientation: block.orientation,
      position: { ...block.position },
      rotation: { ...block.rotation },
      stepNumber: block.stepNumber,
      confidence: block.confidence,
    })), {
      pixelsPerUnit: state.result.pixelsPerUnit,
      warnings: state.result.warnings,
      fileName: state.file?.name || '',
    });
    close();
  }

  function drawAnalysisOverlay(view) {
    clearOverlay();
    if (!view || !state.result?.frames?.[view]) return;
    const capture = state.captures.get(view);
    const analysis = state.result.frames[view];
    if (!capture) return;
    const canvas = dom.overlay;
    const context = canvas.getContext('2d');
    canvas.width = capture.imageData.width;
    canvas.height = capture.imageData.height;
    context.lineWidth = Math.max(2, canvas.width / 360);
    context.font = `${Math.max(11, canvas.width / 52)}px ui-sans-serif, system-ui`;
    analysis.regions.forEach((region) => {
      const { x, y, width, height } = region.bbox;
      context.strokeStyle = region.faceLike ? '#6BE38A' : '#F3C84B';
      context.fillStyle = 'rgba(8, 12, 16, 0.8)';
      context.strokeRect(x, y, width, height);
      const label = region.typeId || 'kenar';
      const labelWidth = context.measureText(label).width + 9;
      context.fillRect(x, Math.max(0, y - 20), labelWidth, 19);
      context.fillStyle = region.faceLike ? '#6BE38A' : '#F3C84B';
      context.fillText(label, x + 4, Math.max(13, y - 5));
    });
  }

  function drawTemporalEventOverlay(timelineEvent) {
    clearOverlay();
    if (!timelineEvent?.bbox || !state.result?.frameSize) return;
    const canvas = dom.overlay;
    const context = canvas.getContext('2d');
    canvas.width = state.result.frameSize.width;
    canvas.height = state.result.frameSize.height;
    const { x, y, width, height } = timelineEvent.bbox;
    context.lineWidth = Math.max(3, canvas.width / 240);
    context.strokeStyle = timelineEvent.kind === 'add' ? '#6BE38A' : '#F3C84B';
    context.fillStyle = 'rgba(8, 12, 16, 0.82)';
    context.font = `${Math.max(12, canvas.width / 50)}px ui-sans-serif, system-ui`;
    context.strokeRect(x, y, width, height);
    const label = timelineEvent.kind === 'add' ? `Adım ${timelineEvent.stepNumber}` : 'Kontrol';
    const labelWidth = context.measureText(label).width + 12;
    context.fillRect(x, Math.max(0, y - 23), labelWidth, 22);
    context.fillStyle = context.strokeStyle;
    context.fillText(label, x + 5, Math.max(15, y - 6));
  }

  function clearOverlay() {
    const context = dom.overlay.getContext('2d');
    context.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
    dom.overlay.width = 1;
    dom.overlay.height = 1;
  }

  function resetSession() {
    state.file = null;
    state.captures.clear();
    state.result = null;
    state.abortRequested = false;
    state.selectedEventIndex = -1;
    dom.dropzone.hidden = false;
    dom.workspace.hidden = true;
    dom.resultsPanel.hidden = true;
    dom.fileInput.value = '';
    dom.warnings.replaceChildren();
    dom.meta.textContent = '0:00 / 0:00 · 0 adım · 0 olay';
    clearOverlay();
    setProgress(0, 'Video bekleniyor');
    renderCaptureButtons();
    updateModeUI();
  }

  function revokeVideoUrl() {
    dom.video.pause();
    dom.video.removeAttribute('src');
    dom.video.load();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
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
    dom.stop.hidden = !(value && state.mode === 'build');
    dom.stop.disabled = false;
    updateButtons();
  }

  function updateButtons() {
    const captureCount = state.captures.size;
    const videoReady = Boolean(state.file) && Number.isFinite(dom.video.duration) && dom.video.duration > 0;
    dom.analyze.disabled = state.busy || (state.mode === 'build' ? !videoReady : captureCount < 2);
    dom.apply.disabled = state.busy || !(state.result?.blocks.length);
    dom.autoCapture.disabled = state.busy || !state.file;
    dom.replaceVideo.disabled = state.busy;
    dom.clearCaptures.disabled = state.busy || !captureCount;
    dom.closeButton.disabled = state.busy;
    dom.cancelButton.disabled = state.busy;
    dom.buildMode.disabled = state.busy;
    dom.guidedMode.disabled = state.busy;
    dom.samplingFps.disabled = state.busy;
    dom.captureGrid.querySelectorAll('button').forEach((button) => {
      button.disabled = state.busy || !state.file;
    });
    dom.measureScale.disabled = state.busy || !state.file;
  }

  function captureProgress() {
    return 8 + state.captures.size * 10;
  }

  function firstCapturedView() {
    return VIEW_ORDER.find((view) => state.captures.has(view)) || null;
  }
}

function collectDom() {
  const ids = {
    openButton: 'videoScanBtn',
    modal: 'videoScanModal',
    closeButton: 'closeVideoScanBtn',
    cancelButton: 'cancelVideoScanBtn',
    fileInput: 'videoFileInput',
    dropzone: 'videoDropzone',
    mode: 'videoScanMode',
    buildMode: 'buildVideoModeBtn',
    guidedMode: 'guidedVideoModeBtn',
    buildPanel: 'buildVideoPanel',
    guidedPanel: 'guidedCapturePanel',
    workspace: 'videoWorkspace',
    stage: 'videoStage',
    video: 'scanVideo',
    overlay: 'scanOverlay',
    fileName: 'videoFileName',
    fileMeta: 'videoFileMeta',
    captureGrid: 'viewCaptureGrid',
    autoCapture: 'autoCaptureViewsBtn',
    replaceVideo: 'replaceVideoBtn',
    clearCaptures: 'clearCapturedViewsBtn',
    tolerance: 'videoColorTolerance',
    toleranceValue: 'videoColorToleranceValue',
    minRegion: 'videoMinRegion',
    pixelsPerUnit: 'videoPixelsPerUnit',
    samplingFps: 'videoSamplingFps',
    measureScale: 'measureVideoScaleBtn',
    status: 'videoScanStatus',
    progressText: 'videoScanProgressText',
    progressBar: 'videoScanProgressBar',
    meta: 'videoScanMeta',
    warnings: 'videoScanWarnings',
    resultsPanel: 'videoResultsPanel',
    resultSummary: 'videoResultSummary',
    resultRows: 'videoResultRows',
    timeline: 'videoTimeline',
    analyze: 'analyzeVideoBtn',
    stop: 'stopVideoScanBtn',
    apply: 'applyVideoResultBtn',
  };
  const result = {};
  for (const [key, id] of Object.entries(ids)) {
    result[key] = document.getElementById(id);
    if (!result[key]) throw new Error(`Video tarayıcı elementi bulunamadı: #${id}`);
  }
  return result;
}

function frameFromVideo(video, maxEdge = MAX_FRAME_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  return {
    imageData: context.getImageData(0, 0, width, height),
  };
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const target = Math.min(
      Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : Math.max(0, time),
      Math.max(0, time),
    );
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.002) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video karesine gidilemedi'));
    }, 8000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.pause();
    video.currentTime = target;
  });
}

function validateBlocks(blocks, blockTypes) {
  const validTypes = new Set(blockTypes.map((type) => type.id));
  if (!blocks.length) return { valid: false, message: 'Aktarılacak blok bulunmuyor' };
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!Number.isFinite(block.confidence) || block.confidence < 0.62) {
      return { valid: false, message: `${index + 1}. blok düşük güvenli; alanlarını kontrol edin veya satırı silin` };
    }
    if (!validTypes.has(block.typeId)) return { valid: false, message: `${index + 1}. blok tipi geçersiz` };
    if (!['floor', 'front', 'side'].includes(block.orientation)) return { valid: false, message: `${index + 1}. blok yönü geçersiz` };
    if (!/^#[0-9a-f]{6}$/i.test(block.color)) return { valid: false, message: `${index + 1}. blok rengi geçersiz` };
    if (!['x', 'y', 'z'].every((axis) => Number.isFinite(block.position[axis]))) {
      return { valid: false, message: `${index + 1}. blok konumu geçersiz` };
    }
  }
  return { valid: true };
}

function blockTypeOptions(selected) {
  return [
    ['square', 'Kare 1×1'],
    ['rectangle', 'Dikdörtgen 2×1'],
    ['large-square', 'Büyük Kare 2×2'],
    ['window', 'Pencere'],
    ['triangle', 'Eşkenar Üçgen'],
    ['long-triangle', 'Büyük İkizkenar'],
    ['right-triangle', 'Sağ Üçgen'],
    ['semicircle', 'Yarım Daire'],
    ['stairs', 'Basamak'],
    ['tunnel', 'Tünel'],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function orientationOptions(selected) {
  return [['front', 'Ön'], ['side', 'Yan'], ['floor', 'Yatay']]
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function confidenceClass(value) {
  if (value >= 0.78) return 'high';
  if (value >= 0.62) return 'medium';
  return 'low';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function isVideoFile(file) {
  return Boolean(file) && (
    String(file.type || '').startsWith('video/')
    || /\.(mp4|mov|m4v|webm|ogv|avi)$/i.test(String(file.name || ''))
  );
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatTimePrecise(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function thinTimes(times, limit) {
  if (times.length <= limit) return [...times];
  const selected = [];
  for (let index = 0; index < limit; index += 1) {
    selected.push(times[Math.round(index * (times.length - 1) / (limit - 1))]);
  }
  return [...new Set(selected)];
}

function uniqueStepCount(blocks) {
  return new Set(blocks.map((block) => Number(block.stepNumber)).filter(Number.isFinite)).size;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function snapHalf(value) {
  return Math.round(value * 2) / 2;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
