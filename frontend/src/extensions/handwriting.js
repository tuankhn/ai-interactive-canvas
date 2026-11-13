/**
 * Nhận dạng chữ viết tay theo vùng chọn, không chỉnh sửa các module cũ.
 * Tesseract.js: OCR chạy trong trình duyệt. MathJax: dựng LaTeX thành SVG.
 * OCR toán chỉ gợi ý LaTeX đơn giản; giáo viên được kiểm tra và sửa kết quả.
 */
import { FabricImage, Path, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, toolbar, fabricCanvas, state, ui, toolNames, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from '../components/history.js';
import { closePanels, setTool } from '../components/toolbar.js';

const OCR_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MATH_CDN = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
let tesseractWorkerPromise = null;
let onOCRProgress = null;
let mathJaxPromise = null;

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      reject(new Error(`Thư viện ${id} chưa khởi tạo thành công. Hãy tải lại trang.`));
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error(`Không thể tải thư viện từ Internet: ${src}`));
    };
    document.head.append(script);
  });
}

async function getOCRWorker(progressCallback) {
  onOCRProgress = progressCallback;
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      if (!window.Tesseract) await loadScript(OCR_CDN, 'handwriting-tesseract');
      return window.Tesseract.createWorker('vie+eng', 1, {
        logger: (event) => onOCRProgress?.(event)
      });
    })().catch((error) => {
      tesseractWorkerPromise = null;
      throw error;
    });
  }
  return tesseractWorkerPromise;
}

async function getMathJax() {
  if (!mathJaxPromise) {
    mathJaxPromise = (async () => {
      if (!window.MathJax?.tex2svgPromise) {
        // fontCache local bắt buộc: ảnh SVG đưa vào Fabric phải tự chứa glyph.
        window.MathJax = {
          startup: { typeset: false },
          svg: { fontCache: 'local' }
        };
        await loadScript(MATH_CDN, 'handwriting-mathjax');
      }
      await window.MathJax.startup.promise;
      return window.MathJax;
    })().catch((error) => {
      mathJaxPromise = null;
      throw error;
    });
  }
  return mathJaxPromise;
}

function mathGuess(text) {
  let output = text.trim().replace(/\r/g, '').replace(/^\$+|\$+$/g, '');
  output = output.replace(/√\s*\(([^()]*)\)/g, '\\sqrt{$1}')
    .replace(/√\s*([\w]+)/g, '\\sqrt{$1}')
    .replace(/([\w})])²/g, '$1^{2}')
    .replace(/([\w})])³/g, '$1^{3}')
    .replace(/([\w})])ⁿ/g, '$1^{n}')
    .replace(/π/g, '\\pi ')
    .replace(/∞/g, '\\infty ')
    .replace(/≤/g, '\\leq ')
    .replace(/≥/g, '\\geq ')
    .replace(/≠/g, '\\neq ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/±/g, '\\pm ')
    .replace(/→/g, '\\to ')
    .replace(/\b(sin|cos|tan|log|ln)\b/g, '\\$1')
    .replace(/(?<!\\)\bpi\b/gi, '\\pi ');
  // Gợi ý phân số dạng đơn giản (x/2, 1/4); phức tạp cần sửa thủ công.
  output = output.replace(/\b([a-zA-Z0-9]+)\s*\/\s*([a-zA-Z0-9]+)\b/g, '\\frac{$1}{$2}');
  return output.trim();
}

function boxRect(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

function overlaps(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left &&
    a.top < b.top + b.height && a.top + a.height > b.top;
}

function cropForOCR(region) {
  // Bản kết xuất Fabric có cả nét và nền, không có lớp kéo khung chọn.
  const drawing = fabricCanvas.toCanvasElement(2);
  const factorX = drawing.width / fabricCanvas.getWidth();
  const factorY = drawing.height / fabricCanvas.getHeight();
  const x1 = clamp(region.left - 10, 0, fabricCanvas.getWidth());
  const y1 = clamp(region.top - 10, 0, fabricCanvas.getHeight());
  const x2 = clamp(region.left + region.width + 10, 0, fabricCanvas.getWidth());
  const y2 = clamp(region.top + region.height + 10, 0, fabricCanvas.getHeight());
  const width = x2 - x1;
  const height = y2 - y1;
  const enlargement = Math.min(3, 2600 / Math.max(width, height));
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.round(width * enlargement));
  result.height = Math.max(1, Math.round(height * enlargement));
  const ctx = result.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, result.width, result.height);
  ctx.drawImage(drawing, x1 * factorX, y1 * factorY, width * factorX, height * factorY,
    0, 0, result.width, result.height);

  // Chuẩn hóa nét tối trên nền sáng, kể cả khi đang dùng bảng đen.
  const image = ctx.getImageData(0, 0, result.width, result.height);
  const pixels = image.data;
  const darkBoard = fabricCanvas.backgroundColor === '#111827';
  for (let p = 0; p < pixels.length; p += 4) {
    const luminance = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
    const white = darkBoard ? luminance < 120 : luminance >= 185;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = white ? 255 : 0;
    pixels[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return result;
}

function textColor() {
  const ink = ui.color.value.toLowerCase();
  if (fabricCanvas.backgroundColor === '#111827' && ink === '#172554') return '#ffffff';
  if (fabricCanvas.backgroundColor !== '#111827' && ink === '#ffffff') return '#172554';
  return ink;
}

async function mathSVG(tex, color) {
  const mj = await getMathJax();
  const wrapper = await mj.tex2svgPromise(tex, {
    display: false, em: 26, ex: 13, containerWidth: Math.max(250, fabricCanvas.getWidth())
  });
  const original = wrapper.querySelector('svg');
  if (!original) throw new Error('Không tạo được hình công thức LaTeX.');
  const svg = original.cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('color', color);
  svg.setAttribute('fill', color);
  svg.style.color = color;
  return svg;
}

async function createFormulaImage(tex, region) {
  const svg = await mathSVG(tex, textColor());
  const dimensions = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (dimensions.length !== 4 || !dimensions[2] || !dimensions[3]) {
    throw new Error('MathJax trả về hình công thức không có kích thước hợp lệ.');
  }
  const ratio = dimensions[2] / dimensions[3];
  let height = clamp(region.height * 0.9, 30, 88);
  let width = height * ratio;
  const availableWidth = Math.max(24, fabricCanvas.getWidth() - region.left - 6);
  const allowedWidth = Math.min(availableWidth, Math.max(region.width, 160));
  if (width > allowedWidth) {
    height *= allowedWidth / width;
    width = allowedWidth;
  }
  svg.setAttribute('width', String(Math.round(width * 3)));
  svg.setAttribute('height', String(Math.round(height * 3)));
  const encoded = 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(new XMLSerializer().serializeToString(svg));
  const image = new Image();
  image.src = encoded;
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Không thể đọc hình công thức SVG.'));
  });
  const object = new FabricImage(image, {
    left: region.left, top: region.top,
    scaleX: width / image.naturalWidth, scaleY: height / image.naturalHeight,
    selectable: false, evented: false, objectCaching: false
  });
  object.set('altText', `LaTeX: ${tex}`);
  return object;
}

function createText(text, region) {
  const lineCount = Math.max(1, text.trim().split('\n').length);
  const fontSize = clamp(Math.floor(region.height / lineCount * 0.72), 18, 38);
  return new Textbox(text, {
    left: region.left, top: region.top,
    width: Math.max(20, Math.min(fabricCanvas.getWidth() - region.left - 4,
      Math.max(region.width, 150))),
    fontFamily: 'Arial', fontSize, lineHeight: 1.18,
    fill: textColor(), selectable: false, evented: false, objectCaching: false
  });
}

export function setupHandwriting() {
  // Nút đã có trong frontend/index.html, không tạo nút hoặc trang khác.
  const toolButton = $('handwritingTool');
  if (!toolButton) throw new Error('Thiếu nút handwritingTool trong index.html.');

  const selector = document.createElement('div');
  selector.className = 'hw-selector';
  selector.id = 'handwritingSelector';
  selector.hidden = true;
  selector.innerHTML = '<div class="hw-instruction">Kéo để khoanh vùng chữ viết tay · Esc để hủy</div><div class="hw-selection" hidden></div>';
  stage.append(selector);
  const marquee = selector.querySelector('.hw-selection');

  const dialog = document.createElement('dialog');
  dialog.className = 'hw-dialog';
  dialog.id = 'handwritingDialog';
  dialog.setAttribute('aria-labelledby', 'handwritingDialogTitle');
  dialog.innerHTML = `
    <h2 id="handwritingDialogTitle">Chuyển chữ viết tay trên bảng</h2>
    <p class="hw-muted">Kiểm tra nội dung OCR, chỉnh sửa nếu cần, rồi chèn đúng vị trí đã khoanh.</p>
    <div class="hw-row"><img class="hw-crop" id="hwCrop" alt="Ảnh vùng nét chữ đã chọn" /><span id="hwLocation" class="hw-muted"></span></div>
    <label for="hwMode">Kiểu kết quả</label>
    <select id="hwMode"><option value="text">Văn bản (chữ in)</option><option value="latex">Công thức LaTeX</option></select>
    <label for="hwContent">Nội dung nhận dạng (có thể sửa)</label>
    <textarea id="hwContent" spellcheck="false" placeholder="Nhập văn bản hoặc LaTeX nếu nhận dạng chưa đúng..."></textarea>
    <div id="hwProgress" class="hw-status" role="status" aria-live="polite">Đang chuẩn bị nhận dạng...</div>
    <label for="hwPreview">Xem trước</label>
    <div id="hwPreview" class="hw-preview" aria-live="polite">Chưa có kết quả.</div>
    <label class="hw-check"><input type="checkbox" id="hwReplace" checked /><span>Thay thế nét viết tay trong vùng đã chọn (những nét cắt qua khung chọn cũng có thể bị xóa)</span></label>
    <div class="hw-actions">
      <button id="hwCancel" type="button">Hủy</button>
      <button id="hwRetry" type="button">Nhận dạng lại</button>
      <button id="hwInsert" class="hw-insert" type="button">Chèn lên bảng</button>
    </div>
  `;
  document.body.append(dialog);

  const mode = $('hwMode');
  const textarea = $('hwContent');
  const progress = $('hwProgress');
  const preview = $('hwPreview');
  const retry = $('hwRetry');
  const insert = $('hwInsert');
  const replace = $('hwReplace');
  const cropImg = $('hwCrop');
  const location = $('hwLocation');

  let selecting = false;
  let start = null;
  let pointer = null;
  let region = null;
  let pageOfSelection = null;
  let crop = null;
  let busy = false;
  let job = 0;
  let previewJob = 0;
  let values = { text: '', latex: '' };
  let edited = { text: false, latex: false };
  let lastOCR = '';

  function status(message, isError = false) {
    progress.textContent = message;
    progress.classList.toggle('hw-error', isError);
  }
  function stopSelecting() {
    selecting = false;
    pointer = null;
    start = null;
    selector.hidden = true;
    marquee.hidden = true;
    toolButton.classList.remove('is-active');
    document.body.classList.remove('hw-selecting');
    toolButton.setAttribute('aria-pressed', 'false');
  }
  function setBusy(value) {
    busy = value;
    retry.disabled = value;
    insert.disabled = value;
    mode.disabled = value;
    // Hủy luôn dùng được, ngay cả khi OCR đang chạy.
  }
  function point(event) {
    const rect = surface.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, fabricCanvas.getWidth()),
      y: clamp(event.clientY - rect.top, 0, fabricCanvas.getHeight())
    };
  }
  function drawMarquee(r) {
    marquee.hidden = false;
    marquee.style.left = `${r.left}px`;
    marquee.style.top = `${r.top}px`;
    marquee.style.width = `${r.width}px`;
    marquee.style.height = `${r.height}px`;
  }

  function fillField() {
    textarea.value = values[mode.value];
    updatePreview();
  }
  async function updatePreview() {
    const current = ++previewJob;
    const content = textarea.value.trim();
    preview.replaceChildren();
    if (!content) {
      preview.textContent = 'Chưa có kết quả. Bạn có thể nhập thủ công.';
      return;
    }
    if (mode.value === 'text') {
      preview.textContent = content;
      return;
    }
    preview.textContent = 'Đang dựng công thức LaTeX...';
    try {
      const svg = await mathSVG(content, '#1e293b');
      if (current !== previewJob || !dialog.open) return;
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      preview.replaceChildren(svg);
    } catch (error) {
      if (current !== previewJob || !dialog.open) return;
      preview.textContent = `Không xem trước được LaTeX: ${error.message}`;
    }
  }

  async function runRecognition() {
    if (!region || busy) return;
    const current = ++job;
    const editAtStart = { ...edited };
    setBusy(true);
    status('Đang tải bộ nhận dạng OCR; lần đầu cần Internet để tải dữ liệu ngôn ngữ...');
    try {
      const worker = await getOCRWorker((message) => {
        if (current !== job || !dialog.open || !busy) return;
        const percent = Number.isFinite(message.progress)
          ? ` (${Math.round(message.progress * 100)}%)` : '';
        status(`${message.status || 'Đang tải OCR'}${percent}`);
      });
      const result = await worker.recognize(crop);
      if (current !== job || !dialog.open) return;
      lastOCR = (result.data?.text || '').trim();
      if (!edited.text && !editAtStart.text) values.text = lastOCR;
      if (!edited.latex && !editAtStart.latex) values.latex = mathGuess(lastOCR);
      if (!edited[mode.value]) textarea.value = values[mode.value];
      await updatePreview();
      if (!lastOCR) status('Không nhận ra chữ trong vùng chọn. Hãy nhập nội dung thủ công hoặc chọn vùng rõ hơn.', true);
      else status('Đã nhận dạng. Hãy kiểm tra và sửa kết quả, đặc biệt với ký hiệu toán học.');
    } catch (error) {
      if (current !== job || !dialog.open) return;
      console.warn('OCR handwriting:', error);
      status(`OCR không khả dụng: ${error.message}. Bạn vẫn có thể nhập nội dung thủ công.`, true);
      await updatePreview();
    } finally {
      if (current === job) setBusy(false);
    }
  }

  function beginSelection() {
    if (state.ended || state.pageBusy || state.stroke || dialog.open) return;
    closePanels();
    selecting = true;
    selector.hidden = false;
    marquee.hidden = true;
    toolButton.classList.add('is-active');
    document.body.classList.add('hw-selecting');
    toolButton.setAttribute('aria-pressed', 'true');
    setStatus('Kéo chuột hoặc bút để khoanh vùng chữ viết tay');
  }

  toolButton.addEventListener('click', () => {
    if (selecting) stopSelecting();
    else beginSelection();
  });
  selector.addEventListener('pointerdown', (event) => {
    if (!selecting || state.ended || state.pageBusy || pointer !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && (event.width > 28 || event.height > 28)) return;
    event.preventDefault();
    pointer = event.pointerId;
    start = point(event);
    drawMarquee(boxRect(start, start));
    try { selector.setPointerCapture(event.pointerId); } catch { /* Không bắt buộc. */ }
  }, { passive: false });
  selector.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer || !start) return;
    event.preventDefault();
    drawMarquee(boxRect(start, point(event)));
  }, { passive: false });
  selector.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer || !start) return;
    event.preventDefault();
    const nextRegion = boxRect(start, point(event));
    stopSelecting();
    if (nextRegion.width < 12 || nextRegion.height < 12) {
      setStatus('Vùng chọn quá nhỏ. Nhấn Chuyển chữ để chọn lại.');
      return;
    }
    region = nextRegion;
    pageOfSelection = state.pageIndex;
    values = { text: '', latex: '' };
    edited = { text: false, latex: false };
    lastOCR = '';
    mode.value = 'text';
    textarea.value = '';
    replace.checked = true;
    status('Đang chuẩn bị nhận dạng...');
    preview.textContent = 'Đang lấy hình vùng chọn...';
    try {
      crop = cropForOCR(region);
      cropImg.src = crop.toDataURL('image/png');
    } catch (error) {
      console.warn('Không thể lấy vùng ảnh OCR:', error);
      crop = null;
      status('Không lấy được ảnh nét vẽ. Bạn có thể nhập nội dung thủ công.', true);
    }
    location.textContent = `Trang ${pageOfSelection + 1} · ${Math.round(region.width)} × ${Math.round(region.height)} px`;
    dialog.showModal();
    if (crop) void runRecognition();
  }, { passive: false });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    selector.addEventListener(type, (event) => {
      if (event.pointerId === pointer) stopSelecting();
    });
  }

  toolbar.addEventListener('click', (event) => {
    if (selecting && event.target.closest('button') !== toolButton) stopSelecting();
  });
  for (const buttonId of ['prevPage', 'nextPage', 'addPageButton', 'deletePageButton', 'endSession']) {
    $(buttonId).addEventListener('click', () => { if (selecting) stopSelecting(); });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selecting) stopSelecting();
  });
  dialog.addEventListener('close', () => {
    ++job;
    ++previewJob;
    region = null;
    pageOfSelection = null;
    crop = null;
    setBusy(false);
  });
  $('hwCancel').addEventListener('click', () => dialog.close());
  retry.addEventListener('click', () => {
    if (crop) void runRecognition();
    else status('Không có vùng ảnh để nhận dạng lại. Có thể nhập thủ công.', true);
  });
  textarea.addEventListener('input', () => {
    values[mode.value] = textarea.value;
    edited[mode.value] = true;
    void updatePreview();
  });
  mode.addEventListener('change', fillField);

  insert.addEventListener('click', async () => {
    if (busy || !region || state.ended || state.pageBusy || state.stroke || pageOfSelection !== state.pageIndex) return;
    const content = textarea.value.trim();
    if (!content) {
      status('Hãy nhập hoặc nhận dạng nội dung trước khi chèn lên bảng.', true);
      textarea.focus();
      return;
    }
    setBusy(true);
    status('Đang chèn nội dung vào bảng...');
    try {
      const object = mode.value === 'latex'
        ? await createFormulaImage(content, region)
        : createText(content, region);
      if (state.ended || state.pageBusy || pageOfSelection !== state.pageIndex) {
        throw new Error('Trang bảng đã thay đổi; thao tác bị hủy.');
      }
      const before = snapshot();
      if (replace.checked) {
        // Chỉ xóa Path (nét bút), không xóa hình, chữ in hay công thức có sẵn.
        const paths = fabricCanvas.getObjects().filter((item) =>
          item instanceof Path && overlaps(item.getBoundingRect(), region));
        if (paths.length) fabricCanvas.remove(...paths);
      }
      fabricCanvas.add(object);
      fabricCanvas.requestRenderAll();
      updateHint();
      remember(before); // Ghi lịch sử hoàn tác và tự động lưu TRANG HIỆN TẠI.
      setStatus(mode.value === 'latex' ? 'Đã chèn công thức LaTeX vào bảng' : 'Đã chuyển chữ viết tay thành văn bản');
      dialog.close();
    } catch (error) {
      console.error('Không thể chèn kết quả chữ viết tay:', error);
      status(`Không chèn được: ${error.message}`, true);
    } finally {
      if (dialog.open) setBusy(false);
    }
  });
}


// ==== TÍCH HỢP PLOTLY.JS: PHÂN TÍCH PHƯƠNG TRÌNH ====
/**
 * Bộ phân tích an toàn cho các hàm y=f(x) bậc 1, 2, 3, sin, cos, tan.
 * Không dùng eval/new Function, không thực thi biểu thức do OCR cung cấp.
 */
const finite = (value) => Number.isFinite(value) && Math.abs(value) <= 1e6;

function normalizeEquation(value) {
  let text = String(value || '').trim();
  text = text.replace(/\r/g, '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  text = text.replace(/\\\[|\\\]|\\\(|\\\)|\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\(?:mathrm|text)\{(sin|cos|tan)\}/gi, '$1')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/\\(sin|cos|tan)/gi, '$1')
    .replace(/\\frac\{([+-]?\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}/g,
      (_, n, d) => Number(d) ? String(Number(n) / Number(d)) : 'invalid')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/¹/g, '^1')
    .replace(/x\^\{([123])\}/gi, 'x^$1')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\s+/g, '').toLowerCase();
  text = text.replace(/^f\(x\)=/, '').replace(/^y=/, '');
  return text;
}

function coefficient(text, defaultValue = 1) {
  if (text === '' || text === '+') return defaultValue;
  if (text === '-') return -defaultValue;
  const number = Number(text);
  return finite(number) ? number : NaN;
}

function parsePolynomial(expr) {
  // Cho phép viết 2*x^2 hoặc 2x². Không cho phép hàm/ký tự không được hỗ trợ.
  const source = expr.replace(/\*/g, '');
  if (!/^[+\-.\dabcdx^]+$/.test(source) || !source) return null;
  const terms = source.match(/[+-]?[^+-]+/g) || [];
  const values = [0, 0, 0, 0];
  for (const part of terms) {
    const sign = part[0] === '-' ? -1 : 1;
    const raw = /^[+-]/.test(part) ? part.slice(1) : part;
    const monomial = raw.match(/^((?:\d+(?:\.\d+)?|\.\d+)?|[abcd])x(?:\^([123]))?$/);
    const constant = raw.match(/^(?:\d+(?:\.\d+)?|\.\d+|[abcd])$/);
    if (monomial) {
      const power = Number(monomial[2] || 1);
      const n = /^[abcd]$/.test(monomial[1]) ? 1 : coefficient(monomial[1]);
      if (!finite(n)) return null;
      values[power] += sign * n;
    } else if (constant) {
      values[0] += sign * (/^[abcd]$/.test(raw) ? 1 : Number(raw));
    } else return null;
  }
  if (!values.every(finite)) return null;
  const degree = values[3] !== 0 ? 3 : values[2] !== 0 ? 2 : values[1] !== 0 ? 1 : 0;
  if (!degree) return null;
  return {
    kind: 'polynomial', degree,
    coefficients: degree === 1
      ? { a: values[1], b: values[0] }
      : degree === 2
        ? { a: values[2], b: values[1], c: values[0] }
        : { a: values[3], b: values[2], c: values[1], d: values[0] }
  };
}

function parseTrig(expr) {
  const source = expr.replace(/\*/g, '');
  const found = source.match(/^([+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)|[a]))?(sin|cos|tan)\(([+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)|[b]))?x\)([+-](?:(?:\d+(?:\.\d+)?|\.\d+)|[c]))?$/);
  if (!found) return null;
  const a = (found[1] || '').replace(/a/g, '1');
  const b = (found[3] || '').replace(/b/g, '1');
  const rawC = (found[4] || '0').replace(/c/g, '1');
  const aNum = coefficient(a);
  const bNum = coefficient(b);
  const c = Number(rawC);
  if (![aNum, bNum, c].every(finite)) return null;
  return { kind: 'trig', fn: found[2], coefficients: { a: aNum, b: bNum, c } };
}

function parseEquation(text) {
  const normalized = normalizeEquation(text);
  if (!normalized) throw new Error('Hãy nhập phương trình, ví dụ: y=2x²+3x+1.');
  const parsed = parseTrig(normalized) || parsePolynomial(normalized);
  if (!parsed) throw new Error('Chỉ hỗ trợ hàm bậc 1–3 hoặc a·sin(bx)+c, a·cos(bx)+c, a·tan(bx)+c. Hãy kiểm tra lại OCR.');
  return { ...parsed, source: text, normalized };
}

function formula(model) {
  const { a = 0, b = 0, c = 0, d = 0 } = model.coefficients;
  const n = (value) => Number(value.toFixed(4)).toString();
  const signed = (value) => value < 0 ? ` - ${n(-value)}` : ` + ${n(value)}`;
  if (model.kind === 'trig') return `y = ${n(a)}${model.fn}(${n(b)}x)${signed(c)}`;
  if (model.degree === 1) return `y = ${n(a)}x${signed(b)}`;
  if (model.degree === 2) return `y = ${n(a)}x²${signed(b)}x${signed(c)}`;
  return `y = ${n(a)}x³${signed(b)}x²${signed(c)}x${signed(d)}`;
}

function sample(model, count = 501) {
  const trig = model.kind === 'trig';
  const min = trig ? -2 * Math.PI : -10;
  const max = trig ? 2 * Math.PI : 10;
  const xs = [], ys = [];
  const { a = 0, b = 0, c = 0, d = 0 } = model.coefficients;
  for (let i = 0; i < count; ++i) {
    const x = min + (max - min) * i / (count - 1);
    let y;
    if (trig) {
      const bx = b * x;
      y = a * (model.fn === 'sin' ? Math.sin(bx) : model.fn === 'cos' ? Math.cos(bx) : Math.tan(bx)) + c;
      if (model.fn === 'tan' && (Math.abs(Math.cos(bx)) < 0.045 || Math.abs(y) > 30)) y = null;
    } else if (model.degree === 1) y = a * x + b;
    else if (model.degree === 2) y = a * x * x + b * x + c;
    else y = ((a * x + b) * x + c) * x + d;
    xs.push(x);
    ys.push(Number.isFinite(y) ? y : null);
  }
  return { x: xs, y: ys };
}


// ==== TÍCH HỢP PLOTLY.JS: ĐỒ THỊ VÀ KẾT NỐI OCR ====
/**
 * Plotly.js được tích hợp trực tiếp vào tiện ích chữ viết tay có sẵn.
 * - Tạo đồ thị từ phương trình OCR khi người dùng chèn công thức.
 * - Nhập phương trình bằng tay qua nút "Đồ thị".
 * - Kéo các hệ số và xem Plotly.react cập nhật trực tiếp.
 * - Chèn ảnh đồ thị lên trang Fabric để lưu, chuyển trang, Hoàn tác.
 */

const PLOTLY_CDN = 'https://cdn.plot.ly/plotly-4.1.2.min.js';
let plotlyPromise = null;

function getPlotly() {
  if (window.Plotly?.react && window.Plotly?.toImage) return Promise.resolve(window.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PLOTLY_CDN;
      script.async = true;
      script.id = 'plotly-graph-library';
      script.onload = () => window.Plotly?.react
        ? resolve(window.Plotly)
        : reject(new Error('Plotly đã tải nhưng chưa khởi tạo.'));
      script.onerror = () => reject(new Error('Không tải được Plotly.js; cần có Internet.'));
      document.head.append(script);
    }).catch((error) => {
      document.getElementById('plotly-graph-library')?.remove();
      plotlyPromise = null;
      throw error;
    });
  }
  return plotlyPromise;
}


/**
 * Chế độ chỉnh ảnh đồ thị đã CHÈN VÀO BẢNG (khác với pan/zoom trục Plotly trong popup).
 * Không bật lựa chọn toàn bộ Fabric vì việc đó sẽ chặn bút Stylus và tẩy nét.
 * Một lớp tương tác chỉ xuất hiện khi người dùng chọn công cụ Chỉnh đồ thị.
 * Hỗ trợ đồ thị từ các bản cũ (FabricImage trước đây không có metadata riêng).
 */
function setupBoardGraphEditor() {
  toolNames.graphEdit = 'Chỉnh đồ thị';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'plotlyEditTool';
  toggle.className = 'tool-button pg-edit-tool';
  toggle.dataset.tool = 'graphEdit';
  toggle.textContent = 'Chỉnh đồ thị';
  toggle.title = 'Chọn đồ thị đã lưu trên bảng, kéo để di chuyển, kéo góc để phóng to/thu nhỏ';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-pressed', 'false');
  $('plotlyGraphTool').insertAdjacentElement('afterend', toggle);

  const layer = document.createElement('div');
  layer.id = 'pgBoardEditLayer';
  layer.className = 'pg-board-edit-layer';
  layer.hidden = true;
  layer.setAttribute('aria-label', 'Chọn và chỉnh kích thước ảnh đồ thị trên bảng');
  layer.innerHTML = `
    <div class="pg-board-selection" id="pgBoardSelection" hidden aria-hidden="true">
      <span class="pg-handle pg-nw"></span><span class="pg-handle pg-ne"></span>
      <span class="pg-handle pg-sw"></span><span class="pg-handle pg-se"></span>
    </div>
    <div class="pg-board-controls" id="pgBoardControls" hidden>
      <button id="pgBoardZoomIn" type="button" title="Phóng to ảnh đồ thị" aria-label="Phóng to ảnh đồ thị">+</button>
      <button id="pgBoardZoomOut" type="button" title="Thu nhỏ ảnh đồ thị" aria-label="Thu nhỏ ảnh đồ thị">−</button>
      <button id="pgBoardDone" type="button" title="Xong, trở về bút vẽ">Xong</button>
    </div>
    <div id="pgBoardHelp" class="pg-board-help">Bấm vào ảnh đồ thị để chọn, kéo ảnh để di chuyển; kéo 4 góc hoặc dùng +/− để đổi kích thước.</div>
  `;
  stage.append(layer);

  const selection = $('pgBoardSelection');
  const controls = $('pgBoardControls');
  const help = $('pgBoardHelp');
  let chosen = null;
  let gesture = null;

  const isOnPage = (object) => object && fabricCanvas.getObjects().includes(object);
  const isPicture = (object) => object instanceof FabricImage;
  const isEditable = () => !state.ended && !state.pageBusy && state.tool === 'graphEdit';
  const rectOf = (object) => object.getBoundingRect();
  const point = (event) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function updateFrame() {
    if (!isEditable() || !isOnPage(chosen)) {
      if (!isOnPage(chosen)) chosen = null;
      selection.hidden = true;
      controls.hidden = true;
      help.hidden = !isEditable();
      return;
    }
    const rect = rectOf(chosen);
    if (!Number.isFinite(rect.left + rect.top + rect.width + rect.height)) return;
    selection.hidden = false;
    controls.hidden = false;
    help.hidden = true;
    Object.assign(selection.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`
    });
  }

  function activate() {
    if (state.ended || state.pageBusy) return;
    setTool('graphEdit');
    layer.hidden = false;
    toggle.classList.add('is-active');
    toggle.setAttribute('aria-pressed', 'true');
    updateFrame();
    setStatus('Chỉnh đồ thị: chọn ảnh rồi kéo hoặc kéo góc để thu phóng');
  }

  function deactivate() {
    if (gesture) finishGesture();
    chosen = null;
    layer.hidden = true;
    selection.hidden = true;
    controls.hidden = true;
    toggle.classList.remove('is-active');
    toggle.setAttribute('aria-pressed', 'false');
    if (state.tool === 'graphEdit' && !state.ended) setTool('pen');
  }

  // Tạo bản sao trước khi sửa: snapshot() của bản gốc dùng tham chiếu.
  // Thay object chứ không sửa object gốc để Undo/Redo khôi phục được vị trí & tỉ lệ.
  function createWorkingCopy(original) {
    const copy = new FabricImage(original.getElement(), {
      left: original.left, top: original.top,
      originX: original.originX, originY: original.originY,
      scaleX: original.scaleX, scaleY: original.scaleY,
      angle: original.angle, skewX: original.skewX, skewY: original.skewY,
      flipX: original.flipX, flipY: original.flipY,
      opacity: original.opacity, cropX: original.cropX, cropY: original.cropY,
      width: original.width, height: original.height,
      selectable: false, evented: false, objectCaching: false
    });
    copy._isPlotlyGraph = Boolean(original._isPlotlyGraph);
    const index = fabricCanvas.getObjects().indexOf(original);
    fabricCanvas.remove(original);
    fabricCanvas.insertAt(index, copy);
    chosen = copy;
    return copy;
  }

  function applyTransform(object, rect, scaleX, scaleY) {
    object.set({ left: rect.left, top: rect.top, scaleX, scaleY });
    object.setCoords();
    fabricCanvas.requestRenderAll();
    updateFrame();
  }

  function zoom(factor) {
    if (!isEditable() || !isOnPage(chosen) || gesture) return;
    const bounds = rectOf(chosen);
    const nextW = bounds.width * factor;
    const nextH = bounds.height * factor;
    if (Math.min(nextW, nextH) < 50 || Math.max(nextW, nextH) >
      Math.max(fabricCanvas.getWidth(), fabricCanvas.getHeight()) * 4) return;
    const before = snapshot();
    const original = chosen;
    const copy = createWorkingCopy(original);
    applyTransform(copy, {
      left: bounds.left + (bounds.width - nextW) / 2,
      top: bounds.top + (bounds.height - nextH) / 2
    }, original.scaleX * factor, original.scaleY * factor);
    remember(before);
    setStatus(factor > 1 ? 'Đã phóng to ảnh đồ thị' : 'Đã thu nhỏ ảnh đồ thị');
  }

  function hitImage(position) {
    return fabricCanvas.getObjects().slice().reverse().find((object) => {
      if (!isPicture(object) || !object.visible) return false;
      const r = rectOf(object);
      return position.x >= r.left && position.x <= r.left + r.width &&
             position.y >= r.top && position.y <= r.top + r.height;
    }) || null;
  }

  function hitCorner(position, rect) {
    const corners = {
      nw: { x: rect.left, y: rect.top },
      ne: { x: rect.left + rect.width, y: rect.top },
      sw: { x: rect.left, y: rect.top + rect.height },
      se: { x: rect.left + rect.width, y: rect.top + rect.height }
    };
    return Object.keys(corners).find((name) => distance(position, corners[name]) <= 25) || null;
  }

  layer.addEventListener('pointerdown', (event) => {
    if (!isEditable() || gesture || event.target.closest('button')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && !event.isPrimary) return;
    event.preventDefault();
    const start = point(event);
    const oldRect = isOnPage(chosen) ? rectOf(chosen) : null;
    let corner = oldRect ? hitCorner(start, oldRect) : null;
    if (!corner) {
      const clicked = hitImage(start);
      if (clicked !== chosen) chosen = clicked;
    }
    if (!isOnPage(chosen)) { chosen = null; updateFrame(); return; }
    const bounds = rectOf(chosen);
    // Khi nhấn vào ảnh đã chọn, nhấn gần góc thì scale, nơi khác thì kéo.
    if (!corner) corner = hitCorner(start, bounds);
    const opposite = {
      nw: { x: bounds.left + bounds.width, y: bounds.top + bounds.height },
      ne: { x: bounds.left, y: bounds.top + bounds.height },
      sw: { x: bounds.left + bounds.width, y: bounds.top },
      se: { x: bounds.left, y: bounds.top }
    };
    gesture = {
      pointerId: event.pointerId, start, bounds, corner,
      opposite: corner ? opposite[corner] : null,
      original: chosen, current: chosen,
      before: snapshot(), changed: false,
      startDistance: corner ? Math.max(1, distance(start, opposite[corner])) : 1
    };
    updateFrame();
    try { layer.setPointerCapture(event.pointerId); } catch { /* Không bắt buộc. */ }
  });

  layer.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const p = point(event);
    const g = gesture;
    const moved = distance(p, g.start);
    if (!g.changed && moved < 2) return;
    if (!g.changed) {
      g.current = createWorkingCopy(g.original);
      g.changed = true;
    }
    if (g.corner) {
      const factor = Math.max(0.1, distance(p, g.opposite) / g.startDistance);
      const w = g.bounds.width * factor;
      const h = g.bounds.height * factor;
      if (Math.min(w, h) < 50 || Math.max(w, h) >
        Math.max(fabricCanvas.getWidth(), fabricCanvas.getHeight()) * 4) return;
      const left = g.corner.includes('w') ? g.opposite.x - w : g.opposite.x;
      const top = g.corner.includes('n') ? g.opposite.y - h : g.opposite.y;
      applyTransform(g.current, { left, top }, g.original.scaleX * factor, g.original.scaleY * factor);
    } else {
      const width = g.bounds.width;
      const height = g.bounds.height;
      applyTransform(g.current, {
        left: clamp(g.bounds.left + p.x - g.start.x, -width + 32, fabricCanvas.getWidth() - 32),
        top: clamp(g.bounds.top + p.y - g.start.y, -height + 32, fabricCanvas.getHeight() - 32)
      }, g.original.scaleX, g.original.scaleY);
    }
  });

  function finishGesture() {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    if (g.changed) {
      remember(g.before);
      setStatus('Đã di chuyển / thay đổi kích thước đồ thị (có thể Hoàn tác)');
    }
    updateFrame();
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    layer.addEventListener(name, (event) => {
      if (gesture && gesture.pointerId === event.pointerId) finishGesture();
    });
  }
  let wheelAccum = 0;
  layer.addEventListener('wheel', (event) => {
    if (!isEditable() || !isOnPage(chosen)) return;
    const p = point(event);
    const r = rectOf(chosen);
    if (p.x < r.left || p.x > r.left + r.width || p.y < r.top || p.y > r.top + r.height) return;
    event.preventDefault();
    wheelAccum += event.deltaY;
    if (Math.abs(wheelAccum) >= 50) {
      zoom(wheelAccum < 0 ? 1.1 : 1 / 1.1);
      wheelAccum = 0;
    }
  }, { passive: false });
  $('pgBoardZoomIn').addEventListener('click', () => zoom(1.2));
  $('pgBoardZoomOut').addEventListener('click', () => zoom(1 / 1.2));
  $('pgBoardDone').addEventListener('click', deactivate);
  toggle.addEventListener('click', () => isEditable() ? deactivate() : activate());
  toolbar.addEventListener('click', (event) => {
    if (event.target.closest('#plotlyEditTool')) return;
    if (state.tool !== 'graphEdit' || event.target.closest('#handwritingTool,#plotlyGraphTool')) {
      deactivate();
    }
  });
  for (const id of ['prevPage', 'nextPage', 'addPageButton', 'deletePageButton', 'clearButton', 'endSession']) {
    $(id)?.addEventListener('click', () => { if (!layer.hidden) deactivate(); });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !layer.hidden) deactivate();
  });
  fabricCanvas.on('object:removed', ({ target }) => {
    // Xóa/hoàn tác cũng phải bỏ viền chọn ảnh cũ.
    if (chosen === target && !gesture) { chosen = null; updateFrame(); }
  });
  if ('ResizeObserver' in window) new ResizeObserver(updateFrame).observe(stage);

  return {
    activate,
    deactivate,
    selectImage(object) {
      if (!isOnPage(object)) return;
      chosen = object;
      activate();
      updateFrame();
    }
  };
}

export function setupGraphExtension() {
  if ($('plotlyGraphTool')) return;
  const button = document.createElement('button');
  button.id = 'plotlyGraphTool';
  button.type = 'button';
  button.className = 'tool-button';
  button.textContent = 'Đồ thị';
  button.title = 'Vẽ đồ thị Plotly từ phương trình hoặc kết quả chữ viết tay';
  button.setAttribute('aria-label', 'Mở công cụ vẽ đồ thị 2D');
  $('handwritingTool').insertAdjacentElement('afterend', button);
  const boardEditor = setupBoardGraphEditor();

  const panel = document.createElement('section');
  panel.id = 'plotlyGraphPanel';
  panel.className = 'pg-panel';
  panel.setAttribute('aria-label', 'Đồ thị hàm số 2D');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="pg-header" id="pgDragHandle">
      <strong>Đồ thị 2D · Plotly.js <small>(Kéo để di chuyển)</small></strong>
      <div class="pg-window-actions">
        <button type="button" id="pgMinimize" title="Thu nhỏ cửa sổ" aria-label="Thu nhỏ cửa sổ">−</button>
        <button type="button" id="pgMaximize" title="Phóng to cửa sổ" aria-label="Phóng to cửa sổ">□</button>
        <button type="button" id="pgClose" title="Đóng đồ thị" aria-label="Đóng đồ thị">×</button>
      </div>
    </div>
    <div class="pg-body">
      <label for="pgEquation">Phương trình y = f(x)</label>
      <div class="pg-equation-row">
        <input id="pgEquation" type="text" spellcheck="false" value="y=x²-2x+1" placeholder="Ví dụ: y=2x²+3x+1" />
        <button type="button" id="pgDraw">Vẽ</button>
      </div>
      <div id="pgMessage" class="pg-message" role="status" aria-live="polite">Nhập hàm số để vẽ.</div>
      <div class="pg-chart-actions" aria-label="Phóng to và thu nhỏ đồ thị">
        <button type="button" id="pgZoomIn" title="Phóng to đồ thị" aria-label="Phóng to đồ thị">+ Đồ thị</button>
        <button type="button" id="pgZoomOut" title="Thu nhỏ đồ thị" aria-label="Thu nhỏ đồ thị">− Đồ thị</button>
        <button type="button" id="pgResetView" title="Đặt lại vùng hiển thị" aria-label="Đặt lại góc nhìn">Đặt lại</button>
      </div>
      <div id="pgChart" class="pg-chart" role="img" aria-label="Đồ thị hàm số với hai trục tọa độ"></div>
      <div class="pg-chart-tip">Kéo trong đồ thị để di chuyển; lăn chuột để phóng to hoặc thu nhỏ.</div>
      <div id="pgFormula" class="pg-formula" aria-live="polite"></div>
      <label for="pgExample">Mẫu hàm số</label>
      <select id="pgExample">
        <option value="">Chọn nhanh...</option>
        <option value="y=2x+1">Bậc 1: y=2x+1</option>
        <option value="y=x²-2x+1">Bậc 2: y=x²-2x+1</option>
        <option value="y=x³-3x²+2x-1">Bậc 3: y=x³-3x²+2x-1</option>
        <option value="y=2sin(3x)+1">Sin: y=2sin(3x)+1</option>
        <option value="y=cos(x)">Cos: y=cos(x)</option>
        <option value="y=tan(x)">Tan: y=tan(x)</option>
      </select>
      <div id="pgSliders" class="pg-sliders" aria-label="Điều chỉnh hệ số hàm số"></div>
      <div class="pg-actions">
        <button type="button" id="pgSave">Lưu đồ thị vào trang</button>
        <button type="button" id="pgHide">Ẩn</button>
      </div>
      <p class="pg-note">Kéo hệ số để đổi đồ thị. Kéo thanh tiêu đề để di chuyển cửa sổ; kéo góc dưới bên phải để thay đổi kích thước. Lưu đồ thị sẽ chèn ảnh vào trang bảng hiện tại.</p>
    </div>
  `;
  // Cửa sổ nổi nằm ngoài canvas-stage để không bị cắt bởi khung vẽ hẹp.
  document.body.append(panel);

  const graph = $('pgChart');
  const equation = $('pgEquation');
  const sliders = $('pgSliders');
  const message = $('pgMessage');
  const liveFormula = $('pgFormula');
  const save = $('pgSave');
  let model = null;
  let lastAnchor = null;
  let pending = null;
  let rendering = false;
  let dirty = false;
  let queued = false;
  let renderedOnce = false;
  let activePage = state.pageIndex;
  let normalRect = null;
  let customPosition = false;
  let viewRevision = 0;

  function inform(content, isError = false) {
    message.textContent = content;
    message.classList.toggle('pg-error', isError);
  }

  function showButtonActive(visible) {
    button.classList.toggle('is-active', visible);
    button.setAttribute('aria-pressed', String(visible));
  }

  function hide() {
    panel.hidden = true;
    showButtonActive(false);
    dirty = false;
  }

  function resizeChart() {
    if (renderedOnce && !panel.hidden && !panel.classList.contains('pg-minimized') && window.Plotly?.Plots?.resize) {
      Promise.resolve(window.Plotly.Plots.resize(graph)).catch(() => {});
    }
  }

  function moveWithinViewport(left, top) {
    panel.style.left = `${Math.round(clamp(left, 8, Math.max(8, window.innerWidth - panel.offsetWidth - 8)))}px`;
    panel.style.top = `${Math.round(clamp(top, 8, Math.max(8, window.innerHeight - panel.offsetHeight - 8)))}px`;
  }

  function position(anchor = lastAnchor) {
    if (customPosition) {
      moveWithinViewport(panel.offsetLeft, panel.offsetTop);
      return;
    }
    const stageBox = stage.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const boxWidth = panel.offsetWidth;
    const boxHeight = panel.offsetHeight;
    if (!anchor) {
      moveWithinViewport(Math.max(8, width - boxWidth - 20), Math.max(8, Math.min(70, height - boxHeight - 8)));
      return;
    }
    let left = stageBox.left + anchor.left + anchor.width + 12;
    if (left + boxWidth > width && stageBox.left + anchor.left - boxWidth - 12 >= 8) {
      left = stageBox.left + anchor.left - boxWidth - 12;
    }
    moveWithinViewport(left, stageBox.top + anchor.top);
  }

  function sliderKeys() {
    if (!model) return [];
    if (model.kind === 'trig') return ['a', 'b', 'c'];
    if (model.degree === 1) return ['a', 'b'];
    if (model.degree === 2) return ['a', 'b', 'c'];
    return ['a', 'b', 'c', 'd'];
  }

  function buildSliders() {
    sliders.replaceChildren();
    for (const key of sliderKeys()) {
      const initial = model.coefficients[key];
      const limit = Math.max(10, Math.ceil(Math.abs(initial) * 1.5 / 5) * 5);
      const row = document.createElement('div');
      row.className = 'pg-slider-row';
      const caption = document.createElement('label');
      caption.textContent = key;
      const range = document.createElement('input');
      const number = document.createElement('input');
      range.type = 'range';
      range.min = String(-limit);
      range.max = String(limit);
      range.step = '0.1';
      range.value = String(initial);
      range.id = `pgSlider${key}`;
      range.setAttribute('aria-label', `Hệ số ${key}`);
      caption.htmlFor = range.id;
      number.type = 'number';
      number.min = '-1000000';
      number.max = '1000000';
      number.step = '0.1';
      number.value = String(initial);
      number.setAttribute('aria-label', `Giá trị hệ số ${key}`);
      row.append(caption, range, number);
      sliders.append(row);
      range.addEventListener('input', () => {
        const value = Number(range.value);
        model.coefficients[key] = value;
        number.value = String(value);
        updateFormula();
        scheduleDraw();
      });
      number.addEventListener('change', () => {
        const value = Number(number.value);
        if (!Number.isFinite(value) || Math.abs(value) > 1e6) {
          number.value = String(model.coefficients[key]);
          return;
        }
        model.coefficients[key] = value;
        if (value < Number(range.min) || value > Number(range.max)) {
          const next = Math.ceil(Math.abs(value) / 5) * 5 + 5;
          range.min = String(-next);
          range.max = String(next);
        }
        range.value = String(value);
        updateFormula();
        scheduleDraw();
      });
    }
  }

  function updateFormula() {
    if (!model) return;
    const written = formula(model);
    liveFormula.textContent = written;
    equation.value = written;
  }

  function layout() {
    return {
      title: { text: formula(model), font: { size: 14, color: '#1e293b' }, x: 0.52 },
      xaxis: { title: { text: 'x', font: { size: 11 } }, zeroline: true, zerolinewidth: 1.3, zerolinecolor: '#64748b', gridcolor: '#edf2fa', autorange: false, range: model.kind === 'trig' ? [-2 * Math.PI, 2 * Math.PI] : [-10, 10] },
      yaxis: { title: { text: 'y', font: { size: 11 } }, zeroline: true, zerolinewidth: 1.3, zerolinecolor: '#64748b', gridcolor: '#edf2fa', autorange: true },
      margin: { l: 45, r: 12, t: 42, b: 40 },
      showlegend: false, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
      hovermode: 'closest', dragmode: 'pan',
      uirevision: viewRevision,
      font: { family: 'Arial, sans-serif', size: 11 }
    };
  }

  function scheduleDraw() {
    if (!model || panel.hidden) return;
    if (rendering) { dirty = true; return; }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      void draw();
    });
  }

  async function draw() {
    if (!model || panel.hidden) return;
    if (rendering) { dirty = true; return; }
    rendering = true;
    save.disabled = true;
    try {
      inform('Đang dựng đồ thị...');
      const plotly = await getPlotly();
      if (!model || panel.hidden) return;
      const points = sample(model);
      const trace = {
        x: points.x, y: points.y, type: 'scatter', mode: 'lines',
        name: 'y=f(x)', connectgaps: false,
        line: { color: '#253a91', width: 2.7 }
      };
      await plotly.react(graph, [trace], layout(), {
        displayModeBar: true, displaylogo: false,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'lasso2d', 'select2d'],
        responsive: true, scrollZoom: true
      });
      renderedOnce = true;
      inform('Đồ thị đã cập nhật. Kéo hệ số để thay đổi trực tiếp.');
    } catch (error) {
      console.error('Plotly graph:', error);
      inform(error.message, true);
      renderedOnce = false;
    } finally {
      rendering = false;
      save.disabled = !renderedOnce || state.ended;
      if (dirty && !panel.hidden) {
        dirty = false;
        scheduleDraw();
      }
    }
  }

  function open(raw, anchor = null) {
    if (state.ended || state.pageBusy) return false;
    try {
      model = parseEquation(raw);
      viewRevision += 1; // Phương trình mới trở về vùng hiển thị mặc định.
      lastAnchor = anchor;
      activePage = state.pageIndex;
      equation.value = raw;
      buildSliders();
      updateFormula();
      panel.hidden = false;
      panel.classList.remove('pg-minimized');
      $('pgMinimize').textContent = '−';
      $('pgMinimize').setAttribute('aria-label', 'Thu nhỏ cửa sổ');
      showButtonActive(true);
      position(anchor);
      renderedOnce = false;
      scheduleDraw();
      setStatus('Đã tạo đồ thị từ phương trình; kéo a, b, c để chỉnh hệ số');
      return true;
    } catch (error) {
      model = null;
      renderedOnce = false;
      save.disabled = true;
      liveFormula.textContent = '';
      sliders.replaceChildren();
      if (window.Plotly?.purge) window.Plotly.purge(graph);
      graph.replaceChildren();
      inform(error.message, true);
      panel.hidden = false;
      panel.classList.remove('pg-minimized');
      $('pgMinimize').textContent = '−';
      showButtonActive(true);
      position(anchor);
      equation.value = raw;
      equation.focus();
      return false;
    }
  }

  button.addEventListener('click', () => {
    if (state.ended || state.pageBusy) return;
    if (!panel.hidden) { hide(); return; }
    open(equation.value || 'y=x²-2x+1');
  });
  $('pgClose').addEventListener('click', hide);
  $('pgHide').addEventListener('click', hide);
  $('pgDraw').addEventListener('click', () => open(equation.value, lastAnchor));
  equation.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); open(equation.value, lastAnchor); }
  });
  $('pgExample').addEventListener('change', (event) => {
    if (event.target.value) open(event.target.value);
  });

  save.addEventListener('click', async () => {
    if (!model || !renderedOnce || state.ended || state.pageBusy || activePage !== state.pageIndex) return;
    save.disabled = true;
    inform('Đang chèn ảnh đồ thị vào trang hiện tại...');
    try {
      const Plotly = await getPlotly();
      const dataURL = await Plotly.toImage(graph, { format: 'png', width: 600, height: 410, scale: 1.5 });
      const img = new Image();
      img.src = dataURL;
      if (img.decode) await img.decode();
      else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      if (state.ended || state.pageBusy || activePage !== state.pageIndex) {
        throw new Error('Trang đã thay đổi, không chèn ảnh.');
      }
      const before = snapshot();
      const maxW = Math.max(60, fabricCanvas.getWidth() - 14);
      const maxH = Math.max(60, fabricCanvas.getHeight() - 14);
      const w = Math.min(365, maxW, maxH * 600 / 410);
      const h = w * 410 / 600;
      const stageRect = stage.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const x = clamp(panelRect.left - stageRect.left, 4, Math.max(4, fabricCanvas.getWidth() - w - 4));
      const y = clamp(panelRect.top - stageRect.top, 4, Math.max(4, fabricCanvas.getHeight() - h - 4));
      const fabricImage = new FabricImage(img, {
        left: x, top: y, scaleX: w / img.naturalWidth, scaleY: h / img.naturalHeight,
        selectable: false, evented: false, objectCaching: false
      });
      fabricImage._isPlotlyGraph = true;
      fabricCanvas.add(fabricImage);
      fabricCanvas.requestRenderAll();
      updateHint();
      remember(before); // Lưu đúng trang và có thể Hoàn tác, không đụng trang khác.
      setStatus(`Đã lưu ảnh đồ thị vào trang ${state.pageIndex + 1}`);
      hide();
      boardEditor.selectImage(fabricImage);
    } catch (error) {
      inform(`Không chèn được đồ thị: ${error.message}`, true);
    } finally {
      save.disabled = state.ended;
    }
  });

  // Điều khiển thu nhỏ / phóng to / kéo cửa sổ và co giãn trong viewport.
  const minimize = $('pgMinimize');
  const maximize = $('pgMaximize');
  minimize.addEventListener('click', () => {
    if (panel.classList.contains('pg-maximized')) maximize.click();
    const wasMinimized = panel.classList.toggle('pg-minimized');
    minimize.textContent = wasMinimized ? '+' : '−';
    minimize.title = wasMinimized ? 'Mở rộng cửa sổ' : 'Thu nhỏ cửa sổ';
    minimize.setAttribute('aria-label', minimize.title);
    if (!wasMinimized) requestAnimationFrame(resizeChart);
  });
  maximize.addEventListener('click', () => {
    if (!panel.classList.contains('pg-maximized')) {
      const rect = panel.getBoundingClientRect();
      normalRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      panel.classList.remove('pg-minimized');
      minimize.textContent = '−';
      minimize.title = 'Thu nhỏ cửa sổ';
      minimize.setAttribute('aria-label', minimize.title);
      panel.classList.add('pg-maximized');
      maximize.textContent = '❐';
      maximize.title = 'Khôi phục cửa sổ';
    } else {
      panel.classList.remove('pg-maximized');
      maximize.textContent = '□';
      maximize.title = 'Phóng to cửa sổ';
      if (normalRect) {
        panel.style.width = `${normalRect.width}px`;
        panel.style.height = `${normalRect.height}px`;
        moveWithinViewport(normalRect.left, normalRect.top);
      }
    }
    maximize.setAttribute('aria-label', maximize.title);
    requestAnimationFrame(resizeChart);
  });

  const dragHandle = $('pgDragHandle');
  let drag = null;
  dragHandle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button') || event.button !== 0 || panel.classList.contains('pg-maximized')) return;
    event.preventDefault();
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      left: panel.offsetLeft, top: panel.offsetTop
    };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    customPosition = true;
    moveWithinViewport(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    dragHandle.addEventListener(eventName, () => { drag = null; });
  }

  // Plotly hỗ trợ pan bằng kéo, cuộn chuột để zoom; 3 nút dưới đây dùng khi không có chuột.
  async function zoomChart(scale) {
    if (!renderedOnce || !window.Plotly || panel.classList.contains('pg-minimized')) return;
    const full = graph._fullLayout;
    if (!full) return;
    const x = full.xaxis?.range;
    const y = full.yaxis?.range;
    if (!x || !y) return;
    function scaled(range) {
      const mid = (Number(range[0]) + Number(range[1])) / 2;
      const half = (Number(range[1]) - Number(range[0])) * scale / 2;
      return [mid - half, mid + half];
    }
    await window.Plotly.relayout(graph, {
      'xaxis.range': scaled(x), 'yaxis.range': scaled(y),
      'xaxis.autorange': false, 'yaxis.autorange': false
    });
  }
  $('pgZoomIn').addEventListener('click', () => void zoomChart(0.75));
  $('pgZoomOut').addEventListener('click', () => void zoomChart(1.35));
  $('pgResetView').addEventListener('click', async () => {
    if (!renderedOnce || !window.Plotly) return;
    await window.Plotly.relayout(graph, {
      'xaxis.range': model.kind === 'trig' ? [-2 * Math.PI, 2 * Math.PI] : [-10, 10],
      'xaxis.autorange': false,
      'yaxis.autorange': true
    });
  });

  // Tự nhận phương trình do tiện ích OCR cũ chuẩn bị chèn mà không sửa mã OCR.
  const handwritingDialog = $('handwritingDialog');
  const hwInsert = $('hwInsert');
  if (handwritingDialog && hwInsert) {
    const actions = handwritingDialog.querySelector('.hw-actions');
    const fromOCR = document.createElement('button');
    fromOCR.type = 'button';
    fromOCR.id = 'pgFromHandwriting';
    fromOCR.textContent = 'Vẽ đồ thị';
    fromOCR.title = 'Vẽ đồ thị từ nội dung nhận dạng mà không cần chèn chữ';
    actions.insertBefore(fromOCR, hwInsert);

    function ocrAnchor() {
      const selection = $('handwritingSelector')?.querySelector('.hw-selection');
      if (!selection) return null;
      const left = parseFloat(selection.style.left);
      const top = parseFloat(selection.style.top);
      const width = parseFloat(selection.style.width);
      const height = parseFloat(selection.style.height);
      if (![left, top, width, height].every(Number.isFinite)) return null;
      return { left, top, width, height };
    }

    fromOCR.addEventListener('click', () => {
      const content = $('hwContent').value;
      if (open(content, ocrAnchor())) {
        handwritingDialog.close(); // Giữ lại nét viết tay nếu chưa bấm "Chèn lên bảng".
      } else {
        const status = $('hwProgress');
        status.textContent = 'Phương trình chưa được hỗ trợ. Hãy sửa nội dung OCR rồi thử lại.';
        status.classList.add('hw-error');
      }
    });

    hwInsert.addEventListener('click', () => {
      pending = null;
      if (hwInsert.disabled || !handwritingDialog.open) return;
      const text = $('hwContent').value.trim();
      try {
        parseEquation(text);
        pending = { text, pageIndex: state.pageIndex, timestamp: Date.now() };
      } catch { /* Nếu chỉ là chữ thường thì giữ hành vi chèn cũ. */ }
    }, { capture: true });

    fabricCanvas.on('object:added', (event) => {
      if (!pending || state.pageIndex !== pending.pageIndex || Date.now() - pending.timestamp > 60000) return;
      const object = event.target;
      if (!object || !(object instanceof Textbox || object instanceof FabricImage)) return;
      const request = pending;
      pending = null;
      const bounds = object.getBoundingRect();
      const anchor = {
        left: Number(bounds.left) || 0, top: Number(bounds.top) || 0,
        width: Number(bounds.width) || 0, height: Number(bounds.height) || 0
      };
      queueMicrotask(() => { if (!state.ended && state.pageIndex === request.pageIndex) open(request.text, anchor); });
    });
    handwritingDialog.addEventListener('close', () => {
      if (pending) {
        // Đóng hộp thoại không đồng nghĩa đã chèn; nếu không có object mới thì hủy.
        // Với LaTeX, object:added đã xảy ra trước dialog.close().
        pending = null;
      }
    });
  }

  for (const id of ['prevPage', 'nextPage', 'addPageButton', 'deletePageButton', 'endSession']) {
    $(id).addEventListener('click', hide);
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden && !handwritingDialog?.open) hide();
  });
  // Không để cửa sổ đi ra ngoài màn hình khi thay đổi kích thước trình duyệt.
  window.addEventListener('resize', () => {
    if (panel.hidden) return;
    if (!panel.classList.contains('pg-maximized')) moveWithinViewport(panel.offsetLeft, panel.offsetTop);
    requestAnimationFrame(resizeChart);
  });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => resizeChart()).observe(graph);
  }
}
