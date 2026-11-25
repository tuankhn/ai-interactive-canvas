import { Path, Line, Triangle, Circle, Ellipse, Text, Group } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

export function getDashArrayForStyle(style, width = 4) {
  if (style === 'dashed') {
    return [Math.max(8, Math.round(width * 2.8)), Math.max(6, Math.round(width * 2))];
  }
  if (style === 'dotted') {
    return [Math.max(1.5, Math.round(width * 0.35)), Math.max(6, Math.round(width * 2.1))];
  }
  return null;
}

export function createCenterlinePathData(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${(p.x + 0.2).toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return `M ${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
}

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

export function previewShape(context, start, end, kind, fillStyle = 'transparent') {
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
  if (kind !== 'line' && kind !== 'areaEraser' && fillStyle && fillStyle !== 'transparent' && fillStyle !== 'rgba(0,0,0,0)') {
    context.save();
    context.fillStyle = fillStyle;
    context.fill();
    context.restore();
  }
  context.stroke();
  if (kind === 'areaEraser') {
    context.fillStyle = 'rgba(201, 100, 66, 0.10)';
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

function densifyPolyline(points, maxStep = 3.5) {
  if (!points || points.length <= 1) return points ? points.slice() : [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > maxStep) {
      const steps = Math.min(240, Math.ceil(dist / maxStep));
      const pA = a.pressure ?? 0.5;
      const pB = b.pressure ?? 0.5;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          pressure: pA + (pB - pA) * t,
        });
      }
    }
    out.push(b);
  }
  return out;
}

/**
 * Tẩy từng phần thực sự ("đưa đến đâu xoá đến đó"):
 * Cắt bỏ đúng đoạn điểm nằm trong vùng quét cục tẩy (prevPt -> currPt, bán kính eraseRadius)
 * và tách phần nét còn lại thành các đoạn Path độc lập mượt mà.
 */
export function splitObjectByEraserSweep(object, prevPt, currPt, eraseRadius) {
  if (!object) return null;
  const bbox = object.getBoundingRect();
  if (!bbox) return null;

  const a = prevPt || currPt;
  const b = currPt;
  const sweepLeft = Math.min(a.x, b.x) - eraseRadius - 4;
  const sweepTop = Math.min(a.y, b.y) - eraseRadius - 4;
  const sweepRight = Math.max(a.x, b.x) + eraseRadius + 4;
  const sweepBottom = Math.max(a.y, b.y) + eraseRadius + 4;

  if (
    bbox.left > sweepRight ||
    bbox.left + bbox.width < sweepLeft ||
    bbox.top > sweepBottom ||
    bbox.top + bbox.height < sweepTop
  ) {
    return null;
  }

  const isSplittable =
    Array.isArray(object._hitPoints) &&
    object._hitPoints.length >= 1 &&
    (object instanceof Path ||
      object instanceof Line ||
      object instanceof Triangle ||
      object instanceof Circle ||
      object instanceof Ellipse);

  if (!isSplittable) {
    return null;
  }

  const baseWidth = object._hitWidth || object.strokeWidth || 4;
  const hitThreshold = eraseRadius + baseWidth * 0.22;
  const stepSize = Math.max(2, Math.min(4.5, eraseRadius * 0.38));
  const dense = densifyPolyline(object._hitPoints, stepSize);

  let anyErased = false;
  const segments = [];
  let currentSeg = [];

  for (let i = 0; i < dense.length; i++) {
    const pt = dense[i];
    const d = distanceToSegment(pt, a, b);
    if (d <= hitThreshold) {
      anyErased = true;
      if (currentSeg.length > 0) {
        segments.push(currentSeg);
        currentSeg = [];
      }
    } else {
      currentSeg.push(pt);
    }
  }
  if (currentSeg.length > 0) {
    segments.push(currentSeg);
  }

  if (!anyErased) return null;

  const isStrokedOutline =
    Boolean(object.stroke) &&
    (!object.fill || object.fill === 'rgba(0,0,0,0)' || object.fill === 'transparent' || !(object instanceof Path));
  const strokeColor = isStrokedOutline ? object.stroke : object.fill;
  const dashArray = Array.isArray(object.strokeDashArray) ? object.strokeDashArray.slice() : null;
  const objOpacity = object.opacity ?? 1;
  const baseMeta = object.meta ? { ...object.meta } : { aiState: 'raw' };

  const replacements = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;
    if (seg.length === 1 && dense.length > 3) continue; // Bỏ mảnh vụn 1 điểm siêu nhỏ ở mép cắt
    let newPath = null;
    if (isStrokedOutline || dashArray) {
      const dStr = createCenterlinePathData(seg);
      if (!dStr) continue;
      newPath = new Path(dStr, {
        fill: 'rgba(0,0,0,0)',
        stroke: strokeColor,
        strokeWidth: baseWidth,
        strokeDashArray: dashArray,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        strokeUniform: true,
        opacity: objOpacity,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
    } else {
      const dStr = createPath(seg, baseWidth);
      if (!dStr) continue;
      newPath = new Path(dStr, {
        fill: strokeColor,
        opacity: objOpacity,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
    }
    newPath._hitPoints = seg;
    newPath._hitWidth = baseWidth;
    newPath.meta = { ...baseMeta };
    replacements.push(newPath);
  }

  return replacements;
}

export function makeShape(start, end, kind, color, width, extra = {}) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const fillVal =
    extra.fill && extra.fill !== 'transparent' && kind !== 'line'
      ? extra.fill
      : 'rgba(0,0,0,0)';
  const dashArray = getDashArrayForStyle(extra.strokeStyle || 'solid', width);
  const options = {
    fill: fillVal,
    stroke: color,
    strokeWidth: width,
    strokeDashArray: dashArray,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    opacity: Number.isFinite(extra.opacity) ? extra.opacity : 1,
    strokeUniform: true,
    selectable: false,
    evented: false,
    objectCaching: false,
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
    object.meta = { shapeKind: kind, strokeStyle: extra.strokeStyle || 'solid' };
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
