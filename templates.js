import { COLORS, THICKNESS } from './config.js?v=color-palette-1';

export function towerTemplate() {
  const x = 3;
  return [0, 1, 2, 3].map((level) => ({
    typeId: 'square',
    color: COLORS[level % COLORS.length],
    orientation: 'front',
    position: { x, y: level + 0.5, z: 0 },
  }));
}

export function gateTemplate() {
  return [
    { typeId: 'square', color: COLORS[0], orientation: 'front', position: { x: -3, y: 0.5, z: 0 } },
    { typeId: 'square', color: COLORS[0], orientation: 'front', position: { x: -3, y: 1.5, z: 0 } },
    { typeId: 'square', color: COLORS[0], orientation: 'front', position: { x: -1, y: 0.5, z: 0 } },
    { typeId: 'square', color: COLORS[0], orientation: 'front', position: { x: -1, y: 1.5, z: 0 } },
    { typeId: 'rectangle', color: COLORS[1], orientation: 'front', position: { x: -2, y: 2.5, z: 0 } },
  ];
}

export function pyramidRoofTemplate() {
  return [
    { typeId: 'triangle', color: COLORS[3], orientation: 'front', position: { x: -0.5, y: 2.5, z: 1.2 } },
    { typeId: 'triangle', color: COLORS[3], orientation: 'front', position: { x: 0.5, y: 2.5, z: 1.2 }, rotation: { x: 0, y: 0, z: 180 } },
    { typeId: 'right-triangle', color: COLORS[4], orientation: 'side', position: { x: 0, y: 2.5, z: 0.7 } },
    { typeId: 'right-triangle', color: COLORS[4], orientation: 'side', position: { x: 0, y: 2.5, z: 1.7 }, rotation: { x: 0, y: 0, z: 180 } },
  ];
}

export function diagonalTemplate() {
  return [0, 1, 2, 3].map((index) => ({
    typeId: 'right-triangle',
    color: COLORS[4],
    orientation: 'front',
    position: { x: 3 + index * 0.75, y: 0.5 + index * 0.55, z: -1.4 },
    rotation: { x: 0, y: 0, z: index % 2 ? 180 : 0 },
  }));
}

export function boxTemplate() {
  return [
    {
      typeId: 'square',
      color: COLORS[0],
      orientation: 'floor',
      position: { x: 0, y: THICKNESS / 2, z: 0 },
      stepNumber: 7,
    },
    {
      typeId: 'square',
      color: COLORS[0],
      orientation: 'front',
      position: { x: 0, y: 0.58, z: -0.5 },
      stepNumber: 13,
      attachment: { baseItemIndex: 0, baseEdgeId: 'edge-2', blockEdgeId: 'edge-0' },
    },
    {
      typeId: 'square',
      color: COLORS[0],
      orientation: 'front',
      position: { x: 0, y: 0.58, z: 0.5 },
      rotation: { x: 180, y: 0, z: 180 },
      stepNumber: 14,
      attachment: { baseItemIndex: 0, baseEdgeId: 'edge-0', blockEdgeId: 'edge-0' },
    },
    {
      typeId: 'square',
      color: COLORS[0],
      orientation: 'floor',
      position: { x: 0.5, y: 0.58, z: 0 },
      rotation: { x: 0, y: 270, z: 0 },
      stepNumber: 15,
      attachment: { baseItemIndex: 2, baseEdgeId: 'edge-3', blockEdgeId: 'edge-0' },
    },
    {
      typeId: 'square',
      color: COLORS[0],
      orientation: 'front',
      position: { x: -0.5, y: 0.58, z: 0 },
      rotation: { x: 90, y: 90, z: 0 },
      stepNumber: 16,
      attachment: { baseItemIndex: 1, baseEdgeId: 'edge-3', blockEdgeId: 'edge-0' },
    },
  ];
}
