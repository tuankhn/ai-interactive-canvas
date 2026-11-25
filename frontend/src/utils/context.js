import { Canvas } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

// Khởi tạo một Fabric Canvas duy nhất và giữ trạng thái dùng chung.
// Đặt tại utils để khớp 3 thư mục src/components, src/pages, src/utils theo cấu trúc dự án.
export const $ = (id) => document.getElementById(id);
export const stage = $('canvasStage');
export const toolbar = $('toolbar');
export const previewCanvas = $('previewCanvas');
export const previewContext = previewCanvas.getContext('2d');
export const fabricCanvas = new Canvas('boardCanvas', {
  selection: false,
  skipTargetFind: true,
  renderOnAddRemove: false,
  backgroundColor: ''
});
export const surface = fabricCanvas.upperCanvasEl;
surface.style.touchAction = 'none';

export function isDarkBoardActive() {
  return (
    (typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'dark') ||
    Boolean(stage?.classList?.contains('is-dark-board')) ||
    fabricCanvas?.backgroundColor === '#111827'
  );
}

export function withOpaqueBoardExport(callback, lightBg = '', darkBg = '', options = {}) {
  const keepCurrentViewport = Boolean(options?.keepCurrentViewport);
  const prevBg = fabricCanvas.backgroundColor;
  const prevVpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  const resolvedLight =
    typeof lightBg === 'string' && lightBg
      ? lightBg
      : state.customBoardBgLight || '#F4F0E8';
  const resolvedDark =
    typeof darkBg === 'string' && darkBg
      ? darkBg
      : state.customBoardBgDark || '#191816';

  // Nếu người dùng đã kéo bảng vô hạn ra ngoài khung nhìn, tự động căn khung bao trọn mọi nét vẽ khi chụp Snapshot / AI toàn bảng
  if (!keepCurrentViewport) {
    const objs = fabricCanvas.getObjects();
    const cw = fabricCanvas.getWidth() || 1280;
    const ch = fabricCanvas.getHeight() || 720;
    if (objs.length > 0 && cw > 40 && ch > 40) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      objs.forEach((o) => {
        const b = o.getBoundingRect();
        if (!b) return;
        minX = Math.min(minX, b.left);
        minY = Math.min(minY, b.top);
        maxX = Math.max(maxX, b.left + b.width);
        maxY = Math.max(maxY, b.top + b.height);
      });
      const z = prevVpt[0] || 1;
      const viewLeft = -prevVpt[4] / z;
      const viewTop = -prevVpt[5] / z;
      const viewRight = (cw - prevVpt[4]) / z;
      const viewBottom = (ch - prevVpt[5]) / z;
      const clipped =
        minX < viewLeft || minY < viewTop || maxX > viewRight || maxY > viewBottom;
      if (clipped && Number.isFinite(minX) && Number.isFinite(maxX)) {
        const pad = 48;
        const contentW = Math.max(200, maxX - minX + pad * 2);
        const contentH = Math.max(160, maxY - minY + pad * 2);
        const fitZoom = Math.min(1.5, Math.max(0.15, Math.min(cw / contentW, ch / contentH)));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        fabricCanvas.setViewportTransform([
          fitZoom,
          0,
          0,
          fitZoom,
          cw / 2 - cx * fitZoom,
          ch / 2 - cy * fitZoom,
        ]);
      }
    }
  }

  fabricCanvas.backgroundColor = isDarkBoardActive() ? resolvedDark : resolvedLight;
  fabricCanvas.renderAll();
  try {
    return callback();
  } finally {
    fabricCanvas.backgroundColor = prevBg || '';
    fabricCanvas.setViewportTransform(prevVpt);
    fabricCanvas.renderAll();
  }
}

export const ui = {
  hint: $('canvasHint'),
  input: $('inputStatus'),
  latency: $('latencyStatus'),
  save: $('saveState'),
  color: $('colorPicker'),
  width: $('widthRange'),
  widthValue: $('widthValue'),
  footer: $('footerStatus')
};
export const toolNames = {
  select: 'Chọn & Di chuyển', hand: 'Kéo bảng', pen: 'Bút vẽ', highlighter: 'Bút dạ quang', eraser: 'Tẩy nét',
  areaEraser: 'Tẩy khoanh vùng', line: 'Đoạn thẳng', triangle: 'Tam giác',
  circle: 'Hình tròn', ellipse: 'Hình elip', ruler: 'Thước kẻ ảo', text: 'Chữ', note: 'Giấy Note'
};
export const shapeTools = new Set(['line', 'triangle', 'circle', 'ellipse']);
export const eraserTools = new Set(['eraser', 'areaEraser']);
export const panels = {
  erasers: { button: $('eraserMenu'), panel: $('eraserOptions') },
  shapes: { button: $('shapeMenu'), panel: $('shapeOptions') },
  colors: { button: $('colorMenu'), panel: $('colorOptions') },
  aiStudio: { button: $('aiStudioMenuBtn'), panel: $('aiToolsPopover') }
};
export const blankPage = () => ({
  objects: [],
  background:
    typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'dark'
      ? '#111827'
      : '#ffffff',
});
export const FONT_FAMILY_MAP = {
  hand: "'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive",
  sans: "'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "'Georgia', 'Cambria', 'Times New Roman', serif",
};
export const state = {
  tool: 'pen', activePointer: null, penInUse: false,
  activePointerType: null, lastPenSeenAt: -Infinity,
  stroke: null, previewFrame: 0, lastInputTime: 0,
  undoStack: [], redoStack: [],
  pages: [blankPage()], pageIndex: 0, pageBusy: false, ended: false,
  boardLocked: false,
  strokeStyle: 'solid', // 'solid' | 'dashed' | 'dotted'
  shapeFill: 'transparent',
  noteBg: '#FFE066',
  opacity: 100,
  fontFamily: 'sans', // 'hand' | 'sans' | 'mono' | 'serif'
  fontSize: 26, // S=18, M=26, L=36, XL=50
  textAlign: 'left', // 'left' | 'center' | 'right'
};
export function setStatus(message) {
  ui.save.textContent = message;
}
