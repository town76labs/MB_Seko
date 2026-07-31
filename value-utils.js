import * as THREE from './vendor/three.module.min.js';
import { COLOR_ALIASES, COLORS } from './config.js?v=color-palette-1';

export function orientationLabel(orientation) {
  return {
    floor: 'Yatay',
    front: 'Ön/Arka',
    side: 'Sağ/Sol',
    custom: 'Custom',
  }[orientation] || orientation;
}

export function placementModeLabel(mode) {
  return {
    horizontal: 'Yatay ekle',
    vertical: 'Dikey ekle',
    custom: 'Custom açı',
  }[mode] || mode;
}

export function pivotLabel(pivot) {
  return {
    'top-left': 'sol üst',
    top: 'üst',
    'top-right': 'sağ üst',
    left: 'sol',
    center: 'merkez',
    right: 'sağ',
    'bottom-left': 'sol alt',
    bottom: 'alt',
    'bottom-right': 'sağ alt',
  }[pivot] || pivot;
}

export function slugify(text) {
  return text
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'magneticblox-model';
}

export function roundVector(vector) {
  return {
    x: roundNumber(vector.x),
    y: roundNumber(vector.y),
    z: roundNumber(vector.z),
  };
}

export function roundNumber(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

export function niceNumber(value) {
  return Number.parseFloat(roundNumber(value).toFixed(3)).toString();
}

export function normalizeDegrees(value) {
  const normalized = roundNumber(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function normalizeColor(color) {
  if (!color) return COLORS[0];
  const normalized = String(color).trim().toLowerCase();
  const resolved = COLOR_ALIASES[normalized] || normalized;
  const hex = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(resolved)
    ? `#${resolved}`.toLowerCase()
    : resolved.toLowerCase();
  const palette = COLORS.map((item) => item.toLowerCase());
  if (palette.includes(hex)) return hex;

  return closestPaletteColor(hex);
}

function closestPaletteColor(color) {
  let source;
  try {
    source = new THREE.Color(color);
  } catch {
    return COLORS[0].toLowerCase();
  }

  let best = null;
  COLORS.forEach((paletteColor) => {
    const candidate = new THREE.Color(paletteColor);
    const distance = (source.r - candidate.r) ** 2
      + (source.g - candidate.g) ** 2
      + (source.b - candidate.b) ** 2;
    if (!best || distance < best.distance) {
      best = { color: paletteColor.toLowerCase(), distance };
    }
  });

  return best?.color || COLORS[0].toLowerCase();
}

export function edgeColor(color) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 0.8), Math.max(0.18, hsl.l * 0.45));
  return c;
}
