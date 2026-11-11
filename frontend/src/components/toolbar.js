import { $, toolbar, panels, state, ui, stage, fabricCanvas, toolNames, shapeTools, eraserTools, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint, syncBackgroundButtons } from './history.js';

export function closePanels() {
  Object.values(panels).forEach(({ button, panel }) => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
}

export function togglePanel(name) {
  if (state.ended) return;

  const chosen = panels[name];
  const shouldOpen = chosen.panel.hidden;
  closePanels();
  if (!shouldOpen) return;

  chosen.panel.hidden = false;
  chosen.button.setAttribute('aria-expanded', 'true');

  // Popup dùng position:fixed vì thanh công cụ có thể cuộn riêng.
  const rect = chosen.button.getBoundingClientRect();
  const panel = chosen.panel;
  const margin = 8;
  const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);

  if (window.innerWidth <= 690) {
    const preferredTop = rect.bottom + margin;
    panel.style.left = `${margin}px`;
    panel.style.top = `${Math.max(margin, Math.min(preferredTop, maxTop))}px`;
  } else {
    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    panel.style.left = `${Math.max(margin, Math.min(rect.right + margin, maxLeft))}px`;
    panel.style.top = `${Math.max(margin, Math.min(rect.top, maxTop))}px`;
  }
}

export function setTool(next) {
  if (state.ended) return;
  state.tool = next;
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const selected = button.dataset.tool === next;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('shapeMenu').classList.toggle('is-active', shapeTools.has(next));
  $('eraserMenu').classList.toggle('is-active', eraserTools.has(next));
  closePanels();
  ui.input.textContent = `Đã chọn: ${toolNames[next]}`;
  setStatus(`Đang dùng: ${toolNames[next]}`);
}

export function syncColorSelection() {
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.color.toLowerCase() === ui.color.value.toLowerCase());
  });
}

export function syncWidthSelection() {
  ui.widthValue.textContent = `${ui.width.value} px`;
  document.querySelectorAll('[data-width]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.width === ui.width.value);
  });
}

export function setBackground(color) {
  if (state.ended || state.pageBusy || color === fabricCanvas.backgroundColor) return;
  const before = snapshot();
  fabricCanvas.backgroundColor = color;
  stage.style.backgroundColor = color;
  // Đổi màu bút mặc định để luôn nhìn thấy nét khi chuyển nền.
  if (color === '#111827' && ui.color.value.toLowerCase() === '#172554') {
    ui.color.value = '#ffffff';
  } else if (color === '#ffffff' && ui.color.value.toLowerCase() === '#ffffff') {
    ui.color.value = '#172554';
  }
  syncColorSelection();
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
  remember(before);
  setStatus(color === '#111827' ? 'Đã chọn bảng đen' : 'Đã chọn bảng trắng');
}

export function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  $('eraserMenu').addEventListener('click', () => togglePanel('erasers'));
  $('shapeMenu').addEventListener('click', () => togglePanel('shapes'));
  $('colorMenu').addEventListener('click', () => togglePanel('colors'));
  ui.color.addEventListener('input', syncColorSelection);
  ui.width.addEventListener('input', syncWidthSelection);
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.color.value = button.dataset.color;
      syncColorSelection();
    });
  });
  document.querySelectorAll('[data-width]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.width.value = button.dataset.width;
      syncWidthSelection();
    });
  });
  document.querySelectorAll('[data-background]').forEach((button) => {
    button.addEventListener('click', () => setBackground(button.dataset.background));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!toolbar.contains(event.target)) closePanels();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanels();
  });
}
