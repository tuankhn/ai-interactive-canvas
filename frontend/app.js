import {
  Canvas, Path, Line, Triangle, Ellipse, Circle, Rect, Text, Group
} from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

const $ = (id) => document.getElementById(id);
const stage = $('canvasStage');
const toolbar = $('toolbar');
const previewCanvas = $('previewCanvas');
const previewContext = previewCanvas.getContext('2d');
const fabricCanvas = new Canvas('boardCanvas', {
  selection: false,
  skipTargetFind: true,
  renderOnAddRemove: false,
  backgroundColor: '#ffffff'
});

const ui = {
  hint: $('canvasHint'),
  input: $('inputStatus'),
  latency: $('latencyStatus'),
  save: $('saveState'),
  color: $('colorPicker'),
  width: $('widthRange'),
  widthValue: $('widthValue'),
  footer: $('footerStatus')
};

const toolNames = {
  pen: 'Bút vẽ',
  highlighter: 'Bút dạ quang',
  eraser: 'Tẩy nét',
  areaEraser: 'Tẩy vùng',
  line: 'Đường thẳng',
  triangle: 'Tam giác',
  circle: 'Hình tròn',
  ellipse: 'Hình elip',
  ruler: 'Thước kẻ ảo',
  text: 'Chữ'
};

const shapeTools = new Set(['line', 'triangle', 'circle', 'ellipse']);
const eraserTools = new Set(['eraser', 'areaEraser']);
const panels = {
  erasers: { button: $('eraserMenu'), panel: $('eraserOptions') },
  shapes: { button: $('shapeMenu'), panel: $('shapeOptions') },
  colors: { button: $('colorMenu'), panel: $('colorOptions') }
};

let tool = 'pen';
let activePointer = null;
let penInUse = false;
let activePointerType = null;
let lastPenSeenAt = -Infinity;
let stroke = null;
let previewFrame = 0;
let lastInputTime = 0;
let undoStack = [];
let redoStack = [];
// Mỗi trang được giữ dưới dạng JSON của Fabric; nội dung hiện tại được tự động lưu.
const PAGE_STORAGE_KEY = 'ai-interactive-canvas:pages:v1';
const blankPage = () => ({ objects: [], background: '#ffffff' });
let pages = [blankPage()];
let pageIndex = 0;
let pageBusy = false;
let ended = false;

const surface = fabricCanvas.upperCanvasEl;
surface.style.touchAction = 'none';

function setStatus(message) {
  ui.save.textContent = message;
}

function snapshot() {
  return {
    objects: fabricCanvas.getObjects().slice(),
    background: fabricCanvas.backgroundColor || '#ffffff'
  };
}

function stateChanged(before) {
  const currentObjects = fabricCanvas.getObjects();
  return before.background !== fabricCanvas.backgroundColor ||
    before.objects.length !== currentObjects.length ||
    before.objects.some((object, index) => object !== currentObjects[index]);
}

function updateHistoryButtons() {
  $('undoButton').disabled = ended || pageBusy || undoStack.length === 0;
  $('redoButton').disabled = ended || pageBusy || redoStack.length === 0;
}

function remember(before) {
  if (!stateChanged(before)) return false;
  undoStack.push(before);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
  persistPages();
  return true;
}

function updateHint() {
  const noObjects = fabricCanvas.getObjects().length === 0;
  ui.hint.classList.toggle('is-hidden', !noObjects);
  ui.hint.classList.toggle('on-dark', fabricCanvas.backgroundColor === '#111827');
}

function syncBackgroundButtons() {
  const bg = fabricCanvas.backgroundColor || '#ffffff';
  document.querySelectorAll('[data-background]').forEach((button) => {
    const selected = button.dataset.background === bg;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function restore(state) {
  const existing = fabricCanvas.getObjects().slice();
  if (existing.length) fabricCanvas.remove(...existing);
  if (state.objects.length) fabricCanvas.add(...state.objects);
  fabricCanvas.backgroundColor = state.background;
  stage.style.backgroundColor = state.background;
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
}

function undo() {
  if (ended || pageBusy || undoStack.length === 0) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã hoàn tác');
}

function redo() {
  if (ended || pageBusy || redoStack.length === 0) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã làm lại');
}

// Dữ liệu JSON được lưu riêng cho từng trang, không cần Fabric object còn ở canvas.
function serializeCurrentPage() {
  return {
    objects: fabricCanvas.getObjects().map((object) =>
      object.toObject(['_hitPoints', '_hitWidth'])
    ),
    background: fabricCanvas.backgroundColor || '#ffffff'
  };
}

function persistPages() {
  if (pageBusy) return false;
  pages[pageIndex] = serializeCurrentPage();
  try {
    localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify({ version: 1, pageIndex, pages }));
    ui.footer.textContent = 'Trạng thái: Đã tự động lưu trên trình duyệt · Chưa đồng bộ máy chủ';
    return true;
  } catch (error) {
    console.warn('Không thể lưu trang vào localStorage:', error);
    ui.footer.textContent = 'Cảnh báo: Không thể tự động lưu (có thể đã đầy bộ nhớ)';
    return false;
  }
}

function syncLoadedCanvas() {
  stage.style.backgroundColor = fabricCanvas.backgroundColor || '#ffffff';
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
}

// Fabric 6 loadFromJSON trả về Promise, phải await trước khi chuyển tiếp.
async function loadPageData(data) {
  const safePage = data && Array.isArray(data.objects) ? data : blankPage();
  await fabricCanvas.loadFromJSON({
    objects: safePage.objects,
    background: safePage.background || '#ffffff'
  }, (original, object) => {
    if (!object) return;
    object.set({ selectable: false, evented: false, objectCaching: false });
    if (Array.isArray(original._hitPoints)) object._hitPoints = original._hitPoints;
    if (Number.isFinite(original._hitWidth)) object._hitWidth = original._hitWidth;
  });
  syncLoadedCanvas();
}

function refreshPages() {
  $('pageIndicator').textContent = `Trang ${pageIndex + 1} / ${pages.length}`;
  $('prevPage').disabled = ended || pageBusy || pageIndex === 0;
  $('nextPage').disabled = ended || pageBusy || pageIndex >= pages.length - 1;
  $('addPageButton').disabled = ended || pageBusy;
  // Luôn giữ lại ít nhất một trang bảng.
  $('deletePageButton').disabled = ended || pageBusy || pages.length <= 1;
  updateHistoryButtons();
}

async function switchPage(nextIndex) {
  if (ended || pageBusy || stroke || nextIndex < 0 ||
      nextIndex >= pages.length || nextIndex === pageIndex) return;

  pages[pageIndex] = serializeCurrentPage();
  const oldIndex = pageIndex;
  pageBusy = true;
  closePanels();
  refreshPages();

  try {
    await loadPageData(pages[nextIndex]);
    pageIndex = nextIndex;
    undoStack = [];
    redoStack = [];
    setStatus(`Đang ở trang ${pageIndex + 1}`);
  } catch (error) {
    console.error('Không thể chuyển trang:', error);
    try { await loadPageData(pages[oldIndex]); } catch (restoreError) {
      console.error('Không thể khôi phục trang cũ:', restoreError);
    }
    setStatus('Không thể chuyển trang');
  } finally {
    pageBusy = false;
    refreshPages();
    persistPages();
  }
}

async function addPage() {
  if (ended || pageBusy || stroke) return;
  const newPageIndex = pages.length;
  pages.push(blankPage());
  await switchPage(newPageIndex);
  if (pageIndex !== newPageIndex) {
    // Không giữ trang rỗng nếu khởi tạo/chuyển trang thất bại.
    pages.splice(newPageIndex, 1);
    refreshPages();
    persistPages();
  }
}

// Xóa HẲN trang đang mở. Chỉ thực hiện sau khi người dùng xác nhận trong dialog.
// Nếu còn trang kế tiếp thì mở trang đó; nếu xóa trang cuối thì mở trang trước.
async function deleteCurrentPage() {
  if (ended || pageBusy || stroke || pages.length <= 1) return false;

  pages[pageIndex] = serializeCurrentPage();
  const removedIndex = pageIndex;
  const removedPage = pages[removedIndex];
  const targetIndex = removedIndex < pages.length - 1 ? removedIndex + 1 : removedIndex - 1;
  const targetPage = pages[targetIndex];

  pageBusy = true;
  closePanels();
  refreshPages();
  try {
    // Chỉ xóa trang khỏi mảng sau khi đã nạp thành công trang kế tiếp.
    await loadPageData(targetPage);
    pages.splice(removedIndex, 1);
    pageIndex = targetIndex > removedIndex ? targetIndex - 1 : targetIndex;
    undoStack = [];
    redoStack = [];
    setStatus(`Đã xóa trang ${removedIndex + 1}; còn ${pages.length} trang`);
    return true;
  } catch (error) {
    console.error('Không thể xóa trang:', error);
    try { await loadPageData(removedPage); } catch (restoreError) {
      console.error('Không thể khôi phục trang vừa xóa:', restoreError);
    }
    setStatus('Không thể xóa trang. Các trang vẫn được giữ nguyên.');
    return false;
  } finally {
    pageBusy = false;
    refreshPages();
    persistPages();
  }
}

async function restoreSavedPages() {
  pageBusy = true;
  refreshPages();
  try {
    const raw = localStorage.getItem(PAGE_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version === 1 && Array.isArray(saved.pages) && saved.pages.length > 0 &&
          saved.pages.every((page) => page && Array.isArray(page.objects) && typeof page.background === 'string')) {
        pages = saved.pages;
        pageIndex = Number.isInteger(saved.pageIndex)
          ? Math.max(0, Math.min(saved.pageIndex, pages.length - 1)) : 0;
        await loadPageData(pages[pageIndex]);
        setStatus(`Đã khôi phục ${pages.length} trang`);
      }
    }
  } catch (error) {
    console.warn('Không thể khôi phục dữ liệu đã lưu:', error);
    pages = [blankPage()];
    pageIndex = 0;
    await loadPageData(pages[0]);
    setStatus('Không thể khôi phục bản lưu cũ');
  } finally {
    pageBusy = false;
    refreshPages();
  }
}

function closePanels() {
  Object.values(panels).forEach(({ button, panel }) => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
}

function togglePanel(name) {
  if (ended) return;

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

function setTool(next) {
  if (ended) return;
  tool = next;
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

function syncColorSelection() {
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.color.toLowerCase() === ui.color.value.toLowerCase());
  });
}

function syncWidthSelection() {
  ui.widthValue.textContent = `${ui.width.value} px`;
  document.querySelectorAll('[data-width]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.width === ui.width.value);
  });
}

function setBackground(color) {
  if (ended || pageBusy || color === fabricCanvas.backgroundColor) return;
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

function resizeCanvas() {
  // clientWidth/clientHeight không tính viền đứt nét của canvas-stage.
  const width = Math.floor(stage.clientWidth);
  const height = Math.floor(stage.clientHeight);
  if (width < 1 || height < 1) return;

  // Tránh resize liên tục khiến nét đang vẽ giật hoặc bị xóa preview.
  if (fabricCanvas.getWidth() !== width || fabricCanvas.getHeight() !== height) {
    fabricCanvas.setDimensions({ width, height });
  }

  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (previewCanvas.width !== pixelWidth || previewCanvas.height !== pixelHeight) {
    previewCanvas.width = pixelWidth;
    previewCanvas.height = pixelHeight;
    if (stroke) stroke.renderedPoints = 0;
  }
  previewCanvas.style.width = `${width}px`;
  previewCanvas.style.height = `${height}px`;
  previewContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  fabricCanvas.requestRenderAll();
  if (stroke) schedulePreview();
}

new ResizeObserver(resizeCanvas).observe(stage);
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function isPalmTouch(event) {
  return event.pointerType === 'touch' && (event.width > 28 || event.height > 28);
}

function getPoint(event) {
  // Tính từ phần canvas thực tế (không tính viền stage 2 px).
  const rect = surface.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pointerType === 'pen' && event.pressure > 0
      ? Math.max(0.08, Math.min(1, event.pressure))
      : 0.5
  };
}

function createPath(points, baseWidth) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    const r = Math.max(0.7, baseWidth * (0.25 + p.pressure * 0.75) / 2);
    return `M ${p.x + r} ${p.y} A ${r} ${r} 0 1 0 ${p.x - r} ${p.y} A ${r} ${r} 0 1 0 ${p.x + r} ${p.y} Z`;
  }
  const left = [], right = [];
  points.forEach((p, i) => {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const radius = Math.max(0.65, baseWidth * (0.25 + p.pressure * 0.75) / 2);
    left.push({ x: p.x - dy / length * radius, y: p.y + dx / length * radius });
    right.push({ x: p.x + dy / length * radius, y: p.y - dx / length * radius });
  });
  const outline = [...left, ...right.reverse()];
  return `M ${outline.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
}

function drawRuler(context, start, end, color) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  context.save();
  context.translate(start.x, start.y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = 'rgba(250, 204, 21, 0.22)';
  context.fillRect(0, -12, length, 26);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeRect(0, -12, length, 26);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(length, 0);
  const count = Math.min(300, Math.floor(length / 10));
  for (let i = 0; i <= count; i++) {
    const x = i * 10;
    const tick = i % 5 === 0 ? 10 : 6;
    context.moveTo(x, -12);
    context.lineTo(x, -12 + tick);
  }
  context.stroke();
  context.font = '12px Arial';
  context.fillStyle = color;
  context.textAlign = 'center';
  context.fillText(`${Math.round(length)} px`, length / 2, -19);
  context.restore();
}

function previewShape(context, start, end, kind) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  context.beginPath();
  if (kind === 'line') {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  } else if (kind === 'triangle') {
    context.moveTo(x + w / 2, y);
    context.lineTo(x + w, y + h);
    context.lineTo(x, y + h);
    context.closePath();
  } else if (kind === 'circle') {
    context.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else if (kind === 'ellipse') {
    context.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.1), Math.max(h / 2, 0.1), 0, 0, Math.PI * 2);
  } else if (kind === 'areaEraser') {
    context.rect(x, y, w, h);
  }
  context.stroke();
  if (kind === 'areaEraser') {
    context.fillStyle = 'rgba(239,68,68,.09)';
    context.fill();
  }
}

function clearPreview() {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  previewContext.clearRect(0, 0, previewCanvas.clientWidth, previewCanvas.clientHeight);
}

function renderPreview() {
  previewFrame = 0;
  if (!stroke) return;
  const points = stroke.points;
  if (!points.length) return;
  const end = points.at(-1);

  if (tool === 'pen' || tool === 'highlighter') {
    // Chỉ vẽ các điểm mới trong mỗi frame để tránh tính lại toàn bộ nét dài.
    const firstUnpainted = stroke.renderedPoints;
    previewContext.save();
    previewContext.globalAlpha = tool === 'highlighter' ? 0.35 : 1;
    previewContext.strokeStyle = stroke.color;
    previewContext.fillStyle = stroke.color;
    previewContext.lineCap = 'round';
    previewContext.lineJoin = 'round';

    for (let i = firstUnpainted; i < points.length; i++) {
      const p = points[i];
      const radius = Math.max(0.65, stroke.width * (0.25 + p.pressure * 0.75) / 2);
      if (i === 0) {
        previewContext.beginPath();
        previewContext.arc(p.x, p.y, radius, 0, Math.PI * 2);
        previewContext.fill();
      } else {
        const previous = points[i - 1];
        previewContext.lineWidth = radius * 2;
        previewContext.beginPath();
        previewContext.moveTo(previous.x, previous.y);
        previewContext.lineTo(p.x, p.y);
        previewContext.stroke();
      }
    }
    stroke.renderedPoints = points.length;
    previewContext.restore();
  } else {
    previewContext.clearRect(0, 0, previewCanvas.clientWidth, previewCanvas.clientHeight);
    if (tool === 'eraser') {
      previewContext.beginPath();
      previewContext.arc(end.x, end.y, stroke.width / 2, 0, Math.PI * 2);
      previewContext.strokeStyle = '#ef4444';
      previewContext.lineWidth = 1.5;
      previewContext.stroke();
    } else if (points.length > 1) {
      previewContext.save();
      previewContext.strokeStyle = tool === 'areaEraser' ? '#ef4444' : stroke.color;
      previewContext.lineWidth = tool === 'areaEraser' ? 1.5 : stroke.width;
      previewContext.setLineDash(tool === 'areaEraser' ? [6, 5] : []);
      if (tool === 'ruler') drawRuler(previewContext, points[0], end, stroke.color);
      else previewShape(previewContext, points[0], end, tool);
      previewContext.restore();
    }
  }
  // Ước lượng khoảng thời gian xử lý sự kiện -> vẽ xong khung hình,
  // không đo độ trễ hiển thị thực tế của màn hình.
  const frameDelay = Math.max(0, performance.now() - lastInputTime);
  ui.latency.textContent = `Độ trễ xử lý: ${frameDelay.toFixed(1)} ms`;
  ui.latency.classList.toggle('is-fast', frameDelay < 16);
  ui.latency.classList.toggle('is-slow', frameDelay >= 16);
}

function schedulePreview() {
  if (!previewFrame) previewFrame = requestAnimationFrame(renderPreview);
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function isNearObject(object, point, radius) {
  const bbox = object.getBoundingRect();
  if (point.x + radius < bbox.left || point.x - radius > bbox.left + bbox.width ||
      point.y + radius < bbox.top || point.y - radius > bbox.top + bbox.height) return false;
  const points = object._hitPoints;
  if (!points || points.length === 0) return true;
  const threshold = radius + (object._hitWidth || 1) / 2;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(point, points[i - 1], points[i]) <= threshold) return true;
  }
  return false;
}

function intersects(a, b) {
  return a.left <= b.left + b.width && a.left + a.width >= b.left &&
    a.top <= b.top + b.height && a.top + a.height >= b.top;
}

function eraseAt(point, radius) {
  let changed = false;
  fabricCanvas.getObjects().slice().forEach((object) => {
    if (!isNearObject(object, point, radius)) return;
    fabricCanvas.remove(object);
    changed = true;
  });
  if (changed) fabricCanvas.requestRenderAll();
  return changed;
}

function addPoint(event) {
  if (!stroke) return;
  const point = getPoint(event);
  const previous = stroke.points.at(-1);
  // Loại các điểm trùng nhau để giảm lượng tính toán và nét không bị răng cưa.
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return;
  stroke.points.push(point);
  if (tool === 'eraser') {
    stroke.modified = eraseAt(point, stroke.width / 2) || stroke.modified;
  }
  lastInputTime = performance.now();
  schedulePreview();
}

function sampledEllipse(cx, cy, rx, ry) {
  return Array.from({ length: 49 }, (_, i) => {
    const theta = i / 48 * Math.PI * 2;
    return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
  });
}

function makeShape(start, end, kind, color, width) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const options = {
    fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth: width,
    strokeUniform: true, selectable: false, evented: false, objectCaching: false
  };
  let object, hitPoints;
  if (kind === 'line') {
    object = new Line([start.x, start.y, end.x, end.y], options);
    hitPoints = [start, end];
  } else if (kind === 'triangle') {
    object = new Triangle({ ...options, left: x, top: y, width: Math.max(1, w), height: Math.max(1, h) });
    hitPoints = [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: x + w / 2, y }];
  } else if (kind === 'circle') {
    const radius = Math.max(0.5, Math.min(w, h) / 2);
    const cx = x + w / 2, cy = y + h / 2;
    object = new Circle({ ...options, left: cx - radius, top: cy - radius, radius });
    hitPoints = sampledEllipse(cx, cy, radius, radius);
  } else if (kind === 'ellipse') {
    const rx = Math.max(0.5, w / 2), ry = Math.max(0.5, h / 2);
    object = new Ellipse({ ...options, left: x, top: y, rx, ry });
    hitPoints = sampledEllipse(x + w / 2, y + h / 2, rx, ry);
  }
  if (object) {
    object._hitPoints = hitPoints;
    object._hitWidth = width;
  }
  return object;
}

function makeRuler(start, end, color) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 3) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const coord = (along, normal) => ({
    x: start.x + ux * along + nx * normal,
    y: start.y + uy * along + ny * normal
  });
  const objects = [];
  const corners = [coord(0, -12), coord(length, -12), coord(length, 14), coord(0, 14)];
  const border = `M ${corners[0].x} ${corners[0].y} L ${corners[1].x} ${corners[1].y} L ${corners[2].x} ${corners[2].y} L ${corners[3].x} ${corners[3].y} Z`;
  objects.push(new Path(border, {
    fill: 'rgba(250,204,21,.22)', stroke: color, strokeWidth: 1,
    selectable: false, evented: false
  }));
  objects.push(new Line([start.x, start.y, end.x, end.y], { stroke: color, strokeWidth: 1 }));
  for (let i = 0; i <= Math.min(300, Math.floor(length / 10)); i++) {
    const x = i * 10;
    const tick = i % 5 === 0 ? 10 : 6;
    const a = coord(x, -12);
    const b = coord(x, -12 + tick);
    objects.push(new Line([a.x, a.y, b.x, b.y], { stroke: color, strokeWidth: 1 }));
  }
  const labelPos = coord(length / 2, -23);
  objects.push(new Text(`${Math.round(length)} px`, {
    left: labelPos.x, top: labelPos.y,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
    originX: 'center', originY: 'center',
    fontSize: 12, fill: color
  }));
  const group = new Group(objects, {
    selectable: false, evented: false, objectCaching: false, subTargetCheck: false
  });
  group._hitPoints = [start, end];
  group._hitWidth = 32;
  return group;
}

function finishStroke(commit) {
  if (!stroke) return;
  const finished = stroke;
  stroke = null;
  activePointer = null;
  penInUse = false;
  activePointerType = null;
  clearPreview();

  if (!commit) {
    // Tẩy nét có thể đã xóa đối tượng trong lúc rê; hủy thao tác sẽ khôi phục.
    if (finished.modified) restore(finished.before);
    setStatus('Đã hủy nét');
    return;
  }

  const points = finished.points;
  const first = points[0];
  const last = points.at(-1);
  if (tool === 'pen' || tool === 'highlighter') {
    const pathData = createPath(points, finished.width);
    if (pathData) {
      const object = new Path(pathData, {
        fill: finished.color,
        opacity: tool === 'highlighter' ? 0.35 : 1,
        selectable: false, evented: false, objectCaching: false
      });
      object._hitPoints = points.slice();
      object._hitWidth = finished.width;
      fabricCanvas.add(object);
    }
  } else if (tool === 'areaEraser' && points.length > 1) {
    const rect = {
      left: Math.min(first.x, last.x),
      top: Math.min(first.y, last.y),
      width: Math.abs(first.x - last.x),
      height: Math.abs(first.y - last.y)
    };
    if (rect.width > 2 || rect.height > 2) {
      fabricCanvas.getObjects().slice().forEach((object) => {
        if (intersects(object.getBoundingRect(), rect)) fabricCanvas.remove(object);
      });
    }
  } else if (tool === 'ruler' && points.length > 1) {
    const ruler = makeRuler(first, last, finished.color);
    if (ruler) fabricCanvas.add(ruler);
  } else if (shapeTools.has(tool) && points.length > 1) {
    const distance = Math.hypot(last.x - first.x, last.y - first.y);
    if (distance > 2) {
      const shape = makeShape(first, last, tool, finished.color, finished.width);
      if (shape) fabricCanvas.add(shape);
    }
  }
  fabricCanvas.requestRenderAll();
  updateHint();
  if (remember(finished.before)) {
    ui.input.textContent = `Đã hoàn thành: ${toolNames[tool]}`;
    setStatus('Đã cập nhật bảng');
  } else {
    setStatus('Không có thay đổi');
  }
}

function pointerDown(event) {
  if (ended || pageBusy) return;
  const pointerType = event.pointerType;
  if (pointerType === 'pen') lastPenSeenAt = performance.now();

  // Palm Rejection: lọc tiếp xúc lớn, ngón thứ hai và touch gần lần bút Stylus.
  if (pointerType === 'touch' && (
    penInUse || isPalmTouch(event) || !event.isPrimary ||
    performance.now() - lastPenSeenAt < 650
  )) return;
  if (pointerType === 'mouse' && event.button !== 0) return;

  // Bút Stylus được ưu tiên nếu ngón tay đã chạm vào bảng trước đó.
  if (activePointer !== null) {
    if (pointerType === 'pen' && activePointerType === 'touch') {
      finishStroke(false);
    } else {
      return;
    }
  }
  event.preventDefault();
  closePanels();

  if (tool === 'text') {
    const p = getPoint(event);
    const text = window.prompt('Nhập nội dung chữ cần thêm vào bảng:');
    if (!text || !text.trim()) return;
    const before = snapshot();
    fabricCanvas.add(new Text(text.trim(), {
      left: p.x, top: p.y, fill: ui.color.value,
      fontSize: Math.max(18, Number(ui.width.value) * 5),
      selectable: false, evented: false
    }));
    fabricCanvas.requestRenderAll();
    remember(before);
    updateHint();
    setStatus('Đã thêm chữ');
    return;
  }

  activePointer = event.pointerId;
  activePointerType = pointerType;
  penInUse = pointerType === 'pen';
  const width = Number(ui.width.value);
  stroke = {
    points: [], before: snapshot(), modified: false,
    color: ui.color.value,
    width: width * (tool === 'eraser' ? 4 : tool === 'highlighter' ? 4 : 1),
    renderedPoints: 0
  };
  try { surface.setPointerCapture(event.pointerId); } catch { /* Thiết bị có thể không hỗ trợ. */ }
  addPoint(event);
  ui.input.textContent = `Đang dùng: ${toolNames[tool]} (${pointerType})`;
  setStatus('Đang thao tác');
}

function pointerMove(event) {
  if (event.pointerType === 'pen') lastPenSeenAt = performance.now();
  if (ended || event.pointerId !== activePointer || !stroke) return;
  event.preventDefault();
  const events = event.getCoalescedEvents?.();
  if (events?.length) {
    for (const pointEvent of events) addPoint(pointEvent);
  } else {
    addPoint(event);
  }
}

function pointerUp(event) {
  if (event.pointerId !== activePointer || !stroke) return;
  event.preventDefault();
  if (event.pointerType === 'pen') lastPenSeenAt = performance.now();
  addPoint(event);
  finishStroke(true);
}

function pointerCancel(event) {
  if (event.pointerId !== activePointer || !stroke) return;
  finishStroke(false);
}

surface.addEventListener('pointerdown', pointerDown, { passive: false });
surface.addEventListener('pointermove', pointerMove, { passive: false });
surface.addEventListener('pointerup', pointerUp, { passive: false });
surface.addEventListener('pointercancel', pointerCancel, { passive: false });
surface.addEventListener('lostpointercapture', pointerCancel);
stage.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('blur', () => {
  if (stroke) finishStroke(false);
  closePanels();
});

// Điều khiển các nút trên thanh công cụ.
document.querySelectorAll('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});
$('eraserMenu').addEventListener('click', () => togglePanel('erasers'));
$('shapeMenu').addEventListener('click', () => togglePanel('shapes'));
$('colorMenu').addEventListener('click', () => togglePanel('colors'));
$('undoButton').addEventListener('click', undo);
$('redoButton').addEventListener('click', redo);
$('prevPage').addEventListener('click', () => switchPage(pageIndex - 1));
$('nextPage').addEventListener('click', () => switchPage(pageIndex + 1));
$('addPageButton').addEventListener('click', addPage);

const deletePageDialog = $('deletePageDialog');
const deletePageDialogTitle = $('deletePageDialogTitle');
const deletePageDialogDescription = $('deletePageDialogDescription');
const deletePageDialogError = $('deletePageDialogError');
const cancelDeletePageButton = $('cancelDeletePageButton');
const deletePageWithoutSavingButton = $('deletePageWithoutSavingButton');
const saveAndDeletePageButton = $('saveAndDeletePageButton');
let deleteDialogBusy = false;

function setDeleteDialogBusy(busy) {
  deleteDialogBusy = busy;
  cancelDeletePageButton.disabled = busy;
  deletePageWithoutSavingButton.disabled = busy;
  saveAndDeletePageButton.disabled = busy;
  saveAndDeletePageButton.textContent = busy ? 'Đang tạo ảnh...' : 'Lưu ảnh rồi xóa';
}

deletePageDialog.addEventListener('cancel', (event) => {
  if (deleteDialogBusy) event.preventDefault();
});

$('deletePageButton').addEventListener('click', () => {
  if (ended || pageBusy || stroke || pages.length <= 1) return;
  closePanels();
  deletePageDialogTitle.textContent = `Xóa trang ${pageIndex + 1}?`;
  deletePageDialogDescription.textContent =
    `Trang ${pageIndex + 1} sẽ biến mất khỏi danh sách và không thể hoàn tác. ` +
    `${pages.length - 1} trang còn lại sẽ được giữ nguyên.`;
  deletePageDialogError.textContent = '';
  deletePageDialogError.hidden = true;
  deletePageDialog.showModal();
});

cancelDeletePageButton.addEventListener('click', () => deletePageDialog.close());
deletePageWithoutSavingButton.addEventListener('click', async () => {
  if (deleteDialogBusy || pageBusy || ended) return;
  deletePageDialog.close(); // Chính popup đã là bước xác nhận.
  await deleteCurrentPage();
});

saveAndDeletePageButton.addEventListener('click', async () => {
  if (deleteDialogBusy || pageBusy || ended) return;
  deletePageDialogError.hidden = true;
  setDeleteDialogBusy(true);
  try {
    const filename = await downloadCurrentPageSnapshot();
    deletePageDialog.close();
    // Browser chỉ xác nhận đã yêu cầu tải về, không xác nhận tệp đã nằm trên ổ đĩa.
    if (window.confirm(`Đã yêu cầu tải ${filename}.\n\n` +
      `Sau khi kiểm tra ảnh tải về, chọn OK để xóa hẳn trang ${pageIndex + 1}; ` +
      'chọn Hủy để giữ nguyên trang.')) {
      await deleteCurrentPage();
    } else {
      setStatus('Đã giữ nguyên trang; hãy kiểm tra ảnh đã tải');
    }
  } catch (error) {
    console.error('Không thể tạo snapshot trước khi xóa trang:', error);
    deletePageDialogError.textContent = error.message || 'Không thể tạo ảnh. Trang chưa bị xóa.';
    deletePageDialogError.hidden = false;
  } finally {
    setDeleteDialogBusy(false);
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
  if (event.key === 'Escape') { closePanels(); return; }
  if ($('clearBoardDialog').open || deletePageDialog.open) return;
  const el = document.activeElement;
  if (el?.matches('input,textarea,select') || el?.isContentEditable) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  } else if (event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  }
});

// Chụp ảnh PNG của CHỈ trang đang mở; không tác động đến các trang khác.
async function downloadCurrentPageSnapshot() {
  const filename = `snapshot-trang-${pageIndex + 1}-${new Date().toISOString().slice(0, 10)}.png`;
  const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.append(link);
  link.click();
  link.remove();
  return filename;
}

// Xóa NỘI DUNG trang hiện tại, không xóa trang hay các trang đã tạo.
// Sử dụng remember() để lưu localStorage và cho phép Hoàn tác ngay trên trang này.
function clearCurrentPage() {
  if (ended || pageBusy || stroke) return;
  const objects = fabricCanvas.getObjects().slice();
  if (!objects.length) {
    setStatus(`Trang ${pageIndex + 1} đang trống`);
    return;
  }

  const before = snapshot();
  fabricCanvas.remove(...objects);
  fabricCanvas.requestRenderAll();
  updateHint();
  remember(before); // Ghi vào lịch sử hoàn tác và chỉ cập nhật trang hiện tại trong localStorage.
  setStatus(`Đã xóa nét vẽ ở trang ${pageIndex + 1}; các trang khác được giữ nguyên`);
}

const clearDialog = $('clearBoardDialog');
const clearDialogError = $('clearDialogError');
const cancelClearButton = $('cancelClearButton');
const clearWithoutSavingButton = $('clearWithoutSavingButton');
const saveAndClearButton = $('saveAndClearButton');

function setClearDialogBusy(busy) {
  cancelClearButton.disabled = busy;
  clearWithoutSavingButton.disabled = busy;
  saveAndClearButton.disabled = busy;
  saveAndClearButton.textContent = busy ? 'Đang tạo snapshot...' : 'Lưu snapshot rồi xóa';
}

$('clearButton').addEventListener('click', () => {
  if (ended || pageBusy || stroke) return;
  if (fabricCanvas.getObjects().length === 0) {
    setStatus(`Trang ${pageIndex + 1} đang trống`);
    return;
  }
  closePanels();
  clearDialogError.hidden = true;
  clearDialogError.textContent = '';
  clearDialog.showModal();
});

cancelClearButton.addEventListener('click', () => clearDialog.close());
clearWithoutSavingButton.addEventListener('click', () => {
  if (!window.confirm(`Xóa nét vẽ ở trang ${pageIndex + 1} mà không lưu snapshot? Các trang khác sẽ được giữ nguyên.`)) return;
  clearDialog.close();
  clearCurrentPage();
});

saveAndClearButton.addEventListener('click', async () => {
  if (pageBusy || ended) return;
  clearDialogError.hidden = true;
  setClearDialogBusy(true);
  try {
    const filename = await downloadCurrentPageSnapshot();
    clearDialog.close();
    // Tải xuống được yêu cầu chưa có nghĩa tệp đã lưu thành công trên thiết bị.
    if (window.confirm(`Đã yêu cầu tải tệp ${filename}.\n\nChọn OK để xóa nét vẽ CHỈ TRÊN TRANG ${pageIndex + 1} sau khi kiểm tra ảnh tải về. Chọn Hủy để giữ nguyên trang hiện tại.`)) {
      clearCurrentPage();
    } else {
      setStatus('Đã giữ nguyên trang hiện tại; bạn có thể kiểm tra snapshot');
    }
  } catch (error) {
    console.error('Lỗi xuất snapshot:', error);
    clearDialogError.textContent = error.message || 'Không thể lưu snapshot. Bảng chưa bị xóa.';
    clearDialogError.hidden = false;
  } finally {
    setClearDialogBusy(false);
  }
});

$('captureButton').addEventListener('click', () => {
  if (pageBusy || stroke) return;
  closePanels();
  const link = document.createElement('a');
  link.download = `bang-ve-trang-${pageIndex + 1}.png`;
  link.href = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
  document.body.append(link);
  link.click();
  link.remove();
  setStatus('Đã xuất hình PNG');
});

const startedAt = Date.now();
const clock = setInterval(() => {
  if (ended) return;
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, '0');
  const sec = String(seconds % 60).padStart(2, '0');
  $('sessionTimer').textContent = `Đang diễn ra ${min}:${sec}`;
}, 1000);

$('endSession').addEventListener('click', () => {
  if (pageBusy || ended || !window.confirm('Kết thúc phiên vẽ trên trình duyệt này?')) return;
  persistPages();
  ended = true;
  clearInterval(clock);
  closePanels();
  if (stroke) finishStroke(false);
  $('sessionTimer').textContent = 'Đã kết thúc';
  $('endSession').disabled = true;
  surface.style.pointerEvents = 'none';
  toolbar.querySelectorAll('button,input').forEach((control) => {
    if (control.id !== 'captureButton') control.disabled = true;
  });
  $('prevPage').disabled = true;
  $('nextPage').disabled = true;
  $('addPageButton').disabled = true;
  $('deletePageButton').disabled = true;
  ui.footer.textContent = 'Phiên đã kết thúc · Chưa đồng bộ máy chủ';
  setStatus('Đã kết thúc phiên');
});

window.addEventListener('pagehide', () => {
  if (!pageBusy) persistPages();
});

// Trạng thái khởi tạo.
setTool('pen');
syncColorSelection();
syncWidthSelection();
syncBackgroundButtons();
updateHint();
refreshPages();
await restoreSavedPages();
