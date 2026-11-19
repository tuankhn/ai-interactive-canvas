import { $, fabricCanvas, state, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { FabricText, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

let currentExamData = null;

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

  // Đóng modal tải đề
  const closeModal = () => examModal.close();
  if (closeExamModalBtn) closeExamModalBtn.addEventListener('click', closeModal);
  if (closeExamModalXBtn) closeExamModalXBtn.addEventListener('click', closeModal);

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
        const res = await fetch(`/api/v1/exam/sample?subject=${subject}&mode=${getSelectedMode()}`);
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
        const res = await fetch(`/api/v1/exam/upload?mode=${mode}`, {
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
        const res = await fetch('/api/v1/exam/parse-text', {
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
      if (currentExamData) {
        if (getSelectedMode() === 'STUDENT') {
          const masked = JSON.parse(JSON.stringify(currentExamData));
          masked.mode = 'STUDENT';
          masked.hidden_answers = true;
          masked.questions.forEach((q) => {
            q.correct_option = null;
            q.explanation = null;
            q.options.forEach((opt) => (opt.is_correct = false));
          });
          renderExamPreview(masked);
        } else {
          renderExamPreview(currentExamData);
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
        correct_label: question.correct_option || 'A',
        explanation: question.explanation || 'Phương án chính xác theo định luật bài toán.',
        question_content: question.content,
        subject: subject,
      };

      const res = await fetch('/api/v1/exam/grade-mcq', {
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
  function renderExamPreview(data) {
    currentExamData = data;
    window.dispatchEvent(new CustomEvent('app:exam-loaded', { detail: data }));
    examPreviewSection.hidden = false;
    layoutToBoardBtn.disabled = false;
    questionCount.textContent = data.total_questions;

    const isStudent = data.mode === 'STUDENT';
    if (isStudent) {
      previewSecurityBadge.className = 'preview-badge badge-student';
      previewSecurityBadge.textContent = '🛡️ Chế độ Học sinh: Đáp án đúng & lời giải đã được ẩn an toàn. Nhấp phương án để làm bài!';
    } else {
      previewSecurityBadge.className = 'preview-badge badge-teacher';
      previewSecurityBadge.textContent = '🎓 Chế độ Giáo viên: Hiển thị đầy đủ đáp án đúng & hướng dẫn giải';
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
                return `
                <div class="exam-q-opt ${isCorrect ? 'opt-correct' : ''} ${isStudent ? 'opt-clickable' : ''}" data-label="${opt.label}">
                  <span class="opt-badge">${opt.label}</span>
                  <span class="opt-text">${opt.content}</span>
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
            <strong>💡 Hướng dẫn giải:</strong> ${q.explanation}
          </div>
        `;
      }

      qCard.innerHTML = `
        <div class="exam-q-header">
          <strong>Câu ${q.number}:</strong> ${q.content}
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

  // Dàn câu hỏi lên mặt bảng vẽ
  layoutToBoardBtn.addEventListener('click', async () => {
    if (!currentExamData || !currentExamData.questions || currentExamData.questions.length === 0) {
      showStatus('Không có câu hỏi nào để dàn lên bảng', true);
      return;
    }

    const mode = getSelectedMode();
    layoutToBoardBtn.disabled = true;
    layoutToBoardBtn.textContent = 'Đang dàn lên bảng...';

    try {
      const res = await fetch('/api/v1/exam/layout-canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: currentExamData.questions,
          mode: mode,
          questions_per_page: 2,
        }),
      });

      if (!res.ok) throw new Error('Không thể tạo layout bảng');
      const layoutData = await res.json();

      applyExamLayoutToCanvas(layoutData);
      examModal.close();
      setStatus(`Đã dàn thành công ${currentExamData.total_questions} câu hỏi lên bảng (${layoutData.total_pages} trang)!`);
    } catch (err) {
      showStatus(err.message, true);
    } finally {
      layoutToBoardBtn.disabled = false;
      layoutToBoardBtn.textContent = 'Dàn lên mặt bảng vẽ';
    }
  });

  // Chuyển layout sang đối tượng Fabric.js trên bảng vẽ
  function applyExamLayoutToCanvas(layoutData) {
    const before = snapshot();
    const firstPage = layoutData.pages[0];
    if (!firstPage) return;

    firstPage.objects.forEach((item) => {
      const TextboxClass = Textbox || FabricText;
      const tb = new TextboxClass(item.text, {
        left: item.left,
        top: item.top,
        fontSize: item.fontSize || 16,
        fontWeight: item.fontWeight || 'normal',
        fontStyle: item.fontStyle || 'normal',
        fill: item.fill || '#172554',
        width: item.width || 800,
        selectable: item.selectable !== false,
        lineHeight: item.lineHeight || 1.2,
      });

      // Lưu metadata để khi học sinh chọn trên canvas có thể chấm trắc nghiệm
      if (item.meta) {
        tb.meta = item.meta;
      }
      fabricCanvas.add(tb);
    });

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
  }

  // Lắng nghe sự kiện click đối tượng trên bảng Fabric.js
  fabricCanvas.on('mouse:down', (e) => {
    if (e.target && e.target.meta && e.target.meta.type === 'answer_option') {
      const meta = e.target.meta;
      const questionId = meta.question_id;
      const label = meta.label;

      let questionObj = null;
      if (currentExamData && currentExamData.questions) {
        questionObj = currentExamData.questions.find((q) => q.id === questionId) || currentExamData.questions[0];
      }

      if (questionObj) {
        gradeStudentChoice(questionObj, label);
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
