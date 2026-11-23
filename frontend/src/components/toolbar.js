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
  const margin = 10;
  const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);

  if (window.innerWidth <= 760) {
    const preferredTop = rect.bottom + margin;
    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    panel.style.left = `${Math.max(margin, Math.min(rect.left, maxLeft))}px`;
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
  stage.classList.toggle('is-dark-board', color === '#111827');
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
  setStatus(color === '#111827' ? 'Đã chuyển sang bảng phấn đen' : 'Đã chuyển sang bảng trắng');
}

function setupStudentsDrawer() {
  const workspace = $('workspaceGrid') || document.querySelector('.workspace');
  const studentsPanel = $('studentsPanel') || document.querySelector('.students');
  const toggleBtn = $('toggleStudentsBtn');
  const closeBtn = $('closeStudentsDrawerBtn');
  if (!workspace || !studentsPanel || !toggleBtn) return;

  function setDrawerOpen(open) {
    workspace.classList.toggle('is-students-collapsed', !open);
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.classList.toggle('is-active', open);
    studentsPanel.inert = !open;
  }

  // Trên khung hình hẹp / chia đôi cửa sổ (< 1060px), mặc định thu gọn để ưu tiên diện tích viết bảng
  setDrawerOpen(window.innerWidth >= 1060);

  toggleBtn.addEventListener('click', () => {
    const currentlyOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
    setDrawerOpen(!currentlyOpen);
  });

  closeBtn?.addEventListener('click', () => setDrawerOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && window.innerWidth < 1060 && toggleBtn.getAttribute('aria-expanded') === 'true') {
      setDrawerOpen(false);
    }
  });
}

function setupToolbarRovingFocusFallback() {
  if (!toolbar || 'focusGroup' in HTMLElement.prototype) return;

  const getToolbarButtons = () =>
    Array.from(toolbar.querySelectorAll(':scope > .tool-group > button, :scope > button')).filter(
      (btn) => !btn.hidden && !btn.disabled
    );

  const initItems = getToolbarButtons();
  initItems.forEach((btn, idx) => {
    btn.tabIndex = idx === 0 ? 0 : -1;
  });

  toolbar.addEventListener('focusin', ({ target }) => {
    const items = getToolbarButtons();
    if (items.includes(target)) {
      items.forEach((btn) => {
        btn.tabIndex = btn === target ? 0 : -1;
      });
    }
  });

  toolbar.addEventListener('keydown', (event) => {
    const items = getToolbarButtons();
    const currentIdx = items.indexOf(document.activeElement);
    if (currentIdx === -1 || items.length === 0) return;

    const vertical = window.innerWidth > 760 && toolbar.getAttribute('aria-orientation') === 'vertical';
    let nextIdx = -1;
    if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = items.length - 1;
    else if (vertical && event.key === 'ArrowDown') nextIdx = (currentIdx + 1) % items.length;
    else if (vertical && event.key === 'ArrowUp') nextIdx = (currentIdx - 1 + items.length) % items.length;
    else if (!vertical && event.key === 'ArrowRight') nextIdx = (currentIdx + 1) % items.length;
    else if (!vertical && event.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + items.length) % items.length;

    if (nextIdx !== -1) {
      event.preventDefault();
      items[nextIdx].focus();
    }
  });
}

function setupSystemPopoverPositioning() {
  const sysBtn = $('systemMenuBtn');
  const sysPop = $('systemInfoPopover');
  const benchBtn = $('benchmarkBtn');
  if (!sysBtn || !sysPop) return;

  sysPop.addEventListener('toggle', ({ newState }) => {
    if (newState !== 'open' || CSS.supports('position-area', 'block-end')) return;
    const t = sysBtn.getBoundingClientRect();
    const p = sysPop.getBoundingClientRect();
    const margin = 8;
    const below = t.bottom + margin + p.height <= window.innerHeight;
    sysPop.style.top = `${below ? t.bottom + margin : Math.max(margin, t.top - p.height - margin)}px`;
    sysPop.style.left = `${Math.max(margin, Math.min(t.right - p.width, window.innerWidth - p.width - margin))}px`;
  });

  benchBtn?.addEventListener('click', () => {
    if (typeof sysPop.hidePopover === 'function') {
      try { sysPop.hidePopover(); } catch { /* ignore */ }
    }
  });
}

const TOOLBAR_DOCK_STORAGE_KEY = 'ai-canvas:toolbar-dock:v1';

function setupToolbarErgonomicDock() {
  const workspace = $('workspaceGrid');
  const dockButtons = Array.from(document.querySelectorAll('[data-toolbar-dock]'));
  if (!workspace || !dockButtons.length) return;

  function applyDock(mode) {
    const validMode = ['left', 'bottom', 'right'].includes(mode) ? mode : 'left';
    workspace.classList.toggle('is-toolbar-bottom', validMode === 'bottom');
    workspace.classList.toggle('is-toolbar-right', validMode === 'right');
    if (toolbar) {
      toolbar.setAttribute('aria-orientation', validMode === 'bottom' ? 'horizontal' : 'vertical');
    }
    dockButtons.forEach((btn) => {
      const active = btn.dataset.toolbarDock === validMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    try {
      localStorage.setItem(TOOLBAR_DOCK_STORAGE_KEY, validMode);
    } catch {
      // Ignore storage quota errors
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  let savedDock = 'left';
  try {
    savedDock = localStorage.getItem(TOOLBAR_DOCK_STORAGE_KEY) || 'left';
  } catch {
    savedDock = 'left';
  }
  applyDock(savedDock);

  dockButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyDock(btn.dataset.toolbarDock || 'left');
    });
  });
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

  setupStudentsDrawer();
  setupToolbarRovingFocusFallback();
  setupSystemPopoverPositioning();
  setupToolbarErgonomicDock();
}
