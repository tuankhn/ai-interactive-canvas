import { Path, Line, Triangle, Circle, Ellipse, Text, Group } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

export function createPath(points, baseWidth) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    const r = Math.max(0.7, baseWidth * (0.25 + p.pressure * 0.75) / 2);
    return `M ${p.x + r} ${p.y} A ${r} ${r} 0 1 0 ${p.x - r} ${p.y} A ${r} ${r} 0 1 0 ${p.x + r} ${p.y} Z`;
  }
  const left = [], right = [];
  points.forEach((p, i) => {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const radius = Math.max(0.65, baseWidth * (0.25 + p.pressure * 0.75) / 2);
    left.push({ x: p.x - dy / length * radius, y: p.y + dx / length * radius });
    right.push({ x: p.x + dy / length * radius, y: p.y - dx / length * radius });
  });
  const outline = [...left, ...right.reverse()];
  return `M ${outline.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
}

export function drawRuler(context, start, end, color) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  context.save();
  context.translate(start.x, start.y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = 'rgba(250, 204, 21, 0.22)';
  context.fillRect(0, -12, length, 26);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeRect(0, -12, length, 26);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(length, 0);
  const count = Math.min(300, Math.floor(length / 10));
  for (let i = 0; i <= count; i++) {
    const x = i * 10;
    const tick = i % 5 === 0 ? 10 : 6;
    context.moveTo(x, -12);
    context.lineTo(x, -12 + tick);
  }
  context.stroke();
  context.font = '12px Arial';
  context.fillStyle = color;
  context.textAlign = 'center';
  context.fillText(`${Math.round(length)} px`, length / 2, -19);
  context.restore();
}

export function previewShape(context, start, end, kind) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  context.beginPath();
  if (kind === 'line') {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  } else if (kind === 'triangle') {
    context.moveTo(x + w / 2, y);
    context.lineTo(x + w, y + h);
    context.lineTo(x, y + h);
    context.closePath();
  } else if (kind === 'circle') {
    context.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else if (kind === 'ellipse') {
    context.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.1), Math.max(h / 2, 0.1), 0, 0, Math.PI * 2);
  } else if (kind === 'areaEraser') {
    context.rect(x, y, w, h);
  }
  context.stroke();
  if (kind === 'areaEraser') {
    context.fillStyle = 'rgba(239,68,68,.09)';
    context.fill();
  }
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function isNearObject(object, point, radius) {
  const bbox = object.getBoundingRect();
  if (point.x + radius < bbox.left || point.x - radius > bbox.left + bbox.width ||
      point.y + radius < bbox.top || point.y - radius > bbox.top + bbox.height) return false;
  const points = object._hitPoints;
  if (!points || points.length === 0) return true;
  const threshold = radius + (object._hitWidth || 1) / 2;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(point, points[i - 1], points[i]) <= threshold) return true;
  }
  return false;
}

export function intersects(a, b) {
  return a.left <= b.left + b.width && a.left + a.width >= b.left &&
    a.top <= b.top + b.height && a.top + a.height >= b.top;
}

function sampledEllipse(cx, cy, rx, ry) {
  return Array.from({ length: 49 }, (_, i) => {
    const theta = i / 48 * Math.PI * 2;
    return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
  });
}

export function makeShape(start, end, kind, color, width) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const options = {
    fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth: width,
    strokeUniform: true, selectable: false, evented: false, objectCaching: false
  };
  let object, hitPoints;
  if (kind === 'line') {
    object = new Line([start.x, start.y, end.x, end.y], options);
    hitPoints = [start, end];
  } else if (kind === 'triangle') {
    object = new Triangle({ ...options, left: x, top: y, width: Math.max(1, w), height: Math.max(1, h) });
    hitPoints = [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: x + w / 2, y }];
  } else if (kind === 'circle') {
    const radius = Math.max(0.5, Math.min(w, h) / 2);
    const cx = x + w / 2, cy = y + h / 2;
    object = new Circle({ ...options, left: cx - radius, top: cy - radius, radius });
    hitPoints = sampledEllipse(cx, cy, radius, radius);
  } else if (kind === 'ellipse') {
    const rx = Math.max(0.5, w / 2), ry = Math.max(0.5, h / 2);
    object = new Ellipse({ ...options, left: x, top: y, rx, ry });
    hitPoints = sampledEllipse(x + w / 2, y + h / 2, rx, ry);
  }
  if (object) {
    object._hitPoints = hitPoints;
    object._hitWidth = width;
  }
  return object;
}

export function makeRuler(start, end, color) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 3) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const coord = (along, normal) => ({
    x: start.x + ux * along + nx * normal,
    y: start.y + uy * along + ny * normal
  });
  const objects = [];
  const corners = [coord(0, -12), coord(length, -12), coord(length, 14), coord(0, 14)];
  const border = `M ${corners[0].x} ${corners[0].y} L ${corners[1].x} ${corners[1].y} L ${corners[2].x} ${corners[2].y} L ${corners[3].x} ${corners[3].y} Z`;
  objects.push(new Path(border, {
    fill: 'rgba(250,204,21,.22)', stroke: color, strokeWidth: 1,
    selectable: false, evented: false
  }));
  objects.push(new Line([start.x, start.y, end.x, end.y], { stroke: color, strokeWidth: 1 }));
  for (let i = 0; i <= Math.min(300, Math.floor(length / 10)); i++) {
    const x = i * 10;
    const tick = i % 5 === 0 ? 10 : 6;
    const a = coord(x, -12);
    const b = coord(x, -12 + tick);
    objects.push(new Line([a.x, a.y, b.x, b.y], { stroke: color, strokeWidth: 1 }));
  }
  const labelPos = coord(length / 2, -23);
  objects.push(new Text(`${Math.round(length)} px`, {
    left: labelPos.x, top: labelPos.y,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
    originX: 'center', originY: 'center',
    fontSize: 12, fill: color
  }));
  const group = new Group(objects, {
    selectable: false, evented: false, objectCaching: false, subTargetCheck: false
  });
  group._hitPoints = [start, end];
  group._hitWidth = 32;
  return group;
}
