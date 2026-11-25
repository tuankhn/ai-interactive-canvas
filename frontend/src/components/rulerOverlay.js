import { $, stage, state, setStatus } from '../utils/context.js';

const RULER_HEIGHT = 54;
const HALF_H = RULER_HEIGHT / 2;
const SNAP_CAPTURE_PX = 36;

const rulerState = {
  visible: false,
  cx: 480,
  cy: 300,
  length: 1120,
  angleDeg: 0,
  el: null,
  svgWrap: null,
  angleBadge: null,
};

function computeIdealRulerLength(angleDeg = rulerState.angleDeg) {
  if (!stage) return 1120;
  const sw = stage.clientWidth || 1000;
  const sh = stage.clientHeight || 700;
  const rad = (Number(angleDeg) * Math.PI) / 180;
  // Thước nằm gần ngang -> dài theo chiều ngang màn hình; gần dọc -> dài theo chiều cao (chừa chỗ thanh trên / thanh dưới)
  const limit = Math.abs(Math.cos(rad)) >= 0.5 ? sw - 24 : sh - 150;
  return Math.max(220, Math.min(1800, Math.round(limit * 0.96)));
}

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

function buildRulerTicksSvg(rulerWidth) {
  const parts = [];
  const totalMm = Math.floor((rulerWidth - 32) / 4);
  for (let i = 0; i <= totalMm; i += 1) {
    const x = 16 + i * 4;
    const isCm = i % 10 === 0;
    const isHalf = i % 5 === 0;
    const tickLen = isCm ? 11 : isHalf ? 7.5 : 4.5;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" />`);
    parts.push(`<line x1="${x}" y1="${RULER_HEIGHT}" x2="${x}" y2="${RULER_HEIGHT - tickLen}" />`);
    if (isCm && x <= rulerWidth - 20) {
      parts.push(`<text x="${x}" y="21" text-anchor="middle">${i / 10}</text>`);
    }
  }
  return `<svg class="virtual-ruler-svg" viewBox="0 0 ${rulerWidth} ${RULER_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
}

function syncRulerDimensions() {
  if (!rulerState.el) return;
  const nextLen = computeIdealRulerLength();
  if (rulerState.length !== nextLen || !rulerState.svgWrap?.innerHTML) {
    rulerState.length = nextLen;
    rulerState.el.style.width = `${nextLen}px`;
    if (rulerState.svgWrap) {
      rulerState.svgWrap.innerHTML = buildRulerTicksSvg(nextLen);
    }
  }
}

function clampRulerInsideStage() {
  if (!stage) return;
  const sw = stage.clientWidth || 800;
  const sh = stage.clientHeight || 600;
  const rad = (rulerState.angleDeg * Math.PI) / 180;
  const len = rulerState.length || 1120;
  // Nửa kích thước hộp bao của thước sau khi xoay: giữ thước nằm gọn trong màn hình (không tràn trái / phải)
  const ex = (Math.abs(Math.cos(rad)) * len + Math.abs(Math.sin(rad)) * RULER_HEIGHT) / 2;
  const ey = (Math.abs(Math.sin(rad)) * len + Math.abs(Math.cos(rad)) * RULER_HEIGHT) / 2;
  const minX = Math.min(ex + 4, sw / 2);
  const maxX = Math.max(sw - ex - 4, sw / 2);
  const minY = Math.min(Math.max(70, ey + 4), sh / 2);
  const maxY = Math.max(sh - Math.max(40, ey) - 4, sh / 2);
  rulerState.cx = Math.max(minX, Math.min(maxX, rulerState.cx));
  rulerState.cy = Math.max(minY, Math.min(maxY, rulerState.cy));
}

function renderRulerTransform() {
  if (!rulerState.el) return;
  syncRulerDimensions();
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

  const halfLen = (rulerState.length || 1120) / 2;
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
    const withinLength = Math.abs(along) <= halfLen + 28;
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
    const clampedAlong = Math.max(-halfLen, Math.min(halfLen, along));
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

  rulerState.length = computeIdealRulerLength();
  const el = document.createElement('div');
  el.id = 'virtualRulerOverlay';
  el.className = 'virtual-ruler';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Thước kẻ thẳng thông minh xuyên màn hình');
  el.style.width = `${rulerState.length}px`;
  el.style.height = `${RULER_HEIGHT}px`;

  el.innerHTML = `
    <div class="virtual-ruler-svg-wrap">${buildRulerTicksSvg(rulerState.length)}</div>
    <div class="virtual-ruler-controls">
      <button type="button" class="ruler-rotate-handle" data-ruler-rotate="left" title="Kéo để xoay góc thước (Giữ Shift xoay từng 15°)" aria-label="Xoay góc thước">↻</button>
      <button type="button" class="ruler-angle-pill" data-ruler-snap-angle="cycle" title="Bấm đổi nhanh góc 0° / 45° / 90°">0°</button>
      <button type="button" class="ruler-orient-btn" data-ruler-set-angle="0" title="Đặt thước nằm ngang xuyên màn hình (0°)">Ngang</button>
      <button type="button" class="ruler-orient-btn" data-ruler-set-angle="90" title="Đặt thước thẳng đứng dọc màn hình (90°)">Dọc</button>
      <span class="ruler-guide-text">Kẻ dọc mép thước</span>
      <button type="button" class="ruler-rotate-handle" data-ruler-rotate="right" title="Kéo để xoay góc thước (Giữ Shift xoay từng 15°)" aria-label="Xoay góc thước">↻</button>
      <button type="button" class="ruler-close-btn" id="closeRulerBtn" title="Tắt thước kẻ (Phím R)" aria-label="Tắt thước kẻ">✕</button>
    </div>
  `;

  stage.appendChild(el);
  rulerState.el = el;
  rulerState.svgWrap = el.querySelector('.virtual-ruler-svg-wrap');
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
    if (
      ev.target.closest('#closeRulerBtn') ||
      ev.target.closest('[data-ruler-snap-angle]') ||
      ev.target.closest('[data-ruler-set-angle]')
    ) {
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

  el.querySelectorAll('[data-ruler-set-angle]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const targetDeg = Number(btn.dataset.rulerSetAngle || 0);
      rulerState.angleDeg = targetDeg;
      if (stage) {
        if (targetDeg === 0) {
          rulerState.cx = Math.round((stage.clientWidth || 800) / 2);
        } else if (targetDeg === 90) {
          rulerState.cy = Math.round((stage.clientHeight || 600) / 2);
        }
      }
      renderRulerTransform();
    });
  });

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
