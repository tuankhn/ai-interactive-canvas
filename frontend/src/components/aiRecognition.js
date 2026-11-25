import { Text, FabricImage, Path } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, fabricCanvas, state, ui, setStatus, isDarkBoardActive, withOpaqueBoardExport } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { closePanels } from './toolbar.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { showAppToast } from '../utils/ui_feedback.js';
import { makePanelDraggable } from '../utils/floating_drag.js';
import {
  isOfflineMode,
  markNetworkOffline,
  handlePossibleNetworkError,
  showCornerNotification,
} from '../utils/offline_sync.js';

const AUTO_AI_IDLE_MS = 900;
const AI_FETCH_TIMEOUT_MS = 24000;
const MAX_RETRY_BACKOFF_MS = 3200;

let isAutoAiEnabled = false;
let isRecognizing = false;
let aiDebounceTimer = null;
let currentAiResult = null;
let pendingMultiClusters = [];
let recognizedStrokeObjects = [];
let recognizedRegion = null;
let recognizedPageIndex = null;
let aiRequestId = 0;
let boardSocket = null;
let wsRetryCount = 0;
let wsRetryTimer = null;
let lastCapturedImageBase64 = null;
let lastRecognizeMeta = null;
let consecutiveRetryCount = 0;

function rectsOverlap(a, b, margin = 12) {
  return (
    a.left <= b.left + b.width + margin &&
    a.left + a.width + margin >= b.left &&
    a.top <= b.top + b.height + margin &&
    a.top + a.height + margin >= b.top
  );
}

/**
 * Quy đổi preprocess.bounding_box từ tọa độ ảnh (multiplier) về tọa độ Fabric Canvas.
 */
function mapPreprocessBoxToCanvas(preprocess) {
  const bbox = preprocess?.bounding_box;
  const origSize = preprocess?.original_size;
  if (!bbox || !Array.isArray(origSize) || origSize[0] <= 0 || origSize[1] <= 0) {
    return null;
  }
  const scaleX = fabricCanvas.getWidth() / origSize[0];
  const scaleY = fabricCanvas.getHeight() / origSize[1];
  return {
    left: bbox.x * scaleX,
    top: bbox.y * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  };
}

function isRawHandwritingStroke(obj) {
  if (!(obj instanceof Path)) return false;
  const meta = obj.meta || {};
  if (meta.aiState === 'graded' || meta.aiState === 'formatted') return false;
  if (['question', 'answer_formatted', 'question_badge', 'grading_overlay', 'answer_zone', 'answer_zone_label'].includes(meta.dataRole)) {
    return false;
  }
  return true;
}

/**
 * Phân cụm không gian 2D (Union-Find / BFS) các nét viết tay mới:
 * - Tách các đề viết ngang cạnh nhau (gapX > 48px) hoặc viết thành nhiều dòng rời nhau (gapY > 36px)
 *   thành các cụm độc lập để nhận diện & gắn nhãn riêng từng đề.
 */
function clusterRawStrokes2D(strokes) {
  if (!Array.isArray(strokes) || strokes.length <= 1) {
    if (!strokes || strokes.length === 0) return [];
    const reg = computeBoundingRegion(strokes);
    return reg ? [{ strokes: strokes.slice(), region: reg }] : [];
  }

  const items = strokes
    .map((obj) => ({ obj, r: obj.getBoundingRect() }))
    .filter((it) => it.r && Number.isFinite(it.r.left));

  const n = items.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, idx) => idx);

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < n; i += 1) {
    const a = items[i].r;
    const aRight = a.left + a.width;
    const aBottom = a.top + a.height;
    for (let j = i + 1; j < n; j += 1) {
      const b = items[j].r;
      const bRight = b.left + b.width;
      const bBottom = b.top + b.height;

      const gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(aRight, bRight));
      const gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(aBottom, bBottom));

      // Hai nét thuộc cùng 1 biểu thức nếu sát ngang <= 48px và cùng dòng dọc <= 32px
      if (gapX <= 48 && gapY <= 32) {
        union(i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i].obj);
  }

  return Array.from(groups.values())
    .map((grpStrokes) => ({
      strokes: grpStrokes,
      region: computeBoundingRegion(grpStrokes),
    }))
    .filter((c) => Boolean(c.region))
    .sort((a, b) => {
      const sameRow = Math.abs(a.region.top - b.region.top) <= 38;
      return sameRow ? a.region.left - b.region.left : a.region.top - b.region.top;
    });
}

/**
 * Tách dự phòng chuỗi chứa nhiều biểu thức toán học ngăn bởi dấu ',' hoặc ';' ở cấp ngoặc ngoài cùng
 * (VD: "(x+5)^2, (x+9)^2, (3x+6)^2"), không tách cặp tọa độ như "(2, -1)".
 */
function splitTopLevelMathExpressions(rawStr) {
  const s = String(rawStr || '').trim();
  if (!s || (!s.includes(',') && !s.includes(';'))) return [s].filter(Boolean);

  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ',' || ch === ';')) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  const cleaned = parts.map((p) => p.replace(/^\\quad\s*|\s*\\quad$/g, '').trim()).filter(Boolean);
  if (cleaned.length < 2) return [s];

  // Chỉ tách khi mỗi vế đều là biểu thức độc lập thực sự (chứa phép toán/mũ/dấu '=' hoặc độ dài >= 4)
  const allLookLikeIndependentExprs = cleaned.every(
    (item) => item.length >= 3 && /[+\-*/=^²³()xXyYaAbB]/.test(item)
  );
  return allLookLikeIndependentExprs ? cleaned : [s];
}

function computeBoundingRegion(objects) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    const r = obj.getBoundingRect();
    if (!r) continue;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.left + r.width);
    maxY = Math.max(maxY, r.top + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    left: minX,
    top: minY,
    width: Math.max(40, maxX - minX),
    height: Math.max(32, maxY - minY),
  };
}

function resolveNonOverlappingTop(region, occupiedObjects) {
  let top = Math.max(36, region.top);
  const badgeClearance = 28;
  const estHeight = Math.max(48, Math.min(72, region.height));

  let adjusted = true;
  let guard = 0;
  while (adjusted && guard < 12) {
    adjusted = false;
    guard += 1;
    const candidate = {
      left: region.left,
      top: top - badgeClearance,
      width: Math.max(180, region.width),
      height: estHeight + badgeClearance,
    };
    for (const obj of occupiedObjects) {
      const b = obj.getBoundingRect();
      if (!b) continue;
      if (rectsOverlap(candidate, b, 6)) {
        top = Math.max(top, b.top + b.height + badgeClearance + 10);
        adjusted = true;
      }
    }
  }
  return top;
}

function captureRawStrokesCroppedWebP(targetStrokes, region) {
  const allObjects = fabricCanvas.getObjects();
  const targetSet = new Set(targetStrokes);
  const prevVisibility = new Map();
  const prevBg = fabricCanvas.backgroundColor;
  const prevVpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();

  const pad = 24;
  const cropLeft = Math.floor(region.left - pad);
  const cropTop = Math.floor(region.top - pad);
  const cropWidth = Math.max(32, Math.ceil(region.width + pad * 2));
  const cropHeight = Math.max(32, Math.ceil(region.height + pad * 2));

  try {
    for (const obj of allObjects) {
      if (!targetSet.has(obj)) {
        prevVisibility.set(obj, obj.visible);
        obj.visible = false;
      }
    }
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.backgroundColor = isDarkBoardActive() ? '#191816' : '#FFFFFF';
    fabricCanvas.renderAll();

    const webpUrl = fabricCanvas.toDataURL({
      format: 'webp',
      quality: 0.82,
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
      multiplier: 1,
    });
    if (typeof webpUrl === 'string' && webpUrl.startsWith('data:image/webp')) {
      return webpUrl;
    }
    return fabricCanvas.toDataURL({
      format: 'png',
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
      multiplier: 1,
    });
  } finally {
    for (const [obj, vis] of prevVisibility.entries()) {
      obj.visible = vis;
    }
    fabricCanvas.backgroundColor = prevBg || '';
    fabricCanvas.setViewportTransform(prevVpt);
    fabricCanvas.renderAll();
  }
}

/**
 * Xác định danh sách nét viết tay (Path) cần xóa và tọa độ chèn thay thế.
 */
function resolveStrokesAndRegionForReplacement(aiResult) {
  const currentCanvasObjects = fabricCanvas.getObjects();
  let strokesToRemove = [];

  if (recognizedPageIndex === state.pageIndex && recognizedStrokeObjects.length > 0) {
    strokesToRemove = recognizedStrokeObjects.filter((obj) => currentCanvasObjects.includes(obj));
  } else if (recognizedPageIndex === null) {
    strokesToRemove = currentCanvasObjects.filter((obj) => isRawHandwritingStroke(obj));
  }

  let region = recognizedRegion ? { ...recognizedRegion } : null;
  if (strokesToRemove.length > 0) {
    region = computeBoundingRegion(strokesToRemove) || region;
  }
  if (!region) {
    const mappedBox = mapPreprocessBoxToCanvas(aiResult?.preprocess);
    region = mappedBox
      ? {
          left: Math.max(16, mappedBox.left),
          top: Math.max(16, mappedBox.top),
          width: Math.max(180, mappedBox.width),
          height: Math.max(48, mappedBox.height),
        }
      : { left: 48, top: 88, width: 320, height: 52 };
  }

  const occupied = currentCanvasObjects.filter((obj) =>
    ['question', 'answer_formatted', 'question_badge'].includes(obj?.meta?.dataRole)
  );
  const safeTop = resolveNonOverlappingTop(region, occupied);
  region = { ...region, top: safeTop };

  return { strokesToRemove, region };
}

const getAiElements = () => ({
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
  reanalyzeBoardBtn: $('btnReanalyzeBoard'),
  errorBanner: $('aiErrorBanner'),
  errorMessage: $('aiErrorMessage'),
  retryErrorBtn: $('retryAiErrorBtn'),
  rescanBoardErrorBtn: $('rescanBoardErrorBtn'),
  closeBtn: $('closeAiPanelBtn'),
  insertBtn: $('insertToBoardBtn'),
  retryBtn: $('reRecognizeBtn'),
  subjectSelect: $('subjectSelect'),
  // Task TF2850F: Các phần tử cho tính năng minh họa nét phấn trắng
  illustrationBox: $('aiIllustrationBox'),
  illustrationTitle: $('aiIllustrationTitle'),
  illustrationPreview: $('aiIllustrationPreview'),
  illustrationDesc: $('aiIllustrationDesc'),
  insertIllustrationBtn: $('insertIllustrationBtn'),
  illustrateBtn: $('aiIllustrateBtn'),
  illustrateDialog: $('illustrateDialog'),
  illustrateInput: $('illustrateInput'),
  cancelIllustrateBtn: $('cancelIllustrateBtn'),
  submitIllustrateBtn: $('submitIllustrateBtn'),
  // Task TF28512: Các phần tử hiển thị đồ thị 2D tương tác
  graphBox: $('aiGraphBox'),
  graphTitle: $('aiGraphTitle'),
  graphDesc: $('aiGraphDesc'),
  openGraphBtn: $('openGraphBtn'),
});

function showAiErrorState(message) {
  const aiElements = getAiElements();
  currentAiResult = null;
  if (aiElements.overlay) aiElements.overlay.hidden = false;
  if (aiElements.loading) aiElements.loading.hidden = true;
  if (aiElements.content) aiElements.content.hidden = true;
  if (aiElements.errorBanner) aiElements.errorBanner.hidden = false;
  if (aiElements.errorMessage) aiElements.errorMessage.textContent = message;
  if (aiElements.insertBtn) aiElements.insertBtn.disabled = true;
  if (aiElements.statusIndicator) {
    aiElements.statusIndicator.textContent = 'AI: Gián đoạn (Bấm thử lại)';
    aiElements.statusIndicator.classList.remove('is-analyzing');
  }
  setStatus('AI tạm thời gián đoạn — nét vẽ vẫn được giữ nguyên');
}

function clearAiErrorState() {
  const aiElements = getAiElements();
  if (aiElements.errorBanner) aiElements.errorBanner.hidden = true;
  if (aiElements.insertBtn) aiElements.insertBtn.disabled = false;
}


export function cancelAIDebounce() {
  if (aiDebounceTimer) {
    clearTimeout(aiDebounceTimer);
    aiDebounceTimer = null;
  }
}

export function scheduleAIDebounce() {
  if (!isAutoAiEnabled || state.ended || isOfflineMode() || state.stroke) return;
  if (!fabricCanvas.getObjects().length) return;
  cancelAIDebounce();
  aiDebounceTimer = setTimeout(() => {
    aiDebounceTimer = null;
    if (!isAutoAiEnabled || state.ended || state.stroke || !fabricCanvas.getObjects().length) return;
    performAIRecognition({ isDebounced: true });
  }, AUTO_AI_IDLE_MS);
}

export async function performAIRecognition({
  isDebounced = false,
  cachedImageBase64 = null,
  cachedMeta = null,
} = {}) {
  if (state.ended || isRecognizing) return;
  if (isOfflineMode()) {
    if (!isDebounced) {
      await markNetworkOffline('manual-ai-while-offline');
      setStatus('AI đang tạm dừng do mất mạng');
    }
    return;
  }
  const objects = fabricCanvas.getObjects();
  if (!cachedImageBase64 && (!objects || objects.length === 0)) {
    if (!isDebounced) {
      showAppToast({
        title: 'Mặt bảng đang trống',
        message: 'Hãy viết công thức hoặc từ vựng lên bảng trước khi bấm Nhận diện AI.',
        variant: 'warning',
      });
    }
    return;
  }

  const aiElements = getAiElements();
  const thisRequestId = ++aiRequestId;
  const thisPage = state.pageIndex;

  isRecognizing = true;
  if (aiElements.statusIndicator) {
    aiElements.statusIndicator.textContent = isDebounced ? 'AI: Tự động nhận diện...' : 'AI: Đang nhận diện...';
    aiElements.statusIndicator.classList.add('is-analyzing');
  }

  // Mở overlay panel và hiển thị trạng thái loading
  if (aiElements.overlay) aiElements.overlay.hidden = false;
  if (aiElements.errorBanner) aiElements.errorBanner.hidden = true;
  if (aiElements.loading) aiElements.loading.hidden = false;
  if (aiElements.content) aiElements.content.hidden = true;
  setStatus('Đang gửi nét vẽ lên AI (Gemini / Mathpix)...');

  const abortCtrl = new AbortController();
  const reqTimeout = setTimeout(() => abortCtrl.abort(), AI_FETCH_TIMEOUT_MS);

  try {
    let imageBase64 = cachedImageBase64;
    let detectedClusters = [];
    if (!imageBase64) {
      const rawStrokes = fabricCanvas.getObjects().filter((obj) => isRawHandwritingStroke(obj));
      if (rawStrokes.length === 0) {
        if (!isDebounced) {
          showAppToast({
            title: 'Không có nét viết tay mới',
            message: 'Các nội dung trên bảng đã được định dạng hoặc chấm xong. Hãy viết câu mới rồi bấm Nhận diện AI.',
            variant: 'info',
          });
        }
        if (aiElements.overlay) aiElements.overlay.hidden = true;
        if (aiElements.statusIndicator) {
          aiElements.statusIndicator.textContent = 'AI: Sẵn sàng';
          aiElements.statusIndicator.classList.remove('is-analyzing');
        }
        return;
      }
      detectedClusters = clusterRawStrokes2D(rawStrokes);
      const targetRegion = computeBoundingRegion(rawStrokes);
      recognizedStrokeObjects = rawStrokes;
      recognizedRegion = targetRegion;
      recognizedPageIndex = state.pageIndex;
      if (detectedClusters.length <= 1) {
        pendingMultiClusters = [];
        imageBase64 = captureRawStrokesCroppedWebP(rawStrokes, targetRegion);
      }
    } else {
      pendingMultiClusters = [];
    }
    const subject = cachedMeta?.subject || (aiElements.subjectSelect ? aiElements.subjectSelect.value : 'TOAN');

    lastRecognizeMeta = {
      session_id: cachedMeta?.session_id || $('sessionId')?.textContent?.trim() || 'session-10a1',
      room_id: cachedMeta?.room_id || $('roomId')?.textContent?.trim() || 'room-10a1',
      subject,
      page_number: cachedMeta?.page_number || (state.pageIndex + 1),
    };

    const startTime = performance.now();
    let data = null;

    if (!cachedImageBase64 && detectedClusters.length > 1) {
      const clusterCaptures = detectedClusters.map((cluster) => ({
        ...cluster,
        imageBase64: captureRawStrokesCroppedWebP(cluster.strokes, cluster.region),
      }));
      lastCapturedImageBase64 = clusterCaptures[0]?.imageBase64 || null;

      const clusterResults = await Promise.all(
        clusterCaptures.map(async (cItem) => {
          const resp = await authFetch('/api/v1/recognize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortCtrl.signal,
            body: JSON.stringify({
              session_id: lastRecognizeMeta.session_id,
              room_id: lastRecognizeMeta.room_id,
              subject: lastRecognizeMeta.subject,
              page_number: lastRecognizeMeta.page_number,
              image_base64: cItem.imageBase64,
              debounce_ms: 800,
              provider: 'auto',
              already_cropped: true,
              fast_mode: true,
            }),
          });
          if (!resp.ok) {
            throw new Error(`Máy chủ trả về HTTP ${resp.status}`);
          }
          const resJson = await resp.json();
          return {
            strokes: cItem.strokes,
            region: cItem.region,
            aiResult: resJson,
          };
        })
      );

      const validClusterResults = clusterResults.filter((cr) => {
        const r = cr.aiResult;
        const err =
          r?.subject_details?.status === 'error' ||
          (Boolean(r?.degraded_reason) && !String(r?.recognized_text || '').trim() && !String(r?.latex || '').trim());
        return !err && Boolean(String(r?.latex || r?.recognized_text || '').trim());
      });

      if (validClusterResults.length === 0) {
        data = clusterResults[0]?.aiResult || {};
        pendingMultiClusters = [];
      } else {
        pendingMultiClusters = validClusterResults;
        const combinedLatex = validClusterResults
          .map((cr) => cr.aiResult.latex || cr.aiResult.recognized_text)
          .join(' \\;\\; | \\;\\; ');
        const combinedText = validClusterResults
          .map((cr, idx) => `[Cụm ${idx + 1}] ${cr.aiResult.recognized_text || cr.aiResult.latex}`)
          .join('\n');
        data = {
          ...validClusterResults[0].aiResult,
          recognized_text: combinedText,
          latex: combinedLatex,
          explanation: `Đã tách & nhận diện độc lập ${validClusterResults.length} cụm viết tay riêng biệt. Bấm "Chèn vào mặt bảng" để đặt từng khối vào đúng vị trí!`,
        };
      }
    } else {
      lastCapturedImageBase64 = imageBase64;
      const payload = {
        session_id: lastRecognizeMeta.session_id,
        room_id: lastRecognizeMeta.room_id,
        subject: lastRecognizeMeta.subject,
        page_number: lastRecognizeMeta.page_number,
        image_base64: imageBase64,
        debounce_ms: 800,
        provider: 'auto',
        already_cropped: !cachedImageBase64,
        fast_mode: true,
      };

      const response = await authFetch('/api/v1/recognize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: abortCtrl.signal,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Máy chủ trả về HTTP ${response.status}`);
      }

      data = await response.json();
    }

    const elapsed = Math.round(performance.now() - startTime);

    // KIỂM SOÁT LỆCH PHA (RACE CONDITION) & TRÁNH LỖI DOMINO:
    if (thisRequestId !== aiRequestId || state.pageIndex !== thisPage || state.ended) {
      return;
    }

    const isBackendError =
      data?.subject_details?.status === 'error' ||
      (Boolean(data?.degraded_reason) &&
        !String(data?.recognized_text || '').trim() &&
        !String(data?.latex || '').trim());

    if (isBackendError) {
      showAiErrorState(
        data.explanation ||
          `Dịch vụ AI tạm thời gián đoạn (${data.degraded_reason || 'Timeout'}). Nét vẽ của bạn vẫn được giữ nguyên.`
      );
      return;
    }

    consecutiveRetryCount = 0;
    clearAiErrorState();
    currentAiResult = data;

    if (aiElements.loading) aiElements.loading.hidden = true;
    if (aiElements.content) aiElements.content.hidden = false;

    // Hiển thị Provider & Badges
    if (aiElements.providerBadge) {
      aiElements.providerBadge.textContent = data.provider || 'Gemini AI';
      aiElements.providerBadge.classList.toggle('is-mock', (data.provider || '').toUpperCase().includes('MOCK'));
    }
    if (aiElements.confidenceBadge) {
      const conf = Math.round((data.confidence || 0.95) * 100);
      aiElements.confidenceBadge.textContent = `${conf}%`;
    }
    if (aiElements.latencyBadge) {
      aiElements.latencyBadge.textContent = `${data.latency_ms || elapsed} ms`;
    }

    // Hiển thị công thức LaTeX / Text bằng KaTeX hoặc Thẻ từ vựng Tiếng Anh
    const isEnglish = (data.subject || '').toUpperCase().includes('ENG') || (data.subject || '').toUpperCase().includes('TIENG_ANH');
    const details = data.subject_details || {};
    const displayFormula = data.latex || data.recognized_text || '\\text{Không có nội dung}';

    if (aiElements.rawBox) {
      aiElements.rawBox.textContent = displayFormula;
    }

    if (aiElements.renderedBox) {
      aiElements.renderedBox.innerHTML = '';

      if (isEnglish && (details.ipa || details.word_type || details.vietnamese_meaning || details.grammar_structure)) {
        // Giao diện thẻ học Tiếng Anh chuyên sâu (Từ vựng hoặc Cấu trúc Ngữ pháp)
        const engContainer = document.createElement('div');
        engContainer.className = 'ai-eng-card';

        if (details.grammar_structure) {
          const headLine = document.createElement('div');
          headLine.className = 'ai-eng-head';
          headLine.innerHTML = `<strong class="ai-eng-word">${escapeHtml(details.grammar_structure)}</strong>`;
          engContainer.appendChild(headLine);

          const sentenceLine = document.createElement('div');
          sentenceLine.className = 'ai-eng-example';
          sentenceLine.innerHTML = `<strong>Câu:</strong> ${escapeHtml(data.recognized_text)}`;
          engContainer.appendChild(sentenceLine);

          if (details.usage) {
            const usageLine = document.createElement('div');
            usageLine.className = 'ai-eng-meaning';
            usageLine.textContent = `Cách dùng: ${details.usage}`;
            engContainer.appendChild(usageLine);
          }
        } else {
          const headLine = document.createElement('div');
          headLine.className = 'ai-eng-head';
          headLine.innerHTML = `<strong class="ai-eng-word">${escapeHtml(details.word || data.recognized_text)}</strong> <span class="ai-eng-type">[${escapeHtml(details.word_type || 'Word')}]</span> <span class="ai-eng-ipa">${escapeHtml(details.ipa || '')}</span>`;
          engContainer.appendChild(headLine);

          if (details.vietnamese_meaning) {
            const meaningLine = document.createElement('div');
            meaningLine.className = 'ai-eng-meaning';
            meaningLine.textContent = `Nghĩa: ${details.vietnamese_meaning}`;
            engContainer.appendChild(meaningLine);
          }

          if (details.example_sentence) {
            const exLine = document.createElement('div');
            exLine.className = 'ai-eng-example';
            exLine.innerHTML = `<em>Ex:</em> ${escapeHtml(details.example_sentence)} <br><span class="ai-eng-trans">(${escapeHtml(details.example_translation || '')})</span>`;
            engContainer.appendChild(exLine);
          }
        }

        aiElements.renderedBox.appendChild(engContainer);

      } else if (window.katex && data.latex) {
        try {
          window.katex.render(data.latex, aiElements.renderedBox, {
            throwOnError: false,
            displayMode: true
          });
        } catch {
          aiElements.renderedBox.textContent = data.recognized_text || data.latex;
        }
      } else {
        aiElements.renderedBox.textContent = data.recognized_text || data.latex;
      }
    }

    // Task TF2850F: Hiển thị hình minh họa nét phấn trắng nếu có
    if (aiElements.illustrationBox) {
      if (data.illustration && (data.illustration.svg_content || data.illustration.image_data_url)) {
        aiElements.illustrationBox.hidden = false;
        if (aiElements.illustrationTitle) {
          aiElements.illustrationTitle.textContent = data.illustration.caption || `Minh họa: ${data.illustration.concept}`;
        }
        if (aiElements.illustrationPreview) {
          aiElements.illustrationPreview.textContent = '';
          const previewSrc = data.illustration.image_data_url || (
            data.illustration.svg_content
              ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.illustration.svg_content)}`
              : ''
          );
          if (previewSrc) {
            const previewImg = document.createElement('img');
            previewImg.src = previewSrc;
            previewImg.alt = data.illustration.caption || data.illustration.concept || 'Minh họa AI';
            previewImg.style.maxWidth = '100%';
            previewImg.style.height = 'auto';
            aiElements.illustrationPreview.appendChild(previewImg);
          }
        }
        if (aiElements.illustrationDesc) {
          aiElements.illustrationDesc.textContent = data.illustration.description || '';
        }
      } else {
        aiElements.illustrationBox.hidden = true;
      }
    }

    // Task TF28512: Hiển thị tùy chọn dựng đồ thị 2D tương tác Plotly nếu là hàm số
    if (aiElements.graphBox) {
      if (data.visualization && data.visualization.type === '2D_GRAPH') {
        aiElements.graphBox.hidden = false;
        if (aiElements.graphTitle) {
          aiElements.graphTitle.textContent = data.visualization.title || 'Đồ thị hàm số 2D';
        }
        if (aiElements.graphDesc) {
          const fnName = data.visualization.parameters?.function || data.latex || data.recognized_text || '';
          aiElements.graphDesc.textContent = `Hàm số ${fnName} sẵn sàng dựng đồ thị tương tác 2D (< 3 giây).`;
        }
      } else {
        aiElements.graphBox.hidden = true;
      }
    }

    // Hiển thị giải thích hoặc gợi ý
    if (aiElements.explanationBox) {
      if (data.explanation) {
        aiElements.explanationBox.textContent = data.explanation;
        aiElements.explanationBox.hidden = false;
      } else {
        aiElements.explanationBox.hidden = true;
      }
    }

    if (aiElements.statusIndicator) {
      aiElements.statusIndicator.textContent = 'AI: Đã nhận diện';
      aiElements.statusIndicator.classList.remove('is-analyzing');
    }

    ui.footer.textContent = `Đã kết nối máy chủ · Nhận diện AI (${data.subject || 'Đa môn'}) thành công (${data.latency_ms || elapsed} ms)`;
    setStatus(`AI nhận diện: ${data.recognized_text || displayFormula}`);

  } catch (error) {
    console.error('Lỗi nhận diện AI:', error);
    const wentOffline = await handlePossibleNetworkError(error);
    if (aiElements.loading) aiElements.loading.hidden = true;
    if (wentOffline) {
      if (aiElements.overlay) aiElements.overlay.hidden = true;
      setStatus('Đã tạm dừng AI do mất mạng; nét vẽ vẫn được giữ');
    } else if (error?.name === 'AbortError') {
      showAiErrorState(
        'Kết nối AI quá thời gian chờ (24s). Nét vẽ của bạn vẫn được giữ nguyên — hãy bấm "Thử lại nhận diện".'
      );
    } else {
      showAiErrorState(
        `Không thể kết nối tới máy chủ AI (${error.message}). Nét vẽ của bạn vẫn được giữ nguyên.`
      );
    }
  } finally {
    clearTimeout(reqTimeout);
    isRecognizing = false;
  }
}

export async function retryAIRecognition() {
  if (state.ended || isRecognizing) return;
  if (!lastCapturedImageBase64) {
    return reanalyzeCurrentCanvas();
  }

  const delayMs =
    consecutiveRetryCount === 0
      ? 0
      : Math.min(MAX_RETRY_BACKOFF_MS, 400 * (2 ** (consecutiveRetryCount - 1)));
  consecutiveRetryCount += 1;

  if (delayMs > 0) {
    const aiElements = getAiElements();
    if (aiElements.errorBanner) aiElements.errorBanner.hidden = true;
    if (aiElements.loading) aiElements.loading.hidden = false;
    setStatus(`Đang thử kết nối lại AI sau ${(delayMs / 1000).toFixed(1)}s...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return performAIRecognition({
    isDebounced: false,
    cachedImageBase64: lastCapturedImageBase64,
    cachedMeta: lastRecognizeMeta,
  });
}

export async function reanalyzeCurrentCanvas() {
  if (state.ended || isRecognizing) return;
  closePanels();
  consecutiveRetryCount = 0;
  lastCapturedImageBase64 = null;
  return performAIRecognition({ isDebounced: false });
}

/**
 * Task TF2850F: Chèn hình ảnh minh họa nét phấn trắng lên mặt bảng
 * tại tọa độ xác định (mặc định đặt ngay cạnh từ vựng / khái niệm).
 */
export async function insertIllustrationToBoard(illuData, targetX = null, targetY = null) {
  if (!illuData || !illuData.image_data_url) return null;
  try {
    const img = new Image();
    img.src = illuData.image_data_url;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
    }

    const x = targetX !== null ? targetX : (illuData.suggested_position?.x || 340);
    const y = targetY !== null ? targetY : (illuData.suggested_position?.y || 40);
    const w = illuData.suggested_position?.width || 220;
    const h = illuData.suggested_position?.height || 220;

    const fabricImg = new FabricImage(img, {
      left: x,
      top: y,
      scaleX: w / (img.naturalWidth || 320),
      scaleY: h / (img.naturalHeight || 240),
      selectable: false,
      evented: false,
      objectCaching: false
    });
    fabricImg._hitPoints = [{ x, y }, { x: x + w, y: y + h }];
    fabricImg._hitWidth = 30;

    fabricCanvas.add(fabricImg);
    return fabricImg;
  } catch (err) {
    console.error('Không thể chèn hình minh họa lên bảng:', err);
    return null;
  }
}

/**
 * Gắn metadata ngữ nghĩa (Đề bài / Bước giải) cho đối tượng vừa dán từ AI
 * và tạo nhãn trực quan ở góc trên bên trái (chạm ngắn vào nhãn để đổi vai trò).
 */
export function attachEssayRoleMetadata(targetObj, rawLatexText, region) {
  const allObjects = fabricCanvas.getObjects();
  const cx = region.left + (region.width || 120) / 2;
  const cy = region.top + (region.height || 36) / 2;

  // 1. Kiểm tra nếu công thức nằm bên trong khung nét đứt Vùng làm bài (answer_zone) của câu tự luận từ Kho đề
  const hitAnswerZone = allObjects.find((obj) => {
    if (obj?.meta?.dataRole !== 'answer_zone' || !obj?.meta?.linkedGroupId) return false;
    const zb = obj.getBoundingRect();
    return (
      zb &&
      cx >= zb.left - 8 &&
      cx <= zb.left + zb.width + 8 &&
      cy >= zb.top - 8 &&
      cy <= zb.top + zb.height + 8
    );
  });

  const trimmed = String(rawLatexText || '').trim();
  const looksLikeAnswerStep = /^(=|=>|->|⇔|⇒|-|\+|ta có|suy ra|vậy|bước)/i.test(trimmed);

  let isQuestion = false;
  let linkedQuestionGroupId = null;

  if (hitAnswerZone) {
    isQuestion = false;
    linkedQuestionGroupId = hitAnswerZone.meta.linkedGroupId;
  } else {
    const existingQuestions = allObjects
      .filter((obj) => obj !== targetObj && obj?.meta?.dataRole === 'question')
      .map((obj) => ({ obj, bbox: obj.getBoundingRect() }))
      .filter((q) => Boolean(q.bbox))
      .sort((a, b) => a.bbox.top - b.bbox.top);

    if (existingQuestions.length === 0) {
      isQuestion = !looksLikeAnswerStep;
    } else {
      // Kiểm tra có câu hỏi tự luận nào nằm ngay phía trên cùng cột ngang X không
      const parentQuestionAbove = existingQuestions
        .filter((q) => {
          if (q.obj?.meta?.questionType === 'MCQ') return false;
          const qBottom = q.bbox.top + q.bbox.height;
          const dy = region.top - qBottom;
          const inHorizBand =
            cx >= q.bbox.left - 80 && cx <= q.bbox.left + Math.max(240, q.bbox.width) + 200;
          return dy >= -12 && dy <= 140 && inHorizBand && q.obj?.meta?.aiState !== 'graded';
        })
        .pop();

      if (parentQuestionAbove) {
        isQuestion = false;
        linkedQuestionGroupId = parentQuestionAbove.obj?.meta?.questionGroupId || null;
      } else if (!looksLikeAnswerStep) {
        isQuestion = true;
      }
    }
  }

  const role = isQuestion ? 'question' : 'answer_formatted';
  const groupId = `essay_item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  targetObj.meta = {
    ...(targetObj.meta || {}),
    aiState: 'formatted',
    dataRole: role,
    rawLatex: trimmed,
    questionGroupId: groupId,
    stepOwnerId: groupId,
    ...(linkedQuestionGroupId ? { linkedQuestionGroupId } : {}),
  };

  const badgeLeft = region.left;
  const badgeTop = region.top - 24;
  const badgeText = new Text(isQuestion ? ' ĐỀ BÀI ' : ' BƯỚC GIẢI ', {
    left: badgeLeft,
    top: badgeTop,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Be Vietnam Pro, sans-serif',
    fill: '#FAF8F4',
    backgroundColor: isQuestion ? '#9C3F23' : '#3D6940',
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  const bw = badgeText.width || 64;
  const bh = badgeText.height || 16;
  badgeText._hitPoints = [
    { x: badgeLeft, y: badgeTop + bh / 2 },
    { x: badgeLeft + bw, y: badgeTop + bh / 2 },
  ];
  badgeText._hitWidth = Math.max(20, bh);
  badgeText.meta = {
    aiState: 'formatted',
    dataRole: 'question_badge',
    linkedGroupId: groupId,
    linkedStepOwnerId: groupId,
  };
  fabricCanvas.add(badgeText);
}

async function buildFormattedBoardObject(latexStr, plainStr, targetReg, shouldRenderLatex) {
  let objOut = null;
  let wOut = targetReg.width || 220;
  if (shouldRenderLatex && latexStr) {
    try {
      const { createFormulaImage } = await import('../extensions/handwriting.js');
      const formulaImg = await createFormulaImage(latexStr, {
        left: targetReg.left,
        top: targetReg.top,
        width: Math.max(160, targetReg.width),
        height: Math.max(44, Math.min(84, targetReg.height)),
      });
      const bounds = formulaImg.getBoundingRect();
      const fH = bounds.height || 38;
      const fW = bounds.width || 180;
      formulaImg._hitPoints = [
        { x: targetReg.left, y: targetReg.top + fH / 2 },
        { x: targetReg.left + fW, y: targetReg.top + fH / 2 },
      ];
      formulaImg._hitWidth = Math.max(28, fH);
      objOut = formulaImg;
      wOut = Math.max(140, fW);
    } catch {
      objOut = null;
    }
  }
  if (!objOut) {
    const textObj = new Text(plainStr || latexStr, {
      left: targetReg.left,
      top: targetReg.top,
      fill: isDarkBoardActive() ? '#ECE7DF' : '#26231F',
      fontSize: 22,
      fontFamily: 'Be Vietnam Pro, sans-serif',
      selectable: false,
      evented: false,
    });
    const textW = Math.max(110, textObj.width || 180);
    const textH = Math.max(28, textObj.height || 28);
    textObj._hitPoints = [
      { x: targetReg.left, y: targetReg.top + textH / 2 },
      { x: targetReg.left + textW, y: targetReg.top + textH / 2 },
    ];
    textObj._hitWidth = Math.max(30, textH);
    objOut = textObj;
    wOut = textW;
  }
  return { object: objOut, width: wOut };
}

export async function insertAiResultToBoard() {
  if (!currentAiResult || state.ended || state.pageBusy) return;
  let textToInsert = currentAiResult.latex || currentAiResult.recognized_text;

  const isEng = (currentAiResult.subject || '').toUpperCase().includes('ENG') ||
                (currentAiResult.subject || '').toUpperCase().includes('ANH');
  const isBio = (currentAiResult.subject || '').toUpperCase().includes('SINH') ||
                (currentAiResult.subject || '').toUpperCase().includes('BIO');
  const isGeo = (currentAiResult.subject || '').toUpperCase().includes('DIA') ||
                (currentAiResult.subject || '').toUpperCase().includes('GEO');

  if (isEng && currentAiResult.subject_details) {
    const d = currentAiResult.subject_details;
    if (d.topic === 'VOCABULARY' || d.ipa || d.word_type) {
      const word = d.word || currentAiResult.recognized_text || '';
      const type = (d.word_type || d.part_of_speech) ? ` [${d.word_type || d.part_of_speech}]` : '';
      const ipa = d.ipa ? ` ${d.ipa}` : '';
      const meaning = d.vietnamese_meaning ? `\n- Nghĩa: ${d.vietnamese_meaning}` : '';
      const example = d.example_sentence ? `\n- Ví dụ: ${d.example_sentence}` : '';
      textToInsert = `${word}${type}${ipa}${meaning}${example}`;
    } else if (d.topic === 'GRAMMAR_SENTENCE') {
      const sentence = currentAiResult.recognized_text || '';
      const struct = d.grammar_structure ? `\n- Ngữ pháp: ${d.grammar_structure}` : '';
      textToInsert = `${sentence}${struct}`;
    }
  } else if ((isBio || isGeo) && currentAiResult.subject_details) {
    const d = currentAiResult.subject_details;
    const name = d.vietnamese_name || d.concept || currentAiResult.recognized_text || '';
    const formula = d.formula ? `\n- Công thức: ${d.formula}` : '';
    const summary = d.summary || d.geographical_significance ? `\n- Khái niệm: ${d.summary || d.geographical_significance}` : '';
    textToInsert = `${name}${formula}${summary}`;
  }

  if (!textToInsert && !currentAiResult.illustration) return;

  const targetPageAtStart = state.pageIndex;

  // 1. Xác định các nét viết tay gốc & vị trí viết thực tế của giáo viên
  const { region } = resolveStrokesAndRegionForReplacement(currentAiResult);
  const shouldRenderLatex = !isEng && !isBio && !isGeo && Boolean(currentAiResult.latex);

  // Trường hợp nhiều cụm độc lập (hoặc 1 cụm chứa nhiều biểu thức ngăn bởi ',' / ';')
  const multiItemsToBuild = [];
  if (pendingMultiClusters.length > 1) {
    for (const cl of pendingMultiClusters) {
      const fStr = cl.aiResult.latex || cl.aiResult.recognized_text || '';
      const pStr = cl.aiResult.recognized_text || cl.aiResult.latex || '';
      if (fStr || pStr) {
        multiItemsToBuild.push({
          latex: fStr,
          plain: pStr,
          region: { ...cl.region, top: Math.max(36, cl.region.top) },
        });
      }
    }
  } else if (!isEng && !isBio && !isGeo) {
    const splitExprs = splitTopLevelMathExpressions(currentAiResult.latex || textToInsert);
    if (splitExprs.length > 1) {
      const stepW = Math.max(180, Math.floor((region.width || 480) / splitExprs.length));
      splitExprs.forEach((exprPart, idx) => {
        multiItemsToBuild.push({
          latex: exprPart,
          plain: exprPart,
          region: {
            left: region.left + idx * (stepW + 28),
            top: region.top,
            width: stepW,
            height: region.height,
          },
        });
      });
    }
  }

  let insertedWidth = region.width || 260;
  let objectToInsert = null;
  let builtMultiObjects = [];

  if (multiItemsToBuild.length > 1) {
    builtMultiObjects = await Promise.all(
      multiItemsToBuild.map(async (item) => {
        const built = await buildFormattedBoardObject(item.latex, item.plain, item.region, !isEng && !isBio && !isGeo);
        return { ...item, object: built.object, width: built.width };
      })
    );
  } else if (textToInsert) {
    // 2. Dựng sẵn đối tượng công thức LaTeX hoặc văn bản đã format trước khi thay đổi Canvas
    if (shouldRenderLatex) {
      try {
        const { createFormulaImage } = await import('../extensions/handwriting.js');
        const formulaImg = await createFormulaImage(currentAiResult.latex, {
          left: region.left,
          top: region.top,
          width: Math.max(220, region.width),
          height: Math.max(48, Math.min(84, region.height)),
        });
        const bounds = formulaImg.getBoundingRect();
        const fH = bounds.height || 38;
        const fW = bounds.width || 220;
        formulaImg._hitPoints = [
          { x: region.left, y: region.top + fH / 2 },
          { x: region.left + fW, y: region.top + fH / 2 },
        ];
        formulaImg._hitWidth = Math.max(28, fH);
        objectToInsert = formulaImg;
        insertedWidth = Math.max(160, fW);
      } catch {
        objectToInsert = null;
      }
    }

    if (!objectToInsert) {
      const textObj = new Text(textToInsert, {
        left: region.left,
        top: region.top,
        fill: isDarkBoardActive() ? '#ECE7DF' : '#26231F',
        fontSize: 22,
        fontFamily: 'Be Vietnam Pro, sans-serif',
        selectable: false,
        evented: false,
      });
      const textW = Math.max(120, textObj.width || 220);
      const textH = Math.max(28, textObj.height || 28);
      textObj._hitPoints = [
        { x: region.left, y: region.top + textH / 2 },
        { x: region.left + textW, y: region.top + textH / 2 },
      ];
      textObj._hitWidth = Math.max(30, textH);
      objectToInsert = textObj;
      insertedWidth = textW;
    }
  }

  if (state.ended || state.pageBusy || state.pageIndex !== targetPageAtStart) return;

  // 3. Chụp trạng thái trước khi thay đổi để Ctrl+Z (Hoàn tác) khôi phục lại nét viết tay gốc trong 1 bước
  const before = snapshot();

  // Lấy lại danh sách nét viết tay còn tồn tại trên mặt bảng tại thời điểm commit
  const { strokesToRemove } = resolveStrokesAndRegionForReplacement(currentAiResult);
  if (strokesToRemove.length > 0) {
    fabricCanvas.remove(...strokesToRemove);
  }
  pendingMultiClusters = [];
  recognizedStrokeObjects = [];
  recognizedRegion = null;
  recognizedPageIndex = null;

  if (builtMultiObjects.length > 1) {
    for (const entry of builtMultiObjects) {
      if (entry.object) {
        fabricCanvas.add(entry.object);
        attachEssayRoleMetadata(entry.object, entry.latex || entry.plain, entry.region);
      }
    }
  } else if (objectToInsert) {
    fabricCanvas.add(objectToInsert);
    attachEssayRoleMetadata(objectToInsert, currentAiResult.latex || textToInsert, region);
  }

  // 4. Nếu có hình minh họa nét phấn trắng, đặt gọn gàng ngay bên cạnh nội dung vừa chèn
  if (currentAiResult.illustration) {
    const canvasW = fabricCanvas.getWidth();
    const illuW = currentAiResult.illustration.suggested_position?.width || 220;
    const illuX = Math.min(region.left + insertedWidth + 30, Math.max(16, canvasW - illuW - 16));
    const illuY = region.top;
    await insertIllustrationToBoard(currentAiResult.illustration, illuX, illuY);
  }

  fabricCanvas.requestRenderAll();
  remember(before);
  updateHint();
  setStatus(
    strokesToRemove.length > 0
      ? `Đã thay thế ${strokesToRemove.length} nét viết tay bằng kết quả đã định dạng`
      : 'Đã chèn kết quả AI vào mặt bảng'
  );

  const aiElements = getAiElements();
  if (aiElements.overlay) aiElements.overlay.hidden = true;
}


export function initBoardWebSocket() {
  if (state.ended || isOfflineMode()) return;
  if (boardSocket && (boardSocket.readyState === WebSocket.OPEN || boardSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    if (!host) return; // Môi trường xem file tĩnh cục bộ
    const room = $('roomId')?.textContent?.trim() || 'room-10a1';
    const session = $('sessionId')?.textContent?.trim() || 'session-10a1';
    boardSocket = new WebSocket(`${protocol}//${host}/ws/board/${room}/${session}`);
    boardSocket.onopen = () => {
      wsRetryCount = 0;
      if (wsRetryTimer) {
        clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
      }
      if (!isOfflineMode()) {
        ui.footer.textContent = 'Đã kết nối máy chủ · Kênh tín hiệu phòng học sẵn sàng';
      }
    };
    boardSocket.onmessage = () => {
      // Nhận tín hiệu đồng bộ từ các thiết bị khác trong phòng học
    };
    boardSocket.onerror = () => {
      // Graceful fallback nếu WebSocket không sẵn sàng
    };
    boardSocket.onclose = () => {
      boardSocket = null;
      if (!state.ended && !isOfflineMode()) {
        if (wsRetryTimer) clearTimeout(wsRetryTimer);
        const delayMs = Math.min(60000, 2000 * (2 ** Math.min(wsRetryCount, 5)));
        wsRetryCount += 1;
        wsRetryTimer = setTimeout(() => {
          wsRetryTimer = null;
          initBoardWebSocket();
        }, delayMs);
      }
    };
  } catch {
    // Graceful fallback
  }
}

export function setupAIRecognition() {
  const aiElements = getAiElements();
  if (aiElements.recognizeBtn) {
    aiElements.recognizeBtn.addEventListener('click', () => {
      closePanels();
      performAIRecognition({ isDebounced: false });
    });
  }
  if (aiElements.reanalyzeBoardBtn) {
    aiElements.reanalyzeBoardBtn.addEventListener('click', () => {
      reanalyzeCurrentCanvas();
    });
  }
  if (aiElements.retryErrorBtn) {
    aiElements.retryErrorBtn.addEventListener('click', () => {
      retryAIRecognition();
    });
  }
  if (aiElements.rescanBoardErrorBtn) {
    aiElements.rescanBoardErrorBtn.addEventListener('click', () => {
      reanalyzeCurrentCanvas();
    });
  }
  if (aiElements.autoToggle) {
    isAutoAiEnabled = aiElements.autoToggle.dataset.auto === 'true';
    aiElements.autoToggle.setAttribute('aria-pressed', String(isAutoAiEnabled));
    aiElements.autoToggle.classList.toggle('is-active', isAutoAiEnabled);
    aiElements.autoToggle.textContent = isAutoAiEnabled ? 'Tự động: BẬT' : 'Tự động: TẮT';

    aiElements.autoToggle.addEventListener('click', () => {
      isAutoAiEnabled = !isAutoAiEnabled;
      if (!isAutoAiEnabled) {
        cancelAIDebounce();
      }
      aiElements.autoToggle.dataset.auto = String(isAutoAiEnabled);
      aiElements.autoToggle.setAttribute('aria-pressed', String(isAutoAiEnabled));
      aiElements.autoToggle.classList.toggle('is-active', isAutoAiEnabled);
      aiElements.autoToggle.textContent = isAutoAiEnabled ? 'Tự động: BẬT' : 'Tự động: TẮT';
      setStatus(
        isAutoAiEnabled
          ? 'Đã BẬT tự động nhận diện AI (chờ 1.8s sau khi ngừng viết bút)'
          : 'Đã TẮT tự động nhận diện AI — bấm "Nhận diện AI" khi cần dịch'
      );
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
  if (aiElements.insertIllustrationBtn) {
    aiElements.insertIllustrationBtn.addEventListener('click', async () => {
      if (currentAiResult?.illustration) {
        const illuX = currentAiResult.illustration.suggested_position?.x || 320;
        const illuY = currentAiResult.illustration.suggested_position?.y || 40;
        const before = snapshot();
        await insertIllustrationToBoard(currentAiResult.illustration, illuX, illuY);
        fabricCanvas.requestRenderAll();
        remember(before);
        updateHint();
        setStatus(`Đã chèn hình minh họa: ${currentAiResult.illustration.concept}`);
        if (aiElements.overlay) aiElements.overlay.hidden = true;
      }
    });
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

  // Task TF2850F: Xử lý nút mở Modal Tạo ảnh minh họa từ vựng / khái niệm
  if (aiElements.illustrateBtn) {
    aiElements.illustrateBtn.addEventListener('click', () => {
      closePanels();
      if (aiElements.illustrateInput) aiElements.illustrateInput.value = '';
      if (aiElements.illustrateDialog) aiElements.illustrateDialog.showModal();
    });
  }
  if (aiElements.cancelIllustrateBtn && aiElements.illustrateDialog) {
    aiElements.cancelIllustrateBtn.addEventListener('click', () => {
      aiElements.illustrateDialog.close();
    });
  }
  if (aiElements.submitIllustrateBtn && aiElements.illustrateDialog) {
    aiElements.submitIllustrateBtn.addEventListener('click', async () => {
      const concept = aiElements.illustrateInput?.value?.trim();
      if (!concept) {
        showAppToast({
          title: 'Thiếu nội dung minh họa',
          message: 'Vui lòng nhập từ vựng hoặc khái niệm trước khi tạo hình minh họa.',
          variant: 'warning',
        });
        aiElements.illustrateInput?.focus();
        return;
      }
      aiElements.illustrateDialog.close();
      if (isOfflineMode()) {
        showCornerNotification({
          title: 'AI tạm dừng do mất mạng',
          body: 'Không thể tạo hình minh họa lúc mất mạng. Bảng vẽ vẫn hoạt động bình thường.',
          variant: 'offline',
          autoDismissMs: 4000,
        });
        setStatus('AI tạm dừng do mất mạng');
        return;
      }
      setStatus(`Đang gọi AI tạo hình minh họa nét phấn trắng: "${concept}"...`);

      try {
        const subject = aiElements.subjectSelect?.value || 'TIENG_ANH';
        const response = await authFetch('/api/v1/illustrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            concept: concept,
            subject: subject,
            style: 'white_chalk',
            target_bbox: [50, 50, 150, 50]
          })
        });

        if (!response.ok) {
          throw new Error(`Máy chủ trả về HTTP ${response.status}`);
        }

        const data = await response.json();
        const before = snapshot();

        // Chèn nhãn từ vựng / khái niệm lên bảng
        const labelObj = new Text(concept, {
          left: 40,
          top: 60,
          fill: isDarkBoardActive() ? '#86efac' : '#14532d',
          fontSize: 24,
          fontFamily: 'Be Vietnam Pro, sans-serif',
          fontWeight: 'bold',
          selectable: false,
          evented: false
        });
        fabricCanvas.add(labelObj);

        // Đặt hình minh họa nét phấn trắng ngay cạnh từ vựng
        const illuX = 40 + Math.max(180, labelObj.width || 180) + 30;
        const illuY = 40;
        await insertIllustrationToBoard(data, illuX, illuY);

        fabricCanvas.requestRenderAll();
        remember(before);
        updateHint();
        setStatus(`Đã tạo hình minh họa nét phấn trắng cho "${concept}" thành công!`);
      } catch (err) {
        console.error('Lỗi tạo hình minh họa AI:', err);
        const wentOffline = await handlePossibleNetworkError(err);
        if (!wentOffline) {
          showAppToast({
            title: 'Không thể tạo hình minh họa',
            message: err.message || 'Máy chủ AI đang bận, vui lòng thử lại.',
            variant: 'error',
          });
          setStatus('Lỗi tạo hình minh họa AI');
        }
      }
    });
  }

  // Task TF28512: Kích hoạt dựng đồ thị 2D Plotly từ công thức AI (< 3 giây)
  if (aiElements.openGraphBtn) {
    aiElements.openGraphBtn.addEventListener('click', () => {
      if (aiElements.overlay) aiElements.overlay.hidden = true;
      const formula = currentAiResult?.latex || currentAiResult?.recognized_text || 'y=x²-4x+3';
      const plotlyBtn = $('plotlyGraphTool');
      const equationInput = $('pgEquation');
      if (equationInput) {
        equationInput.value = formula;
      }
      if (plotlyBtn) {
        plotlyBtn.click();
        const drawBtn = $('pgDraw');
        if (drawBtn) drawBtn.click();
      }
      setStatus(`Đã mở đồ thị 2D tương tác Plotly: ${formula}`);
    });
  }

  window.addEventListener('app:cancel-ai-debounce', () => {
    cancelAIDebounce();
  });
  window.addEventListener('app:network-offline', () => {
    cancelAIDebounce();
  });
  window.addEventListener('app:network-online', () => {
    wsRetryCount = 0;
    if (wsRetryTimer) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    initBoardWebSocket();
  });

  window.addEventListener('app:class-changed', () => {
    cancelAIDebounce();
    if (wsRetryTimer) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    if (boardSocket) {
      const oldSocket = boardSocket;
      boardSocket = null;
      try {
        oldSocket.onclose = null;
        oldSocket.close();
      } catch {
        // Ignore close errors
      }
    }
    wsRetryCount = 0;
    initBoardWebSocket();
  });

  const aiPanelEl = $('aiOverlayPanel');
  if (aiPanelEl) {
    makePanelDraggable(aiPanelEl, aiPanelEl.querySelector('.ai-panel-header'));
  }

  initBoardWebSocket();
}

