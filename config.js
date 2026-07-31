export const THICKNESS = 0.16;
export const SNAP = 0.5;
export const LAYER_HEIGHT = 1.0;
export const MAX_UNDO = 80;

export const EQUILATERAL_HEIGHT = Math.sqrt(3) / 2;
export const LARGE_ISOSCELES_BASE = 1;
export const LARGE_ISOSCELES_SIDE = 2;
export const LARGE_ISOSCELES_HEIGHT = Math.sqrt(LARGE_ISOSCELES_SIDE ** 2 - (LARGE_ISOSCELES_BASE / 2) ** 2);

export const BLOCK_TYPES = [
  { id: 'square', label: 'Kare 1x1', icon: 'square', width: 1, height: 1 },
  { id: 'rectangle', label: 'Dikdörtgen 2x1', icon: 'rectangle', width: 2, height: 1 },
  { id: 'large-square', label: 'Büyük Kare 2x2', icon: 'large-square', width: 2, height: 2 },
  { id: 'window', label: 'Pencere', icon: 'window', width: 1, height: 1 },
  { id: 'triangle', label: 'Eşkenar Üçgen', icon: 'triangle', width: 1, height: EQUILATERAL_HEIGHT },
  { id: 'long-triangle', label: 'Büyük İkizkenar', icon: 'long-triangle', width: LARGE_ISOSCELES_BASE, height: LARGE_ISOSCELES_HEIGHT },
  { id: 'right-triangle', label: 'Sağ Üçgen', icon: 'right-triangle', width: 1, height: 1 },
  { id: 'semicircle', label: 'Yarım Daire', icon: 'semicircle', width: 2, height: 1 },
  { id: 'stairs', label: 'Basamak', icon: 'stairs', width: 1, height: 1, depth: 1 },
  { id: 'tunnel', label: 'Tünel', icon: 'tunnel', width: 1, height: 1, depth: 1 },
];

export const COLOR_BY_NAME = {
  blue: '#2196F3',
  red: '#F44336',
  yellow: '#FFEB3B',
  green: '#4CAF50',
  orange: '#FF9800',
  purple: '#9C27B0',
};

export const COLORS = Object.values(COLOR_BY_NAME);

export const COLOR_ALIASES = Object.fromEntries(
  Object.entries(COLOR_BY_NAME).flatMap(([name, color]) => [
    [name, color],
    [color.toLowerCase(), color],
  ])
);
