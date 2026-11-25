import { fabricCanvas, state } from './context.js';

let topFloatingZIndex = 90;

/**
 * Biến bất kỳ bảng công cụ nổi nào (Hình 3D, Phân tử 3D, Trắc nghiệm, Kết quả AI...)
 * thành cửa sổ kéo thả tự do mượt mà trên mặt bảng trắng (hỗ trợ Chuột, Bút Stylus và Cảm ứng).
 */
export function makePanelDraggable(panelEl, handleEl) {
  if (!panelEl || !handleEl || panelEl.dataset.draggableReady === 'true') return;
  panelEl.dataset.draggableReady = 'true';
  handleEl.classList.add('floating-drag-handle');

  let dragState = null;

  function clampPosition(left, top) {
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const pw = panelEl.offsetWidth || 320;
    const ph = panelEl.offsetHeight || 200;
    // Luôn giữ trọn bảng trong màn hình (cả chiều ngang lẫn chiều dọc) để nút đóng (✕) và đáy bảng không bị kéo văng ra ngoài
    const maxLeft = Math.max(8, vw - pw - 8);
    const minTop = 8;
    const maxTop = Math.max(minTop, vh - ph - 8);
    return {
      left: Math.round(Math.max(8, Math.min(left, maxLeft))),
      top: Math.round(Math.max(minTop, Math.min(top, maxTop))),
    };
  }

  panelEl.addEventListener('pointerdown', () => {
    topFloatingZIndex = Math.min(800, topFloatingZIndex + 1);
    panelEl.style.zIndex = String(topFloatingZIndex);
  });

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a, label')) return;

    const rect = panelEl.getBoundingClientRect();
    const parent = panelEl.offsetParent;
    const isFixed = getComputedStyle(panelEl).position === 'fixed';
    const parentRect = !isFixed && parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };

    const currentLeft = rect.left - parentRect.left;
    const currentTop = rect.top - parentRect.top;

    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    panelEl.style.margin = '0';
    panelEl.style.left = `${Math.round(currentLeft)}px`;
    panelEl.style.top = `${Math.round(currentTop)}px`;

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: currentLeft,
      originTop: currentTop,
      isFixed,
      parentRect,
    };

    panelEl.classList.add('is-dragging-panel');
    event.preventDefault();
    try {
      handleEl.setPointerCapture(event.pointerId);
    } catch {
      // Ignore if synthetic pointer event
    }
  });

  handleEl.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const rawScreenLeft = dragState.originLeft + dragState.parentRect.left + dx;
    const rawScreenTop = dragState.originTop + dragState.parentRect.top + dy;
    const clamped = clampPosition(rawScreenLeft, rawScreenTop);

    panelEl.style.left = `${clamped.left - Math.round(dragState.parentRect.left)}px`;
    panelEl.style.top = `${clamped.top - Math.round(dragState.parentRect.top)}px`;
  });

  const endDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState = null;
    panelEl.classList.remove('is-dragging-panel');
  };

  handleEl.addEventListener('pointerup', endDrag);
  handleEl.addEventListener('pointercancel', endDrag);
  handleEl.addEventListener('lostpointercapture', () => {
    dragState = null;
    panelEl.classList.remove('is-dragging-panel');
  });

  window.addEventListener('resize', () => {
    if (panelEl.hidden || !panelEl.style.left) return;
    const rect = panelEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const isFixed = getComputedStyle(panelEl).position === 'fixed';
    const parentRect = !isFixed && panelEl.offsetParent ? panelEl.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    const clamped = clampPosition(rect.left, rect.top);
    panelEl.style.left = `${clamped.left - Math.round(parentRect.left)}px`;
    panelEl.style.top = `${clamped.top - Math.round(parentRect.top)}px`;
  });
}

/**
 * Tìm vị trí (left, top) trong không gian World trên mặt bảng sao cho KHÔNG BAO GIỜ đè lên
 * đồ thị, công thức, ảnh hay câu hỏi đã có sẵn trên bảng.
 */
export function computeCleanBoardPlacement(blockWidth = 680, verticalGap = 40) {
  const vpt = fabricCanvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
  const z = vpt[0] || 1;
  const viewLeftWorld = (72 - vpt[4]) / z;
  const viewTopWorld = (138 - vpt[5]) / z;

  const targetLeft = Math.round(Math.max(56, viewLeftWorld));
  let targetTop = Math.round(Math.max(132, viewTopWorld));

  const objects = fabricCanvas ? fabricCanvas.getObjects() : [];
  let maxOverlappingBottom = -Infinity;

  for (const obj of objects) {
    if (!obj || obj.visible === false) continue;
    const b = obj.getBoundingRect?.();
    if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.height)) continue;
    const horizOverlap =
      b.left < targetLeft + blockWidth + 24 &&
      b.left + b.width > targetLeft - 24;
    if (horizOverlap) {
      maxOverlappingBottom = Math.max(maxOverlappingBottom, b.top + b.height);
    }
  }

  if (Number.isFinite(maxOverlappingBottom) && maxOverlappingBottom > -Infinity) {
    targetTop = Math.max(targetTop, Math.round(maxOverlappingBottom + verticalGap));
  }

  return { left: targetLeft, top: targetTop };
}

/**
 * Tự động dịch chuyển khung nhìn bảng vô hạn mượt mà để vùng nội dung mới chèn
 * luôn hiển thị rõ ràng ngay trước mắt người dùng (nếu bảng không bị khoá).
 */
export function panViewportToShowWorldRect(worldRect) {
  if (!fabricCanvas || !worldRect || state.boardLocked) return;
  const vpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  const z = vpt[0] || 1;
  const cw = fabricCanvas.getWidth() || window.innerWidth || 1280;
  const ch = fabricCanvas.getHeight() || window.innerHeight || 720;

  const screenTop = worldRect.top * z + vpt[5];
  const visibleHeight = Math.min(worldRect.height * z, ch - 210);
  const screenBottom = screenTop + visibleHeight;

  let changed = false;
  if (screenBottom > ch - 68 || screenTop < 126) {
    vpt[5] = Math.round(142 - worldRect.top * z);
    changed = true;
  }

  const screenLeft = worldRect.left * z + vpt[4];
  if (screenLeft < 40 || screenLeft + Math.min(worldRect.width * z, cw - 120) > cw - 24) {
    vpt[4] = Math.round(Math.max(48, (cw - Math.min(worldRect.width * z, cw - 120)) / 2) - worldRect.left * z);
    changed = true;
  }

  if (changed) {
    fabricCanvas.setViewportTransform(vpt);
    window.dispatchEvent(new CustomEvent('app:sync-viewport'));
  }
}
