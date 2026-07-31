import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { BLOCK_TYPES, COLORS, LAYER_HEIGHT, MAX_UNDO, SNAP, THICKNESS } from './config.js?v=color-palette-1';
import { shapeEdgesForType, shapeOutlinePoints, semicircleOutlinePoints } from './shape-utils.js?v=color-palette-1';
import { boxTemplate } from './templates.js?v=cube-json-1';
import { createImageScanner } from './image-scanner.js?v=image-scan-1';
import { createVideoScanner } from './video-scanner.js?v=video-scan-2';
import {
  edgeColor,
  niceNumber,
  normalizeColor,
  normalizeDegrees,
  orientationLabel,
  pivotLabel,
  placementModeLabel,
  roundNumber,
  roundVector,
  slugify,
} from './value-utils.js?v=color-palette-1';

const dom = {
  viewport: byId('viewport'),
  palette: byId('palette'),
  colors: byId('colors'),
  layerLabel: byId('layerLabel'),
  blockCount: byId('blockCount'),
  stepCount: byId('stepCount'),
  heightCount: byId('heightCount'),
  warnCount: byId('warnCount'),
  snapStatus: byId('snapStatus'),
  snapText: byId('snapText'),
  selectedSummary: byId('selectedSummary'),
  validationList: byId('validationList'),
  jsonOutput: byId('jsonOutput'),
  importModal: byId('importModal'),
  importText: byId('importText'),
  toast: byId('toast'),
  modelName: byId('modelName'),
  category: byId('category'),
  difficulty: byId('difficulty'),
  estimatedTime: byId('estimatedTime'),
  stepNumber: byId('stepNumber'),
  posX: byId('posX'),
  posY: byId('posY'),
  posZ: byId('posZ'),
  rotX: byId('rotX'),
  rotY: byId('rotY'),
  rotZ: byId('rotZ'),
  pivotAngle: byId('pivotAngle'),
};

const buttons = {
  undo: byId('undoBtn'),
  redo: byId('redoBtn'),
  duplicate: byId('duplicateBtn'),
  delete: byId('deleteBtn'),
  randomizeColors: byId('randomizeColorsBtn'),
  autoStand: byId('autoStandBtn'),
  equalizeAngles: byId('equalizeAnglesBtn'),
  snapOtherEdge: byId('snapOtherEdgeBtn'),
  assignStep: byId('assignStepBtn'),
  pyramidOnSquare: byId('pyramidOnSquareBtn'),
  pyramidOnTriangle: byId('pyramidOnTriangleBtn'),
  longPyramidOnSquare: byId('longPyramidOnSquareBtn'),
  longPyramidOnTriangle: byId('longPyramidOnTriangleBtn'),
  rotateX: byId('rotateXBtn'),
  rotateY: byId('rotateYBtn'),
  rotateZ: byId('rotateZBtn'),
  mirrorX: byId('mirrorXBtn'),
  mirrorZ: byId('mirrorZBtn'),
  validate: byId('validateBtn'),
  fixEdges: byId('fixEdgesBtn'),
  clear: byId('clearBtn'),
  layerDown: byId('layerDownBtn'),
  layerUp: byId('layerUpBtn'),
  gridSnap: byId('gridSnapBtn'),
  magnetSnap: byId('magnetSnapBtn'),
  edgeMode: byId('edgeModeBtn'),
  autoSymmetry: byId('autoSymmetryBtn'),
  boxTemplate: byId('boxTemplateBtn'),
  copyJson: byId('copyJsonBtn'),
  downloadJson: byId('downloadJsonBtn'),
  importJson: byId('importJsonBtn'),
  closeImport: byId('closeImportBtn'),
  cancelImport: byId('cancelImportBtn'),
  applyImport: byId('applyImportBtn'),
  pivotRotateNeg: byId('pivotRotateNegBtn'),
  pivotRotatePos: byId('pivotRotatePosBtn'),
  pivotTiltUp: byId('pivotTiltUpBtn'),
  pivotTiltDown: byId('pivotTiltDownBtn'),
  pivotTurnLeft: byId('pivotTurnLeftBtn'),
  pivotTurnRight: byId('pivotTurnRightBtn'),
  pivotRollLeft: byId('pivotRollLeftBtn'),
  pivotRollRight: byId('pivotRollRightBtn'),
};

const state = {
  blocks: [],
  selectedId: null,
  selectedIds: [],
  activeTypeId: 'square',
  activeColor: COLORS[0],
  orientation: 'floor',
  placementMode: 'horizontal',
  currentLayer: 0,
  gridSnap: true,
  magnetSnap: true,
  edgeMode: true,
  autoSymmetry: false,
  pivot: 'center',
  pivotAxis: 'y',
  undoStack: [],
  redoStack: [],
  nextId: 1,
  lastValidation: [],
  pendingAttach: null,
};

const EDGE_CONTACT_FIX = {
  passes: 10,
  maxEndpointError: 0.22,
  maxMidDistance: 0.28,
  maxAngleDeg: 14,
  maxLengthGap: 0.18,
  settledEndpointError: 0.008,
  settledAngleDeg: 0.35,
  maxRotationStepDeg: 2.4,
  maxTranslationStep: 0.08,
};

const APEX_CONTACT_FIX = {
  passes: 8,
  maxClusterDistance: 0.72,
  settledDistance: 0.018,
  maxRotationStepDeg: 10,
};

const TOP_STACK_FACE_ID = 'top-surface';

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let pointer;
let blockRoot;
let attachmentRoot;
let blockObjects;
let selectionHelper;
let attachHandleGeometry;
let attachHandleMaterial;
let attachRingGeometry;
let attachRingMaterial;
let resizeObserver;
let animationId;
let pointerDown = null;
let toastTimer;
let videoScanner;
let imageScanner;

init();

function init() {
  if (!dom.viewport) {
    throw new Error('3D viewport bulunamadı.');
  }

  initScene();
  buildPalette();
  buildColors();
  bindEvents();
  initVideoScanner();
  initImageScanner();
  loadStarterModel();
  rebuildScene();
  updateEverything();
  animate();
}

function initVideoScanner() {
  videoScanner = createVideoScanner({
    blockTypes: BLOCK_TYPES,
    colors: COLORS,
    onApply: (blocks, diagnostics) => applyScanBlocks(blocks, { ...diagnostics, source: 'video' }),
  });
}

function initImageScanner() {
  imageScanner = createImageScanner({
    blockTypes: BLOCK_TYPES,
    colors: COLORS,
    onApply: applyScanBlocks,
  });
}

function applyScanBlocks(blocks, diagnostics = {}) {
  const isImage = diagnostics.source === 'image';
  const sourceLabel = isImage ? 'Görsel' : 'Video';
  if (!Array.isArray(blocks) || !blocks.length) {
    setStatus(`${sourceLabel} analizinde aktarılacak blok bulunamadı`, 'error');
    return;
  }

  const validTypeIds = new Set(BLOCK_TYPES.map((type) => type.id));
  const accepted = blocks.filter((block) => (
    validTypeIds.has(block.typeId)
    && ['floor', 'front', 'side'].includes(block.orientation)
    && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(block.position?.[axis])))
  ));

  if (!accepted.length) {
    setStatus(`${sourceLabel} sonucu geçerli blok içermiyor`, 'error');
    return;
  }

  applyChange(() => {
    state.nextId = 1;
    state.blocks = accepted.map((block, index) => createBlockRecord({
      typeId: block.typeId,
      color: colorFromJson(block.color),
      orientation: block.orientation,
      position: vectorFromJson(block.position, { x: 0, y: THICKNESS / 2, z: 0 }),
      rotation: vectorFromJson(block.rotation, { x: 0, y: 0, z: 0 }),
      stepNumber: normalizedStepNumber(block.stepNumber, index + 1),
    }));
    state.selectedId = state.blocks[0]?.id || null;
    state.selectedIds = state.selectedId ? [state.selectedId] : [];
    state.pendingAttach = null;
    dom.modelName.value = scanModelName(diagnostics.fileName, isImage);
    dom.estimatedTime.value = `${Math.max(3, Math.ceil(state.blocks.length / 5))} dk`;
  }, `${sourceLabel} analizi sahneye aktarıldı`, { enforceAutoSymmetry: false });

  const rejected = blocks.length - accepted.length;
  const warningCount = diagnostics.warnings?.length || 0;
  if (rejected || warningCount) {
    setStatus(`${accepted.length} blok aktarıldı · ${rejected + warningCount} kontrol notu`, 'warn');
  }
}

function scanModelName(fileName, isImage = false) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (base) return `${base} · ${isImage ? 'Görsel' : 'Video'} Modeli`;
  return isImage ? 'Görselden Oluşturulan Model' : 'Videodan Oluşturulan Model';
}

function byId(id) {
  return document.getElementById(id);
}

function initScene() {
  THREE.ColorManagement.enabled = true;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#101318');
  scene.fog = new THREE.Fog('#101318', 14, 28);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(5.2, 4.1, 6.4);
  camera.lookAt(0, 0.7, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  dom.viewport.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.7, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 18;

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  blockRoot = new THREE.Group();
  blockRoot.name = 'MagneticBlox Blocks';
  blockObjects = new Map();
  scene.add(blockRoot);

  attachmentRoot = new THREE.Group();
  attachmentRoot.name = 'Attachment Handles';
  scene.add(attachmentRoot);

  attachHandleGeometry = new THREE.SphereGeometry(0.13, 20, 12);
  attachHandleMaterial = new THREE.MeshBasicMaterial({
    color: '#f3c84b',
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  attachRingGeometry = new THREE.RingGeometry(0.17, 0.22, 28);
  attachRingMaterial = new THREE.MeshBasicMaterial({
    color: '#36c2b4',
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthTest: false,
  });

  const hemi = new THREE.HemisphereLight('#eaf7ff', '#1f2a34', 2.1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight('#ffffff', 2.3);
  key.position.set(4.5, 7, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 18;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#49d6c9', 0.45);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const grid = new THREE.GridHelper(16, 32, '#36c2b4', '#344050');
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.ShadowMaterial({ color: '#000000', opacity: 0.23 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  scene.add(floor);

  const axes = new THREE.AxesHelper(1.6);
  axes.position.set(-7.2, 0.02, -7.2);
  scene.add(axes);

  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(dom.viewport);
  resizeRenderer();
}

function buildPalette() {
  dom.palette.replaceChildren();

  BLOCK_TYPES.forEach((type) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `block-card ${type.id === state.activeTypeId ? 'active' : ''}`;
    card.draggable = true;
    card.dataset.typeId = type.id;
    card.innerHTML = `
      <span class="block-card-plus" aria-hidden="true">+</span>
      <span class="shape-icon" aria-hidden="true">
        <span class="tile-icon ${type.icon}"></span>
      </span>
      <span>${type.label}</span>
    `;
    card.addEventListener('click', (event) => {
      if (event.target.closest('.block-card-plus')) {
        event.preventDefault();
        event.stopPropagation();
        quickAddBlock(type.id);
        return;
      }

      state.activeTypeId = type.id;
      updatePalette();

      if (state.pendingAttach) {
        addBlockToPendingFace(type.id);
        return;
      }

      setStatus(`${type.label} seçildi`, 'snap');
    });
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', type.id);
      event.dataTransfer.effectAllowed = 'copy';
      state.activeTypeId = type.id;
      updatePalette();
    });
    dom.palette.appendChild(card);
  });
}

function buildColors() {
  dom.colors.replaceChildren();

  COLORS.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `swatch ${color === state.activeColor ? 'active' : ''}`;
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute('aria-label', `Renk ${color}`);
    swatch.addEventListener('click', () => {
      state.activeColor = color;
      if (state.selectedId) {
        applyChange(() => {
          selectedBlock().color = color;
        }, 'Renk değişti');
      } else {
        updateColors();
      }
    });
    dom.colors.appendChild(swatch);
  });
}

function bindEvents() {
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerleave', () => {
    pointerDown = null;
  });
  renderer.domElement.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  renderer.domElement.addEventListener('drop', onDropBlock);

  document.querySelectorAll('#placementModeControls button').forEach((button) => {
    button.addEventListener('click', () => {
      state.placementMode = button.dataset.placementMode;
      state.orientation = placementModeToOrientation(state.placementMode);
      updateSegmented('#placementModeControls button', state.placementMode, 'placementMode');
      setStatus(placementModeLabel(state.placementMode), 'snap');
    });
  });

  document.querySelectorAll('#pivotPicker button').forEach((button) => {
    button.addEventListener('click', () => {
      state.pivot = button.dataset.pivot;
      updateSegmented('#pivotPicker button', state.pivot, 'pivot');
      updateSelectionHelper();
      setStatus(`Pivot: ${pivotLabel(state.pivot)}`, 'snap');
    });
  });

  document.querySelectorAll('#pivotAxisControls button').forEach((button) => {
    button.addEventListener('click', () => {
      state.pivotAxis = button.dataset.axis;
      updateSegmented('#pivotAxisControls button', state.pivotAxis, 'axis');
    });
  });

  buttons.layerDown.addEventListener('click', () => setLayer(state.currentLayer - 1));
  buttons.layerUp.addEventListener('click', () => setLayer(state.currentLayer + 1));
  buttons.gridSnap.addEventListener('click', () => toggleSetting('gridSnap', buttons.gridSnap, 'Izgara snap'));
  buttons.magnetSnap.addEventListener('click', () => toggleSetting('magnetSnap', buttons.magnetSnap, 'Mıknatıs snap'));
  buttons.edgeMode.addEventListener('click', () => toggleSetting('edgeMode', buttons.edgeMode, 'Edge hizalama'));
  buttons.autoSymmetry.addEventListener('click', () => {
    toggleSetting('autoSymmetry', buttons.autoSymmetry, 'Auto-Align');
    if (state.autoSymmetry) {
      applyChange(() => {}, 'Auto-Align uygulandı');
    }
  });

  buttons.undo.addEventListener('click', undo);
  buttons.redo.addEventListener('click', redo);
  buttons.duplicate.addEventListener('click', duplicateSelected);
  buttons.delete.addEventListener('click', deleteSelected);
  buttons.randomizeColors.addEventListener('click', randomizeModelColors);
  buttons.autoStand.addEventListener('click', autoStandSelectedBlock);
  buttons.equalizeAngles.addEventListener('click', equalizeSelectedAngles);
  buttons.snapOtherEdge.addEventListener('click', snapSelectedTriangleOtherEdge);
  buttons.assignStep.addEventListener('click', assignStepToSelection);
  dom.stepNumber.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    assignStepToSelection();
  });
  buttons.rotateX.addEventListener('click', () => rotateSelected('x', 90));
  buttons.rotateY.addEventListener('click', () => rotateSelected('y', 90));
  buttons.rotateZ.addEventListener('click', () => rotateSelected('z', 90));
  buttons.mirrorX.addEventListener('click', () => mirrorSelected('x'));
  buttons.mirrorZ.addEventListener('click', () => mirrorSelected('z'));
  buttons.pivotRotateNeg.addEventListener('click', () => pivotRotate(-1));
  buttons.pivotRotatePos.addEventListener('click', () => pivotRotate(1));
  buttons.pivotTiltUp.addEventListener('click', () => pivotRotateSmart('tilt', -1, 'Yukarı çevrildi'));
  buttons.pivotTiltDown.addEventListener('click', () => pivotRotateSmart('tilt', 1, 'Aşağı çevrildi'));
  buttons.pivotTurnLeft.addEventListener('click', () => pivotRotateSmart('turn', 1, 'Sola çevrildi'));
  buttons.pivotTurnRight.addEventListener('click', () => pivotRotateSmart('turn', -1, 'Sağa çevrildi'));
  buttons.pivotRollLeft.addEventListener('click', () => pivotRotateSmart('roll', -1, 'Saat yönünün tersine çevrildi'));
  buttons.pivotRollRight.addEventListener('click', () => pivotRotateSmart('roll', 1, 'Saat yönünde çevrildi'));

  buttons.pyramidOnSquare.addEventListener('click', (event) => placePyramidOnSelectedSquare({ flip: event.shiftKey }));
  buttons.pyramidOnTriangle.addEventListener('click', (event) => placePyramidOnSelectedTriangle({ flip: event.shiftKey }));
  buttons.longPyramidOnSquare.addEventListener('click', (event) => placePyramidOnSelectedSquare({
    flip: event.shiftKey,
    triangleTypeId: 'long-triangle',
  }));
  buttons.longPyramidOnTriangle.addEventListener('click', (event) => placePyramidOnSelectedTriangle({
    flip: event.shiftKey,
    triangleTypeId: 'long-triangle',
  }));
  buttons.boxTemplate.addEventListener('click', placeBoxTemplate);

  buttons.validate.addEventListener('click', () => {
    updateValidation();
    setStatus('Model doğrulandı', state.lastValidation.some((item) => item.level === 'error') ? 'error' : 'good');
  });
  buttons.fixEdges.addEventListener('click', fixAllEdgeContacts);
  buttons.clear.addEventListener('click', () => {
    applyChange(() => {
      state.blocks = [];
      state.selectedId = null;
      state.selectedIds = [];
    }, 'Sahne temizlendi');
  });

  buttons.copyJson.addEventListener('click', copyJson);
  buttons.downloadJson.addEventListener('click', downloadJson);
  buttons.importJson.addEventListener('click', openImportModal);
  buttons.closeImport.addEventListener('click', closeImportModal);
  buttons.cancelImport.addEventListener('click', closeImportModal);
  buttons.applyImport.addEventListener('click', applyImport);
  dom.importModal.addEventListener('click', (event) => {
    if (event.target === dom.importModal) closeImportModal();
  });

  [dom.modelName, dom.category, dom.difficulty, dom.estimatedTime].forEach((input) => {
    input.addEventListener('input', updateJson);
  });

  [dom.posX, dom.posY, dom.posZ, dom.rotX, dom.rotY, dom.rotZ].forEach((input) => {
    input.addEventListener('change', applyInspector);
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
    videoScanner?.destroy();
    imageScanner?.destroy();
  });
}

function onPointerDown(event) {
  pointerDown = {
    x: event.clientX,
    y: event.clientY,
    button: event.button,
    time: performance.now(),
  };
}

function onPointerUp(event) {
  if (!pointerDown || pointerDown.button !== 0) return;

  const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  const elapsed = performance.now() - pointerDown.time;
  pointerDown = null;

  if (distance > 5 || elapsed > 650) return;

  setRayFromEvent(event);
  const attachHit = raycaster.intersectObjects(attachmentRoot.children, true).find((item) => item.object.userData.attachFace);

  if (attachHit) {
    chooseAttachmentFace(attachHit.object.userData.attachFace);
    return;
  }

  const hit = blockHitFromPointer();

  if (hit) {
    selectBlock(hit.blockId, { toggle: event.shiftKey || event.metaKey || event.ctrlKey });
    return;
  }

  if (state.pendingAttach) {
    const block = state.blocks.find((item) => item.id === state.pendingAttach.blockId);
    const targetLabel = pendingAttachmentLabel(block, state.pendingAttach.faceId);
    setStatus(`${targetLabel} bekliyor · soldan blok tıkla`, 'snap');
    return;
  }

  if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
    clearSelection();
  }
}

function onDropBlock(event) {
  event.preventDefault();
  const typeId = event.dataTransfer.getData('text/plain') || state.activeTypeId;
  state.activeTypeId = typeId;
  updatePalette();

  if (state.pendingAttach) {
    addBlockToPendingFace(typeId);
  } else {
    placeActiveBlock(event, typeId);
  }
}

function placeActiveBlock(event, typeId) {
  const type = blockType(typeId);
  const orientation = resolvedPlacementOrientation();
  const position = placementPositionFromEvent(event, type, orientation);
  if (!position) return;

  applyChange(() => {
    const block = createBlockRecord({
      typeId,
      color: state.activeColor,
      orientation,
      position,
      rotation: { x: 0, y: 0, z: 0 },
    });
    state.blocks.push(block);
    state.selectedId = block.id;
    state.selectedIds = [block.id];
  }, 'Blok eklendi');
}

function quickAddBlock(typeId) {
  state.activeTypeId = typeId;
  updatePalette();

  if (state.pendingAttach) {
    addBlockToPendingFace(typeId);
    return;
  }

  const type = blockType(typeId);
  const orientation = resolvedPlacementOrientation();
  const position = quickPlacementPosition(type, orientation);
  if (!position) return;

  applyChange(() => {
    const block = createBlockRecord({
      typeId,
      color: state.activeColor,
      orientation,
      position,
      rotation: { x: 0, y: 0, z: 0 },
    });
    state.blocks.push(block);
    state.selectedId = block.id;
    state.selectedIds = [block.id];
  }, `${type.label} hızlı eklendi`);
}

function quickPlacementPosition(type, orientation) {
  const focused = selectedBlock();
  let x = controls?.target?.x || 0;
  let z = controls?.target?.z || 0;

  if (focused) {
    x = focused.position.x + SNAP;
    z = focused.position.z + SNAP;
  }

  let y = state.currentLayer * LAYER_HEIGHT;
  if (orientation === 'floor') {
    y += blockDepth(type) / 2;
  } else {
    y += type.height / 2;
  }

  return magnetizedPosition({
    x: snap(x),
    y,
    z: snap(z),
  }, type, orientation);
}

function resolvedPlacementOrientation(targetEdge = null) {
  if (state.orientation !== 'custom') return state.orientation;
  return selectedBlock()?.orientation || verticalOrientationForEdge(targetEdge) || 'floor';
}

function resolvedAttachmentOrientation(targetEdge) {
  if (state.placementMode === 'vertical') {
    return verticalOrientationForEdge(targetEdge) || verticalOrientationFromCamera();
  }
  if (state.placementMode === 'horizontal') {
    return 'floor';
  }
  return state.orientation;
}

function placementModeToOrientation(mode) {
  return {
    horizontal: 'floor',
    vertical: 'front',
    custom: 'custom',
  }[mode] || 'floor';
}

function verticalOrientationForEdge(targetEdge) {
  if (!targetEdge) return null;

  const direction = targetEdge.direction || new THREE.Vector3();
  const normal = targetEdge.normal || new THREE.Vector3();
  if (Math.abs(direction.y) < 0.35) {
    return Math.abs(direction.x) >= Math.abs(direction.z) ? 'front' : 'side';
  }

  return Math.abs(normal.x) >= Math.abs(normal.z) ? 'side' : 'front';
}

function verticalOrientationFromCamera() {
  const cameraDir = new THREE.Vector3();
  camera.getWorldDirection(cameraDir);
  return Math.abs(cameraDir.x) >= Math.abs(cameraDir.z) ? 'side' : 'front';
}

function placementPositionFromEvent(event, type, orientation) {
  setRayFromEvent(event);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -state.currentLayer);
  const point = new THREE.Vector3();

  if (!raycaster.ray.intersectPlane(plane, point)) {
    return null;
  }

  let x = snap(point.x);
  let z = snap(point.z);
  let y = state.currentLayer * LAYER_HEIGHT;

  if (orientation === 'floor') {
    y += blockDepth(type) / 2;
  } else {
    y += type.height / 2;
  }

  const position = { x, y, z };
  return magnetizedPosition(position, type, orientation);
}

function magnetizedPosition(position, type, orientation) {
  if (!state.magnetSnap || state.blocks.length === 0) {
    return position;
  }

  const footprint = footprintFor(type, orientation);
  const newHalfHeight = verticalHalfHeight(type, orientation);
  let best = null;

  state.blocks.forEach((block) => {
    const otherType = blockType(block.typeId);
    const otherFootprint = footprintFor(otherType, block.orientation, block.rotation?.y || 0);
    const otherHalfHeight = verticalHalfHeight(otherType, block.orientation);
    const verticalDistance = Math.abs(position.y - block.position.y);
    const candidates = [];

    if (Math.hypot(position.x - block.position.x, position.z - block.position.z) > 2.5 || verticalDistance > 1.45) return;

    if (state.edgeMode) {
      slotCenters(block.position.z, otherFootprint.z, footprint.z).forEach((z) => {
        candidates.push({
          ...position,
          x: block.position.x + otherFootprint.x / 2 + footprint.x / 2,
          z,
          snapFace: 'right',
        });
        candidates.push({
          ...position,
          x: block.position.x - otherFootprint.x / 2 - footprint.x / 2,
          z,
          snapFace: 'left',
        });
      });

      slotCenters(block.position.x, otherFootprint.x, footprint.x).forEach((x) => {
        candidates.push({
          ...position,
          x,
          z: block.position.z + otherFootprint.z / 2 + footprint.z / 2,
          snapFace: 'back',
        });
        candidates.push({
          ...position,
          x,
          z: block.position.z - otherFootprint.z / 2 - footprint.z / 2,
          snapFace: 'front',
        });
      });

      if (position.y > block.position.y + 0.35) {
        const stackY = block.position.y + otherHalfHeight + newHalfHeight;
        slotCenters(block.position.x, otherFootprint.x, footprint.x).forEach((x) => {
          slotCenters(block.position.z, otherFootprint.z, footprint.z).forEach((z) => {
            candidates.push({ x, y: stackY, z, snapFace: 'top' });
          });
        });
      }
    } else {
      candidates.push({ ...position, x: block.position.x, z: block.position.z, snapFace: 'center' });
    }

    candidates.forEach((candidate) => {
      candidate.x = snap(candidate.x);
      candidate.z = snap(candidate.z);
      if (candidate.y === undefined) candidate.y = position.y;
      const candidateDistance = Math.hypot(candidate.x - position.x, candidate.z - position.z) + verticalDistance * 0.08;

      if (!best || candidateDistance < best.distance) {
        best = { position: candidate, distance: candidateDistance, snapFace: candidate.snapFace };
      }
    });
  });

  if (best && best.distance <= 0.35) {
    setStatus(`Mıknatıs: ${best.snapFace} kenarı`, 'snap');
    return best.position;
  }

  return position;
}

function setRayFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function blockHitFromPointer() {
  const pickables = [];
  blockRoot.traverse((object) => {
    if (object.userData.pickableBlock) pickables.push(object);
  });

  const hits = raycaster.intersectObjects(pickables, false);
  if (!hits.length) return null;

  const hit = hits[0];
  return {
    blockId: hit.object.userData.blockId,
    distance: hit.distance,
    point: hit.point,
  };
}

function createBlockRecord({ typeId, color, orientation, position, rotation, attachment, stepNumber }) {
  const id = state.nextId++;
  const cleanedAttachment = cleanAttachment(attachment);
  return {
    id,
    stepNumber: normalizedStepNumber(stepNumber, state.blocks.length ? nextStepNumber() : id),
    typeId,
    color,
    orientation,
    position: roundVector(position),
    rotation: {
      x: normalizeDegrees(rotation?.x || 0),
      y: normalizeDegrees(rotation?.y || 0),
      z: normalizeDegrees(rotation?.z || 0),
    },
    attachment: cleanedAttachment,
  };
}

function rebuildScene() {
  blockRoot.clear();
  blockObjects.clear();

  state.blocks.forEach((block) => {
    const object = createBlockObject(block);
    blockRoot.add(object);
    blockObjects.set(block.id, object);
  });

  updateSelectionHelper();
}

function createBlockObject(block) {
  const type = blockType(block.typeId);
  const group = new THREE.Group();
  group.name = `${type.label} #${block.id}`;
  group.userData.blockId = block.id;
  group.position.set(block.position.x, block.position.y, block.position.z);
  group.quaternion.copy(quaternionForBlock(block));

  const material = new THREE.MeshStandardMaterial({
    color: block.color,
    roughness: 0.48,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: edgeColor(block.color),
    transparent: true,
    opacity: 0.58,
  });

  const geometry = panelGeometry(type);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.blockId = block.id;
  mesh.userData.pickableBlock = true;
  group.add(mesh);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), edgeMaterial);
  group.add(edges);

  addMagnetDots(group, type);

  return group;
}

function panelGeometry(type) {
  const depth = blockDepth(type);
  switch (type.id) {
    case 'triangle':
    case 'long-triangle':
      return extrudedPolygon([
        [-type.width / 2, -type.height / 2],
        [type.width / 2, -type.height / 2],
        [0, type.height / 2],
      ], [], depth);
    case 'right-triangle':
      return extrudedPolygon([
        [-type.width / 2, -type.height / 2],
        [type.width / 2, -type.height / 2],
        [-type.width / 2, type.height / 2],
      ], [], depth);
    case 'semicircle':
      return semicircleGeometry(type.width, type.height, depth);
    case 'stairs':
      return stairsGeometry(type.width, type.height, depth);
    case 'window':
      return windowGeometry(type.width, type.height, depth);
    case 'tunnel':
      return tunnelGeometry(type.width, type.height, depth);
    default:
      return new THREE.BoxGeometry(type.width, type.height, depth, 2, 2, 1);
  }
}

function blockDepth(type) {
  return Number.isFinite(type.depth) ? type.depth : THICKNESS;
}

function extrudedPolygon(points, holes = [], depth = THICKNESS) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  holes.forEach((holePoints) => {
    const hole = new THREE.Path();
    holePoints.forEach(([x, y], index) => {
      if (index === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    });
    hole.closePath();
    shape.holes.push(hole);
  });

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function semicircleGeometry(width, height, depth) {
  return extrudedPolygon(semicircleOutlinePoints(width, height), [], depth);
}

function stairsGeometry(width, height, depth) {
  const steps = 4;
  const stepWidth = width / steps;
  const stepHeight = height / steps;
  const points = [[-width / 2, -height / 2]];

  for (let index = 0; index < steps; index += 1) {
    points.push(
      [-width / 2 + index * stepWidth, -height / 2 + (index + 1) * stepHeight],
      [-width / 2 + (index + 1) * stepWidth, -height / 2 + (index + 1) * stepHeight]
    );
  }

  points.push([width / 2, -height / 2]);
  return extrudedPolygon(points, [], depth);
}

function windowGeometry(width, height, depth) {
  const opening = width * 0.32;
  const bar = 0.04;
  return extrudedPolygon(
    [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ],
    [
      [[-opening, bar], [-bar, bar], [-bar, opening], [-opening, opening]],
      [[bar, bar], [opening, bar], [opening, opening], [bar, opening]],
      [[-opening, -opening], [-bar, -opening], [-bar, -bar], [-opening, -bar]],
      [[bar, -opening], [opening, -opening], [opening, -bar], [bar, -bar]],
    ],
    depth
  );
}

function tunnelGeometry(width, height, depth) {
  const outerRadius = width / 2;
  const springY = height - outerRadius;
  const wallThickness = width * 0.14;
  const innerRadius = outerRadius - wallThickness;
  const innerLeft = width / 2 - innerRadius;
  const innerRight = width / 2 + innerRadius;
  const shape = new THREE.Shape();

  shape.moveTo(0, 0);
  shape.lineTo(innerLeft, 0);
  shape.lineTo(innerLeft, springY);
  shape.absarc(width / 2, springY, innerRadius, Math.PI, 0, true);
  shape.lineTo(innerRight, 0);
  shape.lineTo(width, 0);
  shape.lineTo(width, springY);
  shape.absarc(width / 2, springY, outerRadius, 0, Math.PI, false);
  shape.lineTo(0, 0);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function addMagnetDots(group, type) {
  const dotMaterial = new THREE.MeshStandardMaterial({
    color: '#121820',
    roughness: 0.7,
    metalness: 0.2,
  });
  const dotGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.018, 20);
  const depth = blockDepth(type);
  const insetX = Math.min(0.28, type.width * 0.28);
  const insetY = Math.min(0.28, type.height * 0.28);
  const positions = [
    [-type.width / 2 + insetX, -type.height / 2 + insetY],
    [type.width / 2 - insetX, -type.height / 2 + insetY],
    [-type.width / 2 + insetX, type.height / 2 - insetY],
    [type.width / 2 - insetX, type.height / 2 - insetY],
  ];

  if (type.width > 1.2) {
    positions.push([0, -type.height / 2 + insetY], [0, type.height / 2 - insetY]);
  }

  positions.forEach(([x, y]) => {
    const front = new THREE.Mesh(dotGeometry, dotMaterial);
    front.rotation.x = Math.PI / 2;
    front.position.set(x, y, depth / 2 + 0.012);
    front.castShadow = true;
    group.add(front);

    const back = front.clone();
    back.position.z = -depth / 2 - 0.012;
    group.add(back);
  });
}

function applyOrientation(object, orientation) {
  const orientationQuat = new THREE.Quaternion();
  if (orientation === 'floor') {
    orientationQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  } else if (orientation === 'side') {
    orientationQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  }
  object.quaternion.premultiply(orientationQuat);
}

function updateSelectionHelper() {
  if (selectionHelper) {
    scene.remove(selectionHelper);
    selectionHelper.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    selectionHelper = null;
  }
  clearAttachmentHandles();

  const blocks = selectedBlocks();
  if (!blocks.length) return;

  selectionHelper = new THREE.Group();
  selectionHelper.name = 'Selection Helpers';

  blocks.forEach((block) => {
    const selectedObject = blockObjects.get(block.id);
    if (!selectedObject) return;

    const outline = createSelectionOutline(block, selectedObject);
    outline.renderOrder = 20;
    selectionHelper.add(outline);
  });

  scene.add(selectionHelper);

  if (blocks.length === 1) {
    const block = blocks[0];
    const selectedObject = blockObjects.get(block.id);
    if (selectedObject) {
      updateAttachmentHandles(block, selectedObject);
    }
  }
}

function clearAttachmentHandles() {
  attachmentRoot?.clear();
}

function updateAttachmentHandles(block, selectedObject) {
  const edges = blockEdgeAnchors(block, selectedObject);
  const handleOffset = 0.28;

  edges.forEach((edge) => {
    const position = edge.mid.clone().addScaledVector(edge.normal, handleOffset);
    const isPending = state.pendingAttach?.blockId === state.selectedId && state.pendingAttach?.faceId === edge.id;

    const handle = new THREE.Mesh(attachHandleGeometry, attachHandleMaterial);
    handle.position.copy(position);
    handle.scale.setScalar(isPending ? 1.45 : 1);
    handle.renderOrder = 40;
    handle.userData.attachFace = edge.id;
    handle.userData.attachLabel = edge.label;
    attachmentRoot.add(handle);

    const ring = new THREE.Mesh(attachRingGeometry, attachRingMaterial);
    ring.position.copy(position);
    ring.scale.setScalar(isPending ? 1.65 : 1);
    ring.renderOrder = 39;
    ring.userData.attachFace = edge.id;
    ring.userData.attachLabel = edge.label;
    ring.userData.isAttachRing = true;
    attachmentRoot.add(ring);
  });

  const topAnchor = topStackAnchorForBlock(block);
  if (topAnchor) {
    const isPending = state.pendingAttach?.blockId === block.id
      && state.pendingAttach?.faceId === TOP_STACK_FACE_ID;
    const topHandleOffset = 0.58;
    const position = topAnchor.position.clone().addScaledVector(topAnchor.normal, topHandleOffset);

    const handle = new THREE.Mesh(attachHandleGeometry, attachHandleMaterial);
    handle.position.copy(position);
    handle.scale.setScalar(isPending ? 1.55 : 1.08);
    handle.renderOrder = 42;
    handle.userData.attachFace = TOP_STACK_FACE_ID;
    handle.userData.attachLabel = 'Üst yüzey';
    attachmentRoot.add(handle);

    const ring = new THREE.Mesh(attachRingGeometry, attachRingMaterial);
    ring.position.copy(position);
    ring.scale.setScalar(isPending ? 1.75 : 1.08);
    ring.renderOrder = 41;
    ring.userData.attachFace = TOP_STACK_FACE_ID;
    ring.userData.attachLabel = 'Üst yüzey';
    ring.userData.isAttachRing = true;
    attachmentRoot.add(ring);
  }
}

function createSelectionOutline(block, object) {
  const points = [];
  blockEdgeAnchors(block, object).forEach((edge) => {
    points.push(edge.p1, edge.p2);
  });

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: '#36c2b4',
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });

  return new THREE.LineSegments(geometry, material);
}

function loadStarterModel() {
  state.blocks = [
    createBlockRecord({
      typeId: 'large-square',
      color: COLORS[0],
      orientation: 'floor',
      position: { x: -0.75, y: THICKNESS / 2, z: 0 },
    }),
    createBlockRecord({
      typeId: 'rectangle',
      color: COLORS[1],
      orientation: 'floor',
      position: { x: 1.25, y: THICKNESS / 2, z: 0 },
    }),
    createBlockRecord({
      typeId: 'square',
      color: COLORS[2],
      orientation: 'front',
      position: { x: -1.25, y: 0.5, z: -1.08 },
    }),
    createBlockRecord({
      typeId: 'square',
      color: COLORS[3],
      orientation: 'front',
      position: { x: -0.25, y: 0.5, z: -1.08 },
    }),
    createBlockRecord({
      typeId: 'triangle',
      color: COLORS[3],
      orientation: 'front',
      position: { x: -0.75, y: 1.5, z: -1.08 },
    }),
    createBlockRecord({
      typeId: 'tunnel',
      color: COLORS[4],
      orientation: 'front',
      position: { x: 1.25, y: 0.59, z: -1.08 },
    }),
  ];
  state.selectedId = state.blocks[0].id;
  state.selectedIds = [state.selectedId];
}

function applyChange(mutator, message, options = {}) {
  const { enforceAutoSymmetry = true } = options;
  state.undoStack.push(captureBlocks());
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];

  mutator();
  sanitizeState();
  if (state.autoSymmetry && enforceAutoSymmetry) {
    stabilizeEdgeAttachments(4, { enforceAutoSymmetry });
    sanitizeState();
  }
  rebuildScene();
  updateEverything();
  if (message) setStatus(message, 'good');
}

function captureBlocks() {
  return JSON.stringify({
    blocks: state.blocks.map(cleanBlock),
    selectedId: state.selectedId,
    selectedIds: state.selectedIds,
    nextId: state.nextId,
    modelInfo: {
      name: dom.modelName.value,
      category: dom.category.value,
      difficulty: dom.difficulty.value,
      estimatedTime: dom.estimatedTime.value,
    },
  });
}

function restoreBlocks(snapshot) {
  const parsed = JSON.parse(snapshot);
  state.blocks = parsed.blocks.map(cleanBlock);
  state.selectedId = parsed.selectedId;
  state.selectedIds = Array.isArray(parsed.selectedIds)
    ? parsed.selectedIds.map(Number).filter(Number.isFinite)
    : (parsed.selectedId ? [Number(parsed.selectedId)] : []);
  state.nextId = parsed.nextId || nextIdFromBlocks();
  if (parsed.modelInfo) {
    dom.modelName.value = parsed.modelInfo.name || dom.modelName.value;
    dom.category.value = parsed.modelInfo.category || dom.category.value;
    dom.difficulty.value = parsed.modelInfo.difficulty || dom.difficulty.value;
    dom.estimatedTime.value = parsed.modelInfo.estimatedTime || dom.estimatedTime.value;
  }
  sanitizeState();
  if (state.autoSymmetry) {
    stabilizeEdgeAttachments();
    sanitizeState();
  }
  rebuildScene();
  updateEverything();
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(captureBlocks());
  restoreBlocks(state.undoStack.pop());
  setStatus('Geri alındı', 'snap');
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(captureBlocks());
  restoreBlocks(state.redoStack.pop());
  setStatus('İleri alındı', 'snap');
}

function duplicateSelected() {
  const blocks = selectedBlocks();
  if (!blocks.length) return;

  applyChange(() => {
    const copies = blocks.map((block) => createBlockRecord({
      ...block,
      position: {
        x: snap(block.position.x + 0.5),
        y: block.position.y,
        z: snap(block.position.z + 0.5),
      },
      rotation: { ...block.rotation },
      attachment: block.attachment,
    }));

    copies.forEach((copy) => state.blocks.push(copy));
    state.selectedId = copies.at(-1)?.id || null;
    state.selectedIds = copies.map((copy) => copy.id);
  }, blocks.length > 1 ? `${blocks.length} blok çoğaltıldı` : 'Blok çoğaltıldı');
}

function randomizeModelColors() {
  if (!state.blocks.length) {
    setStatus('Renklendirilecek blok yok', 'warn');
    return;
  }

  applyChange(() => {
    state.blocks.forEach((block) => {
      block.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    });

    const selected = selectedBlock();
    if (selected) state.activeColor = selected.color;
  }, `${state.blocks.length} blok rastgele renklendirildi`);
}

function chooseAttachmentFace(faceId) {
  const block = selectedBlock();
  if (faceId === TOP_STACK_FACE_ID) {
    if (!block || !topStackAnchorForBlock(block)) return;

    state.pendingAttach = { blockId: block.id, faceId };
    updateSelectionHelper();
    updateInspector();
    setStatus('Üst yüzey seçildi · soldan blok tıkla', 'snap');
    return;
  }

  const edge = block ? edgeAnchorForBlock(block, faceId) : null;
  if (!edge || !block) return;

  state.pendingAttach = { blockId: block.id, faceId };
  updateSelectionHelper();
  updateInspector();
  setStatus(`${edge.label} seçildi · soldan blok tıkla`, 'snap');
}

function pendingAttachmentLabel(block, faceId) {
  if (faceId === TOP_STACK_FACE_ID) return 'Üst yüzey';
  return block ? edgeAnchorForBlock(block, faceId)?.label || 'Seçili kenar' : 'Seçili kenar';
}

function topStackAnchorForBlock(block) {
  if (!block || block.orientation !== 'floor') return null;

  const faceNormal = faceNormalForQuaternion(quaternionForBlock(block));
  if (Math.abs(faceNormal.y) < 0.85) return null;
  if (faceNormal.y < 0) faceNormal.negate();

  const type = blockType(block.typeId);
  const center = new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  return {
    normal: faceNormal,
    position: center.addScaledVector(faceNormal, blockDepth(type) / 2),
  };
}

function addBlockToTopSurface(typeId, baseBlock) {
  const topAnchor = topStackAnchorForBlock(baseBlock);
  if (!topAnchor) {
    state.pendingAttach = null;
    updateSelectionHelper();
    updateInspector();
    setStatus('Üst yüzey artık yatay değil', 'warn');
    return;
  }

  const type = blockType(typeId);
  const distanceFromSurface = blockDepth(type) / 2;
  const position = topAnchor.position.clone().addScaledVector(topAnchor.normal, distanceFromSurface);

  applyChange(() => {
    const block = createBlockRecord({
      typeId,
      color: state.activeColor,
      orientation: baseBlock.orientation,
      position,
      rotation: { ...baseBlock.rotation },
    });
    state.blocks.push(block);
    state.selectedId = block.id;
    state.selectedIds = [block.id];
    state.pendingAttach = null;
  }, `${type.label} üst yüzeye eklendi`);
}

function tryTopStackPlacement(type, targetEdge, baseBlock, orientation) {
  if (orientation === 'floor') return null;

  const isTopEdge = /üst|top/i.test(targetEdge?.label || '');
  if (!isTopEdge) return null;

  if (!targetEdge?.normal || targetEdge.normal.y < 0.8) return null;

  const rectangularTypes = ['square', 'rectangle', 'large-square', 'window', 'tunnel'];
  if (!rectangularTypes.includes(type.id)) return null;

  const baseType = blockType(baseBlock.typeId);

  return {
    score: 0,
    orientation: baseBlock.orientation,
    position: {
      x: baseBlock.position.x,
      y: baseBlock.position.y + baseType.height,
      z: baseBlock.position.z,
    },
    rotation: {
      x: baseBlock.rotation.x,
      y: baseBlock.rotation.y,
      z: baseBlock.rotation.z,
    },
    attachment: {
      mode: 'edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: 'bottom',
    },
    message: `${targetEdge.label} üstüne düz yerleşti`,
  };
}

function addBlockToPendingFace(typeId) {
  const target = state.pendingAttach;
  if (!target) return;

  const baseBlock = state.blocks.find((block) => block.id === target.blockId);
  if (target.faceId === TOP_STACK_FACE_ID) {
    if (!baseBlock) {
      state.pendingAttach = null;
      setStatus('Üst yüzey hedefi bulunamadı', 'warn');
      return;
    }
    addBlockToTopSurface(typeId, baseBlock);
    return;
  }

  const baseObject = blockObjects.get(target.blockId);
  const targetEdge = baseBlock ? edgeAnchorForBlock(baseBlock, target.faceId, baseObject) : null;
  if (!baseBlock || !baseObject || !targetEdge) {
    state.pendingAttach = null;
    setStatus('Yapıştırma hedefi bulunamadı', 'warn');
    return;
  }

  const type = blockType(typeId);
  const isTriangleType = isTriangleBlockType(type);
  const userOrientation = resolvedAttachmentOrientation(targetEdge);
  let placement = null;
  let bridgeRejectMessage = null;

  if (type.id === 'right-triangle' && isVerticalPanelTarget(baseBlock, targetEdge)) {
    placement = rightTriangleEndAttachment(type, baseBlock, targetEdge);
  }

  const supportsSymmetryBridge = type.id === 'triangle' || type.id === 'long-triangle';
  if (!placement && supportsSymmetryBridge && state.autoSymmetry) {
    if (type.id === 'long-triangle') {
      const bridgeAttempts = [
        () => longTriangleChainBridgePlacement(type, targetEdge, baseBlock),
        () => triangleBridgePlacement(type, targetEdge, baseBlock),
        () => longTriangleApexDownBridgePlacement(type, userOrientation, targetEdge, baseBlock),
      ];
      let bridgePlacement = null;

      bridgeAttempts.some((attempt) => {
        const candidate = attempt();
        if (candidate?.rejected) {
          bridgeRejectMessage = candidate.message;
          return false;
        }
        if (!candidate) return false;

        bridgePlacement = candidate;
        return true;
      });

      if (bridgePlacement) {
        placement = {
          ...bridgePlacement,
          message: `long triangle bridge placement · ${bridgePlacement.message || targetEdge.label}`,
        };
      } else if (bridgeRejectMessage) {
        setStatus(bridgeRejectMessage, 'warn');
      }
    } else {
      placement = triangleBridgePlacement(type, targetEdge, baseBlock);
    }
  }

  if (!placement && type.id === 'right-triangle' && isVerticalPanelTarget(baseBlock, targetEdge)) {
    const endPlacement = rightTriangleEndAttachment(type, baseBlock, targetEdge);
    placement = endPlacement || customEdgeAttachmentFor(type, baseBlock, targetEdge);
    if (placement && !endPlacement) {
      placement = {
        ...placement,
        message: `${targetEdge.label} üzerine dik kareyle aynı düzlemde sağ üçgen yerleşti`,
      };
    }
  }

  if (!placement && type.id !== 'long-triangle' && userOrientation === 'custom') {
    placement = customEdgeAttachmentFor(type, baseBlock, targetEdge);
  }

  if (!placement && isTriangleType) {
    if (type.id === 'long-triangle') {
      let fallbackRejectMessage = null;
      const acceptFallback = (candidate) => {
        if (candidate?.rejected) {
          fallbackRejectMessage = candidate.message;
          return null;
        }
        return candidate;
      };

      placement = acceptFallback(longTriangleChainSideFallback(type, userOrientation, targetEdge, baseBlock))
        || acceptFallback(longTriangleSingleEdgeFallback(type, userOrientation, targetEdge, baseBlock));

      if (!placement && fallbackRejectMessage) {
        setStatus(fallbackRejectMessage, 'warn');
      }
    } else {
      placement = triangleEdgeSnapFor(type, userOrientation, targetEdge, baseBlock);
    }
  }

  if (!placement && !isTriangleType) {
    placement = directPlacementModeAttachment(type, userOrientation, targetEdge, baseBlock);
  }

  if (!placement) {
    placement = orientationPreservingAttachment(type, userOrientation, targetEdge, baseBlock, baseObject);
    if (placement && type.id === 'long-triangle') {
      const fallbackLabel = placement.attachment?.blockEdgeId === 'edge-0'
        ? 'long triangle base-edge fallback'
        : 'long triangle side-edge fallback';
      placement = {
        ...placement,
        message: `${fallbackLabel} · ${placement.message}`,
      };
    }
  }

  if (!placement) {
    placement = edgeAttachmentFor(type, userOrientation, targetEdge, baseBlock, baseObject)
      || tryTopStackPlacement(type, targetEdge, baseBlock, userOrientation);
    if (placement && type.id === 'long-triangle') {
      const fallbackLabel = placement.attachment?.blockEdgeId === 'edge-0'
        ? 'long triangle base-edge fallback'
        : 'long triangle side-edge fallback';
      placement = {
        ...placement,
        message: `${fallbackLabel} · ${placement.message || targetEdge.label}`,
      };
    }
  }

  if (!placement) {
    setStatus('Uygun yerleşim bulunamadı', 'warn');
    return;
  }

  applyChange(() => {
    placement.adjustments?.forEach((adjustment) => {
      const adjustedBlock = state.blocks.find((block) => block.id === adjustment.blockId);
      if (!adjustedBlock) return;

      adjustedBlock.position = roundVector(adjustment.position);
      adjustedBlock.rotation = {
        x: normalizeDegrees(adjustment.rotation.x),
        y: normalizeDegrees(adjustment.rotation.y),
        z: normalizeDegrees(adjustment.rotation.z),
      };
    });

    const block = createBlockRecord({
      typeId,
      color: state.activeColor,
      orientation: placement.orientation || userOrientation,
      position: placement.position,
      rotation: placement.rotation,
      attachment: placement.attachment || null,
    });
    state.blocks.push(block);
    state.selectedId = block.id;
    state.selectedIds = [block.id];
    state.pendingAttach = null;
  }, placement.message || `${targetEdge.label} bloğa yapıştı`);
}

function deleteSelected() {
  const selectedIds = selectedBlocks().map((block) => block.id);
  if (!selectedIds.length) return;

  applyChange(() => {
    state.blocks = state.blocks.filter((block) => !selectedIds.includes(block.id));
    state.selectedId = state.blocks.at(-1)?.id || null;
    state.selectedIds = state.selectedId ? [state.selectedId] : [];
  }, selectedIds.length > 1 ? `${selectedIds.length} blok silindi` : 'Blok silindi');
}

function rotateSelected(axis, degrees) {
  const block = selectedBlock();
  if (!block) return;

  applyChange(() => {
    block.rotation[axis] = normalizeDegrees(block.rotation[axis] + degrees);
  }, `${axis.toUpperCase()} ekseninde döndü`);
}

function mirrorSelected(axis) {
  const block = selectedBlock();
  if (!block) return;

  applyChange(() => {
    block.position[axis] *= -1;
    if (axis === 'x') block.rotation.y = normalizeDegrees(-block.rotation.y);
    if (axis === 'z') block.rotation.x = normalizeDegrees(-block.rotation.x);
  }, `${axis.toUpperCase()} aynalandı`);
}

function pivotRotate(direction) {
  if (state.pivot !== 'center') {
    pivotRotateSmart('tilt', direction, 'Menteşe döndürme uygulandı');
    return;
  }

  pivotRotateAxis(state.pivotAxis, direction, 'Pivot döndürme uygulandı');
}

function pivotRotateAxis(axis, direction, message = 'Pivot döndürme uygulandı') {
  const axisVector = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  }[axis];

  rotateSelectedAroundAxis(axisVector, axis, direction, message);
}

function pivotRotateSmart(mode, direction, message) {
  const block = selectedBlock();
  if (!block) return;

  let axisVector = null;
  let rotationKey = null;
  let hingeOptions = null;

  if (mode === 'tilt') {
    hingeOptions = customAttachmentHingeForPivot(block);
    axisVector = hingeOptions?.axis || hingeAxisForPivot(block) || new THREE.Vector3(1, 0, 0);
  } else if (mode === 'turn') {
    axisVector = new THREE.Vector3(0, 1, 0);
    rotationKey = 'y';
  } else if (mode === 'roll') {
    axisVector = faceNormalForBlock(block) || new THREE.Vector3(0, 0, 1);
  }

  rotateSelectedAroundAxis(axisVector, rotationKey, direction, message, hingeOptions);
}

function rotateSelectedAroundAxis(axisVector, rotationKey, direction, message, options = null) {
  const block = selectedBlock();
  const object = block ? blockObjects.get(block.id) : null;
  if (!block || !object || !axisVector || axisVector.lengthSq() < 0.001) return;

  const step = Math.max(1, Math.abs(Number(dom.pivotAngle.value || 15)));
  const angle = step * direction;
  const pivot = options?.point || pivotPointFor(block);
  const axis = axisVector.clone().normalize();
  const rad = THREE.MathUtils.degToRad(angle);
  const rotatedTransform = rotateTransformAroundLine(block, currentBlockTransform(block), pivot, axis, rad);
  if (!rotatedTransform) return;
  const nextTransform = options?.targetEdge && options?.blockEdgeId
    ? alignTransformEdgeToTarget(block, options.blockEdgeId, rotatedTransform, options.targetEdge) || rotatedTransform
    : rotatedTransform;
  const stableRotation = rotationKey
    ? { key: rotationKey, sign: 1 }
    : (options ? null : localRotationForWorldAxis(block, axis));

  applyChange(() => {
    block.position = nextTransform.position;
    block.rotation = stableRotation
      ? {
        ...block.rotation,
        [stableRotation.key]: normalizeDegrees(block.rotation[stableRotation.key] + angle * stableRotation.sign),
      }
      : nextTransform.rotation;
  }, message, { enforceAutoSymmetry: false });
}

function customAttachmentHingeForPivot(block) {
  const context = looseCustomAttachmentContextForBlock(block);
  if (!context) return null;

  return {
    point: context.targetEdge.mid.clone(),
    axis: context.targetEdge.direction.clone().normalize(),
    targetEdge: context.targetEdge,
    blockEdgeId: context.attachment.blockEdgeId,
  };
}

function localRotationForWorldAxis(block, worldAxis) {
  const transform = currentBlockTransform(block);
  const localAxes = {
    x: new THREE.Vector3(1, 0, 0).applyQuaternion(transform.quaternion).normalize(),
    y: new THREE.Vector3(0, 1, 0).applyQuaternion(transform.quaternion).normalize(),
    z: new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion).normalize(),
  };

  return Object.entries(localAxes)
    .map(([key, axis]) => {
      const dot = axis.dot(worldAxis);
      return { key, score: Math.abs(dot), sign: dot < 0 ? -1 : 1 };
    })
    .filter((entry) => entry.score > 0.985)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function pivotPointFor(block) {
  const object = blockObjects.get(block.id);
  if (!object) {
    return new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  }

  const pendingEdge = pendingPivotEdgeFor(block);
  if (pendingEdge) {
    return pendingEdge.mid.clone();
  }

  const localPivot = pivotLocalPointForType(blockType(block.typeId), state.pivot);
  if (!localPivot) {
    return new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  }

  object.updateMatrixWorld(true);
  return localPivot.applyMatrix4(object.matrixWorld);
}

function pivotLocalPointForType(type, pivotName) {
  if (pivotName === 'center') {
    return new THREE.Vector3(0, 0, 0);
  }

  const outline = shapeOutlinePoints(type);
  if (!outline.length) {
    return new THREE.Vector3(0, 0, 0);
  }

  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const [vertical = 'center', horizontal = 'center'] = pivotParts(pivotName);
  const targetX = pivotTargetCoordinate(minX, maxX, horizontal);
  const targetY = pivotTargetCoordinate(minY, maxY, vertical);
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const candidates = [
    new THREE.Vector2((minX + maxX) / 2, (minY + maxY) / 2),
    ...outline.map(([x, y]) => new THREE.Vector2(x, y)),
    ...outline.map(([x, y], index) => {
      const [nextX, nextY] = outline[(index + 1) % outline.length];
      return new THREE.Vector2((x + nextX) / 2, (y + nextY) / 2);
    }),
  ];

  const best = candidates.reduce((currentBest, point) => {
    const score = Math.abs(point.x - targetX) / width + Math.abs(point.y - targetY) / height;
    if (!currentBest || score < currentBest.score) {
      return { point, score };
    }
    return currentBest;
  }, null);

  return localPanelPoint(best?.point || new THREE.Vector2(0, 0));
}

function pivotTargetCoordinate(min, max, placement) {
  if (placement === 'left' || placement === 'bottom') return min;
  if (placement === 'right' || placement === 'top') return max;
  return (min + max) / 2;
}

function pivotParts(pivot) {
  if (pivot === 'center') return ['center', 'center'];
  if (pivot === 'top') return ['top', 'center'];
  if (pivot === 'bottom') return ['bottom', 'center'];
  if (pivot === 'left') return ['center', 'left'];
  if (pivot === 'right') return ['center', 'right'];
  return pivot.split('-');
}

function hingeAxisForPivot(block) {
  const edge = pendingPivotEdgeFor(block) || edgeAnchorForBlock(block, pivotEdgeIdFor(block));
  return edge?.direction.clone().normalize() || null;
}

function pendingPivotEdgeFor(block) {
  if (!block || state.pendingAttach?.blockId !== block.id) return null;
  return edgeAnchorForBlock(block, state.pendingAttach.faceId);
}

function pivotEdgeIdFor(block) {
  const [vertical = 'center', horizontal = 'center'] = pivotParts(state.pivot);
  const edges = shapeEdgesForType(blockType(block.typeId));
  let candidates = [];

  if (vertical === 'bottom') {
    candidates = edges.filter((edge) => edge.normal.y < -0.45);
  } else if (vertical === 'top') {
    candidates = edges.filter((edge) => edge.normal.y > 0.45);
  } else if (horizontal === 'left') {
    candidates = edges.filter((edge) => edge.normal.x < -0.45);
  } else if (horizontal === 'right') {
    candidates = edges.filter((edge) => edge.normal.x > 0.45);
  }

  return candidates.sort((a, b) => b.length - a.length)[0]?.id || null;
}

function faceNormalForBlock(block) {
  const object = blockObjects.get(block.id);
  if (!object) return null;

  object.updateMatrixWorld(true);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

function insertTemplate(items, message) {
  applyChange(() => {
    const insertedBlocks = createTemplateBlocks(items);
    state.blocks.push(...insertedBlocks);
    state.selectedId = state.blocks.at(-1)?.id || null;
    state.selectedIds = state.selectedId ? [state.selectedId] : [];
  }, message);
}

function replaceWithTemplate(items, message) {
  applyChange(() => {
    state.blocks = createTemplateBlocks(items);
    state.activeColor = items[0]?.color || state.activeColor;
    state.selectedId = state.blocks.at(-1)?.id || null;
    state.selectedIds = state.selectedId ? [state.selectedId] : [];
  }, message);
}

function placeBoxTemplate() {
  const selected = selectedBlock();
  const items = boxTemplate();
  if (!selected || selected.typeId !== 'square') {
    replaceWithTemplate(items, 'Kutu şablonu yüklendi');
    return;
  }

  insertBoxTemplateOnSelectedSquare(items, selected);
}

function insertBoxTemplateOnSelectedSquare(items, baseBlock) {
  const anchor = items[0]?.position || { x: 0, y: 0, z: 0 };
  const target = {
    x: baseBlock.position.x,
    y: baseBlock.position.y,
    z: baseBlock.position.z,
  };
  const delta = {
    x: target.x - anchor.x,
    y: target.y - anchor.y,
    z: target.z - anchor.z,
  };
  const firstStepNumber = nextStepNumber();

  applyChange(() => {
    const blockByTemplateIndex = new Map([[0, baseBlock]]);
    items.slice(1).forEach((item, itemOffset) => {
      const templateIndex = itemOffset + 1;
      const baseTemplateBlock = blockByTemplateIndex.get(item.attachment?.baseItemIndex);
      const attachment = item.attachment && baseTemplateBlock
        ? {
          mode: 'custom-edge',
          baseBlockId: baseTemplateBlock.id,
          baseEdgeId: item.attachment.baseEdgeId,
          blockEdgeId: item.attachment.blockEdgeId,
        }
        : null;
      const block = createBlockRecord({
        typeId: item.typeId,
        color: item.color || state.activeColor,
        orientation: item.orientation || state.orientation,
        position: {
          x: item.position.x + delta.x,
          y: item.position.y + delta.y,
          z: item.position.z + delta.z,
        },
        rotation: item.rotation || { x: 0, y: 0, z: 0 },
        attachment,
        stepNumber: firstStepNumber + itemOffset,
      });
      state.blocks.push(block);
      blockByTemplateIndex.set(templateIndex, block);
    });

    const newIds = state.blocks.slice(-Math.max(0, items.length - 1)).map((block) => block.id);
    state.selectedId = newIds.at(-1) || baseBlock.id;
    state.selectedIds = newIds.length ? newIds : [baseBlock.id];
  }, 'Seçili kareye kutu eklendi');
}

function createTemplateBlocks(items) {
  const insertedBlocks = [];
  items.forEach((item) => {
    const attachment = templateAttachmentFor(item.attachment, insertedBlocks);
    const block = createBlockRecord({
      typeId: item.typeId,
      color: item.color || state.activeColor,
      orientation: item.orientation || state.orientation,
      position: item.position,
      rotation: item.rotation || { x: 0, y: 0, z: 0 },
      attachment,
      stepNumber: item.stepNumber,
    });
    insertedBlocks.push(block);
  });
  return insertedBlocks;
}

function templateAttachmentFor(attachment, insertedBlocks) {
  if (!attachment) return null;
  const baseBlock = insertedBlocks[attachment.baseItemIndex];
  if (!baseBlock) return null;

  return {
    mode: 'custom-edge',
    baseBlockId: baseBlock.id,
    baseEdgeId: attachment.baseEdgeId,
    blockEdgeId: attachment.blockEdgeId,
  };
}

function placePyramidOnSelectedSquare({ flip = false, triangleTypeId = 'triangle' } = {}) {
  const square = selectedBlock();
  if (!square) {
    setStatus('Önce bir kare blok seç', 'warn');
    return;
  }

  const squareType = blockType(square.typeId);
  const triType = blockType(triangleTypeId);
  const isSquareShape = squareType
    && (squareType.id === 'square' || squareType.id === 'large-square' || squareType.id === 'window');
  if (!isSquareShape) {
    setStatus('Piramit için bir kare seç (Kare 1x1)', 'warn');
    return;
  }

  const baseSpan = squareType.width;
  const halfSpan = baseSpan / 2;
  const triBase = triType.width;
  const triHeight = triType.height;
  if (Math.abs(baseSpan - triBase) > 0.001) {
    setStatus(`${triType.label} piramidi için ${triBase}x${triBase} kare gerekli`, 'warn');
    return;
  }

  const apexHeightSq = triHeight * triHeight - halfSpan * halfSpan;
  if (apexHeightSq <= 1e-4) {
    setStatus('Üçgen bu kareye piramit yapacak kadar uzun değil', 'warn');
    return;
  }
  const apexHeight = Math.sqrt(apexHeightSq);

  const squareQuat = quaternionForBlock(square);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(squareQuat).normalize();
  const v = new THREE.Vector3(0, 1, 0).applyQuaternion(squareQuat).normalize();
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(squareQuat).normalize();
  if (flip) n.negate();
  const center = new THREE.Vector3(square.position.x, square.position.y, square.position.z);
  const apexPoint = center.clone().add(n.clone().multiplyScalar(apexHeight));

  const outwardDirs = [
    v.clone(),
    v.clone().negate(),
    u.clone(),
    u.clone().negate(),
  ];

  const placements = outwardDirs.map((outward) => {
    const baseMid = center.clone().add(outward.clone().multiplyScalar(halfSpan));
    const apexDir = apexPoint.clone().sub(baseMid).normalize();
    const hingeDir = new THREE.Vector3().crossVectors(n, outward).normalize();
    const faceNormal = new THREE.Vector3().crossVectors(hingeDir, apexDir).normalize();

    const matrix = new THREE.Matrix4().makeBasis(hingeDir, apexDir, faceNormal);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const position = baseMid.clone().add(apexDir.clone().multiplyScalar(triHeight / 2));

    const canonical = canonicalTransformForBlock({}, { position, quaternion });
    return {
      typeId: triType.id,
      color: square.color || state.activeColor,
      orientation: canonical.orientation,
      position: canonical.position,
      rotation: canonical.rotation,
    };
  });

  applyChange(() => {
    placements.forEach((placement) => {
      state.blocks.push(createBlockRecord(placement));
    });
    const newIds = state.blocks.slice(-placements.length).map((block) => block.id);
    state.selectedId = newIds.at(-1) || null;
    state.selectedIds = newIds;
  }, `4 ${triType.label.toLowerCase()} ile piramit eklendi`, { enforceAutoSymmetry: false });
}

function placePyramidOnSelectedTriangle({ flip = false, triangleTypeId = 'triangle' } = {}) {
  const base = selectedBlock();
  if (!base) {
    setStatus('Önce bir üçgen blok seç', 'warn');
    return;
  }

  const baseType = blockType(base.typeId);
  if (!baseType || baseType.id !== 'triangle') {
    setStatus('Piramit için eşkenar üçgen seç', 'warn');
    return;
  }

  const triType = blockType(triangleTypeId);
  const side = baseType.width;
  const baseTriHeight = baseType.height;
  const triHeight = triType.height;
  if (Math.abs(side - triType.width) > 0.001) {
    setStatus(`${triType.label} piramidi için kenarı ${triType.width} olan eşkenar üçgen seç`, 'warn');
    return;
  }

  const apexHeightSq = triHeight * triHeight - (baseTriHeight / 3) ** 2;
  if (apexHeightSq <= 1e-4) {
    setStatus('Üçgen bu tabana piramit yapacak kadar uzun değil', 'warn');
    return;
  }
  const apexHeight = Math.sqrt(apexHeightSq);

  const verts2D = [
    new THREE.Vector2(-side / 2, -baseTriHeight / 2),
    new THREE.Vector2(side / 2, -baseTriHeight / 2),
    new THREE.Vector2(0, baseTriHeight / 2),
  ];
  const centroid2D = new THREE.Vector2(0, -baseTriHeight / 6);

  const baseQuat = quaternionForBlock(base);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(baseQuat).normalize();
  const v = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuat).normalize();
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(baseQuat).normalize();
  if (flip) n.negate();
  const baseCenter = new THREE.Vector3(base.position.x, base.position.y, base.position.z);

  const centroidWorld = baseCenter.clone()
    .add(u.clone().multiplyScalar(centroid2D.x))
    .add(v.clone().multiplyScalar(centroid2D.y));
  const apexPoint = centroidWorld.clone().add(n.clone().multiplyScalar(apexHeight));

  const edges = [
    [verts2D[0], verts2D[1]],
    [verts2D[1], verts2D[2]],
    [verts2D[2], verts2D[0]],
  ];

  const placements = edges.map(([p, q]) => {
    const midLocal = p.clone().add(q).multiplyScalar(0.5);
    const midWorld = baseCenter.clone()
      .add(u.clone().multiplyScalar(midLocal.x))
      .add(v.clone().multiplyScalar(midLocal.y));

    const edgeDir2D = q.clone().sub(p).normalize();
    const hingeDir = u.clone().multiplyScalar(edgeDir2D.x)
      .add(v.clone().multiplyScalar(edgeDir2D.y))
      .normalize();

    const apexDir = apexPoint.clone().sub(midWorld).normalize();
    const faceNormal = new THREE.Vector3().crossVectors(hingeDir, apexDir).normalize();

    const matrix = new THREE.Matrix4().makeBasis(hingeDir, apexDir, faceNormal);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const position = midWorld.clone().add(apexDir.clone().multiplyScalar(triHeight / 2));

    const canonical = canonicalTransformForBlock({}, { position, quaternion });
    return {
      typeId: triType.id,
      color: base.color || state.activeColor,
      orientation: canonical.orientation,
      position: canonical.position,
      rotation: canonical.rotation,
    };
  });

  applyChange(() => {
    placements.forEach((placement) => {
      state.blocks.push(createBlockRecord(placement));
    });
    const newIds = state.blocks.slice(-placements.length).map((block) => block.id);
    state.selectedId = newIds.at(-1) || null;
    state.selectedIds = newIds;
  }, `3 ${triType.label.toLowerCase()} ile piramit eklendi`, { enforceAutoSymmetry: false });
}

function applyInspector() {
  const block = selectedBlock();
  if (!block) return;

  applyChange(() => {
    block.position = roundVector({
      x: Number(dom.posX.value || 0),
      y: Number(dom.posY.value || 0),
      z: Number(dom.posZ.value || 0),
    });
    block.rotation = {
      x: normalizeDegrees(Number(dom.rotX.value || 0)),
      y: normalizeDegrees(Number(dom.rotY.value || 0)),
      z: normalizeDegrees(Number(dom.rotZ.value || 0)),
    };
  }, 'Seçim güncellendi');
}

function assignStepToSelection() {
  const blocks = selectedBlocks();
  if (!blocks.length) {
    setStatus('Step atanacak seçim yok', 'warn');
    return;
  }

  const stepNumber = normalizedStepNumber(dom.stepNumber.value, 1);
  applyChange(() => {
    const selectedIds = new Set(blocks.map((block) => block.id));
    state.blocks.forEach((block) => {
      if (selectedIds.has(block.id)) block.stepNumber = stepNumber;
    });
  }, `${blocks.length} blok Step ${stepNumber} içine alındı`);
}

function setLayer(layer) {
  state.currentLayer = Math.max(0, Math.min(12, layer));
  dom.layerLabel.textContent = String(state.currentLayer);
  setStatus(`Kat ${state.currentLayer}`, 'snap');
}

function toggleSetting(key, button, label) {
  state[key] = !state[key];
  button.classList.toggle('active', state[key]);
  setStatus(`${label} ${state[key] ? 'açık' : 'kapalı'}`, state[key] ? 'snap' : 'warn');
}

function selectBlock(id, options = {}) {
  const toggle = Boolean(options.toggle);
  if (toggle) {
    if (state.selectedIds.includes(id)) {
      state.selectedIds = state.selectedIds.filter((item) => item !== id);
      state.selectedId = state.selectedIds.at(-1) || null;
    } else {
      state.selectedIds = [...state.selectedIds, id];
      state.selectedId = id;
    }
  } else {
    state.selectedId = id;
    state.selectedIds = id ? [id] : [];
  }

  state.pendingAttach = null;
  const block = selectedBlock();
  if (block) {
    state.activeColor = block.color;
    state.activeTypeId = block.typeId;
  }
  updateSelectionHelper();
  updateEverything();
  const count = selectedBlocks().length;
  if (!count) {
    setStatus('Seçim yok', 'snap');
  } else if (count === 1 && block) {
    setStatus(`${blockType(block.typeId).label} seçildi · kenar seç`, 'snap');
  } else {
    setStatus(`${count} blok seçildi · Açıları Eşitle hazır`, 'snap');
  }
}

function clearSelection() {
  if (!state.selectedId && !state.selectedIds.length && !state.pendingAttach) return;

  state.selectedId = null;
  state.selectedIds = [];
  state.pendingAttach = null;
  updateSelectionHelper();
  updateEverything();
  setStatus('Seçim temizlendi', 'snap');
}

function selectedBlock() {
  return state.blocks.find((block) => block.id === state.selectedId) || null;
}

function selectedBlocks() {
  if (state.selectedIds.length) {
    return state.selectedIds
      .map((id) => state.blocks.find((block) => block.id === id))
      .filter(Boolean);
  }
  return state.selectedId ? [selectedBlock()].filter(Boolean) : [];
}

function updateEverything() {
  updatePalette();
  updateColors();
  updatePlacementMode();
  updateInspector();
  updateStats();
  updateValidation();
  updateJson();
  updateButtons();
}

function updatePalette() {
  document.querySelectorAll('.block-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.typeId === state.activeTypeId);
  });
}

function updateColors() {
  document.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.classList.toggle('active', normalizeColor(swatch.title) === normalizeColor(state.activeColor));
  });
}

function updatePlacementMode() {
  updateSegmented('#placementModeControls button', state.placementMode, 'placementMode');
}

function updateInspector() {
  const blocks = selectedBlocks();
  const block = selectedBlock();
  const multiple = blocks.length > 1;
  const inputs = [dom.posX, dom.posY, dom.posZ, dom.rotX, dom.rotY, dom.rotZ];
  inputs.forEach((input) => {
    input.disabled = !block || multiple;
  });
  dom.stepNumber.disabled = !blocks.length;
  buttons.assignStep.disabled = !blocks.length;

  if (!blocks.length) {
    dom.selectedSummary.innerHTML = '<strong>Seçili blok yok</strong><span>Sahneden bir blok seç.</span>';
    dom.stepNumber.value = '1';
    inputs.forEach((input) => {
      input.value = '';
    });
    return;
  }

  if (multiple) {
    const customCount = selectedCustomAttachmentContexts().length;
    const selectedSteps = [...new Set(blocks.map((item) => normalizedStepNumber(item.stepNumber, 1)))].sort((a, b) => a - b);
    dom.selectedSummary.innerHTML = `
      <strong>${blocks.length} blok seçili</strong>
      <span>Step ${selectedSteps.join(', ')} · ${customCount} blok custom menteşe ile okunabiliyor</span>
    `;
    dom.stepNumber.value = selectedSteps.length === 1 ? String(selectedSteps[0]) : '';
    inputs.forEach((input) => {
      input.value = '';
    });
    return;
  }

  const type = blockType(block.typeId);
  const pendingFaceLabel = state.pendingAttach?.blockId === block.id
    ? pendingAttachmentLabel(block, state.pendingAttach.faceId)
    : null;
  const customAttachment = customAttachmentContextForBlock(block);
  dom.selectedSummary.innerHTML = `
    <strong>${type.label}</strong>
    <span>#${block.id} · Step ${block.stepNumber} · ${orientationLabel(block.orientation)} · ${placementModeLabel(state.placementMode)} · ${block.color}${pendingFaceLabel ? ` · ${pendingFaceLabel} üzerine yapıştır` : customAttachment ? ' · custom menteşe hazır' : ' · kenar veya üst yüzey seç'}</span>
  `;
  dom.stepNumber.value = String(block.stepNumber);
  dom.posX.value = niceNumber(block.position.x);
  dom.posY.value = niceNumber(block.position.y);
  dom.posZ.value = niceNumber(block.position.z);
  dom.rotX.value = niceNumber(block.rotation.x);
  dom.rotY.value = niceNumber(block.rotation.y);
  dom.rotZ.value = niceNumber(block.rotation.z);
}

function updateStats() {
  const maxY = state.blocks.reduce((max, block) => Math.max(max, block.position.y), 0);
  dom.blockCount.textContent = String(state.blocks.length);
  dom.stepCount.textContent = String(logicalStepCount());
  dom.heightCount.textContent = niceNumber(maxY);
}

function updateValidation() {
  const items = validateModel();
  state.lastValidation = items;
  dom.validationList.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.level;
    li.textContent = item.text;
    dom.validationList.appendChild(li);
  });

  const warnCount = items.filter((item) => item.level !== 'ok').length;
  dom.warnCount.textContent = String(warnCount);
}

function validateModel() {
  const items = [];

  if (state.blocks.length === 0) {
    return [{ level: 'warn', text: 'Sahne boş. Paletten blok seçip viewport içine tıkla.' }];
  }

  items.push({ level: 'ok', text: `${state.blocks.length} blok sahnede çiziliyor.` });

  const boxes = state.blocks
    .map((block) => {
      const object = blockObjects.get(block.id);
      if (!object) return null;
      const box = new THREE.Box3().setFromObject(object);
      box.expandByScalar(-0.035);
      return { block, box };
    })
    .filter(Boolean);

  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxes[i].box.intersectsBox(boxes[j].box)) {
        overlaps.push(`#${boxes[i].block.id} / #${boxes[j].block.id}`);
      }
    }
  }

  if (overlaps.length) {
    items.push({ level: 'warn', text: `Üst üste binen bloklar: ${overlaps.slice(0, 4).join(', ')}` });
  } else {
    items.push({ level: 'ok', text: 'Blok çakışması görünmüyor.' });
  }

  const floating = state.blocks.filter((block) => block.position.y > 1.05 && !hasNearbySupport(block));
  if (floating.length) {
    items.push({ level: 'warn', text: `Desteksiz yüksek bloklar: ${floating.map((block) => `#${block.id}`).slice(0, 5).join(', ')}` });
  } else {
    items.push({ level: 'ok', text: 'Yüksek bloklar için yakın destek var.' });
  }

  const offAxisBlocks = [];
  state.blocks.forEach((block, index) => {
    if (block.attachment) return;
    const rx = Math.round(block.rotation.x) % 15;
    const ry = Math.round(block.rotation.y) % 15;
    const rz = Math.round(block.rotation.z) % 15;
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      offAxisBlocks.push(`Step ${block.stepNumber} / #${block.id} (${block.rotation.x}°, ${block.rotation.y}°, ${block.rotation.z}°)`);
    }
  });
  if (offAxisBlocks.length) {
    items.push({ level: 'warn', text: `Açılar 15° katı değil: ${offAxisBlocks.slice(0, 4).join(' · ')}` });
  }

  const edgeReport = edgeContactAudit();
  if (edgeReport.contacts > 0) {
    const message = `${edgeReport.contacts} yakın kenar teması bulundu. Maks kaçıklık ${niceNumber(edgeReport.maxEndpointError)}u, açı ${niceNumber(edgeReport.maxAngleDeg)}°`;
    items.push({
      level: edgeReport.needsFix ? 'warn' : 'ok',
      text: edgeReport.needsFix ? `${message}. Kenarları Sıkıştır önerilir.` : `${message}.`,
    });
  }

  const apexReport = triangleApexContactAudit();
  if (apexReport.contacts > 0) {
    const message = `${apexReport.contacts} yakın tepe teması bulundu. Maks açıklık ${niceNumber(apexReport.maxDistance)}u`;
    items.push({
      level: apexReport.needsFix ? 'warn' : 'ok',
      text: apexReport.needsFix ? `${message}. Kenarları Sıkıştır tepeyi kapatır.` : `${message}.`,
    });
  }

  return items;
}

function edgeContactAudit() {
  const constraints = inferEdgeContactConstraints();
  const maxEndpointError = constraints.reduce((max, item) => Math.max(max, item.endpointError), 0);
  const maxAngleDeg = constraints.reduce((max, item) => Math.max(max, item.angleDeg), 0);
  return {
    contacts: constraints.length,
    maxEndpointError,
    maxAngleDeg,
    needsFix: constraints.some((item) =>
      item.endpointError > EDGE_CONTACT_FIX.settledEndpointError
      || item.angleDeg > EDGE_CONTACT_FIX.settledAngleDeg
    ),
  };
}

function triangleApexContactAudit() {
  const clusters = triangleApexContactClusters();
  const maxDistance = clusters.reduce((max, cluster) => Math.max(max, cluster.maxDistance), 0);
  return {
    contacts: clusters.length,
    maxDistance,
    needsFix: maxDistance > APEX_CONTACT_FIX.settledDistance,
  };
}

function fixAllEdgeContacts() {
  if (state.blocks.length < 2) {
    setStatus('Hizalanacak kenar için en az iki blok gerekli', 'warn');
    return;
  }

  const preview = edgeContactAudit();
  const apexPreview = triangleApexContactAudit();
  const hasRegisteredAttachments = state.blocks.some((block) => block.attachment?.mode === 'custom-edge');
  if (!preview.contacts && !apexPreview.contacts && !hasRegisteredAttachments) {
    setStatus('Yakın kenar teması bulunamadı', 'warn');
    return;
  }

  let result = null;
  let apexResult = null;
  applyChange(() => {
    const registeredChanged = stabilizeEdgeAttachments(3, { enforceAutoSymmetry: false });
    result = relaxGlobalEdgeContacts();
    apexResult = closeTriangleApexContacts();
    if (apexResult.changed) {
      stabilizeEdgeAttachments(2, { enforceAutoSymmetry: false });
    }
    result.changed = result.changed || registeredChanged || apexResult.changed;
    result.adjustedBlocks += apexResult.adjustedBlocks;
  }, null, { enforceAutoSymmetry: false });

  if (!result?.changed) {
    setStatus('Kenarlar zaten hizalı görünüyor', 'good');
    return;
  }

  const movedText = result.adjustedBlocks === 1 ? '1 blok' : `${result.adjustedBlocks} blok`;
  const apexText = apexResult?.changed ? ` · ${apexResult.contacts} tepe` : '';
  setStatus(
    `${movedText} düzeltildi · ${result.contacts} kenar${apexText} · max ${niceNumber(Math.max(result.maxAfter, apexResult?.maxAfter || 0))}u`,
    'good'
  );
}

function relaxGlobalEdgeContacts(options = EDGE_CONTACT_FIX) {
  const adjustedBlockIds = new Set();
  const centerBefore = modelPositionCenter();
  let changed = false;
  let contacts = 0;
  let maxBefore = 0;
  let maxAfter = 0;

  for (let pass = 0; pass < options.passes; pass += 1) {
    const constraints = inferEdgeContactConstraints(options);
    if (pass === 0) {
      contacts = constraints.length;
      maxBefore = constraints.reduce((max, item) => Math.max(max, item.endpointError), 0);
    }

    let passChanged = false;
    constraints.forEach((constraint) => {
      const applied = applyEdgeContactConstraint(constraint, options);
      if (!applied.changed) return;
      changed = true;
      passChanged = true;
      adjustedBlockIds.add(constraint.blockAId);
      adjustedBlockIds.add(constraint.blockBId);
    });

    if (!passChanged) break;
  }

  if (changed) {
    const centerAfter = modelPositionCenter();
    const recenter = centerBefore.sub(centerAfter);
    if (recenter.lengthSq() > 0.000001) {
      state.blocks.forEach((block) => {
        block.position = roundVector(new THREE.Vector3(block.position.x, block.position.y, block.position.z).add(recenter));
      });
    }
  }

  const afterConstraints = inferEdgeContactConstraints(options);
  maxAfter = afterConstraints.reduce((max, item) => Math.max(max, item.endpointError), 0);

  return {
    changed,
    contacts,
    maxBefore,
    maxAfter,
    adjustedBlocks: adjustedBlockIds.size,
  };
}

function closeTriangleApexContacts(options = APEX_CONTACT_FIX) {
  const adjustedBlockIds = new Set();
  let changed = false;
  let contacts = 0;
  let maxBefore = 0;

  for (let pass = 0; pass < options.passes; pass += 1) {
    const clusters = triangleApexContactClusters(triangleApexCandidates(options), options);
    if (pass === 0) {
      contacts = clusters.length;
      maxBefore = clusters.reduce((max, cluster) => Math.max(max, cluster.maxDistance), 0);
    }

    let passChanged = false;
    clusters.forEach((cluster) => {
      if (cluster.maxDistance <= options.settledDistance) return;

      cluster.items.forEach((candidate) => {
        const updatedCandidate = triangleApexCandidateForBlock(candidate.block, options);
        if (!updatedCandidate) return;

        const applied = rotateTriangleApexTowardAnchor(updatedCandidate, cluster.anchor, options);
        if (!applied) return;

        changed = true;
        passChanged = true;
        adjustedBlockIds.add(candidate.block.id);
      });
    });

    if (!passChanged) break;
  }

  const afterClusters = triangleApexContactClusters(triangleApexCandidates(options), options);
  const maxAfter = afterClusters.reduce((max, cluster) => Math.max(max, cluster.maxDistance), 0);

  return {
    changed,
    contacts,
    maxBefore,
    maxAfter,
    adjustedBlocks: adjustedBlockIds.size,
  };
}

function triangleApexCandidates(options = APEX_CONTACT_FIX) {
  return state.blocks
    .map((block) => triangleApexCandidateForBlock(block, options))
    .filter(Boolean);
}

function triangleApexCandidateForBlock(block) {
  const type = blockType(block?.typeId);
  if (!isTriangleBlockType(type)) return null;

  const context = looseCustomAttachmentContextForBlock(block);
  if (!context) return null;

  const attachedEdge = shapeEdgesForType(type)
    .find((edge) => edge.id === context.attachment.blockEdgeId);
  if (!attachedEdge) return null;

  const outline = shapeOutlinePoints(type)
    .map(([x, y], index) => ({ point: new THREE.Vector2(x, y), index }));
  const freeVertex = outline
    .map((entry) => ({
      ...entry,
      distance: pointToSegmentDistance2(entry.point, attachedEdge.p1, attachedEdge.p2),
    }))
    .sort((a, b) => b.distance - a.distance)[0];
  if (!freeVertex || freeVertex.distance < 0.000001) return null;

  const transform = storedBlockTransform(block);
  const localPoint = localPanelPoint(freeVertex.point);
  const point = worldPointForLocalPanelPoint(localPoint, transform);
  const featureId = triangleVertexFeatureId(type.id, freeVertex.index);
  if (!featureId) return null;

  return {
    block,
    context,
    localPoint,
    point,
    vertexIndex: freeVertex.index,
    featureId,
  };
}

function triangleApexContactClusters(candidates = triangleApexCandidates(), options = APEX_CONTACT_FIX) {
  const clusters = [];
  const used = new Set();

  candidates.forEach((candidate, index) => {
    if (used.has(index)) return;

    const queue = [index];
    const clusterIndexes = new Set([index]);
    used.add(index);

    while (queue.length) {
      const currentIndex = queue.shift();
      const current = candidates[currentIndex];
      candidates.forEach((other, otherIndex) => {
        if (clusterIndexes.has(otherIndex)) return;
        if (current.block.id === other.block.id) return;
        if (current.point.distanceTo(other.point) > options.maxClusterDistance) return;

        clusterIndexes.add(otherIndex);
        used.add(otherIndex);
        queue.push(otherIndex);
      });
    }

    const items = [...clusterIndexes].map((itemIndex) => candidates[itemIndex]);
    if (items.length < 2) return;

    const anchor = items
      .reduce((sum, item) => sum.add(item.point), new THREE.Vector3())
      .multiplyScalar(1 / items.length);
    const maxDistance = items.reduce((max, item) => Math.max(max, item.point.distanceTo(anchor)), 0);
    clusters.push({ items, anchor, maxDistance });
  });

  return clusters;
}

function rotateTriangleApexTowardAnchor(candidate, anchor, options = APEX_CONTACT_FIX) {
  const axis = candidate.context.targetEdge.direction.clone().normalize();
  if (axis.lengthSq() < 0.001) return false;

  const linePoint = candidate.context.targetEdge.p1;
  const currentRadial = radialVectorToLine(candidate.point, linePoint, axis);
  const targetRadial = radialVectorToLine(anchor, linePoint, axis);
  if (currentRadial.lengthSq() < 0.0001 || targetRadial.lengthSq() < 0.0001) return false;

  const angle = signedAngleOnAxis(currentRadial, targetRadial, axis);
  if (Math.abs(angle) < THREE.MathUtils.degToRad(0.05)) return false;

  const maxStep = THREE.MathUtils.degToRad(options.maxRotationStepDeg);
  const limitedAngle = THREE.MathUtils.clamp(angle, -maxStep, maxStep);
  const rotated = rotateTransformAroundLine(
    candidate.block,
    storedBlockTransform(candidate.block),
    linePoint,
    axis,
    limitedAngle
  );
  if (!rotated) return false;

  const aligned = alignTransformEdgeToTarget(
    candidate.block,
    candidate.context.attachment.blockEdgeId,
    rotated,
    candidate.context.targetEdge
  );
  if (!aligned) return false;

  applyBlockTransform(candidate.block, aligned);
  return true;
}

function radialVectorToLine(point, linePoint, axis) {
  return point.clone().sub(linePoint).projectOnPlane(axis);
}

function worldPointForLocalPanelPoint(localPoint, transform) {
  return localPoint.clone().applyQuaternion(transform.quaternion).add(transform.positionVector);
}

function pointToSegmentDistance2(point, start, end) {
  const segment = end.clone().sub(start);
  if (segment.lengthSq() < 0.000001) return point.distanceTo(start);

  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / segment.lengthSq(), 0, 1);
  return start.clone().add(segment.multiplyScalar(t)).distanceTo(point);
}

function triangleVertexFeatureId(typeId, vertexIndex) {
  const featureIds = {
    triangle: ['bottom-left', 'bottom-right', 'top'],
    'long-triangle': ['base-left', 'base-right', 'tip'],
    'right-triangle': ['right-angle', 'base-tip', 'top-tip'],
  }[typeId];

  return featureIds?.[vertexIndex] || null;
}

function triangleApexSnapFeatureMap(placementOrderByBlockId = null, options = APEX_CONTACT_FIX) {
  const map = new Map();
  const clusters = triangleApexContactClusters(triangleApexCandidates(options), options);

  clusters.forEach((cluster) => {
    if (cluster.maxDistance > options.maxClusterDistance) return;

    cluster.items.forEach((candidate) => {
      if (!candidate.featureId) return;
      if (placementOrderByBlockId) {
        const order = placementOrderByBlockId.get(candidate.block.id);
        const hasEarlierTarget = cluster.items.some((other) => {
          const otherOrder = placementOrderByBlockId.get(other.block.id);
          return Number.isFinite(otherOrder) && Number.isFinite(order) && otherOrder < order;
        });
        if (!hasEarlierTarget) return;
      }

      map.set(candidate.block.id, candidate.featureId);
    });
  });

  return map;
}

function inferEdgeContactConstraints(options = EDGE_CONTACT_FIX) {
  const edges = [];

  state.blocks.forEach((block) => {
    blockEdgeAnchorsForStoredBlock(block).forEach((edge) => {
      edges.push({
        ...edge,
        block,
        blockId: block.id,
        key: `${block.id}:${edge.id}`,
      });
    });
  });

  const candidates = [];
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const candidate = edgeContactCandidate(edges[i], edges[j], options);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const usedEdges = new Set();
  const constraints = [];
  candidates.forEach((candidate) => {
    if (usedEdges.has(candidate.edgeAKey) || usedEdges.has(candidate.edgeBKey)) return;
    usedEdges.add(candidate.edgeAKey);
    usedEdges.add(candidate.edgeBKey);
    constraints.push(candidate);
  });

  return constraints;
}

function edgeContactCandidate(edgeA, edgeB, options) {
  if (edgeA.blockId === edgeB.blockId) return null;

  const minLength = Math.min(edgeA.length, edgeB.length);
  const lengthGap = Math.abs(edgeA.length - edgeB.length);
  if (lengthGap > Math.max(options.maxLengthGap, minLength * 0.12)) return null;
  if (edgeA.normal.dot(edgeB.normal) > 0.92) return null;

  const map = edgeContactEndpointInfo(edgeA, edgeB);
  const endpointError = map.gap * 0.5;
  const midDistance = edgeA.mid.distanceTo(edgeB.mid);
  if (endpointError > options.maxEndpointError || midDistance > options.maxMidDistance) return null;

  const angleDeg = edgeContactAngleDeg(edgeA, edgeB, map.swapped);
  if (angleDeg > options.maxAngleDeg) return null;

  return {
    blockAId: edgeA.blockId,
    blockBId: edgeB.blockId,
    edgeAId: edgeA.id,
    edgeBId: edgeB.id,
    edgeAKey: edgeA.key,
    edgeBKey: edgeB.key,
    swapped: map.swapped,
    endpointError,
    angleDeg,
    score: endpointError * 12 + angleDeg * 0.08 + lengthGap * 4 + midDistance,
  };
}

function applyEdgeContactConstraint(constraint, options) {
  const blockA = state.blocks.find((block) => block.id === constraint.blockAId);
  const blockB = state.blocks.find((block) => block.id === constraint.blockBId);
  if (!blockA || !blockB) return { changed: false };

  let edgeA = edgeAnchorForStoredBlock(blockA, constraint.edgeAId);
  let edgeB = edgeAnchorForStoredBlock(blockB, constraint.edgeBId);
  if (!edgeA || !edgeB) return { changed: false };

  const map = edgeContactEndpointInfo(edgeA, edgeB);
  const endpointError = map.gap * 0.5;
  const angleDeg = edgeContactAngleDeg(edgeA, edgeB, map.swapped);
  if (endpointError <= options.settledEndpointError && angleDeg <= options.settledAngleDeg) {
    return { changed: false };
  }

  let changed = false;
  if (angleDeg > options.settledAngleDeg) {
    const rotated = rotateEdgesTowardSharedDirection(blockA, edgeA, blockB, edgeB, map.swapped, options);
    changed = changed || rotated;
    edgeA = edgeAnchorForStoredBlock(blockA, constraint.edgeAId);
    edgeB = edgeAnchorForStoredBlock(blockB, constraint.edgeBId);
    if (!edgeA || !edgeB) return { changed };
  }

  const translation = edgeContactTranslation(edgeA, edgeB, map.swapped);
  const half = limitedVector(translation.multiplyScalar(0.5), options.maxTranslationStep);
  if (half.lengthSq() > 0.000001) {
    translateBlock(blockA, half);
    translateBlock(blockB, half.clone().multiplyScalar(-1));
    changed = true;
  }

  return { changed };
}

function rotateEdgesTowardSharedDirection(blockA, edgeA, blockB, edgeB, swapped, options) {
  const dirA = edgeA.direction.clone().normalize();
  const dirBMatched = swapped ? edgeB.direction.clone().negate() : edgeB.direction.clone();
  if (dirA.dot(dirBMatched) < 0.96) return false;

  const shared = dirA.clone().add(dirBMatched).normalize();
  if (shared.lengthSq() < 0.001) return false;

  const targetB = swapped ? shared.clone().negate() : shared.clone();
  const maxStep = THREE.MathUtils.degToRad(options.maxRotationStepDeg);
  const qA = limitedQuaternionBetween(dirA, shared, maxStep);
  const qB = limitedQuaternionBetween(edgeB.direction.clone().normalize(), targetB, maxStep);
  let changed = false;

  if (!isIdentityQuaternion(qA)) {
    applyQuaternionAroundPoint(blockA, edgeA.mid, qA);
    changed = true;
  }

  if (!isIdentityQuaternion(qB)) {
    applyQuaternionAroundPoint(blockB, edgeB.mid, qB);
    changed = true;
  }

  return changed;
}

function edgeContactEndpointInfo(edgeA, edgeB) {
  const direct = edgeA.p1.distanceTo(edgeB.p1) + edgeA.p2.distanceTo(edgeB.p2);
  const swapped = edgeA.p1.distanceTo(edgeB.p2) + edgeA.p2.distanceTo(edgeB.p1);
  return direct <= swapped
    ? { swapped: false, gap: direct }
    : { swapped: true, gap: swapped };
}

function edgeContactAngleDeg(edgeA, edgeB, swapped) {
  const matchedB = swapped ? edgeB.direction.clone().negate() : edgeB.direction.clone();
  const dot = THREE.MathUtils.clamp(edgeA.direction.dot(matchedB), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(dot));
}

function edgeContactTranslation(edgeA, edgeB, swapped) {
  const targetA1 = swapped ? edgeB.p2 : edgeB.p1;
  const targetA2 = swapped ? edgeB.p1 : edgeB.p2;
  return targetA1.clone().sub(edgeA.p1)
    .add(targetA2.clone().sub(edgeA.p2))
    .multiplyScalar(0.5);
}

function limitedQuaternionBetween(from, to, maxRadians) {
  const fromNorm = from.clone().normalize();
  const toNorm = to.clone().normalize();
  const angle = fromNorm.angleTo(toNorm);
  if (angle < 0.0001) return new THREE.Quaternion();

  const q = new THREE.Quaternion().setFromUnitVectors(fromNorm, toNorm);
  if (angle <= maxRadians) return q;
  return new THREE.Quaternion().slerp(q, maxRadians / angle);
}

function isIdentityQuaternion(quaternion) {
  return Math.abs(quaternion.x) < 0.000001
    && Math.abs(quaternion.y) < 0.000001
    && Math.abs(quaternion.z) < 0.000001
    && Math.abs(quaternion.w - 1) < 0.000001;
}

function applyQuaternionAroundPoint(block, point, quaternion) {
  const transform = storedBlockTransform(block);
  const nextQuaternion = quaternion.clone().multiply(transform.quaternion);
  const nextPosition = transform.positionVector.clone()
    .sub(point)
    .applyQuaternion(quaternion)
    .add(point);
  applyBlockTransform(block, transformForBlock(block, nextPosition, nextQuaternion));
}

function applyBlockTransform(block, transform) {
  block.position = roundVector(transform.position);
  block.rotation = {
    x: normalizeDegrees(transform.rotation.x),
    y: normalizeDegrees(transform.rotation.y),
    z: normalizeDegrees(transform.rotation.z),
  };
}

function translateBlock(block, delta) {
  block.position = roundVector({
    x: block.position.x + delta.x,
    y: block.position.y + delta.y,
    z: block.position.z + delta.z,
  });
}

function limitedVector(vector, maxLength) {
  const length = vector.length();
  if (length <= maxLength || length < 0.000001) return vector;
  return vector.multiplyScalar(maxLength / length);
}

function modelPositionCenter() {
  if (!state.blocks.length) return new THREE.Vector3();
  const sum = state.blocks.reduce((acc, block) => acc.add(new THREE.Vector3(block.position.x, block.position.y, block.position.z)), new THREE.Vector3());
  return sum.multiplyScalar(1 / state.blocks.length);
}

function hasNearbySupport(block) {
  if (block.attachment && state.blocks.some((other) => other.id === block.attachment.baseBlockId)) {
    return true;
  }

  return state.blocks.some((other) => {
    if (other.id === block.id) return false;
    const verticalGap = block.position.y - other.position.y;
    const horizontalGap = Math.hypot(block.position.x - other.position.x, block.position.z - other.position.z);
    return verticalGap > 0 && verticalGap <= 1.2 && horizontalGap <= 1.15;
  });
}

function updateJson() {
  dom.jsonOutput.value = JSON.stringify(exportModel(), null, 2);
}

function exportModel() {
  const logicalSteps = groupedLogicalSteps();
  const stepIndexByBlockId = new Map();
  const placementOrderByBlockId = new Map();
  let placementOrder = 0;
  logicalSteps.forEach((group, stepIndex) => {
    group.blocks.forEach((block) => {
      stepIndexByBlockId.set(block.id, stepIndex);
      placementOrderByBlockId.set(block.id, placementOrder);
      placementOrder += 1;
    });
  });
  const apexSnapFeatures = triangleApexSnapFeatureMap(placementOrderByBlockId);

  const tagSteps = state.blocks.map((block) => ({
    blockType: jsonBlockType(block.typeId),
    rotation: exportWorldRotation(block),
  }));
  const steps = logicalSteps.map((group, stepIndex) => ({
    stepIndex,
    stepNumber: group.stepNumber,
    label: `Step ${group.stepNumber}`,
    placements: group.blocks.map((block) => exportStepPlacement(block, stepIndexByBlockId, stepIndex, apexSnapFeatures)),
  }));

  return {
    id: `${slugify(dom.modelName.value || 'magneticblox-model')}-${new Date().toISOString().slice(0, 10)}`,
    name: dom.modelName.value || 'Yeni MagneticBlox Modeli',
    description: 'Yerel 3D oluşturucuda kenar mıknatısı, pivot dönüşü ve katmanlı destek mantığıyla hazırlanmış MagneticBlox modeli.',
    coordinateSystem: 'ios-world-v1',
    color: normalizeColor(state.activeColor),
    locked: false,
    metadata: {
      category: dom.category.value,
      difficulty: dom.difficulty.value,
      blockCount: state.blocks.length,
      estimatedTime: dom.estimatedTime.value || `${Math.max(3, Math.ceil(state.blocks.length / 5))} dk`,
      tags: modelTags(tagSteps),
    },
    camera: modelCamera(steps.length),
    steps,
  };
}

function groupedLogicalSteps() {
  const groups = new Map();
  state.blocks.forEach((block, order) => {
    const stepNumber = normalizedStepNumber(block.stepNumber, order + 1);
    if (!groups.has(stepNumber)) groups.set(stepNumber, []);
    groups.get(stepNumber).push(block);
  });

  return [...groups.entries()]
    .sort(([first], [second]) => first - second)
    .map(([stepNumber, blocks]) => ({ stepNumber, blocks }));
}

function exportStepPlacement(block, stepIndexByBlockId, stepIndex, apexSnapFeatures = new Map()) {
  const baseBlock = block.attachment
    ? state.blocks.find((item) => item.id === block.attachment.baseBlockId)
    : null;
  const connectionInfo = buildConnectionInfo(block, baseBlock);
  const apexSnapFeature = apexSnapFeatures.get(block.id) || null;
  const snapTo = apexSnapFeature ? null : snapTargetIndexForBlock(block, stepIndexByBlockId, stepIndex);
  const snapMode = apexSnapFeature ? 'vertex' : exportSnapMode();

  return {
    blockType: jsonBlockType(block.typeId),
    color: jsonColor(block.color),
    orientation: block.orientation,
    position: exportWorldPosition(block),
    rotation: exportWorldRotation(block),
    entryDirection: entryDirectionFor(block),
    ...(stepIndex > 0 || apexSnapFeature ? { snapMode } : {}),
    ...(apexSnapFeature ? { snapFeature: apexSnapFeature } : {}),
    ...(snapTo !== null ? { snapTo } : {}),
    ...(connectionInfo ? { connectedTo: connectionInfo } : {}),
  };
}

function buildConnectionInfo(block, baseBlock) {
  if (!block?.attachment || !baseBlock) return null;

  const baseStepNumber = normalizedStepNumber(baseBlock.stepNumber, state.blocks.indexOf(baseBlock) + 1);
  const blockEdge = shapeEdgesForType(blockType(block.typeId))
    .find((edge) => edge.id === block.attachment.blockEdgeId);

  return {
    stepNumber: baseStepNumber,
    ...(block.attachment.mode === 'partial-edge' ? { attachmentMode: 'partial-edge' } : {}),
    baseEdgeId: block.attachment.baseEdgeId,
    blockEdgeId: block.attachment.blockEdgeId,
    blockEdgeLabel: blockEdge?.label || null,
    snapPoint: {
      x: roundNumber((block.position.x + baseBlock.position.x) / 2),
      y: roundNumber((block.position.y + baseBlock.position.y) / 2),
      z: roundNumber((block.position.z + baseBlock.position.z) / 2),
    },
  };
}

function jsonBlockType(typeId) {
  return {
    triangle: 'equilateral-triangle',
    'long-triangle': 'large-isosceles-triangle',
    'right-triangle': 'isosceles-right-triangle',
  }[typeId] || typeId;
}

function jsonColor(color) {
  return normalizeColor(color || COLORS[0]);
}

function internalBlockType(typeId) {
  return {
    'equilateral-triangle': 'triangle',
    'large-isosceles-triangle': 'long-triangle',
    'long-equilateral-triangle': 'long-triangle',
    'isosceles-right-triangle': 'right-triangle',
  }[typeId] || typeId || 'square';
}

function colorFromJson(color) {
  return normalizeColor(color || COLORS[0]);
}

function orientationFromJsonBlock(block) {
  if (['floor', 'front', 'side'].includes(block.orientation)) {
    return block.orientation;
  }

  const entryDirection = String(block.entryDirection || '').toLowerCase();
  if (entryDirection === 'top') return 'floor';
  if (entryDirection === 'left' || entryDirection === 'right') return 'side';
  if (entryDirection === 'front' || entryDirection === 'back') return 'front';
  return 'floor';
}

function vectorFromJson(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: Number.isFinite(Number(value[0])) ? Number(value[0]) : fallback.x,
      y: Number.isFinite(Number(value[1])) ? Number(value[1]) : fallback.y,
      z: Number.isFinite(Number(value[2])) ? Number(value[2]) : fallback.z,
    };
  }

  if (value && typeof value === 'object') {
    return {
      x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
      y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
      z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z,
    };
  }

  return { ...fallback };
}

function internalTransformFromTarget(typeId, orientation, position, rotation) {
  const worldQuaternion = quaternionFromRotation(rotation);
  const originOffset = targetOriginOffsetForType(typeId);
  const restoredPosition = new THREE.Vector3(position.x, position.y, position.z);

  if (originOffset.lengthSq() > 0) {
    restoredPosition.add(originOffset.applyQuaternion(worldQuaternion));
  }

  return {
    position: roundVector(restoredPosition),
    rotation: rotationForBlockQuaternion({ orientation }, worldQuaternion),
  };
}

function quaternionFromRotation(rotation) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotation?.x || 0),
    THREE.MathUtils.degToRad(rotation?.y || 0),
    THREE.MathUtils.degToRad(rotation?.z || 0),
    'XYZ'
  ));
}

function exportWorldRotation(block) {
  const worldEuler = new THREE.Euler().setFromQuaternion(quaternionForBlock(block), 'XYZ');

  return {
    x: normalizeDegrees(THREE.MathUtils.radToDeg(worldEuler.x)),
    y: normalizeDegrees(THREE.MathUtils.radToDeg(worldEuler.y)),
    z: normalizeDegrees(THREE.MathUtils.radToDeg(worldEuler.z)),
  };
}

function exportWorldPosition(block) {
  const position = new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  const originOffset = targetOriginOffsetForType(block.typeId);
  if (originOffset.lengthSq() > 0) {
    position.sub(originOffset.applyQuaternion(quaternionForBlock(block)));
  }
  return roundVector(position);
}

function targetOriginOffsetForType(typeId) {
  const type = blockType(typeId);

  if (typeId === 'long-triangle') {
    return new THREE.Vector3(0, type.height / 6, 0);
  }

  if (typeId === 'right-triangle') {
    return new THREE.Vector3(type.width / 6, type.height / 6, 0);
  }

  return new THREE.Vector3(0, 0, 0);
}

function exportSnapMode() {
  return state.edgeMode ? 'edge' : 'auto';
}

function snapTargetIndexForBlock(block, blockIndexById, stepIndex) {
  if (!block.attachment) return null;

  const mode = block.attachment.mode;
  if (mode !== 'custom-edge' && mode !== 'partial-edge' && mode !== 'edge') return null;

  const targetIndex = blockIndexById.get(block.attachment.baseBlockId);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= stepIndex) return null;
  return targetIndex;
}

function entryDirectionFor(block) {
  if (block.orientation === 'floor') return 'top';
  if (block.orientation === 'side') return block.position.x >= 0 ? 'right' : 'left';
  return block.position.z >= 0 ? 'back' : 'front';
}

function modelTags(steps) {
  return [
    '3d',
    ...new Set(steps.map((step) => step.blockType)),
    steps.some((step) => step.blockType.includes('triangle')) ? 'çatı' : null,
    steps.some((step) => Math.abs(step.rotation.z) === 45) ? 'çapraz' : null,
  ].filter(Boolean).slice(0, 8);
}

function modelCamera(stepCount = logicalStepCount()) {
  if (!state.blocks.length) {
    return {
      defaultPosition: { x: 4, y: 3.5, z: 5 },
      defaultLookAt: { x: 0, y: 0.7, z: 0 },
      presets: [{ forSteps: [0, 0], position: { x: 4, y: 3.5, z: 5 }, lookAt: { x: 0, y: 0.7, z: 0 } }],
    };
  }

  const xs = state.blocks.map((block) => block.position.x);
  const ys = state.blocks.map((block) => block.position.y);
  const zs = state.blocks.map((block) => block.position.z);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  const span = Math.max(3.5, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs));
  const position = {
    x: roundNumber(center.x + span * 1.45),
    y: roundNumber(Math.max(3, center.y + span * 1.15)),
    z: roundNumber(center.z + span * 1.65),
  };
  const lookAt = {
    x: roundNumber(center.x),
    y: roundNumber(Math.max(0.5, center.y + 0.25)),
    z: roundNumber(center.z),
  };
  return {
    defaultPosition: position,
    defaultLookAt: lookAt,
    presets: [{ forSteps: [0, Math.max(0, stepCount - 1)], position, lookAt }],
  };
}

async function copyJson() {
  const value = dom.jsonOutput.value;
  try {
    await navigator.clipboard.writeText(value);
    setStatus('JSON kopyalandı', 'good');
  } catch {
    dom.jsonOutput.focus();
    dom.jsonOutput.select();
    document.execCommand('copy');
    setStatus('JSON seçildi', 'warn');
  }
}

function downloadJson() {
  const name = (dom.modelName.value || 'magneticblox-model')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'magneticblox-model';
  const blob = new Blob([dom.jsonOutput.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus('JSON indirildi', 'good');
}

function openImportModal() {
  dom.importText.value = '';
  dom.importModal.classList.add('open');
  dom.importModal.setAttribute('aria-hidden', 'false');
  dom.importText.focus();
}

function closeImportModal() {
  dom.importModal.classList.remove('open');
  dom.importModal.setAttribute('aria-hidden', 'true');
}

function importBlocksFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.blocks)) return parsed.blocks;
  if (Array.isArray(parsed.buildSequence)) {
    return parsed.buildSequence
      .map((step, index) => ({
        ...(step.block || {}),
        stepNumber: normalizedStepNumber(step.stepNumber ?? Number(step.stepIndex) + 1, index + 1),
      }))
      .filter((block) => block.blockType || block.typeId || block.type);
  }
  if (!Array.isArray(parsed.steps)) return [];

  return parsed.steps.flatMap((step, index) => {
    const stepNumber = normalizedStepNumber(step.stepNumber ?? Number(step.stepIndex) + 1, index + 1);
    if (Array.isArray(step.placements) && step.placements.length) {
      return step.placements.map((placement) => ({
        ...placement,
        stepNumber: normalizedStepNumber(placement.stepNumber, stepNumber),
      }));
    }
    return [{ ...step, stepNumber }];
  });
}

function applyImport() {
  try {
    const parsed = JSON.parse(dom.importText.value);
    const importedBlocks = importBlocksFromJson(parsed);

    if (!Array.isArray(importedBlocks)) {
      throw new Error('Blok listesi bulunamadı.');
    }

    applyChange(() => {
      const usesIosWorldCoordinates = parsed.coordinateSystem === 'ios-world-v1';
      const created = importedBlocks.map((block, index) => ({
        raw: block,
        clean: (() => {
          const typeId = internalBlockType(block.typeId || block.blockType || block.type);
          const orientation = orientationFromJsonBlock(block);
          const position = vectorFromJson(block.position, { x: 0, y: THICKNESS / 2, z: 0 });
          const rotation = vectorFromJson(block.rotation, { x: 0, y: 0, z: 0 });
          const transform = usesIosWorldCoordinates
            ? internalTransformFromTarget(typeId, orientation, position, rotation)
            : { position, rotation };

          return cleanBlock({
            ...block,
            id: block.id || state.nextId++,
            stepNumber: normalizedStepNumber(block.stepNumber, index + 1),
            typeId,
            color: colorFromJson(block.color),
            orientation,
            position: transform.position,
            rotation: transform.rotation,
          });
        })(),
      }));

      created.forEach((entry, index) => {
        if (entry.clean.attachment) return;
        const connection = entry.raw.connectedTo;
        if (!connection) return;

        const referenceIndex = Number.isFinite(Number(connection.stepNumber))
          ? created.findIndex((candidate) => normalizedStepNumber(candidate.clean.stepNumber, 1) === normalizedStepNumber(connection.stepNumber, 1))
          : Number.isFinite(Number(connection.stepIndex))
            ? created.findIndex((candidate) => normalizedStepNumber(candidate.clean.stepNumber, 1) === normalizedStepNumber(Number(connection.stepIndex) + 1, 1))
            : null;
        if (referenceIndex === null || referenceIndex < 0 || referenceIndex >= created.length || referenceIndex === index) return;

        const baseClean = created[referenceIndex].clean;
        if (!connection.baseEdgeId || !connection.blockEdgeId) return;

        entry.clean.attachment = cleanAttachment({
          mode: connection.attachmentMode === 'partial-edge' ? 'partial-edge' : 'custom-edge',
          baseBlockId: baseClean.id,
          baseEdgeId: connection.baseEdgeId,
          blockEdgeId: connection.blockEdgeId,
        });
      });

      state.blocks = created.map((entry) => entry.clean);
      state.nextId = nextIdFromBlocks();
      state.selectedId = state.blocks[0]?.id || null;
      state.selectedIds = state.selectedId ? [state.selectedId] : [];
      if (parsed.name) dom.modelName.value = parsed.name;
      if (parsed.metadata?.category || parsed.category) dom.category.value = parsed.metadata?.category || parsed.category;
      if (parsed.metadata?.difficulty || parsed.difficulty) dom.difficulty.value = parsed.metadata?.difficulty || parsed.difficulty;
      if (parsed.metadata?.estimatedTime || parsed.estimatedTime) dom.estimatedTime.value = parsed.metadata?.estimatedTime || parsed.estimatedTime;
    }, 'JSON içe alındı');
    closeImportModal();
  } catch (error) {
    setStatus(`İçe alma hatası: ${error.message}`, 'error');
  }
}

function onKeyDown(event) {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (isTyping) return;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelected();
  } else if (event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelected();
  } else if (state.selectedIds.length <= 1 && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    rotateSelected('y', 90);
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key === 'ArrowLeft') {
    event.preventDefault();
    pivotRotateSmart('turn', 1, 'Sola çevrildi');
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key === 'ArrowRight') {
    event.preventDefault();
    pivotRotateSmart('turn', -1, 'Sağa çevrildi');
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key === 'ArrowUp') {
    event.preventDefault();
    pivotRotateSmart('tilt', -1, 'Yukarı çevrildi');
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key === 'ArrowDown') {
    event.preventDefault();
    pivotRotateSmart('tilt', 1, 'Aşağı çevrildi');
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    pivotRotateSmart('roll', -1, 'Saat yönünün tersine çevrildi');
  } else if (state.selectedIds.length <= 1 && state.selectedId && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    pivotRotateSmart('roll', 1, 'Saat yönünde çevrildi');
  } else if (event.key === 'Escape') {
    clearSelection();
  }
}

function updateButtons() {
  buttons.undo.disabled = state.undoStack.length === 0;
  buttons.redo.disabled = state.redoStack.length === 0;
  buttons.randomizeColors.disabled = state.blocks.length === 0;
  const selected = selectedBlock();
  const hasSelection = selectedBlocks().length > 0;
  const singleSelection = selectedBlocks().length === 1;
  [
    buttons.duplicate,
    buttons.delete,
    buttons.equalizeAngles,
  ]
    .forEach((button) => {
      button.disabled = !hasSelection;
    });
  [
    buttons.autoStand,
    buttons.rotateX,
    buttons.rotateY,
    buttons.rotateZ,
    buttons.mirrorX,
    buttons.mirrorZ,
    buttons.pivotRotateNeg,
    buttons.pivotRotatePos,
    buttons.pivotTiltUp,
    buttons.pivotTiltDown,
    buttons.pivotTurnLeft,
    buttons.pivotTurnRight,
    buttons.pivotRollLeft,
    buttons.pivotRollRight,
  ].forEach((button) => {
    button.disabled = !singleSelection;
  });
  buttons.autoStand.disabled = !singleSelection || !customAttachmentContextForBlock(selected);
  buttons.equalizeAngles.disabled = selectedCustomAttachmentContexts().length < 2;
  buttons.snapOtherEdge.disabled = !singleSelection || !canSnapTriangleOtherEdge(selected);
  buttons.assignStep.disabled = !hasSelection;
  buttons.fixEdges.disabled = state.blocks.length < 2;
  buttons.pyramidOnSquare.disabled = !singleSelection
    || !['square', 'large-square', 'window'].includes(selected?.typeId);
  buttons.pyramidOnTriangle.disabled = !singleSelection || selected?.typeId !== 'triangle';
  buttons.longPyramidOnSquare.disabled = buttons.pyramidOnSquare.disabled;
  buttons.longPyramidOnTriangle.disabled = buttons.pyramidOnTriangle.disabled;
  dom.layerLabel.textContent = String(state.currentLayer);
}

function updateSegmented(selector, activeValue, dataKey) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle('active', button.dataset[dataKey] === activeValue);
  });
}

function resizeRenderer() {
  const rect = dom.viewport.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();
  if (selectionHelper?.update) selectionHelper.update();
  updateAttachmentBillboards();
  renderer.render(scene, camera);
}

function blockType(typeId) {
  return BLOCK_TYPES.find((type) => type.id === typeId) || BLOCK_TYPES[0];
}

function blockEdgeAnchors(block, object = blockObjects.get(block.id)) {
  if (!object) return [];

  object.updateMatrixWorld(true);
  return shapeEdgesForType(blockType(block.typeId)).map((edge) => {
    const p1 = localPanelPoint(edge.p1).applyMatrix4(object.matrixWorld);
    const p2 = localPanelPoint(edge.p2).applyMatrix4(object.matrixWorld);
    const mid = localPanelPoint(edge.mid).applyMatrix4(object.matrixWorld);
    const normalTip = localPanelPoint(edge.mid.clone().add(edge.normal)).applyMatrix4(object.matrixWorld);
    const normal = normalTip.sub(mid).normalize();

    return {
      ...edge,
      p1,
      p2,
      mid,
      normal,
      direction: p2.clone().sub(p1).normalize(),
    };
  });
}

function edgeAnchorForBlock(block, edgeId, object = blockObjects.get(block.id)) {
  return blockEdgeAnchors(block, object).find((edge) => edge.id === edgeId) || null;
}

function localPanelPoint(point) {
  return new THREE.Vector3(point.x, point.y, 0);
}

function collinearEdgeChainFor(seedBlock, seedEdge, desiredLength, options = {}) {
  const { tolerance = 0.12, excludeBlockIds = [], seedSupportBlockId = null } = options;
  if (!seedBlock || !seedEdge) return null;

  const seedFaceNormal = faceNormalForBlock(seedBlock);
  if (!seedFaceNormal) return null;

  const used = new Set([seedBlock.id]);
  const orderedEdges = [seedEdge];
  const orderedBlocks = [seedBlock];
  let p1 = seedEdge.p1.clone();
  let p2 = seedEdge.p2.clone();
  let totalLength = seedEdge.length;

  if (totalLength >= desiredLength - tolerance) {
    return {
      totalLength,
      edges: orderedEdges,
      blocks: orderedBlocks,
      hinges: chainHingesFor(orderedBlocks, orderedEdges, seedSupportBlockId),
      p1,
      p2,
      mid: p1.clone().add(p2).multiplyScalar(0.5),
      direction: p2.clone().sub(p1).normalize(),
      normal: seedEdge.normal.clone(),
    };
  }

  const extend = (endpoint) => {
    let best = null;
    state.blocks.forEach((block) => {
      if (used.has(block.id)) return;
      if (excludeBlockIds.includes(block.id)) return;

      const object = blockObjects.get(block.id);
      if (!object) return;

      const blockFaceNormal = faceNormalForBlock(block);
      if (!blockFaceNormal) return;
      if (Math.abs(Math.abs(blockFaceNormal.dot(seedFaceNormal)) - 1) > 0.08) return;

      blockEdgeAnchors(block, object).forEach((edge) => {
        if (Math.abs(edge.direction.dot(seedEdge.direction)) < 0.995) return;

        const gap1 = endpoint.distanceTo(edge.p1);
        const gap2 = endpoint.distanceTo(edge.p2);
        const nearGap = Math.min(gap1, gap2);
        if (nearGap > tolerance) return;

        const nearKey = gap1 <= gap2 ? 'p1' : 'p2';
        const newEndpoint = nearKey === 'p1' ? edge.p2.clone() : edge.p1.clone();
        const added = endpoint.distanceTo(newEndpoint);
        if (added < 0.05) return;

        const score = nearGap * 12 + Math.abs(1 - Math.abs(blockFaceNormal.dot(seedFaceNormal))) * 4;
        if (!best || score < best.score) {
          best = { block, edge, score, newEndpoint, added };
        }
      });
    });
    return best;
  };

  while (totalLength + tolerance < desiredLength) {
    const extensionP1 = extend(p1);
    const extensionP2 = extend(p2);
    let pick = null;
    if (extensionP1 && extensionP2) {
      pick = extensionP1.score <= extensionP2.score
        ? { ...extensionP1, side: 'p1' }
        : { ...extensionP2, side: 'p2' };
    } else if (extensionP1) {
      pick = { ...extensionP1, side: 'p1' };
    } else if (extensionP2) {
      pick = { ...extensionP2, side: 'p2' };
    }
    if (!pick) return null;

    used.add(pick.block.id);
    orderedEdges.push(pick.edge);
    orderedBlocks.push(pick.block);
    totalLength += pick.added;
    if (pick.side === 'p1') {
      p1 = pick.newEndpoint;
    } else {
      p2 = pick.newEndpoint;
    }
  }

  if (Math.abs(totalLength - desiredLength) > tolerance) return null;

  return {
    totalLength,
    edges: orderedEdges,
    blocks: orderedBlocks,
    hinges: chainHingesFor(orderedBlocks, orderedEdges, seedSupportBlockId),
    p1,
    p2,
    mid: p1.clone().add(p2).multiplyScalar(0.5),
    direction: p2.clone().sub(p1).normalize(),
    normal: seedEdge.normal.clone(),
  };
}

function chainHingesFor(blocks, edges, seedSupportBlockId = null) {
  return blocks.map((block, index) => {
    const edge = edges[index];
    if (!block || !edge) return null;
    const supportBlockId = index === 0 ? seedSupportBlockId : blocks[index - 1]?.id;
    const hinge = supportedHingeForBlockAgainst(block, edge.id, supportBlockId)
      || supportedHingeForBlock(block, edge.id, null);
    return hinge ? { ...hinge, supportBlockId: hinge.supportBlockId || supportBlockId || null } : null;
  });
}

function supportedHingeForBlockAgainst(block, excludedEdgeId, supportBlockId) {
  if (!block || !supportBlockId) return null;

  const object = blockObjects.get(block.id);
  const supportBlock = state.blocks.find((item) => item.id === supportBlockId);
  const supportObject = supportBlock ? blockObjects.get(supportBlock.id) : null;
  if (!object || !supportBlock || !supportObject) return null;

  const edges = blockEdgeAnchors(block, object).filter((edge) => edge.id !== excludedEdgeId);
  const supportEdges = blockEdgeAnchors(supportBlock, supportObject);
  let best = null;

  edges.forEach((edge) => {
    supportEdges.forEach((supportEdge) => {
      const lengthGap = Math.abs(edge.length - supportEdge.length);
      if (lengthGap > 0.9) return;

      const midDistance = edge.mid.distanceTo(supportEdge.mid);
      if (midDistance > 1.8) return;

      const directionScore = 1 - Math.abs(edge.direction.dot(supportEdge.direction));
      const normalScore = Math.abs(1 + edge.normal.dot(supportEdge.normal));
      const endpointGap = Math.min(
        edge.p1.distanceTo(supportEdge.p1) + edge.p2.distanceTo(supportEdge.p2),
        edge.p1.distanceTo(supportEdge.p2) + edge.p2.distanceTo(supportEdge.p1)
      );
      const score = midDistance * 2.6
        + endpointGap * 1.5
        + lengthGap * 1.3
        + directionScore * 0.9
        + normalScore * 0.9;

      if (!best || score < best.score) {
        best = { edge, supportEdge, supportBlockId, score };
      }
    });
  });

  return best;
}

function chainToVirtualEdge(chain, seedEdge, labelOverride = null) {
  return {
    id: 'virtual:' + chain.edges.map((e) => e.id).join('+'),
    label: labelOverride || seedEdge.label,
    p1: chain.p1.clone(),
    p2: chain.p2.clone(),
    mid: chain.mid.clone(),
    direction: chain.direction.clone(),
    normal: chain.normal.clone(),
    length: chain.totalLength,
  };
}

function triangleBridgePlacement(type, targetEdge, baseBlock) {
  if ((type.id !== 'triangle' && type.id !== 'long-triangle') || !baseBlock) return null;

  const fixture = triangleBridgeFixture(type);
  if (!fixture) return null;

  const lengthTolerance = Math.max(0.3, fixture.edgeLength * 0.4);
  if (Math.abs(targetEdge.length - fixture.edgeLength) > lengthTolerance) {
    return null;
  }

  let bestAnchored = null;
  let bestFallback = null;
  let sawSupportedPair = false;

  state.blocks.forEach((block) => {
    if (block.id === baseBlock.id) return;

    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      if (Math.abs(edge.length - fixture.edgeLength) > lengthTolerance) return;
      if (targetEdge.mid.distanceTo(edge.mid) > fixture.edgeLength * 3) return;
      const hasSupportedPair = Boolean(
        supportedHingeForBlock(baseBlock, targetEdge.id, block.id)
        && supportedHingeForBlock(block, edge.id, baseBlock.id)
      );
      if (hasSupportedPair) {
        sawSupportedPair = true;
      }

      const anchoredPlacement = triangleBridgePlacementAnchored(
        fixture,
        targetEdge,
        baseBlock,
        block,
        edge
      );
      const scoredAnchoredPlacement = scoreLongTriangleBridgePlacement(type, anchoredPlacement, targetEdge, baseBlock);
      if (scoredAnchoredPlacement && (!bestAnchored || scoredAnchoredPlacement.score < bestAnchored.score)) {
        bestAnchored = scoredAnchoredPlacement;
      }

      if (hasSupportedPair) return;

      const hingedPlacement = triangleBridgePlacementWithHinge(fixture, targetEdge, baseBlock, block, edge);
      const scoredHingedPlacement = scoreLongTriangleBridgePlacement(type, hingedPlacement, targetEdge, baseBlock);
      if (scoredHingedPlacement && (!bestFallback || scoredHingedPlacement.score < bestFallback.score)) {
        bestFallback = scoredHingedPlacement;
      }

      const placement = trianglePlacementForEdgePair(fixture, targetEdge, edge);
      if (!placement) return;
      const scoredPlacement = scoreLongTriangleBridgePlacement(type, placement, targetEdge, baseBlock);
      if (!scoredPlacement) return;
      if (scoredHingedPlacement && scoredHingedPlacement.score <= scoredPlacement.score + 0.35) return;

      if (!bestFallback || scoredPlacement.score < bestFallback.score) {
        bestFallback = scoredPlacement;
      }
    });
  });

  if (bestAnchored) {
    return bestAnchored;
  }

  if (sawSupportedPair) {
    return null;
  }

  const maxScore = type.id === 'long-triangle' ? 5.2 : 3.9;
  return bestFallback && bestFallback.score <= maxScore ? bestFallback : null;
}

function scoreLongTriangleBridgePlacement(type, placement, targetEdge, baseBlock) {
  if (!placement || type.id !== 'long-triangle') return placement;

  const quaternion = quaternionForBlock({
    typeId: type.id,
    orientation: placement.orientation || 'front',
    rotation: placement.rotation || { x: 0, y: 0, z: 0 },
  });
  const apex = localPanelPoint(new THREE.Vector2(0, type.height / 2))
    .applyQuaternion(quaternion)
    .add(new THREE.Vector3(placement.position.x, placement.position.y, placement.position.z));
  const inwardScore = longTriangleInwardScore(
    { positionVector: new THREE.Vector3(placement.position.x, placement.position.y, placement.position.z) },
    apex,
    targetEdge,
    baseBlock
  );

  if (inwardScore >= 100) return null;

  return {
    ...placement,
    score: placement.score + inwardScore,
  };
}

function triangleBridgePlacementAnchored(fixture, targetEdge, baseBlock, partnerBlock, partnerEdge) {
  const anchorCandidates = bridgeAnchorCandidates(targetEdge, partnerEdge, [baseBlock.id, partnerBlock.id]);
  if (!anchorCandidates.length) return null;

  const baseHinge = supportedHingeForBlock(baseBlock, targetEdge.id, partnerBlock.id);
  const partnerHinge = supportedHingeForBlock(partnerBlock, partnerEdge.id, baseBlock.id);
  if (!baseHinge || !partnerHinge) return null;

  let bestSymmetric = null;
  let bestFlexible = null;

  anchorCandidates.slice(0, 16).forEach((candidate) => {
    const symmetricPlacement = equalAngleAnchoredTrianglePlacement(
      fixture,
      candidate,
      baseBlock,
      targetEdge.id,
      baseHinge,
      partnerBlock,
      partnerEdge.id,
      partnerHinge
    );
    if (symmetricPlacement && (!bestSymmetric || symmetricPlacement.score < bestSymmetric.score)) {
      bestSymmetric = symmetricPlacement;
    }

    let candidateBest = null;
    for (let partnerAngle = -75; partnerAngle <= 75; partnerAngle += 3) {
      const placement = evaluateAnchoredTriangleBridgeRotation(
        fixture,
        candidate,
        baseBlock,
        targetEdge.id,
        baseHinge,
        partnerBlock,
        partnerEdge.id,
        partnerHinge,
        0,
        partnerAngle
      );

      if (placement && (!candidateBest || placement.score < candidateBest.score)) {
        candidateBest = placement;
      }
    }

    for (let baseAngle = -18; baseAngle <= 18; baseAngle += 3) {
      for (let partnerAngle = -75; partnerAngle <= 75; partnerAngle += 3) {
        const placement = evaluateAnchoredTriangleBridgeRotation(
          fixture,
          candidate,
          baseBlock,
          targetEdge.id,
          baseHinge,
          partnerBlock,
          partnerEdge.id,
          partnerHinge,
          baseAngle,
          partnerAngle
        );

        if (placement && (!candidateBest || placement.score < candidateBest.score)) {
          candidateBest = placement;
        }
      }
    }

    if (candidateBest && (!bestFlexible || candidateBest.score < bestFlexible.score)) {
      bestFlexible = candidateBest;
    }
  });

  if (bestSymmetric) {
    return bestSymmetric;
  }

  let best = bestFlexible;
  if (!best) return null;

  const refinedStartBase = Math.round(best.baseAngleDeg) - 4;
  const refinedEndBase = Math.round(best.baseAngleDeg) + 4;
  const refinedStartPartner = Math.round(best.partnerAngleDeg) - 4;
  const refinedEndPartner = Math.round(best.partnerAngleDeg) + 4;

  for (let baseAngle = refinedStartBase; baseAngle <= refinedEndBase; baseAngle += 1) {
    for (let partnerAngle = refinedStartPartner; partnerAngle <= refinedEndPartner; partnerAngle += 1) {
      const placement = evaluateAnchoredTriangleBridgeRotation(
        fixture,
        best.anchorData,
        baseBlock,
        targetEdge.id,
        baseHinge,
        partnerBlock,
        partnerEdge.id,
        partnerHinge,
        baseAngle,
        partnerAngle
      );

      if (placement && placement.score < best.score) {
        best = placement;
      }
    }
  }

  best = refineAnchoredTriangleBalance(
    fixture,
    best,
    baseBlock,
    targetEdge.id,
    baseHinge,
    partnerBlock,
    partnerEdge.id,
    partnerHinge
  );

  return best && best.score <= 4.8 ? best : null;
}

function equalAngleAnchoredTrianglePlacement(
  fixture,
  anchorData,
  baseBlock,
  baseEdgeId,
  baseHinge,
  partnerBlock,
  partnerEdgeId,
  partnerHinge
) {
  let best = null;
  const signPairs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (let magnitude = 0; magnitude <= 96; magnitude += 1) {
    signPairs.forEach(([baseSign, partnerSign]) => {
      const placement = evaluateAnchoredTriangleBridgeRotation(
        fixture,
        anchorData,
        baseBlock,
        baseEdgeId,
        baseHinge,
        partnerBlock,
        partnerEdgeId,
        partnerHinge,
        baseSign * magnitude,
        partnerSign * magnitude
      );

      if (placement && (!best || placement.score < best.score)) {
        best = placement;
      }
    });
  }

  if (!best) return null;

  const magnitude = (Math.abs(best.baseAngleDeg) + Math.abs(best.partnerAngleDeg)) / 2;
  const baseSign = best.baseAngleDeg === 0 ? 1 : Math.sign(best.baseAngleDeg);
  const partnerSign = best.partnerAngleDeg === 0 ? 1 : Math.sign(best.partnerAngleDeg);

  for (let candidateMagnitude = Math.max(0, magnitude - 3); candidateMagnitude <= magnitude + 3; candidateMagnitude += 0.2) {
    const placement = evaluateAnchoredTriangleBridgeRotation(
      fixture,
      anchorData,
      baseBlock,
      baseEdgeId,
      baseHinge,
      partnerBlock,
      partnerEdgeId,
      partnerHinge,
      baseSign * candidateMagnitude,
      partnerSign * candidateMagnitude
    );

    if (placement && placement.score < best.score) {
      best = placement;
    }
  }

  return best;
}

function refineAnchoredTriangleBalance(
  fixture,
  best,
  baseBlock,
  baseEdgeId,
  baseHinge,
  partnerBlock,
  partnerEdgeId,
  partnerHinge
) {
  if (!best?.anchorData) return best;
  if (!baseHinge || !partnerHinge) return best;

  let balancedBest = best;
  const baseSign = best.baseAngleDeg === 0
    ? (best.partnerAngleDeg === 0 ? 1 : Math.sign(best.partnerAngleDeg))
    : Math.sign(best.baseAngleDeg);
  const partnerSign = best.partnerAngleDeg === 0
    ? (best.baseAngleDeg === 0 ? 1 : Math.sign(best.baseAngleDeg))
    : Math.sign(best.partnerAngleDeg);
  const targetMagnitude = (Math.abs(best.baseAngleDeg) + Math.abs(best.partnerAngleDeg)) / 2;

  for (let magnitude = Math.max(0, targetMagnitude - 18); magnitude <= targetMagnitude + 18; magnitude += 1) {
    for (let spread = -8; spread <= 8; spread += 1) {
      const baseAngle = baseSign * Math.max(0, magnitude + spread * 0.5);
      const partnerAngle = partnerSign * Math.max(0, magnitude - spread * 0.5);
      const placement = evaluateAnchoredTriangleBridgeRotation(
        fixture,
        best.anchorData,
        baseBlock,
        baseEdgeId,
        baseHinge,
        partnerBlock,
        partnerEdgeId,
        partnerHinge,
        baseAngle,
        partnerAngle
      );

      if (!placement) continue;

      const placementBalance = angleBalanceGap(placement.baseAngleDeg, placement.partnerAngleDeg);
      const bestBalance = angleBalanceGap(balancedBest.baseAngleDeg, balancedBest.partnerAngleDeg);

      if (placementBalance + 0.2 < bestBalance && placement.score <= balancedBest.score + 0.35) {
        balancedBest = placement;
        continue;
      }

      if (Math.abs(placementBalance - bestBalance) <= 0.2 && placement.score < balancedBest.score) {
        balancedBest = placement;
      }
    }
  }

  return balancedBest;
}

function triangleBridgePlacementWithHinge(fixture, targetEdge, baseBlock, partnerBlock, partnerEdge) {
  const hinge = supportedHingeForBlock(partnerBlock, partnerEdge.id, baseBlock.id);
  if (!hinge) return null;

  let best = null;

  for (let angle = -110; angle <= 110; angle += 5) {
    const placement = evaluateTriangleBridgeRotation(
      fixture,
      targetEdge,
      baseBlock,
      partnerBlock,
      partnerEdge.id,
      hinge,
      angle
    );

    if (placement && (!best || placement.score < best.score)) {
      best = placement;
    }
  }

  if (!best) return null;

  const refinedStart = Math.round(best.angleDeg) - 6;
  const refinedEnd = Math.round(best.angleDeg) + 6;
  for (let angle = refinedStart; angle <= refinedEnd; angle += 1) {
    const placement = evaluateTriangleBridgeRotation(
      fixture,
      targetEdge,
      baseBlock,
      partnerBlock,
      partnerEdge.id,
      hinge,
      angle
    );

    if (placement && placement.score < best.score) {
      best = placement;
    }
  }

  return best;
}

function bridgeAnchorCandidates(targetEdge, partnerEdge, excludedBlockIds = []) {
  const anchorTolerance = Math.min(targetEdge.length, partnerEdge.length) * 0.95;
  const endpointPairs = [
    ['p1', 'p1'],
    ['p1', 'p2'],
    ['p2', 'p1'],
    ['p2', 'p2'],
  ];
  const candidates = [];

  endpointPairs.forEach(([baseKey, partnerKey]) => {
    const basePoint = targetEdge[baseKey];
    const partnerPoint = partnerEdge[partnerKey];
    const gap = basePoint.distanceTo(partnerPoint);

    if (gap <= anchorTolerance) {
      candidates.push({
        anchor: basePoint.clone().add(partnerPoint).multiplyScalar(0.5),
        baseKey,
        partnerKey,
        priority: 1,
        source: 'midpoint',
        score: gap * 2.4 + Math.abs(basePoint.y - partnerPoint.y) * 0.8,
      });
    }
  });

  state.blocks.forEach((block) => {
    if (excludedBlockIds.includes(block.id)) return;

    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      [edge.p1, edge.p2].forEach((anchorPoint) => {
        endpointPairs.forEach(([baseKey, partnerKey]) => {
          const baseDistance = targetEdge[baseKey].distanceTo(anchorPoint);
          const partnerDistance = partnerEdge[partnerKey].distanceTo(anchorPoint);

          if (baseDistance > anchorTolerance || partnerDistance > anchorTolerance) return;

          candidates.push({
            anchor: anchorPoint.clone(),
            baseKey,
            partnerKey,
            priority: 0,
            source: 'shared-anchor',
            score: baseDistance * 3.2 + partnerDistance * 3.2,
          });
        });
      });
    });
  });

  return candidates
    .sort((a, b) => (a.priority - b.priority) || (a.score - b.score))
    .filter((candidate, index, items) => {
      return items.findIndex((other) => {
        return other.baseKey === candidate.baseKey
          && other.partnerKey === candidate.partnerKey
          && other.anchor.distanceTo(candidate.anchor) < 0.02;
      }) === index;
    });
}

function adjacentSupportEdgeForEndpoint(block, targetEdgeId, endpoint) {
  const object = blockObjects.get(block.id);
  if (!object) return null;

  const adjacentEdges = blockEdgeAnchors(block, object)
    .filter((edge) => edge.id !== targetEdgeId)
    .filter((edge) => edge.p1.distanceTo(endpoint) < 0.08 || edge.p2.distanceTo(endpoint) < 0.08)
    .sort((a, b) => {
      const supportGap = supportMatchScoreForEndpointEdge(block.id, a, endpoint)
        - supportMatchScoreForEndpointEdge(block.id, b, endpoint);
      if (Math.abs(supportGap) > 0.001) return supportGap;

      const aBelow = a.mid.y <= endpoint.y + 0.12 ? 0 : 1;
      const bBelow = b.mid.y <= endpoint.y + 0.12 ? 0 : 1;
      if (aBelow !== bBelow) return aBelow - bBelow;

      const yGap = a.mid.y - b.mid.y;
      if (Math.abs(yGap) > 0.001) return yGap;

      return b.length - a.length;
    });

  return adjacentEdges[0] || null;
}

function supportMatchScoreForEndpointEdge(blockId, edge, endpoint) {
  let best = Number.POSITIVE_INFINITY;

  state.blocks.forEach((other) => {
    if (other.id === blockId) return;

    const otherObject = blockObjects.get(other.id);
    if (!otherObject) return;

    blockEdgeAnchors(other, otherObject).forEach((otherEdge) => {
      const endpointGap = Math.min(
        endpoint.distanceTo(otherEdge.p1),
        endpoint.distanceTo(otherEdge.p2)
      );
      if (endpointGap > 0.32) return;

      const lineDrift = edgeLineDriftScore(edge, otherEdge);
      if (lineDrift > 0.65) return;

      const directionError = 1 - Math.abs(edge.direction.dot(otherEdge.direction));
      const normalError = Math.abs(1 + edge.normal.dot(otherEdge.normal));
      const midDistance = edge.mid.distanceTo(otherEdge.mid);
      const score = endpointGap * 10
        + lineDrift * 8
        + directionError * 2
        + normalError * 2.2
        + midDistance * 1.4;

      if (score < best) {
        best = score;
      }
    });
  });

  return best;
}

function evaluateAnchoredTriangleBridgeRotation(
  fixture,
  anchorData,
  baseBlock,
  baseEdgeId,
  baseHinge,
  partnerBlock,
  partnerEdgeId,
  partnerHinge,
  baseAngleDeg,
  partnerAngleDeg
) {
  if (!baseHinge || !partnerHinge) return null;

  const baseTransform = hingeAlignedTransform(baseBlock, baseHinge, baseAngleDeg);
  const partnerTransform = hingeAlignedTransform(partnerBlock, partnerHinge, partnerAngleDeg);
  if (!baseTransform || !partnerTransform) return null;

  const baseEdge = edgeAnchorForTransform(baseBlock, baseEdgeId, baseTransform.positionVector, baseTransform.quaternion);
  const partnerEdge = edgeAnchorForTransform(partnerBlock, partnerEdgeId, partnerTransform.positionVector, partnerTransform.quaternion);
  const baseSupportTarget = baseHinge.supportEdge || baseHinge.edge;
  const partnerSupportTarget = partnerHinge.supportEdge || partnerHinge.edge;
  const baseSupportEdge = edgeAnchorForTransform(baseBlock, baseHinge.edge.id, baseTransform.positionVector, baseTransform.quaternion);
  const partnerSupportEdge = edgeAnchorForTransform(partnerBlock, partnerHinge.edge.id, partnerTransform.positionVector, partnerTransform.quaternion);
  if (!baseEdge || !partnerEdge || !baseSupportEdge || !partnerSupportEdge) return null;

  const resolvedAnchor = resolvedBridgeAnchorPoint(
    anchorData,
    baseBlock,
    baseEdgeId,
    baseEdge,
    baseHinge,
    baseSupportEdge,
    baseSupportTarget,
    partnerBlock,
    partnerEdgeId,
    partnerEdge,
    partnerHinge,
    partnerSupportEdge,
    partnerSupportTarget
  );
  if (!resolvedAnchor) return null;

  const anchor = resolvedAnchor.point;
  const anchorError = resolvedAnchor.error;
  if (anchorError > 0.16) return null;

  const baseSegment = pointAlongEdgeFromAnchor(baseEdge, anchorData.baseKey, fixture.edgeLength);
  const partnerSegment = pointAlongEdgeFromAnchor(partnerEdge, anchorData.partnerKey, fixture.edgeLength);
  if (!baseSegment || !partnerSegment) return null;

  const placement = fitTriangleToAnchor(
    fixture,
    anchor,
    baseSegment.point,
    partnerSegment.point,
    baseEdge.normal,
    partnerEdge.normal
  );
  if (!placement) return null;

  const baseFaceNormal = faceNormalForQuaternion(baseTransform.quaternion);
  const partnerFaceNormal = faceNormalForQuaternion(partnerTransform.quaternion);
  const triangleFaceNormal = faceNormalForPlacement(placement);
  const symmetryError = triangleFaceNormal
    ? Math.abs(
      triangleFaceNormal.angleTo(baseFaceNormal)
      - triangleFaceNormal.angleTo(partnerFaceNormal)
    )
    : 0;
  const supportDrift = edgeLineDriftScore(baseSupportEdge, baseSupportTarget)
    + edgeLineDriftScore(partnerSupportEdge, partnerSupportTarget);
  const balanceError = angleBalanceGap(baseAngleDeg, partnerAngleDeg);
  const motionError = Math.abs(baseAngleDeg) + Math.abs(partnerAngleDeg);
  const score = placement.score
    + symmetryError * 4.2
    + supportDrift * 22
    + anchorError * 14
    + anchorData.priority * 0.55
    + balanceError * 0.065
    + motionError * 0.006
    + (baseHinge.score + partnerHinge.score) * 0.18
    + Math.abs(baseAngleDeg + partnerAngleDeg) * 0.01;

  if (supportDrift > 0.03) return null;

  return {
    ...placement,
    score,
    anchorData,
    baseAngleDeg,
    partnerAngleDeg,
    adjustments: [
      {
        blockId: baseBlock.id,
        position: baseTransform.position,
        rotation: baseTransform.rotation,
      },
      {
        blockId: partnerBlock.id,
        position: partnerTransform.position,
        rotation: partnerTransform.rotation,
      },
    ],
    message: `${blockType(baseBlock.typeId).label} ve ${blockType(partnerBlock.typeId).label} üçgene göre kilitlendi`,
  };
}

function hingeAlignedTransform(block, hinge, angleDeg) {
  if (!hinge) return null;

  const baseTransform = currentBlockTransform(block);
  const alignedBase = hinge.supportEdge
    ? alignTransformEdgeToTarget(block, hinge.edge.id, baseTransform, hinge.supportEdge)
    : baseTransform;
  if (!alignedBase) return null;

  const pivotEdge = hinge.supportEdge
    || edgeAnchorForTransform(block, hinge.edge.id, alignedBase.positionVector, alignedBase.quaternion);
  if (!pivotEdge) return null;

  if (Math.abs(angleDeg) < 0.001) {
    return alignedBase;
  }

  return rotateTransformAroundLine(
    block,
    alignedBase,
    pivotEdge.p1,
    pivotEdge.direction,
    THREE.MathUtils.degToRad(angleDeg)
  );
}

function resolvedBridgeAnchorPoint(
  anchorData,
  baseBlock,
  baseEdgeId,
  baseEdge,
  baseHinge,
  baseSupportEdge,
  baseSupportTarget,
  partnerBlock,
  partnerEdgeId,
  partnerEdge,
  partnerHinge,
  partnerSupportEdge,
  partnerSupportTarget
) {
  const basePoint = baseEdge[anchorData.baseKey];
  const partnerPoint = partnerEdge[anchorData.partnerKey];
  if (!basePoint || !partnerPoint) return null;

  const baseHint = supportAnchorHintForSelectedEdge(
    baseBlock,
    baseEdgeId,
    anchorData.baseKey,
    baseHinge,
    baseSupportEdge,
    baseSupportTarget
  );
  const partnerHint = supportAnchorHintForSelectedEdge(
    partnerBlock,
    partnerEdgeId,
    anchorData.partnerKey,
    partnerHinge,
    partnerSupportEdge,
    partnerSupportTarget
  );
  if (!baseHint || !partnerHint) return null;

  const anchor = baseHint.clone().add(partnerHint).multiplyScalar(0.5);
  const hintSpread = baseHint.distanceTo(partnerHint);
  const error = basePoint.distanceTo(anchor)
    + partnerPoint.distanceTo(anchor)
    + basePoint.distanceTo(partnerPoint)
    + hintSpread * 0.5;

  if (hintSpread > 0.18) return null;

  return { point: anchor, error };
}

function supportAnchorHintForSelectedEdge(block, selectedEdgeId, selectedKey, hinge, transformedHingeEdge, supportTarget) {
  if (!hinge || !transformedHingeEdge) return null;

  const hingeKey = sharedLocalEndpointKey(block, selectedEdgeId, selectedKey, hinge.edge.id);
  if (!hingeKey) return null;
  if (!supportTarget) {
    return transformedHingeEdge[hingeKey]?.clone() || null;
  }

  const endpointMap = edgeEndpointMap(transformedHingeEdge, supportTarget);
  const targetKey = endpointMap[hingeKey];
  return supportTarget[targetKey]?.clone() || null;
}

function sharedLocalEndpointKey(block, sourceEdgeId, sourceKey, targetEdgeId) {
  const edges = shapeEdgesForType(blockType(block.typeId));
  const sourceEdge = edges.find((edge) => edge.id === sourceEdgeId);
  const targetEdge = edges.find((edge) => edge.id === targetEdgeId);
  if (!sourceEdge || !targetEdge) return null;

  const sourcePoint = sourceEdge[sourceKey];
  if (!sourcePoint) return null;
  if (sourcePoint.distanceTo(targetEdge.p1) < 0.001) return 'p1';
  if (sourcePoint.distanceTo(targetEdge.p2) < 0.001) return 'p2';
  return null;
}

function edgeEndpointMap(firstEdge, secondEdge) {
  const direct = firstEdge.p1.distanceTo(secondEdge.p1) + firstEdge.p2.distanceTo(secondEdge.p2);
  const swapped = firstEdge.p1.distanceTo(secondEdge.p2) + firstEdge.p2.distanceTo(secondEdge.p1);
  return direct <= swapped
    ? { p1: 'p1', p2: 'p2' }
    : { p1: 'p2', p2: 'p1' };
}

function angleBalanceGap(firstAngleDeg, secondAngleDeg) {
  return Math.abs(Math.abs(firstAngleDeg) - Math.abs(secondAngleDeg));
}

function pointAlongEdgeFromAnchor(edge, anchorKey, distance) {
  const otherKey = anchorKey === 'p1' ? 'p2' : 'p1';
  const anchor = edge[anchorKey];
  const other = edge[otherKey];
  const span = other.clone().sub(anchor);
  const length = span.length();

  if (length < Math.max(0.01, distance - 0.08)) {
    return null;
  }

  const raw = THREE.MathUtils.clamp(distance / Math.max(length, 0.0001), 0, 1);
  return {
    raw,
    point: anchor.clone().add(span.multiplyScalar(raw)),
  };
}

function fitTriangleToAnchor(fixture, anchor, firstPoint, secondPoint, firstNormal, secondNormal) {
  const mappings = [
    {
      firstPoint: fixture.rightPoint,
      secondPoint: fixture.leftPoint,
      firstNormal: fixture.rightNormal,
      secondNormal: fixture.leftNormal,
    },
    {
      firstPoint: fixture.leftPoint,
      secondPoint: fixture.rightPoint,
      firstNormal: fixture.leftNormal,
      secondNormal: fixture.rightNormal,
    },
  ];

  let best = null;

  mappings.forEach((mapping) => {
    const localFirstVector = mapping.firstPoint.clone().sub(fixture.apex);
    const localSecondVector = mapping.secondPoint.clone().sub(fixture.apex);
    const worldFirstVector = firstPoint.clone().sub(anchor);
    const worldSecondVector = secondPoint.clone().sub(anchor);

    if (worldFirstVector.lengthSq() < 0.001 || worldSecondVector.lengthSq() < 0.001) {
      return;
    }

    const angleError = Math.abs(worldFirstVector.angleTo(worldSecondVector) - fixture.apexAngle);
    if (angleError > THREE.MathUtils.degToRad(18)) return;

    const quaternion = quaternionFromEdgePair(
      localFirstVector,
      localSecondVector,
      worldFirstVector,
      worldSecondVector
    );
    if (!quaternion) return;

    const positionVector = anchor.clone().sub(fixture.apex.clone().applyQuaternion(quaternion));
    const transformedApex = fixture.apex.clone().applyQuaternion(quaternion).add(positionVector);
    const transformedFirstPoint = mapping.firstPoint.clone().applyQuaternion(quaternion).add(positionVector);
    const transformedSecondPoint = mapping.secondPoint.clone().applyQuaternion(quaternion).add(positionVector);
    const transformedFirstNormal = mapping.firstNormal.clone().applyQuaternion(quaternion).normalize();
    const transformedSecondNormal = mapping.secondNormal.clone().applyQuaternion(quaternion).normalize();
    const apexError = transformedApex.distanceTo(anchor);
    const pointError = transformedFirstPoint.distanceTo(firstPoint) + transformedSecondPoint.distanceTo(secondPoint);
    const normalError = Math.abs(1 + transformedFirstNormal.dot(firstNormal))
      + Math.abs(1 + transformedSecondNormal.dot(secondNormal));
    const score = pointError * 18 + apexError * 18 + angleError * 6 + normalError * 1.4;

    if (pointError > 0.09 || apexError > 0.06 || normalError > 1.0) return;

    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    const placement = {
      score,
      orientation: 'front',
      position: roundVector(positionVector),
      rotation: {
        x: normalizeDegrees(THREE.MathUtils.radToDeg(euler.x)),
        y: normalizeDegrees(THREE.MathUtils.radToDeg(euler.y)),
        z: normalizeDegrees(THREE.MathUtils.radToDeg(euler.z)),
      },
      message: 'Üçgen ortak köşeye ankrajlandı',
    };

    if (!best || placement.score < best.score) {
      best = placement;
    }
  });

  return best;
}

function triangleBridgeFixture(type) {
  if (type.id !== 'triangle' && type.id !== 'long-triangle') return null;

  const edges = shapeEdgesForType(type);
  const rightEdge = edges[1];
  const leftEdge = edges[2];
  if (!rightEdge || !leftEdge) return null;

  return {
    edgeLength: rightEdge.length,
    apexAngle: localPanelPoint(rightEdge.p1).sub(localPanelPoint(rightEdge.p2))
      .angleTo(localPanelPoint(leftEdge.p2).sub(localPanelPoint(rightEdge.p2))),
    apex: localPanelPoint(rightEdge.p2),
    rightPoint: localPanelPoint(rightEdge.p1),
    leftPoint: localPanelPoint(leftEdge.p2),
    rightNormal: localPanelPoint(rightEdge.normal).normalize(),
    leftNormal: localPanelPoint(leftEdge.normal).normalize(),
  };
}

function trianglePlacementForEdgePair(fixture, targetEdge, partnerEdge) {
  const mappings = [
    {
      firstPoint: fixture.rightPoint,
      secondPoint: fixture.leftPoint,
      firstNormal: fixture.rightNormal,
      secondNormal: fixture.leftNormal,
    },
    {
      firstPoint: fixture.leftPoint,
      secondPoint: fixture.rightPoint,
      firstNormal: fixture.leftNormal,
      secondNormal: fixture.rightNormal,
    },
  ];

  let best = null;

  mappings.forEach((mapping) => {
    [0, 1].forEach((firstApexIndex) => {
      [0, 1].forEach((secondApexIndex) => {
        const firstApex = firstApexIndex === 0 ? targetEdge.p1 : targetEdge.p2;
        const firstOther = firstApexIndex === 0 ? targetEdge.p2 : targetEdge.p1;
        const secondApex = secondApexIndex === 0 ? partnerEdge.p1 : partnerEdge.p2;
        const secondOther = secondApexIndex === 0 ? partnerEdge.p2 : partnerEdge.p1;
        const anchoredPlacement = fitTriangleFromApexEndpoints(
          fixture,
          mapping,
          {
            firstApex,
            firstOther,
            secondApex,
            secondOther,
            firstNormal: targetEdge.normal,
            secondNormal: partnerEdge.normal,
            firstLabel: targetEdge.label,
            secondLabel: partnerEdge.label,
          }
        );
        if (anchoredPlacement && (!best || anchoredPlacement.score < best.score)) {
          best = anchoredPlacement;
        }

        const placement = fitTriangleBetweenEdges(
          fixture,
          mapping,
          {
            firstApex,
            firstOther,
            secondApex,
            secondOther,
            firstNormal: targetEdge.normal,
            secondNormal: partnerEdge.normal,
            firstLabel: targetEdge.label,
            secondLabel: partnerEdge.label,
          }
        );

        if (!placement) return;

        if (!best || placement.score < best.score) {
          best = placement;
        }
      });
    });
  });

  return best;
}

function fitTriangleFromApexEndpoints(fixture, mapping, target) {
  const firstDirection = target.firstOther.clone().sub(target.firstApex);
  const secondDirection = target.secondOther.clone().sub(target.secondApex);
  const firstLength = firstDirection.length();
  const secondLength = secondDirection.length();

  if (firstLength < fixture.edgeLength - 0.2 || secondLength < fixture.edgeLength - 0.2) {
    return null;
  }

  firstDirection.normalize();
  secondDirection.normalize();

  const angleError = Math.abs(firstDirection.angleTo(secondDirection) - fixture.apexAngle);
  if (angleError > THREE.MathUtils.degToRad(32)) return null;

  const quaternion = quaternionFromEdgePair(
    mapping.firstPoint.clone().sub(fixture.apex),
    mapping.secondPoint.clone().sub(fixture.apex),
    firstDirection.clone().multiplyScalar(fixture.edgeLength),
    secondDirection.clone().multiplyScalar(fixture.edgeLength)
  );
  if (!quaternion) return null;

  const apex = target.firstApex.clone().add(target.secondApex).multiplyScalar(0.5);
  const position = apex.clone().sub(fixture.apex.clone().applyQuaternion(quaternion));
  const transformedFirstPoint = mapping.firstPoint.clone().applyQuaternion(quaternion).add(position);
  const transformedSecondPoint = mapping.secondPoint.clone().applyQuaternion(quaternion).add(position);
  const transformedFirstNormal = mapping.firstNormal.clone().applyQuaternion(quaternion).normalize();
  const transformedSecondNormal = mapping.secondNormal.clone().applyQuaternion(quaternion).normalize();
  const firstFit = pointOnSegmentFit(transformedFirstPoint, target.firstApex, target.firstOther);
  const secondFit = pointOnSegmentFit(transformedSecondPoint, target.secondApex, target.secondOther);
  const expectedFirstRaw = THREE.MathUtils.clamp(fixture.edgeLength / firstLength, 0, 1);
  const expectedSecondRaw = THREE.MathUtils.clamp(fixture.edgeLength / secondLength, 0, 1);
  const apexGap = target.firstApex.distanceTo(target.secondApex);
  const normalError = Math.abs(1 + transformedFirstNormal.dot(target.firstNormal))
    + Math.abs(1 + transformedSecondNormal.dot(target.secondNormal));
  const averageApexY = (target.firstApex.y + target.secondApex.y) / 2;
  const score = firstFit.distance * 10
    + secondFit.distance * 10
    + apexGap * 2.4
    + angleError * 2
    + normalError * 0.7
    + Math.abs(firstFit.raw - expectedFirstRaw) * 2
    + Math.abs(secondFit.raw - expectedSecondRaw) * 2
    + averageApexY * 0.35;

  if (firstFit.distance > 0.09 || secondFit.distance > 0.09) return null;
  if (Math.abs(firstFit.raw - expectedFirstRaw) > 0.12 || Math.abs(secondFit.raw - expectedSecondRaw) > 0.12) return null;
  if (apexGap > 0.45) return null;

  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    score,
    orientation: 'front',
    position: roundVector(position),
    rotation: {
      x: normalizeDegrees(THREE.MathUtils.radToDeg(euler.x)),
      y: normalizeDegrees(THREE.MathUtils.radToDeg(euler.y)),
      z: normalizeDegrees(THREE.MathUtils.radToDeg(euler.z)),
    },
    message: `${target.firstLabel} ve ${target.secondLabel} arasına üçgen oturdu`,
  };
}

function fitTriangleBetweenEdges(fixture, mapping, target) {
  const firstWorldVector = target.firstOther.clone().sub(target.firstApex);
  const secondWorldVector = target.secondOther.clone().sub(target.secondApex);
  const firstLength = firstWorldVector.length();
  const secondLength = secondWorldVector.length();

  if (firstLength < 0.2 || secondLength < 0.2) return null;

  const localFirstVector = mapping.firstPoint.clone().sub(fixture.apex);
  const localSecondVector = mapping.secondPoint.clone().sub(fixture.apex);
  const worldAngle = firstWorldVector.angleTo(secondWorldVector);
  const angleError = Math.abs(worldAngle - fixture.apexAngle);
  if (angleError > THREE.MathUtils.degToRad(42)) return null;

  const quaternion = quaternionFromEdgePair(localFirstVector, localSecondVector, firstWorldVector, secondWorldVector);
  if (!quaternion) return null;

  const apex = target.firstApex.clone().add(target.secondApex).multiplyScalar(0.5);
  const position = apex.clone().sub(fixture.apex.clone().applyQuaternion(quaternion));
  const transformedFirstPoint = mapping.firstPoint.clone().applyQuaternion(quaternion).add(position);
  const transformedSecondPoint = mapping.secondPoint.clone().applyQuaternion(quaternion).add(position);
  const transformedFirstNormal = mapping.firstNormal.clone().applyQuaternion(quaternion).normalize();
  const transformedSecondNormal = mapping.secondNormal.clone().applyQuaternion(quaternion).normalize();
  const apexGap = target.firstApex.distanceTo(target.secondApex);
  const pointError = transformedFirstPoint.distanceTo(target.firstOther) + transformedSecondPoint.distanceTo(target.secondOther);
  const lengthError = Math.abs(firstLength - fixture.edgeLength) + Math.abs(secondLength - fixture.edgeLength);
  const normalError = Math.abs(1 + transformedFirstNormal.dot(target.firstNormal)) + Math.abs(1 + transformedSecondNormal.dot(target.secondNormal));
  const score = pointError * 2.4 + apexGap * 2.2 + angleError * 1.5 + lengthError * 1.2 + normalError * 0.6;

  if (pointError > 0.72 || apexGap > 0.7) return null;

  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    score,
    orientation: 'front',
    position: roundVector(position),
    rotation: {
      x: normalizeDegrees(THREE.MathUtils.radToDeg(euler.x)),
      y: normalizeDegrees(THREE.MathUtils.radToDeg(euler.y)),
      z: normalizeDegrees(THREE.MathUtils.radToDeg(euler.z)),
    },
    message: `${target.firstLabel} ve ${target.secondLabel} arasına üçgen oturdu`,
  };
}

function customEdgeAttachmentFor(type, baseBlock, targetEdge) {
  const baseFaceNormal = faceNormalForBlock(baseBlock);
  if (!baseFaceNormal) return null;

  const placement = bestEdgeAttachmentPlacement({
    type,
    orientation: baseBlock.orientation,
    targetEdge,
    baseBlock,
    preferredNormals: [{ normal: baseFaceNormal, weight: 1.15 }],
  });
  if (!placement) return null;

  return {
    score: placement.score,
    orientation: placement.orientation,
    position: placement.position,
    rotation: placement.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: placement.blockEdgeId,
    },
    message: placement.contactCount > 0
      ? `${targetEdge.label} çevredeki kenarlara göre kilitlendi`
      : `${targetEdge.label} üzerine custom yerleşim uygulandı`,
  };
}

function rightTriangleEndAttachment(type, baseBlock, targetEdge) {
  if (type.id !== 'right-triangle' || !isVerticalPanelTarget(baseBlock, targetEdge)) return null;

  const verticalEdge = shapeEdgesForType(type).find((edge) => edge.id === 'edge-2');
  const baseFaceNormal = faceNormalForBlock(baseBlock);
  if (!verticalEdge || !baseFaceNormal || targetEdge.length + 0.01 < verticalEdge.length) return null;

  const targetSegment = topEdgeSegment(targetEdge, verticalEdge.length);
  const placement = bestEdgeAttachmentPlacement({
    type,
    orientation: baseBlock.orientation,
    targetEdge: targetSegment,
    baseBlock,
    forcedEdgeId: verticalEdge.id,
    preferredNormals: [{ normal: baseFaceNormal, weight: 1.05 }],
    useSecondaryEdges: false,
  });
  if (!placement) return null;

  return {
    score: placement.score,
    orientation: placement.orientation,
    position: placement.position,
    rotation: placement.rotation,
    attachment: {
      mode: targetEdge.length > verticalEdge.length + 0.01 ? 'partial-edge' : 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: verticalEdge.id,
    },
    message: `${targetEdge.label} üst ucuna sağ üçgenin dik kenarı oturdu`,
  };
}

function isVerticalPanelTarget(baseBlock, targetEdge) {
  const baseFaceNormal = baseBlock ? faceNormalForBlock(baseBlock) : null;
  return Boolean(
    baseFaceNormal
    && Math.abs(baseFaceNormal.y) < 0.55
    && Math.abs(targetEdge?.direction?.y || 0) > 0.75
  );
}

function topEdgeSegment(edge, length) {
  if (edge.length <= length + 0.01) return edge;

  const top = edge.p1.y >= edge.p2.y ? edge.p1.clone() : edge.p2.clone();
  const bottom = edge.p1.y < edge.p2.y ? edge.p1.clone() : edge.p2.clone();
  const direction = bottom.sub(top).normalize();
  const p1 = top;
  const p2 = top.clone().addScaledVector(direction, length);

  return {
    ...edge,
    p1,
    p2,
    mid: p1.clone().add(p2).multiplyScalar(0.5),
    direction: p2.clone().sub(p1).normalize(),
    length,
  };
}

function customAttachmentContextForBlock(block) {
  if (!block?.attachment || block.attachment.mode !== 'custom-edge') return null;

  const baseBlock = state.blocks.find((item) => item.id === block.attachment.baseBlockId);
  if (!baseBlock) return null;

  const targetEdge = edgeAnchorForStoredBlock(baseBlock, block.attachment.baseEdgeId);
  const movingEdge = edgeAnchorForStoredBlock(block, block.attachment.blockEdgeId);
  if (!targetEdge || !movingEdge) return null;

  const edgeDrift = edgeLineDriftScore(movingEdge, targetEdge);
  const directionError = 1 - Math.abs(movingEdge.direction.dot(targetEdge.direction));
  if (edgeDrift > 0.14 || directionError > 0.2) return null;

  return {
    block,
    baseBlock,
    targetEdge,
    movingEdge,
    attachment: block.attachment,
  };
}

function looseCustomAttachmentContextForBlock(block) {
  if (!block?.attachment || block.attachment.mode !== 'custom-edge') return null;

  const baseBlock = state.blocks.find((item) => item.id === block.attachment.baseBlockId);
  if (!baseBlock || baseBlock.id === block.id) return null;

  const targetEdge = edgeAnchorForStoredBlock(baseBlock, block.attachment.baseEdgeId);
  const movingEdge = edgeAnchorForStoredBlock(block, block.attachment.blockEdgeId);
  if (!targetEdge || !movingEdge) return null;

  return {
    block,
    baseBlock,
    targetEdge,
    movingEdge,
    attachment: block.attachment,
  };
}

function isTriangleBlockType(type) {
  return type?.id === 'triangle' || type?.id === 'long-triangle' || type?.id === 'right-triangle';
}

function canSnapTriangleOtherEdge(block) {
  const context = looseCustomAttachmentContextForBlock(block);
  return Boolean(context && alternateTriangleAttachmentEdges(block, context.targetEdge).length);
}

function alternateTriangleAttachmentEdges(block, targetEdge) {
  const type = blockType(block?.typeId);
  if (!isTriangleBlockType(type)) return [];

  const currentEdgeId = block.attachment?.blockEdgeId;
  const edges = shapeEdgesForType(type).filter((edge) => edge.id !== currentEdgeId);
  const byTargetLength = (first, second) => {
    if (!targetEdge) return second.length - first.length;
    return Math.abs(first.length - targetEdge.length) - Math.abs(second.length - targetEdge.length);
  };

  if (type.id === 'triangle' || type.id === 'long-triangle') {
    const pairedSideId = { 'edge-1': 'edge-2', 'edge-2': 'edge-1' }[currentEdgeId];
    const pairedSide = edges.find((edge) => edge.id === pairedSideId);
    if (pairedSide) return [pairedSide];

    const sideEdges = edges.filter((edge) => edge.id === 'edge-1' || edge.id === 'edge-2');
    if (sideEdges.length) return sideEdges.sort(byTargetLength);
  }

  return edges.sort(byTargetLength);
}

function alternateTriangleEdgePlacement(block, context) {
  const type = blockType(block.typeId);
  const currentTransform = storedBlockTransform(block);
  const currentFaceNormal = faceNormalForQuaternion(currentTransform.quaternion);
  const baseFaceNormal = faceNormalForQuaternion(quaternionForBlock(context.baseBlock));
  const edges = alternateTriangleAttachmentEdges(block, context.targetEdge);
  let best = null;

  edges.forEach((edge) => {
    const placement = bestEdgeAttachmentPlacement({
      type,
      orientation: block.orientation,
      targetEdge: context.targetEdge,
      baseBlock: context.baseBlock,
      forcedEdgeId: edge.id,
      preferredNormals: [
        { normal: currentFaceNormal, weight: 0.85 },
        { normal: baseFaceNormal, weight: 1.35 },
      ],
      ignoreBlockIds: [block.id],
      useSecondaryEdges: false,
    });
    if (!placement) return;

    const placementPosition = new THREE.Vector3(
      placement.position.x,
      placement.position.y,
      placement.position.z
    );
    const positionDelta = currentTransform.positionVector.distanceTo(placementPosition);
    const candidateScore = placement.score + positionDelta * 0.3;
    const candidate = { edge, placement, score: candidateScore };

    if (!best || candidate.score < best.score) {
      best = candidate;
    }
  });

  return best;
}

function snapSelectedTriangleOtherEdge() {
  const block = selectedBlock();
  const context = looseCustomAttachmentContextForBlock(block);

  if (!block || !context) {
    setStatus('Bu üçgenin mevcut bağlı kenarı bulunamadı', 'warn');
    return;
  }

  if (!isTriangleBlockType(blockType(block.typeId))) {
    setStatus('Diğer kenar yapıştırma sadece üçgen bloklar için', 'warn');
    return;
  }

  const candidate = alternateTriangleEdgePlacement(block, context);
  if (!candidate) {
    setStatus('Diğer kenar bu hedef kenara sığmadı', 'warn');
    return;
  }

  applyChange(() => {
    block.orientation = candidate.placement.orientation || block.orientation;
    block.position = roundVector(candidate.placement.position);
    block.rotation = {
      x: normalizeDegrees(candidate.placement.rotation.x),
      y: normalizeDegrees(candidate.placement.rotation.y),
      z: normalizeDegrees(candidate.placement.rotation.z),
    };
    block.attachment = cleanAttachment({
      ...context.attachment,
      blockEdgeId: candidate.edge.id,
    });
  }, `${candidate.edge.label || 'Diğer kenar'} mevcut kenara yapıştırıldı`, { enforceAutoSymmetry: false });
}

function autoStandSelectedBlock() {
  const block = selectedBlock();
  const context = customAttachmentContextForBlock(block);
  if (!block || !context) {
    setStatus('Bu blok için custom menteşe bulunamadı', 'warn');
    return;
  }

  const transform = uprightTransformForCustomAttachment(context);
  if (!transform) {
    setStatus('Bu kenar için dikleştirme hesaplanamadı', 'warn');
    return;
  }

  const canonicalTransform = canonicalTransformForBlock(block, transform);

  applyChange(() => {
    block.orientation = canonicalTransform.orientation;
    block.position = canonicalTransform.position;
    block.rotation = canonicalTransform.rotation;
  }, 'Custom blok alt kenarı yapışık kalarak dikleştirildi', { enforceAutoSymmetry: false });
}

function uprightTransformForCustomAttachment(context) {
  const axis = context.targetEdge.direction.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const verticalPlaneNormal = axis.clone().cross(worldUp);
  if (verticalPlaneNormal.lengthSq() < 0.0001) return null;

  verticalPlaneNormal.normalize();
  const current = currentBlockTransform(context.block);
  const currentNormal = faceNormalForQuaternion(current.quaternion);
  const targetNormals = [
    verticalPlaneNormal,
    verticalPlaneNormal.clone().negate(),
  ];

  let best = null;

  targetNormals.forEach((targetNormal) => {
    const angleRad = signedAngleOnAxis(currentNormal, targetNormal, axis);
    const rotated = rotateBlockAroundLineTransform(
      context.block,
      context.targetEdge.p1,
      axis,
      angleRad
    );
    if (!rotated) return;

    const aligned = alignTransformEdgeToTarget(
      context.block,
      context.attachment.blockEdgeId,
      rotated,
      context.targetEdge
    );
    if (!aligned) return;

    const alignedEdge = edgeAnchorForTransform(
      context.block,
      context.attachment.blockEdgeId,
      aligned.positionVector,
      aligned.quaternion
    );
    if (!alignedEdge) return;

    const finalNormal = faceNormalForQuaternion(aligned.quaternion);
    const verticalError = Math.abs(finalNormal.y);
    const edgeDrift = edgeLineDriftScore(alignedEdge, context.targetEdge);
    const score = verticalError * 30 + edgeDrift * 24 + Math.abs(angleRad) * 0.2;

    if (!best || score < best.score) {
      best = {
        ...aligned,
        score,
      };
    }
  });

  return best;
}

function selectedCustomAttachmentContexts() {
  return selectedBlocks()
    .map((block) => customAttachmentContextForBlock(block))
    .filter(Boolean);
}

function customAttachmentAngleState(context, transform = currentBlockTransform(context.block)) {
  const axis = context.targetEdge.direction.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const verticalPlaneNormal = axis.clone().cross(worldUp);
  if (verticalPlaneNormal.lengthSq() < 0.0001) return null;

  verticalPlaneNormal.normalize();
  const currentNormal = faceNormalForQuaternion(transform.quaternion);
  const candidates = [
    verticalPlaneNormal,
    verticalPlaneNormal.clone().negate(),
  ].map((uprightNormal) => {
    const currentAngleRad = signedAngleOnAxis(uprightNormal, currentNormal, axis);
    return {
      axis,
      uprightNormal,
      currentAngleDeg: THREE.MathUtils.radToDeg(currentAngleRad),
      score: Math.abs(currentAngleRad),
    };
  });

  return candidates.sort((a, b) => a.score - b.score)[0] || null;
}

function transformForCustomAttachmentAngle(context, targetAngleDeg, angleState = customAttachmentAngleState(context)) {
  if (!angleState) return null;

  const deltaDeg = targetAngleDeg - angleState.currentAngleDeg;
  const rotated = rotateBlockAroundLineTransform(
    context.block,
    context.targetEdge.p1,
    angleState.axis,
    THREE.MathUtils.degToRad(deltaDeg)
  );
  if (!rotated) return null;

  const aligned = alignTransformEdgeToTarget(
    context.block,
    context.attachment.blockEdgeId,
    rotated,
    context.targetEdge
  );
  if (!aligned) return null;

  const alignedEdge = edgeAnchorForTransform(
    context.block,
    context.attachment.blockEdgeId,
    aligned.positionVector,
    aligned.quaternion
  );
  const finalAngleState = customAttachmentAngleState(context, aligned);
  if (!alignedEdge || !finalAngleState) return null;

  const edgeDrift = edgeLineDriftScore(alignedEdge, context.targetEdge);
  const angleError = Math.abs(finalAngleState.currentAngleDeg - targetAngleDeg);

  return {
    ...aligned,
    score: edgeDrift * 24 + angleError * 0.18,
    angleState: finalAngleState,
  };
}

function equalizeSelectedAngles() {
  const blocks = selectedBlocks();
  if (!blocks.length) {
    setStatus('Seçili blok yok', 'warn');
    return;
  }

  applyChange(() => {
    blocks.forEach((block) => {
      block.rotation.x = snapAngle(block.rotation.x, 15);
      block.rotation.y = snapAngle(block.rotation.y, 15);
      block.rotation.z = snapAngle(block.rotation.z, 15);
    });
  }, 'Açılar 15°\'ye yuvarlandı');
}

function snapAngle(degrees, step = 15) {
  return normalizeDegrees(Math.round((Number(degrees) || 0) / step) * step);
}

function evaluateTriangleBridgeRotation(fixture, targetEdge, baseBlock, partnerBlock, partnerEdgeId, hinge, angleDeg) {
  if (Math.abs(angleDeg) < 0.001) return null;

  const pivotEdge = hinge.supportEdge || hinge.edge;
  const rotated = rotateBlockAroundLineTransform(
    partnerBlock,
    pivotEdge.p1,
    pivotEdge.direction,
    THREE.MathUtils.degToRad(angleDeg)
  );
  if (!rotated) return null;

  const transformedHinge = edgeAnchorForTransform(
    partnerBlock,
    hinge.edge.id,
    rotated.positionVector,
    rotated.quaternion
  );
  if (!transformedHinge) return null;

  const supportAligned = hinge.supportEdge
    ? alignTransformEdgeToTarget(partnerBlock, hinge.edge.id, rotated, hinge.supportEdge)
    : rotated;
  if (!supportAligned) return null;

  const rotatedPartnerEdge = edgeAnchorForTransform(
    partnerBlock,
    partnerEdgeId,
    supportAligned.positionVector,
    supportAligned.quaternion
  );
  if (!rotatedPartnerEdge) return null;

  const placement = trianglePlacementForEdgePair(fixture, targetEdge, rotatedPartnerEdge);
  if (!placement) return null;

  const alignedHinge = edgeAnchorForTransform(
    partnerBlock,
    hinge.edge.id,
    supportAligned.positionVector,
    supportAligned.quaternion
  );
  if (!alignedHinge) return null;

  const hingeDrift = hinge.supportEdge
    ? edgeLineDriftScore(alignedHinge, hinge.supportEdge)
    : edgeLineDriftScore(alignedHinge, hinge.edge);
  const triangleFaceNormal = faceNormalForPlacement(placement);
  const baseFaceNormal = faceNormalForBlock(baseBlock);
  const partnerFaceNormal = faceNormalForQuaternion(supportAligned.quaternion);
  const symmetryError = triangleFaceNormal && baseFaceNormal && partnerFaceNormal
    ? Math.abs(
      triangleFaceNormal.angleTo(baseFaceNormal)
      - triangleFaceNormal.angleTo(partnerFaceNormal)
    )
    : 0;
  const totalScore = placement.score
    + hingeDrift * 14
    + Math.abs(angleDeg) * 0.018
    + hinge.score * 0.22
    + symmetryError * 3.2;

  if (hingeDrift > 0.035) return null;

  return {
    ...placement,
    score: totalScore,
    angleDeg,
    adjustments: [{
      blockId: partnerBlock.id,
      position: supportAligned.position,
      rotation: supportAligned.rotation,
    }],
    message: `${blockType(partnerBlock.typeId).label} menteşe ile kapandı · ${placement.message}`,
  };
}

function supportedHingeForBlock(block, excludedEdgeId, avoidBlockId = null) {
  const object = blockObjects.get(block.id);
  if (!object) return null;

  const edges = blockEdgeAnchors(block, object).filter((edge) => edge.id !== excludedEdgeId);
  let best = null;

  edges.forEach((edge) => {
    if (edge.mid.y > block.position.y + 0.16) return;

    state.blocks.forEach((other) => {
      if (other.id === block.id || other.id === avoidBlockId) return;

      const otherObject = blockObjects.get(other.id);
      if (!otherObject) return;

      blockEdgeAnchors(other, otherObject).forEach((otherEdge) => {
        const lengthGap = Math.abs(edge.length - otherEdge.length);
        if (lengthGap > 0.9) return;

        const midDistance = edge.mid.distanceTo(otherEdge.mid);
        if (midDistance > 1.8) return;

        const directionScore = 1 - Math.abs(edge.direction.dot(otherEdge.direction));
        const normalScore = Math.abs(1 + edge.normal.dot(otherEdge.normal));
        const lowBias = Math.max(0, block.position.y - edge.mid.y);
        const score = midDistance * 2.6
          + lengthGap * 1.3
          + directionScore * 0.9
          + normalScore * 0.9
          - lowBias * 0.45;

        if (!best || score < best.score) {
          best = { edge, supportEdge: otherEdge, supportBlockId: other.id, score };
        }
      });
    });
  });

  if (best) return best;

  const fallbackEdge = edges.sort((a, b) => a.mid.y - b.mid.y)[0];
  return fallbackEdge ? { edge: fallbackEdge, supportEdge: null, score: 2.4 } : null;
}

function rotateBlockAroundEdgeTransform(block, edge, angleRad) {
  return rotateBlockAroundLineTransform(block, edge.p1, edge.direction, angleRad);
}

function rotateBlockAroundLineTransform(block, linePoint, lineDirection, angleRad) {
  return rotateTransformAroundLine(block, currentBlockTransform(block), linePoint, lineDirection, angleRad);
}

function rotateTransformAroundLine(block, transform, linePoint, lineDirection, angleRad) {
  const current = transform;
  const axis = lineDirection.clone().normalize();
  if (axis.lengthSq() < 0.001) return null;

  const axisQuat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);
  const nextQuaternion = axisQuat.clone().multiply(current.quaternion);
  const nextPositionVector = current.positionVector.clone()
    .sub(linePoint)
    .applyAxisAngle(axis, angleRad)
    .add(linePoint);

  return transformForBlock(block, nextPositionVector, nextQuaternion);
}

function currentBlockTransform(block) {
  const object = blockObjects.get(block.id);
  const positionVector = new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  const quaternion = object
    ? (object.updateMatrixWorld(true), object.getWorldQuaternion(new THREE.Quaternion()))
    : quaternionForBlock(block);

  return transformForBlock(block, positionVector, quaternion);
}

function transformForBlock(block, positionVector, quaternion) {
  return {
    positionVector,
    quaternion,
    position: roundVector(positionVector),
    rotation: rotationForBlockQuaternion(block, quaternion),
  };
}

function storedBlockTransform(block) {
  const positionVector = new THREE.Vector3(block.position.x, block.position.y, block.position.z);
  return transformForBlock(block, positionVector, quaternionForBlock(block));
}

function quaternionForBlock(block) {
  const baseQuat = orientationQuaternion(block.orientation);
  const relativeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(block.rotation.x),
    THREE.MathUtils.degToRad(block.rotation.y),
    THREE.MathUtils.degToRad(block.rotation.z),
    'XYZ'
  ));

  return baseQuat.multiply(relativeQuat);
}

function rotationForBlockQuaternion(block, quaternion) {
  const baseQuat = orientationQuaternion(block.orientation);
  const relativeQuat = baseQuat.clone().invert().multiply(quaternion);
  const euler = new THREE.Euler().setFromQuaternion(relativeQuat, 'XYZ');

  return {
    x: normalizeDegrees(THREE.MathUtils.radToDeg(euler.x)),
    y: normalizeDegrees(THREE.MathUtils.radToDeg(euler.y)),
    z: normalizeDegrees(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function canonicalTransformForBlock(block, transform) {
  const orientation = canonicalOrientationForQuaternion(transform.quaternion);
  return {
    orientation,
    position: roundVector(transform.position),
    rotation: rotationForBlockQuaternion({ ...block, orientation }, transform.quaternion),
  };
}

function canonicalOrientationForQuaternion(quaternion) {
  const normal = faceNormalForQuaternion(quaternion);
  const absX = Math.abs(normal.x);
  const absY = Math.abs(normal.y);
  const absZ = Math.abs(normal.z);

  if (absY >= absX && absY >= absZ) return 'floor';
  return absX >= absZ ? 'side' : 'front';
}

function faceNormalForQuaternion(quaternion) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
}

function faceNormalForPlacement(placement) {
  if (!placement?.orientation || !placement?.rotation) return null;
  return faceNormalForQuaternion(quaternionForBlock(placement));
}

function coplanarAttachmentQuaternion(edge, targetEdge, targetFaceNormal, directionSign = 1) {
  const localFaceNormal = new THREE.Vector3(0, 0, 1);
  const faceQuat = new THREE.Quaternion().setFromUnitVectors(localFaceNormal, targetFaceNormal.clone().normalize());
  const localEdgeDirection = localPanelPoint(edge.direction).applyQuaternion(faceQuat).normalize();
  const targetDirection = targetEdge.direction.clone().multiplyScalar(directionSign).normalize();
  const turn = signedAngleOnAxis(localEdgeDirection, targetDirection, targetFaceNormal);
  return new THREE.Quaternion()
    .setFromAxisAngle(targetFaceNormal, turn)
    .multiply(faceQuat);
}

function blockEdgeAnchorsForTransform(block, positionVector, quaternion) {
  const matrix = new THREE.Matrix4().compose(
    positionVector,
    quaternion,
    new THREE.Vector3(1, 1, 1)
  );

  return shapeEdgesForType(blockType(block.typeId)).map((edge) => {
    const p1 = localPanelPoint(edge.p1).applyMatrix4(matrix);
    const p2 = localPanelPoint(edge.p2).applyMatrix4(matrix);
    const mid = localPanelPoint(edge.mid).applyMatrix4(matrix);
    const normalTip = localPanelPoint(edge.mid.clone().add(edge.normal)).applyMatrix4(matrix);
    const normal = normalTip.sub(mid).normalize();

    return {
      ...edge,
      p1,
      p2,
      mid,
      normal,
      direction: p2.clone().sub(p1).normalize(),
    };
  });
}

function edgeAnchorForTransform(block, edgeId, positionVector, quaternion) {
  return blockEdgeAnchorsForTransform(block, positionVector, quaternion)
    .find((edge) => edge.id === edgeId) || null;
}

function blockEdgeAnchorsForStoredBlock(block) {
  const transform = storedBlockTransform(block);
  return blockEdgeAnchorsForTransform(block, transform.positionVector, transform.quaternion);
}

function edgeAnchorForStoredBlock(block, edgeId) {
  const transform = storedBlockTransform(block);
  return edgeAnchorForTransform(block, edgeId, transform.positionVector, transform.quaternion);
}

function alignTransformEdgeToTarget(block, edgeId, transform, targetEdge) {
  const movingEdge = edgeAnchorForTransform(block, edgeId, transform.positionVector, transform.quaternion);
  if (!movingEdge) return null;

  const directTranslation = targetEdge.p1.clone().sub(movingEdge.p1)
    .add(targetEdge.p2.clone().sub(movingEdge.p2))
    .multiplyScalar(0.5);
  const swappedTranslation = targetEdge.p2.clone().sub(movingEdge.p1)
    .add(targetEdge.p1.clone().sub(movingEdge.p2))
    .multiplyScalar(0.5);
  const directScore = translatedEdgeDriftScore(movingEdge, targetEdge, directTranslation);
  const swappedScore = translatedEdgeDriftScore(movingEdge, targetEdge, swappedTranslation);
  const translation = directScore <= swappedScore ? directTranslation : swappedTranslation;

  return transformForBlock(
    block,
    transform.positionVector.clone().add(translation),
    transform.quaternion.clone()
  );
}

function translatedEdgeDriftScore(edge, targetEdge, translation) {
  const translated = {
    p1: edge.p1.clone().add(translation),
    p2: edge.p2.clone().add(translation),
  };
  const direct = translated.p1.distanceTo(targetEdge.p1) + translated.p2.distanceTo(targetEdge.p2);
  const swapped = translated.p1.distanceTo(targetEdge.p2) + translated.p2.distanceTo(targetEdge.p1);
  return Math.min(direct, swapped);
}

function edgeLineDriftScore(firstEdge, secondEdge) {
  const direct = firstEdge.p1.distanceTo(secondEdge.p1) + firstEdge.p2.distanceTo(secondEdge.p2);
  const swapped = firstEdge.p1.distanceTo(secondEdge.p2) + firstEdge.p2.distanceTo(secondEdge.p1);
  return Math.min(direct, swapped);
}

function pointOnSegmentFit(point, start, end) {
  const span = end.clone().sub(start);
  const lengthSq = span.lengthSq();

  if (lengthSq < 0.0001) {
    return { raw: 0, distance: point.distanceTo(start) };
  }

  const raw = point.clone().sub(start).dot(span) / lengthSq;
  const clamped = THREE.MathUtils.clamp(raw, 0, 1);
  const closest = start.clone().add(span.multiplyScalar(clamped));

  return {
    raw,
    distance: point.distanceTo(closest),
  };
}

function quaternionFromEdgePair(localFirstVector, localSecondVector, worldFirstVector, worldSecondVector) {
  const localX = localFirstVector.clone().normalize();
  const localZ = localFirstVector.clone().cross(localSecondVector).normalize();
  const worldX = worldFirstVector.clone().normalize();
  const worldZ = worldFirstVector.clone().cross(worldSecondVector).normalize();

  if (localZ.lengthSq() < 0.001 || worldZ.lengthSq() < 0.001) {
    return null;
  }

  const localY = localZ.clone().cross(localX).normalize();
  const worldY = worldZ.clone().cross(worldX).normalize();
  const localBasis = new THREE.Matrix4().makeBasis(localX, localY, localZ);
  const worldBasis = new THREE.Matrix4().makeBasis(worldX, worldY, worldZ);
  const rotationMatrix = worldBasis.clone().multiply(localBasis.clone().invert());

  return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
}

function projectedFaceNormal(normal, edgeDirection) {
  if (!normal) return null;

  const projected = normal.clone().projectOnPlane(edgeDirection);
  if (projected.lengthSq() < 0.0001) return null;
  return projected.normalize();
}

function pushFaceNormalCandidate(candidates, normal, weight) {
  if (!normal || normal.lengthSq() < 0.0001) return;

  const normalized = normal.clone().normalize();
  if (candidates.some((candidate) => candidate.normal.dot(normalized) > 0.995)) return;
  candidates.push({ normal: normalized, weight });
}

function attachmentFaceNormalCandidates(orientation, targetEdge, preferredNormals = []) {
  const candidates = [];
  const orientationNormal = faceNormalForQuaternion(orientationQuaternion(orientation));

  preferredNormals.forEach((entry) => {
    const normal = entry?.normal || entry;
    const weight = typeof entry?.weight === 'number' ? entry.weight : 1.5;
    const projected = projectedFaceNormal(normal, targetEdge.direction);
    if (!projected) return;

    pushFaceNormalCandidate(candidates, projected, weight);
    pushFaceNormalCandidate(candidates, projected.clone().negate(), weight + 0.15);
  });

  const projectedOrientation = projectedFaceNormal(orientationNormal, targetEdge.direction);
  if (projectedOrientation) {
    pushFaceNormalCandidate(candidates, projectedOrientation, 1.9);
    pushFaceNormalCandidate(candidates, projectedOrientation.clone().negate(), 2.05);
  }

  if (candidates.length) return candidates;

  const fallback = targetEdge.normal.clone().cross(targetEdge.direction);
  if (fallback.lengthSq() > 0.0001) {
    pushFaceNormalCandidate(candidates, fallback.normalize(), 1.4);
    pushFaceNormalCandidate(candidates, fallback.normalize().negate(), 1.55);
  }

  return candidates;
}

function quaternionFromEdgeAndFaceNormal(edge, worldEdgeDirection, worldFaceNormal) {
  const localEdgeDirection = localPanelPoint(edge.direction).normalize();
  const localFaceNormal = new THREE.Vector3(0, 0, 1);
  const localSide = localFaceNormal.clone().cross(localEdgeDirection).normalize();
  const worldEdge = worldEdgeDirection.clone().normalize();
  const worldFace = projectedFaceNormal(worldFaceNormal, worldEdge);
  if (!worldFace) return null;

  const worldSide = worldFace.clone().cross(worldEdge).normalize();
  if (localSide.lengthSq() < 0.0001 || worldSide.lengthSq() < 0.0001) return null;

  const localBasis = new THREE.Matrix4().makeBasis(localEdgeDirection, localSide, localFaceNormal);
  const worldBasis = new THREE.Matrix4().makeBasis(worldEdge, worldSide, worldFace);
  const rotationMatrix = worldBasis.clone().multiply(localBasis.clone().invert());

  return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
}

function attachmentTransformForEdgeCandidate(block, edge, targetEdge, desiredFaceNormal, directionSign) {
  const quaternion = quaternionFromEdgeAndFaceNormal(
    edge,
    targetEdge.direction.clone().multiplyScalar(directionSign),
    desiredFaceNormal
  );
  if (!quaternion) return null;

  const movedMid = localPanelPoint(edge.mid).applyQuaternion(quaternion);
  const initialTransform = transformForBlock(
    block,
    targetEdge.mid.clone().sub(movedMid),
    quaternion
  );

  return alignTransformEdgeToTarget(block, edge.id, initialTransform, targetEdge);
}

function secondaryAttachmentEdges(targetEdge, ignoredBlockIds = []) {
  const edges = [];

  state.blocks.forEach((block) => {
    if (ignoredBlockIds.includes(block.id)) return;

    blockEdgeAnchorsForStoredBlock(block).forEach((edge) => {
      if (edge.mid.distanceTo(targetEdge.mid) > Math.max(targetEdge.length, edge.length) + 2.2) return;
      edges.push({ ...edge, blockId: block.id });
    });
  });

  return edges;
}

function edgeAttachmentContactScore(movingEdge, otherEdge) {
  const lengthGap = Math.abs(movingEdge.length - otherEdge.length);
  const lineDrift = edgeLineDriftScore(movingEdge, otherEdge);
  const directionError = 1 - Math.abs(movingEdge.direction.dot(otherEdge.direction));
  const normalError = Math.abs(1 + movingEdge.normal.dot(otherEdge.normal));
  const midDistance = movingEdge.mid.distanceTo(otherEdge.mid);

  if (lengthGap > Math.max(0.42, Math.min(movingEdge.length, otherEdge.length) * 0.55)) {
    return Number.POSITIVE_INFINITY;
  }
  if (lineDrift > 1.25 || directionError > 0.24 || midDistance > Math.max(movingEdge.length, otherEdge.length) + 1.4) {
    return Number.POSITIVE_INFINITY;
  }

  return lineDrift * 10
    + directionError * 5
    + normalError * 4.2
    + lengthGap * 3.6
    + midDistance * 0.55;
}

function attachmentSecondaryMetrics(block, attachedEdgeId, transform, secondaryEdges) {
  if (!secondaryEdges.length) {
    return { score: 0, contactCount: 0 };
  }

  const matches = [];
  const movingEdges = blockEdgeAnchorsForTransform(block, transform.positionVector, transform.quaternion)
    .filter((edge) => edge.id !== attachedEdgeId);

  movingEdges.forEach((movingEdge) => {
    let best = Number.POSITIVE_INFINITY;

    secondaryEdges.forEach((otherEdge) => {
      const score = edgeAttachmentContactScore(movingEdge, otherEdge);
      if (score < best) {
        best = score;
      }
    });

    if (Number.isFinite(best)) {
      matches.push(best);
    }
  });

  matches.sort((a, b) => a - b);
  const bestMatches = matches.slice(0, 2);

  return {
    score: bestMatches.reduce((sum, score) => sum + score, 0),
    contactCount: bestMatches.filter((score) => score < 10.5).length,
  };
}

function evaluateAttachmentTransform(block, attachedEdgeId, targetEdge, transform, desiredFaceNormal, faceWeight, secondaryEdges) {
  const attachedEdge = edgeAnchorForTransform(block, attachedEdgeId, transform.positionVector, transform.quaternion);
  if (!attachedEdge) return null;

  const attachDrift = edgeLineDriftScore(attachedEdge, targetEdge);
  const directionError = 1 - Math.abs(attachedEdge.direction.dot(targetEdge.direction));
  if (attachDrift > 0.16 || directionError > 0.08) return null;

  if (attachedEdge.normal.dot(targetEdge.normal) > 0.35) return null;

  const projectedDesired = projectedFaceNormal(desiredFaceNormal, targetEdge.direction);
  const faceNormal = faceNormalForQuaternion(transform.quaternion);
  const faceError = projectedDesired ? 1 - faceNormal.dot(projectedDesired) : 0;
  const secondary = attachmentSecondaryMetrics(block, attachedEdgeId, transform, secondaryEdges);
  const score = attachDrift * 140
    + directionError * 22
    + faceError * faceWeight
    + secondary.score
    - secondary.contactCount * 3.4;

  return {
    score,
    contactCount: secondary.contactCount,
    transform,
  };
}

function isBetterAttachmentPlacement(candidate, best) {
  if (!candidate) return false;
  if (!best) return true;
  if (candidate.score + 0.001 < best.score) return true;
  if (Math.abs(candidate.score - best.score) <= 0.001 && candidate.contactCount > best.contactCount) return true;
  return false;
}

function rotatedAttachmentCandidate(block, attachedEdgeId, baseTransform, targetEdge, desiredFaceNormal, faceWeight, secondaryEdges, angleDeg) {
  const rotated = rotateTransformAroundLine(
    block,
    baseTransform,
    targetEdge.p1,
    targetEdge.direction,
    THREE.MathUtils.degToRad(angleDeg)
  );
  if (!rotated) return null;

  const aligned = alignTransformEdgeToTarget(block, attachedEdgeId, rotated, targetEdge);
  if (!aligned) return null;

  const evaluated = evaluateAttachmentTransform(
    block,
    attachedEdgeId,
    targetEdge,
    aligned,
    desiredFaceNormal,
    faceWeight,
    secondaryEdges
  );
  if (!evaluated) return null;

  return {
    ...evaluated,
    angleDeg,
  };
}

function refineAttachmentTransform(block, attachedEdgeId, baseTransform, targetEdge, desiredFaceNormal, faceWeight, secondaryEdges) {
  let best = evaluateAttachmentTransform(
    block,
    attachedEdgeId,
    targetEdge,
    baseTransform,
    desiredFaceNormal,
    faceWeight,
    secondaryEdges
  );
  if (!best || !secondaryEdges.length) {
    return best;
  }

  for (let angle = -165; angle <= 165; angle += 6) {
    if (angle === 0) continue;
    const candidate = rotatedAttachmentCandidate(
      block,
      attachedEdgeId,
      baseTransform,
      targetEdge,
      desiredFaceNormal,
      faceWeight,
      secondaryEdges,
      angle
    );
    if (isBetterAttachmentPlacement(candidate, best)) {
      best = candidate;
    }
  }

  const refinedStart = Math.round(best.angleDeg || 0) - 6;
  const refinedEnd = Math.round(best.angleDeg || 0) + 6;
  for (let angle = refinedStart; angle <= refinedEnd; angle += 1) {
    const candidate = rotatedAttachmentCandidate(
      block,
      attachedEdgeId,
      baseTransform,
      targetEdge,
      desiredFaceNormal,
      faceWeight,
      secondaryEdges,
      angle
    );
    if (isBetterAttachmentPlacement(candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

function bestEdgeAttachmentPlacement({
  type,
  orientation,
  targetEdge,
  baseBlock = null,
  forcedEdgeId = null,
  preferredNormals = [],
  ignoreBlockIds = [],
  useSecondaryEdges = true,
}) {
  const block = { typeId: type.id, orientation };
  const ignoredBlockIds = [...new Set([...ignoreBlockIds, baseBlock?.id].filter(Boolean))];
  const secondaryEdges = useSecondaryEdges
    ? secondaryAttachmentEdges(targetEdge, ignoredBlockIds)
    : [];
  const faceCandidates = attachmentFaceNormalCandidates(orientation, targetEdge, preferredNormals);
  let best = null;

  shapeEdgesForType(type).forEach((edge) => {
    if (forcedEdgeId && edge.id !== forcedEdgeId) return;

    const lengthGap = Math.abs(edge.length - targetEdge.length);
    const minLength = Math.min(edge.length, targetEdge.length);
    if (lengthGap > Math.max(0.12, minLength * 0.20)) return;

    faceCandidates.forEach((candidate) => {
      [-1, 1].forEach((directionSign) => {
        const baseTransform = attachmentTransformForEdgeCandidate(
          block,
          edge,
          targetEdge,
          candidate.normal,
          directionSign
        );
        if (!baseTransform) return;

        const evaluated = refineAttachmentTransform(
          block,
          edge.id,
          baseTransform,
          targetEdge,
          candidate.normal,
          candidate.weight,
          secondaryEdges
        );
        if (!evaluated) return;

        const placement = {
          ...evaluated,
          orientation,
          blockEdgeId: edge.id,
        };

        const rot = placement.transform.rotation;
        const axisDeviation = (angleDeg) => {
          const mod = ((Math.abs(angleDeg) % 90) + 90) % 90;
          return Math.min(mod, 90 - mod);
        };
        const devX = axisDeviation(rot.x);
        const devY = axisDeviation(rot.y);
        const devZ = axisDeviation(rot.z);
        if (devX > 5) placement.score += devX * 0.1;
        if (devY > 5) placement.score += devY * 0.1;
        if (devZ > 5) placement.score += devZ * 0.1;

        const lengthDifference = Math.abs(targetEdge.length - edge.length);
        placement.score += lengthDifference * 4.0;

        if (isBetterAttachmentPlacement(placement, best)) {
          best = placement;
        }
      });
    });
  });

  if (!best) return null;

  return {
    score: best.score,
    contactCount: best.contactCount,
    orientation: best.orientation,
    blockEdgeId: best.blockEdgeId,
    position: best.transform.position,
    rotation: best.transform.rotation,
  };
}

function angularDifference(first, second) {
  const diff = Math.abs(normalizeDegrees(first) - normalizeDegrees(second)) % 360;
  return Math.min(diff, 360 - diff);
}

function attachmentPlacementNeedsUpdate(block, placement) {
  return Math.abs(block.position.x - placement.position.x) > 0.002
    || Math.abs(block.position.y - placement.position.y) > 0.002
    || Math.abs(block.position.z - placement.position.z) > 0.002
    || angularDifference(block.rotation.x, placement.rotation.x) > 0.05
    || angularDifference(block.rotation.y, placement.rotation.y) > 0.05
    || angularDifference(block.rotation.z, placement.rotation.z) > 0.05;
}

function stabilizedAttachmentPlacementForBlock(block) {
  if (!block?.attachment || block.attachment.mode !== 'custom-edge') return null;

  const baseBlock = state.blocks.find((item) => item.id === block.attachment.baseBlockId);
  if (!baseBlock || baseBlock.id === block.id) return null;

  const targetEdge = edgeAnchorForStoredBlock(baseBlock, block.attachment.baseEdgeId);
  if (!targetEdge) return null;

  const currentFaceNormal = faceNormalForQuaternion(quaternionForBlock(block));
  const baseFaceNormal = faceNormalForQuaternion(quaternionForBlock(baseBlock));
  const secondaryEdges = secondaryAttachmentEdges(targetEdge, [block.id, baseBlock.id]);
  const preservedTransform = alignTransformEdgeToTarget(
    block,
    block.attachment.blockEdgeId,
    storedBlockTransform(block),
    targetEdge
  );
  const preserved = preservedTransform
    ? evaluateAttachmentTransform(
      block,
      block.attachment.blockEdgeId,
      targetEdge,
      preservedTransform,
      currentFaceNormal,
      2.4,
      secondaryEdges
    )
    : null;

  if (preserved) {
    return {
      score: preserved.score,
      contactCount: preserved.contactCount,
      orientation: block.orientation,
      blockEdgeId: block.attachment.blockEdgeId,
      position: preserved.transform.position,
      rotation: preserved.transform.rotation,
    };
  }

  return bestEdgeAttachmentPlacement({
    type: blockType(block.typeId),
    orientation: block.orientation,
    targetEdge,
    baseBlock,
    forcedEdgeId: block.attachment.blockEdgeId,
    preferredNormals: [
      { normal: currentFaceNormal, weight: 1.05 },
      { normal: baseFaceNormal, weight: 1.35 },
    ],
    ignoreBlockIds: [block.id],
  });
}

function stabilizeEdgeAttachments(maxPasses = 4, options = {}) {
  const { enforceAutoSymmetry: shouldEnforceAutoSymmetry = true } = options;
  let changed = false;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let passChanged = false;

    state.blocks.forEach((block) => {
      if (!block?.attachment || block.attachment.mode !== 'custom-edge') return;

      const baseBlockExists = state.blocks.some((item) => item.id === block.attachment.baseBlockId);
      if (!baseBlockExists) {
        block.attachment = null;
        changed = true;
        passChanged = true;
        return;
      }

      const placement = stabilizedAttachmentPlacementForBlock(block);
      if (!placement || !attachmentPlacementNeedsUpdate(block, placement)) return;

      block.position = roundVector(placement.position);
      block.rotation = {
        x: normalizeDegrees(placement.rotation.x),
        y: normalizeDegrees(placement.rotation.y),
        z: normalizeDegrees(placement.rotation.z),
      };
      changed = true;
      passChanged = true;
    });

    if (shouldEnforceAutoSymmetry && enforceAutoSymmetry()) {
      changed = true;
      passChanged = true;
    }

    if (!passChanged) break;
  }

  return changed;
}

function canonicalAxisKey(axis) {
  const components = [axis.x, axis.y, axis.z];
  const absComponents = components.map(Math.abs);
  let maxIdx = 0;
  if (absComponents[1] > absComponents[0]) maxIdx = 1;
  if (absComponents[2] > absComponents[maxIdx]) maxIdx = 2;
  const sign = components[maxIdx] < 0 ? -1 : 1;
  return components.map((value) => Math.round(value * sign * 100) / 100).join(',');
}

function enforceAutoSymmetry() {
  if (!state.autoSymmetry) return false;

  const groups = new Map();

  state.blocks.forEach((block) => {
    const context = customAttachmentContextForBlock(block);
    if (!context) return;
    const angleState = customAttachmentAngleState(context);
    if (!angleState) return;

    const key = `${context.baseBlock.id}|${canonicalAxisKey(angleState.axis)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ block, context, angleState });
  });

  let changed = false;

  groups.forEach((entries) => {
    if (entries.length < 2) return;

    const averageAbsAngle = entries.reduce(
      (sum, entry) => sum + Math.abs(entry.angleState.currentAngleDeg),
      0
    ) / entries.length;

    entries.forEach(({ block, context, angleState }) => {
      const sign = Math.abs(angleState.currentAngleDeg) < 0.001 ? 1 : Math.sign(angleState.currentAngleDeg);
      const targetAngle = sign * averageAbsAngle;

      if (Math.abs(targetAngle - angleState.currentAngleDeg) < 0.05) return;

      const transform = transformForCustomAttachmentAngle(context, targetAngle, angleState);
      if (!transform) return;

      block.position = roundVector(transform.position);
      block.rotation = {
        x: normalizeDegrees(transform.rotation.x),
        y: normalizeDegrees(transform.rotation.y),
        z: normalizeDegrees(transform.rotation.z),
      };
      changed = true;
    });
  });

  return changed;
}

function orientationPreservingAttachment(type, orientation, targetEdge, baseBlock) {
  const effectiveOrientation = orientation === 'custom' ? baseBlock.orientation : orientation;
  const bestMatch = closestLengthEdge(type, targetEdge);
  if (!bestMatch || !edgeCanAttachToTarget(bestMatch.edge, targetEdge)) return null;

  const position = targetEdge.mid.clone();
  position.addScaledVector(targetEdge.normal, halfThicknessForOrientation(type, effectiveOrientation, targetEdge));
  if (effectiveOrientation !== 'floor') {
    position.y = Math.max(position.y, type.height / 2);
  }

  return {
    score: 0.5,
    orientation: effectiveOrientation,
    position: roundVector(position),
    rotation: { x: 0, y: 0, z: 0 },
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: bestMatch.edge.id,
    },
    message: `${targetEdge.label} üzerine ${orientationLabel(effectiveOrientation)} yerleşti`,
  };
}

function triangleEdgeSnapFor(type, orientation, targetEdge, baseBlock) {
  const effectiveOrientation = orientation === 'custom' ? baseBlock.orientation : orientation;
  const best = closestLengthEdge(type, targetEdge);
  if (!best) return null;

  const lengthRatio = best.diff / Math.max(best.edge.length, targetEdge.length);
  if (lengthRatio > 0.15) return null;

  const baseFaceNormal = baseBlock ? faceNormalForBlock(baseBlock) : null;
  const placement = bestEdgeAttachmentPlacement({
    type,
    orientation: effectiveOrientation,
    targetEdge,
    baseBlock,
    forcedEdgeId: best.edge.id,
    preferredNormals: baseFaceNormal ? [{ normal: baseFaceNormal, weight: 2.0 }] : [],
  });

  if (!placement) return null;

  return {
    score: placement.score,
    orientation: placement.orientation,
    position: placement.position,
    rotation: placement.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: placement.blockEdgeId,
    },
    message: `${targetEdge.label} üzerine üçgen ${best.edge.label || 'kenarı'} oturdu`,
  };
}

function longTriangleChainSideFallback(type, orientation, targetEdge, baseBlock) {
  if (type.id !== 'long-triangle') return null;

  const fixture = triangleBridgeFixture(type);
  if (!fixture) return null;

  const expectedLength = fixture.edgeLength;
  const tolerance = 0.12;
  let virtualTarget = null;
  let baseChain = null;

  if (Math.abs(targetEdge.length - expectedLength) <= tolerance) {
    virtualTarget = targetEdge;
  } else {
    baseChain = collinearEdgeChainFor(baseBlock, targetEdge, expectedLength, { tolerance });
    if (baseChain) {
      virtualTarget = chainToVirtualEdge(baseChain, targetEdge);
    }
  }

  if (!virtualTarget) return null;

  return longTriangleSideEdgeAttachment(
    type,
    orientation,
    virtualTarget,
    baseBlock,
    targetEdge.id,
    'long triangle chain-side fallback',
    {
      baseChain,
      baseEdge: targetEdge,
      fixture,
      type,
    }
  );
}

function longTriangleSingleEdgeFallback(type, orientation, targetEdge, baseBlock) {
  if (type.id !== 'long-triangle') return null;

  const sidePlacement = longTriangleChainSideFallback(type, orientation, targetEdge, baseBlock);
  if (sidePlacement && !sidePlacement.rejected) {
    return {
      ...sidePlacement,
      message: sidePlacement.message.replace('long triangle chain-side fallback', 'long triangle side-edge fallback'),
    };
  }

  const effectiveOrientation = orientation === 'custom' ? baseBlock.orientation : orientation;
  const baseFaceNormal = baseBlock ? faceNormalForBlock(baseBlock) : null;
  const baseEdge = shapeEdgesForType(type).find((edge) => edge.id === 'edge-0');
  if (!baseEdge) return null;

  const lengthRatio = Math.abs(baseEdge.length - targetEdge.length) / Math.max(baseEdge.length, targetEdge.length);
  if (lengthRatio > 0.15) return null;

  const placement = bestEdgeAttachmentPlacement({
    type,
    orientation: effectiveOrientation,
    targetEdge,
    baseBlock,
    forcedEdgeId: baseEdge.id,
    preferredNormals: baseFaceNormal ? [{ normal: baseFaceNormal, weight: 2.0 }] : [],
  });

  if (!placement) return null;

  return {
    score: placement.score,
    orientation: placement.orientation,
    position: placement.position,
    rotation: placement.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: placement.blockEdgeId,
    },
    message: `long triangle base-edge fallback · ${targetEdge.label} üzerine büyük üçgen ${baseEdge.label || 'kenarı'} oturdu`,
  };
}

function longTriangleSideEdgeAttachment(type, orientation, targetEdge, baseBlock, baseEdgeId, messagePrefix, supportContext = {}) {
  const candidates = collectLongTriangleSideCandidates(type, orientation, targetEdge, baseBlock);
  const accepted = candidates
    .filter((candidate) => candidate.ok)
    .map((candidate) => equalizeSupportPanelsForLongTriangle(candidate, {
      ...supportContext,
      type,
      targetEdge,
      baseBlock,
      baseEdgeId,
    }))
    .sort((a, b) => (
      (a.apexScore - b.apexScore)
      || (a.inwardScore - b.inwardScore)
      || ((a.supportContactScore ?? 0) - (b.supportContactScore ?? 0))
      || ((a.supportSymmetryScore ?? 0) - (b.supportSymmetryScore ?? 0))
      || (a.attachmentScore - b.attachmentScore)
      || (a.score - b.score)
    ));
  const best = accepted[0] || null;

  if (!best) {
    const hasApexUp = candidates.some((candidate) => candidate.rejectedReason === 'apex up');
    const hasOutward = candidates.some((candidate) => candidate.rejectedReason === 'outward');
    if (hasApexUp || hasOutward) {
      return {
        rejected: true,
        message: `${messagePrefix} (rejected: ${hasApexUp ? 'apex up' : 'outward'})`,
      };
    }
    return null;
  }

  return {
    score: best.score,
    orientation: best.orientation,
    position: best.transform.position,
    rotation: best.transform.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId,
      blockEdgeId: best.blockEdgeId,
    },
    adjustments: best.adjustments || [],
    message: longTriangleSupportEqualizationMessage(
      messagePrefix,
      `${targetEdge.label} üzerine büyük üçgen ${best.blockEdgeId} ile oturdu`,
      best
    ),
  };
}

function collectLongTriangleSideCandidates(type, orientation, targetEdge, baseBlock) {
  const fixture = triangleBridgeFixture(type);
  if (!fixture) return [];

  const effectiveOrientation = orientation === 'custom' ? baseBlock.orientation : orientation;
  const block = { typeId: type.id, orientation: effectiveOrientation };
  const edges = shapeEdgesForType(type).filter((edge) => edge.id === 'edge-1' || edge.id === 'edge-2');
  const desiredNormal = longTriangleSideFallbackFaceNormal(effectiveOrientation, targetEdge, baseBlock);
  if (!desiredNormal) return [];

  const candidates = [];

  edges.forEach((edge) => {
    const lengthGap = Math.abs(edge.length - targetEdge.length);
    const minLength = Math.min(edge.length, targetEdge.length);
    if (lengthGap > Math.max(0.12, minLength * 0.20)) return;

    [-1, 1].forEach((directionSign) => {
      const baseTransform = attachmentTransformForEdgeCandidate(
        block,
        edge,
        targetEdge,
        desiredNormal,
        directionSign
      );
      if (!baseTransform) return;

      for (let angle = -18; angle <= 18; angle += 3) {
        const evaluated = angle === 0
          ? evaluateAttachmentTransform(block, edge.id, targetEdge, baseTransform, desiredNormal, 2.0, [])
          : rotatedAttachmentCandidate(block, edge.id, baseTransform, targetEdge, desiredNormal, 2.0, [], angle);
        const transform = evaluated?.transform;
        if (!evaluated || !transform) continue;

        const sideCandidate = evaluateLongTriangleSideCandidate(
          fixture,
          effectiveOrientation,
          edge.id,
          targetEdge,
          baseBlock,
          transform,
          evaluated.score,
          angle
        );
        if (sideCandidate) candidates.push(sideCandidate);
      }
    });
  });

  return candidates;
}

function longTriangleSideFallbackFaceNormal(orientation, targetEdge, baseBlock) {
  const baseFaceNormal = baseBlock ? faceNormalForBlock(baseBlock) : null;
  const primary = baseFaceNormal
    ? projectedFaceNormal(baseFaceNormal, targetEdge.direction)
    : null;
  if (primary) return primary;

  const orientationNormal = faceNormalForQuaternion(orientationQuaternion(orientation));
  const oriented = projectedFaceNormal(orientationNormal, targetEdge.direction);
  if (oriented) return oriented;

  const fallback = targetEdge.normal.clone().cross(targetEdge.direction);
  return fallback.lengthSq() > 0.0001 ? fallback.normalize() : null;
}

function evaluateLongTriangleSideCandidate(
  fixture,
  orientation,
  blockEdgeId,
  targetEdge,
  baseBlock,
  transform,
  attachmentScore,
  angleDeg
) {
  const points = longTriangleTransformedFixturePoints(fixture, transform);
  if (!points) return null;

  const apexScore = longTriangleApexDownScore(points.apex, points.rightPoint, points.leftPoint);
  const inwardScore = longTriangleInwardScore(transform, points.apex, targetEdge, baseBlock);
  if (apexScore >= 80) {
    return { ok: false, rejectedReason: 'apex up', apexScore, inwardScore, blockEdgeId };
  }
  if (inwardScore >= 100) {
    return { ok: false, rejectedReason: 'outward', apexScore, inwardScore, blockEdgeId };
  }

  return {
    ok: true,
    score: attachmentScore + apexScore * 3.6 + inwardScore * 2.4 + Math.abs(angleDeg) * 0.08,
    orientation,
    blockEdgeId,
    transform,
    apexScore,
    inwardScore,
    attachmentScore,
  };
}

function longTriangleTransformedFixturePoints(fixture, transform) {
  if (!fixture || !transform?.positionVector || !transform?.quaternion) return null;

  const point = (localPoint) => localPoint.clone()
    .applyQuaternion(transform.quaternion)
    .add(transform.positionVector);

  return {
    apex: point(fixture.apex),
    rightPoint: point(fixture.rightPoint),
    leftPoint: point(fixture.leftPoint),
  };
}

function equalizeSupportPanelsForLongTriangle(candidate, context) {
  const { type, fixture, baseBlock, baseChain, baseEdge, targetEdge } = context;
  if (!candidate?.ok || !baseChain || !fixture || type?.id !== 'long-triangle') return candidate;

  const provisionalPlacement = longTrianglePlacementFromCandidate(candidate);
  const partnerChain = findOppositeSupportChainForLongTriangle(
    provisionalPlacement,
    candidate.blockEdgeId,
    baseBlock,
    baseChain,
    fixture
  );
  if (!partnerChain) return candidate;

  const beforeContact = oppositeEdgeContactScore(provisionalPlacement, baseBlock, baseChain, partnerChain);
  const beforeSymmetry = supportAngleSymmetryScore(baseBlock, baseChain, partnerChain);
  const baseline = supportConfigurationMetrics(baseBlock, baseChain, partnerChain);
  let best = null;
  let rejectionReason = 'no safe measurable improvement';
  const deltas = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

  deltas.forEach((baseDelta) => {
    deltas.forEach((partnerDelta) => {
      if (Math.abs(baseDelta) < 0.001 && Math.abs(partnerDelta) < 0.001) return;

      const adjustments = longTriangleSupportAdjustmentsForDeltas(baseChain, partnerChain, baseDelta, partnerDelta);
      if (!adjustments.length) return;

      const magnitude = maxSupportAdjustmentDegrees(adjustments);
      if (magnitude > 6.25) {
        rejectionReason = 'candidate rejected: excessive delta';
        return;
      }

      const validity = isValidLongTriangleSupportConfiguration(
        provisionalPlacement,
        baseBlock,
        baseChain,
        partnerChain,
        adjustments,
        baseline
      );
      if (!validity.ok) {
        rejectionReason = `candidate rejected: ${validity.reason}`;
        return;
      }

      const simulatedState = simulateBlockAdjustments(adjustments);
      const reseatedTarget = virtualEdgeFromChainInState(baseBlock, baseChain, simulatedState, baseEdge || targetEdge);
      const reseatedPartner = virtualEdgeFromChainInState(partnerChain.blocks[0], partnerChain, simulatedState);
      const reseatedPlacement = reseatedTarget && reseatedPartner
        ? scoreLongTriangleBridgePlacement(
          type,
          trianglePlacementForEdgePair(fixture, reseatedTarget, reseatedPartner),
          reseatedTarget,
          baseBlock
        )
        : null;
      const reseatedCandidate = reseatedPlacement
        ? longTriangleCandidateFromPlacement(reseatedPlacement, candidate.blockEdgeId, reseatedTarget, baseBlock, fixture)
        : null;
      if (!reseatedCandidate?.ok) return;

      const finalValidity = isValidLongTriangleSupportConfiguration(
        reseatedPlacement,
        baseBlock,
        baseChain,
        partnerChain,
        adjustments,
        baseline
      );
      if (!finalValidity.ok) {
        rejectionReason = `candidate rejected: ${finalValidity.reason}`;
        return;
      }

      const finalContact = oppositeEdgeContactScore(reseatedPlacement, baseBlock, baseChain, partnerChain, adjustments);
      const symmetryScore = supportAngleSymmetryScore(baseBlock, baseChain, partnerChain, adjustments);
      const liftScore = panelLiftImprovementScore(baseChain, partnerChain, adjustments);
      const contactImprovement = beforeContact - finalContact;
      const symmetryImprovement = beforeSymmetry - symmetryScore;
      const topLiftImprovement = finalValidity.metrics
        ? finalValidity.metrics.averageTopY - baseline.averageTopY
        : liftScore;
      if (contactImprovement < -0.02 || symmetryImprovement < -0.04) {
        rejectionReason = 'candidate rejected: invalid V opening';
        return;
      }

      const measurableImprovement = contactImprovement > 0.035
        || symmetryImprovement > 0.035
        || (topLiftImprovement > 0.018 && (contactImprovement > 0.015 || symmetryImprovement > 0.015));
      if (!measurableImprovement) {
        rejectionReason = 'no safe measurable improvement';
        return;
      }

      const finalBlockEdgeId = longTriangleAttachedSideEdgeId(reseatedPlacement, reseatedTarget || targetEdge)
        || reseatedCandidate.blockEdgeId;
      const finalTransform = transformForLongTrianglePlacement(reseatedPlacement);
      const adjustmentPenalty = minimalAdjustmentPenalty(adjustments);
      const deltaBalancePenalty = Math.abs(Math.abs(baseDelta) - Math.abs(partnerDelta));
      const score = reseatedCandidate.score
        + finalContact * 70
        + symmetryScore * 28
        + supportValidityPenalty(finalValidity) * 40
        + adjustmentPenalty * 12
        + magnitude * 7
        + deltaBalancePenalty * 2.5
        - Math.max(0, contactImprovement) * 12
        - Math.max(0, symmetryImprovement) * 8
        - Math.max(0, topLiftImprovement) * 1.2;

      if (!best || score < best.score) {
        best = {
          ...reseatedCandidate,
          blockEdgeId: finalBlockEdgeId,
          transform: finalTransform || reseatedCandidate.transform,
          score,
          attachmentScore: reseatedCandidate.attachmentScore + finalContact * 8,
          adjustments,
          supportContactScore: finalContact,
          supportSymmetryScore: symmetryScore,
          panelLiftScore: liftScore,
          supportLiftDegrees: supportPanelLiftDegrees(adjustments),
          supportEqualized: true,
          supportImproved: true,
          supportCorrectionDegrees: magnitude,
          supportDeltaDegrees: Math.max(Math.abs(baseDelta), Math.abs(partnerDelta)),
        };
      }
    });
  });

  return best || {
    ...candidate,
    supportEqualizationStatus: longTriangleSupportEqualizationStatus(rejectionReason),
  };
}

function longTrianglePlacementFromCandidate(candidate) {
  return {
    score: candidate.score,
    orientation: candidate.orientation,
    position: candidate.transform.position,
    rotation: candidate.transform.rotation,
  };
}

function longTriangleCandidateFromPlacement(placement, fallbackEdgeId, targetEdge, baseBlock, fixture) {
  const transform = transformForLongTrianglePlacement(placement);
  if (!transform) return null;

  const blockEdgeId = longTriangleAttachedSideEdgeId(placement, targetEdge) || fallbackEdgeId;
  return evaluateLongTriangleSideCandidate(
    fixture,
    placement.orientation,
    blockEdgeId,
    targetEdge,
    baseBlock,
    transform,
    placement.score || 0,
    0
  );
}

function transformForLongTrianglePlacement(placement) {
  if (!placement?.position || !placement?.rotation) return null;

  const block = {
    typeId: 'long-triangle',
    orientation: placement.orientation || 'front',
    rotation: placement.rotation,
  };
  return transformForBlock(
    block,
    new THREE.Vector3(placement.position.x, placement.position.y, placement.position.z),
    quaternionForBlock(block)
  );
}

function longTriangleAttachedSideEdgeId(placement, targetEdge) {
  const sideEdges = longTriangleWorldSideEdges(placement);
  return sideEdges
    .map((edge) => ({ id: edge.id, score: edgeLineDriftScore(edge, targetEdge) }))
    .sort((a, b) => a.score - b.score)[0]?.id || null;
}

function findOppositeSupportChainForLongTriangle(placement, attachedEdgeId, baseBlock, baseChain, fixture) {
  const sideEdges = longTriangleWorldSideEdges(placement);
  const oppositeSide = sideEdges.find((edge) => edge.id !== attachedEdgeId);
  if (!oppositeSide || !baseChain) return null;

  const excludedIds = baseChain.blocks.map((block) => block.id);
  const tolerance = 0.12;
  let best = null;

  state.blocks.forEach((block) => {
    if (excludedIds.includes(block.id) || block.id === baseBlock.id) return;

    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      const canSeed = Math.abs(edge.length - fixture.edgeLength) <= tolerance
        || Math.abs(edge.length - fixture.edgeLength / 2) <= Math.max(tolerance, fixture.edgeLength * 0.15);
      if (!canSeed) return;

      const chain = collinearEdgeChainFor(block, edge, fixture.edgeLength, {
        tolerance,
        excludeBlockIds: excludedIds,
        seedSupportBlockId: baseBlock.id,
      });
      if (!chain) return;

      const virtualEdge = chainToVirtualEdge(chain, edge);
      const score = supportChainSideDistance(virtualEdge, oppositeSide);
      if (score > 7.5) return;
      if (!best || score < best.score) {
        best = { chain, score };
      }
    });
  });

  return best?.chain || null;
}

function supportChainSideDistance(chainEdge, sideEdge) {
  const endpointGap = pointOnSegmentFit(chainEdge.p1, sideEdge.p1, sideEdge.p2).distance
    + pointOnSegmentFit(chainEdge.p2, sideEdge.p1, sideEdge.p2).distance;
  const sideEndpointGap = pointOnSegmentFit(sideEdge.p1, chainEdge.p1, chainEdge.p2).distance
    + pointOnSegmentFit(sideEdge.p2, chainEdge.p1, chainEdge.p2).distance;
  const directionError = 1 - Math.abs(chainEdge.direction.dot(sideEdge.direction));
  const midGap = chainEdge.mid.distanceTo(sideEdge.mid);
  return endpointGap + sideEndpointGap + directionError * 2 + midGap * 0.35;
}

function oppositeEdgeContactScore(placement, baseBlock, baseChain, partnerChain, adjustments = []) {
  if (!baseChain || !partnerChain) return 4;

  const simulatedState = simulateBlockAdjustments(adjustments);
  const targets = longTriangleChainTargetAssignments(placement, baseChain, partnerChain, simulatedState);
  return chainContactGap(baseChain, targets.base, simulatedState)
    + chainContactGap(partnerChain, targets.partner, simulatedState);
}

function chainContactGap(chain, targetLine, simulatedState) {
  if (!chain || !targetLine) return 2;

  return transformedChainEdges(chain, simulatedState).reduce((sum, { edge }) => {
    const mid = edge.p1.clone().add(edge.p2).multiplyScalar(0.5);
    const gap = Math.max(
      pointOnSegmentFit(edge.p1, targetLine.p1, targetLine.p2).distance,
      pointOnSegmentFit(edge.p2, targetLine.p1, targetLine.p2).distance,
      pointOnSegmentFit(mid, targetLine.p1, targetLine.p2).distance
    );
    const directionError = 1 - Math.abs(edge.direction.dot(targetLine.direction));
    return sum + gap + directionError * 0.35;
  }, 0);
}

function supportAngleSymmetryScore(baseBlock, baseChain, partnerChain, adjustments = []) {
  if (!baseChain || !partnerChain) return 1;

  const simulatedState = simulateBlockAdjustments(adjustments);
  const baseEdge = virtualEdgeFromChainInState(baseBlock, baseChain, simulatedState);
  const partnerEdge = virtualEdgeFromChainInState(partnerChain.blocks[0], partnerChain, simulatedState);
  if (!baseEdge || !partnerEdge) return 1;

  const up = new THREE.Vector3(0, 1, 0);
  const baseAngle = Math.acos(THREE.MathUtils.clamp(Math.abs(baseEdge.direction.dot(up)), -1, 1));
  const partnerAngle = Math.acos(THREE.MathUtils.clamp(Math.abs(partnerEdge.direction.dot(up)), -1, 1));
  return Math.abs(baseAngle - partnerAngle);
}

function panelLiftImprovementScore(baseChain, partnerChain, adjustments = []) {
  if (!adjustments.length) return 0;

  const before = averageChainTopY([baseChain, partnerChain], null);
  const after = averageChainTopY([baseChain, partnerChain], simulateBlockAdjustments(adjustments));
  return Math.max(0, after - before);
}

function averageChainTopY(chains, simulatedState = null) {
  const points = [];
  chains.filter(Boolean).forEach((chain) => {
    transformedChainEdges(chain, simulatedState).forEach(({ edge }) => {
      points.push(edge.p1.y, edge.p2.y);
    });
  });
  return points.length ? points.reduce((sum, y) => sum + y, 0) / points.length : 0;
}

function supportPanelLiftDegrees(adjustments = []) {
  const degrees = adjustments.map((adjustment) => {
    const block = state.blocks.find((item) => item.id === adjustment.blockId);
    if (!block) return 0;
    const before = quaternionForBlock(block);
    const after = quaternionForBlock({ ...block, rotation: adjustment.rotation });
    const dot = Math.abs(THREE.MathUtils.clamp(before.dot(after), -1, 1));
    return THREE.MathUtils.radToDeg(2 * Math.acos(dot));
  });
  return degrees.length
    ? degrees.reduce((sum, value) => sum + value, 0) / degrees.length
    : 0;
}

function longTriangleSupportEqualizationMessage(messagePrefix, baseMessage, candidate) {
  if (candidate.supportEqualizationStatus) {
    return `${messagePrefix} (apex-down accepted) · ${candidate.supportEqualizationStatus} · ${baseMessage}`;
  }

  if (!candidate.supportEqualized) {
    return `${messagePrefix} (apex-down accepted) · ${baseMessage}`;
  }

  const correction = Math.round((candidate.supportCorrectionDegrees || candidate.supportLiftDegrees || 0) * 10) / 10;
  const lift = Math.round((candidate.supportLiftDegrees || 0) * 10) / 10;
  return `${messagePrefix} (apex-down accepted) · support equalization started · support equalization applied: +${correction} degrees · support panels lifted by ${lift} degrees · support angle symmetry improved · final long triangle placement after support equalization`;
}

function longTriangleSupportEqualizationStatus(reason) {
  if (reason?.startsWith('candidate rejected:')) {
    return `support equalization ${reason}`;
  }
  return `support equalization skipped: ${reason || 'no safe measurable improvement'}`;
}

function longTriangleSupportAdjustmentsForDeltas(baseChain, partnerChain, baseDelta, partnerDelta) {
  const adjustments = [];
  const simulatedState = simulateBlockAdjustments(adjustments);
  appendChainDeltaAdjustments(baseChain, baseDelta, adjustments, simulatedState);
  appendChainDeltaAdjustments(partnerChain, partnerDelta, adjustments, simulatedState);
  return adjustments;
}

function appendChainDeltaAdjustments(chain, deltaDeg, adjustments, simulatedState) {
  if (!chain || Math.abs(deltaDeg) < 0.001) return;

  for (let i = 0; i < chain.blocks.length; i += 1) {
    const block = chain.blocks[i];
    const edge = chain.edges[i];
    const hinge = refreshedChainHinge(chain, i, simulatedState);
    if (!block || !edge || !hinge) continue;

    const transform = hingeAlignedTransform(block, hinge, deltaDeg);
    if (!transform) continue;

    const adjustment = {
      blockId: block.id,
      position: transform.position,
      rotation: transform.rotation,
    };
    adjustments.push(adjustment);
    simulatedState.set(block.id, {
      position: adjustment.position,
      positionVector: transform.positionVector,
      quaternion: transform.quaternion,
    });
  }
}

function isValidLongTriangleSupportConfiguration(placement, baseBlock, baseChain, partnerChain, adjustments = [], baseline = null) {
  const before = baseline || supportConfigurationMetrics(baseBlock, baseChain, partnerChain);
  const after = supportConfigurationMetrics(baseBlock, baseChain, partnerChain, adjustments);
  if (!before || !after) return { ok: false, reason: 'invalid V opening', penalty: 1 };

  const maxDelta = maxSupportAdjustmentDegrees(adjustments);
  if (maxDelta > 6.25) {
    return { ok: false, reason: 'excessive delta', penalty: maxDelta };
  }

  const chains = ['base', 'partner'];
  for (const key of chains) {
    const beforeChain = before[key];
    const afterChain = after[key];
    if (!beforeChain || !afterChain) return { ok: false, reason: 'invalid V opening', penalty: 1 };

    if (afterChain.topY < beforeChain.topY - 0.015 || afterChain.midY < beforeChain.midY - 0.025) {
      return { ok: false, reason: 'downward tilt', penalty: beforeChain.topY - afterChain.topY };
    }
    if (afterChain.spanY < Math.max(0.35, beforeChain.spanY * 0.88)) {
      return { ok: false, reason: 'support collapse', penalty: beforeChain.spanY - afterChain.spanY };
    }
    if (afterChain.verticality < Math.max(0.28, beforeChain.verticality * 0.78)) {
      return { ok: false, reason: 'support collapse', penalty: 1 - afterChain.verticality };
    }
    if (beforeChain.normal && afterChain.normal && beforeChain.normal.dot(afterChain.normal) < 0.82) {
      return { ok: false, reason: 'support collapse', penalty: 1 };
    }
  }

  if (after.averageTopY < before.averageTopY - 0.005) {
    return { ok: false, reason: 'downward tilt', penalty: before.averageTopY - after.averageTopY };
  }
  if (after.openingAngle < THREE.MathUtils.degToRad(12) || after.openingAngle > THREE.MathUtils.degToRad(148)) {
    return { ok: false, reason: 'invalid V opening', penalty: 1 };
  }

  const contact = oppositeEdgeContactScore(placement, baseBlock, baseChain, partnerChain, adjustments);
  return {
    ok: true,
    reason: 'valid',
    contact,
    metrics: after,
    penalty: supportValidityPenalty({ contact, metrics: after }),
  };
}

function supportConfigurationMetrics(baseBlock, baseChain, partnerChain, adjustments = []) {
  if (!baseChain || !partnerChain) return null;

  const simulatedState = adjustments?.length ? simulateBlockAdjustments(adjustments) : null;
  const baseEdge = virtualEdgeFromChainInState(baseBlock, baseChain, simulatedState);
  const partnerEdge = virtualEdgeFromChainInState(partnerChain.blocks[0], partnerChain, simulatedState);
  if (!baseEdge || !partnerEdge) return null;

  const base = chainSupportMetrics(baseEdge);
  const partner = chainSupportMetrics(partnerEdge);
  const openingAngle = Math.min(
    baseEdge.direction.angleTo(partnerEdge.direction),
    baseEdge.direction.angleTo(partnerEdge.direction.clone().negate())
  );

  return {
    base,
    partner,
    openingAngle,
    averageTopY: (base.topY + partner.topY) / 2,
  };
}

function chainSupportMetrics(edge) {
  const topY = Math.max(edge.p1.y, edge.p2.y);
  const bottomY = Math.min(edge.p1.y, edge.p2.y);
  return {
    topY,
    bottomY,
    midY: (topY + bottomY) / 2,
    spanY: topY - bottomY,
    verticality: Math.abs(edge.direction.y),
    normal: edge.normal?.clone?.() || null,
  };
}

function supportValidityPenalty(validity) {
  if (typeof validity?.penalty === 'number') return validity.penalty;
  if (!validity?.ok) return 1;
  if (typeof validity?.contact === 'number') return Math.max(0, validity.contact - 0.12);
  return 0;
}

function minimalAdjustmentPenalty(adjustments = []) {
  return adjustments.reduce((sum, adjustment) => {
    const block = state.blocks.find((item) => item.id === adjustment.blockId);
    if (!block) return sum;
    const before = quaternionForBlock(block);
    const after = quaternionForBlock({ ...block, rotation: adjustment.rotation });
    const dot = Math.abs(THREE.MathUtils.clamp(before.dot(after), -1, 1));
    return sum + THREE.MathUtils.radToDeg(2 * Math.acos(dot));
  }, 0);
}

function maxSupportAdjustmentDegrees(adjustments = []) {
  return adjustments.reduce((max, adjustment) => {
    const block = state.blocks.find((item) => item.id === adjustment.blockId);
    if (!block) return max;
    const before = quaternionForBlock(block);
    const after = quaternionForBlock({ ...block, rotation: adjustment.rotation });
    const dot = Math.abs(THREE.MathUtils.clamp(before.dot(after), -1, 1));
    return Math.max(max, THREE.MathUtils.radToDeg(2 * Math.acos(dot)));
  }, 0);
}

function longTriangleChainBridgePlacement(type, targetEdge, baseBlock) {
  if (type.id !== 'long-triangle' || !baseBlock) return null;
  if (!state.autoSymmetry) return null;

  const fixture = triangleBridgeFixture(type);
  if (!fixture) return null;

  const expected = fixture.edgeLength;
  const chainTolerance = 0.12;
  const halfTolerance = Math.max(chainTolerance, expected * 0.15);
  const targetIsFull = Math.abs(targetEdge.length - expected) <= chainTolerance;
  const targetIsHalf = Math.abs(targetEdge.length - expected / 2) <= halfTolerance;

  if (!targetIsFull && !targetIsHalf) return null;

  const baseChain = targetIsHalf
    ? collinearEdgeChainFor(baseBlock, targetEdge, expected, { tolerance: chainTolerance })
    : null;
  if (targetIsHalf && !baseChain) return null;

  const excludedIds = baseChain?.blocks.map((b) => b.id) || [baseBlock.id];
  let best = null;

  state.blocks.forEach((block) => {
    if (excludedIds.includes(block.id)) return;
    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      if (targetEdge.mid.distanceTo(edge.mid) > expected * 3) return;

      const partnerIsFull = Math.abs(edge.length - expected) <= chainTolerance;
      const partnerIsHalf = Math.abs(edge.length - expected / 2) <= halfTolerance;
      if (!partnerIsFull && !partnerIsHalf) return;

      const partnerChain = partnerIsHalf
        ? collinearEdgeChainFor(block, edge, expected, {
          tolerance: chainTolerance,
          excludeBlockIds: excludedIds,
          seedSupportBlockId: baseBlock.id,
        })
        : null;
      if (partnerIsHalf && !partnerChain) return;
      if (partnerChain && !partnerChain.blocks.some((pb) => pb.id === block.id)) return;
      if (!baseChain && !partnerChain) return;

      const virtualBase = baseChain ? chainToVirtualEdge(baseChain, targetEdge) : targetEdge;
      const virtualPartner = partnerChain ? chainToVirtualEdge(partnerChain, edge) : edge;

      const placement = trianglePlacementForEdgePair(fixture, virtualBase, virtualPartner);
      const scoredPlacement = scoreLongTriangleBridgePlacement(type, placement, virtualBase, baseBlock);
      if (!scoredPlacement) return;

      if (!best || scoredPlacement.score < best.score) {
        best = {
          placement: scoredPlacement,
          score: scoredPlacement.score,
          baseChain,
          partnerChain,
          partnerBlock: block,
          partnerEdge: edge,
        };
      }
    });
  });

  if (!best) return null;

  return finalizeLongTriangleChainPlacement({
    type,
    fixture,
    provisionalPlacement: best.placement,
    baseBlock,
    baseChain: best.baseChain,
    baseEdge: targetEdge,
    partnerBlock: best.partnerBlock,
    partnerChain: best.partnerChain,
    partnerEdge: best.partnerEdge,
    attachmentEdgeId: 'edge-1',
    message: `${targetEdge.label} arasına büyük üçgen uzun kenarlarıyla oturdu`,
  });
}

function finalizeLongTriangleChainPlacement({
  type,
  fixture,
  provisionalPlacement,
  baseBlock,
  baseChain,
  baseEdge,
  partnerBlock,
  partnerChain,
  partnerEdge,
  attachmentEdgeId = 'edge-1',
  message,
}) {
  if (type.id !== 'long-triangle' || !provisionalPlacement) return null;
  if (!baseChain && !partnerChain) return null;

  const planarityAdjustments = enforceLongTrianglePlanarity(
    provisionalPlacement,
    baseBlock,
    baseChain,
    partnerChain
  );
  const simulatedState = simulateBlockAdjustments(planarityAdjustments);
  const reseatedTarget = virtualEdgeFromChainInState(baseBlock, baseChain, simulatedState, baseEdge);
  const partnerSeed = partnerChain?.blocks?.[0] || partnerBlock;
  const reseatedPartner = virtualEdgeFromChainInState(partnerSeed, partnerChain, simulatedState, partnerEdge);
  const reseatedPlacement = reseatedTarget && reseatedPartner
    ? scoreLongTriangleBridgePlacement(
      type,
      trianglePlacementForEdgePair(fixture, reseatedTarget, reseatedPartner),
      reseatedTarget,
      baseBlock
    )
    : null;
  const finalPlacement = reseatedPlacement
    && reseatedPlacement.score <= (provisionalPlacement.score ?? 0) + 0.25
    ? reseatedPlacement
    : provisionalPlacement;
  const finalAdjustments = enforceLongTrianglePlanarity(
    finalPlacement,
    baseBlock,
    baseChain,
    partnerChain
  );
  const contact = longTriangleFullContactCheck(
    finalPlacement,
    baseBlock,
    baseChain,
    partnerChain,
    finalAdjustments
  );

  if (!contact.ok) {
    return {
      rejected: true,
      message: 'Uzun üçgen tam temas sağlayamadı — kare konumlarını elle ayarlayın',
    };
  }

  const partnerBlockIds = new Set();
  baseChain?.blocks.slice(1).forEach((block) => partnerBlockIds.add(block.id));
  partnerChain?.blocks.forEach((block) => partnerBlockIds.add(block.id));

  return {
    ...finalPlacement,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: baseEdge.id,
      blockEdgeId: attachmentEdgeId,
    },
    adjustments: finalAdjustments,
    partnerBlockIds: Array.from(partnerBlockIds),
    message: message || `${baseEdge.label} arasına büyük üçgen uzun kenarlarıyla oturdu`,
  };
}

function enforceLongTrianglePlanarity(trianglePlacement, baseBlock, baseChain, partnerChain) {
  if (!trianglePlacement || (!baseChain && !partnerChain)) return [];

  const targets = longTriangleChainTargetAssignments(trianglePlacement, baseChain, partnerChain);
  const adjustments = [];
  const simulatedState = simulateBlockAdjustments(adjustments);

  const alignChain = (chain, targetLine) => {
    if (!chain || !targetLine) return;

    for (let i = 0; i < chain.blocks.length; i += 1) {
      const block = chain.blocks[i];
      const edge = chain.edges[i];
      const hinge = refreshedChainHinge(chain, i, simulatedState);
      if (!block || !edge || !hinge) continue;

      let best = null;
      const scoreTransform = (transform) => {
        const movedEdge = edgeAnchorForTransform(block, edge.id, transform.positionVector, transform.quaternion);
        if (!movedEdge) return null;

        const mid = movedEdge.p1.clone().add(movedEdge.p2).multiplyScalar(0.5);
        const gap = Math.max(
          pointOnSegmentFit(movedEdge.p1, targetLine.p1, targetLine.p2).distance,
          pointOnSegmentFit(movedEdge.p2, targetLine.p1, targetLine.p2).distance,
          pointOnSegmentFit(mid, targetLine.p1, targetLine.p2).distance
        );
        const directionError = 1 - Math.abs(movedEdge.direction.dot(targetLine.direction));
        const normalError = Math.abs(1 + movedEdge.normal.dot(targetLine.normal));
        return gap * 34 + directionError * 10 + normalError * 8 + (hinge.score || 0) * 0.15;
      };

      for (let rawAngle = -120; rawAngle <= 120; rawAngle += 15) {
        const angle = snapAngle(rawAngle, 15);
        const transform = hingeAlignedTransform(block, hinge, angle);
        if (!transform) continue;

        const score = scoreTransform(transform);
        if (score === null) continue;
        if (!best || score < best.score) {
          best = { score, transform };
        }
      }

      if (!best) continue;

      const adjustment = {
        blockId: block.id,
        position: best.transform.position,
        rotation: best.transform.rotation,
      };
      adjustments.push(adjustment);
      simulatedState.set(block.id, {
        position: adjustment.position,
        positionVector: best.transform.positionVector,
        quaternion: best.transform.quaternion,
      });
    }
  };

  alignChain(baseChain, targets.base);
  alignChain(partnerChain, targets.partner);

  return adjustments;
}

function refreshedChainHinge(chain, index, simulatedState) {
  const block = chain?.blocks?.[index];
  const edge = chain?.edges?.[index];
  if (!block || !edge) return null;

  const baseHinge = chain.hinges?.[index]
    || supportedHingeForBlock(block, edge.id, null);
  if (!baseHinge) return null;

  const supportBlockId = baseHinge.supportBlockId || (index > 0 ? chain.blocks[index - 1]?.id : null);
  if (!baseHinge.supportEdge || !supportBlockId) return baseHinge;

  const supportBlock = state.blocks.find((item) => item.id === supportBlockId);
  const supportTransform = supportBlock ? simulatedState.get(supportBlock.id) : null;
  if (!supportBlock || !supportTransform) return baseHinge;

  const supportEdge = edgeAnchorForTransform(
    supportBlock,
    baseHinge.supportEdge.id,
    supportTransform.positionVector,
    supportTransform.quaternion
  );
  return supportEdge ? { ...baseHinge, supportEdge, supportBlockId } : baseHinge;
}

function longTriangleWorldSideEdges(trianglePlacement) {
  const type = blockType('long-triangle');
  const fixture = triangleBridgeFixture(type);
  if (!fixture || !trianglePlacement?.position || !trianglePlacement?.rotation) return [];

  const triangleBlock = {
    typeId: type.id,
    orientation: trianglePlacement.orientation || 'front',
    rotation: trianglePlacement.rotation,
  };
  const quaternion = quaternionForBlock(triangleBlock);
  const position = new THREE.Vector3(
    trianglePlacement.position.x,
    trianglePlacement.position.y,
    trianglePlacement.position.z
  );
  const point = (localPoint) => localPoint.clone().applyQuaternion(quaternion).add(position);
  const makeEdge = (id, endPoint, normal) => {
    const p1 = point(fixture.apex);
    const p2 = point(endPoint);
    const direction = p2.clone().sub(p1).normalize();
    return {
      id,
      p1,
      p2,
      mid: p1.clone().add(p2).multiplyScalar(0.5),
      direction,
      normal: normal.clone().applyQuaternion(quaternion).normalize(),
      length: p1.distanceTo(p2),
    };
  };

  return [
    makeEdge('edge-1', fixture.rightPoint, fixture.rightNormal),
    makeEdge('edge-2', fixture.leftPoint, fixture.leftNormal),
  ];
}

function longTriangleChainTargetAssignments(trianglePlacement, baseChain, partnerChain, simulatedState = null) {
  const sideEdges = longTriangleWorldSideEdges(trianglePlacement);
  if (sideEdges.length < 2) return { base: null, partner: null };

  const chainDrift = (chain, sideEdge) => {
    const edge = virtualEdgeFromChainInState(chain?.blocks?.[0], chain, simulatedState);
    if (!edge) return Number.POSITIVE_INFINITY;
    return pointOnSegmentFit(edge.p1, sideEdge.p1, sideEdge.p2).distance
      + pointOnSegmentFit(edge.p2, sideEdge.p1, sideEdge.p2).distance;
  };
  const pickForChain = (chain) => sideEdges.reduce((best, sideEdge) => {
    const drift = chainDrift(chain, sideEdge);
    return !best || drift < best.drift ? { edge: sideEdge, drift } : best;
  }, null)?.edge || null;

  if (baseChain && partnerChain) {
    const firstScore = chainDrift(baseChain, sideEdges[0]) + chainDrift(partnerChain, sideEdges[1]);
    const secondScore = chainDrift(baseChain, sideEdges[1]) + chainDrift(partnerChain, sideEdges[0]);
    return firstScore <= secondScore
      ? { base: sideEdges[0], partner: sideEdges[1] }
      : { base: sideEdges[1], partner: sideEdges[0] };
  }

  return {
    base: baseChain ? pickForChain(baseChain) : null,
    partner: partnerChain ? pickForChain(partnerChain) : null,
  };
}

function simulateBlockAdjustments(adjustments = []) {
  const simulatedState = new Map();

  state.blocks.forEach((block) => {
    const transform = currentBlockTransform(block);
    simulatedState.set(block.id, {
      position: transform.position,
      positionVector: transform.positionVector,
      quaternion: transform.quaternion,
    });
  });

  adjustments.forEach((adjustment) => {
    const block = state.blocks.find((item) => item.id === adjustment.blockId);
    if (!block) return;

    const positionVector = new THREE.Vector3(
      adjustment.position.x,
      adjustment.position.y,
      adjustment.position.z
    );
    simulatedState.set(block.id, {
      position: adjustment.position,
      positionVector,
      quaternion: quaternionForBlock({ ...block, rotation: adjustment.rotation }),
    });
  });

  return simulatedState;
}

function virtualEdgeFromChainInState(seedBlock, chain, simulatedState = null, fallbackEdge = null) {
  if (!chain) {
    if (!seedBlock || !fallbackEdge) return fallbackEdge || null;
    const stateEdge = edgeFromBlockInState(seedBlock, fallbackEdge.id, simulatedState);
    return stateEdge || fallbackEdge;
  }

  const segments = transformedChainEdges(chain, simulatedState);
  if (!segments.length) return null;

  const endpoints = segments.flatMap((segment) => [segment.edge.p1, segment.edge.p2]);
  let p1 = endpoints[0];
  let p2 = endpoints[1] || endpoints[0];
  let bestDistance = -1;
  endpoints.forEach((first) => {
    endpoints.forEach((second) => {
      const distance = first.distanceTo(second);
      if (distance > bestDistance) {
        bestDistance = distance;
        p1 = first;
        p2 = second;
      }
    });
  });

  const normal = segments.reduce(
    (sum, segment) => sum.add(segment.edge.normal),
    new THREE.Vector3()
  ).normalize();
  const direction = p2.clone().sub(p1).normalize();

  return {
    id: 'virtual:' + chain.edges.map((edge) => edge.id).join('+'),
    label: chain.edges[0]?.label || fallbackEdge?.label || 'uzun kenar',
    p1: p1.clone(),
    p2: p2.clone(),
    mid: p1.clone().add(p2).multiplyScalar(0.5),
    direction,
    normal: normal.lengthSq() > 0.001 ? normal : segments[0].edge.normal.clone(),
    length: segments.reduce((sum, segment) => sum + segment.edge.length, 0),
  };
}

function edgeFromBlockInState(block, edgeId, simulatedState = null) {
  if (!block || !edgeId) return null;
  const transform = simulatedState?.get(block.id) || currentBlockTransform(block);
  return edgeAnchorForTransform(block, edgeId, transform.positionVector, transform.quaternion);
}

function transformedChainEdges(chain, simulatedState = null) {
  if (!chain) return [];

  return chain.blocks.map((block, index) => {
    const edge = chain.edges[index];
    const movedEdge = edgeFromBlockInState(block, edge.id, simulatedState);
    return movedEdge ? { block, edge: movedEdge } : null;
  }).filter(Boolean);
}

function longTriangleFullContactCheck(trianglePlacement, baseBlock, baseChain, partnerChain, adjustments = []) {
  const simulatedState = simulateBlockAdjustments(adjustments);
  const targets = longTriangleChainTargetAssignments(
    trianglePlacement,
    baseChain,
    partnerChain,
    simulatedState
  );
  let maxGap = 0;
  let failingBlockId = null;

  const checkChain = (chain, targetLine) => {
    if (!chain || !targetLine) return true;

    return transformedChainEdges(chain, simulatedState).every(({ block, edge }) => {
      const mid = edge.p1.clone().add(edge.p2).multiplyScalar(0.5);
      const gap = Math.max(
        pointOnSegmentFit(edge.p1, targetLine.p1, targetLine.p2).distance,
        pointOnSegmentFit(edge.p2, targetLine.p1, targetLine.p2).distance,
        pointOnSegmentFit(mid, targetLine.p1, targetLine.p2).distance
      );
      maxGap = Math.max(maxGap, gap);

      if (gap > 0.05) {
        failingBlockId = block.id;
        return false;
      }

      return true;
    });
  };

  const ok = checkChain(baseChain, targets.base) && checkChain(partnerChain, targets.partner);
  return { ok, maxGap, failingBlockId };
}

function longTriangleApexDownBridgePlacement(type, orientation, targetEdge, baseBlock) {
  if (type.id !== 'long-triangle' || !baseBlock) return null;

  const effectiveOrientation = orientation === 'floor'
    ? (verticalOrientationForEdge(targetEdge) || 'front')
    : (orientation === 'custom' ? baseBlock.orientation : orientation);
  const fixture = triangleBridgeFixture(type);
  if (!fixture) return null;

  const chainTolerance = 0.12;
  const halfTolerance = Math.max(chainTolerance, fixture.edgeLength * 0.15);
  const targetIsHalf = Math.abs(targetEdge.length - fixture.edgeLength / 2) <= halfTolerance;
  const baseChain = state.autoSymmetry && targetIsHalf
    ? collinearEdgeChainFor(baseBlock, targetEdge, fixture.edgeLength, { tolerance: chainTolerance })
    : null;
  if (state.autoSymmetry && targetIsHalf && !baseChain) return null;

  const candidates = [];
  const sideMappings = [
    { edgeId: 'edge-1', sidePoint: fixture.rightPoint, otherPoint: fixture.leftPoint },
    { edgeId: 'edge-2', sidePoint: fixture.leftPoint, otherPoint: fixture.rightPoint },
  ];
  const targetEndpoints = [
    { apex: targetEdge.p1, sideDirection: targetEdge.p2.clone().sub(targetEdge.p1), endpointKey: 'p1' },
    { apex: targetEdge.p2, sideDirection: targetEdge.p1.clone().sub(targetEdge.p2), endpointKey: 'p2' },
  ].sort((a, b) => a.apex.y - b.apex.y);
  sideMappings.forEach((mapping) => {
    targetEndpoints.forEach((target) => {
      if (target.sideDirection.lengthSq() < 0.001) return;

      const partnerVectors = longTrianglePartnerVectors(target.apex, baseBlock.id, fixture.edgeLength);
      const rawQuaternions = partnerVectors.map((partner) => {
        const idealPartnerVector = longTriangleIdealPartnerVector(
          target.sideDirection,
          partner.vector,
          fixture.edgeLength,
          fixture.apexAngle
        );
        return {
          quaternion: idealPartnerVector ? quaternionFromEdgePair(
            mapping.sidePoint.clone().sub(fixture.apex),
            mapping.otherPoint.clone().sub(fixture.apex),
            target.sideDirection,
            idealPartnerVector
          ) : null,
          partnerScore: partner.score,
          partner,
        };
      });

      rawQuaternions.forEach(({ quaternion, partnerScore, partner }) => {
        if (!quaternion) return;

        const positionVector = target.apex.clone().sub(fixture.apex.clone().applyQuaternion(quaternion));
        const transformedSidePoint = mapping.sidePoint.clone().applyQuaternion(quaternion).add(positionVector);
        const transformedOtherPoint = mapping.otherPoint.clone().applyQuaternion(quaternion).add(positionVector);
        const sideEnd = target.apex.clone()
          .add(target.sideDirection.clone().normalize().multiplyScalar(fixture.edgeLength));
        const seatedError = transformedSidePoint.distanceTo(sideEnd);
        const partnerAdjustment = longTrianglePartnerAdjustment(partner, target.apex, transformedOtherPoint, baseBlock.id);
        const inwardScore = longTriangleInwardScore({ positionVector }, transformedOtherPoint, targetEdge, baseBlock);
        const apexDirectionScore = longTriangleApexDownScore(target.apex, transformedSidePoint, transformedOtherPoint);
        const lowerApexBonus = target.endpointKey === targetEndpoints[0].endpointKey ? -8 : 0;
        const supportScore = partnerAdjustment?.score ?? partnerScore;
        const score = seatedError * 24 + supportScore + inwardScore + apexDirectionScore + lowerApexBonus;

        if (!partnerAdjustment || seatedError > 0.18 || supportScore > 38 || inwardScore >= 100 || apexDirectionScore >= 100) return;

        const rotation = rotationForBlockQuaternion({ typeId: type.id, orientation: effectiveOrientation }, quaternion);
        const partnerBlock = state.blocks.find((block) => block.id === partner.blockId);
        const partnerEdge = partnerBlock ? edgeAnchorForBlock(partnerBlock, partner.edgeId) : null;
        candidates.push({
          score,
          orientation: effectiveOrientation,
          position: roundVector(positionVector),
          rotation: {
            x: snapAngle(rotation.x, 15),
            y: snapAngle(rotation.y, 15),
            z: snapAngle(rotation.z, 15),
          },
          attachment: {
            mode: 'custom-edge',
            baseBlockId: baseBlock.id,
            baseEdgeId: targetEdge.id,
            blockEdgeId: mapping.edgeId,
          },
          adjustments: partnerAdjustment.adjustments || [partnerAdjustment.adjustment],
          baseChain,
          partnerBlock,
          partnerChain: partner.chain || null,
          partnerEdge,
          message: `${targetEdge.label} arasına büyük üçgen uzun kenarlarıyla oturdu`,
        });
      });
    });
  });

  const best = candidates.sort((a, b) => a.score - b.score)[0] || null;
  if (!best) return null;

  if (state.autoSymmetry && (best.baseChain || best.partnerChain)) {
    return finalizeLongTriangleChainPlacement({
      type,
      fixture,
      provisionalPlacement: best,
      baseBlock,
      baseChain: best.baseChain,
      baseEdge: targetEdge,
      partnerBlock: best.partnerBlock,
      partnerChain: best.partnerChain,
      partnerEdge: best.partnerEdge,
      attachmentEdgeId: best.attachment.blockEdgeId,
      message: best.message,
    });
  }

  return best;
}

function longTriangleApexDownScore(apex, firstPoint, secondPoint) {
  const baseMid = firstPoint.clone().add(secondPoint).multiplyScalar(0.5);
  const up = baseMid.y - apex.y;
  return up > 0.25 ? -up * 16 : 120 + Math.abs(up) * 30;
}

function longTriangleIdealPartnerVector(sideDirection, partnerVector, expectedLength, apexAngle) {
  if (sideDirection.lengthSq() < 0.001 || partnerVector.lengthSq() < 0.001) return null;

  const side = sideDirection.clone().normalize();
  const partner = partnerVector.clone().normalize();
  const normal = side.clone().cross(partner);
  if (normal.lengthSq() < 0.001) return null;
  normal.normalize();

  const candidates = [
    side.clone().applyAxisAngle(normal, apexAngle).multiplyScalar(expectedLength),
    side.clone().applyAxisAngle(normal, -apexAngle).multiplyScalar(expectedLength),
    side.clone().applyAxisAngle(normal.clone().negate(), apexAngle).multiplyScalar(expectedLength),
    side.clone().applyAxisAngle(normal.clone().negate(), -apexAngle).multiplyScalar(expectedLength),
  ].filter((vector, index, list) => (
    vector.y > 0.15
    && list.findIndex((item) => item.distanceTo(vector) < 0.02) === index
  ));

  return candidates
    .sort((a, b) => b.clone().normalize().dot(partner) - a.clone().normalize().dot(partner))[0] || null;
}

function longTrianglePartnerAdjustment(partner, apex, otherPoint, baseBlockId) {
  if (!partner?.blockId || !partner.edgeId) return null;

  const blockIds = partner.blockIds && partner.blockIds.length
    ? partner.blockIds
    : [partner.blockId];
  const edgeIds = partner.edgeIds && partner.edgeIds.length
    ? partner.edgeIds
    : [partner.edgeId];

  const targetEdge = {
    p1: apex,
    p2: otherPoint,
    direction: otherPoint.clone().sub(apex).normalize(),
  };
  const driftCap = blockIds.length > 1 ? 0.65 : 0.35;

  const adjustments = [];
  let totalScore = 0;

  for (let i = 0; i < blockIds.length; i += 1) {
    const blockId = blockIds[i];
    const edgeId = edgeIds[i] || partner.edgeId;
    const partnerBlock = state.blocks.find((block) => block.id === blockId);
    if (!partnerBlock || partnerBlock.id === baseBlockId) return null;

    const hinge = supportedHingeForBlock(partnerBlock, edgeId, baseBlockId);
    let best = null;

    if (hinge) {
      for (let angle = -120; angle <= 120; angle += 1) {
        const transform = hingeAlignedTransform(partnerBlock, hinge, angle);
        if (!transform) continue;

        const movedEdge = edgeAnchorForTransform(
          partnerBlock,
          edgeId,
          transform.positionVector,
          transform.quaternion
        );
        if (!movedEdge) continue;

        const drift = pointOnSegmentFit(movedEdge.p1, targetEdge.p1, targetEdge.p2).distance
          + pointOnSegmentFit(movedEdge.p2, targetEdge.p1, targetEdge.p2).distance;
        const directionError = 1 - Math.abs(movedEdge.direction.dot(targetEdge.direction));
        const score = drift * 22 + directionError * 14 + hinge.score * 0.5;
        if (drift > driftCap || directionError > 0.18) continue;

        if (!best || score < best.score) {
          best = {
            score,
            adjustment: {
              blockId: partnerBlock.id,
              position: transform.position,
              rotation: transform.rotation,
            },
          };
        }
      }
    }

    if (!best) {
      const aligned = alignTransformEdgeToTarget(partnerBlock, edgeId, currentBlockTransform(partnerBlock), targetEdge);
      if (!aligned) return null;
      best = {
        score: 18,
        adjustment: {
          blockId: partnerBlock.id,
          position: aligned.position,
          rotation: aligned.rotation,
        },
      };
    }

    adjustments.push(best.adjustment);
    totalScore += best.score;
  }

  return {
    score: totalScore / adjustments.length,
    adjustment: adjustments[0],
    adjustments,
  };
}

function longTrianglePartnerVectors(apex, baseBlockId, expectedLength) {
  const candidates = [];
  const halfTolerance = Math.max(0.12, expectedLength * 0.15);

  state.blocks.forEach((block) => {
    if (block.id === baseBlockId) return;

    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      const apexFit = pointOnSegmentFit(apex, edge.p1, edge.p2);
      if (apexFit.distance <= 0.72 && apexFit.raw >= -0.25 && apexFit.raw <= 1.25) {
        [edge.direction, edge.direction.clone().negate()].forEach((direction) => {
          const vector = direction.clone().multiplyScalar(expectedLength);
          if (vector.y < 0.2) return;

          const endpoint = apex.clone().add(vector);
          const endpointFit = pointOnSegmentFit(endpoint, edge.p1, edge.p2);
          if (endpointFit.distance > 0.72 || endpointFit.raw < -0.25 || endpointFit.raw > 1.25) return;

          candidates.push({
            vector,
            blockId: block.id,
            edgeId: edge.id,
            score: apexFit.distance * 20 + endpointFit.distance * 16,
          });
        });
      }

      const endpointPairs = [
        { near: edge.p1, far: edge.p2 },
        { near: edge.p2, far: edge.p1 },
      ];

      endpointPairs.forEach(({ near, far }) => {
        const endpointGap = near.distanceTo(apex);
        if (endpointGap > 0.72) return;

        const vector = far.clone().sub(apex);
        const lengthGap = Math.abs(vector.length() - expectedLength);
        if (lengthGap > 0.65 || vector.y < 0.2) return;

        candidates.push({
          vector,
          blockId: block.id,
          edgeId: edge.id,
          score: endpointGap * 18 + lengthGap * 10,
        });
      });

      if (Math.abs(edge.length - expectedLength / 2) <= halfTolerance) {
        const chain = collinearEdgeChainFor(block, edge, expectedLength, {
          tolerance: 0.12,
          excludeBlockIds: [baseBlockId],
          seedSupportBlockId: baseBlockId,
        });
        if (chain && chain.blocks.length >= 2) {
          const apexToP1 = apex.distanceTo(chain.p1);
          const apexToP2 = apex.distanceTo(chain.p2);
          const nearGap = Math.min(apexToP1, apexToP2);
          if (nearGap <= 0.72) {
            const far = apexToP1 <= apexToP2 ? chain.p2 : chain.p1;
            const vector = far.clone().sub(apex);
            if (vector.y >= 0.2) {
              const lengthGap = Math.abs(vector.length() - expectedLength);
              if (lengthGap <= 0.65) {
                candidates.push({
                  vector,
                  blockId: chain.blocks[0].id,
                  edgeId: chain.edges[0].id,
                  blockIds: chain.blocks.map((b) => b.id),
                  edgeIds: chain.edges.map((e) => e.id),
                  chain,
                  score: nearGap * 16 + lengthGap * 8,
                });
              }
            }
          }
        }
      }
    });
  });

  return candidates.sort((a, b) => a.score - b.score).slice(0, 6);
}

function quaternionFromSideAndFaceNormal(localSideVector, worldSideVector, worldFaceNormal) {
  const localEdge = localSideVector.clone().normalize();
  const worldEdge = worldSideVector.clone().normalize();
  const localFace = new THREE.Vector3(0, 0, 1);
  const worldFace = projectedFaceNormal(worldFaceNormal, worldEdge);
  if (!worldFace) return null;

  const localSide = localFace.clone().cross(localEdge).normalize();
  const worldSide = worldFace.clone().cross(worldEdge).normalize();
  if (localSide.lengthSq() < 0.001 || worldSide.lengthSq() < 0.001) return null;

  const localBasis = new THREE.Matrix4().makeBasis(localEdge, localSide, localFace);
  const worldBasis = new THREE.Matrix4().makeBasis(worldEdge, worldSide, worldFace);
  return new THREE.Quaternion().setFromRotationMatrix(worldBasis.clone().multiply(localBasis.clone().invert()));
}

function longTriangleOtherSideSupportScore(apex, otherPoint, baseBlockId) {
  const sideDirection = otherPoint.clone().sub(apex);
  if (sideDirection.lengthSq() < 0.001) return { score: Number.POSITIVE_INFINITY };

  const direction = sideDirection.clone().normalize();
  let best = Number.POSITIVE_INFINITY;

  state.blocks.forEach((block) => {
    if (block.id === baseBlockId) return;

    const object = blockObjects.get(block.id);
    if (!object) return;

    blockEdgeAnchors(block, object).forEach((edge) => {
      const directionError = 1 - Math.abs(edge.direction.dot(direction));
      if (directionError > 0.2) return;

      const p1Fit = pointOnSegmentFit(edge.p1, apex, otherPoint);
      const p2Fit = pointOnSegmentFit(edge.p2, apex, otherPoint);
      const lineScore = p1Fit.distance + p2Fit.distance;
      const spanScore = Math.max(0, 0.08 - Math.abs(p1Fit.raw - p2Fit.raw)) * 8;
      const score = directionError * 18 + lineScore * 12 + spanScore;

      if (score < best) {
        best = score;
      }
    });
  });

  return { score: best };
}

function longTriangleBottomDownPlacement(type, orientation, targetEdge, baseBlock) {
  if (type.id !== 'long-triangle' || !baseBlock) return null;

  const effectiveOrientation = orientation === 'floor'
    ? (verticalOrientationForEdge(targetEdge) || 'front')
    : (orientation === 'custom' ? baseBlock.orientation : orientation);
  const bottomEdge = shapeEdgesForType(type)
    .filter((edge) => edge.normal.y < -0.45)
    .sort((a, b) => b.length - a.length)[0];
  if (!bottomEdge) return null;

  const block = { typeId: type.id, orientation: effectiveOrientation };
  const faceNormal = faceNormalForQuaternion(orientationQuaternion(effectiveOrientation));
  const normals = [
    faceNormal,
    faceNormal.clone().negate(),
  ];
  let best = null;

  normals.forEach((normal) => {
    [-1, 1].forEach((directionSign) => {
      const transform = attachmentTransformForEdgeCandidate(
        block,
        bottomEdge,
        targetEdge,
        normal,
        directionSign
      );
      if (!transform) return;

      const movedBottom = edgeAnchorForTransform(block, bottomEdge.id, transform.positionVector, transform.quaternion);
      if (!movedBottom) return;

      const apex = localPanelPoint(new THREE.Vector2(0, type.height / 2))
        .applyQuaternion(transform.quaternion)
        .add(transform.positionVector);
      const upwardPenalty = apex.y <= movedBottom.mid.y ? 100 : 0;
      const directionError = 1 - Math.abs(movedBottom.direction.dot(targetEdge.direction));
      const midpointGap = movedBottom.mid.distanceTo(targetEdge.mid);
      const inwardScore = longTriangleInwardScore(transform, apex, targetEdge, baseBlock);
      const score = upwardPenalty + directionError * 16 + midpointGap * 4 + inwardScore;

      if (!best || score < best.score) {
        best = {
          score,
          transform,
          blockEdgeId: bottomEdge.id,
        };
      }
    });
  });

  if (!best || best.score >= 100) return null;

  return {
    score: best.score,
    orientation: effectiveOrientation,
    position: best.transform.position,
    rotation: {
      x: snapAngle(best.transform.rotation.x, 15),
      y: snapAngle(best.transform.rotation.y, 15),
      z: snapAngle(best.transform.rotation.z, 15),
    },
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: best.blockEdgeId,
    },
    message: `${targetEdge.label} üzerine büyük üçgen alt kenarıyla oturdu`,
  };
}

function longTriangleInwardScore(transform, apex, targetEdge, baseBlock) {
  const otherBlocks = state.blocks.filter((block) => block.id !== baseBlock.id);
  if (!otherBlocks.length) return 0;

  const centroid = otherBlocks.reduce((sum, block) => {
    sum.x += block.position.x;
    sum.y += block.position.y;
    sum.z += block.position.z;
    return sum;
  }, new THREE.Vector3()).multiplyScalar(1 / otherBlocks.length);
  const candidateCenter = transform.positionVector.clone().add(apex).multiplyScalar(0.5);
  const targetToCentroid = centroid.sub(targetEdge.mid);
  const targetToCandidate = candidateCenter.clone().sub(targetEdge.mid);

  if (targetToCentroid.lengthSq() < 0.001 || targetToCandidate.lengthSq() < 0.001) return 0;

  const sameSide = targetToCentroid.normalize().dot(targetToCandidate.normalize());
  return sameSide > 0 ? -sameSide * 80 : Math.abs(sameSide) * 120;
}

function closestLengthEdge(type, targetEdge) {
  return shapeEdgesForType(type).reduce((best, edge) => {
    const oversizedPenalty = edge.length > targetEdge.length + 0.15 ? 100 : 0;
    const diff = Math.abs(edge.length - targetEdge.length) + oversizedPenalty;
    if (!best || diff < best.diff) return { edge, diff };
    return best;
  }, null);
}

function edgeCanAttachToTarget(edge, targetEdge) {
  if (edge.length > targetEdge.length + 0.15) return false;
  return Math.abs(edge.length - targetEdge.length) <= 0.15 || edge.length < targetEdge.length;
}

function halfThicknessForOrientation(type, orientation, targetEdge) {
  if (orientation === 'floor') return blockDepth(type) / 2;
  if (targetEdge.normal.y > 0.7) return type.height / 2;
  return type.width / 2;
}

function edgeAttachmentFor(type, orientation, targetEdge, baseBlock = null, baseObject = null) {
  const uprightPlacement = uprightAttachmentFor(type, orientation, targetEdge, baseObject);
  const baseFaceNormal = baseBlock
    ? faceNormalForQuaternion(quaternionForBlock(baseBlock))
    : null;
  const preferredNormals = baseFaceNormal && orientation !== 'floor'
    ? [{ normal: baseFaceNormal, weight: 1.35 }]
    : [];
  const rigidPlacement = bestEdgeAttachmentPlacement({
    type,
    orientation,
    targetEdge,
    baseBlock,
    preferredNormals,
    useSecondaryEdges: false,
  });
  const hingedPlacement = bestEdgeAttachmentPlacement({
    type,
    orientation,
    targetEdge,
    baseBlock,
    preferredNormals,
  });

  if (rigidPlacement) {
    if (!hingedPlacement || hingedPlacement.contactCount < 1) {
      return rigidPlacement;
    }

    if (rigidPlacement.score <= hingedPlacement.score + 0.9) {
      return rigidPlacement;
    }
  }

  if (uprightPlacement) {
    if (!hingedPlacement || hingedPlacement.contactCount < 1) {
      return uprightPlacement;
    }

    const uprightScore = 3.6 + uprightPlacement.score * 6.2;
    if (uprightScore <= hingedPlacement.score + 0.45) {
      return uprightPlacement;
    }
  }

  if (!hingedPlacement || !baseBlock || hingedPlacement.contactCount < 1) {
    return uprightPlacement || hingedPlacement;
  }

  return {
    score: hingedPlacement.score,
    orientation: hingedPlacement.orientation,
    position: hingedPlacement.position,
    rotation: hingedPlacement.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: hingedPlacement.blockEdgeId,
    },
    message: hingedPlacement.contactCount > 0
      ? `${targetEdge.label} çevredeki kenarlara göre kilitlendi`
      : `${targetEdge.label} bloğa yapıştı`,
  };
}

function directPlacementModeAttachment(type, orientation, targetEdge, baseBlock) {
  if (state.placementMode !== 'horizontal' && state.placementMode !== 'vertical') return null;

  const desiredNormals = placementModeFaceNormals(targetEdge, baseBlock);
  if (!desiredNormals.length) return null;

  const block = { typeId: type.id, orientation };
  let best = null;

  shapeEdgesForType(type).forEach((edge) => {
    const lengthGap = Math.abs(edge.length - targetEdge.length);
    if (!edgeCanAttachToTarget(edge, targetEdge)) return;

    desiredNormals.forEach((normalEntry) => {
      [-1, 1].forEach((directionSign) => {
        const transform = attachmentTransformForEdgeCandidate(
          block,
          edge,
          targetEdge,
          normalEntry.normal,
          directionSign
        );
        if (!transform) return;

        const attachedEdge = edgeAnchorForTransform(block, edge.id, transform.positionVector, transform.quaternion);
        if (!attachedEdge) return;

        const faceNormal = faceNormalForQuaternion(transform.quaternion);
        const faceError = 1 - Math.abs(faceNormal.dot(normalEntry.normal));
        const drift = edgeLineDriftScore(attachedEdge, targetEdge);
        const directionError = 1 - Math.abs(attachedEdge.direction.dot(targetEdge.direction));
        const modeError = state.placementMode === 'horizontal'
          ? Math.abs(1 - Math.abs(faceNormal.y))
          : Math.abs(faceNormal.y);
        const sideScore = placementSideScore(transform, targetEdge, baseBlock);
        const score = drift * 120
          + directionError * 24
          + faceError * normalEntry.weight
          + modeError * 80
          + lengthGap * 4
          + sideScore;

        if (!best || score < best.score) {
          best = {
            score,
            orientation,
            blockEdgeId: edge.id,
            position: transform.position,
            rotation: transform.rotation,
          };
        }
      });
    });
  });

  if (!best) return null;

  return {
    score: best.score,
    orientation: best.orientation,
    position: best.position,
    rotation: best.rotation,
    attachment: {
      mode: 'custom-edge',
      baseBlockId: baseBlock.id,
      baseEdgeId: targetEdge.id,
      blockEdgeId: best.blockEdgeId,
    },
    message: `${targetEdge.label} ${placementModeLabel(state.placementMode).toLowerCase()} modunda yapıştı`,
  };
}

function placementModeFaceNormals(targetEdge, baseBlock) {
  if (state.placementMode === 'horizontal') {
    return [
      { normal: new THREE.Vector3(0, 1, 0), weight: 1 },
      { normal: new THREE.Vector3(0, -1, 0), weight: 1.35 },
    ];
  }

  const candidates = [];
  const baseNormal = baseBlock ? faceNormalForQuaternion(quaternionForBlock(baseBlock)) : null;
  const targetNormal = targetEdge.normal?.clone();
  const cameraNormal = new THREE.Vector3();
  camera.getWorldDirection(cameraNormal).multiplyScalar(-1);

  [baseNormal, targetNormal, cameraNormal].forEach((normal, index) => {
    const projected = normal?.clone().projectOnPlane(new THREE.Vector3(0, 1, 0));
    if (!projected || projected.lengthSq() < 0.001) return;
    projected.normalize();
    pushFaceNormalCandidate(candidates, projected, index === 0 ? 1 : 1.4 + index * 0.2);
    pushFaceNormalCandidate(candidates, projected.clone().negate(), index === 0 ? 1.25 : 1.65 + index * 0.2);
  });

  return candidates;
}

function placementSideScore(transform, targetEdge, baseBlock) {
  if (!baseBlock) return 0;

  const fromBase = transform.positionVector.clone()
    .sub(new THREE.Vector3(baseBlock.position.x, baseBlock.position.y, baseBlock.position.z));
  const fromEdge = transform.positionVector.clone().sub(targetEdge.mid);
  const outward = targetEdge.normal?.clone() || new THREE.Vector3();
  let edgeSide = 0;

  if (outward.lengthSq() > 0.001) {
    const outwardDistance = fromEdge.dot(outward.normalize());
    edgeSide = outwardDistance >= 0
      ? -outwardDistance * 12
      : Math.abs(outwardDistance) * 180;
  }

  return edgeSide - Math.max(0, fromBase.length() - 0.8) * 0.08;
}

function uprightAttachmentFor(type, requestedOrientation, targetEdge, baseObject = null) {
  const orientation = uprightOrientationForEdge(requestedOrientation, targetEdge);
  if (!orientation) return null;

  const bottomEdge = shapeEdgesForType(type)
    .filter((edge) => edge.normal.y < -0.45)
    .sort((a, b) => b.length - a.length)[0];

  if (!bottomEdge) return null;

  const orientationQuat = orientationQuaternion(orientation);
  const baseDir = localPanelPoint(bottomEdge.direction).applyQuaternion(orientationQuat).normalize();
  const baseBlockUp = baseObject
    ? new THREE.Vector3(0, 1, 0).applyQuaternion(baseObject.getWorldQuaternion(new THREE.Quaternion())).normalize()
    : new THREE.Vector3(0, 1, 0);
  const candidates = [targetEdge.direction, targetEdge.direction.clone().negate()].map((direction) => {
    const angle = signedAngleOnAxis(baseDir, direction, baseBlockUp);
    const rotationQuat = orientationQuat.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(baseBlockUp, angle)
    );
    const movedMid = localPanelPoint(bottomEdge.mid).applyQuaternion(rotationQuat);
    const movedNormal = localPanelPoint(bottomEdge.normal).applyQuaternion(rotationQuat).normalize();
    const targetMid = targetEdge.mid.clone();
    targetMid.y += blockDepth(type) / 2;

    return {
      score: Math.abs(movedNormal.y + 1),
      orientation,
      position: roundVector(targetMid.sub(movedMid)),
      rotation: { x: 0, y: 0, z: normalizeDegrees(THREE.MathUtils.radToDeg(angle)) },
    };
  });

  return candidates.sort((a, b) => a.score - b.score)[0];
}

function uprightOrientationForEdge(requestedOrientation, targetEdge) {
  const horizontalTarget = Math.abs(targetEdge.direction.y) < 0.2 && Math.abs(targetEdge.normal.y) < 0.2;
  if (!horizontalTarget || requestedOrientation === 'floor') return null;

  return Math.abs(targetEdge.direction.x) >= Math.abs(targetEdge.direction.z) ? 'front' : 'side';
}

function signedAngleOnAxis(from, to, axis) {
  const projectedFrom = from.clone().projectOnPlane(axis).normalize();
  const projectedTo = to.clone().projectOnPlane(axis).normalize();

  if (projectedFrom.lengthSq() < 0.001 || projectedTo.lengthSq() < 0.001) {
    return 0;
  }

  const cross = projectedFrom.clone().cross(projectedTo);
  const sin = THREE.MathUtils.clamp(cross.dot(axis), -1, 1);
  const cos = THREE.MathUtils.clamp(projectedFrom.dot(projectedTo), -1, 1);
  return Math.atan2(sin, cos);
}

function orientationQuaternion(orientation) {
  const euler = new THREE.Euler(
    orientation === 'floor' ? -Math.PI / 2 : 0,
    orientation === 'side' ? Math.PI / 2 : 0,
    0,
    'XYZ'
  );
  return new THREE.Quaternion().setFromEuler(euler);
}

function updateAttachmentBillboards() {
  if (!attachmentRoot) return;
  attachmentRoot.children.forEach((child) => {
    if (child.userData.isAttachRing) {
      child.lookAt(camera.position);
    }
  });
}

function footprintFor(type, orientation, rotationY = 0) {
  const depth = blockDepth(type);
  let footprint;
  if (orientation === 'floor') {
    footprint = { x: type.width, z: type.height };
  } else if (orientation === 'side') {
    footprint = { x: depth, z: type.width };
  } else {
    footprint = { x: type.width, z: depth };
  }

  const quarter = Math.round(normalizeDegrees(rotationY) / 90);
  if (quarter === 1 || quarter === 3 || quarter === -1 || quarter === -3) {
    return { x: footprint.z, z: footprint.x };
  }
  return footprint;
}

function verticalHalfHeight(type, orientation) {
  return orientation === 'floor' ? blockDepth(type) / 2 : type.height / 2;
}

function slotCenters(center, targetSpan, movingSpan) {
  const freeSpan = Math.max(0, targetSpan - movingSpan);
  if (freeSpan < 0.001) return [snap(center)];

  const step = SNAP;
  const count = Math.max(2, Math.round(freeSpan / step) + 1);
  const start = center - freeSpan / 2;

  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    return snap(start + freeSpan * ratio);
  });
}

function snap(value) {
  if (!state.gridSnap) return roundNumber(value);
  return roundNumber(Math.round(value / SNAP) * SNAP);
}

function setStatus(text, kind = 'good') {
  dom.snapStatus.classList.remove('good', 'snap', 'warn', 'error');
  dom.snapStatus.classList.add(kind);
  dom.snapText.textContent = text;

  if (dom.toast) {
    clearTimeout(toastTimer);
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 1600);
  }
}

function normalizedStepNumber(value, fallback = 1) {
  const number = Math.round(Number(value));
  if (Number.isFinite(number) && number >= 1) return number;
  return Math.max(1, Math.round(Number(fallback) || 1));
}

function nextStepNumber() {
  if (!state.blocks.length) return 1;
  return state.blocks.reduce((max, block) => Math.max(max, normalizedStepNumber(block.stepNumber, 1)), 0) + 1;
}

function logicalStepCount() {
  return new Set(state.blocks.map((block) => normalizedStepNumber(block.stepNumber, 1))).size;
}

function cleanBlock(block, index = 0) {
  return {
    id: Number(block.id),
    stepNumber: normalizedStepNumber(block.stepNumber, index + 1),
    typeId: block.typeId,
    color: normalizeColor(block.color || COLORS[0]),
    orientation: ['floor', 'front', 'side'].includes(block.orientation) ? block.orientation : 'floor',
    position: roundVector(block.position || { x: 0, y: THICKNESS / 2, z: 0 }),
    rotation: {
      x: normalizeDegrees(block.rotation?.x || 0),
      y: normalizeDegrees(block.rotation?.y || 0),
      z: normalizeDegrees(block.rotation?.z || 0),
    },
    attachment: cleanAttachment(block.attachment),
  };
}

function cleanAttachment(attachment) {
  if (!attachment || (attachment.mode !== 'custom-edge' && attachment.mode !== 'partial-edge')) return null;

  const baseBlockId = Number(attachment.baseBlockId);
  const baseEdgeId = String(attachment.baseEdgeId || '');
  const blockEdgeId = String(attachment.blockEdgeId || '');
  if (!Number.isFinite(baseBlockId) || !baseEdgeId || !blockEdgeId) return null;

  return {
    mode: attachment.mode,
    baseBlockId,
    baseEdgeId,
    blockEdgeId,
  };
}

function sanitizeState() {
  const validTypeIds = new Set(BLOCK_TYPES.map((type) => type.id));
  state.blocks = state.blocks
    .filter((block) => validTypeIds.has(block.typeId))
    .map(cleanBlock);

  const validIds = new Set(state.blocks.map((block) => block.id));
  state.selectedIds = [...new Set((state.selectedIds || []).map(Number))]
    .filter((id) => validIds.has(id));

  if (state.selectedId && validIds.has(state.selectedId) && !state.selectedIds.includes(state.selectedId)) {
    state.selectedIds.push(state.selectedId);
  }

  if (state.selectedId && !validIds.has(state.selectedId)) {
    state.selectedId = null;
  }

  if (!state.selectedId && state.selectedIds.length) {
    state.selectedId = state.selectedIds.at(-1);
  }

  if (!state.selectedId && state.blocks.length) {
    state.selectedId = state.blocks[0].id;
  }

  if (state.selectedId && !state.selectedIds.length) {
    state.selectedIds = [state.selectedId];
  }
  if (state.pendingAttach && !state.blocks.some((block) => block.id === state.pendingAttach.blockId)) {
    state.pendingAttach = null;
  }
  state.nextId = Math.max(state.nextId, nextIdFromBlocks());
}

function nextIdFromBlocks() {
  return state.blocks.reduce((max, block) => Math.max(max, Number(block.id) || 0), 0) + 1;
}
