import { $, stage, state, setStatus } from '../utils/context.js';

const RULER_WIDTH = 480;
const RULER_HEIGHT = 56;
const HALF_LEN = RULER_WIDTH / 2;
const HALF_H = RULER_HEIGHT / 2;
const SNAP_CAPTURE_PX = 34;

const rulerState = {
  visible: false,
  cx: 420,
  cy: 300,
  angleDeg: 0,
  el: null,
  angleBadge: null,
};

function normalizeAngle(deg) {
  let a = ((deg % 360) + 540) % 360 - 180;
  if (a === -180) a = 180;
  return Math.round(a * 10) / 10;
}

function snapAngleDetent(rawDeg, shiftKey = false) {
  if (shiftKey) {
    return Math.round(rawDeg / 15) * 15;
  }
  const detents = [-180, -150, -135, -120, -90, -60, -45, -30, 0, 30, 45, 60, 90, 120, 135, 150, 180];
  for (const d of detents) {
    if (Math.abs(rawDeg - d) <= 2.2) return d === -180 ? 180 : d;
  }
  return Math.round(rawDeg);
}

function buildRulerTicksSvg() {
  const parts = [];
  const totalMm = Math.floor((RULER_WIDTH - 32) / 4);
  for (let i = 0; i <= totalMm; i += 1) {
    const x = 16 + i * 4;
    const isCm = i % 10 === 0;
    const isHalf = i % 5 === 0;
    const tickLen = isCm ? 11 : isHalf ? 7.5 : 4.5;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" />`);
    parts.push(`<line x1="${x}" y1="${RULER_HEIGHT}" x2="${x}" y2="${RULER_HEIGHT - tickLen}" />`);
    if (isCm && i / 10 <= 11) {
      parts.push(`<text x="${x}" y="21" text-anchor="middle">${i / 10}</text>`);
    }
  }
  return `<svg class="virtual-ruler-svg" viewBox="0 0 ${RULER_WIDTH} ${RULER_HEIGHT}" aria-hidden="true">${parts.join('')}</svg>`;
}

function clampRulerInsideStage() {
  if (!stage) return;
  const sw = stage.clientWidth || 800;
  const sh = stage.clientHeight || 600;
  rulerState.cx = Math.max(60, Math.min(sw - 60, rulerState.cx));
  rulerState.cy = Math.max(90, Math.min(sh - 60, rulerState.cy));
}

function renderRulerTransform() {
  if (!rulerState.el) return;
  clampRulerInsideStage();
  rulerState.el.style.left = `${rulerState.cx}px`;
  rulerState.el.style.top = `${rulerState.cy}px`;
  rulerState.el.style.transform = `translate(-50%, -50%) rotate(${rulerState.angleDeg}deg)`;
  if (rulerState.angleBadge) {
    rulerState.angleBadge.textContent = `${Math.round(rulerState.angleDeg)}°`;
  }
}

function syncRulerButtonState() {
  const btn = $('rulerTool');
  if (!btn) return;
  btn.classList.toggle('is-active', rulerState.visible);
  btn.setAttribute('aria-pressed', String(rulerState.visible));
}

export function isRulerActive() {
  return rulerState.visible;
}

export function toggleRuler(forceState = undefined) {
  if (state.ended) return false;
  if (!rulerState.el) setupRulerOverlay();
  if (!rulerState.el) return false;

  const next = typeof forceState === 'boolean' ? forceState : !rulerState.visible;
  if (next && !rulerState.visible && stage) {
    // Đặt thước ngay chính giữa vùng bảng đang nhìn thấy khi mới bật
    rulerState.cx = Math.round((stage.clientWidth || 800) / 2);
    rulerState.cy = Math.round(Math.max(180, (stage.clientHeight || 600) * 0.48));
  }
  rulerState.visible = next;
  rulerState.el.hidden = !next;
  syncRulerButtonState();
  if (next) {
    renderRulerTransform();
    setStatus('Đã bật Thước kẻ thẳng · Kéo thân thước để di chuyển, kéo ↻ để xoay, bấm ✕ hoặc phím R để tắt');
  } else {
    setStatus('Đã tắt Thước kẻ');
  }
  return next;
}

/**
 * Hút tọa độ nét bút / dạ quang thẳng dọc theo mép trên hoặc mép dưới của thước khi vẽ gần thước.
 */
export function snapPointToRuler(point, strokeSession) {
  if (!rulerState.visible || !point || !strokeSession) return point;

  const rad = (rulerState.angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const nx = -uy;
  const ny = ux;

  const dx = point.x - rulerState.cx;
  const dy = point.y - rulerState.cy;
  const along = dx * ux + dy * uy;
  const normal = dx * nx + dy * ny;

  if (strokeSession.rulerSnapEdge == null) {
    const withinLength = Math.abs(along) <= HALF_LEN + 28;
    const distTop = Math.abs(normal - -HALF_H);
    const distBottom = Math.abs(normal - HALF_H);
    const insideBody = Math.abs(normal) < HALF_H;

    if (withinLength && (insideBody || Math.min(distTop, distBottom) <= SNAP_CAPTURE_PX)) {
      strokeSession.rulerSnapEdge = distTop <= distBottom ? -(HALF_H + 2) : HALF_H + 2;
    } else {
      strokeSession.rulerSnapEdge = false;
    }
  }

  if (typeof strokeSession.rulerSnapEdge === 'number') {
    const clampedAlong = Math.max(-HALF_LEN, Math.min(HALF_LEN, along));
    return {
      ...point,
      x: rulerState.cx + ux * clampedAlong + nx * strokeSession.rulerSnapEdge,
      y: rulerState.cy + uy * clampedAlong + ny * strokeSession.rulerSnapEdge,
    };
  }

  return point;
}

export function setupRulerOverlay() {
  if (!stage || rulerState.el) return;

  const el = document.createElement('div');
  el.id = 'virtualRulerOverlay';
  el.className = 'virtual-ruler';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Thước kẻ thẳng thông minh');
  el.style.width = `${RULER_WIDTH}px`;
  el.style.height = `${RULER_HEIGHT}px`;

  el.innerHTML = `
    ${buildRulerTicksSvg()}
    <div class="virtual-ruler-controls">
      <button type="button" class="ruler-rotate-handle" data-ruler-rotate="left" title="Kéo để xoay góc thước (Giữ Shift xoay từng 15°)" aria-label="Xoay góc thước">↻</button>
      <button type="button" class="ruler-angle-pill" data-ruler-snap-angle="true" title="Bấm để chuyển nhanh góc 0° / 45° / 90°">0°</button>
      <span class="ruler-guide-text">Vẽ dọc mép thước để kẻ thẳng</span>
      <button type="button" class="ruler-rotate-handle" data-ruler-rotate="right" title="Kéo để xoay góc thước (Giữ Shift xoay từng 15°)" aria-label="Xoay góc thước">↻</button>
      <button type="button" class="ruler-close-btn" id="closeRulerBtn" title="Tắt thước kẻ (Phím R)" aria-label="Tắt thước kẻ">✕</button>
    </div>
  `;

  stage.appendChild(el);
  rulerState.el = el;
  rulerState.angleBadge = el.querySelector('.ruler-angle-pill');

  let dragMode = null; // 'move' | 'rotate'
  let activePointerId = null;
  let startOffsetX = 0;
  let startOffsetY = 0;
  let startPointerAngle = 0;
  let startRulerAngle = 0;

  const getStageCoords = (ev) => {
    const rect = stage.getBoundingClientRect();
    return {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    };
  };

  el.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('#closeRulerBtn') || ev.target.closest('[data-ruler-snap-angle]')) {
      return;
    }
    ev.preventDefault();
    const pt = getStageCoords(ev);
    activePointerId = ev.pointerId;
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      // Ignore unsupported pointer capture
    }

    if (ev.target.closest('[data-ruler-rotate]')) {
      dragMode = 'rotate';
      startPointerAngle = (Math.atan2(pt.y - rulerState.cy, pt.x - rulerState.cx) * 180) / Math.PI;
      startRulerAngle = rulerState.angleDeg;
    } else {
      dragMode = 'move';
      startOffsetX = pt.x - rulerState.cx;
      startOffsetY = pt.y - rulerState.cy;
    }
  });

  el.addEventListener('pointermove', (ev) => {
    if (!dragMode || ev.pointerId !== activePointerId) return;
    ev.stopPropagation();
    ev.preventDefault();
    const pt = getStageCoords(ev);
    if (dragMode === 'move') {
      rulerState.cx = pt.x - startOffsetX;
      rulerState.cy = pt.y - startOffsetY;
      renderRulerTransform();
    } else if (dragMode === 'rotate') {
      const currentAngle = (Math.atan2(pt.y - rulerState.cy, pt.x - rulerState.cx) * 180) / Math.PI;
      const rawNext = normalizeAngle(startRulerAngle + (currentAngle - startPointerAngle));
      rulerState.angleDeg = snapAngleDetent(rawNext, ev.shiftKey);
      renderRulerTransform();
    }
  });

  const endDrag = (ev) => {
    if (ev.pointerId !== activePointerId) return;
    dragMode = null;
    activePointerId = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener(
    'wheel',
    (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const step = ev.shiftKey ? 15 : 2;
      const dir = ev.deltaY > 0 ? 1 : -1;
      rulerState.angleDeg = normalizeAngle(rulerState.angleDeg + dir * step);
      renderRulerTransform();
    },
    { passive: false }
  );

  el.querySelector('[data-ruler-snap-angle]')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const cur = Math.round(rulerState.angleDeg);
    if (cur === 0) rulerState.angleDeg = 45;
    else if (cur === 45) rulerState.angleDeg = 90;
    else rulerState.angleDeg = 0;
    renderRulerTransform();
  });

  el.querySelector('#closeRulerBtn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleRuler(false);
  });

  $('rulerTool')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleRuler();
  });

  window.addEventListener('resize', () => {
    if (rulerState.visible) renderRulerTransform();
  });
}
