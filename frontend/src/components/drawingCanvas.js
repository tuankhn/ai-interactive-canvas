import { Path, Text } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, previewCanvas, previewContext, fabricCanvas, ui, state, toolNames, shapeTools, setStatus, isDarkBoardActive, FONT_FAMILY_MAP } from '../utils/context.js';
import { isPalmTouch, getPoint, getScreenPoint, screenToWorld } from '../utils/pointer.js';
import { createPath, createCenterlinePathData, getDashArrayForStyle, drawRuler, previewShape, isNearObject, intersects, makeShape, makeRuler, splitObjectByEraserSweep } from '../utils/geometry.js';
import { snapshot, restore, remember, updateHint } from './history.js';
import { closePanels } from './toolbar.js';
import { scheduleAIDebounce, cancelAIDebounce } from './aiRecognition.js';
import { snapPointToRuler } from './rulerOverlay.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

let activeInlineTextInput = null;
let isSpacePressed = false;
let panDragState = null; // { pointerId, lastX, lastY }
const activeTouches = new Map(); // pointerId -> { x, y }
let pinchState = null; // { dist, midX, midY }

function applyPreviewTransform() {
  const ratio = window.devicePixelRatio || 1;
  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  previewContext.setTransform(
    ratio * vpt[0],
    0,
    0,
    ratio * vpt[3],
    ratio * vpt[4],
    ratio * vpt[5]
  );
}

function wipePreviewBuffer() {
  previewContext.save();
  previewContext.setTransform(1, 0, 0, 1, 0, 0);
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewContext.restore();
}

export function syncInfiniteViewportUI() {
  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const zoom = vpt[0] || 1;
  const panX = vpt[4] || 0;
  const panY = vpt[5] || 0;

  // Đồng bộ lưới chấm mảnh / ô vuông chạy mượt theo thế giới vô hạn
  let worldStep = 20;
  if (zoom < 0.45) worldStep = 40;
  else if (zoom > 2.4) worldStep = 10;
  const screenStep = Math.max(8, worldStep * zoom);
  const offsetX = ((panX % screenStep) + screenStep) % screenStep;
  const offsetY = ((panY % screenStep) + screenStep) % screenStep;

  stage.style.setProperty('--grid-step', `${screenStep.toFixed(2)}px`);
  stage.style.setProperty('--grid-offset-x', `${offsetX.toFixed(2)}px`);
  stage.style.setProperty('--grid-offset-y', `${offsetY.toFixed(2)}px`);

  const zoomResetBtn = $('zoomResetBtn');
  if (zoomResetBtn) {
    zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  }

  applyPreviewTransform();

  // Hiện nút "Quay về nội dung" kiểu Excalidraw khi kéo bảng rời xa hoàn toàn các nét đã vẽ
  const scrollBackBtn = $('scrollBackToContentBtn');
  if (scrollBackBtn) {
    const objects = fabricCanvas.getObjects();
    const cw = stage.clientWidth || 1280;
    const ch = stage.clientHeight || 720;
    if (!objects.length) {
      scrollBackBtn.hidden = true;
    } else {
      const viewRect = {
        left: -panX / zoom,
        top: -panY / zoom,
        width: cw / zoom,
        height: ch / zoom,
      };
      const anyVisible = objects.some((obj) => {
        const b = obj.getBoundingRect();
        return b && intersects(b, viewRect);
      });
      scrollBackBtn.hidden = anyVisible;
    }
  }
}

export function setViewportTransformClean(nextVpt) {
  fabricCanvas.setViewportTransform(nextVpt);
  syncInfiniteViewportUI();
  fabricCanvas.requestRenderAll();
}

export function panBy(dx, dy) {
  if (state.boardLocked) return;
  const vpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  vpt[4] += dx;
  vpt[5] += dy;
  setViewportTransformClean(vpt);
}

export function zoomAt(targetZoom, anchorScreenX, anchorScreenY) {
  if (state.boardLocked) return;
  const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
  const vpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  const oldZoom = vpt[0] || 1;
  const sx = Number.isFinite(anchorScreenX) ? anchorScreenX : (stage.clientWidth || 800) / 2;
  const sy = Number.isFinite(anchorScreenY) ? anchorScreenY : (stage.clientHeight || 600) / 2;

  const wx = (sx - vpt[4]) / oldZoom;
  const wy = (sy - vpt[5]) / oldZoom;
  const nextPanX = sx - wx * clampedZoom;
  const nextPanY = sy - wy * clampedZoom;

  setViewportTransformClean([clampedZoom, 0, 0, clampedZoom, nextPanX, nextPanY]);
}

export function resetViewport() {
  setViewportTransformClean([1, 0, 0, 1, 0, 0]);
  setStatus('Đã đặt lại góc nhìn 100%');
}

export function scrollBackToContent() {
  const objects = fabricCanvas.getObjects();
  if (!objects.length) {
    resetViewport();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objects.forEach((o) => {
    const b = o.getBoundingRect();
    if (!b) return;
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.left + b.width);
    maxY = Math.max(maxY, b.top + b.height);
  });
  if (!Number.isFinite(minX)) {
    resetViewport();
    return;
  }
  const cw = stage.clientWidth || 1280;
  const ch = stage.clientHeight || 720;
  const pad = 80;
  const fitZoom = Math.min(
    1,
    Math.max(0.2, Math.min(cw / Math.max(240, maxX - minX + pad * 2), ch / Math.max(180, maxY - minY + pad * 2)))
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  setViewportTransformClean([
    fitZoom,
    0,
    0,
    fitZoom,
    cw / 2 - cx * fitZoom,
    ch / 2 - cy * fitZoom,
  ]);
  setStatus('Đã đưa nội dung về giữa bảng');
}

/**
 * Gõ chữ trực tiếp không khung viền ngay tại vị trí nhấp chuột trên mặt bảng (chuẩn Excalidraw).
 * Hỗ trợ nhiều dòng (Enter xuống dòng, Esc / Ctrl+Enter hoặc nhấp ra ngoài để hoàn tất)
 * và hỗ trợ nhấp đúp sửa trực tiếp đối tượng chữ đã có trên bảng.
 */
export function openDirectCanvasTextEditor(point, existingTextObj = null) {
  if (activeInlineTextInput) {
    activeInlineTextInput.blur();
  }

  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const zoom = vpt[0] || 1;

  const worldX = existingTextObj ? existingTextObj.left : point.x;
  const worldY = existingTextObj ? existingTextObj.top : point.y;
  const sx = worldX * zoom + vpt[4];
  const sy = worldY * zoom + vpt[5];

  const fontKey = existingTextObj?.meta?.fontKey || state.fontFamily || 'sans';
  const resolvedFontFamily = existingTextObj?.fontFamily || FONT_FAMILY_MAP[fontKey] || FONT_FAMILY_MAP.sans;
  const baseFontSize = existingTextObj ? (existingTextObj.fontSize || 26) : (state.fontSize || 26);
  const strokeColor = existingTextObj ? (existingTextObj.fill || ui.color.value) : ui.color.value;
  const align = existingTextObj ? (existingTextObj.textAlign || state.textAlign || 'left') : (state.textAlign || 'left');
  const textOpacity = existingTextObj ? (existingTextObj.opacity ?? 1) : ((state.opacity ?? 100) / 100);

  if (existingTextObj) {
    existingTextObj.visible = false;
    fabricCanvas.requestRenderAll();
  }

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.value = existingTextObj ? (existingTextObj.text || '') : '';
  textarea.setAttribute('aria-label', 'Gõ chữ trực tiếp lên bảng');
  textarea.className = 'direct-canvas-textarea';

  const scaledFontPx = Math.max(12, baseFontSize * zoom);
  Object.assign(textarea.style, {
    position: 'absolute',
    left: `${sx}px`,
    top: `${sy}px`,
    minWidth: '24px',
    minHeight: `${Math.ceil(scaledFontPx * 1.35)}px`,
    padding: '0',
    margin: '0',
    border: '0',
    borderRadius: '0',
    outline: 'none',
    boxShadow: 'none',
    background: 'transparent',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    fontSize: `${scaledFontPx}px`,
    lineHeight: '1.32',
    fontFamily: resolvedFontFamily,
    textAlign: align,
    color: strokeColor,
    caretColor: strokeColor,
    opacity: String(textOpacity),
    zIndex: '28',
  });

  const autoResize = () => {
    const lines = (textarea.value || ' ').split('\n');
    const longest = Math.max(2, ...lines.map((l) => l.length + 1));
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    const nextW = Math.max(Math.ceil(scaledFontPx * 0.65 * longest), textarea.scrollWidth + 8);
    const nextH = Math.max(Math.ceil(scaledFontPx * 1.35 * lines.length), textarea.scrollHeight + 2);
    textarea.style.width = `${nextW}px`;
    textarea.style.height = `${nextH}px`;
  };

  let finalized = false;
  const finalize = (commitText) => {
    if (finalized) return;
    finalized = true;
    if (activeInlineTextInput === textarea) activeInlineTextInput = null;
    const rawVal = textarea.value.replace(/\s+$/g, '');
    textarea.remove();

    if (state.ended) {
      if (existingTextObj) {
        existingTextObj.visible = true;
        fabricCanvas.requestRenderAll();
      }
      return;
    }

    if (!commitText) {
      if (existingTextObj) {
        existingTextObj.visible = true;
        fabricCanvas.requestRenderAll();
      }
      setStatus('Đã hủy gõ chữ');
      return;
    }

    const before = snapshot();
    if (existingTextObj) {
      if (!rawVal.trim()) {
        fabricCanvas.remove(existingTextObj);
        setStatus('Đã xóa dòng chữ trống');
      } else {
        existingTextObj.visible = true;
        existingTextObj.set({
          text: rawVal,
          fill: strokeColor,
          fontSize: baseFontSize,
          fontFamily: resolvedFontFamily,
          textAlign: align,
          opacity: textOpacity,
        });
        const tw = Math.max(40, existingTextObj.width || 80);
        const th = Math.max(24, existingTextObj.height || baseFontSize);
        existingTextObj._hitPoints = [
          { x: existingTextObj.left, y: existingTextObj.top + th / 2 },
          { x: existingTextObj.left + tw, y: existingTextObj.top + th / 2 },
        ];
        existingTextObj._hitWidth = th;
        existingTextObj.setCoords();
        setStatus('Đã cập nhật nội dung chữ');
      }
      fabricCanvas.requestRenderAll();
      remember(before);
      updateHint();
      window.dispatchEvent(new CustomEvent('app:selection-updated'));
      return;
    }

    if (!rawVal.trim()) return;

    const textObj = new Text(rawVal, {
      left: worldX,
      top: worldY,
      fill: strokeColor,
      fontSize: baseFontSize,
      fontFamily: resolvedFontFamily,
      textAlign: align,
      opacity: textOpacity,
      lineHeight: 1.32,
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    const tw = Math.max(40, textObj.width || 80);
    const th = Math.max(24, textObj.height || baseFontSize);
    textObj._hitPoints = [
      { x: worldX, y: worldY + th / 2 },
      { x: worldX + tw, y: worldY + th / 2 },
    ];
    textObj._hitWidth = th;
    textObj.meta = {
      dataRole: 'user_text',
      fontKey,
    };
    fabricCanvas.add(textObj);
    fabricCanvas.requestRenderAll();
    remember(before);
    updateHint();
    setStatus('Đã ghi chữ lên bảng');
  };

  textarea.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  textarea.addEventListener('input', autoResize);
  textarea.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
      ev.preventDefault();
      finalize(true);
    }
  });
  textarea.addEventListener('blur', () => finalize(true));

  stage.appendChild(textarea);
  activeInlineTextInput = textarea;
  autoResize();
  requestAnimationFrame(() => {
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  });
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
    if (state.stroke) state.stroke.renderedPoints = 0;
  }
  previewCanvas.style.width = `${width}px`;
  previewCanvas.style.height = `${height}px`;
  syncInfiniteViewportUI();
  fabricCanvas.requestRenderAll();
  if (state.stroke) schedulePreview();
}

function clearPreview() {
  if (state.previewFrame) cancelAnimationFrame(state.previewFrame);
  state.previewFrame = 0;
  wipePreviewBuffer();
}

function renderPreview() {
  state.previewFrame = 0;
  if (!state.stroke) return;
  const points = state.stroke.points;
  if (!points.length) return;
  const end = points.at(-1);
  applyPreviewTransform();

  if (state.tool === 'pen' || state.tool === 'highlighter') {
    const strokeAlpha = state.tool === 'highlighter' ? 0.35 : (state.stroke.opacity ?? 1);
    const dashArr = state.tool === 'pen' ? getDashArrayForStyle(state.stroke.strokeStyle, state.stroke.width) : null;
    if (dashArr) {
      wipePreviewBuffer();
      previewContext.save();
      previewContext.globalAlpha = strokeAlpha;
      previewContext.strokeStyle = state.stroke.color;
      previewContext.lineWidth = state.stroke.width;
      previewContext.lineCap = 'round';
      previewContext.lineJoin = 'round';
      previewContext.setLineDash(dashArr);
      previewContext.beginPath();
      previewContext.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        previewContext.lineTo(points[i].x, points[i].y);
      }
      previewContext.stroke();
      previewContext.restore();
      state.stroke.renderedPoints = points.length;
    } else {
      // Chỉ vẽ các điểm mới trong mỗi frame để tránh tính lại toàn bộ nét dài.
      const firstUnpainted = state.stroke.renderedPoints;
      previewContext.save();
      previewContext.globalAlpha = strokeAlpha;
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
    }
  } else {
    wipePreviewBuffer();
    if (state.tool === 'eraser') {
      previewContext.save();
      previewContext.beginPath();
      previewContext.arc(end.x, end.y, state.stroke.width / 2, 0, Math.PI * 2);
      previewContext.fillStyle = 'rgba(201, 100, 66, 0.14)';
      previewContext.fill();
      previewContext.strokeStyle = '#C96442';
      previewContext.lineWidth = 1.5 / (fabricCanvas.getZoom() || 1);
      previewContext.stroke();
      previewContext.restore();
    } else if (points.length > 1) {
      previewContext.save();
      previewContext.globalAlpha = state.tool === 'areaEraser' ? 1 : (state.stroke.opacity ?? 1);
      previewContext.strokeStyle = state.tool === 'areaEraser' ? '#C96442' : state.stroke.color;
      previewContext.lineWidth = state.tool === 'areaEraser' ? 1.5 / (fabricCanvas.getZoom() || 1) : state.stroke.width;
      const dashArr = state.tool === 'areaEraser' ? [6, 5] : (getDashArrayForStyle(state.stroke.strokeStyle, state.stroke.width) || []);
      previewContext.setLineDash(dashArr);
      if (state.tool === 'ruler') drawRuler(previewContext, points[0], end, state.stroke.color);
      else previewShape(previewContext, points[0], end, state.tool, state.stroke.shapeFill);
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

function eraseAt(prevPoint, point, radius) {
  let changed = false;
  const currentList = fabricCanvas.getObjects().slice();
  for (const object of currentList) {
    // Tẩy từng phần thực sự ("đưa đến đâu xoá đến đó") trên mọi nét bút và hình vẽ
    const splitPieces = splitObjectByEraserSweep(object, prevPoint || point, point, radius);
    if (splitPieces !== null) {
      const idx = fabricCanvas.getObjects().indexOf(object);
      fabricCanvas.remove(object);
      if (splitPieces.length > 0) {
        if (idx >= 0) {
          splitPieces.forEach((piece, offset) => {
            fabricCanvas.insertAt(idx + offset, piece);
          });
        } else {
          fabricCanvas.add(...splitPieces);
        }
      }
      changed = true;
      continue;
    }

    // Các đối tượng không tách điểm được (như nhãn nhỏ / chữ ngắn) nếu bị chà trực tiếp cũng được xoá
    if (!(object instanceof Path) && isNearObject(object, point, radius * 0.85)) {
      fabricCanvas.remove(object);
      changed = true;
    }
  }
  if (changed) fabricCanvas.requestRenderAll();
  return changed;
}

function addPoint(event) {
  if (!state.stroke) return;
  let sp = getScreenPoint(event);
  if (state.tool === 'pen' || state.tool === 'highlighter') {
    sp = snapPointToRuler(sp, state.stroke);
  }
  const point = screenToWorld(sp.x, sp.y, sp.pressure);
  const minDelta = 0.35 / (fabricCanvas.getZoom() || 1);
  const previous = state.stroke.points.at(-1);
  // Loại các điểm trùng nhau để giảm lượng tính toán và nét không bị răng cưa.
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minDelta) return;
  state.stroke.points.push(point);
  if (state.tool === 'eraser') {
    state.stroke.modified = eraseAt(previous || point, point, state.stroke.width / 2) || state.stroke.modified;
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
  let createdObject = null;
  if (state.tool === 'pen' || state.tool === 'highlighter') {
    const dashArr = state.tool === 'pen' ? getDashArrayForStyle(finished.strokeStyle, finished.width) : null;
    const strokeOpacity = state.tool === 'highlighter' ? 0.35 : (finished.opacity ?? 1);
    if (dashArr) {
      const dStr = createCenterlinePathData(points);
      if (dStr) {
        const object = new Path(dStr, {
          fill: 'rgba(0,0,0,0)',
          stroke: finished.color,
          strokeWidth: finished.width,
          strokeDashArray: dashArr,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          strokeUniform: true,
          opacity: strokeOpacity,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        object._hitPoints = points.slice();
        object._hitWidth = finished.width;
        object.meta = {
          aiState: 'raw',
          strokeStyle: finished.strokeStyle,
          strokeId: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        };
        fabricCanvas.add(object);
        createdObject = object;
      }
    } else {
      const pathData = createPath(points, finished.width);
      if (pathData) {
        const object = new Path(pathData, {
          fill: finished.color,
          opacity: strokeOpacity,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        object._hitPoints = points.slice();
        object._hitWidth = finished.width;
        object.meta = {
          aiState: 'raw',
          strokeStyle: 'solid',
          strokeId: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        };
        fabricCanvas.add(object);
        createdObject = object;
      }
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
      const shape = makeShape(first, last, state.tool, finished.color, finished.width, {
        fill: finished.shapeFill,
        strokeStyle: finished.strokeStyle,
        opacity: finished.opacity,
      });
      if (shape) {
        fabricCanvas.add(shape);
        createdObject = shape;
      }
    }
  }
  fabricCanvas.requestRenderAll();
  updateHint();
  if (remember(finished.before)) {
    ui.input.textContent = `Đã hoàn thành: ${toolNames[state.tool]}`;
    setStatus('Đã cập nhật bảng');
    const strokeSpan = points.length >= 4 ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
    const isMeaningfulPenStroke = state.tool === 'pen' && createdObject && (points.length >= 6 || strokeSpan >= 8);
    if (isMeaningfulPenStroke && fabricCanvas.getObjects().length > 0) {
      scheduleAIDebounce();
    } else {
      cancelAIDebounce();
    }
    if (createdObject) {
      window.dispatchEvent(new CustomEvent('app:stroke-finished', {
        detail: {
          tool: state.tool,
          points: points.slice(),
          object: createdObject,
          bounds: createdObject.getBoundingRect(),
        },
      }));
    }
  } else {
    setStatus('Không có thay đổi');
  }
}

function shouldStartPan(event) {
  if (state.boardLocked) return false;
  if (state.tool === 'hand') return true;
  if (isSpacePressed) return true;
  if (event.pointerType === 'mouse' && event.button === 1) return true;
  return false;
}

function pointerDown(event) {
  if (state.ended || state.pageBusy) return;
  const pointerType = event.pointerType;
  if (pointerType === 'pen') state.lastPenSeenAt = performance.now();

  // Theo dõi chụm 2 ngón tay trên Tablet / màn hình cảm ứng (khi chưa khoá trang)
  if (!state.boardLocked && pointerType === 'touch' && !state.penInUse) {
    const sp = getScreenPoint(event);
    activeTouches.set(event.pointerId, { x: sp.x, y: sp.y });
    if (activeTouches.size === 2) {
      if (state.stroke) finishStroke(false);
      panDragState = null;
      const pts = Array.from(activeTouches.values());
      pinchState = {
        dist: Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
      event.preventDefault();
      return;
    }
  }

  // Kéo di chuyển bảng vô hạn (công cụ Kéo bảng, giữ phím Space, hoặc nhấn chuột giữa)
  if (shouldStartPan(event)) {
    event.preventDefault();
    closePanels();
    panDragState = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    stage.classList.add('is-panning-active');
    try { surface.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    return;
  }

  // Nhường toàn quyền chuột/bút cho công cụ Chọn & Khoanh vùng (V)
  if (state.tool === 'select') {
    return;
  }

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
  cancelAIDebounce();
  closePanels();
  const aiOverlay = $('aiOverlayPanel');
  if (aiOverlay && !aiOverlay.hidden) {
    aiOverlay.hidden = true;
  }

  if (state.tool === 'text') {
    const p = getPoint(event);
    openDirectCanvasTextEditor(p, null);
    return;
  }

  state.activePointer = event.pointerId;
  state.activePointerType = pointerType;
  state.penInUse = pointerType === 'pen';
  const width = Number(ui.width.value);
  state.stroke = {
    points: [], before: snapshot(), modified: false,
    color: ui.color.value,
    width: width * (state.tool === 'eraser' ? 4.5 : state.tool === 'highlighter' ? 4 : 1),
    strokeStyle: state.strokeStyle || 'solid',
    shapeFill: state.shapeFill || 'transparent',
    opacity: (state.opacity ?? 100) / 100,
    renderedPoints: 0
  };
  try { surface.setPointerCapture(event.pointerId); } catch { /* Thiết bị có thể không hỗ trợ. */ }
  addPoint(event);
  ui.input.textContent = `Đang dùng: ${toolNames[state.tool]} (${pointerType})`;
  setStatus('Đang thao tác');
}

function pointerMove(event) {
  if (event.pointerType === 'pen') state.lastPenSeenAt = performance.now();

  if (event.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
    const sp = getScreenPoint(event);
    activeTouches.set(event.pointerId, { x: sp.x, y: sp.y });
    if (activeTouches.size === 2 && pinchState) {
      event.preventDefault();
      const pts = Array.from(activeTouches.values());
      const nextDist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const nextMidX = (pts[0].x + pts[1].x) / 2;
      const nextMidY = (pts[0].y + pts[1].y) / 2;

      panBy(nextMidX - pinchState.midX, nextMidY - pinchState.midY);
      const currentZoom = fabricCanvas.getZoom() || 1;
      zoomAt(currentZoom * (nextDist / pinchState.dist), nextMidX, nextMidY);

      pinchState = { dist: nextDist, midX: nextMidX, midY: nextMidY };
      return;
    }
  }

  if (panDragState && event.pointerId === panDragState.pointerId) {
    event.preventDefault();
    const dx = event.clientX - panDragState.lastX;
    const dy = event.clientY - panDragState.lastY;
    panDragState.lastX = event.clientX;
    panDragState.lastY = event.clientY;
    panBy(dx, dy);
    return;
  }

  if (state.ended || event.pointerId !== state.activePointer || !state.stroke) return;
  event.preventDefault();
  const events = event.getCoalescedEvents?.();
  if (events?.length) {
    for (const pointEvent of events) addPoint(pointEvent);
  } else {
    addPoint(event);
  }
}

function endTouchOrPan(event) {
  if (event.pointerType === 'touch') {
    activeTouches.delete(event.pointerId);
    if (activeTouches.size < 2) pinchState = null;
  }
  if (panDragState && event.pointerId === panDragState.pointerId) {
    panDragState = null;
    stage.classList.remove('is-panning-active');
    return true;
  }
  return false;
}

function pointerUp(event) {
  if (endTouchOrPan(event)) return;
  if (event.pointerId !== state.activePointer || !state.stroke) return;
  event.preventDefault();
  if (event.pointerType === 'pen') state.lastPenSeenAt = performance.now();
  addPoint(event);
  finishStroke(true);
  syncInfiniteViewportUI();
}

function pointerCancel(event) {
  if (endTouchOrPan(event)) return;
  if (event.pointerId !== state.activePointer || !state.stroke) return;
  finishStroke(false);
  syncInfiniteViewportUI();
}

function onStageWheel(event) {
  if (state.ended) return;
  if (event.target.closest('.ai-overlay-panel, .tool-popover, .context-inspector')) return;
  event.preventDefault();
  if (state.boardLocked) return;

  const rect = surface.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;

  if (event.ctrlKey || event.metaKey || event.altKey) {
    const currentZoom = fabricCanvas.getZoom() || 1;
    const delta = -event.deltaY;
    const factor = Math.exp(delta * 0.0045);
    zoomAt(currentZoom * factor, sx, sy);
  } else {
    const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
    panBy(-dx, -dy);
  }
}

function setupInfiniteViewportControls() {
  stage.addEventListener('wheel', onStageWheel, { passive: false });

  $('zoomInBtn')?.addEventListener('click', () => {
    zoomAt((fabricCanvas.getZoom() || 1) * 1.2);
  });
  $('zoomOutBtn')?.addEventListener('click', () => {
    zoomAt((fabricCanvas.getZoom() || 1) / 1.2);
  });
  $('zoomResetBtn')?.addEventListener('click', () => {
    resetViewport();
  });
  $('scrollBackToContentBtn')?.addEventListener('click', () => {
    scrollBackToContent();
  });

  window.addEventListener('app:reset-viewport', () => {
    resetViewport();
  });
  window.addEventListener('app:sync-viewport', () => {
    syncInfiniteViewportUI();
  });

  document.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    const inField =
      active &&
      (active.matches('input,textarea,select') || active.isContentEditable);
    if (inField || document.querySelector('dialog[open]:not([popover])')) return;

    if (event.code === 'Space' && !event.repeat && !event.ctrlKey && !event.metaKey) {
      if (state.boardLocked) return;
      event.preventDefault();
      isSpacePressed = true;
      stage.classList.add('is-panning');
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key === '0') {
        event.preventDefault();
        resetViewport();
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomAt((fabricCanvas.getZoom() || 1) * 1.2);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomAt((fabricCanvas.getZoom() || 1) / 1.2);
      }
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      isSpacePressed = false;
      if (state.tool !== 'hand') {
        stage.classList.remove('is-panning');
      }
    }
  });
}

export function setupDrawingCanvas() {
  new ResizeObserver(resizeCanvas).observe(stage);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  setupInfiniteViewportControls();

  surface.addEventListener('pointerdown', pointerDown, { passive: false });
  surface.addEventListener('pointermove', pointerMove, { passive: false });
  surface.addEventListener('pointerup', pointerUp, { passive: false });
  surface.addEventListener('pointercancel', pointerCancel, { passive: false });
  surface.addEventListener('lostpointercapture', pointerCancel);
  stage.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('blur', () => {
    isSpacePressed = false;
    activeTouches.clear();
    pinchState = null;
    panDragState = null;
    stage.classList.remove('is-panning-active');
    if (state.tool !== 'hand') stage.classList.remove('is-panning');
    if (state.stroke) finishStroke(false);
    closePanels();
  });
}
