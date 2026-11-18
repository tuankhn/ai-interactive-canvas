/*
 * Bổ sung popup sửa ký tự nhận diện chưa chắc chắn (confidence < 85%).
 * Tự tích hợp với endpoint đang được bảng vẽ sử dụng, không cần sửa các module gốc.
 */
(() => {
  'use strict';

  const THRESHOLD = 0.85;
  const ENDPOINT = /\/api\/v1\/(?:canvas\/)?recognize\/?(?:\?|$)/;
  const CORRECTION_ENDPOINT = '/api/v1/canvas/correct-token';
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './src/extensions/ai-correction-popup.css';
  document.head.appendChild(stylesheet);

  let panel = null;
  let marker = null;
  let currentData = null;
  let currentToken = '';
  let currentPage = null;
  let lastWritingPoint = null;
  let latestAnchor = null;
  let lastFocused = null;

  function getCurrentPageNumber() {
    const match = document.getElementById('pageIndicator')?.textContent?.match(/Trang\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function confidenceValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value >= 0 && value <= 1) return value;
    if (value > 1 && value <= 100) return value / 100;
    return null;
  }

  function firstNonEmpty(...values) {
    return values.find((item) => typeof item === 'string' && item.trim())?.trim() || '';
  }

  function suggestionsFrom(data, tokenInfo, original) {
    const source = Array.isArray(tokenInfo?.suggestions) && tokenInfo.suggestions.length
      ? tokenInfo.suggestions
      : (Array.isArray(data.suggestions) ? data.suggestions : []);
    const unique = [];
    for (const item of [original, ...source]) {
      const candidate = typeof item === 'string' ? item.trim() : '';
      if (candidate && candidate.length <= 90 && !unique.includes(candidate)) unique.push(candidate);
      if (unique.length >= 8) break;
    }
    return unique;
  }

  function isValidBbox(box) {
    return Array.isArray(box) && box.length >= 4 && box.slice(0, 4).every(Number.isFinite)
      && box[2] > 0 && box[3] > 0;
  }

  function getAnchor(data, tokenInfo) {
    const stage = document.getElementById('canvasStage');
    if (!stage) return lastWritingPoint || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = stage.getBoundingClientRect();
    const originalSize = data.preprocess?.original_size;
    const width = Array.isArray(originalSize) && originalSize[0] > 0 ? originalSize[0] : rect.width;
    const height = Array.isArray(originalSize) && originalSize[1] > 0 ? originalSize[1] : rect.height;
    const tokenBbox = tokenInfo?.bbox;
    const preprocessBbox = data.preprocess?.bounding_box;
    const bounding = isValidBbox(tokenBbox) ? tokenBbox
      : (preprocessBbox && Number.isFinite(preprocessBbox.x) &&
        Number.isFinite(preprocessBbox.y) && Number.isFinite(preprocessBbox.width)
        && Number.isFinite(preprocessBbox.height) && preprocessBbox.width > 0
        && preprocessBbox.height > 0
        ? [preprocessBbox.x, preprocessBbox.y, preprocessBbox.width, preprocessBbox.height] : null);
    if (bounding && bounding[0] >= 0 && bounding[1] >= 0
        && bounding[0] + bounding[2] <= width * 1.1
        && bounding[1] + bounding[3] <= height * 1.1) {
      return {
        x: rect.left + Math.min(rect.width, (bounding[0] + bounding[2]) / width * rect.width),
        y: rect.top + Math.min(rect.height, (bounding[1] + bounding[3]) / height * rect.height)
      };
    }
    return lastWritingPoint || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function closePopup() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (marker) marker.hidden = true;
    currentData = null;
    currentToken = '';
    currentPage = null;
    latestAnchor = null;
    if (lastFocused?.isConnected) lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  function positionPopup(anchor) {
    if (!panel || panel.hidden) return;
    if (marker) {
      marker.style.left = `${anchor.x}px`;
      marker.style.top = `${anchor.y}px`;
      marker.hidden = false;
    }
    const margin = 10;
    const gap = 12;
    const box = panel.getBoundingClientRect();
    let left = anchor.x + gap;
    if (left + box.width > window.innerWidth - margin) left = anchor.x - box.width - gap;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = anchor.y + gap;
    if (top + box.height > window.innerHeight - margin) top = anchor.y - box.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'aiCorrectionPopup';
    panel.className = 'ai-correction-popup';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'aiCorrectionTitle');
    panel.setAttribute('aria-describedby', 'aiCorrectionHelp');
    panel.setAttribute('aria-modal', 'false');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ai-correction-head">
        <div><strong id="aiCorrectionTitle">Kiểm tra ký tự nhận diện</strong>
          <span class="ai-correction-confidence" id="aiCorrectionConfidence"></span></div>
        <button type="button" class="ai-correction-close" aria-label="Đóng gợi ý sửa" title="Đóng">×</button>
      </div>
      <p class="ai-correction-help" id="aiCorrectionHelp">AI chưa chắc chắn. Chọn ký tự đúng để sửa kết quả.</p>
      <div class="ai-correction-detected">Đã nhận diện: <strong id="aiCorrectionDetected"></strong></div>
      <div class="ai-correction-label">Chọn kết quả đúng:</div>
      <div class="ai-correction-options" id="aiCorrectionOptions"></div>
      <form class="ai-correction-form" id="aiCorrectionForm">
        <label for="aiCorrectionCustom">Hoặc nhập ký tự đúng</label>
        <div class="ai-correction-form-row">
          <input id="aiCorrectionCustom" type="text" maxlength="90" autocomplete="off" placeholder="Nhập ký tự..." />
          <button type="submit">Áp dụng</button>
        </div>
      </form>`;
    document.body.appendChild(panel);
    marker = document.createElement('span');
    marker.className = 'ai-correction-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.hidden = true;
    document.body.appendChild(marker);
    panel.querySelector('.ai-correction-close').addEventListener('click', closePopup);
    panel.querySelector('#aiCorrectionForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = panel.querySelector('#aiCorrectionCustom').value.trim();
      if (value) applyCorrection(value);
    });
    return panel;
  }

  function replaceOnce(text, original, replacement) {
    if (typeof text !== 'string') return text;
    if (!original) return replacement;
    const index = text.indexOf(original);
    return index < 0 ? text : text.slice(0, index) + replacement + text.slice(index + original.length);
  }

  function updateOriginalAiPanel(data) {
    const raw = document.getElementById('aiLatexRaw');
    if (raw) raw.textContent = data.latex || data.recognized_text || '';
    const rendered = document.getElementById('aiLatexRendered');
    if (rendered) {
      const isEnglish = /ENG|TIENG_ANH|ANH/i.test(data.subject || '');
      if (!isEnglish && data.latex && window.katex?.render) {
        try {
          window.katex.render(data.latex, rendered, { throwOnError: false, displayMode: true });
        } catch { rendered.textContent = data.recognized_text || data.latex; }
      } else {
        rendered.textContent = data.recognized_text || data.latex || '';
      }
    }
    const stateLabel = document.getElementById('saveState');
    if (stateLabel) stateLabel.textContent = 'Đã sửa kết quả nhận diện';
  }

  function applyCorrection(newValue) {
    if (!currentData || !newValue || !currentToken) return;
    if (currentPage !== null && getCurrentPageNumber() !== currentPage) {
      closePopup();
      return;
    }
    const data = currentData;
    const previousLatex = data.latex || '';
    const original = currentToken;
    data.recognized_text = replaceOnce(data.recognized_text, original, newValue);
    // Nếu LaTeX sử dụng mã khác nên không tìm được ký tự cũ,
    // dùng văn bản đã sửa để tránh chèn lại công thức cũ/sai.
    data.latex = typeof data.latex === 'string' && data.latex.includes(original)
      ? replaceOnce(data.latex, original, newValue)
      : data.recognized_text;
    if (data.subject_details?.word === original) data.subject_details.word = newValue;
    updateOriginalAiPanel(data);
    closePopup();

    // Endpoint sửa ký tự đã có sẵn trong backend: gửi sửa khi máy chủ hoạt động.
    // Không bắt người dùng chờ và vẫn cho phép sửa cục bộ khi API sửa không sẵn sàng.
    if (newValue !== original) {
      const payload = {
        session_id: data.session_id || document.getElementById('sessionId')?.textContent?.trim() || 'session-10a1',
        original_text: original,
        corrected_text: newValue,
        context_latex: previousLatex
      };
      window.fetch(CORRECTION_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => { /* Kết quả đã được sửa tại trình duyệt. */ });
    }
  }

  function showCorrection(data) {
    if (!data || typeof data !== 'object' || data.error) return;
    const confidence = confidenceValue(data.confidence);
    // Không tự đoán độ tin cậy khi backend không trả confidence.
    if (confidence === null || confidence >= THRESHOLD) {
      closePopup();
      return;
    }
    const pageNumber = getCurrentPageNumber();
    if (pageNumber !== null && Number(data.page_number) !== pageNumber) return;
    if (document.getElementById('endSession')?.disabled) return;

    const items = Array.isArray(data.ambiguous_tokens) ? data.ambiguous_tokens : [];
    const tokenInfo = items.find((item) => item && typeof item === 'object'
      && (item.token || item.detected_text)) || null;
    const original = firstNonEmpty(tokenInfo?.token, tokenInfo?.detected_text,
      data.recognized_text, data.latex);
    if (!original) return;

    currentData = data;
    currentToken = original;
    currentPage = pageNumber;
    latestAnchor = getAnchor(data, tokenInfo);
    buildPanel();
    lastFocused = document.activeElement;
    panel.querySelector('#aiCorrectionConfidence').textContent = `Độ tin cậy ${Math.round(confidence * 100)}%`;
    panel.querySelector('#aiCorrectionDetected').textContent = original;
    const options = panel.querySelector('#aiCorrectionOptions');
    options.replaceChildren();
    const suggestions = suggestionsFrom(data, tokenInfo, original);
    for (const candidate of suggestions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-correction-option';
      button.textContent = candidate;
      if (candidate === original) button.setAttribute('aria-label', `${candidate} (giữ nguyên)`);
      button.addEventListener('click', () => applyCorrection(candidate));
      options.appendChild(button);
    }
    panel.querySelector('#aiCorrectionCustom').value = '';
    panel.hidden = false;
    positionPopup(latestAnchor);
  }

  function watchCanvasPoint(event) {
    const canvas = event.target;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.closest('#canvasStage')) return;
    const stage = document.getElementById('canvasStage');
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    lastWritingPoint = {
      x: Math.max(box.left, Math.min(event.clientX, box.right)),
      y: Math.max(box.top, Math.min(event.clientY, box.bottom))
    };
  }

  document.addEventListener('pointerup', watchCanvasPoint, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopup();
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#prevPage, #nextPage, #addPageButton, #deletePageButton, #clearButton, #endSession')) {
      closePopup();
    }
  }, true);
  window.addEventListener('resize', () => { if (latestAnchor) positionPopup(latestAnchor); });

  // Giữ nguyên kết quả JSON được module nhận diện dùng. Khi giáo viên chọn sửa,
  // bản sao trong currentAiResult của module gốc thay đổi theo (cùng object reference).
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isRecognition = ENDPOINT.test(url);
    if (isRecognition) closePopup();
    const response = await originalFetch.apply(this, arguments);
    if (isRecognition && response.ok) {
      const originalJson = response.json.bind(response);
      response.json = async (...args) => {
        const data = await originalJson(...args);
        // Chạy sau khi UI nhận diện gốc đã nhận và xử lý JSON.
        setTimeout(() => showCorrection(data), 0);
        return data;
      };
    }
    return response;
  };
})();
