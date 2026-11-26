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

let dismissTooltipCallback = null;

export function closePanels() {
  dismissTooltipCallback?.();
  const tipEl = $('instantTooltip');
  if (tipEl) tipEl.hidden = true;
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
      left = name === 'aiStudio' ? rect.right - pw : rect.left + rect.width / 2 - pw / 2;
      top = rect.top - ph - 10;
      if (top < 62) {
        top = Math.max(62, vh - ph - 72);
      }
    } else {
      left = name === 'aiStudio' ? rect.right - pw : rect.left + rect.width / 2 - pw / 2;
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
  if (next === 'hand' && state.boardLocked) {
    setStatus('Mặt bảng đang KHOÁ — Bấm ổ khoá (hoặc phím Q) để mở khoá trước khi kéo trang.');
    return;
  }
  state.tool = next;
  stage?.classList.toggle('is-panning', next === 'hand');
  stage?.classList.toggle('is-select-tool', next === 'select');
  stage?.classList.toggle('is-text-tool', next === 'text');
  stage?.classList.toggle('is-note-tool', next === 'note');
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const selected = button.dataset.tool === next;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('shapeMenu')?.classList.toggle('is-active', shapeTools.has(next));
  $('eraserMenu')?.classList.toggle('is-active', eraserTools.has(next));
  closePanels();
  const friendlyName = toolNames[next] || next;
  ui.input.textContent = `Đã chọn: ${friendlyName}`;
  setStatus(`Đang dùng: ${friendlyName}`);
  window.dispatchEvent(new CustomEvent('app:tool-changed', { detail: { tool: next } }));
}

export function showToolGuideBanner() {
  // Đã lược bỏ thanh thông báo hướng dẫn khi click vì đã có tooltip khi rê chuột
}

export function toggleBoardLock(forceValue) {
  if (state.ended) return;
  const nextLocked = typeof forceValue === 'boolean' ? forceValue : !state.boardLocked;
  state.boardLocked = nextLocked;
  const lockBtn = $('lockBoardBtn');
  if (lockBtn) {
    lockBtn.classList.toggle('is-active', nextLocked);
    lockBtn.classList.toggle('is-locked', nextLocked);
    lockBtn.setAttribute('aria-pressed', String(nextLocked));
    const tipText = nextLocked ? 'Mở khoá di chuyển trang — Q' : 'Khoá di chuyển trang — Q';
    lockBtn.dataset.tip = tipText;
  }
  stage?.classList.toggle('is-board-locked', nextLocked);
  if (nextLocked && state.tool === 'hand') {
    setTool('pen');
  }
  window.dispatchEvent(new CustomEvent('app:board-lock-changed', { detail: { locked: nextLocked } }));
  const msg = nextLocked
    ? 'Đã KHOÁ mặt bảng & phân trang (Bấm Q để mở khoá)'
    : 'Đã MỞ KHOÁ mặt bảng';
  setStatus(msg);
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
  if (!toolbar) return;

  const getToolbarButtons = () =>
    Array.from(toolbar.querySelectorAll(':scope > .tool-group > button, :scope > button')).filter(
      (btn) => !btn.hidden && !btn.disabled
    );

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

  // Cấu hình nhanh địa chỉ Máy chủ AI Backend & Cụm API Key dự phòng xoay vòng
  const apiInput = $('apiBackendUrlInput');
  const keysInput = $('geminiApiKeysInput');
  const apiBadge = $('menuApiBadge');
  const apiHint = $('apiBackendHint');
  const syncApiConfigUi = () => {
    const currentBase = window.getAiCanvasApiBase?.() || '';
    const currentKeys = window.getAiCanvasGeminiKeys?.() || '';
    const keyCount = currentKeys ? currentKeys.split(',').filter(Boolean).length : 0;
    if (apiInput) apiInput.value = currentBase;
    if (keysInput) keysInput.value = currentKeys;
    if (apiBadge) {
      if (keyCount > 0) {
        apiBadge.textContent = `${keyCount} Key`;
        apiBadge.dataset.state = 'ok';
      } else if (currentBase) {
        try {
          apiBadge.textContent = new URL(currentBase).host.slice(0, 18);
          apiBadge.dataset.state = 'ok';
        } catch {
          apiBadge.textContent = 'Đã gán';
        }
      } else {
        apiBadge.textContent = 'Local';
        delete apiBadge.dataset.state;
      }
    }
  };
  syncApiConfigUi();

  $('saveApiBackendBtn')?.addEventListener('click', async () => {
    const saved = window.setAiCanvasApiBase?.(apiInput?.value || '') || '';
    const savedKeys = window.setAiCanvasGeminiKeys?.(keysInput?.value || '') || '';
    const keyCount = savedKeys ? savedKeys.split(',').filter(Boolean).length : 0;
    syncApiConfigUi();
    if (apiHint) apiHint.textContent = 'Đang kiểm tra kết nối /api/v1/recognize/providers...';
    try {
      const res = await fetch('/api/v1/recognize/providers', { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json().catch(() => ({}));
        const poolTotal = info?.gemini?.pool_size ?? keyCount;
        if (apiHint) {
          apiHint.textContent = `Đã kết nối (${saved || 'local'}) · Sẵn sàng ${poolTotal} API Key xoay vòng!`;
        }
        window.dispatchEvent(new CustomEvent('app:class-changed'));
      } else {
        if (apiHint) apiHint.textContent = `Đã lưu (${res.status}) — hãy kiểm tra lại URL Backend.`;
      }
    } catch {
      if (apiHint) apiHint.textContent = 'Đã lưu cấu hình — máy chủ Cloud đang khởi động hoặc chưa chạy.';
    }
  });

  $('resetApiBackendBtn')?.addEventListener('click', () => {
    window.setAiCanvasApiBase?.('');
    window.setAiCanvasGeminiKeys?.('');
    syncApiConfigUi();
    if (apiHint) apiHint.textContent = 'Đã khôi phục cấu hình Backend & Key mặc định của máy chủ.';
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
    if (key === 'q') {
      event.preventDefault();
      toggleBoardLock();
    } else if (key === 'v') {
      event.preventDefault();
      setTool('select', { showGuide: true });
    } else if (key === 'h') {
      event.preventDefault();
      setTool('hand', { showGuide: true });
    } else if (key === 'p') {
      event.preventDefault();
      setTool('pen', { showGuide: true });
    } else if (key === 'g') {
      event.preventDefault();
      setTool('highlighter', { showGuide: true });
    } else if (key === 'e') {
      event.preventDefault();
      setTool('eraser', { showGuide: true });
    } else if (key === 's') {
      event.preventDefault();
      togglePanel('shapes');
    } else if (key === 'l') {
      event.preventDefault();
      setTool('line', { showGuide: true });
    } else if (key === 'r') {
      event.preventDefault();
      toggleRuler();
    } else if (key === 't') {
      event.preventDefault();
      setTool('text');
    } else if (key === 'n') {
      event.preventDefault();
      setTool('note');
    } else if (key === 'o') {
      event.preventDefault();
      $('handwritingTool')?.click();
    }
  });
}

function setupInstantTooltipsAndGuides() {
  const tipEl = $('instantTooltip');
  let showTimer = null;
  let activeAnchor = null;

  function resolveTooltipText(el) {
    if (!el) return '';
    if (el.getAttribute('title')) {
      const rawTitle = el.getAttribute('title');
      el.dataset.tip = rawTitle;
      // Luôn giữ nhãn truy cập (aria-label) cho các nút trên thanh công cụ (vì CSS dùng font-size: 0 cho nút chỉ hiện icon)
      if (!el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', rawTitle);
      }
      el.removeAttribute('title');
    }
    return el.dataset.tip || '';
  }

  function hideInstantTooltip() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    activeAnchor = null;
    if (tipEl) tipEl.hidden = true;
  }
  dismissTooltipCallback = hideInstantTooltip;

  // Chuyển toàn bộ title trên thanh công cụ / thanh trên / chân trang sang tooltip tuỳ biến ngay từ đầu (kể cả nút đang disabled như Hoàn tác / Làm lại)
  document.querySelectorAll('#toolbar [title], .topbar [title], .footer [title]').forEach((el) => {
    resolveTooltipText(el);
  });

  function shouldSuppressTooltip(el) {
    if (!el) return true;
    if (el.getAttribute('aria-expanded') === 'true' || el.classList.contains('is-popover-open')) {
      return true;
    }
    // Các hộp thoại <dialog> nằm ở top-layer của trình duyệt nên không phủ tooltip ngoài body
    if (el.closest('dialog')) {
      resolveTooltipText(el);
      return true;
    }
    return false;
  }

  function positionInstantTooltip(anchor) {
    if (!tipEl || !anchor || shouldSuppressTooltip(anchor)) {
      hideInstantTooltip();
      return;
    }
    const text = resolveTooltipText(anchor);
    if (!text) {
      hideInstantTooltip();
      return;
    }
    // Đặt tạm về góc (0, 0) trước khi đo để tránh bị ép hẹp kích thước khi vị trí cũ sát mép phải màn hình
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    tipEl.textContent = text;
    tipEl.hidden = false;

    const r = anchor.getBoundingClientRect();
    const tw = tipEl.offsetWidth || 120;
    const th = tipEl.offsetHeight || 28;
    const margin = 8;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.bottom + 8;

    const popoverBox = anchor.closest('.more-tools-popover, .system-popover');
    if (anchor.closest('#contextPropertyPanel')) {
      left = r.right + 10;
      top = r.top + r.height / 2 - th / 2;
    } else if (popoverBox && anchor.matches('.more-menu-item, .menu-item')) {
      // Neo sang cạnh bên của menu dọc để không che khuất dòng chức năng kế tiếp bên dưới
      const popRect = popoverBox.getBoundingClientRect();
      if (popRect.left >= tw + 16) {
        left = popRect.left - tw - 10;
        top = r.top + r.height / 2 - th / 2;
      } else if (window.innerWidth - popRect.right >= tw + 16) {
        left = popRect.right + 10;
        top = r.top + r.height / 2 - th / 2;
      } else if (top + th + margin > window.innerHeight) {
        top = r.top - th - 8;
      }
    } else if (top + th + margin > window.innerHeight) {
      top = r.top - th - 8;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  }

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest?.('button, [data-tip], [title]');
    if (!target || target.disabled || shouldSuppressTooltip(target)) {
      hideInstantTooltip();
      return;
    }
    const text = resolveTooltipText(target);
    if (!text) {
      hideInstantTooltip();
      return;
    }
    if (target === activeAnchor) return;
    if (showTimer) clearTimeout(showTimer);
    activeAnchor = target;
    showTimer = setTimeout(() => {
      if (activeAnchor === target) {
        positionInstantTooltip(target);
      }
    }, 55);
  });

  document.addEventListener('pointerout', (event) => {
    if (activeAnchor && !activeAnchor.contains(event.relatedTarget)) {
      hideInstantTooltip();
    }
  });

  document.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('button, [data-tip], [title]');
    if (target && target.matches(':focus-visible')) {
      activeAnchor = target;
      positionInstantTooltip(target);
    }
  });

  document.addEventListener('focusout', hideInstantTooltip);
  document.addEventListener('pointerdown', hideInstantTooltip);
  window.addEventListener('scroll', hideInstantTooltip, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideInstantTooltip();
  });
}

export function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextTool = button.dataset.tool;
      const alreadyActive = state.tool === nextTool;
      setTool(nextTool);
      if (alreadyActive) {
        window.dispatchEvent(new CustomEvent('app:toggle-inspector'));
      }
    });
  });

  $('lockBoardBtn')?.addEventListener('click', () => toggleBoardLock());

  // Bấm nút Tẩy lần 1 -> kích hoạt ngay Tẩy từng phần; đang dùng Tẩy mà bấm thêm lần 2 -> mở menu chọn Tẩy khoanh vùng
  $('eraserMenu')?.addEventListener('click', () => {
    if (!eraserTools.has(state.tool)) {
      setTool('eraser', { showGuide: true });
    } else {
      togglePanel('erasers');
    }
  });

  $('shapeMenu')?.addEventListener('click', () => togglePanel('shapes'));
  $('colorMenu')?.addEventListener('click', () => togglePanel('colors'));
  $('aiStudioMenuBtn')?.addEventListener('click', () => togglePanel('aiStudio'));
  $('openGeo3dFromMoreBtn')?.addEventListener('click', () => {
    closePanels();
    $('geometry3dTool')?.click();
  });

  // Đóng menu mở rộng (⋮) khi chọn tính năng (giữ mở khi bật/tắt công tắc Tự động)
  $('aiToolsPopover')?.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (btn && btn.id !== 'autoAiToggle') {
      closePanels();
    }
  });

  ui.color?.addEventListener('input', syncColorSelection);
  ui.width?.addEventListener('input', syncWidthSelection);
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
    const clickedInsideToolbar = toolbar?.contains(event.target);
    const clickedInsidePopover = Boolean(event.target.closest?.('.tool-popover'));
    if (!clickedInsideToolbar && !clickedInsidePopover) {
      closePanels();
    }
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
  setupInstantTooltipsAndGuides();

  if (toolbar) {
    const syncToolbarScrollCue = () => {
      const atEnd = toolbar.scrollWidth <= toolbar.clientWidth + 4 ||
        toolbar.scrollLeft + toolbar.clientWidth >= toolbar.scrollWidth - 6;
      toolbar.classList.toggle('is-scroll-end', atEnd);
    };
    toolbar.addEventListener('scroll', syncToolbarScrollCue, { passive: true });
    window.addEventListener('resize', syncToolbarScrollCue, { passive: true });
    requestAnimationFrame(syncToolbarScrollCue);
  }
}
