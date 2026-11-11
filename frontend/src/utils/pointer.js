import { surface } from './context.js';

export function isPalmTouch(event) {
  return event.pointerType === 'touch' && (event.width > 28 || event.height > 28);
}

export function getPoint(event) {
  // Tính từ phần canvas thực tế (không tính viền stage 2 px).
  const rect = surface.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pointerType === 'pen' && event.pressure > 0
      ? Math.max(0.08, Math.min(1, event.pressure))
      : 0.5
  };
}
