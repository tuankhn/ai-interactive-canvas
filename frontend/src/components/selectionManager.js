import { FabricImage, Path, Text, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, fabricCanvas, state, setStatus, FONT_FAMILY_MAP } from '../utils/context.js';
import { getScreenPoint, screenToWorld } from '../utils/pointer.js';
import { isNearObject, intersects, getDashArrayForStyle } from '../utils/geometry.js';
import { snapshot, remember, updateHint } from './history.js';
import { closePanels } from './toolbar.js';
import { openDirectCanvasTextEditor } from './drawingCanvas.js';
import { removeObjectsWithCascade } from '../utils/cascadeDelete.js';
import { isStickyNoteObject, openStickyNoteEditor, updateStickyNoteStyle } from './boardMediaAndNotes.js';
import { getSafeAreaScreen, getBlockingPanelRects, rectsOverlap, clampRange } from '../utils/safeArea.js';

let selectedObjects = [];
let marqueeStartWorld = null;
let gesture = null;
let cropModeActive = false;
let lastClickInfo = { time: 0, x: 0, y: 0, obj: null };

let overlayRoot = null;
let marqueeEl = null;
let boxEl = null;
let actionBarEl = null;
let cropToggleBtn = null;
let editTextBtn = null;

function isTextObject(obj) {
  return obj instanceof Text || obj instanceof Textbox || typeof obj?.text === 'string';
}

function isEditableTextOrNote(obj) {
  return isTextObject(obj) || isStickyNoteObject(obj);
}

function openEditorForSelectedObject(obj) {
  if (!obj) return;
  if (isStickyNoteObject(obj)) {
    openStickyNoteEditor(obj);
  } else {
    openDirectCanvasTextEditor({ x: obj.left, y: obj.top }, obj);
  }
}

function normalizeDeg360(deg) {
  const n = Math.round(Number(deg) || 0) % 360;
  return n < 0 ? n + 360 : n;
}

function rotatePointAround(pt, center, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    ...pt,
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function isCroppableImage(obj) {
  return obj instanceof FabricImage;
}

function computeUnionWorldBounds(objs) {
  if (!objs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objs) {
    if (!obj || !fabricCanvas.getObjects().includes(obj)) continue;
    obj.setCoords?.();
    const b = obj.getBoundingRect();
    if (!b) continue;
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.left + b.width);
    maxY = Math.max(maxY, b.top + b.height);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    left: minX,
    top: minY,
    width: Math.max(8, maxX - minX),
    height: Math.max(8, maxY - minY),
  };
}

function worldRectToScreen(rect) {
  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const z = vpt[0] || 1;
  return {
    left: rect.left * z + vpt[4],
    top: rect.top * z + vpt[5],
    width: rect.width * z,
    height: rect.height * z,
  };
}

export function getSelectedObjects() {
  selectedObjects = selectedObjects.filter((o) => o && fabricCanvas.getObjects().includes(o));
  return selectedObjects.slice();
}

export function clearSelection({ silent = false } = {}) {
  selectedObjects = [];
  cropModeActive = false;
  syncSelectionOverlay();
  if (!silent) {
    window.dispatchEvent(new CustomEvent('app:selection-changed', { detail: { count: 0 } }));
  }
}

export function syncSelectionOverlay() {
  if (!boxEl) return;
  selectedObjects = selectedObjects.filter((o) => o && fabricCanvas.getObjects().includes(o));

  if (state.tool !== 'select' || selectedObjects.length === 0 || state.ended) {
    boxEl.hidden = true;
    boxEl.style.transform = 'none';
    if (actionBarEl) actionBarEl.hidden = true;
    return;
  }

  const worldBounds = computeUnionWorldBounds(selectedObjects);
  if (!worldBounds) {
    boxEl.hidden = true;
    boxEl.style.transform = 'none';
    if (actionBarEl) actionBarEl.hidden = true;
    return;
  }

  const pad = 6;
  const singleObj = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const singleAngle = singleObj ? Number(singleObj.angle || 0) : 0;

  let s;
  if (singleObj && !cropModeActive && Math.abs(singleAngle % 360) > 0.05) {
    const center = singleObj.getCenterPoint();
    const localW = Math.max(8, singleObj.getScaledWidth());
    const localH = Math.max(8, singleObj.getScaledHeight());
    s = worldRectToScreen({
      left: center.x - localW / 2,
      top: center.y - localH / 2,
      width: localW,
      height: localH,
    });
    boxEl.style.transformOrigin = 'center center';
    boxEl.style.transform = `rotate(${singleAngle}deg)`;
  } else {
    s = worldRectToScreen(worldBounds);
    boxEl.style.transform = 'none';
  }

  boxEl.hidden = false;
  boxEl.classList.toggle('is-crop-mode', cropModeActive);
  Object.assign(boxEl.style, {
    left: `${s.left - pad}px`,
    top: `${s.top - pad}px`,
    width: `${Math.max(16, s.width + pad * 2)}px`,
    height: `${Math.max(16, s.height + pad * 2)}px`,
  });

  if (actionBarEl) {
    const singleEditable = selectedObjects.length === 1 && isEditableTextOrNote(selectedObjects[0]);
    const singleImg = selectedObjects.length === 1 && isCroppableImage(selectedObjects[0]);
    if (editTextBtn) editTextBtn.hidden = !singleEditable;
    if (cropToggleBtn) {
      cropToggleBtn.hidden = !singleImg;
      cropToggleBtn.classList.toggle('is-active', cropModeActive);
      cropToggleBtn.setAttribute('aria-pressed', String(cropModeActive));
    }

    const unionScreen = worldRectToScreen(worldBounds);
    actionBarEl.hidden = false;

    const barW = actionBarEl.offsetWidth || 128;
    const barH = actionBarEl.offsetHeight || 34;
    const safe = getSafeAreaScreen(8);
    const blockers = getBlockingPanelRects(6);
    const boxCx = s.left + s.width / 2;
    const boxCy = s.top + s.height / 2;
    const boxHalfH = Math.max(8, s.height / 2 + pad);
    const activeDeg = singleObj && !cropModeActive ? singleAngle : 0;
    const rotRad = (activeDeg * Math.PI) / 180;
    const center = { x: boxCx, y: boxCy };
    const handleAbove = rotatePointAround({ x: boxCx, y: boxCy - boxHalfH - 30 }, center, rotRad);
    const handleBelow = rotatePointAround({ x: boxCx, y: boxCy + boxHalfH + 30 }, center, rotRad);

    const handleIsFree = (pt) =>
      pt.x - 14 >= safe.left &&
      pt.x + 14 <= safe.right &&
      pt.y - 14 >= safe.top &&
      pt.y + 14 <= safe.bottom &&
      !blockers.some((r) => rectsOverlap({ left: pt.x - 14, top: pt.y - 14, right: pt.x + 14, bottom: pt.y + 14 }, r));

    // Nút xoay ↻ mặc định nằm phía trên; nếu chìm sau thanh trên/toolbar hoặc ra ngoài mép màn hình thì lật xuống phía dưới khung chọn
    const rotateBelow = !cropModeActive && !handleIsFree(handleAbove) && handleIsFree(handleBelow);
    boxEl.classList.toggle('is-rotate-below', rotateBelow);

    const visualTop = Math.min(
      unionScreen.top - pad,
      cropModeActive || rotateBelow ? Infinity : handleAbove.y - 16,
    );
    const visualBottom = Math.max(
      unionScreen.top + unionScreen.height + pad,
      cropModeActive || !rotateBelow ? -Infinity : handleBelow.y + 16,
    );

    const gap = 12;
    const centeredLeft = Math.round(unionScreen.left + unionScreen.width / 2 - barW / 2);
    const barLeft = Math.round(clampRange(centeredLeft, safe.left, safe.right - barW));
    const candidates = rotateBelow
      ? [visualTop - barH - gap, visualBottom + gap, unionScreen.top + 10]
      : [visualBottom + gap, visualTop - barH - gap, unionScreen.top + 10];

    let barTop = null;
    for (const cTop of candidates) {
      const rect = { left: barLeft, top: cTop, right: barLeft + barW, bottom: cTop + barH };
      const inside = cTop >= safe.top && cTop + barH <= safe.bottom;
      if (inside && !blockers.some((r) => rectsOverlap(rect, r))) {
        barTop = cTop;
        break;
      }
    }
    if (barTop === null) {
      barTop = clampRange(candidates[0], safe.top, safe.bottom - barH);
    }

    Object.assign(actionBarEl.style, {
      left: `${barLeft}px`,
      top: `${Math.round(barTop)}px`,
    });
  }
}

function findTopObjectAtPoint(worldPt) {
  const objs = fabricCanvas.getObjects();
  const z = fabricCanvas.getZoom() || 1;
  const hitPad = 8 / z;
  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i];
    if (!obj || obj.visible === false) continue;
    const b = obj.getBoundingRect();
    if (!b) continue;
    if (
      worldPt.x < b.left - hitPad ||
      worldPt.x > b.left + b.width + hitPad ||
      worldPt.y < b.top - hitPad ||
      worldPt.y > b.top + b.height + hitPad
    ) {
      continue;
    }
    if (obj instanceof Path && Array.isArray(obj._hitPoints) && obj._hitPoints.length > 0) {
      if (isNearObject(obj, worldPt, Math.max(10 / z, (obj._hitWidth || 4) / 2))) {
        return obj;
      }
      continue;
    }
    return obj;
  }
  return null;
}

function translateObjectHitPoints(obj, dx, dy) {
  if (Array.isArray(obj._hitPoints)) {
    obj._hitPoints = obj._hitPoints.map((pt) => ({
      ...pt,
      x: pt.x + dx,
      y: pt.y + dy,
    }));
  }
}

function scaleObjectHitPoints(obj, anchorX, anchorY, sx, sy) {
  if (Array.isArray(obj._hitPoints)) {
    obj._hitPoints = obj._hitPoints.map((pt) => ({
      ...pt,
      x: anchorX + (pt.x - anchorX) * sx,
      y: anchorY + (pt.y - anchorY) * sy,
    }));
  }
}

export function deleteSelectedObjects() {
  const current = getSelectedObjects();
  if (!current.length || state.ended) return;
  const before = snapshot();
  removeObjectsWithCascade(current);
  clearSelection();
  fabricCanvas.requestRenderAll();
  remember(before);
  updateHint();
  setStatus(`Đã xóa ${current.length} đối tượng đã chọn`);
}

export function applyStyleToSelection(patch = {}) {
  const current = getSelectedObjects();
  if (!current.length) return false;
  const before = snapshot();

  for (const obj of current) {
    if (isStickyNoteObject(obj)) {
      updateStickyNoteStyle(obj, patch);
      continue;
    }
    if (patch.color) {
      if (isTextObject(obj)) {
        obj.set('fill', patch.color);
      } else if (obj instanceof Path && (!obj.stroke || obj.stroke === 'transparent')) {
        obj.set('fill', patch.color);
      } else if (obj.stroke) {
        obj.set('stroke', patch.color);
      }
    }
    if (patch.shapeFill !== undefined && !isTextObject(obj) && !(obj instanceof Path)) {
      obj.set('fill', patch.shapeFill === 'transparent' ? 'rgba(0,0,0,0)' : patch.shapeFill);
    }
    if (patch.width !== undefined && !isTextObject(obj)) {
      const w = Number(patch.width);
      if (obj.stroke) {
        obj.set('strokeWidth', w);
        if (obj.meta?.strokeStyle) {
          obj.set('strokeDashArray', getDashArrayForStyle(obj.meta.strokeStyle, w));
        }
      }
      obj._hitWidth = w;
    }
    if (patch.strokeStyle && obj.stroke) {
      const w = obj.strokeWidth || obj._hitWidth || 4;
      obj.set('strokeDashArray', getDashArrayForStyle(patch.strokeStyle, w));
      obj.meta = { ...(obj.meta || {}), strokeStyle: patch.strokeStyle };
    }
    if (patch.opacity !== undefined) {
      obj.set('opacity', Math.max(0.1, Math.min(1, Number(patch.opacity) / 100)));
    }
    if (patch.fontFamily && isTextObject(obj)) {
      const fam = FONT_FAMILY_MAP[patch.fontFamily] || FONT_FAMILY_MAP.sans;
      obj.set('fontFamily', fam);
      obj.meta = { ...(obj.meta || {}), fontKey: patch.fontFamily };
    }
    if (patch.fontSize && isTextObject(obj)) {
      obj.set('fontSize', Number(patch.fontSize));
    }
    if (patch.textAlign && isTextObject(obj)) {
      obj.set('textAlign', patch.textAlign);
    }
    obj.setCoords?.();
  }

  fabricCanvas.requestRenderAll();
  remember(before);
  syncSelectionOverlay();
  return true;
}

export function applyLayerActionToSelection(action) {
  const list = fabricCanvas.getObjects();
  const current = getSelectedObjects();
  const targets = current.length ? current : list.length ? [list[list.length - 1]] : [];
  if (!targets.length) return;
  const before = snapshot();

  for (const obj of targets) {
    const idx = list.indexOf(obj);
    if (idx === -1) continue;
    if (action === 'back') {
      fabricCanvas.sendObjectToBack?.(obj);
    } else if (action === 'front') {
      fabricCanvas.bringObjectToFront?.(obj);
    } else if (action === 'backward' && idx > 0) {
      fabricCanvas.sendObjectBackwards?.(obj);
    } else if (action === 'forward' && idx < list.length - 1) {
      fabricCanvas.bringObjectForward?.(obj);
    }
  }
  fabricCanvas.requestRenderAll();
  remember(before);
  setStatus('Đã cập nhật thứ tự lớp hiển thị');
}

function buildOverlayDOM() {
  if (overlayRoot) return;
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'selectionOverlayRoot';
  overlayRoot.className = 'selection-overlay-root';

  marqueeEl = document.createElement('div');
  marqueeEl.id = 'selectionMarquee';
  marqueeEl.className = 'selection-marquee';
  marqueeEl.hidden = true;

  boxEl = document.createElement('div');
  boxEl.id = 'selectionBoundingBox';
  boxEl.className = 'selection-bounding-box';
  boxEl.hidden = true;

  const rotStem = document.createElement('span');
  rotStem.className = 'sel-rotate-stem';
  rotStem.setAttribute('aria-hidden', 'true');

  const rotBtn = document.createElement('button');
  rotBtn.type = 'button';
  rotBtn.className = 'sel-rotate-handle';
  rotBtn.dataset.handle = 'rotate';
  rotBtn.title = 'Kéo xoay 360° (Giữ Shift để bắt góc 15°)';
  rotBtn.setAttribute('aria-label', 'Xoay đối tượng 360 độ');
  rotBtn.textContent = '↻';
  boxEl.append(rotStem, rotBtn);

  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((dir) => {
    const h = document.createElement('span');
    h.className = `sel-handle sel-${dir}`;
    h.dataset.handle = dir;
    boxEl.appendChild(h);
  });

  actionBarEl = document.createElement('div');
  actionBarEl.id = 'selectionActionBar';
  actionBarEl.className = 'selection-action-bar';
  actionBarEl.hidden = true;

  editTextBtn = document.createElement('button');
  editTextBtn.type = 'button';
  editTextBtn.className = 'sel-action-btn';
  editTextBtn.textContent = 'Sửa chữ';
  editTextBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const target = getSelectedObjects().find(isEditableTextOrNote);
    if (target) {
      clearSelection();
      openEditorForSelectedObject(target);
    }
  });

  cropToggleBtn = document.createElement('button');
  cropToggleBtn.type = 'button';
  cropToggleBtn.className = 'sel-action-btn';
  cropToggleBtn.textContent = 'Cắt khung (Crop)';
  cropToggleBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    cropModeActive = !cropModeActive;
    syncSelectionOverlay();
    setStatus(cropModeActive ? 'Kéo các cạnh khung xanh để cắt (crop) vùng ảnh' : 'Đã tắt chế độ cắt ảnh');
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'sel-action-btn sel-action-danger';
  delBtn.textContent = 'Xóa';
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    deleteSelectedObjects();
  });

  actionBarEl.append(editTextBtn, cropToggleBtn, delBtn);
  overlayRoot.append(marqueeEl, boxEl, actionBarEl);
  stage.appendChild(overlayRoot);
}

export function setupSelectionManager() {
  buildOverlayDOM();

  // Kéo di chuyển hoặc kéo 8 nút góc/cạnh trên khung chọn (#selectionBoundingBox)
  boxEl.addEventListener('pointerdown', (event) => {
    if (state.tool !== 'select' || state.ended || event.button !== 0) return;
    if (event.pointerType === 'touch' && !event.isPrimary) return;
    const current = getSelectedObjects();
    if (!current.length) return;
    event.preventDefault();
    event.stopPropagation();
    closePanels();

    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);
    const handle = event.target.closest('[data-handle]')?.dataset?.handle || null;

    // Kiểm tra nhấp đúp trên đối tượng chữ / Giấy Note đang chọn -> mở sửa chữ trực tiếp
    const now = performance.now();
    if (!handle && current.length === 1 && isEditableTextOrNote(current[0]) && now - lastClickInfo.time < 360) {
      const targetText = current[0];
      lastClickInfo = { time: 0, x: 0, y: 0, obj: null };
      clearSelection();
      openEditorForSelectedObject(targetText);
      return;
    }
    lastClickInfo = { time: now, x: wp.x, y: wp.y, obj: current[0] };

    const initBounds = computeUnionWorldBounds(current);
    if (!initBounds) return;

    const unionCenter =
      current.length === 1
        ? current[0].getCenterPoint()
        : { x: initBounds.left + initBounds.width / 2, y: initBounds.top + initBounds.height / 2 };

    const gestureMode =
      handle === 'rotate'
        ? 'rotate'
        : handle
          ? cropModeActive && current.length === 1 && isCroppableImage(current[0])
            ? 'crop'
            : 'resize'
          : 'move';

    gesture = {
      pointerId: event.pointerId,
      source: 'box',
      mode: gestureMode,
      handle,
      startWorld: wp,
      lastWorld: wp,
      unionCenter,
      startPointerRad: Math.atan2(wp.y - unionCenter.y, wp.x - unionCenter.x),
      initBounds,
      before: snapshot(),
      changed: false,
      items: current.map((obj) => ({
        obj,
        left: obj.left || 0,
        top: obj.top || 0,
        angle: Number(obj.angle || 0),
        center: obj.getCenterPoint(),
        scaledW: Math.max(8, obj.getScaledWidth()),
        scaledH: Math.max(8, obj.getScaledHeight()),
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        fontSize: obj.fontSize || 24,
        cropX: obj.cropX || 0,
        cropY: obj.cropY || 0,
        width: obj.width || 100,
        height: obj.height || 100,
        hitPoints: Array.isArray(obj._hitPoints) ? obj._hitPoints.map((p) => ({ ...p })) : null,
      })),
    };
    if (event.pointerType !== 'touch') {
      try { boxEl.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.source !== 'box' || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);

    if (gesture.mode === 'rotate') {
      const curRad = Math.atan2(wp.y - gesture.unionCenter.y, wp.x - gesture.unionCenter.x);
      const rawDeltaDeg = ((curRad - gesture.startPointerRad) * 180) / Math.PI;
      gesture.changed = true;

      if (gesture.items.length === 1) {
        const it = gesture.items[0];
        const rawNext = it.angle + rawDeltaDeg;
        const nextAngle = event.shiftKey ? Math.round(rawNext / 15) * 15 : Math.round(rawNext);
        const appliedRad = ((nextAngle - it.angle) * Math.PI) / 180;
        it.obj.rotate(nextAngle);
        it.obj.setPositionByOrigin(it.center, 'center', 'center');
        if (it.hitPoints) {
          it.obj._hitPoints = it.hitPoints.map((pt) => rotatePointAround(pt, it.center, appliedRad));
        }
        it.obj.setCoords?.();
        const normDeg = normalizeDeg360(nextAngle);
        setStatus(`Đang xoay: ${normDeg}° (Giữ Shift để bắt góc 15°)`);
      } else {
        const snappedDelta = event.shiftKey ? Math.round(rawDeltaDeg / 15) * 15 : Math.round(rawDeltaDeg);
        const dRad = (snappedDelta * Math.PI) / 180;
        for (const it of gesture.items) {
          const nextC = rotatePointAround(it.center, gesture.unionCenter, dRad);
          it.obj.rotate(it.angle + snappedDelta);
          it.obj.setPositionByOrigin(nextC, 'center', 'center');
          if (it.hitPoints) {
            it.obj._hitPoints = it.hitPoints.map((pt) => rotatePointAround(pt, gesture.unionCenter, dRad));
          }
          it.obj.setCoords?.();
        }
        const normDeg = normalizeDeg360(snappedDelta);
        setStatus(`Đang xoay nhóm: ${normDeg}°`);
      }

      fabricCanvas.requestRenderAll();
      syncSelectionOverlay();
      return;
    }

    if (gesture.mode === 'move') {
      const totalDx = wp.x - gesture.startWorld.x;
      const totalDy = wp.y - gesture.startWorld.y;
      if (!gesture.changed && Math.hypot(totalDx, totalDy) < 0.3) return;
      gesture.lastWorld = wp;
      gesture.changed = true;
      for (const item of gesture.items) {
        item.obj.set({
          left: item.left + totalDx,
          top: item.top + totalDy,
        });
        if (item.hitPoints) {
          item.obj._hitPoints = item.hitPoints.map((pt) => ({
            ...pt,
            x: pt.x + totalDx,
            y: pt.y + totalDy,
          }));
        }
        item.obj.setCoords?.();
      }
      fabricCanvas.requestRenderAll();
      syncSelectionOverlay();
      return;
    }

    const b = gesture.initBounds;
    const h = gesture.handle || 'se';

    // Co giãn chính xác theo hệ toạ độ xoay cục bộ khi chọn 1 đối tượng đã xoay góc != 0°
    if (
      gesture.mode === 'resize' &&
      gesture.items.length === 1 &&
      Math.abs(gesture.items[0].angle % 360) > 0.05
    ) {
      const it = gesture.items[0];
      const rad = (it.angle * Math.PI) / 180;
      const localPt = rotatePointAround(wp, it.center, -rad);
      const origLeft = it.center.x - it.scaledW / 2;
      const origTop = it.center.y - it.scaledH / 2;
      let lLeft = origLeft;
      let lRight = it.center.x + it.scaledW / 2;
      let lTop = origTop;
      let lBottom = it.center.y + it.scaledH / 2;

      if (h.includes('w')) lLeft = Math.min(lRight - 16, localPt.x);
      if (h.includes('e')) lRight = Math.max(lLeft + 16, localPt.x);
      if (h.includes('n')) lTop = Math.min(lBottom - 16, localPt.y);
      if (h.includes('s')) lBottom = Math.max(lTop + 16, localPt.y);

      const nextLocalW = Math.max(16, lRight - lLeft);
      const nextLocalH = Math.max(16, lBottom - lTop);
      const ratioX = nextLocalW / Math.max(1, it.scaledW);
      const ratioY = nextLocalH / Math.max(1, it.scaledH);
      const localNewCenter = { x: (lLeft + lRight) / 2, y: (lTop + lBottom) / 2 };
      const worldNewCenter = rotatePointAround(localNewCenter, it.center, rad);

      if (isTextObject(it.obj)) {
        const uniformRatio = Math.max(0.35, (ratioX + ratioY) / 2);
        it.obj.set({ fontSize: Math.max(11, Math.round(it.fontSize * uniformRatio)) });
      } else {
        it.obj.set({
          scaleX: it.scaleX * ratioX,
          scaleY: it.scaleY * ratioY,
        });
      }
      it.obj.setPositionByOrigin(worldNewCenter, 'center', 'center');
      if (it.hitPoints) {
        it.obj._hitPoints = it.hitPoints.map((pt) => {
          const unrot = rotatePointAround(pt, it.center, -rad);
          const scaled = {
            ...pt,
            x: lLeft + ((unrot.x - origLeft) / Math.max(1, it.scaledW)) * nextLocalW,
            y: lTop + ((unrot.y - origTop) / Math.max(1, it.scaledH)) * nextLocalH,
          };
          return rotatePointAround(scaled, it.center, rad);
        });
      }
      it.obj.setCoords?.();
      gesture.changed = true;
      fabricCanvas.requestRenderAll();
      syncSelectionOverlay();
      return;
    }

    let newLeft = b.left;
    let newTop = b.top;
    let newRight = b.left + b.width;
    let newBottom = b.top + b.height;

    if (h.includes('w')) newLeft = Math.min(newRight - 16, wp.x);
    if (h.includes('e')) newRight = Math.max(newLeft + 16, wp.x);
    if (h.includes('n')) newTop = Math.min(newBottom - 16, wp.y);
    if (h.includes('s')) newBottom = Math.max(newTop + 16, wp.y);

    const newW = Math.max(16, newRight - newLeft);
    const newH = Math.max(16, newBottom - newTop);

    if (gesture.mode === 'crop' && gesture.items.length === 1) {
      const it = gesture.items[0];
      const img = it.obj;
      const sx = it.scaleX || 1;
      const sy = it.scaleY || 1;
      const deltaLeft = (newLeft - b.left) / sx;
      const deltaTop = (newTop - b.top) / sy;
      const nextCropX = Math.max(0, it.cropX + deltaLeft);
      const nextCropY = Math.max(0, it.cropY + deltaTop);
      const natW = img.getElement?.()?.naturalWidth || it.width + it.cropX;
      const natH = img.getElement?.()?.naturalHeight || it.height + it.cropY;
      const nextW = Math.max(20, Math.min(natW - nextCropX, newW / sx));
      const nextH = Math.max(20, Math.min(natH - nextCropY, newH / sy));

      img.set({
        left: newLeft,
        top: newTop,
        cropX: nextCropX,
        cropY: nextCropY,
        width: nextW,
        height: nextH,
      });
      img.setCoords?.();
      gesture.changed = true;
      fabricCanvas.requestRenderAll();
      syncSelectionOverlay();
      return;
    }

    // Co giãn (Resize) toàn bộ vùng chọn
    const ratioX = newW / Math.max(1, b.width);
    const ratioY = newH / Math.max(1, b.height);
    gesture.changed = true;

    for (const it of gesture.items) {
      const relX = (it.left - b.left) / Math.max(1, b.width);
      const relY = (it.top - b.top) / Math.max(1, b.height);
      const targetLeft = newLeft + relX * newW;
      const targetTop = newTop + relY * newH;

      if (isTextObject(it.obj)) {
        const uniformRatio = Math.max(0.35, (ratioX + ratioY) / 2);
        it.obj.set({
          left: targetLeft,
          top: targetTop,
          fontSize: Math.max(11, Math.round(it.fontSize * uniformRatio)),
        });
      } else {
        it.obj.set({
          left: targetLeft,
          top: targetTop,
          scaleX: it.scaleX * ratioX,
          scaleY: it.scaleY * ratioY,
        });
      }
      if (it.hitPoints) {
        it.obj._hitPoints = it.hitPoints.map((pt) => ({
          ...pt,
          x: newLeft + ((pt.x - b.left) / Math.max(1, b.width)) * newW,
          y: newTop + ((pt.y - b.top) / Math.max(1, b.height)) * newH,
        }));
      }
      it.obj.setCoords?.();
    }
    fabricCanvas.requestRenderAll();
    syncSelectionOverlay();
  });

  const endBoxGesture = (event) => {
    if (!gesture || gesture.source !== 'box' || event.pointerId !== gesture.pointerId) return;
    if (gesture.changed) {
      remember(gesture.before);
      setStatus(
        gesture.mode === 'crop'
          ? 'Đã cắt (crop) vùng chọn'
          : gesture.mode === 'rotate'
            ? 'Đã cập nhật góc xoay đối tượng'
            : 'Đã cập nhật vị trí / kích thước vùng chọn',
      );
    }
    gesture = null;
    syncSelectionOverlay();
  };
  window.addEventListener('pointerup', endBoxGesture);
  window.addEventListener('pointercancel', endBoxGesture);

  // Khoanh vùng trỏ chuột (Marquee Selection) hoặc Click chọn trên mặt bảng
  let marqueePointerId = null;

  // Hủy ngay thao tác kéo/khoanh 1 ngón khi người dùng đặt ngón thứ 2 để chụm thu phóng (pinch-zoom)
  window.addEventListener('app:pinch-start', () => {
    if (gesture && gesture.changed && gesture.before) {
      restore(gesture.before);
    }
    gesture = null;
    marqueePointerId = null;
    marqueeStartWorld = null;
    if (marqueeEl) marqueeEl.hidden = true;
    syncSelectionOverlay();
  });

  surface.addEventListener('pointerdown', (event) => {
    if (state.tool !== 'select' || state.ended || state.pageBusy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && !event.isPrimary) return;
    if (stage.classList.contains('is-panning') || stage.classList.contains('is-panning-active')) return;

    event.preventDefault();
    closePanels();
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);
    const hitObj = findTopObjectAtPoint(wp);
    const now = performance.now();

    if (hitObj) {
      // Nhấp đúp vào đối tượng chữ / Giấy Note -> mở sửa chữ trực tiếp
      if (isEditableTextOrNote(hitObj) && lastClickInfo.obj === hitObj && now - lastClickInfo.time < 360) {
        lastClickInfo = { time: 0, x: 0, y: 0, obj: null };
        clearSelection();
        openEditorForSelectedObject(hitObj);
        return;
      }
      lastClickInfo = { time: now, x: wp.x, y: wp.y, obj: hitObj };

      if (event.shiftKey) {
        if (selectedObjects.includes(hitObj)) {
          selectedObjects = selectedObjects.filter((o) => o !== hitObj);
        } else {
          selectedObjects.push(hitObj);
        }
      } else {
        selectedObjects = [hitObj];
      }
      cropModeActive = false;
      syncSelectionOverlay();
      window.dispatchEvent(new CustomEvent('app:selection-changed', { detail: { count: selectedObjects.length } }));

      // Cho phép nhấp và kéo di chuyển ngay trong 1 thao tác mượt mà
      const initBounds = computeUnionWorldBounds(selectedObjects);
      if (initBounds) {
        gesture = {
          pointerId: event.pointerId,
          source: 'surface',
          mode: 'move',
          handle: null,
          startWorld: wp,
          lastWorld: wp,
          initBounds,
          before: snapshot(),
          changed: false,
          items: selectedObjects.map((obj) => ({
            obj,
            left: obj.left || 0,
            top: obj.top || 0,
            hitPoints: Array.isArray(obj._hitPoints) ? obj._hitPoints.map((p) => ({ ...p })) : null,
          })),
        };
        marqueePointerId = event.pointerId;
        if (event.pointerType !== 'touch') {
          try { surface.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        }
      }
      return;
    }

    // Nhấp đúp vào vùng trống khi đang ở công cụ Chọn (V) -> gõ chữ trực tiếp giống Excalidraw!
    if (!lastClickInfo.obj && now - lastClickInfo.time < 340 && Math.hypot(wp.x - lastClickInfo.x, wp.y - lastClickInfo.y) < 14) {
      lastClickInfo = { time: 0, x: 0, y: 0, obj: null };
      clearSelection();
      openDirectCanvasTextEditor(wp, null);
      return;
    }
    lastClickInfo = { time: now, x: wp.x, y: wp.y, obj: null };

    clearSelection();
    marqueePointerId = event.pointerId;
    marqueeStartWorld = wp;
    marqueeEl.hidden = false;
    Object.assign(marqueeEl.style, {
      left: `${sp.x}px`,
      top: `${sp.y}px`,
      width: '0px',
      height: '0px',
    });
    if (event.pointerType !== 'touch') {
      try { surface.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (state.tool !== 'select' || event.pointerId !== marqueePointerId) return;
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);

    if (gesture && gesture.mode === 'move') {
      const totalDx = wp.x - gesture.startWorld.x;
      const totalDy = wp.y - gesture.startWorld.y;
      if (!gesture.changed && Math.hypot(totalDx, totalDy) < 0.3) return;
      gesture.lastWorld = wp;
      gesture.changed = true;
      for (const it of gesture.items) {
        it.obj.set({
          left: it.left + totalDx,
          top: it.top + totalDy,
        });
        if (it.hitPoints) {
          it.obj._hitPoints = it.hitPoints.map((pt) => ({
            ...pt,
            x: pt.x + totalDx,
            y: pt.y + totalDy,
          }));
        }
        it.obj.setCoords?.();
      }
      fabricCanvas.requestRenderAll();
      syncSelectionOverlay();
      return;
    }

    if (!marqueeStartWorld) return;
    const sStart = worldRectToScreen({
      left: Math.min(marqueeStartWorld.x, wp.x),
      top: Math.min(marqueeStartWorld.y, wp.y),
      width: Math.abs(wp.x - marqueeStartWorld.x),
      height: Math.abs(wp.y - marqueeStartWorld.y),
    });
    Object.assign(marqueeEl.style, {
      left: `${sStart.left}px`,
      top: `${sStart.top}px`,
      width: `${sStart.width}px`,
      height: `${sStart.height}px`,
    });
  });

  const finishSurfaceSelection = (event) => {
    if (event.pointerId !== marqueePointerId) return;
    marqueePointerId = null;

    if (gesture) {
      if (gesture.changed) {
        remember(gesture.before);
        setStatus('Đã di chuyển đối tượng');
      }
      gesture = null;
      syncSelectionOverlay();
      return;
    }

    if (!marqueeStartWorld) return;
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);
    const box = {
      left: Math.min(marqueeStartWorld.x, wp.x),
      top: Math.min(marqueeStartWorld.y, wp.y),
      width: Math.abs(wp.x - marqueeStartWorld.x),
      height: Math.abs(wp.y - marqueeStartWorld.y),
    };
    marqueeStartWorld = null;
    marqueeEl.hidden = true;

    if (box.width < 4 && box.height < 4) return;

    selectedObjects = fabricCanvas.getObjects().filter((obj) => {
      if (!obj || obj.visible === false) return false;
      const b = obj.getBoundingRect();
      return b && intersects(b, box);
    });
    cropModeActive = false;
    syncSelectionOverlay();
    window.dispatchEvent(new CustomEvent('app:selection-changed', { detail: { count: selectedObjects.length } }));
    if (selectedObjects.length > 0) {
      setStatus(`Đã chọn ${selectedObjects.length} đối tượng trong vùng khoanh`);
    }
  };
  window.addEventListener('pointerup', finishSurfaceSelection);
  window.addEventListener('pointercancel', finishSurfaceSelection);

  window.addEventListener('blur', () => {
    if (gesture) {
      if (gesture.changed) remember(gesture.before);
      gesture = null;
    }
    marqueePointerId = null;
    marqueeStartWorld = null;
    if (marqueeEl) marqueeEl.hidden = true;
    syncSelectionOverlay();
  });

  document.addEventListener('keydown', (event) => {
    if (state.tool !== 'select' || state.ended) return;
    const active = document.activeElement;
    if (active && (active.matches('input,textarea,select') || active.isContentEditable)) return;
    if (document.querySelector('dialog[open]:not([popover])')) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (getSelectedObjects().length > 0) {
        event.preventDefault();
        deleteSelectedObjects();
      }
    } else if (event.key === 'Escape') {
      clearSelection();
    } else if (event.key === 'Enter' && getSelectedObjects().length === 1 && isEditableTextOrNote(getSelectedObjects()[0])) {
      event.preventDefault();
      const tObj = getSelectedObjects()[0];
      clearSelection();
      openEditorForSelectedObject(tObj);
    }
  });

  window.addEventListener('app:select-objects', ({ detail }) => {
    const list = Array.isArray(detail?.objects)
      ? detail.objects.filter((o) => o && fabricCanvas.getObjects().includes(o))
      : [];
    selectedObjects = list;
    cropModeActive = false;
    syncSelectionOverlay();
    window.dispatchEvent(new CustomEvent('app:selection-changed', { detail: { count: selectedObjects.length } }));
  });

  window.addEventListener('app:sync-viewport', syncSelectionOverlay);
  window.addEventListener('app:viewport-changed', syncSelectionOverlay);
  window.addEventListener('app:selection-updated', syncSelectionOverlay);
  fabricCanvas.on('after:render', syncSelectionOverlay);
  window.addEventListener('app:tool-changed', ({ detail }) => {
    if (detail?.tool !== 'select') {
      clearSelection({ silent: true });
    } else {
      syncSelectionOverlay();
    }
  });
}
