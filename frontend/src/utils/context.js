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
  backgroundColor: '#ffffff'
});
export const surface = fabricCanvas.upperCanvasEl;
surface.style.touchAction = 'none';

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
  pen: 'Bút vẽ', highlighter: 'Bút dạ quang', eraser: 'Tẩy nét',
  areaEraser: 'Tẩy vùng', line: 'Đường thẳng', triangle: 'Tam giác',
  circle: 'Hình tròn', ellipse: 'Hình elip', ruler: 'Thước kẻ ảo', text: 'Chữ'
};
export const shapeTools = new Set(['line', 'triangle', 'circle', 'ellipse']);
export const eraserTools = new Set(['eraser', 'areaEraser']);
export const panels = {
  erasers: { button: $('eraserMenu'), panel: $('eraserOptions') },
  shapes: { button: $('shapeMenu'), panel: $('shapeOptions') },
  colors: { button: $('colorMenu'), panel: $('colorOptions') }
};
export const blankPage = () => ({ objects: [], background: '#ffffff' });
export const state = {
  tool: 'pen', activePointer: null, penInUse: false,
  activePointerType: null, lastPenSeenAt: -Infinity,
  stroke: null, previewFrame: 0, lastInputTime: 0,
  undoStack: [], redoStack: [],
  pages: [blankPage()], pageIndex: 0, pageBusy: false, ended: false
};
export function setStatus(message) {
  ui.save.textContent = message;
}
