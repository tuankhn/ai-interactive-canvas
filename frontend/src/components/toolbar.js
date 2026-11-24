import { $, toolbar, panels, state, ui, stage, fabricCanvas, toolNames, shapeTools, eraserTools, setStatus } from '../utils/context.js';
import { syncBoardAndHistoryTheme } from './history.js';
import { setupRulerOverlay, toggleRuler, isRulerActive } from './rulerOverlay.js';

const TOOLBAR_DOCK_STORAGE_KEY = 'ai-canvas:toolbar-dock:v2';
const STUDIO_THEME_STORAGE_KEY = 'ai-canvas:studio-theme:v2';
const BOARD_GRID_STORAGE_KEY = 'ai-canvas:board-grid:v2';
const BOARD_BG_LIGHT_KEY = 'ai-canvas:board-bg-light:v1';
const BOARD_BG_DARK_KEY = 'ai-canvas:board-bg-dark:v1';

const LIGHT_BOARD_PRESETS = [
  { id: 'parchment', label: 'Giấy ấm Parchment', bg: '#F4F0E8', dot: '#D8D1C5' },
  { id: 'ivory', label: 'Trắng ngà tinh khiết', bg: '#FAF9F6', dot: '#DDD8CE' },
  { id: 'sage', label: 'Xanh lá trà dịu', bg: '#EEF2EC', dot: '#CBD6C8' },
  { id: 'mist', label: 'Xanh sương mây', bg: '#EDF2F6', dot: '#CAD6E0' },
  { id: 'butter', label: 'Kem bơ sổ tay', bg: '#F8F0DF', dot: '#DCD0B8' },
  { id: 'blush', label: 'Hồng đất phấn', bg: '#F5EAE6', dot: '#DBCAC4' },
];

const DARK_BOARD_PRESETS = [
  { id: 'charcoal', label: 'Than ấm Charcoal', bg: '#191816', dot: '#332F2B' },
  { id: 'obsidian', label: 'Đen Obsidian', bg: '#131315', dot: '#2C2C32' },
  { id: 'pine', label: 'Bảng phấn rừng đêm', bg: '#141C18', dot: '#2A3931' },
  { id: 'midnight', label: 'Xanh đêm Midnight', bg: '#141821', dot: '#2B3344' },
  { id: 'espresso', label: 'Nâu Espresso ấm', bg: '#201B18', dot: '#3B322C' },
  { id: 'plum', label: 'Tím than trầm', bg: '#1D1820', dot: '#372E3D' },
];

let activeThemeMode = 'light'; // 'light' | 'dark' | 'system'

function applyBoardGridMode(mode, { persist = true } = {}) {
  const validMode = ['dots', 'lines', 'plain'].includes(mode) ? mode : 'dots';
  stage?.classList.toggle('is-plain-board', validMode === 'plain');
  stage?.classList.toggle('is-grid-lines', validMode === 'lines');
  document.querySelectorAll('[data-grid]').forEach((btn) => {
    const selected = btn.dataset.grid === validMode;
    btn.classList.toggle('is-selected', selected);
    btn.classList.toggle('is-active', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
  if (persist) {
    try {
      localStorage.setItem(BOARD_GRID_STORAGE_KEY, validMode);
    } catch {
      // Ignore storage errors
    }
    const labels = {
      dots: 'Đã bật lưới chấm mảnh',
      lines: 'Đã bật lưới ô vuông kỹ thuật',
      plain: 'Đã chuyển sang mặt bảng trơn',
    };
    setStatus(labels[validMode]);
  }
}

function setupBoardGridToggle() {
  let savedGrid = 'dots';
  try {
    savedGrid = localStorage.getItem(BOARD_GRID_STORAGE_KEY) || 'dots';
  } catch {
    savedGrid = 'dots';
  }
  applyBoardGridMode(savedGrid, { persist: false });
  document.querySelectorAll('[data-grid]').forEach((btn) => {
    btn.addEventListener('click', () => applyBoardGridMode(btn.dataset.grid, { persist: true }));
  });
}

function renderAndApplyBoardSwatches(isDark, { persist = false } = {}) {
  const container = $('boardBgSwatches');
  const presets = isDark ? DARK_BOARD_PRESETS : LIGHT_BOARD_PRESETS;
  const storageKey = isDark ? BOARD_BG_DARK_KEY : BOARD_BG_LIGHT_KEY;
  let savedId = presets[0].id;
  try {
    savedId = localStorage.getItem(storageKey) || presets[0].id;
  } catch {
    savedId = presets[0].id;
  }
  const chosen = presets.find((p) => p.id === savedId) || presets[0];

  stage?.style.setProperty('--custom-board-bg', chosen.bg);
  stage?.style.setProperty('--custom-dot-color', chosen.dot);
  if (isDark) {
    state.customBoardBgDark = chosen.bg;
  } else {
    state.customBoardBgLight = chosen.bg;
  }

  if (!container) return;
  container.replaceChildren();
  presets.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `board-bg-swatch${preset.id === chosen.id ? ' is-active' : ''}`;
    btn.style.setProperty('--swatch-bg', preset.bg);
    btn.title = preset.label;
    btn.setAttribute('aria-label', preset.label);
    btn.setAttribute('aria-pressed', String(preset.id === chosen.id));
    btn.addEventListener('click', () => {
      try {
        localStorage.setItem(storageKey, preset.id);
      } catch {
        // Ignore storage errors
      }
      renderAndApplyBoardSwatches(isDark, { persist: true });
      setStatus(`Màu nền bảng: ${preset.label}`);
    });
    container.appendChild(btn);
  });
}

export function closePanels() {
  Object.values(panels).forEach((entry) => {
    if (!entry?.panel || !entry?.button) return;
    entry.panel.hidden = true;
    entry.button.setAttribute('aria-expanded', 'false');
    entry.button.classList.remove('is-popover-open');
  });
}

export function togglePanel(name) {
  if (state.ended) return;

  const chosen = panels[name];
  if (!chosen?.panel || !chosen?.button) return;
  const shouldOpen = chosen.panel.hidden;
  closePanels();
  if (!shouldOpen) return;

  const panel = chosen.panel;
  const button = chosen.button;
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  button.classList.add('is-popover-open');

  requestAnimationFrame(() => {
    if (panel.hidden) return;
    const rect = button.getBoundingClientRect();
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = panel.offsetWidth || 280;
    const ph = panel.offsetHeight || 240;

    const workspace = $('workspaceGrid');
    const isLeftDock =
      vw > 960 &&
      workspace?.classList.contains('is-toolbar-left');
    const isBottomDock =
      vw <= 960 ||
      workspace?.classList.contains('is-toolbar-bottom');

    let left = rect.left;
    let top = rect.bottom + 8;

    if (isLeftDock) {
      left = rect.right + 10;
      top = rect.top;
    } else if (isBottomDock) {
      left = rect.left + rect.width / 2 - pw / 2;
      top = rect.top - ph - 10;
      if (top < 62) {
        top = Math.max(62, vh - ph - 72);
      }
    } else {
      left = rect.left + rect.width / 2 - pw / 2;
      top = rect.bottom + 10;
    }

    const maxLeft = Math.max(margin, vw - pw - margin);
    const maxTop = Math.max(margin, vh - ph - (isBottomDock ? 68 : margin));
    panel.style.left = `${Math.max(margin, Math.min(left, maxLeft))}px`;
    panel.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`;
  });
}

export function setTool(next) {
  if (state.ended) return;
  state.tool = next;
  stage?.classList.toggle('is-panning', next === 'hand');
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const selected = button.dataset.tool === next;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('shapeMenu')?.classList.toggle('is-active', shapeTools.has(next));
  $('eraserMenu')?.classList.toggle('is-active', eraserTools.has(next));
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
  if (state.ended || state.pageBusy) return;
  const isDark = color === '#111827';
  applyStudioTheme(isDark ? 'dark' : 'light');
}

export function applyStudioTheme(modeOrTheme, { persist = true } = {}) {
  const mode = ['light', 'dark', 'system'].includes(modeOrTheme) ? modeOrTheme : 'light';
  activeThemeMode = mode;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'system' ? prefersDark : mode === 'dark';

  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  stage?.classList.toggle('is-panning', state.tool === 'hand');

  document.querySelectorAll('[data-theme-mode]').forEach((btn) => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (persist) {
    try {
      localStorage.setItem(STUDIO_THEME_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors
    }
  }

  renderAndApplyBoardSwatches(isDark, { persist });

  if (ui.color) {
    const currentInk = ui.color.value.toLowerCase();
    if (isDark && ['#26231f', '#18181b', '#172554', '#000000'].includes(currentInk)) {
      ui.color.value = '#FAF8F4';
    } else if (!isDark && ['#faf8f4', '#ece7df', '#ffffff', '#f4f4f5'].includes(currentInk)) {
      ui.color.value = '#26231F';
    }
    syncColorSelection();
  }

  if (!state.ended) {
    const targetBoardBg = isDark ? '#111827' : '#ffffff';
    syncBoardAndHistoryTheme(targetBoardBg, { persist });
    if (persist) {
      const names = {
        light: 'Đã chuyển sang Giao diện Sáng (Warm Parchment)',
        dark: 'Đã chuyển sang Giao diện Tối (Warm Charcoal)',
        system: 'Đã đồng bộ Giao diện theo Hệ thống',
      };
      setStatus(names[mode]);
    }
  }
}

function setupStudioThemeToggle() {
  let initialMode = 'light';
  try {
    initialMode = localStorage.getItem(STUDIO_THEME_STORAGE_KEY) || 'light';
  } catch {
    initialMode = 'light';
  }
  applyStudioTheme(initialMode, { persist: false });

  document.querySelectorAll('[data-theme-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyStudioTheme(btn.dataset.themeMode || 'light', { persist: true });
    });
  });

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      if (activeThemeMode === 'system') {
        applyStudioTheme('system', { persist: false });
      }
    });
  }
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

  // Triết lý Excalidraw Canvas-First: mở trang ra là 100% không gian bảng sạch thoáng,
  // ngăn Học sinh trượt ra nhẹ nhàng khi giáo viên bấm nút "Học sinh".
  setDrawerOpen(false);

  toggleBtn.addEventListener('click', () => {
    const currentlyOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
    setDrawerOpen(!currentlyOpen);
  });

  closeBtn?.addEventListener('click', () => setDrawerOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggleBtn.getAttribute('aria-expanded') === 'true') {
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

    const vertical = toolbar.getAttribute('aria-orientation') === 'vertical';
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
    if (newState !== 'open') return;
    const t = sysBtn.getBoundingClientRect();
    const p = sysPop.getBoundingClientRect();
    const margin = 10;
    const below = t.bottom + margin + p.height <= window.innerHeight;
    sysPop.style.top = `${below ? t.bottom + margin : Math.max(margin, t.top - p.height - margin)}px`;
    sysPop.style.left = `${Math.max(margin, Math.min(t.left, window.innerWidth - p.width - margin))}px`;
  });

  const hideSysPopover = () => {
    if (typeof sysPop.hidePopover === 'function') {
      try { sysPop.hidePopover(); } catch { /* ignore */ }
    }
  };

  benchBtn?.addEventListener('click', hideSysPopover);
  $('menuExportPngBtn')?.addEventListener('click', () => {
    hideSysPopover();
    $('captureButton')?.click();
  });
  $('menuResetViewBtn')?.addEventListener('click', () => {
    hideSysPopover();
    window.dispatchEvent(new CustomEvent('app:reset-viewport'));
  });
  $('menuResetCanvasBtn')?.addEventListener('click', () => {
    hideSysPopover();
    $('clearButton')?.click();
  });
}

function setupToolbarErgonomicDock() {
  const workspace = $('workspaceGrid');
  const dockButtons = Array.from(document.querySelectorAll('[data-toolbar-dock]'));
  if (!workspace || !dockButtons.length) return;

  function applyDock(mode) {
    const validMode = ['top', 'bottom', 'left'].includes(mode) ? mode : 'top';
    workspace.classList.toggle('is-toolbar-top', validMode === 'top');
    workspace.classList.toggle('is-toolbar-bottom', validMode === 'bottom');
    workspace.classList.toggle('is-toolbar-left', validMode === 'left');
    if (toolbar) {
      toolbar.setAttribute('aria-orientation', validMode === 'left' ? 'vertical' : 'horizontal');
    }
    dockButtons.forEach((btn) => {
      const active = btn.dataset.toolbarDock === validMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    closePanels();
    try {
      localStorage.setItem(TOOLBAR_DOCK_STORAGE_KEY, validMode);
    } catch {
      // Ignore storage quota errors
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  let savedDock = 'top';
  try {
    savedDock = localStorage.getItem(TOOLBAR_DOCK_STORAGE_KEY) || 'top';
  } catch {
    savedDock = 'top';
  }
  applyDock(savedDock);

  dockButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyDock(btn.dataset.toolbarDock || 'top');
    });
  });
}

function setupExcalidrawKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (state.ended || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector('dialog[open]:not([popover])')) return;

    const key = event.key.toLowerCase();
    if (key === 'v') {
      event.preventDefault();
      setTool('hand');
    } else if (key === 'p') {
      event.preventDefault();
      setTool('pen');
    } else if (key === 'h') {
      event.preventDefault();
      setTool('highlighter');
    } else if (key === 'e') {
      event.preventDefault();
      setTool('eraser');
    } else if (key === 's') {
      event.preventDefault();
      togglePanel('shapes');
    } else if (key === 'r') {
      event.preventDefault();
      toggleRuler();
    } else if (key === 'c') {
      event.preventDefault();
      togglePanel('colors');
    } else if (key === 't') {
      event.preventDefault();
      setTool('text');
    } else if (key === 'o') {
      event.preventDefault();
      $('handwritingTool')?.click();
    }
  });
}

export function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  $('eraserMenu')?.addEventListener('click', () => togglePanel('erasers'));
  $('shapeMenu')?.addEventListener('click', () => togglePanel('shapes'));
  $('colorMenu')?.addEventListener('click', () => togglePanel('colors'));
  $('aiStudioMenuBtn')?.addEventListener('click', () => togglePanel('aiStudio'));

  // Đóng menu Học tập AI khi chọn một tính năng mở hộp thoại (giữ mở khi bật/tắt công tắc Tự động)
  $('aiToolsPopover')?.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (btn && btn.id !== 'autoAiToggle') {
      closePanels();
    }
  });

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
    if (event.key === 'Escape') {
      const anyPanelOpen = Object.values(panels).some((entry) => entry?.panel && !entry.panel.hidden);
      if (anyPanelOpen) {
        closePanels();
      } else if (isRulerActive()) {
        toggleRuler(false);
      }
    }
  });

  setupRulerOverlay();
  setupStudioThemeToggle();
  setupBoardGridToggle();
  setupStudentsDrawer();
  setupToolbarRovingFocusFallback();
  setupSystemPopoverPositioning();
  setupToolbarErgonomicDock();
  setupExcalidrawKeyboardShortcuts();
}
