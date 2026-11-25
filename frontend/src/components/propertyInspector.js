import { $, state, ui, shapeTools, setStatus } from '../utils/context.js';
import { getSelectedObjects, applyStyleToSelection, applyLayerActionToSelection } from './selectionManager.js';
import { syncColorSelection, syncWidthSelection } from './toolbar.js';

function isTextItem(obj) {
  return obj && typeof obj.text === 'string';
}

export function syncPropertyInspectorVisibility() {
  const panel = $('contextPropertyPanel');
  if (!panel) return;

  if (state.ended) {
    panel.hidden = true;
    return;
  }

  const selected = getSelectedObjects();
  const hasSelection = selected.length > 0;
  const selHasText = selected.some(isTextItem);
  const selHasShape = selected.some((o) => o && !isTextItem(o) && o.type !== 'path');

  const tool = state.tool;
  const isDrawTool = tool === 'pen' || tool === 'highlighter';
  const isShapeTool = shapeTools.has(tool);
  const isTextTool = tool === 'text';

  const shouldShow = isDrawTool || isShapeTool || isTextTool || hasSelection;
  panel.hidden = !shouldShow;
  if (!shouldShow) return;

  const showTextProps = isTextTool || (hasSelection && selHasText);
  const showShapeFill = isShapeTool || (hasSelection && selHasShape);
  const showStrokeWidthAndStyle = isDrawTool || isShapeTool || (hasSelection && !selHasText);

  const bgGroup = $('propGroupBackground');
  const widthGroup = $('propGroupStrokeWidth');
  const styleGroup = $('propGroupStrokeStyle');
  const fontFamGroup = $('propGroupFontFamily');
  const fontSizeGroup = $('propGroupFontSize');
  const alignGroup = $('propGroupTextAlign');
  const layerGroup = $('propGroupLayers');

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

  window.addEventListener('app:tool-changed', syncPropertyInspectorVisibility);
  window.addEventListener('app:selection-changed', syncPropertyInspectorVisibility);
  ui.color?.addEventListener('input', syncInspectorActiveControls);
  ui.width?.addEventListener('input', syncInspectorActiveControls);

  syncPropertyInspectorVisibility();
}
