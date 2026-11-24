import { surface, fabricCanvas } from './context.js';

export function isPalmTouch(event) {
  return event.pointerType === 'touch' && (event.width > 28 || event.height > 28);
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
