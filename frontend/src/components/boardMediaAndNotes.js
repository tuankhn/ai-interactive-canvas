import { FabricImage, Group, Path, Rect, Shadow, Text } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, fabricCanvas, state, ui, FONT_FAMILY_MAP, setStatus } from '../utils/context.js';
import { getScreenPoint, screenToWorld } from '../utils/pointer.js';
import { snapshot, remember, updateHint } from './history.js';
import { setTool, closePanels } from './toolbar.js';
import { getSafeAreaScreen, clampRange } from '../utils/safeArea.js';

export const STICKY_NOTE_COLORS = [
  { id: 'yellow', label: 'Vàng nắng', hex: '#FFE066' },
  { id: 'pink', label: 'Hồng phấn', hex: '#FCC2D7' },
  { id: 'mint', label: 'Xanh bạc hà', hex: '#B2F2BB' },
  { id: 'sky', label: 'Xanh da trời', hex: '#A5D8FF' },
  { id: 'peach', label: 'Cam đào', hex: '#FFD8A8' },
  { id: 'lavender', label: 'Tím Lavender', hex: '#D0BFFF' },
];

const DEFAULT_NOTE_SIZE = 200;
const MIN_NOTE_SIZE = 130;
const NOTE_PADDING = 18;
const NOTE_LINE_HEIGHT = 1.35;
let lastKnownWorldPointer = null;
let activeNoteEditorEl = null;
let measureCtx = null;

function parseHexColor(value) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(value || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function relativeLuminance(rgb) {
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/**
 * Đảm bảo chữ trên Giấy Note luôn đọc được: nếu màu chữ (vd: chữ sáng của chế độ nền tối)
 * quá chói với màu giấy pastel thì tự dùng màu mực đậm (hoặc sáng nếu giấy tối).
 */
export function ensureReadableNoteText(textColor, bgColor) {
  const t = parseHexColor(textColor);
  const b = parseHexColor(bgColor);
  if (!t || !b) return textColor || '#1F1E1B';
  const lt = relativeLuminance(t);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
  if (ratio >= 3) return textColor;
  return lb > 0.4 ? '#1F1E1B' : '#FAF8F4';
}

function getMeasureCtx() {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}

/**
 * Ngắt dòng chuẩn như trình duyệt (`overflow-wrap: break-word`):
 * - Từ bình thường có khoảng trắng thì ngắt theo từ.
 * - Chuỗi liền không dấu cách quá dài (vd: "ahahahahhahahahaha") tự bẻ ký tự vừa khít lòng Giấy Note.
 */
function wrapTextLinesToWidth(rawText, maxWidthPx, fontSize, fontFamily, fontWeight = '500') {
  const text = String(rawText ?? '').replace(/\r/g, '');
  if (!text) return [''];
  const ctx = getMeasureCtx();
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const safeMaxW = Math.max(40, maxWidthPx - 6);

  const paragraphs = text.split('\n');
  const outLines = [];

  for (const para of paragraphs) {
    if (!para) {
      outLines.push('');
      continue;
    }
    const tokens = para.split(/(\s+)/).filter((t) => t.length > 0);
    let currentLine = '';

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (currentLine.length > 0) {
          const candidate = currentLine + token;
          if (ctx.measureText(candidate).width <= safeMaxW) {
            currentLine = candidate;
          } else {
            outLines.push(currentLine);
            currentLine = '';
          }
        }
        continue;
      }

      const tokenWidth = ctx.measureText(token).width;
      if (tokenWidth <= safeMaxW) {
        const candidate = currentLine ? currentLine + token : token;
        if (ctx.measureText(candidate).width <= safeMaxW) {
          currentLine = candidate;
        } else {
          if (currentLine.trimEnd()) outLines.push(currentLine.trimEnd());
          currentLine = token;
        }
      } else {
        // Chuỗi dài không khoảng trắng -> ngắt từng cụm ký tự vừa khít chiều ngang Note
        for (const ch of Array.from(token)) {
          const candidate = currentLine + ch;
          if (currentLine && ctx.measureText(candidate).width > safeMaxW) {
            outLines.push(currentLine);
            currentLine = ch;
          } else {
            currentLine = candidate;
          }
        }
      }
    }
    outLines.push(currentLine.trimEnd());
  }

  return outLines.length ? outLines : [''];
}

/**
 * Tự động co cỡ chữ (tối thiểu 12px) giống Excalidraw để nhiều dòng chữ vẫn nằm gọn trong Giấy Note.
 */
function layoutStickyNoteText(rawText, innerWidth, innerHeight, preferredFontSize, fontFamily) {
  const maxFS = Math.max(12, Number(preferredFontSize) || 22);
  const minFS = 12;
  let chosenFS = maxFS;
  let lines = wrapTextLinesToWidth(rawText, innerWidth, chosenFS, fontFamily);

  while (chosenFS > minFS && lines.length * chosenFS * NOTE_LINE_HEIGHT > innerHeight) {
    chosenFS -= 1;
    lines = wrapTextLinesToWidth(rawText, innerWidth, chosenFS, fontFamily);
  }

  return {
    wrappedText: lines.join('\n'),
    linesCount: lines.length,
    fontSize: chosenFS,
  };
}

export function isStickyNoteObject(obj) {
  return Boolean(obj && obj.meta?.dataRole === 'sticky_note');
}

function populateStickyNoteHitPoints(groupObj) {
  const b = groupObj.getBoundingRect();
  if (!b) return;
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  groupObj._hitPoints = [
    { x: b.left + 12, y: cy },
    { x: cx, y: cy },
    { x: b.left + b.width - 12, y: cy },
  ];
  groupObj._hitWidth = Math.max(40, b.height);
}

/**
 * Tạo đối tượng Giấy Note (Sticky Note) chuẩn phong cách Excalidraw (bo góc mềm, bóng đổ giấy nổi, gập mép nhẹ).
 */
export function createStickyNoteGroup({
  left,
  top,
  width = DEFAULT_NOTE_SIZE,
  height = DEFAULT_NOTE_SIZE,
  text = '',
  noteBg = '#FFE066',
  textColor = '#1F1E1B',
  fontKey = 'sans',
  fontSize = 22,
  textAlign = 'center',
  angle = 0,
  opacity = 1,
}) {
  const w = Math.max(MIN_NOTE_SIZE, Math.round(width));
  const h = Math.max(MIN_NOTE_SIZE, Math.round(height));
  const resolvedFont = FONT_FAMILY_MAP[fontKey] || FONT_FAMILY_MAP.sans;
  const readableTextColor = ensureReadableNoteText(textColor || '#1F1E1B', noteBg);

  const bgRect = new Rect({
    left: -w / 2,
    top: -h / 2,
    width: w,
    height: h,
    rx: 10,
    ry: 10,
    fill: noteBg,
    stroke: 'rgba(38, 35, 31, 0.12)',
    strokeWidth: 1,
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  });
  bgRect.meta = { dataRole: 'sticky_note_part', part: 'bg' };

  // Nếp gấp góc dưới bên phải tinh tế như tờ giấy ghi chú thật
  const fold = 18;
  const cornerFold = new Path(
    `M ${w / 2 - fold} ${h / 2} L ${w / 2} ${h / 2 - fold} L ${w / 2 - fold} ${h / 2 - fold} Z`,
    {
      fill: 'rgba(38, 35, 31, 0.09)',
      selectable: false,
      evented: false,
    }
  );
  cornerFold.meta = { dataRole: 'sticky_note_part', part: 'fold' };

  const innerW = Math.max(80, w - NOTE_PADDING * 2);
  const innerH = Math.max(80, h - NOTE_PADDING * 2);
  const baseFS = Number(fontSize) || 22;
  const fitted = layoutStickyNoteText(text || '', innerW, innerH, baseFS, resolvedFont);

  const noteTb = new Text(fitted.wrappedText, {
    left: 0,
    top: 0,
    fontSize: fitted.fontSize,
    fontFamily: resolvedFont,
    fontWeight: '500',
    fill: readableTextColor,
    textAlign: textAlign || 'center',
    lineHeight: NOTE_LINE_HEIGHT,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
  });
  noteTb.meta = { dataRole: 'sticky_note_part', part: 'text' };
  const clampScale = Math.min(
    1,
    innerW / Math.max(1, noteTb.width || 1),
    innerH / Math.max(1, noteTb.height || 1),
  );
  noteTb.set({ scaleX: clampScale, scaleY: clampScale });

  const clipRect = new Rect({
    left: -w / 2 - 1,
    top: -h / 2 - 1,
    width: w + 2,
    height: h + 2,
    rx: 10,
    ry: 10,
    originX: 'left',
    originY: 'top',
  });

  const group = new Group([bgRect, cornerFold, noteTb], {
    left,
    top,
    originX: 'left',
    originY: 'top',
    angle: Number(angle) || 0,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    selectable: false,
    evented: false,
    subTargetCheck: false,
    objectCaching: false,
    clipPath: clipRect,
    shadow: new Shadow({
      color: 'rgba(38, 35, 31, 0.18)',
      blur: 14,
      offsetX: 2,
      offsetY: 6,
    }),
  });

  group.meta = {
    dataRole: 'sticky_note',
    noteBg,
    noteTextColor: readableTextColor,
    noteText: text || '',
    noteWidth: w,
    noteHeight: h,
    fontKey,
    fontSize: baseFS,
    textAlign: textAlign || 'center',
    createdAt: Date.now(),
  };

  group.setCoords();
  populateStickyNoteHitPoints(group);
  return group;
}

/**
 * Đồng bộ lại bố cục dòng chữ bên trong Giấy Note (gọi sau khi sửa chữ, đổi cỡ chữ, đổi phông hoặc nạp từ localStorage).
 */
export function refreshStickyNoteLayout(noteGroup) {
  if (!isStickyNoteObject(noteGroup)) return;
  const m = noteGroup.meta || {};
  const items = typeof noteGroup.getObjects === 'function' ? noteGroup.getObjects() : [];
  const bgRect = items.find((o) => o?.meta?.part === 'bg') || items[0];
  const tb = items.find((o) => o?.meta?.part === 'text' || typeof o?.text === 'string') || items[items.length - 1];
  if (!tb) return;

  const w = Number(m.noteWidth || bgRect?.width || DEFAULT_NOTE_SIZE);
  const h = Number(m.noteHeight || bgRect?.height || DEFAULT_NOTE_SIZE);
  const innerW = Math.max(80, w - NOTE_PADDING * 2);
  const innerH = Math.max(80, h - NOTE_PADDING * 2);
  const fam = FONT_FAMILY_MAP[m.fontKey || 'sans'] || FONT_FAMILY_MAP.sans;
  const baseFS = Number(m.fontSize) || 22;
  const rawText = m.noteText !== undefined ? m.noteText : tb.text || '';

  const fitted = layoutStickyNoteText(rawText, innerW, innerH, baseFS, fam);
  tb.set({
    text: fitted.wrappedText,
    fontFamily: fam,
    fontSize: fitted.fontSize,
    textAlign: m.textAlign || 'center',
    fill: ensureReadableNoteText(m.noteTextColor || tb.fill || '#1F1E1B', m.noteBg || bgRect?.fill),
    left: 0,
    top: 0,
    originX: 'center',
    originY: 'center',
    scaleX: 1,
    scaleY: 1,
  });
  const clampScale = Math.min(
    1,
    innerW / Math.max(1, tb.width || 1),
    innerH / Math.max(1, tb.height || 1),
  );
  if (clampScale < 1) {
    tb.set({ scaleX: clampScale, scaleY: clampScale });
  }
  if (!noteGroup.clipPath) {
    noteGroup.clipPath = new Rect({
      left: -w / 2 - 1,
      top: -h / 2 - 1,
      width: w + 2,
      height: h + 2,
      rx: 10,
      ry: 10,
      originX: 'left',
      originY: 'top',
    });
  }
  tb.setCoords?.();
  noteGroup.dirty = true;
  tb.dirty = true;
  noteGroup.setCoords?.();
  populateStickyNoteHitPoints(noteGroup);
}

/**
 * Cập nhật giao diện Giấy Note khi đổi màu nền, màu chữ, cỡ chữ, phông chữ hoặc nội dung.
 */
export function updateStickyNoteStyle(noteGroup, patch = {}) {
  if (!isStickyNoteObject(noteGroup)) return false;
  const m = noteGroup.meta || {};
  const items = typeof noteGroup.getObjects === 'function' ? noteGroup.getObjects() : [];
  const bgRect = items.find((o) => o?.meta?.part === 'bg') || items[0];

  if (patch.noteBg && bgRect) {
    bgRect.set('fill', patch.noteBg);
    m.noteBg = patch.noteBg;
    bgRect.dirty = true;
  }
  if (patch.color) {
    m.noteTextColor = patch.color;
  }
  if (patch.fontFamily) {
    m.fontKey = patch.fontFamily;
  }
  if (patch.fontSize) {
    m.fontSize = Number(patch.fontSize);
  }
  if (patch.textAlign) {
    m.textAlign = patch.textAlign;
  }
  if (patch.text !== undefined) {
    m.noteText = patch.text;
  }
  if (patch.opacity !== undefined) {
    noteGroup.set('opacity', Math.max(0.15, Math.min(1, Number(patch.opacity) / 100)));
  }

  refreshStickyNoteLayout(noteGroup);
  return true;
}

/**
 * Mở trình nhập chữ trực tiếp ngay bên trong tờ Giấy Note (khi mới đặt Note hoặc nhấp đúp sửa Note).
 */
export function openStickyNoteEditor(noteGroup, { isNew = false, beforeSnapshot = null } = {}) {
  if (!isStickyNoteObject(noteGroup) || state.ended) return;
  if (activeNoteEditorEl) {
    activeNoteEditorEl.blur();
  }

  const items = typeof noteGroup.getObjects === 'function' ? noteGroup.getObjects() : [];
  const bgRect = items.find((o) => o?.meta?.part === 'bg') || items[0];
  const tb = items.find((o) => o?.meta?.part === 'text' || typeof o?.text === 'string') || items[items.length - 1];
  const m = noteGroup.meta || {};
  const before = beforeSnapshot || snapshot();

  if (tb) {
    tb.visible = false;
    noteGroup.dirty = true;
    fabricCanvas.requestRenderAll();
  }

  const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  const zoom = vpt[0] || 1;
  const center = noteGroup.getCenterPoint();
  const baseW = Number(m.noteWidth || bgRect?.width || DEFAULT_NOTE_SIZE);
  const baseH = Number(m.noteHeight || bgRect?.height || DEFAULT_NOTE_SIZE);
  const innerW = Math.max(80, baseW - NOTE_PADDING * 2);
  const innerH = Math.max(80, baseH - NOTE_PADDING * 2);

  const screenCx = center.x * zoom + vpt[4];
  const screenCy = center.y * zoom + vpt[5];
  const screenW = Math.max(72, innerW * (noteGroup.scaleX || 1) * zoom);
  const screenH = Math.max(72, innerH * (noteGroup.scaleY || 1) * zoom);

  const textarea = document.createElement('textarea');
  textarea.className = 'sticky-note-inline-editor';
  textarea.placeholder = 'Nhập ghi chú...';
  textarea.value = m.noteText ?? tb?.text ?? '';
  textarea.setAttribute('aria-label', 'Nhập nội dung giấy ghi chú');

  const fontFam = FONT_FAMILY_MAP[m.fontKey || 'sans'] || FONT_FAMILY_MAP.sans;

  const syncTextareaMetrics = () => {
    const fitted = layoutStickyNoteText(textarea.value || 'A', innerW, innerH, m.fontSize || 22, fontFam);
    const scaledFontPx = Math.max(11, Math.round(fitted.fontSize * zoom * (noteGroup.scaleY || 1)));
    const estTextBlockH = fitted.linesCount * scaledFontPx * NOTE_LINE_HEIGHT;
    const verticalPad = Math.max(4, Math.floor((screenH - estTextBlockH) / 2));
    textarea.style.fontSize = `${scaledFontPx}px`;
    textarea.style.paddingTop = `${verticalPad}px`;
  };

  Object.assign(textarea.style, {
    position: 'absolute',
    left: `${Math.round(screenCx - screenW / 2)}px`,
    top: `${Math.round(screenCy - screenH / 2)}px`,
    width: `${Math.round(screenW)}px`,
    height: `${Math.round(screenH)}px`,
    zIndex: '28',
    boxSizing: 'border-box',
    border: 'none',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    background: 'transparent',
    color: m.noteTextColor || '#1F1E1B',
    fontFamily: fontFam,
    fontWeight: '500',
    lineHeight: String(NOTE_LINE_HEIGHT),
    textAlign: m.textAlign || 'center',
    paddingLeft: '3px',
    paddingRight: '3px',
    paddingBottom: '4px',
    transform: noteGroup.angle ? `rotate(${noteGroup.angle}deg)` : 'none',
    transformOrigin: 'center center',
  });
  syncTextareaMetrics();

  let committed = false;
  const onToolChangedCommit = () => finalize(false);
  const finalize = (reselectAfter = false) => {
    if (committed) return;
    committed = true;
    window.removeEventListener('app:tool-changed', onToolChangedCommit);
    activeNoteEditorEl = null;
    const nextText = textarea.value.replace(/\r/g, '');
    textarea.remove();

    if (tb) tb.visible = true;
    updateStickyNoteStyle(noteGroup, { text: nextText });
    fabricCanvas.requestRenderAll();
    remember(before);
    updateHint();
    setStatus(isNew ? 'Đã thêm Giấy Note lên bảng' : 'Đã cập nhật nội dung Giấy Note');
    if (reselectAfter && state.tool === 'select') {
      window.dispatchEvent(new CustomEvent('app:select-objects', { detail: { objects: [noteGroup] } }));
    }
  };

  window.addEventListener('app:tool-changed', onToolChangedCommit);
  textarea.addEventListener('input', syncTextareaMetrics);
  textarea.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  textarea.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
      ev.preventDefault();
      finalize(true);
    }
  });
  textarea.addEventListener('blur', () => finalize(false));

  stage.appendChild(textarea);
  activeNoteEditorEl = textarea;
  requestAnimationFrame(() => {
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  });
}

/**
 * Đọc Blob/File ảnh (từ Clipboard Ctrl+V hoặc Kéo-Thả), nén gọn tối ưu và chèn thành đối tượng ảnh tương tác trên bảng.
 */
async function insertImageBlobOntoBoard(blob, dropWorldPt = null) {
  if (!blob || state.ended || state.pageBusy) return null;

  const bitmapUrl = URL.createObjectURL(blob);
  try {
    const rawImg = new Image();
    rawImg.src = bitmapUrl;
    if (rawImg.decode) {
      await rawImg.decode();
    } else {
      await new Promise((resolve, reject) => {
        rawImg.onload = resolve;
        rawImg.onerror = reject;
      });
    }

    const natW = Math.max(1, rawImg.naturalWidth || rawImg.width || 320);
    const natH = Math.max(1, rawImg.naturalHeight || rawImg.height || 240);

    // Giảm kích thước lưu trữ nếu ảnh chụp màn hình 4K quá lớn (giữ tối đa 1440px cạnh dài để lưu localStorage mượt)
    const maxPixelSide = 1440;
    const downRatio = Math.min(1, maxPixelSide / Math.max(natW, natH));
    const outW = Math.max(1, Math.round(natW * downRatio));
    const outH = Math.max(1, Math.round(natH * downRatio));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = outW;
    offCanvas.height = outH;
    const ctx = offCanvas.getContext('2d');
    ctx.drawImage(rawImg, 0, 0, outW, outH);

    let dataUrl = offCanvas.toDataURL('image/webp', 0.88);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = offCanvas.toDataURL('image/png');
    }

    const finalImgEl = new Image();
    finalImgEl.src = dataUrl;
    if (finalImgEl.decode) {
      await finalImgEl.decode();
    } else {
      await new Promise((resolve, reject) => {
        finalImgEl.onload = resolve;
        finalImgEl.onerror = reject;
      });
    }

    const vpt = fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoom = vpt[0] || 1;
    const cw = fabricCanvas.getWidth() || 1000;
    const ch = fabricCanvas.getHeight() || 700;

    const centerWorld = dropWorldPt || lastKnownWorldPointer || {
      x: (cw / 2 - vpt[4]) / zoom,
      y: (ch / 2 - vpt[5]) / zoom,
    };

    const maxDisplayW = Math.min(520, (cw * 0.6) / zoom);
    const maxDisplayH = Math.min(420, (ch * 0.6) / zoom);
    const displayScale = Math.min(1, maxDisplayW / outW, maxDisplayH / outH);
    const dispW = Math.round(outW * displayScale);
    const dispH = Math.round(outH * displayScale);
    const safeArea = getSafeAreaScreen(12);
    const safeTL = screenToWorld(safeArea.left, safeArea.top);
    const safeBR = screenToWorld(safeArea.right, safeArea.bottom);
    const left = Math.round(clampRange(centerWorld.x - dispW / 2, safeTL.x, safeBR.x - dispW));
    const top = Math.round(clampRange(centerWorld.y - dispH / 2, safeTL.y, safeBR.y - dispH));

    const before = snapshot();
    const fabricImg = new FabricImage(finalImgEl, {
      left,
      top,
      scaleX: displayScale,
      scaleY: displayScale,
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    fabricImg._hitPoints = [
      { x: left, y: top + dispH / 2 },
      { x: left + dispW, y: top + dispH / 2 },
    ];
    fabricImg._hitWidth = Math.max(36, dispH);
    fabricImg.meta = {
      dataRole: 'pasted_image',
      createdAt: Date.now(),
    };

    fabricCanvas.add(fabricImg);
    fabricCanvas.requestRenderAll();
    remember(before);
    updateHint();

    setTool('select');
    window.dispatchEvent(new CustomEvent('app:select-objects', { detail: { objects: [fabricImg] } }));
    setStatus('Đã dán ảnh vào bảng — Kéo góc để phóng to/thu nhỏ, xoay ↻ 360° hoặc bấm Cắt khung (Crop)');
    return fabricImg;
  } catch (err) {
    console.error('Lỗi dán ảnh vào bảng:', err);
    setStatus('Không thể đọc dữ liệu ảnh vừa dán');
    return null;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function setupBoardMediaAndNotes() {
  // Theo dõi vị trí con trỏ trên bảng để Ctrl+V dán ảnh ngay đúng chỗ chuột đang đứng
  stage?.addEventListener('pointermove', (ev) => {
    const sp = getScreenPoint(ev);
    lastKnownWorldPointer = screenToWorld(sp.x, sp.y);
  });

  // 1. Hỗ trợ Ctrl+V / Cmd+V dán ảnh trực tiếp từ Clipboard vào mặt bảng
  window.addEventListener('paste', (event) => {
    if (state.ended || state.pageBusy) return;
    if (document.querySelector('dialog[open]:not([popover])')) return;

    const cd = event.clipboardData;
    if (!cd) return;

    let imageFile = null;
    if (cd.items) {
      for (const item of cd.items) {
        if (item.type && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          if (imageFile) break;
        }
      }
    }
    if (!imageFile && cd.files && cd.files.length > 0) {
      for (const f of cd.files) {
        if (f.type && f.type.startsWith('image/')) {
          imageFile = f;
          break;
        }
      }
    }

    if (!imageFile) {
      const activeEl = document.activeElement;
      const isTypingField = activeEl?.matches?.('input,textarea,select') || activeEl?.isContentEditable;
      if (!isTypingField && typeof cd.getData === 'function') {
        const htmlClip = cd.getData('text/html') || '';
        const dataUrlMatch = htmlClip.match(/src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']/i);
        if (dataUrlMatch?.[1]) {
          event.preventDefault();
          fetch(dataUrlMatch[1])
            .then((r) => r.blob())
            .then((blob) => insertImageBlobOntoBoard(blob, lastKnownWorldPointer))
            .catch(() => {});
        }
      }
      return;
    }

    // Nếu clipboard thực sự chứa ảnh chụp màn hình / ảnh copy, ưu tiên dán thẳng lên mặt bảng
    event.preventDefault();
    void insertImageBlobOntoBoard(imageFile, lastKnownWorldPointer);
  });

  // 2. Hỗ trợ Kéo & Thả (Drag-and-Drop) tệp ảnh từ máy tính trực tiếp vào mặt bảng
  stage?.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });

  stage?.addEventListener('drop', (event) => {
    if (state.ended || state.pageBusy) return;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const imgFile = Array.from(files).find((f) => f.type && f.type.startsWith('image/'));
    if (!imgFile) return;

    event.preventDefault();
    const sp = getScreenPoint(event);
    const dropWorld = screenToWorld(sp.x, sp.y);
    void insertImageBlobOntoBoard(imgFile, dropWorld);
  });

  // 3. Công cụ Đặt / Kéo tạo Giấy Note (Sticky Note — phím N) trên mặt bảng
  let noteDrag = null;
  let previewBoxEl = null;

  function ensureNotePreviewEl() {
    if (previewBoxEl) return previewBoxEl;
    previewBoxEl = document.createElement('div');
    previewBoxEl.className = 'sticky-note-drag-preview';
    previewBoxEl.hidden = true;
    stage.appendChild(previewBoxEl);
    return previewBoxEl;
  }

  surface?.addEventListener('pointerdown', (event) => {
    if (state.tool !== 'note' || state.ended || state.pageBusy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (stage.classList.contains('is-panning') || stage.classList.contains('is-panning-active')) return;

    event.preventDefault();
    closePanels();
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);
    noteDrag = {
      pointerId: event.pointerId,
      startScreen: sp,
      startWorld: wp,
      curWorld: wp,
      moved: false,
    };
    const pEl = ensureNotePreviewEl();
    pEl.style.background = state.noteBg || '#FFE066';
    pEl.hidden = true;
    if (event.pointerType !== 'touch') {
      try { surface.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (!noteDrag || event.pointerId !== noteDrag.pointerId || state.tool !== 'note') return;
    const sp = getScreenPoint(event);
    const wp = screenToWorld(sp.x, sp.y);
    noteDrag.curWorld = wp;

    const dxScreen = sp.x - noteDrag.startScreen.x;
    const dyScreen = sp.y - noteDrag.startScreen.y;
    if (Math.hypot(dxScreen, dyScreen) > 8) {
      noteDrag.moved = true;
      const pEl = ensureNotePreviewEl();
      pEl.hidden = false;
      const left = Math.min(noteDrag.startScreen.x, sp.x);
      const top = Math.min(noteDrag.startScreen.y, sp.y);
      pEl.style.left = `${Math.round(left)}px`;
      pEl.style.top = `${Math.round(top)}px`;
      pEl.style.width = `${Math.max(60, Math.round(Math.abs(dxScreen)))}px`;
      pEl.style.height = `${Math.max(60, Math.round(Math.abs(dyScreen)))}px`;
    }
  });

  const finishNotePlacement = (event) => {
    if (!noteDrag || event.pointerId !== noteDrag.pointerId) return;
    const drag = noteDrag;
    noteDrag = null;
    if (previewBoxEl) previewBoxEl.hidden = true;
    if (state.tool !== 'note' || state.ended) return;

    const before = snapshot();
    let w = DEFAULT_NOTE_SIZE;
    let h = DEFAULT_NOTE_SIZE;
    let left = Math.round(drag.startWorld.x - w / 2);
    let top = Math.round(drag.startWorld.y - h / 2);

    if (drag.moved) {
      w = Math.max(MIN_NOTE_SIZE, Math.round(Math.abs(drag.curWorld.x - drag.startWorld.x)));
      h = Math.max(MIN_NOTE_SIZE, Math.round(Math.abs(drag.curWorld.y - drag.startWorld.y)));
      left = Math.round(Math.min(drag.startWorld.x, drag.curWorld.x));
      top = Math.round(Math.min(drag.startWorld.y, drag.curWorld.y));
    }

    // Giữ Giấy Note mới đặt nằm trong vùng nhìn thấy an toàn (không chìm sau thanh trên / thanh công cụ / chân trang)
    {
      const safe = getSafeAreaScreen(12);
      const tl = screenToWorld(safe.left, safe.top);
      const br = screenToWorld(safe.right, safe.bottom);
      left = Math.round(clampRange(left, tl.x, br.x - w));
      top = Math.round(clampRange(top, tl.y, br.y - h));
    }

    const noteColor = state.noteBg || '#FFE066';
    const textColor = ui.color?.value || '#1F1E1B';
    const noteObj = createStickyNoteGroup({
      left,
      top,
      width: w,
      height: h,
      text: '',
      noteBg: noteColor,
      textColor,
      fontKey: state.fontFamily || 'sans',
      fontSize: state.fontSize || 22,
      textAlign: state.textAlign || 'center',
      opacity: (state.opacity ?? 100) / 100,
    });

    fabricCanvas.add(noteObj);
    fabricCanvas.requestRenderAll();
    setTool('select');
    openStickyNoteEditor(noteObj, { isNew: true, beforeSnapshot: before });
  };

  window.addEventListener('pointerup', finishNotePlacement);
  window.addEventListener('pointercancel', (event) => {
    if (!noteDrag || event.pointerId !== noteDrag.pointerId) return;
    noteDrag = null;
    if (previewBoxEl) previewBoxEl.hidden = true;
  });
}
