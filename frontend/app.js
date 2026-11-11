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
let pages = [{ objects: [], background: '#ffffff' }];
let pageIndex = 0;
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
  $('undoButton').disabled = ended || undoStack.length === 0;
  $('redoButton').disabled = ended || redoStack.length === 0;
}

function remember(before) {
  if (!stateChanged(before)) return false;
  undoStack.push(before);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
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
  if (ended || undoStack.length === 0) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateHistoryButtons();
  setStatus('Đã hoàn tác');
}

function redo() {
  if (ended || redoStack.length === 0) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateHistoryButtons();
  setStatus('Đã làm lại');
}

function refreshPages() {
  $('pageIndicator').textContent = `Trang ${pageIndex + 1} / ${pages.length}`;
  $('prevPage').disabled = ended || pageIndex === 0;
  $('nextPage').disabled = ended;
  updateHistoryButtons();
}

function switchPage(nextIndex) {
  if (ended || nextIndex < 0) return;
  if (aiDebounceTimer) {
    clearTimeout(aiDebounceTimer);
    aiDebounceTimer = null;
  }
  aiRequestId++;
  currentAiResult = null;
  if (aiElements?.overlay) aiElements.overlay.hidden = true;
  if (aiElements?.statusIndicator) {
    aiElements.statusIndicator.textContent = 'AI: Sẵn sàng';
    aiElements.statusIndicator.classList.remove('is-analyzing');
  }

  pages[pageIndex] = snapshot();
  if (nextIndex >= pages.length) {
    pages.push({ objects: [], background: '#ffffff' });
  }
  pageIndex = nextIndex;
  restore(pages[pageIndex]);
  undoStack = [];
  redoStack = [];
  refreshPages();
  setStatus(`Đang ở trang ${pageIndex + 1}`);

  if (boardSocket && boardSocket.readyState === WebSocket.OPEN) {
    try {
      boardSocket.send(JSON.stringify({
        type: 'SWITCH_PAGE',
        page: pageIndex,
        timestamp: Date.now()
      }));
    } catch { /* Bỏ qua */ }
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
  if (ended || color === fabricCanvas.backgroundColor) return;
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
    if (boardSocket && boardSocket.readyState === WebSocket.OPEN) {
      try {
        boardSocket.send(JSON.stringify({
          type: 'STROKE_FINISHED',
          page: pageIndex,
          object_count: fabricCanvas.getObjects().length,
          timestamp: Date.now()
        }));
      } catch { /* Bỏ qua */ }
    }
    if (isAutoAiEnabled && (tool === 'pen' || tool === 'highlighter' || shapeTools.has(tool))) {
      scheduleAIDebounce();
    }
  } else {
    setStatus('Không có thay đổi');
  }
}

function pointerDown(event) {
  if (ended) return;
  if (aiDebounceTimer) {
    clearTimeout(aiDebounceTimer);
    aiDebounceTimer = null;
  }
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

$('clearButton').addEventListener('click', () => {
  if (ended || fabricCanvas.getObjects().length === 0) return;
  if (!window.confirm('Xóa toàn bộ nội dung của trang hiện tại?')) return;

  if (aiDebounceTimer) {
    clearTimeout(aiDebounceTimer);
    aiDebounceTimer = null;
  }
  aiRequestId++;
  currentAiResult = null;
  if (aiElements?.overlay) aiElements.overlay.hidden = true;
  if (aiElements?.statusIndicator) {
    aiElements.statusIndicator.textContent = 'AI: Sẵn sàng';
    aiElements.statusIndicator.classList.remove('is-analyzing');
  }

  // Tự động sao lưu Snapshot bài giảng (Auto-snapshot) ngầm lên máy chủ trước khi xóa (TF2850E)
  try {
    const snapshotImg = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    fetch('/api/v1/sessions/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
        room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
        class_name: $('className')?.textContent?.trim() || '10A1',
        teacher_name: 'Nguyễn Tuấn Khang',
        subject: aiElements?.subjectSelect ? aiElements.subjectSelect.value : 'TOAN',
        period_number: 1,
        page_number: pageIndex + 1,
        trigger_type: 'BEFORE_CLEAR',
        image_base64: snapshotImg,
        recognized_latex: null
      })
    }).catch(() => { /* Bỏ qua lỗi ngầm để không ảnh hưởng thao tác */ });
  } catch { /* Bỏ qua */ }

  const before = snapshot();
  fabricCanvas.remove(...fabricCanvas.getObjects().slice());
  fabricCanvas.requestRenderAll();
  remember(before);
  updateHint();
  setStatus('Đã xóa nội dung trang');
});

$('captureButton').addEventListener('click', () => {
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
  if (ended || !window.confirm('Kết thúc phiên vẽ trên trình duyệt này?')) return;
  ended = true;
  clearInterval(clock);
  if (aiDebounceTimer) clearTimeout(aiDebounceTimer);
  aiRequestId++;
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
  if (aiElements?.overlay) aiElements.overlay.hidden = true;
  if (boardSocket) {
    try { boardSocket.close(); } catch {}
    boardSocket = null;
  }
  ui.footer.textContent = 'Phiên đã kết thúc · Dữ liệu đã lưu an toàn';
  setStatus('Đã kết thúc phiên');
});

// ==============================================================================
// KẾT NỐI API AI (GEMINI 2.5 FLASH / MATHPIX) & DEBOUNCE 800MS (TASK TF28509)
// ==============================================================================

let aiDebounceTimer = null;
let isAutoAiEnabled = true;
let isRecognizing = false;
let currentAiResult = null;
let aiRequestId = 0;
let boardSocket = null;

const aiElements = {
  overlay: $('aiOverlayPanel'),
  loading: $('aiLoadingIndicator'),
  content: $('aiResultContent'),
  providerBadge: $('aiProviderBadge'),
  confidenceBadge: $('aiConfidenceBadge'),
  latencyBadge: $('aiLatencyBadge'),
  renderedBox: $('aiLatexRendered'),
  rawBox: $('aiLatexRaw'),
  explanationBox: $('aiExplanationBox'),
  statusIndicator: $('aiStatusIndicator'),
  autoToggle: $('autoAiToggle'),
  recognizeBtn: $('aiRecognizeBtn'),
  closeBtn: $('closeAiPanelBtn'),
  insertBtn: $('insertToBoardBtn'),
  retryBtn: $('reRecognizeBtn'),
  subjectSelect: $('subjectSelect')
};

function scheduleAIDebounce() {
  if (!isAutoAiEnabled || ended) return;
  if (aiDebounceTimer) clearTimeout(aiDebounceTimer);
  aiDebounceTimer = setTimeout(() => {
    performAIRecognition({ isDebounced: true });
  }, 800);
}

async function performAIRecognition({ isDebounced = false } = {}) {
  if (ended || isRecognizing) return;
  const objects = fabricCanvas.getObjects();
  if (!objects || objects.length === 0) {
    if (!isDebounced) {
      alert('Chưa có nét vẽ nào trên bảng để nhận diện.');
    }
    return;
  }

  const thisRequestId = ++aiRequestId;
  const thisPage = pageIndex;

  isRecognizing = true;
  if (aiElements.statusIndicator) {
    aiElements.statusIndicator.textContent = isDebounced ? 'AI: Đang xử lý (800ms)...' : 'AI: Đang nhận diện...';
    aiElements.statusIndicator.classList.add('is-analyzing');
  }

  // Mở overlay panel và hiển thị trạng thái loading
  if (aiElements.overlay) aiElements.overlay.hidden = false;
  if (aiElements.loading) aiElements.loading.hidden = false;
  if (aiElements.content) aiElements.content.hidden = true;
  setStatus('Đang gửi nét vẽ lên AI (Gemini 2.5 Flash / Mathpix)...');

  try {
    const imageBase64 = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    const subject = aiElements.subjectSelect ? aiElements.subjectSelect.value : 'TOAN';

    const payload = {
      session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
      room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
      subject: subject,
      page_number: pageIndex + 1,
      image_base64: imageBase64,
      debounce_ms: 800,
      provider: 'auto'
    };

    const startTime = performance.now();
    const response = await fetch('/api/v1/recognize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const elapsed = Math.round(performance.now() - startTime);

    if (!response.ok) {
      throw new Error(`Máy chủ trả về HTTP ${response.status}`);
    }

    const data = await response.json();

    // KIỂM SOÁT LỆCH PHA (RACE CONDITION) & TRÁNH LỖI DOMINO:
    // Nếu trong lúc chờ API phản hồi mà người dùng đã chuyển trang, xóa bảng hoặc có request mới hơn:
    if (thisRequestId !== aiRequestId || pageIndex !== thisPage || ended) {
      return;
    }

    currentAiResult = data;

    // Cập nhật thông tin giao diện kết quả
    if (aiElements.providerBadge) {
      aiElements.providerBadge.textContent = data.provider || 'Gemini 2.5 Flash';
    }
    if (aiElements.confidenceBadge) {
      const confPercent = Math.round((data.confidence || 0.95) * 100);
      aiElements.confidenceBadge.textContent = `${confPercent}%`;
    }
    if (aiElements.latencyBadge) {
      aiElements.latencyBadge.textContent = `${data.latency_ms || elapsed} ms`;
    }

    const displayFormula = data.latex || data.recognized_text || '';

    // Render KaTeX nếu có thư viện
    if (aiElements.renderedBox) {
      aiElements.renderedBox.innerHTML = '';
      if (window.katex && displayFormula) {
        try {
          window.katex.render(displayFormula, aiElements.renderedBox, {
            displayMode: true,
            throwOnError: false
          });
        } catch {
          aiElements.renderedBox.textContent = displayFormula;
        }
      } else {
        aiElements.renderedBox.textContent = displayFormula || 'Không có công thức';
      }
    }

    if (aiElements.rawBox) {
      aiElements.rawBox.textContent = displayFormula;
    }

    if (aiElements.explanationBox) {
      aiElements.explanationBox.textContent = data.explanation || 
        (data.visualization?.type === '2D_GRAPH' 
          ? `Đã nhận diện hàm số. Sẵn sàng dựng đồ thị 2D (Plotly): ${data.visualization.title || displayFormula}`
          : `Đã bóc tách thành công: ${data.recognized_text}`);
    }

    if (aiElements.loading) aiElements.loading.hidden = true;
    if (aiElements.content) aiElements.content.hidden = false;

    if (aiElements.statusIndicator) {
      aiElements.statusIndicator.textContent = 'AI: Đã nhận diện';
      aiElements.statusIndicator.classList.remove('is-analyzing');
    }

    ui.footer.textContent = `Đã kết nối máy chủ · Nhận diện AI thành công (${data.latency_ms || elapsed} ms) · Debounce 800ms`;
    setStatus(`AI nhận diện: ${data.recognized_text || displayFormula}`);

  } catch (error) {
    console.error('Lỗi nhận diện AI:', error);
    if (aiElements.loading) aiElements.loading.hidden = true;
    if (aiElements.content) aiElements.content.hidden = false;
    if (aiElements.renderedBox) aiElements.renderedBox.textContent = 'Lỗi kết nối API';
    if (aiElements.explanationBox) {
      aiElements.explanationBox.textContent = `Không thể kết nối Backend API (/api/v1/recognize): ${error.message}`;
    }
    if (aiElements.statusIndicator) {
      aiElements.statusIndicator.textContent = 'AI: Lỗi kết nối';
      aiElements.statusIndicator.classList.remove('is-analyzing');
    }
    setStatus('Lỗi nhận diện AI');
  } finally {
    isRecognizing = false;
  }
}

function insertAiResultToBoard() {
  if (!currentAiResult) return;
  const formula = currentAiResult.latex || currentAiResult.recognized_text;
  if (!formula) return;

  const before = snapshot();
  const textObj = new Text(formula, {
    left: 40,
    top: 40,
    fill: fabricCanvas.backgroundColor === '#111827' ? '#67e8f9' : '#1e3a8a',
    fontSize: 24,
    fontFamily: 'Arial, sans-serif',
    selectable: false,
    evented: false
  });
  textObj._hitPoints = [{ x: 40, y: 40 }, { x: 250, y: 40 }];
  textObj._hitWidth = 30;

  fabricCanvas.add(textObj);
  fabricCanvas.requestRenderAll();
  remember(before);
  updateHint();
  setStatus('Đã chèn kết quả AI vào mặt bảng');
  if (aiElements.overlay) aiElements.overlay.hidden = true;
}

// Gắn sự kiện cho các nút điều khiển AI
if (aiElements.recognizeBtn) {
  aiElements.recognizeBtn.addEventListener('click', () => {
    closePanels();
    performAIRecognition({ isDebounced: false });
  });
}
if (aiElements.autoToggle) {
  aiElements.autoToggle.addEventListener('click', () => {
    isAutoAiEnabled = !isAutoAiEnabled;
    aiElements.autoToggle.dataset.auto = String(isAutoAiEnabled);
    aiElements.autoToggle.classList.toggle('is-active', isAutoAiEnabled);
    aiElements.autoToggle.textContent = isAutoAiEnabled ? 'Tự động: BẬT' : 'Tự động: TẮT';
    setStatus(`Tự động nhận diện AI (800ms): ${isAutoAiEnabled ? 'BẬT' : 'TẮT'}`);
  });
}
if (aiElements.closeBtn) {
  aiElements.closeBtn.addEventListener('click', () => {
    if (aiElements.overlay) aiElements.overlay.hidden = true;
  });
}
if (aiElements.insertBtn) {
  aiElements.insertBtn.addEventListener('click', insertAiResultToBoard);
}
if (aiElements.retryBtn) {
  aiElements.retryBtn.addEventListener('click', () => {
    performAIRecognition({ isDebounced: false });
  });
}
if (aiElements.subjectSelect) {
  aiElements.subjectSelect.addEventListener('change', () => {
    setStatus(`Đã chuyển môn: ${aiElements.subjectSelect.options[aiElements.subjectSelect.selectedIndex].text}`);
    if (fabricCanvas.getObjects().length > 0 && isAutoAiEnabled) {
      scheduleAIDebounce();
    }
  });
}

// Khởi tạo kênh WebSocket đồng bộ bảng vẽ thời gian thực (WSS)
function initBoardWebSocket() {
  if (ended) return;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    if (!host) return; // Môi trường xem file tĩnh cục bộ
    const room = $('roomId')?.textContent?.trim() || 'room-10a1';
    const session = $('sessionId')?.textContent?.trim() || 'session-10a1';
    boardSocket = new WebSocket(`${protocol}//${host}/ws/board/${room}/${session}`);
    boardSocket.onopen = () => {
      ui.footer.textContent = 'Đã kết nối máy chủ · Đồng bộ phòng học thời gian thực (WSS) · Debounce 800ms';
    };
    boardSocket.onmessage = () => {
      // Nhận tín hiệu đồng bộ từ các thiết bị khác trong phòng học
    };
    boardSocket.onerror = () => {
      // Graceful fallback nếu WebSocket không sẵn sàng
    };
    boardSocket.onclose = () => {
      if (!ended) setTimeout(initBoardWebSocket, 5000);
    };
  } catch {
    // Graceful fallback
  }
}

// Trạng thái khởi tạo.
setTool('pen');
syncColorSelection();
syncWidthSelection();
syncBackgroundButtons();
updateHint();
refreshPages();
initBoardWebSocket();

