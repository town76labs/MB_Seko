import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeBuildFrames, detectStableSegments } from '../video-temporal-core.js';
import { BLOCK_TYPES, COLORS } from '../config.js';

const WIDTH = 192;
const HEIGHT = 128;
const UNIT = 48;
const GROUND_Y = 120;
const FRAME_INTERVAL = 0.25;

const RED = [244, 67, 54];
const BLUE = [33, 150, 243];
const YELLOW = [255, 235, 59];
const HAND = [202, 190, 184];
const BACKGROUND_A = [32, 3, 3];
const BACKGROUND_B = [3, 31, 32];

const RED_BLOCK = { x: 48, color: RED };
const BLUE_BLOCK = { x: 96, color: BLUE };

const DEFAULT_STABILITY_OPTIONS = {
  pixelsPerUnit: UNIT,
  minComponentPixels: 32,
  colorTolerance: 0.2,
  snap: 0.5,
  gridWidth: 48,
  gridHeight: 32,
};

const OPTIONS = {
  pixelsPerUnit: UNIT,
  minComponentPixels: 32,
  colorTolerance: 0.2,
  snap: 0.5,
  stableDifference: 0.012,
  minStableFrames: 2,
  cameraDifference: 0.08,
  cameraChangedRatio: 0.3,
  cameraAlignmentGain: 0.1,
  gridWidth: 48,
  gridHeight: 32,
};

function renderFrame({ blocks = [], cameraX = 0, cameraY = 0, cameraScale = 1, hand = null } = {}) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const worldX = (x - centerX - cameraX) / cameraScale + centerX;
      const worldY = (y - centerY - cameraY) / cameraScale + centerY;
      const checker = (Math.floor(worldX / 16) + Math.floor(worldY / 16)) & 1;
      setPixel(data, x, y, checker ? BACKGROUND_A : BACKGROUND_B);
    }
  }

  blocks.forEach((block) => {
    const blockTop = (block.bottom ?? GROUND_Y) - (block.height ?? UNIT);
    fillRect(
      data,
      (block.x - centerX) * cameraScale + centerX + cameraX,
      (blockTop - centerY) * cameraScale + centerY + cameraY,
      (block.width ?? UNIT) * cameraScale,
      (block.height ?? UNIT) * cameraScale,
      block.color,
    );
  });

  if (hand) fillRect(data, hand.x, hand.y, hand.width, hand.height, HAND);
  return { data, width: WIDTH, height: HEIGHT };
}

function setPixel(data, x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = 255;
}

function fillRect(data, x, y, width, height, color) {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(WIDTH, Math.round(x + width));
  const bottom = Math.min(HEIGHT, Math.round(y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) setPixel(data, column, row, color);
  }
}

function hold(scene, count = 3) {
  return Array.from({ length: count }, () => renderFrame(scene));
}

function timeline(...groups) {
  return groups.flat().map((imageData, index) => ({
    time: index * FRAME_INTERVAL,
    imageData,
  }));
}

function analyze(frames) {
  return analyzeBuildFrames(frames, BLOCK_TYPES, COLORS, OPTIONS);
}

function analyzeWithOptions(frames, options) {
  return analyzeBuildFrames(frames, BLOCK_TYPES, COLORS, options);
}

function eventKinds(result) {
  return result.events.map((event) => event.kind);
}

test('boş ve sabit videodan blok veya yapım olayı üretmez', () => {
  const result = analyze(timeline(hold({}, 4)));

  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.events, []);
  assert.equal(result.stableSegments.length, 1);
  assert.equal(result.diagnostics.sampledFrames, 4);
  assert.equal(result.diagnostics.stableFrames, 1);
  assert.match(result.warnings.join(' '), /Kalıcı bir blok ekleme adımı bulunamadı/);
});

test('sabit kamerada kalıcı tek bloğu tam bir adım olarak ekler', () => {
  const result = analyze(timeline(
    hold({}, 3),
    hold({ blocks: [RED_BLOCK] }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add']);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].trackId, 1);
  assert.equal(result.blocks[0].stepNumber, 1);
  assert.equal(result.blocks[0].typeId, 'square');
  assert.equal(result.blocks[0].color, '#F44336');
  assert.deepEqual(result.blocks[0].position, { x: 0, y: 0.5, z: 0 });
  assert.deepEqual(result.events[0].blockTrackIds, [1]);
});

test('geçici el örtmesini yeni blok veya kamera olayı saymaz', () => {
  const result = analyze(timeline(
    hold({ blocks: [RED_BLOCK] }, 3),
    [
      renderFrame({ blocks: [RED_BLOCK], hand: { x: 0, y: 36, width: 116, height: 82 } }),
      renderFrame({ blocks: [RED_BLOCK], hand: { x: 76, y: 0, width: 116, height: 92 } }),
      renderFrame({ blocks: [RED_BLOCK], hand: { x: 0, y: 0, width: 192, height: 54 } }),
    ],
    hold({ blocks: [RED_BLOCK] }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add']);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].trackId, 1);
  assert.equal(result.diagnostics.cameraMoves, 0);
});

test('aynı sabit karenin tekrarları yinelenen blok veya step üretmez', () => {
  const result = analyze(timeline(hold({ blocks: [RED_BLOCK] }, 8)));

  assert.deepEqual(eventKinds(result), ['add']);
  assert.equal(result.events[0].stepNumber, 1);
  assert.equal(result.events[0].blocks.length, 1);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.stableSegments.length, 1);
});

test('global kamera kaymasını yeni veya taşınmış blok olarak yorumlamaz', () => {
  const result = analyze(timeline(
    hold({ blocks: [RED_BLOCK] }, 3),
    hold({ blocks: [RED_BLOCK], cameraX: 16 }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add', 'camera']);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].trackId, 1);
  assert.equal(result.blocks[0].stepNumber, 1);
  assert.deepEqual(result.blocks[0].position, { x: 0, y: 0.5, z: 0 });
  assert.equal(result.diagnostics.cameraMoves, 1);
  assert.equal(result.diagnostics.epochs, 2);
});

test('kamera kaymasından sonra yapılan eklemeyi sıradaki step olarak bulur', () => {
  const result = analyze(timeline(
    hold({ blocks: [RED_BLOCK] }, 3),
    hold({ blocks: [RED_BLOCK], cameraX: 16 }, 3),
    hold({ blocks: [RED_BLOCK, BLUE_BLOCK], cameraX: 16 }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add', 'camera', 'add']);
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => block.trackId), [1, 2]);
  assert.deepEqual(result.blocks.map((block) => block.stepNumber), [1, 2]);
  assert.deepEqual(result.blocks.map((block) => block.color), ['#F44336', '#2196F3']);
  assert.deepEqual(result.blocks.map((block) => block.position), [
    { x: 0, y: 0.5, z: 0 },
    { x: 1, y: 0.5, z: 0 },
  ]);
  assert.deepEqual(result.events[2].blockTrackIds, [2]);
  assert.equal(result.events[2].epochId, 1);
  assert.equal(result.diagnostics.cameraMoves, 1);
});

test('varsayılan stabilite eşiği ardışık iki kalıcı eklemeyi ayrı step olarak korur', () => {
  const result = analyzeWithOptions(timeline(
    hold({}, 3),
    hold({ blocks: [RED_BLOCK] }, 3),
    hold({ blocks: [RED_BLOCK, BLUE_BLOCK] }, 3),
  ), DEFAULT_STABILITY_OPTIONS);

  assert.deepEqual(eventKinds(result), ['add', 'add']);
  assert.equal(result.stableSegments.length, 3);
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => block.color), ['#F44336', '#2196F3']);
  assert.deepEqual(result.blocks.map((block) => block.stepNumber), [1, 2]);
  assert.deepEqual(result.events.map((event) => event.stepNumber), [1, 2]);
});

test('varsayılan eşik bitişik aynı renk ikinci kareyi yeni step olarak ayırır', () => {
  const adjacentRedBlock = { x: 96, color: RED };
  const result = analyzeWithOptions(timeline(
    hold({}, 3),
    hold({ blocks: [RED_BLOCK] }, 3),
    hold({ blocks: [RED_BLOCK, adjacentRedBlock] }, 3),
  ), DEFAULT_STABILITY_OPTIONS);

  assert.equal(result.diagnostics.cameraMoves, 0);
  assert.deepEqual(eventKinds(result), ['add', 'add']);
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => block.color), ['#F44336', '#F44336']);
  assert.deepEqual(result.blocks.map((block) => block.stepNumber), [1, 2]);
});

test('boş başlangıçtan sonra kadrajı kaplayan büyük kareyi kamera hareketi değil add sayar', () => {
  const largeSquare = { x: 48, width: UNIT * 2, height: UNIT * 2, color: RED };
  const result = analyzeWithOptions(timeline(
    hold({}, 3),
    hold({ blocks: [largeSquare] }, 3),
  ), DEFAULT_STABILITY_OPTIONS);

  assert.equal(result.diagnostics.cameraMoves, 0);
  assert.deepEqual(eventKinds(result), ['add']);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].typeId, 'large-square');
  assert.equal(result.blocks[0].stepNumber, 1);
  assert.deepEqual(result.blocks[0].position, { x: 0, y: 1, z: 0 });
});

test('merkezden yüzde 25 zoom kamera olayıdır ve zoom sonrası gerçek ekleme sıradaki step olur', () => {
  const firstTwoBlocks = [
    { x: 24, bottom: 104, color: RED },
    { x: 72, bottom: 104, color: BLUE },
  ];
  const thirdBlock = { x: 120, bottom: 104, color: YELLOW };
  const result = analyze(timeline(
    hold({ blocks: firstTwoBlocks }, 3),
    hold({ blocks: firstTwoBlocks, cameraScale: 1.25 }, 3),
    hold({ blocks: [...firstTwoBlocks, thirdBlock], cameraScale: 1.25 }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add', 'camera', 'add']);
  assert.equal(result.diagnostics.cameraMoves, 1);
  assert.equal(result.blocks.length, 3);
  assert.deepEqual(result.blocks.map((block) => block.color), ['#F44336', '#2196F3', '#FFEB3B']);
  assert.deepEqual(result.blocks.map((block) => block.stepNumber), [1, 1, 2]);
  assert.deepEqual(result.events[2].blockTrackIds, [3]);
  assert.equal(result.events[2].stepNumber, 2);
  const third = result.blocks[2];
  assert.equal(third.typeId, 'square');
  assert.deepEqual(third.position, { x: 2, y: 0.5, z: 0 });
  assert.ok(Number.isFinite(third.confidence));
  assert.ok(third.confidence >= 0.65 && third.confidence <= 0.78);
});

test('tek anchor sonrası belirgin zoom ile eklenen bloğu otomatik aktarım eşiğinin altında tutar', () => {
  const anchor = { x: 48, bottom: 96, color: RED };
  const postZoomBlock = { x: 96, bottom: 96, color: BLUE };
  const result = analyze(timeline(
    hold({ blocks: [anchor] }, 3),
    hold({ blocks: [anchor], cameraScale: 1.5 }, 3),
    hold({ blocks: [anchor, postZoomBlock], cameraScale: 1.5 }, 3),
  ));

  assert.deepEqual(eventKinds(result), ['add', 'camera', 'add']);
  const cameraEvent = result.events.find((event) => event.kind === 'camera');
  assert.ok(cameraEvent);
  const postCameraAdd = result.events.find((event) => (
    event.kind === 'add'
    && event.epochId === cameraEvent.epochId
    && event.time > cameraEvent.time
  ));
  assert.ok(postCameraAdd);
  assert.equal(postCameraAdd.blockTrackIds.length, 1);
  const addedBlock = result.blocks.find((block) => block.trackId === postCameraAdd.blockTrackIds[0]);
  assert.ok(addedBlock);
  assert.ok(Number.isFinite(addedBlock.confidence));
  assert.ok(addedBlock.confidence < 0.62);
});

test('hazır keyframe modunda boş kare otomatik piksel ölçeğini saptırmaz', () => {
  const sixtyPixelSquare = { x: 66, width: 60, height: 60, color: RED };
  const result = analyzeWithOptions(timeline([
    renderFrame({}),
    renderFrame({ blocks: [sixtyPixelSquare] }),
  ]), {
    framesAreStable: true,
  });

  assert.ok(Math.abs(result.pixelsPerUnit - 60) <= 2);
  assert.deepEqual(eventKinds(result), ['add']);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].typeId, 'square');
});

test('kümülatif bir piksellik kamera panını tek sabit segmentte birleştirmez', () => {
  const frames = Array.from({ length: 17 }, (_, index) => ({
    time: index * FRAME_INTERVAL,
    imageData: renderFrame({ cameraX: index }),
  }));
  const segments = detectStableSegments(frames);
  const wholeVideoIsOneStableSegment = segments.length === 1
    && segments[0].startIndex === 0
    && segments[0].endIndex === frames.length - 1;

  assert.equal(wholeVideoIsOneStableSegment, false);

  const result = analyzeWithOptions(frames, DEFAULT_STABILITY_OPTIONS);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.events.filter((event) => event.kind === 'add').length, 0);
});
