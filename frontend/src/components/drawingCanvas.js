import { Path, Text } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, previewCanvas, previewContext, fabricCanvas, ui, state, toolNames, shapeTools, setStatus } from '../utils/context.js';
import { isPalmTouch, getPoint } from '../utils/pointer.js';
import { createPath, drawRuler, previewShape, isNearObject, intersects, makeShape, makeRuler } from '../utils/geometry.js';
import { snapshot, restore, remember, updateHint } from './history.js';
import { closePanels } from './toolbar.js';

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
    if (state.stroke) state.stroke.renderedPoints = 0;
  }
  previewCanvas.style.width = `${width}px`;
  previewCanvas.style.height = `${height}px`;
  previewContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  fabricCanvas.requestRenderAll();
  if (state.stroke) schedulePreview();
}

function clearPreview() {
  if (state.previewFrame) cancelAnimationFrame(state.previewFrame);
  state.previewFrame = 0;
  previewContext.clearRect(0, 0, previewCanvas.clientWidth, previewCanvas.clientHeight);
}

function renderPreview() {
  state.previewFrame = 0;
  if (!state.stroke) return;
  const points = state.stroke.points;
  if (!points.length) return;
  const end = points.at(-1);

  if (state.tool === 'pen' || state.tool === 'highlighter') {
    // Chỉ vẽ các điểm mới trong mỗi frame để tránh tính lại toàn bộ nét dài.
    const firstUnpainted = state.stroke.renderedPoints;
    previewContext.save();
    previewContext.globalAlpha = state.tool === 'highlighter' ? 0.35 : 1;
    previewContext.strokeStyle = state.stroke.color;
    previewContext.fillStyle = state.stroke.color;
    previewContext.lineCap = 'round';
    previewContext.lineJoin = 'round';

    for (let i = firstUnpainted; i < points.length; i++) {
      const p = points[i];
      const radius = Math.max(0.65, state.stroke.width * (0.25 + p.pressure * 0.75) / 2);
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
    state.stroke.renderedPoints = points.length;
    previewContext.restore();
  } else {
    previewContext.clearRect(0, 0, previewCanvas.clientWidth, previewCanvas.clientHeight);
    if (state.tool === 'eraser') {
      previewContext.beginPath();
      previewContext.arc(end.x, end.y, state.stroke.width / 2, 0, Math.PI * 2);
      previewContext.strokeStyle = '#ef4444';
      previewContext.lineWidth = 1.5;
      previewContext.stroke();
    } else if (points.length > 1) {
      previewContext.save();
      previewContext.strokeStyle = state.tool === 'areaEraser' ? '#ef4444' : state.stroke.color;
      previewContext.lineWidth = state.tool === 'areaEraser' ? 1.5 : state.stroke.width;
      previewContext.setLineDash(state.tool === 'areaEraser' ? [6, 5] : []);
      if (state.tool === 'ruler') drawRuler(previewContext, points[0], end, state.stroke.color);
      else previewShape(previewContext, points[0], end, state.tool);
      previewContext.restore();
    }
  }
  // Ước lượng khoảng thời gian xử lý sự kiện -> vẽ xong khung hình,
  // không đo độ trễ hiển thị thực tế của màn hình.
  const frameDelay = Math.max(0, performance.now() - state.lastInputTime);
  ui.latency.textContent = `Độ trễ xử lý: ${frameDelay.toFixed(1)} ms`;
  ui.latency.classList.toggle('is-fast', frameDelay < 16);
  ui.latency.classList.toggle('is-slow', frameDelay >= 16);
}

function schedulePreview() {
  if (!state.previewFrame) state.previewFrame = requestAnimationFrame(renderPreview);
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
  if (!state.stroke) return;
  const point = getPoint(event);
  const previous = state.stroke.points.at(-1);
  // Loại các điểm trùng nhau để giảm lượng tính toán và nét không bị răng cưa.
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return;
  state.stroke.points.push(point);
  if (state.tool === 'eraser') {
    state.stroke.modified = eraseAt(point, state.stroke.width / 2) || state.stroke.modified;
  }
  state.lastInputTime = performance.now();
  schedulePreview();
}

export function finishStroke(commit) {
  if (!state.stroke) return;
  const finished = state.stroke;
  state.stroke = null;
  state.activePointer = null;
  state.penInUse = false;
  state.activePointerType = null;
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
  if (state.tool === 'pen' || state.tool === 'highlighter') {
    const pathData = createPath(points, finished.width);
    if (pathData) {
      const object = new Path(pathData, {
        fill: finished.color,
        opacity: state.tool === 'highlighter' ? 0.35 : 1,
        selectable: false, evented: false, objectCaching: false
      });
      object._hitPoints = points.slice();
      object._hitWidth = finished.width;
      fabricCanvas.add(object);
    }
  } else if (state.tool === 'areaEraser' && points.length > 1) {
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
  } else if (state.tool === 'ruler' && points.length > 1) {
    const ruler = makeRuler(first, last, finished.color);
    if (ruler) fabricCanvas.add(ruler);
  } else if (shapeTools.has(state.tool) && points.length > 1) {
    const distance = Math.hypot(last.x - first.x, last.y - first.y);
    if (distance > 2) {
      const shape = makeShape(first, last, state.tool, finished.color, finished.width);
      if (shape) fabricCanvas.add(shape);
    }
  }
  fabricCanvas.requestRenderAll();
  updateHint();
  if (remember(finished.before)) {
    ui.input.textContent = `Đã hoàn thành: ${toolNames[state.tool]}`;
    setStatus('Đã cập nhật bảng');
  } else {
    setStatus('Không có thay đổi');
  }
}

function pointerDown(event) {
  if (state.ended || state.pageBusy) return;
  const pointerType = event.pointerType;
  if (pointerType === 'pen') state.lastPenSeenAt = performance.now();

  // Palm Rejection: lọc tiếp xúc lớn, ngón thứ hai và touch gần lần bút Stylus.
  if (pointerType === 'touch' && (
    state.penInUse || isPalmTouch(event) || !event.isPrimary ||
    performance.now() - state.lastPenSeenAt < 650
  )) return;
  if (pointerType === 'mouse' && event.button !== 0) return;

  // Bút Stylus được ưu tiên nếu ngón tay đã chạm vào bảng trước đó.
  if (state.activePointer !== null) {
    if (pointerType === 'pen' && state.activePointerType === 'touch') {
      finishStroke(false);
    } else {
      return;
    }
  }
  event.preventDefault();
  closePanels();

  if (state.tool === 'text') {
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

  state.activePointer = event.pointerId;
  state.activePointerType = pointerType;
  state.penInUse = pointerType === 'pen';
  const width = Number(ui.width.value);
  state.stroke = {
    points: [], before: snapshot(), modified: false,
    color: ui.color.value,
    width: width * (state.tool === 'eraser' ? 4 : state.tool === 'highlighter' ? 4 : 1),
    renderedPoints: 0
  };
  try { surface.setPointerCapture(event.pointerId); } catch { /* Thiết bị có thể không hỗ trợ. */ }
  addPoint(event);
  ui.input.textContent = `Đang dùng: ${toolNames[state.tool]} (${pointerType})`;
  setStatus('Đang thao tác');
}

function pointerMove(event) {
  if (event.pointerType === 'pen') state.lastPenSeenAt = performance.now();
  if (state.ended || event.pointerId !== state.activePointer || !state.stroke) return;
  event.preventDefault();
  const events = event.getCoalescedEvents?.();
  if (events?.length) {
    for (const pointEvent of events) addPoint(pointEvent);
  } else {
    addPoint(event);
  }
}

function pointerUp(event) {
  if (event.pointerId !== state.activePointer || !state.stroke) return;
  event.preventDefault();
  if (event.pointerType === 'pen') state.lastPenSeenAt = performance.now();
  addPoint(event);
  finishStroke(true);
}

function pointerCancel(event) {
  if (event.pointerId !== state.activePointer || !state.stroke) return;
  finishStroke(false);
}

export function setupDrawingCanvas() {
  new ResizeObserver(resizeCanvas).observe(stage);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  surface.addEventListener('pointerdown', pointerDown, { passive: false });
  surface.addEventListener('pointermove', pointerMove, { passive: false });
  surface.addEventListener('pointerup', pointerUp, { passive: false });
  surface.addEventListener('pointercancel', pointerCancel, { passive: false });
  surface.addEventListener('lostpointercapture', pointerCancel);
  stage.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('blur', () => {
    if (state.stroke) finishStroke(false);
    closePanels();
  });
}
