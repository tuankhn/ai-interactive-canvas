import { Text } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
import { $, fabricCanvas, state, ui, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { closePanels } from './toolbar.js';

let isAutoAiEnabled = true;
let isRecognizing = false;
let aiDebounceTimer = null;
let currentAiResult = null;
let aiRequestId = 0;
let boardSocket = null;

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
  closeBtn: $('closeAiPanelBtn'),
  insertBtn: $('insertToBoardBtn'),
  retryBtn: $('reRecognizeBtn'),
  subjectSelect: $('subjectSelect')
});

export function scheduleAIDebounce() {
  if (!isAutoAiEnabled || state.ended) return;
  if (aiDebounceTimer) clearTimeout(aiDebounceTimer);
  aiDebounceTimer = setTimeout(() => {
    performAIRecognition({ isDebounced: true });
  }, 800);
}

export async function performAIRecognition({ isDebounced = false } = {}) {
  if (state.ended || isRecognizing) return;
  const objects = fabricCanvas.getObjects();
  if (!objects || objects.length === 0) {
    if (!isDebounced) {
      alert('Chưa có nét vẽ nào trên bảng để nhận diện.');
    }
    return;
  }

  const aiElements = getAiElements();
  const thisRequestId = ++aiRequestId;
  const thisPage = state.pageIndex;

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
      page_number: state.pageIndex + 1,
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
    if (thisRequestId !== aiRequestId || state.pageIndex !== thisPage || state.ended) {
      return;
    }

    currentAiResult = data;

    if (aiElements.loading) aiElements.loading.hidden = true;
    if (aiElements.content) aiElements.content.hidden = false;

    // Hiển thị Provider & Badges
    if (aiElements.providerBadge) {
      aiElements.providerBadge.textContent = data.provider || 'Gemini 2.5 Flash';
      aiElements.providerBadge.classList.toggle('is-mock', data.provider?.includes('MOCK'));
    }
    if (aiElements.confidenceBadge) {
      const conf = Math.round((data.confidence || 0.95) * 100);
      aiElements.confidenceBadge.textContent = `${conf}%`;
    }
    if (aiElements.latencyBadge) {
      aiElements.latencyBadge.textContent = `${data.latency_ms || elapsed} ms`;
    }

    // Hiển thị công thức LaTeX / Text bằng KaTeX
    const displayFormula = data.latex || data.recognized_text || '\\text{Không có nội dung}';
    if (aiElements.rawBox) {
      aiElements.rawBox.textContent = displayFormula;
    }

    if (aiElements.renderedBox) {
      aiElements.renderedBox.innerHTML = '';
      if (window.katex && data.latex) {
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

    ui.footer.textContent = `Đã kết nối máy chủ · Nhận diện AI thành công (${data.latency_ms || elapsed} ms) · Debounce 800ms`;
    setStatus(`AI nhận diện: ${data.recognized_text || displayFormula}`);

  } catch (error) {
    console.error('Lỗi nhận diện AI:', error);
    if (aiElements.loading) aiElements.loading.hidden = true;
    if (aiElements.content) aiElements.content.hidden = false;
    if (aiElements.renderedBox) aiElements.renderedBox.textContent = 'Lỗi kết nối API';
    if (aiElements.explanationBox) {
      aiElements.explanationBox.textContent = `Không thể kết nối Backend API (/api/v1/recognize): ${error.message}`;
      aiElements.explanationBox.hidden = false;
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

export function insertAiResultToBoard() {
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
  const aiElements = getAiElements();
  if (aiElements.overlay) aiElements.overlay.hidden = true;
}

export function initBoardWebSocket() {
  if (state.ended) return;
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
      if (!state.ended) setTimeout(initBoardWebSocket, 5000);
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

  initBoardWebSocket();
}
