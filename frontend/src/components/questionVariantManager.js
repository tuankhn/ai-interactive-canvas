// ==============================================================================
// QUẢN LÝ TÍNH NĂNG AI TẠO CÂU HỎI TƯƠNG TỰ VÀ CÂU HỎI NÂNG CAO (TASK TF2851B)
// Phụ trách: Nguyễn Ngọc Gia Bảo 2 (N25DTCN121) - Sprint 3 (16/11 - 20/11/2026)
// ==============================================================================

import { $, fabricCanvas, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

const VARIANT_ENDPOINT = '/api/v1/exam/generate-variant';

const SAMPLE_PRESETS = {
  quad: 'Giải phương trình bậc hai sau trên tập số thực: x^2 - 5x + 6 = 0',
  system: 'Giải hệ phương trình bậc nhất hai ẩn sau:\n  2x + y = 7\n  x - y = 2',
  motion: 'Một ô tô đi từ A đến B trên quãng đường 120 km với vận tốc 40 km/h. Trên thực tế xe đi với vận tốc 60 km/h. Hỏi xe đến sớm hơn dự kiến bao nhiêu giờ?',
  geom: 'Cho tam giác ABC vuông tại A có AB = 6 cm, AC = 8 cm. Kẻ đường cao AH vuông góc với BC. Tính cạnh huyền BC, đường cao AH và diện tích tam giác.',
  phys: 'Một con lắc lò xo dao động điều hòa gồm vật m = 250 g và lò xo có độ cứng k = 100 N/m. Tính chu kỳ và tần số dao động của con lắc.',
};

let currentVariants = [];

/**
 * Khởi tạo trình quản lý tính năng AI tạo câu hỏi tương tự & nâng cao.
 */
export function setupQuestionVariantManager() {
  const triggerBtn = $('aiVariantBtn');
  const dialog = $('aiVariantDialog');
  const closeXBtn = $('closeAiVariantXBtn');
  const closeBtn = $('closeAiVariantBtn');
  const extractBoardBtn = $('variantExtractBoardBtn');
  const inputEl = $('variantOriginalInput');
  const samplePills = document.querySelectorAll('.variant-sample-pill');

  const btnSimilar = $('btnGenSimilar');
  const btnAdvanced = $('btnGenAdvanced');
  const btnBoth = $('btnGenBoth');

  const loadingIndicator = $('variantLoadingIndicator');
  const resultsContainer = $('variantResultsContainer');
  const cardsList = $('variantCardsList');
  const countEl = $('variantCount');
  const sourceBadge = $('variantSourceBadge');

  if (!triggerBtn || !dialog) return;

  function openDialog() {
    // Tự động kiểm tra nếu trên bảng có đề bài thì nạp sẵn
    const extracted = extractQuestionTextFromBoard();
    if (extracted && (!inputEl.value || inputEl.value.trim() === '' || inputEl.value === SAMPLE_PRESETS.quad)) {
      inputEl.value = extracted;
    }

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  triggerBtn.addEventListener('click', openDialog);
  if (closeXBtn) closeXBtn.addEventListener('click', closeDialog);
  if (closeBtn) closeBtn.addEventListener('click', closeDialog);

  // Nạp câu hỏi mẫu nhanh
  samplePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const key = pill.getAttribute('data-sample');
      if (SAMPLE_PRESETS[key]) {
        inputEl.value = SAMPLE_PRESETS[key];
        inputEl.focus();
      }
    });
  });

  // Nút lấy đề bài đang chiếu trên mặt bảng
  if (extractBoardBtn) {
    extractBoardBtn.addEventListener('click', () => {
      const extracted = extractQuestionTextFromBoard();
      if (extracted) {
        inputEl.value = extracted;
        setStatus('Đã trích xuất đề bài đang chiếu trên bảng');
      } else {
        alert('Không tìm thấy khối đề bài nào trên bảng. Bạn có thể tự gõ đề hoặc chọn nút đề mẫu nhanh.');
      }
    });
  }

  // Các nút sinh câu hỏi
  if (btnSimilar) {
    btnSimilar.addEventListener('click', () => requestVariants('SIMILAR'));
  }
  if (btnAdvanced) {
    btnAdvanced.addEventListener('click', () => requestVariants('ADVANCED'));
  }
  if (btnBoth) {
    btnBoth.addEventListener('click', () => requestVariants('BOTH'));
  }

  async function requestVariants(variantType, customSeed = null) {
    const originalText = (inputEl.value || '').trim();
    if (!originalText) {
      alert('Vui lòng nhập đề bài hoặc bấm nút lấy đề bài từ bảng.');
      inputEl.focus();
      return;
    }

    loadingIndicator.hidden = false;
    resultsContainer.hidden = true;
    cardsList.innerHTML = '';

    const subjectSelect = $('subjectSelect');
    const subject = subjectSelect ? subjectSelect.value : 'TOAN';
    const seed = customSeed !== null ? customSeed : Math.floor(Math.random() * 100000);

    try {
      const response = await authFetch(VARIANT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_question: originalText,
          variant_type: variantType,
          subject: subject,
          seed: seed,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Mã lỗi HTTP ${response.status}`);
      }

      const data = await response.json();
      currentVariants = data.variants || [];

      loadingIndicator.hidden = true;
      resultsContainer.hidden = false;
      countEl.textContent = currentVariants.length;
      sourceBadge.textContent = data.generation_source === 'AI_GEMINI' ? '✨ Gemini 2.5 Flash' : '⚡ Math Perturbation Engine';

      renderVariantCards(currentVariants, cardsList, variantType);
      setStatus(`AI đã tạo thành công ${currentVariants.length} bài tập biến thể`);
    } catch (err) {
      loadingIndicator.hidden = true;
      alert(`Không thể sinh câu hỏi: ${err.message}`);
      setStatus(`Lỗi sinh câu hỏi: ${err.message}`);
    }
  }

  /**
   * Render danh sách các bài tập biến thể do AI sinh ra.
   */
  function renderVariantCards(variants, container, lastVariantType) {
    container.innerHTML = '';

    variants.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = `variant-card ${item.variant_type === 'ADVANCED' ? 'variant-card-advanced' : 'variant-card-similar'}`;

      const isAdv = item.variant_type === 'ADVANCED';
      const badgeClass = isAdv ? 'badge-variant-adv' : 'badge-variant-sim';

      card.innerHTML = `
        <div class="variant-card-top">
          <div class="variant-card-badges">
            <span class="variant-badge ${badgeClass}">${item.icon} ${item.type_display}</span>
            <span class="variant-diff-badge">${item.difficulty_level}</span>
          </div>
          <strong class="variant-card-title">${item.title}</strong>
        </div>

        <div class="variant-question-box">
          <p class="variant-question-text">${escapeHtml(item.question_content)}</p>
        </div>

        <div class="variant-meta-box">
          ${item.changed_parameters ? `<div class="meta-row"><strong>🔄 Số liệu đổi:</strong> <span>${escapeHtml(item.changed_parameters)}</span></div>` : ''}
          ${item.added_conditions ? `<div class="meta-row"><strong>🎯 Điều kiện nâng cao:</strong> <span>${escapeHtml(item.added_conditions)}</span></div>` : ''}
          ${item.advanced_hint ? `<div class="meta-row hint-row"><strong>💡 Gợi ý tư duy:</strong> <span>${escapeHtml(item.advanced_hint)}</span></div>` : ''}
        </div>

        <!-- Khối Đáp án & Hướng dẫn giải (Mặc định ẩn để không lộ đáp án khi chiếu cho học sinh) -->
        <div class="variant-solution-container">
          <button type="button" class="btn-toggle-solution" aria-expanded="false">
            👁️ <span class="toggle-text">Hiện đáp án &amp; lời giải</span>
          </button>
          <div class="variant-solution-content" hidden>
            <div class="solution-answer-row">
              <strong>Đáp số chính xác:</strong> <span class="answer-highlight">${escapeHtml(item.correct_answer)}</span>
            </div>
            <div class="solution-guide-text">
              <strong>Hướng dẫn giải chi tiết:</strong>
              <pre>${escapeHtml(item.solution_guide)}</pre>
            </div>
          </div>
        </div>

        <div class="variant-card-actions">
          <button type="button" class="btn-action-insert" title="Chèn đề bài này trực tiếp lên mặt bảng vẽ Fabric.js">
            📌 Chiếu lên bảng vẽ
          </button>
          <button type="button" class="btn-action-copy" title="Sao chép nội dung câu hỏi">
            📋 Sao chép đề bài
          </button>
          <button type="button" class="btn-action-rerun" title="AI sinh một bộ số liệu khác cho dạng bài này">
            🔄 Đổi số liệu khác
          </button>
        </div>
      `;

      // Bắt sự kiện Toggle Ẩn/Hiện Đáp án
      const toggleBtn = card.querySelector('.btn-toggle-solution');
      const solContent = card.querySelector('.variant-solution-content');
      toggleBtn.addEventListener('click', () => {
        const isHidden = solContent.hidden;
        solContent.hidden = !isHidden;
        toggleBtn.setAttribute('aria-expanded', String(isHidden));
        toggleBtn.querySelector('.toggle-text').textContent = isHidden ? 'Ẩn đáp án & lời giải' : 'Hiện đáp án & lời giải';
      });

      // Bắt sự kiện Chèn bài tập lên bảng vẽ
      const insertBtn = card.querySelector('.btn-action-insert');
      insertBtn.addEventListener('click', () => {
        insertVariantCardToCanvas(item);
        closeDialog();
      });

      // Bắt sự kiện Sao chép đề bài
      const copyBtn = card.querySelector('.btn-action-copy');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.question_content);
          copyBtn.textContent = '✓ Đã chép!';
          setTimeout(() => {
            copyBtn.textContent = '📋 Sao chép đề bài';
          }, 2000);
        } catch {
          alert(item.question_content);
        }
      });

      // Bắt sự kiện Đổi số liệu khác (Re-run với seed mới)
      const rerunBtn = card.querySelector('.btn-action-rerun');
      rerunBtn.addEventListener('click', () => {
        requestVariants(item.variant_type, Math.floor(Math.random() * 100000));
      });

      container.appendChild(card);
    });
  }
}

/**
 * Quét các đối tượng văn bản trên canvas để tìm câu hỏi đang chiếu.
 */
export function extractQuestionTextFromBoard() {
  if (!fabricCanvas) return '';
  const objects = fabricCanvas.getObjects();

  // Ưu tiên các thẻ câu hỏi được đánh dấu
  for (const obj of objects) {
    if (obj.meta && (obj.meta.quizCardManaged || obj.meta.variantCardManaged || obj.meta.examQuestion)) {
      if (typeof obj.text === 'string' && obj.text.trim()) {
        return cleanQuestionText(obj.text);
      }
    }
  }

  // Quét các đối tượng Text / Textbox trên bảng
  for (const obj of objects) {
    if (obj instanceof Textbox || obj.type === 'textbox' || obj.type === 'text') {
      const text = (obj.text || '').trim();
      if (text.length > 15) {
        return cleanQuestionText(text);
      }
    }
  }

  return '';
}

function cleanQuestionText(text) {
  // Loại bỏ các tiền tố quản lý hiển thị
  let cleaned = text.replace(/^\[Trắc nghiệm \d+\/\d+\]\s*/i, '');
  cleaned = cleaned.replace(/^【BÀI TẬP [^】]+】\s*/i, '');
  cleaned = cleaned.replace(/^Đề bài:\s*/i, '');
  return cleaned.trim();
}

/**
 * Chèn một Card bài tập đẹp mắt do AI tạo lên mặt bảng vẽ Fabric.js.
 */
export function insertVariantCardToCanvas(variantItem) {
  if (!fabricCanvas || !variantItem) return;
  const before = snapshot();

  const isDark = fabricCanvas.backgroundColor === '#111827';
  const isAdv = variantItem.variant_type === 'ADVANCED';

  const cardWidth = Math.min(680, Math.max(420, fabricCanvas.getWidth() - 120));
  const left = 60;
  const top = 80;

  const headerTitle = isAdv
    ? '【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】'
    : '【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】';

  const fullText = `${headerTitle}\n${variantItem.question_content}\n\n` +
    (variantItem.changed_parameters ? `• Số liệu đổi: ${variantItem.changed_parameters}\n` : '') +
    (variantItem.added_conditions ? `• Điều kiện: ${variantItem.added_conditions}\n` : '') +
    (variantItem.advanced_hint ? `• Gợi ý: ${variantItem.advanced_hint}` : '');

  const strokeColor = isAdv ? '#7c3aed' : '#16a34a';
  const bgColor = isDark
    ? (isAdv ? 'rgba(76, 29, 149, 0.25)' : 'rgba(20, 83, 45, 0.25)')
    : (isAdv ? '#f5f3ff' : '#f0fdf4');

  const cardBox = new Rect({
    left: left - 12,
    top: top - 12,
    width: cardWidth + 24,
    height: 160, // Sẽ được cập nhật sau khi tính chiều cao chữ
    rx: 12,
    ry: 12,
    fill: bgColor,
    stroke: strokeColor,
    strokeWidth: 2,
    strokeDashArray: isAdv ? [6, 4] : null,
    selectable: true,
    evented: true,
  });

  const cardText = new Textbox(fullText, {
    left: left,
    top: top,
    width: cardWidth,
    fontSize: 16,
    lineHeight: 1.35,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fill: isDark ? '#f8fafc' : '#0f172a',
    selectable: true,
    evented: true,
  });

  // Cập nhật chiều cao khung nền theo chiều cao chữ
  const textBounds = cardText.getBoundingRect();
  cardBox.set('height', (textBounds.height || 140) + 24);

  cardBox.meta = { variantCardManaged: true, variantId: variantItem.id, type: 'bg' };
  cardText.meta = { variantCardManaged: true, variantId: variantItem.id, type: 'text' };

  fabricCanvas.add(cardBox);
  fabricCanvas.add(cardText);
  fabricCanvas.setActiveObject(cardText);
  fabricCanvas.renderAll();
  remember(before);
  updateHint();

  setStatus(`Đã chiếu "${variantItem.title}" lên bảng vẽ`);
}
