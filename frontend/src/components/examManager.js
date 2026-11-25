import { $, fabricCanvas, state, eraserTools, setStatus, isDarkBoardActive } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { computeCleanBoardPlacement, panViewportToShowWorldRect } from '../utils/floating_drag.js';
import { extractQuestionContextFromCanvas } from './quiz_board.js';
import { FabricText, Line, Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

let currentExamData = null;
let rawLoadedExamData = null;

export function setupExamManager() {
  const examModal = $('examModal');
  const examUploadBtn = $('examUploadBtn');
  const gradeMcqBtn = $('gradeMcqBtn');
  const closeExamModalBtn = $('closeExamModalBtn');
  const closeExamModalXBtn = $('closeExamModalXBtn');

  const examTabFile = $('examTabFile');
  const examTabText = $('examTabText');
  const examFilePanel = $('examFilePanel');
  const examTextPanel = $('examTextPanel');

  const examDropzone = $('examDropzone');
  const examFileInput = $('examFileInput');
  const selectedFileName = $('selectedFileName');
  const uploadExamFileBtn = $('uploadExamFileBtn');

  const examDirectTextInput = $('examDirectTextInput');
  const parseDirectTextBtn = $('parseDirectTextBtn');
  const layoutToBoardBtn = $('layoutToBoardBtn');

  const examPreviewSection = $('examPreviewSection');
  const examQuestionsList = $('examQuestionsList');
  const questionCount = $('questionCount');
  const previewSecurityBadge = $('previewSecurityBadge');
  const examModalStatus = $('examModalStatus');

  // Feedback Dialog elements (Task TF28519)
  const gradeFeedbackDialog = $('gradeFeedbackDialog');
  const closeGradeFeedbackBtn = $('closeGradeFeedbackBtn');
  const closeGradeFeedbackXBtn = $('closeGradeFeedbackXBtn');
  const retryGradeBtn = $('retryGradeBtn');
  const feedbackResultBadge = $('feedbackResultBadge');
  const feedbackIcon = $('feedbackIcon');
  const feedbackText = $('feedbackText');
  const feedbackSubjectTag = $('feedbackSubjectTag');
  const feedbackSelectedLabel = $('feedbackSelectedLabel');
  const feedbackCorrectLabel = $('feedbackCorrectLabel');
  const feedbackDistractorBox = $('feedbackDistractorBox');
  const feedbackDistractorText = $('feedbackDistractorText');
  const feedbackGuidanceBox = $('feedbackGuidanceBox');
  const feedbackGuidanceText = $('feedbackGuidanceText');
  const feedbackExplanationBox = $('feedbackExplanationBox');
  const feedbackExplanationText = $('feedbackExplanationText');

  if (!examModal) return;

  function showStatus(text, isError = false) {
    if (!examModalStatus) return;
    examModalStatus.textContent = text;
    examModalStatus.hidden = !text;
    examModalStatus.style.color = isError ? '#dc2626' : '#16a34a';
  }

  function getSelectedMode() {
    const radio = document.querySelector('input[name="examMode"]:checked');
    return radio ? radio.value : 'STUDENT';
  }

  function getCurrentSubject() {
    const subjSelect = $('subjectSelect');
    return subjSelect ? subjSelect.value : 'TOAN';
  }

  // Mở modal tải đề
  if (examUploadBtn) {
    examUploadBtn.addEventListener('click', () => {
      if (state.ended) return;
      showStatus('');
      examModal.showModal();
    });
  }

  // Nút Chấm trắc nghiệm trên Toolbar
  if (gradeMcqBtn) {
    gradeMcqBtn.addEventListener('click', () => {
      if (state.ended) return;
      if (!currentExamData || !currentExamData.questions || currentExamData.questions.length === 0) {
        showStatus('');
        examModal.showModal();
        setStatus('Vui lòng chọn hoặc tải đề thi để bắt đầu làm bài và chấm trắc nghiệm.');
      } else {
        examModal.showModal();
        setStatus('Hãy nhấp vào một phương án A, B, C, D để hệ thống kiểm tra và giải thích chi tiết.');
      }
    });
  }

  // Đóng modal tải đề (và tự đóng khi chuyển sang bảng Trắc nghiệm khoanh A/B/C/D)
  const closeModal = () => {
    if (examModal.open) examModal.close();
  };
  if (closeExamModalBtn) closeExamModalBtn.addEventListener('click', closeModal);
  if (closeExamModalXBtn) closeExamModalXBtn.addEventListener('click', closeModal);
  $('quizBoardToggleBtn')?.addEventListener('click', () => {
    closeModal();
  });

  // Đóng Feedback Dialog
  const closeFeedbackModal = () => {
    if (gradeFeedbackDialog) gradeFeedbackDialog.close();
  };
  if (closeGradeFeedbackBtn) closeGradeFeedbackBtn.addEventListener('click', closeFeedbackModal);
  if (closeGradeFeedbackXBtn) closeGradeFeedbackXBtn.addEventListener('click', closeFeedbackModal);
  if (retryGradeBtn) {
    retryGradeBtn.addEventListener('click', () => {
      closeFeedbackModal();
      if (!examModal.open) examModal.showModal();
    });
  }

  // Chuyển Tab
  if (examTabFile && examTabText) {
    examTabFile.addEventListener('click', () => {
      examTabFile.classList.add('is-active');
      examTabFile.setAttribute('aria-selected', 'true');
      examTabText.classList.remove('is-active');
      examTabText.setAttribute('aria-selected', 'false');
      if (examFilePanel) examFilePanel.hidden = false;
      if (examTextPanel) examTextPanel.hidden = true;
      showStatus('');
    });

    examTabText.addEventListener('click', () => {
      examTabText.classList.add('is-active');
      examTabText.setAttribute('aria-selected', 'true');
      examTabFile.classList.remove('is-active');
      examTabFile.setAttribute('aria-selected', 'false');
      if (examTextPanel) examTextPanel.hidden = false;
      if (examFilePanel) examFilePanel.hidden = true;
      showStatus('');
    });
  }

  // Chọn file & Kéo thả
  if (examDropzone && examFileInput) {
    examDropzone.addEventListener('click', () => examFileInput.click());
    examFileInput.addEventListener('change', () => {
      if (examFileInput.files && examFileInput.files[0]) {
        selectedFileName.textContent = `Đã chọn: ${examFileInput.files[0].name} (${(examFileInput.files[0].size / 1024).toFixed(1)} KB)`;
      }
    });

    examDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      examDropzone.classList.add('is-dragover');
    });

    examDropzone.addEventListener('dragleave', () => {
      examDropzone.classList.remove('is-dragover');
    });

    examDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      examDropzone.classList.remove('is-dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        examFileInput.files = e.dataTransfer.files;
        selectedFileName.textContent = `Đã chọn: ${e.dataTransfer.files[0].name} (${(e.dataTransfer.files[0].size / 1024).toFixed(1)} KB)`;
      }
    });
  }

  // Chèn đề mẫu nhanh
  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const subject = btn.dataset.subject || 'TOAN';
      try {
        showStatus('Đang tải đề mẫu...');
        const res = await authFetch(`/api/v1/exam/sample?subject=${subject}&mode=${getSelectedMode()}`);
        if (!res.ok) throw new Error('Không thể tải đề mẫu');
        const data = await res.json();
        renderExamPreview(data);
        showStatus(`Đã tải đề mẫu môn ${subject}`);
      } catch (err) {
        showStatus(err.message, true);
      }
    });
  });

  // Upload file đề thi
  if (uploadExamFileBtn) {
    uploadExamFileBtn.addEventListener('click', async () => {
      if (!examFileInput.files || !examFileInput.files[0]) {
        showStatus('Vui lòng chọn một tệp .docx, .pdf hoặc .txt', true);
        return;
      }

      const file = examFileInput.files[0];
      const formData = new FormData();
      formData.append('file', file);

      const mode = getSelectedMode();
      uploadExamFileBtn.disabled = true;
      uploadExamFileBtn.textContent = 'Đang phân tích...';
      showStatus('Đang tải và bóc tách câu hỏi từ tệp...');

      try {
        const res = await authFetch(`/api/v1/exam/upload?mode=${mode}`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Lỗi bóc tách tệp');
        }

        const examData = await res.json();
        renderExamPreview(examData);
        showStatus(`Đã bóc tách thành công ${examData.total_questions} câu hỏi!`);
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        uploadExamFileBtn.disabled = false;
        uploadExamFileBtn.textContent = 'Phân tích & Bóc tách câu hỏi';
      }
    });
  }

  // Phân tích văn bản trực tiếp
  if (parseDirectTextBtn) {
    parseDirectTextBtn.addEventListener('click', async () => {
      const rawText = examDirectTextInput.value.trim();
      if (!rawText) {
        showStatus('Vui lòng nhập nội dung đề thi', true);
        return;
      }

      const mode = getSelectedMode();
      parseDirectTextBtn.disabled = true;
      parseDirectTextBtn.textContent = 'Đang phân tích...';
      showStatus('Đang bóc tách câu hỏi...');

      try {
        const res = await authFetch('/api/v1/exam/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raw_text: rawText,
            title: 'Đề bài giáo viên nhập',
            mode: mode,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Lỗi bóc tách đề bài');
        }

        const examData = await res.json();
        renderExamPreview(examData);
        showStatus(`Đã bóc tách thành công ${examData.total_questions} câu hỏi!`);
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        parseDirectTextBtn.disabled = false;
        parseDirectTextBtn.textContent = 'Phân tích đề bài';
      }
    });
  }

  // Thay đổi mode (Học sinh / Giáo viên)
  document.querySelectorAll('input[name="examMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const baseData = rawLoadedExamData || currentExamData;
      if (baseData) {
        if (getSelectedMode() === 'STUDENT') {
          const masked = JSON.parse(JSON.stringify(baseData));
          masked.mode = 'STUDENT';
          masked.hidden_answers = true;
          masked.questions.forEach((q) => {
            q.correct_option = null;
            q.explanation = null;
            q.options.forEach((opt) => (opt.is_correct = false));
          });
          renderExamPreview(masked, { preserveRaw: true });
        } else {
          renderExamPreview(baseData, { preserveRaw: true });
        }
      }
    });
  });

  // =========================================================================
  // TASK TF28519: CHẤM BÀI TRẮC NGHIỆM & PHÂN TÍCH PHƯƠNG ÁN GÂY NHIỄU
  // =========================================================================
  async function gradeStudentChoice(question, selectedLabel, optElement = null) {
    const subject = getCurrentSubject();
    setStatus(`Đang chấm phương án ${selectedLabel}...`);

    try {
      const payload = {
        question_id: question.id || 'q_direct',
        selected_label: selectedLabel,
        correct_label: question.correct_option || null,
        explanation: question.explanation || null,
        question_content: question.content,
        options: Array.isArray(question.options)
          ? question.options.map((o) => ({ label: o.label, content: o.content }))
          : null,
        subject: subject,
      };

      const res = await authFetch('/api/v1/exam/grade-mcq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Lỗi khi chấm bài');
      }

      const gradeResult = await res.json();
      displayGradeFeedback(gradeResult, question);

      // Cập nhật trạng thái trực quan ngay trên thẻ câu hỏi
      if (optElement) {
        const parentCard = optElement.closest('.exam-q-card');
        if (parentCard) {
          parentCard.querySelectorAll('.exam-q-opt').forEach((el) => {
            el.classList.remove('opt-student-selected-correct', 'opt-student-selected-wrong');
          });
          if (gradeResult.is_correct) {
            optElement.classList.add('opt-student-selected-correct');
          } else {
            optElement.classList.add('opt-student-selected-wrong');
          }
        }
      }

      setStatus(
        gradeResult.is_correct
          ? `✓ Đúng câu ${question.number}! (+1.0 điểm)`
          : `✕ Câu ${question.number} chưa chính xác. Xem phân tích lỗi sai và gợi ý.`
      );
    } catch (err) {
      console.error('Lỗi chấm trắc nghiệm:', err);
      setStatus(`Lỗi chấm bài: ${err.message}`);
    }
  }

  // Hiển thị hộp thoại kết quả chấm bài với tích xanh / cảnh báo đỏ
  function displayGradeFeedback(result, question) {
    if (!gradeFeedbackDialog) return;

    const isCorrect = result.is_correct;
    if (feedbackResultBadge) {
      feedbackResultBadge.className = isCorrect
        ? 'feedback-result-badge badge-correct'
        : 'feedback-result-badge badge-incorrect';
    }

    if (feedbackIcon) feedbackIcon.textContent = result.icon || (isCorrect ? '✓' : '✕');
    if (feedbackText) {
      feedbackText.textContent = isCorrect
        ? 'Chính xác! (+1.0 điểm)'
        : 'Cảnh báo: Chưa chính xác! (+0.0 điểm)';
    }

    if (feedbackSubjectTag) feedbackSubjectTag.textContent = `Môn: ${getCurrentSubject()}`;
    if (feedbackSelectedLabel) feedbackSelectedLabel.textContent = `Phương án ${result.selected_label}`;
    if (feedbackCorrectLabel) feedbackCorrectLabel.textContent = `Phương án ${result.correct_label}`;

    // Phân tích phương án gây nhiễu
    if (feedbackDistractorBox) {
      if (!isCorrect && result.distractor_analysis) {
        feedbackDistractorBox.hidden = false;
        if (feedbackDistractorText) feedbackDistractorText.textContent = result.distractor_analysis;
      } else {
        feedbackDistractorBox.hidden = true;
      }
    }

    // Hướng dẫn cách tìm ra đáp án đúng
    if (feedbackGuidanceBox) {
      if (result.guidance) {
        feedbackGuidanceBox.hidden = false;
        if (feedbackGuidanceText) feedbackGuidanceText.textContent = result.guidance;
      } else {
        feedbackGuidanceBox.hidden = true;
      }
    }

    // Lời giải thích chi tiết
    if (feedbackExplanationBox) {
      if (result.explanation) {
        feedbackExplanationBox.hidden = false;
        if (feedbackExplanationText) feedbackExplanationText.textContent = result.explanation;
      } else {
        feedbackExplanationBox.hidden = true;
      }
    }

    gradeFeedbackDialog.showModal();
  }

  // Render danh sách preview câu hỏi
  function renderExamPreview(data, { preserveRaw = false } = {}) {
    currentExamData = data;
    if (!preserveRaw) {
      rawLoadedExamData = JSON.parse(JSON.stringify(data));
    }
    window.dispatchEvent(new CustomEvent('app:exam-loaded', { detail: data }));
    examPreviewSection.hidden = false;
    layoutToBoardBtn.disabled = false;
    questionCount.textContent = data.total_questions;

    const isStudent = data.mode === 'STUDENT';
    if (isStudent) {
      previewSecurityBadge.className = 'preview-badge badge-student';
      previewSecurityBadge.textContent = 'Chế độ Học sinh: Đã ẩn an toàn đáp án đúng & lời giải. Nhấp phương án để làm bài.';
    } else {
      previewSecurityBadge.className = 'preview-badge badge-teacher';
      previewSecurityBadge.textContent = 'Chế độ Giáo viên: Hiển thị đầy đủ đáp án đúng & hướng dẫn giải';
    }

    examQuestionsList.innerHTML = '';
    data.questions.forEach((q) => {
      const qCard = document.createElement('div');
      qCard.className = 'exam-q-card';

      let optionsHtml = '';
      if (q.options && q.options.length > 0) {
        optionsHtml = `
          <div class="exam-q-options">
            ${q.options
              .map((opt) => {
                const isCorrect = !isStudent && (opt.is_correct || opt.label === q.correct_option);
                const safeLabel = escapeHtml(opt.label);
                return `
                <div class="exam-q-opt ${isCorrect ? 'opt-correct' : ''} ${isStudent ? 'opt-clickable' : ''}" data-label="${safeLabel}">
                  <span class="opt-badge">${safeLabel}</span>
                  <span class="opt-text">${escapeHtml(opt.content)}</span>
                  ${isCorrect ? '<span class="opt-correct-tag">✓ Đáp án đúng</span>' : ''}
                  ${isStudent ? '<span class="opt-select-btn">Chọn đáp án</span>' : ''}
                </div>
              `;
              })
              .join('')}
          </div>
        `;
      } else {
        optionsHtml = '<div class="exam-q-essay-hint">[Câu hỏi tự luận]</div>';
      }

      let explanationHtml = '';
      if (!isStudent && q.explanation) {
        explanationHtml = `
          <div class="exam-q-explanation">
            <strong>Hướng dẫn giải:</strong> ${escapeHtml(q.explanation)}
          </div>
        `;
      }

      qCard.innerHTML = `
        <div class="exam-q-header">
          <strong>Câu ${escapeHtml(q.number)}:</strong> ${escapeHtml(q.content)}
        </div>
        ${optionsHtml}
        ${explanationHtml}
      `;

      // Gắn sự kiện click vào các phương án để học sinh làm bài & chấm trắc nghiệm
      if (isStudent) {
        qCard.querySelectorAll('.exam-q-opt').forEach((optEl) => {
          optEl.addEventListener('click', () => {
            const chosenLabel = optEl.dataset.label;
            gradeStudentChoice(q, chosenLabel, optEl);
          });
        });
      }

      examQuestionsList.appendChild(qCard);
    });
  }

  // Dàn TOÀN BỘ câu hỏi lên mặt bảng vẽ vô hạn (không bị cắt mất từ câu 3 trở đi)
  layoutToBoardBtn.addEventListener('click', async () => {
    if (!currentExamData || !currentExamData.questions || currentExamData.questions.length === 0) {
      showStatus('Không có câu hỏi nào để dàn lên bảng', true);
      return;
    }

    const mode = getSelectedMode();
    const totalQ = currentExamData.questions.length;
    layoutToBoardBtn.disabled = true;
    layoutToBoardBtn.textContent = 'Đang dàn lên bảng...';

    try {
      const res = await authFetch('/api/v1/exam/layout-canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: currentExamData.questions,
          mode: mode,
          questions_per_page: Math.max(50, totalQ),
        }),
      });

      const layoutData = res.ok ? await res.json() : null;
      applyExamLayoutToCanvas(currentExamData.questions, mode, layoutData);
      examModal.close();
      setStatus(`Đã dàn đầy đủ ${totalQ}/${totalQ} câu hỏi lên mặt bảng vẽ!`);
    } catch (err) {
      showStatus(err.message, true);
    } finally {
      layoutToBoardBtn.disabled = false;
      layoutToBoardBtn.textContent = 'Dàn toàn bộ câu hỏi ra bảng';
    }
  });

  // Dàn đầy đủ 100% câu hỏi dọc theo mặt bảng vô hạn với khoảng cách thoáng, đo chiều cao thực tế từng dòng
  function applyExamLayoutToCanvas(questionsList, mode = 'STUDENT', _layoutData = null) {
    if (!Array.isArray(questionsList) || questionsList.length === 0) return;
    const before = snapshot();
    const TextboxClass = Textbox || FabricText;

    const isDarkBoard = isDarkBoardActive();
    const isStudent = mode === 'STUDENT';
    const primaryInk = isDarkBoard ? '#ECE7DF' : '#26231F';
    const optionInk = isDarkBoard ? '#D6CFC4' : '#3E3932';
    const correctInk = isDarkBoard ? '#78A87B' : '#2F6F3E';
    const explainInk = isDarkBoard ? '#E89274' : '#9C3F23';
    const sepStroke = isDarkBoard ? 'rgba(255,255,255,0.10)' : 'rgba(38,35,31,0.10)';

    const blockWidth = Math.min(820, Math.max(340, (fabricCanvas.getWidth() || 980) - 140));
    const { left: startLeft, top: startTop } = computeCleanBoardPlacement(blockWidth, 44);
    let cursorY = startTop;

    questionsList.forEach((q, idx) => {
      const qNum = q.number ?? idx + 1;
      const opts = Array.isArray(q.options) ? q.options : [];
      const qType = opts.length >= 2 ? 'MCQ' : 'ESSAY';
      const qGroupId = q.id || `exam_q_${Date.now()}_${idx + 1}`;
      const rawQuestionStr = String(q.content || '').trim();
      const stemStr = `Câu ${qNum}: ${rawQuestionStr}`;
      const stemTb = new TextboxClass(stemStr, {
        left: startLeft,
        top: cursorY,
        width: blockWidth,
        fontSize: 18,
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
        fontWeight: '700',
        fill: primaryInk,
        lineHeight: 1.5,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      const stemH = Math.max(28, stemTb.calcTextHeight?.() || stemTb.height || 28);
      stemTb._hitPoints = [
        { x: startLeft, y: cursorY + stemH / 2 },
        { x: startLeft + blockWidth, y: cursorY + stemH / 2 },
      ];
      stemTb._hitWidth = stemH;
      stemTb.meta = {
        examQuestion: true,
        dataRole: 'question',
        questionType: qType,
        question_id: qGroupId,
        questionGroupId: qGroupId,
        number: qNum,
        rawQuestionText: rawQuestionStr,
        rawLatex: rawQuestionStr,
        aiState: 'formatted',
      };
      fabricCanvas.add(stemTb);
      cursorY += stemH + 14;

      const cleanOptions = opts.map((o) => ({
        label: String(o.label || '').trim().toUpperCase(),
        content: String(o.content || '').trim(),
      }));
      if (opts.length > 0) {
        const canUseTwoCols =
          opts.length >= 2 &&
          blockWidth >= 520 &&
          opts.every((o) => String(o.content || '').trim().length <= 36);

        if (canUseTwoCols) {
          const colGap = 24;
          const colWidth = Math.floor((blockWidth - 20 - colGap) / 2);
          for (let rIdx = 0; rIdx < opts.length; rIdx += 2) {
            const rowItems = opts.slice(rIdx, rIdx + 2);
            let maxRowH = 26;
            rowItems.forEach((opt, cIdx) => {
              const label = String(opt.label || '').trim().toUpperCase();
              const isAnsCorrect = !isStudent && (opt.is_correct || label === q.correct_option);
              const prefix = isAnsCorrect ? `✓ ${label}. ` : `${label}. `;
              const optLeft = startLeft + 20 + cIdx * (colWidth + colGap);
              const optTb = new TextboxClass(`${prefix}${String(opt.content || '').trim()}`, {
                left: optLeft,
                top: cursorY,
                width: colWidth,
                fontSize: 16.5,
                fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
                fontWeight: isAnsCorrect ? '700' : '500',
                fill: isAnsCorrect ? correctInk : optionInk,
                lineHeight: 1.48,
                selectable: false,
                evented: true,
                objectCaching: false,
              });
              const optH = Math.max(24, optTb.calcTextHeight?.() || optTb.height || 24);
              maxRowH = Math.max(maxRowH, optH);
              optTb._hitPoints = [
                { x: optLeft, y: cursorY + optH / 2 },
                { x: optLeft + colWidth, y: cursorY + optH / 2 },
              ];
              optTb._hitWidth = optH;
              optTb.meta = {
                type: 'answer_option',
                question_id: qGroupId,
                linkedGroupId: qGroupId,
                question_number: qNum,
                question_content: rawQuestionStr,
                correct_option: q.correct_option || null,
                explanation: q.explanation || null,
                options: cleanOptions,
                label,
                badgeX: optLeft + 9,
                badgeY: cursorY + optH / 2,
                aiState: 'formatted',
              };
              fabricCanvas.add(optTb);
            });
            cursorY += maxRowH + 12;
          }
        } else {
          opts.forEach((opt) => {
            const label = String(opt.label || '').trim().toUpperCase();
            const isAnsCorrect = !isStudent && (opt.is_correct || label === q.correct_option);
            const prefix = isAnsCorrect ? `✓ ${label}. ` : `${label}. `;
            const optTb = new TextboxClass(`${prefix}${String(opt.content || '').trim()}`, {
              left: startLeft + 20,
              top: cursorY,
              width: blockWidth - 24,
              fontSize: 16.5,
              fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
              fontWeight: isAnsCorrect ? '700' : '500',
              fill: isAnsCorrect ? correctInk : optionInk,
              lineHeight: 1.48,
              selectable: false,
              evented: true,
              objectCaching: false,
            });
            const optH = Math.max(24, optTb.calcTextHeight?.() || optTb.height || 24);
            optTb._hitPoints = [
              { x: startLeft + 20, y: cursorY + optH / 2 },
              { x: startLeft + blockWidth, y: cursorY + optH / 2 },
            ];
            optTb._hitWidth = optH;
            optTb.meta = {
              type: 'answer_option',
              question_id: qGroupId,
              linkedGroupId: qGroupId,
              question_number: qNum,
              question_content: rawQuestionStr,
              correct_option: q.correct_option || null,
              explanation: q.explanation || null,
              options: cleanOptions,
              label,
              badgeX: startLeft + 29,
              badgeY: cursorY + optH / 2,
              aiState: 'formatted',
            };
            fabricCanvas.add(optTb);
            cursorY += optH + 10;
          });
        }
      } else {
        // Câu tự luận: dựng Khung vùng làm bài nét đứt cô lập (answer_zone) để không bao giờ chấm nhầm sang câu khác
        const zoneHeight = 128;
        const answerZoneRect = new Rect({
          left: startLeft,
          top: cursorY,
          width: blockWidth,
          height: zoneHeight,
          rx: 8,
          ry: 8,
          fill: isDarkBoard ? 'rgba(255, 255, 255, 0.03)' : 'rgba(156, 63, 35, 0.03)',
          stroke: isDarkBoard ? 'rgba(232, 146, 116, 0.35)' : 'rgba(156, 63, 35, 0.28)',
          strokeWidth: 1.4,
          strokeDashArray: [6, 5],
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        answerZoneRect.meta = {
          dataRole: 'answer_zone',
          linkedGroupId: qGroupId,
          questionNumber: qNum,
          aiState: 'formatted',
        };
        const zoneHint = new TextboxClass(`Vùng làm bài Câu ${qNum}`, {
          left: startLeft + 12,
          top: cursorY + 8,
          width: 240,
          fontSize: 12,
          fontStyle: 'italic',
          fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
          fill: isDarkBoard ? 'rgba(236,231,223,0.45)' : 'rgba(92,86,78,0.55)',
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        zoneHint.meta = {
          dataRole: 'answer_zone_label',
          linkedGroupId: qGroupId,
          aiState: 'formatted',
        };
        fabricCanvas.add(answerZoneRect, zoneHint);
        cursorY += zoneHeight + 18;
      }

      if (!isStudent && q.explanation) {
        cursorY += 4;
        const expTb = new TextboxClass(`Hướng dẫn giải: ${String(q.explanation).trim()}`, {
          left: startLeft + 20,
          top: cursorY,
          width: blockWidth - 24,
          fontSize: 15,
          fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
          fontStyle: 'italic',
          fill: explainInk,
          lineHeight: 1.5,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        const expH = Math.max(22, expTb.calcTextHeight?.() || expTb.height || 22);
        expTb._hitPoints = [
          { x: startLeft + 20, y: cursorY + expH / 2 },
          { x: startLeft + blockWidth, y: cursorY + expH / 2 },
        ];
        expTb._hitWidth = expH;
        expTb.meta = { examExplanation: true, linkedGroupId: qGroupId, aiState: 'formatted' };
        fabricCanvas.add(expTb);
        cursorY += expH + 10;
      }

      if (idx < questionsList.length - 1) {
        cursorY += 14;
        const divider = new Line(
          [startLeft, cursorY, startLeft + blockWidth, cursorY],
          {
            stroke: sepStroke,
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
          }
        );
        divider.meta = { examDivider: true, linkedGroupId: qGroupId, aiState: 'formatted' };
        fabricCanvas.add(divider);
        cursorY += 24;
      }
    });

    panViewportToShowWorldRect({
      left: startLeft,
      top: startTop,
      width: blockWidth,
      height: Math.min(420, cursorY - startTop),
    });

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
  }

  // C12: Hit-test thủ công theo tọa độ chạm ngắn (Fabric v6 getScenePoint) để không bật skipTargetFind=false
  // và không chấm trùng với cử chỉ khoanh tròn đáp án trong quiz_board.js.
  let answerTapStart = null;
  fabricCanvas.on('mouse:down', (e) => {
    if (!e || !e.e) return;
    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (!pt) return;
    answerTapStart = { x: pt.x, y: pt.y, t: performance.now() };
  });

  fabricCanvas.on('mouse:up', (e) => {
    if (!answerTapStart || !e || !e.e) {
      answerTapStart = null;
      return;
    }
    const start = answerTapStart;
    answerTapStart = null;

    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (!pt) return;

    const elapsedMs = performance.now() - start.t;
    const movedPx = Math.hypot(pt.x - start.x, pt.y - start.y);
    if (elapsedMs > 350 || movedPx > 10) return;
    if (eraserTools?.has(state.tool) || state.tool === 'hand' || state.tool === 'text') return;

    const objects = fabricCanvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i];
      if (!obj?.meta || obj.meta.type !== 'answer_option') continue;
      const bounds = obj.getBoundingRect();
      if (
        pt.x >= bounds.left &&
        pt.x <= bounds.left + bounds.width &&
        pt.y >= bounds.top &&
        pt.y <= bounds.top + bounds.height
      ) {
        const { question_id: questionId, label } = obj.meta;
        let questionObj = null;
        if (currentExamData && currentExamData.questions) {
          questionObj = currentExamData.questions.find((q) => q.id === questionId) || null;
        }
        if (!questionObj) {
          const canvasCtx = extractQuestionContextFromCanvas(fabricCanvas, questionId, bounds.top);
          questionObj = {
            id: questionId,
            number: obj.meta.question_number || 1,
            content: obj.meta.question_content || canvasCtx.content || '',
            correct_option: obj.meta.correct_option || null,
            explanation: obj.meta.explanation || null,
            options: obj.meta.options || canvasCtx.options || [],
          };
        }
        gradeStudentChoice(questionObj, label);
        break;
      }
    }
  });

  // Lắng nghe kết quả chấm từ cử chỉ khoanh tròn đáp án (Task TF28518)
  window.addEventListener('app:show-grade-feedback', (event) => {
    const { gradeResult, question } = event.detail || {};
    if (gradeResult) {
      displayGradeFeedback(gradeResult, question || { number: 1 });
    }
  });
}
