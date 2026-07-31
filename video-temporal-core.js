import { analyzeFramePixels, analyzeGuidedFrames } from './video-analysis-core.js?v=video-scan-2';

const DEFAULT_OPTIONS = {
  colorTolerance: 0.2,
  minComponentPixels: 24,
  pixelsPerUnit: 0,
  snap: 0.5,
  stableDifference: 0.032,
  stablePeakDifference: 0.065,
  stablePeakFraction: 0.012,
  minStableFrames: 2,
  cameraDifference: 0.095,
  cameraChangedRatio: 0.34,
  cameraAlignmentGain: 0.14,
  cameraScaleChange: 0.075,
  cameraScaleGain: 0.055,
  gridWidth: 48,
  gridHeight: 32,
};

/**
 * Converts regularly sampled frames from a fixed-model construction video into
 * persistent build events. Global camera moves create a new epoch and never a
 * build step; local, persistent palette additions become blocks.
 */
export function analyzeBuildFrames(frames, blockTypes, palette, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const minimumFrames = options.framesAreStable ? 1 : 2;
  if (!Array.isArray(frames) || frames.length < minimumFrames) {
    return emptyResult('Video analizi için en az iki kare gerekir.');
  }

  const described = frames.map((frame, index) => ({
    ...frame,
    index,
    signature: makeFrameSignature(frame.imageData, options.gridWidth, options.gridHeight),
  }));
  const stableSegments = options.framesAreStable
    ? described.map((_, index) => ({ startIndex: index, endIndex: index }))
    : detectStableSegments(described, options);
  if (!stableSegments.length) {
    return emptyResult('Videoda yeterince uzun sabit bir aralık bulunamadı. Her bloktan sonra yaklaşık 1 saniye bekleyin.');
  }

  const keyframes = stableSegments.map((segment) => described[segment.endIndex]);
  const firstPass = keyframes.map((frame) => analyzeSnapshot(frame, blockTypes, palette, options, 0));
  const pixelsPerUnit = options.pixelsPerUnit > 0
    ? options.pixelsPerUnit
    : robustMedian(firstPass
      .filter((snapshot) => snapshot.regions.length > 0)
      .map((snapshot) => snapshot.pixelsPerUnit)
      .filter((value) => value >= 12), 80);
  const events = [];
  const blocks = [];
  const activeByTrackId = new Map();
  const maxColorCounts = new Map();
  let previous = null;
  let previousTrackIds = new Map();
  let nextTrackId = 1;
  let stepNumber = 0;
  let epochId = 0;
  let epochOffset = null;
  let epochPixelsPerUnit = pixelsPerUnit;
  let cameraMoves = 0;

  for (let snapshotIndex = 0; snapshotIndex < keyframes.length; snapshotIndex += 1) {
    let current = analyzeSnapshot(keyframes[snapshotIndex], blockTypes, palette, options, epochPixelsPerUnit);
    if (!previous) {
      const initialRegions = current.regions;
      if (initialRegions.length) {
        stepNumber += 1;
        epochOffset = initialEpochOffset(initialRegions);
        const created = initialRegions.map((region) => createTemporalBlock({
          region,
          snapshot: current,
          trackId: nextTrackId++,
          stepNumber,
          epochId,
          epochOffset,
          blockTypes,
          options,
          confidencePenalty: initialRegions.length > 1 ? 0.08 : 0,
        }));
        created.forEach((block) => {
          blocks.push(block);
          activeByTrackId.set(block.trackId, block);
          previousTrackIds.set(block.regionId, block.trackId);
        });
        updateMaxColorCounts(maxColorCounts, current.regions);
        events.push(addEvent(created, current, stepNumber, epochId, 'Video ilk sabit karede blokla başladı.'));
      }
      previous = current;
      continue;
    }

    const alignment = estimateSignatureAlignment(previous.frame.signature, current.frame.signature);
    alignment.dxPixels = alignment.dxCells * current.width / options.gridWidth;
    alignment.dyPixels = alignment.dyCells * current.height / options.gridHeight;
    alignment.pixelsPerUnit = current.pixelsPerUnit;
    let matching = matchRegions(previous.regions, current.regions, alignment, previousTrackIds);
    let currentTrackIds = new Map();
    matching.matches.forEach(({ previousRegion, currentRegion }) => {
      const trackId = previousTrackIds.get(previousRegion.id);
      if (trackId) currentTrackIds.set(currentRegion.id, trackId);
    });

    const visualDifference = signatureDifference(previous.frame.signature, current.frame.signature);
    const changedRatio = signatureChangedRatio(previous.frame.signature, current.frame.signature, 0.085);
    let matchRatio = matching.matches.length / Math.max(1, Math.min(previous.regions.length, current.regions.length));
    const cameraMetrics = { alignment, visualDifference, changedRatio, matchRatio, matching, previous, current };
    const cameraScale = cameraScaleFactor(cameraMetrics, options);
    const cameraScaleMove = Number.isFinite(cameraScale);
    const cameraMove = isCameraMove(cameraMetrics, options);

    if (cameraMove && cameraScaleMove) {
      epochPixelsPerUnit = clamp(previous.pixelsPerUnit * cameraScale, 12, 600);
      current = analyzeSnapshot(current.frame, blockTypes, palette, options, epochPixelsPerUnit);
      const normalizedAlignment = {
        ...alignment,
        scale: 1,
        pixelsPerUnit: epochPixelsPerUnit,
      };
      matching = matchRegions(previous.regions, current.regions, normalizedAlignment, previousTrackIds);
      currentTrackIds = new Map();
      matching.matches.forEach(({ previousRegion, currentRegion }) => {
        const trackId = previousTrackIds.get(previousRegion.id);
        if (trackId) currentTrackIds.set(currentRegion.id, trackId);
      });
      matchRatio = matching.matches.length / Math.max(1, Math.min(previous.regions.length, current.regions.length));
    }

    const additionsByColor = colorCountIncreases(current.regions, maxColorCounts);
    const cameraAdditionCandidates = selectCountIncreaseRegions(matching.unmatchedCurrent, additionsByColor);

    // A coherent/global change gets its own camera epoch. Comparing two
    // different viewpoints as if they were a build delta is the main source of
    // false blocks in orbiting-camera videos.
    if (cameraMove) {
      epochId += 1;
      cameraMoves += 1;
      const candidateIds = new Set(cameraAdditionCandidates.map((region) => region.id));
      reassignKnownTracks(current.regions.filter((region) => !candidateIds.has(region.id)), currentTrackIds, activeByTrackId);
      epochOffset = estimateEpochOffset(current.regions, currentTrackIds, activeByTrackId);
      events.push({
        id: `camera-${events.length + 1}`,
        kind: 'camera',
        time: current.frame.time,
        beforeTime: previous.frame.time,
        afterTime: current.frame.time,
        epochId,
        confidence: clamp(0.58 + Math.min(0.34, visualDifference), 0.58, 0.94),
        label: 'Kamera dolaşımı · model adımı değişmedi',
      });
      if (cameraAdditionCandidates.length) {
        stepNumber += 1;
        const created = cameraAdditionCandidates.map((region) => createTemporalBlock({
          region,
          snapshot: current,
          trackId: nextTrackId++,
          stepNumber,
          epochId,
          epochOffset,
          blockTypes,
          options,
          confidencePenalty: 0.24,
        }));
        created.forEach((block) => {
          blocks.push(block);
          activeByTrackId.set(block.trackId, block);
          currentTrackIds.set(block.regionId, block.trackId);
        });
        updateMaxColorCounts(maxColorCounts, current.regions);
        events.push({
          ...addEvent(created, current, stepNumber, epochId, 'Kamera hareketi sırasında olası blok eklendi; doğrulama gerekli.', previous.frame.time),
          id: `ambiguous-${events.length + 1}`,
          kind: 'ambiguous',
        });
      }
      previous = current;
      previousTrackIds = currentTrackIds;
      continue;
    }

    const addedRegions = selectAddedRegions(
      current,
      previous,
      matching,
      additionsByColor,
      blockTypes,
      palette,
      options,
      alignment,
    );
    if (addedRegions.length) {
      stepNumber += 1;
      if (!epochOffset) epochOffset = initialEpochOffset(addedRegions);
      const matchOffset = estimateWorldOffset(current.regions, currentTrackIds, activeByTrackId);
      const placementOffset = matchOffset || epochOffset;
      const created = addedRegions.map((region) => createTemporalBlock({
        region,
        snapshot: current,
        trackId: nextTrackId++,
        stepNumber,
        epochId,
        epochOffset: placementOffset,
        blockTypes,
        options,
        confidencePenalty: epochId > 0 ? 0.08 : 0,
      }));
      created.forEach((block) => {
        blocks.push(block);
        activeByTrackId.set(block.trackId, block);
        currentTrackIds.set(block.regionId, block.trackId);
      });
      updateMaxColorCounts(maxColorCounts, current.regions);
      events.push(addEvent(created, current, stepNumber, epochId, '', previous.frame.time));
    } else if (visualDifference > options.cameraDifference && changedRatio > options.cameraChangedRatio) {
      events.push({
        id: `ambiguous-${events.length + 1}`,
        kind: 'ambiguous',
        time: current.frame.time,
        beforeTime: previous.frame.time,
        afterTime: current.frame.time,
        epochId,
        confidence: 0.42,
        label: 'Açıklanamayan kalıcı değişiklik · kullanıcı kontrolü gerekli',
      });
    }

    reassignKnownTracks(current.regions, currentTrackIds, activeByTrackId);
    previous = current;
    previousTrackIds = currentTrackIds;
  }

  const warnings = [];
  if (!blocks.length) warnings.push('Kalıcı bir blok ekleme adımı bulunamadı.');
  if (events[0]?.kind === 'add' && events[0].blocks?.length > 1) {
    warnings.push('İlk sabit kare boş değildi; başlangıçtaki blokların kendi içindeki yapım sırası bilinmiyor.');
  }
  if (cameraMoves) warnings.push(`${cameraMoves} kamera dolaşımı adımlardan ayrıldı; bu bölümler yeni blok sayılmadı.`);
  if (events.some((event) => event.kind === 'ambiguous')) warnings.push('Bazı değişiklikler blok veya kamera hareketi olarak kesin sınıflandırılamadı.');
  if (blocks.some((block) => block.epochId > 0 && block.confidence < 0.62)) {
    warnings.push('Kamera dolaşımından sonraki bazı blokların 3B ekseni belirsiz; bu satırlar aktarılmadan önce kontrol edilmelidir.');
  }
  warnings.push('Tek kamera görünüşünde derinlik ekseni kesin değildir; kamera dolaşımı veya final görünüş analiziyle kontrol edin.');

  return {
    blocks: blocks.map(stripTemporalInternals),
    events,
    pixelsPerUnit,
    stableSegments: stableSegments.map((segment, index) => ({
      ...segment,
      time: keyframes[index].time,
    })),
    diagnostics: {
      sampledFrames: frames.length,
      stableFrames: keyframes.length,
      cameraMoves,
      epochs: epochId + 1,
    },
    warnings,
  };
}

export function detectStableSegments(frames, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  if (!frames.length) return [];
  const described = frames[0].signature
    ? frames
    : frames.map((frame, index) => ({ ...frame, index, signature: makeFrameSignature(frame.imageData, options.gridWidth, options.gridHeight) }));
  const runs = [];
  let start = null;

  for (let index = 1; index < described.length; index += 1) {
    const difference = signatureDifference(described[index - 1].signature, described[index].signature);
    const peakDifference = signaturePeakDifference(
      described[index - 1].signature,
      described[index].signature,
      options.stablePeakFraction,
    );
    const pairStable = difference <= options.stableDifference && peakDifference <= options.stablePeakDifference;
    if (pairStable) {
      if (start === null) start = index - 1;
      const anchorAlignment = index - start >= options.minStableFrames
        ? estimateTranslationAlignment(described[start].signature, described[index].signature, 3, 3)
        : null;
      const cumulativeCameraMotion = anchorAlignment
        && Math.hypot(anchorAlignment.dx, anchorAlignment.dy) >= 1
        && anchorAlignment.gain >= 0.08;
      if (cumulativeCameraMotion) {
        if (index - start >= options.minStableFrames) runs.push({ startIndex: start, endIndex: index - 1 });
        start = index - 1;
      }
    } else if (start !== null) {
      if (index - start >= options.minStableFrames) runs.push({ startIndex: start, endIndex: index - 1 });
      start = null;
    }
  }
  if (start !== null && described.length - start >= options.minStableFrames) {
    runs.push({ startIndex: start, endIndex: described.length - 1 });
  }

  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous) {
      const previousSignature = described[previous.endIndex].signature;
      const currentSignature = described[run.endIndex].signature;
      if (
        signatureDifference(previousSignature, currentSignature) <= options.stableDifference * 0.72
        && signaturePeakDifference(previousSignature, currentSignature, options.stablePeakFraction) <= options.stablePeakDifference * 0.78
      ) {
        previous.endIndex = run.endIndex;
        continue;
      }
    }
    merged.push({ ...run });
  }
  return merged;
}

export function makeFrameSignature(imageData, gridWidth = 48, gridHeight = 32) {
  const output = new Float32Array(gridWidth * gridHeight * 4);
  const { data, width, height } = imageData;
  for (let gy = 0; gy < gridHeight; gy += 1) {
    const startY = Math.floor(gy * height / gridHeight);
    const endY = Math.max(startY + 1, Math.floor((gy + 1) * height / gridHeight));
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const target = (gy * gridWidth + gx) * 4;
      const startX = Math.floor(gx * width / gridWidth);
      const endX = Math.max(startX + 1, Math.floor((gx + 1) * width / gridWidth));
      let totalR = 0;
      let totalG = 0;
      let totalB = 0;
      let samples = 0;
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const source = (y * width + x) * 4;
          totalR += data[source];
          totalG += data[source + 1];
          totalB += data[source + 2];
          samples += 1;
        }
      }
      const r = totalR / Math.max(1, samples) / 255;
      const g = totalG / Math.max(1, samples) / 255;
      const b = totalB / Math.max(1, samples) / 255;
      const sum = Math.max(0.08, r + g + b);
      output[target] = r / sum;
      output[target + 1] = g / sum;
      output[target + 2] = b / sum;
      output[target + 3] = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 0.35;
    }
  }
  output.gridWidth = gridWidth;
  output.gridHeight = gridHeight;
  return output;
}

export function signatureDifference(first, second) {
  if (!first || !second || first.length !== second.length) return 1;
  let total = 0;
  for (let index = 0; index < first.length; index += 1) total += Math.abs(first[index] - second[index]);
  return total / first.length;
}

export function signaturePeakDifference(first, second, fraction = 0.012) {
  if (!first || !second || first.length !== second.length) return 1;
  const differences = [];
  for (let index = 0; index < first.length; index += 4) {
    let difference = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      difference += Math.abs(first[index + channel] - second[index + channel]);
    }
    differences.push(difference / 4);
  }
  differences.sort((a, b) => b - a);
  const count = Math.max(4, Math.ceil(differences.length * fraction));
  return differences.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

function analyzeSnapshot(frame, blockTypes, palette, options, pixelsPerUnit) {
  const guided = analyzeGuidedFrames([{ view: 'front', imageData: frame.imageData }], blockTypes, palette, {
    colorTolerance: options.colorTolerance,
    minComponentPixels: options.minComponentPixels,
    pixelsPerUnit,
    snap: options.snap,
  });
  const analysis = guided.frames.front;
  const scale = pixelsPerUnit || guided.pixelsPerUnit;
  const groundY = analysis?.regions.length
    ? Math.max(...analysis.regions.map((region) => region.bbox.y + region.bbox.height))
    : frame.imageData.height;
  const regions = (analysis?.regions || [])
    .filter((region) => region.faceLike && region.typeId)
    .map((region) => {
      const centerX = region.bbox.x + region.bbox.width / 2;
      const centerY = region.bbox.y + region.bbox.height / 2;
      return {
        ...region,
        coordinate: {
          x: (centerX - frame.imageData.width / 2) / scale,
          y: (groundY - centerY) / scale,
        },
      };
    });
  const paletteAnalysis = analyzeFramePixels(frame.imageData, palette, {
    colorTolerance: options.colorTolerance,
    minComponentPixels: Math.max(8, Math.floor(options.minComponentPixels / 2)),
  });
  return {
    frame,
    regions,
    labels: paletteAnalysis.labels,
    pixelsPerUnit: scale,
    width: frame.imageData.width,
    height: frame.imageData.height,
  };
}

function selectAddedRegions(current, previous, matching, additionsByColor, blockTypes, palette, options, alignment) {
  const selected = selectCountIncreaseRegions(matching.unmatchedCurrent, additionsByColor);
  if (selected.length) return selected;

  // A same-colour addition may have merged with a matched connected component,
  // leaving no unmatched item. Recover it from the persistent palette delta.
  const deltaImage = buildAddedPaletteImage(previous, current, alignment);
  const delta = analyzeGuidedFrames([{ view: 'front', imageData: deltaImage }], blockTypes, palette, {
    colorTolerance: options.colorTolerance,
    minComponentPixels: options.minComponentPixels,
    pixelsPerUnit: current.pixelsPerUnit,
    snap: options.snap,
  });
  const deltaRegions = delta.frames.front?.regions?.filter((region) => region.faceLike && region.typeId) || [];
  return deltaRegions.map((region) => {
    const centerX = region.bbox.x + region.bbox.width / 2;
    const centerY = region.bbox.y + region.bbox.height / 2;
    const groundY = current.regions.length
      ? Math.max(...current.regions.map((item) => item.bbox.y + item.bbox.height))
      : current.height;
    return {
      ...region,
      coordinate: {
        x: (centerX - current.width / 2) / current.pixelsPerUnit,
        y: (groundY - centerY) / current.pixelsPerUnit,
      },
    };
  });
}

function selectCountIncreaseRegions(unmatchedRegions, additionsByColor) {
  const unmatched = [...unmatchedRegions];
  const selected = [];
  for (const [color, count] of additionsByColor) {
    if (count <= 0) continue;
    const candidates = unmatched
      .filter((region) => region.color === color)
      .sort((a, b) => b.typeConfidence * b.area - a.typeConfidence * a.area);
    selected.push(...candidates.slice(0, count));
  }
  return selected;
}

function buildAddedPaletteImage(previous, current, alignment) {
  const output = new Uint8ClampedArray(current.frame.imageData.data.length);
  const source = current.frame.imageData.data;
  const dx = Math.round(alignment.dxPixels || 0);
  const dy = Math.round(alignment.dyPixels || 0);
  for (let y = 0; y < current.height; y += 1) {
    for (let x = 0; x < current.width; x += 1) {
      const currentIndex = y * current.width + x;
      const previousX = x - dx;
      const previousY = y - dy;
      const previousIndex = previousX >= 0 && previousX < previous.width && previousY >= 0 && previousY < previous.height
        ? previousY * previous.width + previousX
        : -1;
      const currentLabel = current.labels[currentIndex];
      const previousLabel = previousIndex >= 0 ? previous.labels[previousIndex] : -1;
      const target = currentIndex * 4;
      if (currentLabel >= 0 && currentLabel !== previousLabel) {
        output[target] = source[target];
        output[target + 1] = source[target + 1];
        output[target + 2] = source[target + 2];
        output[target + 3] = 255;
      } else {
        output[target] = 18;
        output[target + 1] = 21;
        output[target + 2] = 26;
        output[target + 3] = 255;
      }
    }
  }
  return { data: output, width: current.width, height: current.height };
}

function matchRegions(previous, current, alignment, previousTrackIds) {
  const shiftX = alignment.dxPixels / Math.max(1, alignment.pixelsPerUnit || 1);
  const shiftY = -alignment.dyPixels / Math.max(1, alignment.pixelsPerUnit || 1);
  const scale = alignment.scale || 1;
  const pairs = [];
  previous.forEach((previousRegion) => {
    current.forEach((currentRegion) => {
      if (previousRegion.color !== currentRegion.color) return;
      const typePenalty = previousRegion.typeId === currentRegion.typeId ? 0 : 0.42;
      const sizePenalty = Math.abs(Math.log(Math.max(0.1, currentRegion.area) / Math.max(0.1, previousRegion.area))) * 0.22;
      const distance = Math.hypot(
        currentRegion.coordinate.x - previousRegion.coordinate.x * scale - shiftX,
        currentRegion.coordinate.y - previousRegion.coordinate.y * scale - shiftY,
      );
      pairs.push({ previousRegion, currentRegion, cost: distance + typePenalty + sizePenalty });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost);
  const usedPrevious = new Set();
  const usedCurrent = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (pair.cost > 1.35 || usedPrevious.has(pair.previousRegion.id) || usedCurrent.has(pair.currentRegion.id)) continue;
    usedPrevious.add(pair.previousRegion.id);
    usedCurrent.add(pair.currentRegion.id);
    matches.push(pair);
  }
  return {
    matches,
    unmatchedPrevious: previous.filter((region) => !usedPrevious.has(region.id)),
    unmatchedCurrent: current.filter((region) => !usedCurrent.has(region.id)),
  };
}

function estimateSignatureAlignment(first, second) {
  const width = first.gridWidth || 48;
  const height = first.gridHeight || 32;
  const translation = estimateTranslationAlignment(first, second, 5, 4);
  const zero = translation.zeroScore;
  let bestTranslation = { score: translation.score, dx: translation.dx, dy: translation.dy, scale: 1 };
  let best = bestTranslation;
  const scales = [0.67, 0.75, 0.8, 0.88, 0.94, 1.06, 1.14, 1.25, 1.4, 1.5];
  for (const scale of scales) {
    for (let dy = bestTranslation.dy - 1; dy <= bestTranslation.dy + 1; dy += 1) {
      for (let dx = bestTranslation.dx - 1; dx <= bestTranslation.dx + 1; dx += 1) {
        const score = shiftedScaledSignatureDifference(first, second, dx, dy, scale, width, height);
        if (score < best.score) best = { score, dx, dy, scale };
      }
    }
  }
  return {
    zeroScore: zero,
    alignedScore: best.score,
    gain: zero > 0 ? (zero - best.score) / zero : 0,
    scaleGain: bestTranslation.score > 0 ? (bestTranslation.score - best.score) / bestTranslation.score : 0,
    scale: best.scale,
    dxCells: best.dx,
    dyCells: best.dy,
    // Pixel conversion depends on the source frame size and is attached by the
    // caller. Keeping cell offsets here makes this helper resolution agnostic.
    dxPixels: 0,
    dyPixels: 0,
  };
}

function estimateTranslationAlignment(first, second, maxDx, maxDy) {
  const width = first.gridWidth || 48;
  const height = first.gridHeight || 32;
  const zero = shiftedSignatureDifference(first, second, 0, 0, width, height);
  let best = { score: zero, dx: 0, dy: 0 };
  for (let dy = -maxDy; dy <= maxDy; dy += 1) {
    for (let dx = -maxDx; dx <= maxDx; dx += 1) {
      if (!dx && !dy) continue;
      const score = shiftedSignatureDifference(first, second, dx, dy, width, height);
      if (score < best.score) best = { score, dx, dy };
    }
  }
  return {
    ...best,
    zeroScore: zero,
    gain: zero > 0 ? (zero - best.score) / zero : 0,
  };
}

function shiftedScaledSignatureDifference(first, second, dx, dy, scale, width, height) {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const secondY = Math.round(centerY + (y - centerY) * scale + dy);
    if (secondY < 0 || secondY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const secondX = Math.round(centerX + (x - centerX) * scale + dx);
      if (secondX < 0 || secondX >= width) continue;
      const firstOffset = (y * width + x) * 4;
      const secondOffset = (secondY * width + secondX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        total += Math.abs(first[firstOffset + channel] - second[secondOffset + channel]);
        count += 1;
      }
    }
  }
  return count ? total / count : 1;
}

function shiftedSignatureDifference(first, second, dx, dy, width, height) {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const secondY = y + dy;
    if (secondY < 0 || secondY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const secondX = x + dx;
      if (secondX < 0 || secondX >= width) continue;
      const firstOffset = (y * width + x) * 4;
      const secondOffset = (secondY * width + secondX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        total += Math.abs(first[firstOffset + channel] - second[secondOffset + channel]);
        count += 1;
      }
    }
  }
  return count ? total / count : 1;
}

function isCameraMove(metrics, options) {
  if (!metrics.previous.regions.length && metrics.current.regions.length) return false;
  const shifted = Math.hypot(metrics.alignment.dxCells, metrics.alignment.dyCells) >= 1;
  if (Number.isFinite(cameraScaleFactor(metrics, options))) return true;
  if (shifted && metrics.alignment.gain >= options.cameraAlignmentGain && metrics.matchRatio >= 0.5) return true;
  return metrics.visualDifference >= options.cameraDifference
    && metrics.changedRatio >= options.cameraChangedRatio
    && metrics.matchRatio < 0.55;
}

function cameraScaleFactor(metrics, options) {
  const regionScales = metrics.matching.matches
    .map(({ previousRegion, currentRegion }) => {
      const widthScale = currentRegion.bbox.width / Math.max(1, previousRegion.bbox.width);
      const heightScale = currentRegion.bbox.height / Math.max(1, previousRegion.bbox.height);
      if (Math.abs(Math.log(widthScale / heightScale)) > 0.18) return null;
      return Math.sqrt(widthScale * heightScale);
    })
    .filter((value) => Number.isFinite(value));
  if (regionScales.length) {
    const regionScale = robustMedian(regionScales, 1);
    const coherent = regionScales.every((value) => Math.abs(Math.log(value / regionScale)) <= 0.14);
    if (coherent && Math.abs(Math.log(regionScale)) >= options.cameraScaleChange) return regionScale;
  }

  const alignmentScale = metrics.alignment.scale || 1;
  const zoomed = Math.abs(Math.log(alignmentScale)) >= options.cameraScaleChange;
  if (
    zoomed
    && metrics.alignment.scaleGain >= options.cameraScaleGain
    && metrics.matching.matches.length >= 2
  ) return alignmentScale;
  return null;
}

function signatureChangedRatio(first, second, threshold) {
  let changed = 0;
  let cells = 0;
  for (let index = 0; index < first.length; index += 4) {
    let difference = 0;
    for (let channel = 0; channel < 4; channel += 1) difference += Math.abs(first[index + channel] - second[index + channel]);
    if (difference / 4 > threshold) changed += 1;
    cells += 1;
  }
  return cells ? changed / cells : 0;
}

function colorCountIncreases(regions, maxima) {
  const counts = countByColor(regions);
  const increases = new Map();
  counts.forEach((count, color) => increases.set(color, Math.max(0, count - (maxima.get(color) || 0))));
  return increases;
}

function updateMaxColorCounts(maxima, regions) {
  countByColor(regions).forEach((count, color) => maxima.set(color, Math.max(count, maxima.get(color) || 0)));
}

function countByColor(regions) {
  const counts = new Map();
  regions.forEach((region) => counts.set(region.color, (counts.get(region.color) || 0) + 1));
  return counts;
}

function initialEpochOffset(regions) {
  if (!regions.length) return { x: 0, y: 0, scaleX: 1, scaleY: 1, confidence: 1 };
  return { x: -regions[0].coordinate.x, y: 0, scaleX: 1, scaleY: 1, confidence: 1 };
}

function estimateEpochOffset(regions, trackIds, activeByTrackId) {
  return estimateWorldOffset(regions, trackIds, activeByTrackId) || initialEpochOffset(regions);
}

function estimateWorldOffset(regions, trackIds, activeByTrackId) {
  const observations = [];
  regions.forEach((region) => {
    const block = activeByTrackId.get(trackIds.get(region.id));
    if (!block) return;
    observations.push({
      imageX: region.coordinate.x,
      imageY: region.coordinate.y,
      worldX: block.position.x,
      worldY: block.position.y,
    });
  });
  if (!observations.length) return null;
  const xFit = fitAxis(observations.map((item) => [item.imageX, item.worldX]), true);
  const yFit = fitAxis(observations.map((item) => [item.imageY, item.worldY]), false);
  const calibratedAxis = Math.sqrt(xFit.confidence * yFit.confidence);
  return {
    x: xFit.offset,
    y: yFit.offset,
    scaleX: xFit.scale,
    scaleY: yFit.scale,
    confidence: clamp(calibratedAxis + Math.min(0.12, observations.length * 0.03), 0.42, 0.92),
  };
}

function fitAxis(pairs, allowNegative) {
  const sources = pairs.map(([source]) => source);
  const targets = pairs.map(([, target]) => target);
  const sourceMean = sources.reduce((sum, value) => sum + value, 0) / sources.length;
  const targetMean = targets.reduce((sum, value) => sum + value, 0) / targets.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    covariance += (sources[index] - sourceMean) * (targets[index] - targetMean);
    variance += (sources[index] - sourceMean) ** 2;
  }
  let scale = 1;
  let confidence = 0.42;
  if (pairs.length >= 2 && variance >= 0.08) {
    const fitted = covariance / variance;
    const magnitude = clamp(Math.abs(fitted), 0.35, 2.8);
    scale = allowNegative && fitted < 0 ? -magnitude : magnitude;
    const residual = robustMedian(pairs.map(([source, target]) => Math.abs(target - (source * scale + targetMean - sourceMean * scale))), 1);
    confidence = clamp(0.9 - residual * 0.34, 0.5, 0.9);
  }
  const offsets = pairs.map(([source, target]) => target - source * scale);
  return { scale, offset: robustMedian(offsets, 0), confidence };
}

function reassignKnownTracks(regions, trackIds, activeByTrackId) {
  const used = new Set(trackIds.values());
  regions.forEach((region) => {
    if (trackIds.has(region.id)) return;
    const candidate = [...activeByTrackId.values()].find((block) => (
      !used.has(block.trackId) && block.color === region.color && block.typeId === region.typeId
    ));
    if (candidate) {
      trackIds.set(region.id, candidate.trackId);
      used.add(candidate.trackId);
    }
  });
}

function createTemporalBlock({ region, snapshot, trackId, stepNumber, epochId, epochOffset, blockTypes, options, confidencePenalty }) {
  const type = blockTypes.find((entry) => entry.id === region.typeId) || blockTypes[0];
  const halfHeight = type.height / 2;
  const rawX = region.coordinate.x * (epochOffset?.scaleX || 1) + (epochOffset?.x || 0);
  const rawY = region.coordinate.y * (epochOffset?.scaleY || 1) + (epochOffset?.y || 0);
  const bottom = Math.max(0, rawY - halfHeight);
  const transformPenalty = Math.max(0, 1 - (epochOffset?.confidence ?? 1)) * 0.16;
  let confidence = clamp(0.56 + region.typeConfidence * 0.22 + Math.min(0.1, region.area / Math.max(1, snapshot.pixelsPerUnit ** 2) * 0.04) - confidencePenalty - transformPenalty, 0.46, 0.78);
  if (epochId > 0 && (epochOffset?.confidence ?? 0) < 0.6) {
    confidence = Math.min(confidence, 0.59);
  }
  return {
    trackId,
    regionId: region.id,
    typeId: region.typeId,
    color: region.color,
    orientation: 'front',
    position: {
      x: snapValue(rawX, options.snap),
      y: snapValue(bottom, options.snap) + halfHeight,
      z: 0,
    },
    rotation: {
      x: 0,
      y: 0,
      z: region.profileKind?.includes('triangle') && region.profile.top > region.profile.bottom ? 180 : 0,
    },
    stepNumber,
    confidence,
    time: snapshot.frame.time,
    epochId,
    sourceView: 'build-video',
    bbox: { ...region.bbox },
  };
}

function addEvent(created, snapshot, stepNumber, epochId, note = '', beforeTime = snapshot.frame.time) {
  return {
    id: `add-${stepNumber}`,
    kind: 'add',
    stepNumber,
    time: snapshot.frame.time,
    beforeTime,
    afterTime: snapshot.frame.time,
    epochId,
    confidence: created.length ? Math.min(...created.map((block) => block.confidence)) : 0,
    blockTrackIds: created.map((block) => block.trackId),
    blocks: created.map(stripTemporalInternals),
    bbox: unionBoxes(created.map((block) => block.bbox)),
    label: note || `${created.length} blok eklendi`,
  };
}

function stripTemporalInternals(block) {
  const { regionId, bbox, ...clean } = block;
  return clean;
}

function unionBoxes(boxes) {
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function robustMedian(values, fallback) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function snapValue(value, step) {
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function emptyResult(warning) {
  return {
    blocks: [],
    events: [],
    stableSegments: [],
    diagnostics: { sampledFrames: 0, stableFrames: 0, cameraMoves: 0, epochs: 0 },
    warnings: [warning],
    pixelsPerUnit: 0,
  };
}
