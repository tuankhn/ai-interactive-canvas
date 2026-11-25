import { $, fabricCanvas, stage, ui, state, setStatus } from '../utils/context.js';
import { persistPages } from './pageManager.js';

const DARK_NEUTRAL_INKS = new Set([
  '#26231f',
  '#18181b',
  '#172554',
  '#000000',
  '#0f172a',
  '#1e293b',
  '#111827',
  '#191816',
  '#222f71',
]);

const LIGHT_NEUTRAL_INKS = new Set([
  '#ece7df',
  '#faf8f4',
  '#ffffff',
  '#f4f4f5',
  '#f8fafc',
  '#e2e8f0',
]);

export function getActiveStudioBoardBg() {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'dark') {
    return '#111827';
  }
  return '#ffffff';
}

function adaptSingleObjectTheme(obj, isDarkBoard) {
  if (!obj) return;
  if (typeof obj.getObjects === 'function') {
    obj.getObjects().forEach((child) => adaptSingleObjectTheme(child, isDarkBoard));
  }

  const meta = obj.meta || null;
  if (meta?.dataRole === 'sticky_note' || meta?.dataRole === 'sticky_note_part') {
    return;
  }
  if (meta?.quizCardManaged) {
    if (meta.type === 'quiz_header' || (meta.type === 'quiz_option_target' && typeof obj.text === 'string')) {
      obj.set?.('fill', isDarkBoard ? '#f4f4f5' : '#18181b');
    } else if (meta.type === 'quiz_option_target' && obj.rx != null) {
      obj.set?.({
        fill: isDarkBoard ? 'rgba(34, 34, 41, 0.9)' : '#f4f7f5',
        stroke: isDarkBoard ? '#52525b' : '#b5c5bc',
      });
    }
    return;
  }

  const fill = typeof obj.fill === 'string' ? obj.fill.trim().toLowerCase() : '';
  const stroke = typeof obj.stroke === 'string' ? obj.stroke.trim().toLowerCase() : '';

  if (isDarkBoard) {
    if (DARK_NEUTRAL_INKS.has(fill)) {
      obj.set ? obj.set('fill', '#ECE7DF') : (obj.fill = '#ECE7DF');
    }
    if (DARK_NEUTRAL_INKS.has(stroke)) {
      obj.set ? obj.set('stroke', '#ECE7DF') : (obj.stroke = '#ECE7DF');
    }
  } else {
    if (LIGHT_NEUTRAL_INKS.has(fill)) {
      obj.set ? obj.set('fill', '#26231F') : (obj.fill = '#26231F');
    }
    if (LIGHT_NEUTRAL_INKS.has(stroke)) {
      obj.set ? obj.set('stroke', '#26231F') : (obj.stroke = '#26231F');
    }
  }
}

export function adaptObjectsForBoardTheme(objects, isDarkBoard) {
  if (!Array.isArray(objects)) return;
  objects.forEach((obj) => adaptSingleObjectTheme(obj, isDarkBoard));
}

function adaptSerializedPageTheme(page, targetBg) {
  if (!page || typeof page !== 'object') return;
  const isDark = targetBg === '#111827';
  page.background = targetBg;
  if ('backgroundColor' in page) page.backgroundColor = targetBg;
  if (Array.isArray(page.objects)) {
    page.objects.forEach((rawObj) => adaptSingleObjectTheme(rawObj, isDark));
  }
}

/**
 * Đồng bộ chế độ mặt bảng Sáng / Tối xuyên suốt Canvas hiện tại, toàn bộ ngăn xếp Undo/Redo
 * và các trang đã lưu mà KHÔNG tạo bước Undo giả làm đảo ngược giao diện khi bấm Hoàn tác.
 */
export function syncBoardAndHistoryTheme(targetBackground, { persist = true } = {}) {
  const isDark = targetBackground === '#111827';
  // Giữ canvas trong suốt để lộ nền giấy chấm dot (Excalidraw Dot Grid) của #canvasStage bên dưới
  fabricCanvas.backgroundColor = '';
  stage.style.removeProperty('background-color');
  stage.classList.toggle('is-dark-board', isDark);

  adaptObjectsForBoardTheme(fabricCanvas.getObjects(), isDark);

  state.undoStack.forEach((entry) => {
    if (!entry) return;
    entry.background = targetBackground;
    adaptObjectsForBoardTheme(entry.objects, isDark);
    if (Array.isArray(entry.props)) {
      entry.objects.forEach((obj, idx) => {
        if (entry.props[idx] && obj) {
          entry.props[idx].stroke = obj.stroke;
          entry.props[idx].fill = obj.fill;
        }
      });
    }
  });

  state.redoStack.forEach((entry) => {
    if (!entry) return;
    entry.background = targetBackground;
    adaptObjectsForBoardTheme(entry.objects, isDark);
    if (Array.isArray(entry.props)) {
      entry.objects.forEach((obj, idx) => {
        if (entry.props[idx] && obj) {
          entry.props[idx].stroke = obj.stroke;
          entry.props[idx].fill = obj.fill;
        }
      });
    }
  });

  if (Array.isArray(state.pages)) {
    state.pages.forEach((p) => adaptSerializedPageTheme(p, targetBackground));
  }

  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
  if (persist) {
    persistPages();
  }
}

function captureObjectProps(obj) {
  if (!obj) return null;
  const childSnaps =
    typeof obj.getObjects === 'function'
      ? obj.getObjects().map((ch) => ({
          child: ch,
          left: ch.left,
          top: ch.top,
          width: ch.width,
          height: ch.height,
          fill: ch.fill,
          stroke: ch.stroke,
          strokeWidth: ch.strokeWidth,
          opacity: ch.opacity,
          text: ch.text,
          fontSize: ch.fontSize,
          fontFamily: ch.fontFamily,
          textAlign: ch.textAlign,
          meta: ch.meta ? { ...ch.meta } : undefined,
        }))
      : null;

  return {
    left: obj.left,
    top: obj.top,
    angle: obj.angle || 0,
    scaleX: obj.scaleX ?? 1,
    scaleY: obj.scaleY ?? 1,
    width: obj.width,
    height: obj.height,
    cropX: obj.cropX || 0,
    cropY: obj.cropY || 0,
    fill: obj.fill,
    stroke: obj.stroke,
    strokeWidth: obj.strokeWidth,
    strokeDashArray: Array.isArray(obj.strokeDashArray) ? obj.strokeDashArray.slice() : obj.strokeDashArray,
    opacity: obj.opacity ?? 1,
    text: obj.text,
    fontSize: obj.fontSize,
    fontFamily: obj.fontFamily,
    textAlign: obj.textAlign,
    hitWidth: obj._hitWidth,
    hitPoints: Array.isArray(obj._hitPoints) ? obj._hitPoints.map((p) => ({ ...p })) : null,
    meta: obj.meta ? { ...obj.meta } : undefined,
    childSnaps,
  };
}

function applyObjectProps(obj, snap) {
  if (!obj || !snap) return;
  const patch = {
    left: snap.left,
    top: snap.top,
    angle: snap.angle,
    scaleX: snap.scaleX,
    scaleY: snap.scaleY,
    fill: snap.fill,
    stroke: snap.stroke,
    strokeWidth: snap.strokeWidth,
    strokeDashArray: Array.isArray(snap.strokeDashArray) ? snap.strokeDashArray.slice() : snap.strokeDashArray,
    opacity: snap.opacity,
  };
  if (snap.width !== undefined) patch.width = snap.width;
  if (snap.height !== undefined) patch.height = snap.height;
  if (obj.cropX !== undefined || snap.cropX) patch.cropX = snap.cropX;
  if (obj.cropY !== undefined || snap.cropY) patch.cropY = snap.cropY;
  if (snap.text !== undefined && typeof obj.text === 'string') patch.text = snap.text;
  if (snap.fontSize !== undefined && obj.fontSize !== undefined) patch.fontSize = snap.fontSize;
  if (snap.fontFamily !== undefined && obj.fontFamily !== undefined) patch.fontFamily = snap.fontFamily;
  if (snap.textAlign !== undefined && obj.textAlign !== undefined) patch.textAlign = snap.textAlign;
  obj.set(patch);

  if (snap.hitWidth !== undefined) obj._hitWidth = snap.hitWidth;
  if (snap.hitPoints) obj._hitPoints = snap.hitPoints.map((p) => ({ ...p }));
  if (snap.meta) obj.meta = { ...snap.meta };

  if (Array.isArray(snap.childSnaps)) {
    for (const cs of snap.childSnaps) {
      if (!cs?.child) continue;
      const cPatch = {
        left: cs.left,
        top: cs.top,
        fill: cs.fill,
        stroke: cs.stroke,
        strokeWidth: cs.strokeWidth,
        opacity: cs.opacity,
      };
      if (cs.width !== undefined) cPatch.width = cs.width;
      if (cs.height !== undefined) cPatch.height = cs.height;
      if (cs.text !== undefined && typeof cs.child.text === 'string') cPatch.text = cs.text;
      if (cs.fontSize !== undefined && cs.child.fontSize !== undefined) cPatch.fontSize = cs.fontSize;
      if (cs.fontFamily !== undefined && cs.child.fontFamily !== undefined) cPatch.fontFamily = cs.fontFamily;
      if (cs.textAlign !== undefined && cs.child.textAlign !== undefined) cPatch.textAlign = cs.textAlign;
      cs.child.set(cPatch);
      if (cs.meta) cs.child.meta = { ...cs.meta };
      cs.child.setCoords?.();
    }
    obj.dirty = true;
  }
  obj.setCoords?.();
}

function propsDiffer(snap, obj) {
  if (!snap || !obj) return true;
  if (
    snap.left !== obj.left ||
    snap.top !== obj.top ||
    snap.angle !== (obj.angle || 0) ||
    snap.scaleX !== (obj.scaleX ?? 1) ||
    snap.scaleY !== (obj.scaleY ?? 1) ||
    snap.width !== obj.width ||
    snap.height !== obj.height ||
    snap.cropX !== (obj.cropX || 0) ||
    snap.cropY !== (obj.cropY || 0) ||
    snap.fill !== obj.fill ||
    snap.stroke !== obj.stroke ||
    snap.strokeWidth !== obj.strokeWidth ||
    snap.opacity !== (obj.opacity ?? 1) ||
    snap.text !== obj.text ||
    snap.fontSize !== obj.fontSize ||
    snap.fontFamily !== obj.fontFamily ||
    snap.textAlign !== obj.textAlign
  ) {
    return true;
  }
  if (Array.isArray(snap.childSnaps)) {
    return snap.childSnaps.some(
      (cs) =>
        !cs.child ||
        cs.fill !== cs.child.fill ||
        cs.stroke !== cs.child.stroke ||
        cs.text !== cs.child.text ||
        cs.fontSize !== cs.child.fontSize ||
        cs.fontFamily !== cs.child.fontFamily ||
        cs.textAlign !== cs.child.textAlign,
    );
  }
  return false;
}

export function snapshot() {
  const objs = fabricCanvas.getObjects().slice();
  return {
    objects: objs,
    props: objs.map(captureObjectProps),
    background: getActiveStudioBoardBg(),
  };
}

function stateChanged(before) {
  const currentObjects = fabricCanvas.getObjects();
  if (before.objects.length !== currentObjects.length) return true;
  for (let i = 0; i < currentObjects.length; i++) {
    if (before.objects[i] !== currentObjects[i]) return true;
    if (Array.isArray(before.props) && propsDiffer(before.props[i], currentObjects[i])) return true;
  }
  return false;
}

export function updateHistoryButtons() {
  $('undoButton').disabled = state.ended || state.pageBusy || state.undoStack.length === 0;
  $('redoButton').disabled = state.ended || state.pageBusy || state.redoStack.length === 0;
}

export function remember(before) {
  if (!stateChanged(before)) return false;
  state.undoStack.push(before);
  if (state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack = [];
  updateHistoryButtons();
  persistPages();
  return true;
}

export function updateHint() {
  const noObjects = fabricCanvas.getObjects().length === 0;
  ui.hint.classList.toggle('is-hidden', !noObjects);
  ui.hint.classList.toggle('on-dark', getActiveStudioBoardBg() === '#111827');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:sync-viewport'));
  }
}

export function syncBackgroundButtons() {
  const bg = getActiveStudioBoardBg();
  document.querySelectorAll('[data-background]').forEach((button) => {
    const selected = button.dataset.background === bg;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

export function restore(snapState) {
  const activeBg = getActiveStudioBoardBg();
  const isDark = activeBg === '#111827';
  const existing = fabricCanvas.getObjects().slice();
  if (existing.length) fabricCanvas.remove(...existing);
  if (snapState.objects.length) {
    if (Array.isArray(snapState.props)) {
      snapState.objects.forEach((obj, idx) => applyObjectProps(obj, snapState.props[idx]));
    }
    adaptObjectsForBoardTheme(snapState.objects, isDark);
    fabricCanvas.add(...snapState.objects);
  }
  fabricCanvas.backgroundColor = '';
  stage.style.removeProperty('background-color');
  stage.classList.toggle('is-dark-board', isDark);
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
}

export function undo() {
  if (state.ended || state.pageBusy || state.undoStack.length === 0) return;
  state.redoStack.push(snapshot());
  restore(state.undoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã hoàn tác');
}

export function redo() {
  if (state.ended || state.pageBusy || state.redoStack.length === 0) return;
  state.undoStack.push(snapshot());
  restore(state.redoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã làm lại');
}

export function setupHistoryShortcuts() {
  $('undoButton').addEventListener('click', undo);
  $('redoButton').addEventListener('click', redo);
  document.addEventListener('keydown', (event) => {
    if ($('clearBoardDialog').open || $('deletePageDialog').open) return;
    const element = document.activeElement;
    if (element?.matches('input,textarea,select') || element?.isContentEditable) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    }
  });
}
