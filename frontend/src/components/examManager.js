import { $, fabricCanvas, state, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { FabricText, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

let currentExamData = null;

export function setupExamManager() {
  const examModal = $('examModal');
  const examUploadBtn = $('examUploadBtn');
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

  if (!examModal || !examUploadBtn) return;

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

  // Mở modal
  examUploadBtn.addEventListener('click', () => {
    if (state.ended) return;
    showStatus('');
    examModal.showModal();
  });

  // Đóng modal
  const closeModal = () => examModal.close();
  if (closeExamModalBtn) closeExamModalBtn.addEventListener('click', closeModal);
  if (closeExamModalXBtn) closeExamModalXBtn.addEventListener('click', closeModal);

  // Chuyển Tab
  examTabFile.addEventListener('click', () => {
    examTabFile.classList.add('is-active');
    examTabFile.setAttribute('aria-selected', 'true');
    examTabText.classList.remove('is-active');
    examTabText.setAttribute('aria-selected', 'false');
    examFilePanel.hidden = false;
    examTextPanel.hidden = true;
    showStatus('');
  });

  examTabText.addEventListener('click', () => {
    examTabText.classList.add('is-active');
    examTabText.setAttribute('aria-selected', 'true');
    examTabFile.classList.remove('is-active');
    examTabFile.setAttribute('aria-selected', 'false');
    examTextPanel.hidden = false;
    examFilePanel.hidden = true;
    showStatus('');
  });

  // Chọn file & Kéo thả
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

  // Phân tích văn bản trực tiếp
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

  // Thay đổi mode (Học sinh / Giáo viên)
  document.querySelectorAll('input[name="examMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (currentExamData) {
        // Tự động re-render theo mode mới
        if (getSelectedMode() === 'STUDENT') {
          // Ẩn đáp án
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
          // Bật lại chế độ Giáo viên (nếu có dữ liệu gốc)
          renderExamPreview(currentExamData);
        }
      }
    });
  });

  // Render danh sách preview câu hỏi
  function renderExamPreview(data) {
    currentExamData = data;
    examPreviewSection.hidden = false;
    layoutToBoardBtn.disabled = false;
    questionCount.textContent = data.total_questions;

    const isStudent = data.mode === 'STUDENT';
    if (isStudent) {
      previewSecurityBadge.className = 'preview-badge badge-student';
      previewSecurityBadge.textContent = '🛡️ Chế độ Học sinh: Đáp án đúng & lời giải đã được ẩn an toàn';
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
                <div class="exam-q-opt ${isCorrect ? 'opt-correct' : ''}">
                  <span class="opt-badge">${opt.label}</span>
                  <span class="opt-text">${opt.content}</span>
                  ${isCorrect ? '<span class="opt-correct-tag">✓ Đáp án đúng</span>' : ''}
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

    // Chèn các objects của trang đầu tiên vào bảng hiện tại
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
      fabricCanvas.add(tb);
    });

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
  }
}
