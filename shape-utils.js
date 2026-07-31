import * as THREE from './vendor/three.module.min.js';

export function semicircleOutlinePoints(width, height, segments = 24) {
  const points = [[-width / 2, -height / 2], [width / 2, -height / 2]];
  for (let i = 1; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI;
    points.push([Math.cos(angle) * width / 2, -height / 2 + Math.sin(angle) * height]);
  }
  return points;
}

export function tunnelOuterPoints(width, height, segments = 28) {
  return semicircleOutlinePoints(width, height, segments);
}

export function tunnelHolePoints(width, height, segments = 24) {
  const innerWidth = width * 0.52;
  const baseY = -height / 2 + 0.08;
  const archHeight = height * 0.58;
  const points = [[innerWidth / 2, baseY], [-innerWidth / 2, baseY]];

  for (let i = 1; i < segments; i += 1) {
    const angle = Math.PI - (i / segments) * Math.PI;
    points.push([Math.cos(angle) * innerWidth / 2, baseY + Math.sin(angle) * archHeight]);
  }

  return points;
}

export function shapeOutlinePoints(type) {
  const w = type.width;
  const h = type.height;

  switch (type.id) {
    case 'triangle':
    case 'long-triangle':
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [0, h / 2]];
    case 'right-triangle':
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2]];
    case 'semicircle':
      return semicircleOutlinePoints(w, h);
    case 'stairs':
      return stairsOutlinePoints(w, h);
    case 'tunnel':
      return tunnelOuterPoints(w, h);
    default:
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }
}

function stairsOutlinePoints(width, height, steps = 4) {
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
  return points;
}

export function shapeEdgesForType(type) {
  const points = shapeOutlinePoints(type);
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const vector = new THREE.Vector2(next[0] - point[0], next[1] - point[1]);
    const length = vector.length();
    const normal = new THREE.Vector2(vector.y, -vector.x).normalize();

    return {
      id: `edge-${index}`,
      label: edgeLabel(type, index, normal),
      p1: new THREE.Vector2(point[0], point[1]),
      p2: new THREE.Vector2(next[0], next[1]),
      mid: new THREE.Vector2((point[0] + next[0]) / 2, (point[1] + next[1]) / 2),
      direction: vector.clone().normalize(),
      normal,
      length,
    };
  });
}

export function edgeLabel(type, index, normal) {
  if (type.id === 'triangle' || type.id === 'long-triangle') {
    return ['alt kenar', 'sağ eğik kenar', 'sol eğik kenar'][index] || `kenar ${index + 1}`;
  }
  if (type.id === 'right-triangle') {
    return ['alt kenar', 'eğik kenar', 'sol kenar'][index] || `kenar ${index + 1}`;
  }

  if (Math.abs(normal.x) > Math.abs(normal.y)) {
    return normal.x > 0 ? 'sağ kenar' : 'sol kenar';
  }
  return normal.y > 0 ? 'üst kenar' : 'alt kenar';
}
