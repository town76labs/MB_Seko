import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeFramePixels, analyzeGuidedFrames } from '../video-analysis-core.js';
import { BLOCK_TYPES, COLORS } from '../config.js';

function image(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 22;
    data[index + 1] = 25;
    data[index + 2] = 30;
    data[index + 3] = 255;
  }
  const setPixel = (x, y, color) => {
    const offset = (y * width + x) * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
  };
  paint(setPixel);
  return { data, width, height };
}

function fillRect(setPixel, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(column, row, color);
  }
}

function fillTriangle(setPixel, left, top, width, height, color, rightAngled = false) {
  for (let row = 0; row < height; row += 1) {
    const progress = (row + 1) / height;
    const rowWidth = Math.max(1, Math.round(width * progress));
    const start = rightAngled ? left : left + Math.floor((width - rowWidth) / 2);
    for (let column = start; column < start + rowWidth; column += 1) setPixel(column, top + row, color);
  }
}

const red = [244, 67, 54];
const blue = [33, 150, 243];

test('palette rengini arka plandan ayırır ve bağlı alanı ölçer', () => {
  const frame = image(120, 100, (setPixel) => fillRect(setPixel, 30, 20, 50, 40, red));
  const result = analyzeFramePixels(frame, COLORS, { minComponentPixels: 20, colorTolerance: 0.2 });

  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].color, '#F44336');
  assert.deepEqual(result.regions[0].bbox, { x: 30, y: 20, width: 50, height: 40 });
  assert.equal(result.regions[0].area, 2000);
});

test('çok küçük renk gürültüsünü blok olarak kabul etmez', () => {
  const frame = image(80, 80, (setPixel) => fillRect(setPixel, 10, 10, 3, 3, red));
  const result = analyzeFramePixels(frame, COLORS, { minComponentPixels: 20, colorTolerance: 0.2 });
  assert.equal(result.regions.length, 0);
});

test('ön ve arka görünüşteki aynı kareyi tek blokta birleştirir', () => {
  const front = image(220, 180, (setPixel) => fillRect(setPixel, 80, 80, 60, 60, red));
  const back = image(220, 180, (setPixel) => fillRect(setPixel, 80, 80, 60, 60, red));
  const result = analyzeGuidedFrames([
    { view: 'front', imageData: front },
    { view: 'back', imageData: back },
  ], BLOCK_TYPES, COLORS, {
    pixelsPerUnit: 60,
    minComponentPixels: 20,
    colorTolerance: 0.2,
    snap: 0.5,
  });

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].typeId, 'square');
  assert.equal(result.blocks[0].color, '#F44336');
  assert.equal(result.blocks[0].orientation, 'front');
  assert.deepEqual(result.blocks[0].position, { x: 0, y: 0.5, z: 0 });
  assert.ok(result.blocks[0].confidence >= 0.7);
});

test('tek kare için otomatik ölçek bağında temel 1×1 bloğu tercih eder', () => {
  const front = image(220, 180, (setPixel) => fillRect(setPixel, 80, 80, 60, 60, red));
  const back = image(220, 180, (setPixel) => fillRect(setPixel, 80, 80, 60, 60, red));
  const result = analyzeGuidedFrames([
    { view: 'front', imageData: front },
    { view: 'back', imageData: back },
  ], BLOCK_TYPES, COLORS, { minComponentPixels: 20, colorTolerance: 0.2, snap: 0.5 });

  assert.equal(result.pixelsPerUnit, 60);
  assert.equal(result.blocks[0].typeId, 'square');
});

test('dikdörtgen ile eşkenar ve dik üçgen profillerini ayırır', () => {
  const cases = [
    {
      expected: 'rectangle',
      frame: () => image(240, 180, (setPixel) => fillRect(setPixel, 60, 80, 120, 60, red)),
    },
    {
      expected: 'triangle',
      frame: () => image(240, 180, (setPixel) => fillTriangle(setPixel, 90, 86, 60, 52, red)),
    },
    {
      expected: 'right-triangle',
      frame: () => image(240, 180, (setPixel) => fillTriangle(setPixel, 90, 80, 60, 60, red, true)),
    },
  ];

  for (const item of cases) {
    const result = analyzeGuidedFrames([
      { view: 'front', imageData: item.frame() },
      { view: 'back', imageData: item.frame() },
    ], BLOCK_TYPES, COLORS, {
      pixelsPerUnit: 60,
      minComponentPixels: 20,
      colorTolerance: 0.2,
      snap: 0.5,
    });
    assert.equal(result.blocks[0]?.typeId, item.expected);
  }
});

test('dik görünüşteki ince kenarı kullanarak eksik derinlik eksenini tamamlar', () => {
  const front = image(260, 180, (setPixel) => {
    fillRect(setPixel, 50, 80, 60, 60, red);
    fillRect(setPixel, 170, 80, 8, 60, blue);
  });
  const right = image(260, 180, (setPixel) => {
    fillRect(setPixel, 70, 80, 8, 60, red);
    fillRect(setPixel, 150, 80, 60, 60, blue);
  });
  const result = analyzeGuidedFrames([
    { view: 'front', imageData: front },
    { view: 'right', imageData: right },
  ], BLOCK_TYPES, COLORS, {
    pixelsPerUnit: 60,
    minComponentPixels: 20,
    colorTolerance: 0.2,
    snap: 0.5,
  });

  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => block.orientation).sort(), ['front', 'side']);
  assert.ok(result.blocks.every((block) => block.confidence >= 0.8));
  assert.ok(result.blocks.every((block) => ['x', 'y', 'z'].every((axis) => Number.isFinite(block.position[axis]))));
});

test('üst görünüşte algılanan ince paneli zemin kalınlığının yarısına yerleştirir', () => {
  const top = image(200, 200, (setPixel) => fillRect(setPixel, 70, 70, 60, 60, red));
  const result = analyzeGuidedFrames([{ view: 'top', imageData: top }], BLOCK_TYPES, COLORS, {
    pixelsPerUnit: 60,
    minComponentPixels: 20,
    colorTolerance: 0.2,
    snap: 0.5,
  });

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].orientation, 'floor');
  assert.equal(result.blocks[0].position.y, 0.08);
});
