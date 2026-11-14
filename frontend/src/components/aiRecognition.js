import { Text, FabricImage } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';
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
          headLine.innerHTML = `<strong class="ai-eng-word">${details.grammar_structure}</strong>`;
          engContainer.appendChild(headLine);

          const sentenceLine = document.createElement('div');
          sentenceLine.className = 'ai-eng-example';
          sentenceLine.innerHTML = `<strong>Câu:</strong> ${data.recognized_text}`;
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
          headLine.innerHTML = `<strong class="ai-eng-word">${details.word || data.recognized_text}</strong> <span class="ai-eng-type">[${details.word_type || 'Word'}]</span> <span class="ai-eng-ipa">${details.ipa || ''}</span>`;
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
            exLine.innerHTML = `<em>Ex:</em> ${details.example_sentence} <br><span class="ai-eng-trans">(${details.example_translation || ''})</span>`;
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
          aiElements.illustrationPreview.innerHTML = data.illustration.svg_content || '';
        }
        if (aiElements.illustrationDesc) {
          aiElements.illustrationDesc.textContent = data.illustration.description || '';
        }
      } else {
        aiElements.illustrationBox.hidden = true;
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

    ui.footer.textContent = `Đã kết nối máy chủ · Nhận diện AI (${data.subject || 'Đa môn'}) thành công (${data.latency_ms || elapsed} ms) · Debounce 800ms`;
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

export async function insertAiResultToBoard() {
  if (!currentAiResult) return;
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

  const before = snapshot();
  let textWidth = 260;

  if (textToInsert) {
    const textObj = new Text(textToInsert, {
      left: 40,
      top: 40,
      fill: fabricCanvas.backgroundColor === '#111827' ? '#67e8f9' : '#1e3a8a',
      fontSize: 22,
      fontFamily: 'Arial, sans-serif',
      selectable: false,
      evented: false
    });
    textObj._hitPoints = [{ x: 40, y: 40 }, { x: 250, y: 40 }];
    textObj._hitWidth = 30;
    fabricCanvas.add(textObj);
    textWidth = Math.max(220, textObj.width || 260);
  }

  // Task TF2850F: Tự động đặt hình minh họa nét phấn trắng bên cạnh từ vựng
  if (currentAiResult.illustration) {
    const illuX = 40 + textWidth + 35; // Đặt cạnh từ vựng
    const illuY = 40;
    await insertIllustrationToBoard(currentAiResult.illustration, illuX, illuY);
  }

  fabricCanvas.requestRenderAll();
  remember(before);
  updateHint();
  setStatus('Đã chèn kết quả AI và hình minh họa nét phấn vào bảng');
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
        alert('Vui lòng nhập từ vựng hoặc khái niệm cần tạo minh họa.');
        return;
      }
      aiElements.illustrateDialog.close();
      setStatus(`Đang gọi AI tạo hình minh họa nét phấn trắng: "${concept}"...`);

      try {
        const subject = aiElements.subjectSelect?.value || 'TIENG_ANH';
        const response = await fetch('/api/v1/illustrate', {
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
          fill: fabricCanvas.backgroundColor === '#111827' ? '#67e8f9' : '#1e3a8a',
          fontSize: 24,
          fontFamily: 'Arial, sans-serif',
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
        alert(`Không thể tạo hình minh họa: ${err.message}`);
        setStatus('Lỗi tạo hình minh họa AI');
      }
    });
  }

  initBoardWebSocket();
}

