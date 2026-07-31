const VIEW_NAMES = ['front', 'right', 'back', 'left', 'top'];

const INTERNAL_TYPE_ALIASES = {
  'equilateral-triangle': 'triangle',
  'large-isosceles-triangle': 'long-triangle',
  'isosceles-right-triangle': 'right-triangle',
};

const DEFAULT_OPTIONS = {
  colorTolerance: 0.2,
  minComponentPixels: 42,
  pixelsPerUnit: 0,
  snap: 0.5,
};

/**
 * Analyse a set of labelled, orthogonal video frames. The analyser deliberately
 * uses the application's finite block catalogue instead of attempting free-form
 * 3D reconstruction. It is deterministic and runs entirely in the browser.
 */
export function analyzeGuidedFrames(frames, blockTypes, palette, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const catalogue = normalizeCatalogue(blockTypes);
  const colors = palette.map((color) => ({ hex: normalizeHex(color), ...rgbToHsv(...hexToRgb(color)) }));
  const frameAnalyses = {};

  for (const frame of frames) {
    if (!frame || !VIEW_NAMES.includes(frame.view) || !frame.imageData) continue;
    frameAnalyses[frame.view] = analyzeFrame(frame, catalogue, colors, options);
  }

  const allRegions = Object.values(frameAnalyses).flatMap((analysis) => analysis.regions);
  const pixelsPerUnit = options.pixelsPerUnit > 0
    ? options.pixelsPerUnit
    : estimatePixelsPerUnit(allRegions, catalogue);

  Object.values(frameAnalyses).forEach((analysis) => {
    analysis.pixelsPerUnit = pixelsPerUnit;
    classifyRegions(analysis.regions, catalogue, pixelsPerUnit);
    analysis.origin = estimateViewOrigin(analysis.regions, analysis.width, analysis.height, analysis.view, pixelsPerUnit);
  });

  const observations = buildObservations(frameAnalyses, catalogue, pixelsPerUnit);
  const blocks = fuseObservations(observations, frameAnalyses, catalogue, pixelsPerUnit, options.snap);

  return {
    blocks: normalizeScene(blocks, catalogue, options.snap),
    frames: frameAnalyses,
    pixelsPerUnit,
    warnings: buildWarnings(frameAnalyses, blocks, pixelsPerUnit),
  };
}

export function analyzeFramePixels(imageData, palette, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const colors = palette.map((color) => ({ hex: normalizeHex(color), ...rgbToHsv(...hexToRgb(color)) }));
  return extractColorRegions(imageData, colors, options);
}

function analyzeFrame(frame, catalogue, colors, options) {
  const extracted = extractColorRegions(frame.imageData, colors, options);
  const regions = extracted.regions.map((region) => ({
    ...region,
    view: frame.view,
    typeId: null,
    typeConfidence: 0,
    faceLike: false,
  }));

  return {
    view: frame.view,
    width: extracted.width,
    height: extracted.height,
    regions,
    origin: { x: extracted.width / 2, y: extracted.height },
    pixelsPerUnit: 0,
    sourceWidth: frame.imageData.width,
    sourceHeight: frame.imageData.height,
  };
}

function extractColorRegions(imageData, colors, options) {
  const { data, width, height } = imageData;
  const labels = new Int16Array(width * height);
  labels.fill(-1);

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    if (data[index + 3] < 100) continue;
    const hsv = rgbToHsv(data[index], data[index + 1], data[index + 2]);
    if (hsv.s < 0.2 || hsv.v < 0.14) continue;

    let best = -1;
    let bestDistance = Infinity;
    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      const distance = hsvDistance(hsv, colors[colorIndex]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = colorIndex;
      }
    }

    if (bestDistance <= options.colorTolerance) labels[pixel] = best;
  }

  const regions = connectedRegions(labels, width, height, colors, options.minComponentPixels);
  return { width, height, labels, regions };
}

function connectedRegions(labels, width, height, colors, minPixels) {
  const visited = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  const regions = [];
  const neighbors = [-1, 1, -width, width];

  for (let start = 0; start < labels.length; start += 1) {
    const label = labels[start];
    if (label < 0 || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let perimeter = 0;
    const rowCounts = new Map();

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      count += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      rowCounts.set(y, (rowCounts.get(y) || 0) + 1);

      for (const offset of neighbors) {
        const next = pixel + offset;
        const crossesRow = (offset === -1 && x === 0) || (offset === 1 && x === width - 1);
        if (next < 0 || next >= labels.length || crossesRow || labels[next] !== label) {
          perimeter += 1;
          continue;
        }
        if (!visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    if (count < minPixels) continue;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const rows = [];
    for (let y = minY; y <= maxY; y += 1) rows.push(rowCounts.get(y) || 0);
    const topWidth = mean(rows.slice(0, Math.max(1, Math.floor(rows.length * 0.2))));
    const middleStart = Math.floor(rows.length * 0.4);
    const middleWidth = mean(rows.slice(middleStart, Math.max(middleStart + 1, Math.ceil(rows.length * 0.6))));
    const bottomWidth = mean(rows.slice(Math.floor(rows.length * 0.8)));

    regions.push({
      id: `${label}:${regions.length}`,
      color: colors[label].hex,
      colorIndex: label,
      area: count,
      centroid: { x: sumX / count, y: sumY / count },
      bbox: { x: minX, y: minY, width: boxWidth, height: boxHeight },
      fillRatio: count / (boxWidth * boxHeight),
      perimeter,
      compactness: (4 * Math.PI * count) / Math.max(1, perimeter * perimeter),
      profile: {
        top: topWidth / boxWidth,
        middle: middleWidth / boxWidth,
        bottom: bottomWidth / boxWidth,
        horizontalSkew: Math.abs((sumX / count) - (minX + maxX) / 2) / Math.max(1, boxWidth / 2),
      },
    });
  }

  return regions;
}

function estimatePixelsPerUnit(regions, catalogue) {
  const candidates = [];
  for (const region of regions) {
    const { width, height } = region.bbox;
    if (width < 10 || height < 10 || region.fillRatio < 0.28) continue;
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    if (long / short > 3.4) continue;
    candidates.push(short, long / 2);
    if (region.fillRatio < 0.68) candidates.push(width, height / 0.866);
  }

  if (!candidates.length) return 80;
  const filtered = candidates.filter((value) => Number.isFinite(value) && value >= 8).sort((a, b) => a - b);
  let best = filtered[Math.floor(filtered.length / 2)];
  let bestSupport = -1;

  for (const candidate of filtered) {
    let support = 0;
    for (const region of regions) {
      const w = region.bbox.width / candidate;
      const h = region.bbox.height / candidate;
      const match = catalogue.reduce((score, type) => {
        const direct = Math.abs(w - type.width) + Math.abs(h - type.height);
        const rotated = Math.abs(w - type.height) + Math.abs(h - type.width);
        return Math.min(score, direct, rotated);
      }, Infinity);
      if (match < 0.38) support += region.area * (1 - match / 0.38);
    }
    if (support > bestSupport + 0.001 || (Math.abs(support - bestSupport) <= 0.001 && candidate > best)) {
      bestSupport = support;
      best = candidate;
    }
  }

  return clamp(best, 12, 600);
}

function classifyRegions(regions, catalogue, pixelsPerUnit) {
  for (const region of regions) {
    const w = region.bbox.width / pixelsPerUnit;
    const h = region.bbox.height / pixelsPerUnit;
    const minDimension = Math.min(w, h);
    region.faceLike = minDimension >= 0.48 && region.fillRatio >= 0.24;

    if (!region.faceLike) {
      region.profileKind = 'edge';
      region.typeId = null;
      region.typeConfidence = clamp(0.35 + region.fillRatio * 0.3, 0.35, 0.6);
      continue;
    }

    const shapeHint = shapeHintForRegion(region);
    let best = null;
    for (const type of catalogue) {
      const sizeError = Math.min(
        normalizedSizeError(w, h, type.width, type.height),
        normalizedSizeError(w, h, type.height, type.width),
      );
      const familyPenalty = familyPenaltyFor(type.id, shapeHint, region);
      const score = sizeError + familyPenalty;
      if (!best || score < best.score) best = { type, score };
    }

    region.profileKind = shapeHint;
    region.typeId = best?.type.id || 'square';
    region.typeConfidence = clamp(1 - (best?.score ?? 1) / 1.35, 0.25, 0.99);
  }
}

function shapeHintForRegion(region) {
  const { top, middle, bottom, horizontalSkew } = region.profile;
  const aspect = region.bbox.width / region.bbox.height;
  const taper = Math.abs(top - bottom);
  const wideEnd = Math.max(top, bottom);
  const narrowEnd = Math.min(top, bottom);

  if (taper > 0.32 && narrowEnd < 0.55 && wideEnd > 0.7) {
    if (horizontalSkew > 0.17) return 'right-triangle';
    if (aspect < 0.56) return 'long-triangle';
    return 'triangle';
  }
  if (region.fillRatio < 0.5 && middle < 0.76) return 'windowed';
  if (region.fillRatio >= 0.58 && region.fillRatio <= 0.86 && top < middle * 0.8 && Math.abs(middle - bottom) < 0.2) {
    return 'semicircle';
  }
  if (aspect > 1.55 || aspect < 0.64) return 'rectangle';
  return 'quadrilateral';
}

function familyPenaltyFor(typeId, hint, region) {
  const family = typeFamily(typeId);
  if (hint === 'triangle') return family === 'triangle' ? 0 : 0.82;
  if (hint === 'right-triangle') return typeId === 'right-triangle' ? 0 : family === 'triangle' ? 0.38 : 0.9;
  if (hint === 'long-triangle') return typeId === 'long-triangle' ? 0 : family === 'triangle' ? 0.25 : 0.9;
  if (hint === 'windowed') return ['window', 'tunnel'].includes(typeId) ? 0 : 0.58;
  if (hint === 'semicircle') return typeId === 'semicircle' ? 0 : typeId === 'tunnel' ? 0.2 : 0.66;
  if (hint === 'rectangle') return typeId === 'rectangle' ? 0 : 0.38;
  if (family === 'triangle' || ['semicircle', 'tunnel', 'stairs'].includes(typeId)) return 0.55;
  if (typeId === 'window' && region.fillRatio > 0.74) return 0.32;
  return 0;
}

function estimateViewOrigin(regions, width, height, view, pixelsPerUnit) {
  if (!regions.length) return { x: width / 2, y: height - pixelsPerUnit * 0.08 };
  const minX = Math.min(...regions.map((region) => region.bbox.x));
  const maxX = Math.max(...regions.map((region) => region.bbox.x + region.bbox.width));
  const minY = Math.min(...regions.map((region) => region.bbox.y));
  const maxY = Math.max(...regions.map((region) => region.bbox.y + region.bbox.height));
  if (view === 'top') return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return { x: (minX + maxX) / 2, y: maxY };
}

function buildObservations(frameAnalyses, catalogue, pixelsPerUnit) {
  const observations = [];
  Object.values(frameAnalyses).forEach((analysis) => {
    analysis.regions.forEach((region) => {
      const boxCenter = {
        x: region.bbox.x + region.bbox.width / 2,
        y: region.bbox.y + region.bbox.height / 2,
      };
      const coordinate = projectedCoordinate(boxCenter, analysis.view, analysis.origin, pixelsPerUnit);
      observations.push({
        ...region,
        view: analysis.view,
        coordinate,
        orientation: orientationForView(analysis.view),
      });
    });
  });
  return observations;
}

function fuseObservations(observations, frameAnalyses, catalogue, pixelsPerUnit, snapSize) {
  const faceObservations = observations.filter((item) => item.faceLike && item.typeId);
  const edgeObservations = observations.filter((item) => !item.faceLike);
  const consumed = new Set();
  const blocks = [];

  const ranked = [...faceObservations].sort((a, b) => b.area * b.typeConfidence - a.area * a.typeConfidence);
  for (const observation of ranked) {
    const key = observationKey(observation);
    if (consumed.has(key)) continue;

    const opposite = bestOppositeMatch(observation, faceObservations, consumed, snapSize);
    consumed.add(key);
    if (opposite) consumed.add(observationKey(opposite));

    const pair = opposite ? [observation, opposite] : [observation];
    const primary = pair.sort((a, b) => b.typeConfidence - a.typeConfidence)[0];
    const position = positionFromObservationPair(primary, opposite, edgeObservations, snapSize);
    const type = catalogue.find((entry) => entry.id === primary.typeId) || catalogue[0];
    const confidenceParts = [primary.typeConfidence];
    if (opposite) confidenceParts.push(opposite.typeConfidence, 0.96);
    else confidenceParts.push(0.62);
    if (position.missingAxisResolved) confidenceParts.push(0.88);
    else confidenceParts.push(0.48);

    blocks.push({
      sourceId: `${primary.view}:${primary.id}`,
      typeId: primary.typeId,
      color: primary.color,
      orientation: primary.orientation,
      position: position.value,
      rotation: rotationForDetection(primary),
      confidence: mean(confidenceParts),
      evidence: pair.map((item) => ({ view: item.view, regionId: item.id })),
      bbox: primary.bbox,
      sourceView: primary.view,
      dimensions: type,
    });
  }

  return deduplicateBlocks(blocks, snapSize);
}

function bestOppositeMatch(source, observations, consumed, snapSize) {
  const oppositeView = ({ front: 'back', back: 'front', right: 'left', left: 'right', top: null })[source.view];
  if (!oppositeView) return null;
  let best = null;
  for (const candidate of observations) {
    if (candidate.view !== oppositeView || consumed.has(observationKey(candidate))) continue;
    if (candidate.color !== source.color || candidate.typeId !== source.typeId) continue;
    const sourceCoord = source.coordinate;
    const candidateCoord = candidate.coordinate;
    const horizontalError = Math.abs(projectedHorizontal(source) - projectedHorizontal(candidate));
    const verticalError = Math.abs((sourceCoord.y ?? 0) - (candidateCoord.y ?? 0));
    const error = horizontalError + verticalError;
    if (error <= Math.max(0.8, snapSize * 2.2) && (!best || error < best.error)) best = { candidate, error };
  }
  return best?.candidate || null;
}

function positionFromObservationPair(primary, opposite, edgeObservations, snapSize) {
  const coordinate = averageCoordinates(primary.coordinate, opposite?.coordinate);
  const missingAxis = primary.orientation === 'front' ? 'z' : primary.orientation === 'side' ? 'x' : 'y';
  const candidates = edgeObservations
    .filter((edge) => edge.color === primary.color && edge.view !== primary.view)
    .map((edge) => ({ edge, score: edgeCompatibility(primary, edge, coordinate) }))
    .filter((entry) => entry.score < 1.25)
    .sort((a, b) => a.score - b.score);

  let resolved = false;
  if (candidates.length) {
    const value = candidates[0].edge.coordinate[missingAxis];
    if (Number.isFinite(value)) {
      coordinate[missingAxis] = value;
      resolved = true;
    }
  }

  if (!Number.isFinite(coordinate[missingAxis])) coordinate[missingAxis] = 0;
  return {
    value: {
      x: snapValue(coordinate.x || 0, snapSize),
      y: snapValue(coordinate.y || 0, snapSize),
      z: snapValue(coordinate.z || 0, snapSize),
    },
    missingAxisResolved: resolved,
  };
}

function edgeCompatibility(face, edge, coordinate) {
  let error = 0;
  let compared = 0;
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(coordinate[axis]) || !Number.isFinite(edge.coordinate[axis])) continue;
    if (axis === (face.orientation === 'front' ? 'z' : face.orientation === 'side' ? 'x' : 'y')) continue;
    error += Math.abs(coordinate[axis] - edge.coordinate[axis]);
    compared += 1;
  }
  return compared ? error / compared : Infinity;
}

function deduplicateBlocks(blocks, snapSize) {
  const kept = [];
  for (const block of [...blocks].sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = kept.find((other) => (
      other.typeId === block.typeId
      && other.color === block.color
      && distance3(other.position, block.position) <= Math.max(0.36, snapSize * 0.85)
    ));
    if (!duplicate) kept.push(block);
    else duplicate.evidence.push(...block.evidence);
  }
  return kept;
}

function normalizeScene(blocks, catalogue, snapSize) {
  if (!blocks.length) return [];
  const halfHeight = (block) => {
    const type = catalogue.find((entry) => entry.id === block.typeId) || catalogue[0];
    return block.orientation === 'floor' ? type.depth / 2 : type.height / 2;
  };
  const floor = Math.min(...blocks.map((block) => block.position.y - halfHeight(block)));
  const centeredX = mean(blocks.map((block) => block.position.x));
  const centeredZ = mean(blocks.map((block) => block.position.z));
  const normalized = blocks.map((block) => ({
    ...block,
    position: {
      x: snapValue(block.position.x - centeredX, snapSize),
      y: snapValue(block.position.y - halfHeight(block) - floor, snapSize) + halfHeight(block),
      z: snapValue(block.position.z - centeredZ, snapSize),
    },
  }));

  normalized.sort((a, b) => (
    a.position.y - b.position.y
    || a.position.x - b.position.x
    || a.position.z - b.position.z
  ));
  normalized.forEach((block, index) => {
    block.stepNumber = index + 1;
  });
  return normalized;
}

function buildWarnings(frameAnalyses, blocks, pixelsPerUnit) {
  const warnings = ['Tamamen kapalı veya hiçbir görünüşte seçilemeyen bloklar videodan doğrulanamaz.'];
  const views = new Set(Object.keys(frameAnalyses));
  if (!views.has('front') && !views.has('back')) warnings.push('Ön veya arka görünüş olmadan X/Y konumları zayıf kalır.');
  if (!views.has('right') && !views.has('left')) warnings.push('Sağ veya sol görünüş olmadan Z/Y konumları zayıf kalır.');
  if (!views.has('top')) warnings.push('Üst görünüş olmadan yatay parçalar ve derinlik katmanları daha düşük güvenle çıkarılır.');
  if (!blocks.length) warnings.push('Palet renklerine uyan ayrı bir blok bulunamadı. Işığı ve renk toleransını kontrol edin.');
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit < 12) warnings.push('Blok ölçeği güvenilir hesaplanamadı; manuel piksel/birim değeri girin.');
  const lowConfidence = blocks.filter((block) => block.confidence < 0.62).length;
  if (lowConfidence) warnings.push(`${lowConfidence} blok kullanıcı kontrolü gerektiriyor.`);
  return warnings;
}

function projectedCoordinate(point, view, origin, scale) {
  const horizontal = (point.x - origin.x) / scale;
  const vertical = (origin.y - point.y) / scale;
  switch (view) {
    case 'front': return { x: horizontal, y: vertical, z: NaN };
    case 'back': return { x: -horizontal, y: vertical, z: NaN };
    case 'right': return { x: NaN, y: vertical, z: -horizontal };
    case 'left': return { x: NaN, y: vertical, z: horizontal };
    case 'top': return { x: horizontal, y: NaN, z: -vertical };
    default: return { x: horizontal, y: vertical, z: NaN };
  }
}

function orientationForView(view) {
  if (view === 'top') return 'floor';
  if (view === 'right' || view === 'left') return 'side';
  return 'front';
}

function rotationForDetection(observation) {
  let z = 0;
  const { top, bottom } = observation.profile;
  if (observation.profileKind.includes('triangle') && top > bottom) z = 180;
  return { x: 0, y: 0, z };
}

function observationKey(observation) {
  return `${observation.view}:${observation.id}`;
}

function projectedHorizontal(observation) {
  if (Number.isFinite(observation.coordinate.x)) return observation.coordinate.x;
  if (Number.isFinite(observation.coordinate.z)) return observation.coordinate.z;
  return 0;
}

function averageCoordinates(first, second) {
  const result = {};
  for (const axis of ['x', 'y', 'z']) {
    const values = [first?.[axis], second?.[axis]].filter(Number.isFinite);
    result[axis] = values.length ? mean(values) : NaN;
  }
  return result;
}

function normalizeCatalogue(blockTypes) {
  return blockTypes.map((type) => ({
    id: INTERNAL_TYPE_ALIASES[type.id] || type.id,
    width: Number(type.width) || 1,
    height: Number(type.height) || 1,
    depth: Number.isFinite(Number(type.depth)) ? Number(type.depth) : 0.16,
  }));
}

function typeFamily(typeId) {
  return ['triangle', 'right-triangle', 'long-triangle'].includes(typeId) ? 'triangle' : 'panel';
}

function normalizedSizeError(w, h, expectedW, expectedH) {
  return Math.abs(w - expectedW) / Math.max(0.4, expectedW)
    + Math.abs(h - expectedH) / Math.max(0.4, expectedH);
}

function hsvDistance(a, b) {
  const hue = Math.min(Math.abs(a.h - b.h), 1 - Math.abs(a.h - b.h));
  return Math.sqrt((hue * 1.65) ** 2 + ((a.s - b.s) * 0.35) ** 2 + ((a.v - b.v) * 0.12) ** 2);
}

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

function hexToRgb(value) {
  const hex = normalizeHex(value).slice(1);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function normalizeHex(value) {
  const text = String(value || '#000000').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split('').map((part) => part + part).join('')}`.toUpperCase();
  }
  return '#000000';
}

function snapValue(value, step) {
  return Math.round((value || 0) / step) * step;
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
