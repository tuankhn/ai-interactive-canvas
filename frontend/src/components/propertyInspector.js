import { $, state, ui, surface, shapeTools, setStatus } from '../utils/context.js';
import { getSelectedObjects, applyStyleToSelection, applyLayerActionToSelection } from './selectionManager.js';
import { syncColorSelection, syncWidthSelection } from './toolbar.js';
import { isStickyNoteObject } from './boardMediaAndNotes.js';

let inspectorCollapsed = typeof window !== 'undefined' && window.innerWidth <= 768;

function isTextItem(obj) {
  return obj && (typeof obj.text === 'string' || isStickyNoteObject(obj));
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 960;
}

export function setInspectorCollapsed(collapsed) {
  inspectorCollapsed = Boolean(collapsed);
  syncPropertyInspectorVisibility();
  window.dispatchEvent(new CustomEvent('app:selection-updated'));
}

export function togglePropertyInspector() {
  inspectorCollapsed = !inspectorCollapsed;
  syncPropertyInspectorVisibility();
}

export function syncPropertyInspectorVisibility() {
  const panel = $('contextPropertyPanel');
  const reopenBtn = $('reopenInspectorBtn');
  if (!panel) return;

  if (state.ended) {
    panel.hidden = true;
    if (reopenBtn) reopenBtn.hidden = true;
    return;
  }

  const selected = getSelectedObjects();
  const hasSelection = selected.length > 0;
  const selHasText = selected.some(isTextItem);
  const selHasStickyNote = selected.some(isStickyNoteObject);
  const selHasShape = selected.some((o) => o && !isTextItem(o) && o.type !== 'path');

  const tool = state.tool;
  const isDrawTool = tool === 'pen' || tool === 'highlighter';
  const isShapeTool = shapeTools.has(tool);
  const isTextTool = tool === 'text';
  const isNoteTool = tool === 'note';

  const isContextEligible = isDrawTool || isShapeTool || isTextTool || isNoteTool || hasSelection;
  if (!isContextEligible) {
    panel.hidden = true;
    if (reopenBtn) reopenBtn.hidden = true;
    return;
  }

  if (inspectorCollapsed) {
    panel.hidden = true;
    if (reopenBtn) reopenBtn.hidden = false;
    syncInspectorActiveControls();
    return;
  }

  panel.hidden = false;
  if (reopenBtn) reopenBtn.hidden = true;

  const showTextProps = isTextTool || isNoteTool || (hasSelection && selHasText);
  const showNoteBg = isNoteTool || (hasSelection && selHasStickyNote);
  const showShapeFill = !showNoteBg && (isShapeTool || (hasSelection && selHasShape));
  const showStrokeWidthAndStyle = isDrawTool || isShapeTool || (hasSelection && !selHasText && !selHasStickyNote);

  const noteBgGroup = $('propGroupNoteBg');
  const bgGroup = $('propGroupBackground');
  const widthGroup = $('propGroupStrokeWidth');
  const styleGroup = $('propGroupStrokeStyle');
  const fontFamGroup = $('propGroupFontFamily');
  const fontSizeGroup = $('propGroupFontSize');
  const alignGroup = $('propGroupTextAlign');
  const layerGroup = $('propGroupLayers');

  if (noteBgGroup) noteBgGroup.hidden = !showNoteBg;
  if (bgGroup) bgGroup.hidden = !showShapeFill;
  if (widthGroup) widthGroup.hidden = !showStrokeWidthAndStyle;
  if (styleGroup) styleGroup.hidden = !showStrokeWidthAndStyle || tool === 'highlighter';
  if (fontFamGroup) fontFamGroup.hidden = !showTextProps;
  if (fontSizeGroup) fontSizeGroup.hidden = !showTextProps;
  if (alignGroup) alignGroup.hidden = !showTextProps;
  if (layerGroup) layerGroup.hidden = false;

  syncInspectorActiveControls();
}

export function syncInspectorActiveControls() {
  const currentColor = (ui.color?.value || '#26231F').toLowerCase();
  document.querySelectorAll('[data-insp-color]').forEach((btn) => {
    const active = btn.dataset.inspColor.toLowerCase() === currentColor;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const customStrokePreview = $('inspCustomColorBtn');
  if (customStrokePreview) {
    customStrokePreview.style.setProperty('--insp-custom-color', ui.color?.value || '#26231F');
  }
  const reopenDot = $('reopenInspectorDot');
  if (reopenDot) {
    reopenDot.style.setProperty('--reopen-dot-color', ui.color?.value || '#26231F');
  }

  const currentNoteBg = (state.noteBg || '#FFE066').toLowerCase();
  document.querySelectorAll('[data-insp-notebg]').forEach((btn) => {
    const active = btn.dataset.inspNotebg.toLowerCase() === currentNoteBg;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentFill = state.shapeFill || 'transparent';
  document.querySelectorAll('[data-insp-fill]').forEach((btn) => {
    const active = btn.dataset.inspFill.toLowerCase() === currentFill.toLowerCase();
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentW = Number(ui.width?.value || 4);
  const widthBucket = currentW <= 3 ? '2' : currentW <= 7 ? '5' : '10';
  document.querySelectorAll('[data-insp-width]').forEach((btn) => {
    const active = btn.dataset.inspWidth === widthBucket;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentStyle = state.strokeStyle || 'solid';
  document.querySelectorAll('[data-insp-style]').forEach((btn) => {
    const active = btn.dataset.inspStyle === currentStyle;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentFont = state.fontFamily || 'sans';
  document.querySelectorAll('[data-insp-font]').forEach((btn) => {
    const active = btn.dataset.inspFont === currentFont;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentSize = Number(state.fontSize || 26);
  document.querySelectorAll('[data-insp-fontsize]').forEach((btn) => {
    const active = Number(btn.dataset.inspFontsize) === currentSize;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const currentAlign = state.textAlign || 'left';
  document.querySelectorAll('[data-insp-align]').forEach((btn) => {
    const active = btn.dataset.inspAlign === currentAlign;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const opSlider = $('inspOpacityRange');
  const opValue = $('inspOpacityValue');
  if (opSlider) opSlider.value = String(state.opacity ?? 100);
  if (opValue) opValue.textContent = String(state.opacity ?? 100);
}

export function setupPropertyInspector() {
  const panel = $('contextPropertyPanel');
  if (!panel) return;

  // Màu nét / màu chữ
  document.querySelectorAll('[data-insp-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.inspColor;
      if (ui.color) ui.color.value = col;
      syncColorSelection();
      applyStyleToSelection({ color: col });
      syncInspectorActiveControls();
    });
  });

  const customStrokeInput = $('inspCustomColorInput');
  $('inspCustomColorBtn')?.addEventListener('click', () => customStrokeInput?.click());
  customStrokeInput?.addEventListener('input', () => {
    if (ui.color) ui.color.value = customStrokeInput.value;
    syncColorSelection();
    applyStyleToSelection({ color: customStrokeInput.value });
    syncInspectorActiveControls();
  });

  // Màu nền Giấy Note (Excalidraw Sticky Note)
  document.querySelectorAll('[data-insp-notebg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.noteBg = btn.dataset.inspNotebg;
      applyStyleToSelection({ noteBg: state.noteBg });
      syncInspectorActiveControls();
    });
  });

  // Màu tô nền hình (Background)
  document.querySelectorAll('[data-insp-fill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.shapeFill = btn.dataset.inspFill;
      applyStyleToSelection({ shapeFill: state.shapeFill });
      syncInspectorActiveControls();
    });
  });

  const customFillInput = $('inspCustomFillInput');
  $('inspCustomFillBtn')?.addEventListener('click', () => customFillInput?.click());
  customFillInput?.addEventListener('input', () => {
    state.shapeFill = customFillInput.value;
    applyStyleToSelection({ shapeFill: state.shapeFill });
    syncInspectorActiveControls();
  });

  // Độ dày nét (Stroke width)
  document.querySelectorAll('[data-insp-width]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.inspWidth;
      if (ui.width) ui.width.value = w;
      syncWidthSelection();
      applyStyleToSelection({ width: Number(w) });
      syncInspectorActiveControls();
    });
  });

  // Kiểu nét: Liền / Đứt / Chấm
  document.querySelectorAll('[data-insp-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.strokeStyle = btn.dataset.inspStyle;
      applyStyleToSelection({ strokeStyle: state.strokeStyle });
      syncInspectorActiveControls();
    });
  });

  // Phông chữ (Font family)
  document.querySelectorAll('[data-insp-font]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.fontFamily = btn.dataset.inspFont;
      applyStyleToSelection({ fontFamily: state.fontFamily });
      syncInspectorActiveControls();
    });
  });

  // Cỡ chữ (S / M / L / XL)
  document.querySelectorAll('[data-insp-fontsize]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.fontSize = Number(btn.dataset.inspFontsize);
      applyStyleToSelection({ fontSize: state.fontSize });
      syncInspectorActiveControls();
    });
  });

  // Căn lề chữ (Left / Center / Right)
  document.querySelectorAll('[data-insp-align]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.textAlign = btn.dataset.inspAlign;
      applyStyleToSelection({ textAlign: state.textAlign });
      syncInspectorActiveControls();
    });
  });

  // Độ mờ (Opacity 10 - 100)
  const opSlider = $('inspOpacityRange');
  opSlider?.addEventListener('input', () => {
    state.opacity = Number(opSlider.value);
    applyStyleToSelection({ opacity: state.opacity });
    syncInspectorActiveControls();
  });

  // Thứ tự lớp (Layers)
  document.querySelectorAll('[data-insp-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyLayerActionToSelection(btn.dataset.inspLayer);
    });
  });

  // Thu gọn / Mở lại bảng tuỳ chỉnh (đặc biệt hữu ích trên màn hình điện thoại)
  $('closeInspectorBtn')?.addEventListener('click', () => {
    setInspectorCollapsed(true);
  });
  $('reopenInspectorBtn')?.addEventListener('click', () => {
    setInspectorCollapsed(false);
  });

  // Tự động đóng bảng tuỳ chỉnh nét ngay khi người dùng nhấp / đặt bút ra bên ngoài bảng (cả Desktop lẫn Mobile)
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (inspectorCollapsed || panel.hidden) return;
      const t = event.target;
      if (
        panel.contains(t) ||
        t.closest?.('#toolbar') ||
        t.closest?.('.tool-popover') ||
        t.closest?.('#reopenInspectorBtn')
      ) {
        return;
      }
      setInspectorCollapsed(true);
    },
    true
  );

  window.addEventListener('app:toggle-inspector', togglePropertyInspector);
  window.addEventListener('app:tool-changed', ({ detail }) => {
    const nextTool = detail?.tool || state.tool;
    if (
      !isMobileViewport() &&
      (nextTool === 'pen' || nextTool === 'highlighter' || nextTool === 'text' || nextTool === 'note' || shapeTools.has(nextTool))
    ) {
      inspectorCollapsed = false;
    }
    syncPropertyInspectorVisibility();
  });
  window.addEventListener('app:selection-changed', () => {
    // Trên điện thoại: chọn đối tượng thì không tự bung bảng tuỳ chỉnh chèn lên thanh Sửa chữ / Xóa và nội dung
    if (isMobileViewport() && state.tool === 'select' && getSelectedObjects().length > 0) {
      inspectorCollapsed = true;
    }
    syncPropertyInspectorVisibility();
  });
  ui.color?.addEventListener('input', syncInspectorActiveControls);
  ui.width?.addEventListener('input', syncInspectorActiveControls);

  syncPropertyInspectorVisibility();
}
