/**
 * Nhận dạng chữ viết tay theo vùng chọn, không chỉnh sửa các module cũ.
 * Tesseract.js: OCR chạy trong trình duyệt. MathJax: dựng LaTeX thành SVG.
 * OCR toán chỉ gợi ý LaTeX đơn giản; giáo viên được kiểm tra và sửa kết quả.
 */
import { FabricImage, Path, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, stage, surface, toolbar, fabricCanvas, state, ui, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from '../components/history.js';
import { closePanels } from '../components/toolbar.js';

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
