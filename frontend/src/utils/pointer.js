import { surface, fabricCanvas } from './context.js';

export function isPalmTouch(event) {
  if (event.pointerType !== 'touch') return false;
  const w = Number(event.width || 0);
  const h = Number(event.height || 0);
  // Ngón tay bình thường trên iPadOS Safari trả về 32–48px; lòng bàn tay thực sự > 64px
  return w > 64 || h > 64 || w * h > 3600;
}

export function getScreenPoint(event) {
  const rect = surface.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pointerType === 'pen' && event.pressure > 0
      ? Math.max(0.08, Math.min(1, event.pressure))
      : 0.5
  };
}

export function screenToWorld(sx, sy, pressure = 0.5) {
  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const zoom = vpt[0] || 1;
  return {
    x: (sx - vpt[4]) / zoom,
    y: (sy - vpt[5]) / zoom,
    screenX: sx,
    screenY: sy,
    pressure
  };
}

export function getPoint(event) {
  const sp = getScreenPoint(event);
  return screenToWorld(sp.x, sp.y, sp.pressure);
}
