import { $, fabricCanvas, state, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { FabricText, Line, Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

let lastEssayResult = null;

const ESSAY_SAMPLES = {
  SAMPLE_HANG_DANG_THUC: [
    'Bước 1: Khai triển biểu thức (x + 2)^2',
    'Bước 2: (x + 2)^2 = x^2 + 4',
    'Bước 3: Thu gọn các số hạng đồng dạng',
  ].join('\n'),

  SAMPLE_CHUYEN_VE: [
    'Bước 1: Phương trình 2x - 6 = 0',
    'Bước 2: 2x = -6',
    'Bước 3: x = -3',
  ].join('\n'),

  SAMPLE_DAO_HAM: [
    'Bước 1: Cho hàm số y = sin(x) + 2x',
    "Bước 2: y' = (sin x)' = -cos x",
    'Bước 3: Kết luận hệ số góc tiếp tuyến',
  ].join('\n'),

  SAMPLE_HOAN_HAO: [
    'Bước 1: Xét phương trình 3x - 9 = 0',
    'Bước 2: Chuyển vế số hạng tự do: 3x = 9',
    'Bước 3: Chia cả hai vế cho 3: x = 3',
  ].join('\n'),
};

export function setupEssayGradingManager() {
  const gradeEssayBtn = $('gradeEssayBtn');
  const essayGradingDialog = $('essayGradingDialog');
  const closeEssayDialogBtn = $('closeEssayDialogBtn');
  const closeEssayDialogXBtn = $('closeEssayDialogXBtn');

  const essaySubjectSelect = $('essaySubjectSelect');
  const essayInputLines = $('essayInputLines');
  const evaluateEssayStepsBtn = $('evaluateEssayStepsBtn');
  const annotateEssayToCanvasBtn = $('annotateEssayToCanvasBtn');
  const scanCanvasForEssayBtn = $('scanCanvasForEssayBtn');

  const essayResultSection = $('essayResultSection');
  const metricTotalSteps = $('metricTotalSteps');
  const metricCorrectSteps = $('metricCorrectSteps');
  const metricWrongSteps = $('metricWrongSteps');
  const metricScore = $('metricScore');
  const essayOverallFeedback = $('essayOverallFeedback');
  const essayStepsList = $('essayStepsList');
  const essayDialogStatus = $('essayDialogStatus');

  if (!essayGradingDialog) return;

  function showStatus(text, isError = false) {
    if (!essayDialogStatus) return;
    essayDialogStatus.textContent = text;
    essayDialogStatus.hidden = !text;
    essayDialogStatus.style.color = isError ? '#dc2626' : '#16a34a';
  }

  // Quét trực tiếp nét vẽ từ Canvas vào bài giải tự luận
  if (scanCanvasForEssayBtn) {
    scanCanvasForEssayBtn.addEventListener('click', async () => {
      if (!fabricCanvas || fabricCanvas.getObjects().length === 0) {
        showStatus('Mặt bảng vẽ hiện đang trống. Hãy viết đề bài và các bước giải lên bảng trước!', true);
        return;
      }

      scanCanvasForEssayBtn.disabled = true;
      scanCanvasForEssayBtn.textContent = 'Đang quét nét vẽ...';
      showStatus('AI đang quét và bóc tách các dòng viết tay trên bảng vẽ...');

      try {
        const imageBase64 = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
        const currentSubject = essaySubjectSelect ? essaySubjectSelect.value : (state.subject || 'TOAN');

        const res = await authFetch('/api/v1/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId || 'session-10a1',
            room_id: state.roomId || 'room-10a1',
            subject: currentSubject,
            image_base64: imageBase64,
            provider: 'auto',
          }),
        });

        if (!res.ok) {
          throw new Error('Không thể nhận diện nét vẽ từ bảng');
        }

        const data = await res.json();
        const recognizedText = data.recognized_text || data.latex || '';
        if (!recognizedText.trim()) {
          showStatus('Không phát hiện nét chữ nào rõ ràng trên bảng vẽ.', true);
          return;
        }

        // Tự động phân tách dòng đề bài và các dòng bước giải
        const rawLines = recognizedText.split('\n').map((l) => l.trim()).filter(Boolean);
        let formattedSteps = [];
        if (rawLines.length === 1) {
          formattedSteps = [rawLines[0]];
        } else {
          rawLines.forEach((line, idx) => {
            if (/^(?:bước|buoc|step|\d+[\.:\)])/i.test(line)) {
              formattedSteps.push(line);
            } else if (idx === 0) {
              formattedSteps.push(`Đề bài: ${line}`);
            } else {
              formattedSteps.push(`Bước ${idx}: ${line}`);
            }
          });
        }

        if (essayInputLines) {
          essayInputLines.value = formattedSteps.join('\n');
        }

        showStatus(`Đã quét thành công ${formattedSteps.length} dòng từ bảng! Đang kích hoạt AI chấm...`);
        if (evaluateEssayStepsBtn) {
          evaluateEssayStepsBtn.click();
        }
      } catch (err) {
        showStatus(`Lỗi khi quét bảng vẽ: ${err.message}`, true);
      } finally {
        scanCanvasForEssayBtn.disabled = false;
        scanCanvasForEssayBtn.textContent = '📷 Quét từ bảng vẽ Canvas';
      }
    });
  }

  // Mở modal
  if (gradeEssayBtn) {
    gradeEssayBtn.addEventListener('click', () => {
      if (state.ended) return;
      showStatus('');
      essayGradingDialog.showModal();
    });
  }

  // Đóng modal
  const closeModal = () => essayGradingDialog.close();
  if (closeEssayDialogBtn) closeEssayDialogBtn.addEventListener('click', closeModal);
  if (closeEssayDialogXBtn) closeEssayDialogXBtn.addEventListener('click', closeModal);

  // Chèn mẫu thử nhanh
  document.querySelectorAll('.essay-sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sampleKey = btn.dataset.sample;
      if (ESSAY_SAMPLES[sampleKey] && essayInputLines) {
        essayInputLines.value = ESSAY_SAMPLES[sampleKey];
        showStatus('Đã chèn bài giải mẫu. Bấm "Chấm từng dòng bằng AI" để kiểm tra.');
      }
    });
  });

  // Chấm bài giải bằng AI
  if (evaluateEssayStepsBtn) {
    evaluateEssayStepsBtn.addEventListener('click', async () => {
      const text = essayInputLines ? essayInputLines.value.trim() : '';
      if (!text) {
        showStatus('Vui lòng nhập các bước giải tự luận (mỗi dòng một bước)', true);
        return;
      }

      const subject = essaySubjectSelect ? essaySubjectSelect.value : 'TOAN';
      evaluateEssayStepsBtn.disabled = true;
      evaluateEssayStepsBtn.textContent = 'Đang phân tích từng dòng...';
      showStatus('AI đang đọc từng dòng viết tay và kiểm tra công thức...');

      try {
        const res = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: 'essay_direct',
            raw_text: text,
            subject: subject,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Lỗi khi chấm bài giải tự luận');
        }

        const data = await res.json();
        lastEssayResult = data;
        renderEssayResult(data);
        showStatus(
          data.has_any_error
            ? `Đã phân tích xong: Phát hiện ${data.incorrect_steps} bước cần xem lại (đã gạch chân đỏ).`
            : 'Xuất sắc! Toàn bộ các bước giải đều đúng (đã đánh dấu tích xanh).'
        );
        if (annotateEssayToCanvasBtn) annotateEssayToCanvasBtn.disabled = false;
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        evaluateEssayStepsBtn.disabled = false;
        evaluateEssayStepsBtn.textContent = 'Chấm từng dòng bằng AI';
      }
    });
  }

  // Render kết quả phân tích từng bước
  function renderEssayResult(data) {
    if (!essayResultSection) return;
    essayResultSection.hidden = false;

    if (metricTotalSteps) metricTotalSteps.textContent = data.total_steps;
    if (metricCorrectSteps) metricCorrectSteps.textContent = data.correct_steps;
    if (metricWrongSteps) metricWrongSteps.textContent = data.incorrect_steps;
    if (metricScore) metricScore.textContent = `${data.score} / 10`;
    if (essayOverallFeedback) essayOverallFeedback.textContent = data.overall_feedback;

    if (essayStepsList) {
      essayStepsList.innerHTML = '';
      data.steps_evaluation.forEach((step) => {
        const stepCard = document.createElement('div');
        stepCard.className = `essay-step-card ${step.is_step_correct ? 'step-card-correct' : 'step-card-wrong'}`;

        const isCorrect = step.is_step_correct;
        const iconBadge = isCorrect
          ? '<span class="step-badge badge-green-check">✓ Bước đúng</span>'
          : '<span class="step-badge badge-red-underline">✕ Dòng sai / Nhầm công thức</span>';

        const lineClass = isCorrect ? 'step-text-correct' : 'step-text-red-underline';

        let guidanceBlock = '';
        if (!isCorrect && step.guidance) {
          guidanceBlock = `
            <div class="step-guidance-box">
              <span class="guidance-icon">💡</span>
              <div class="guidance-content">
                <strong>Gợi ý sửa (không lộ đáp án):</strong>
                <p>${escapeHtml(step.guidance)}</p>
              </div>
            </div>
          `;
        }

        stepCard.innerHTML = `
          <div class="step-header-row">
            <span class="step-num">Dòng ${escapeHtml(step.step_number)}</span>
            ${iconBadge}
          </div>
          <div class="step-line-content ${lineClass}">
            <code>${escapeHtml(step.written_text)}</code>
          </div>
          <div class="step-feedback-note">
            ${escapeHtml(step.feedback)}
          </div>
          ${guidanceBlock}
        `;

        essayStepsList.appendChild(stepCard);
      });
    }
  }

  // Đánh dấu trực tiếp lên bảng vẽ Fabric.js
  if (annotateEssayToCanvasBtn) {
    annotateEssayToCanvasBtn.addEventListener('click', () => {
      if (!lastEssayResult || !lastEssayResult.steps_evaluation) {
        showStatus('Chưa có kết quả chấm để đưa lên bảng', true);
        return;
      }

      annotateToCanvas(lastEssayResult);
      essayGradingDialog.close();
      setStatus(
        `Đã đánh dấu ${lastEssayResult.total_steps} bước giải lên bảng (Tích xanh ✓ & Gạch chân đỏ ✕)!`
      );
    });
  }

  // Vẽ các annotations lên canvas Fabric.js
  function annotateToCanvas(result) {
    const before = snapshot();
    const TextboxClass = Textbox || FabricText;
    const startX = 60;
    let startY = 60;

    // Tiêu đề khối bài giải
    const headerTitle = new TextboxClass('BÀI GIẢI TỰ LUẬN (AI ĐÁNH DẤU TỪNG BƯỚC)', {
      left: startX,
      top: startY,
      fontSize: 16,
      fontWeight: 'bold',
      fill: '#1e293b',
      width: 800,
      selectable: false,
    });
    fabricCanvas.add(headerTitle);
    startY += 35;

    result.steps_evaluation.forEach((step) => {
      const isCorrect = step.is_step_correct;
      const lineText = `Bước ${step.step_number}: ${step.written_text}`;

      // 1. Textbox nội dung bước giải
      const stepTb = new TextboxClass(lineText, {
        left: startX + 30,
        top: startY,
        fontSize: 17,
        fontWeight: isCorrect ? 'normal' : '600',
        fill: isCorrect ? '#0f172a' : '#b91c1c',
        width: 750,
        selectable: true,
      });
      fabricCanvas.add(stepTb);

      // 2. Icon đánh dấu cạnh bước
      const iconText = isCorrect ? '✓' : '✕';
      const iconColor = isCorrect ? '#16a34a' : '#dc2626';
      const iconObj = new TextboxClass(iconText, {
        left: startX,
        top: startY - 2,
        fontSize: 20,
        fontWeight: 'bold',
        fill: iconColor,
        width: 30,
        selectable: false,
      });
      fabricCanvas.add(iconObj);

      // 3. Nếu dòng SAI hoặc NHẦM CÔNG THỨC: Vẽ đường GẠCH CHÂN ĐỎ ngay dưới dòng!
      if (!isCorrect) {
        const estimatedWidth = Math.min(650, Math.max(180, lineText.length * 10));
        const underline = new Line(
          [startX + 30, startY + 24, startX + 30 + estimatedWidth, startY + 24],
          {
            stroke: '#dc2626',
            strokeWidth: 2.5,
            strokeDashArray: [6, 3],
            selectable: false,
          }
        );
        fabricCanvas.add(underline);

        // Thêm sticker gợi ý sửa ngay dưới dòng gạch chân
        if (step.guidance) {
          const hintBox = new TextboxClass(step.guidance, {
            left: startX + 40,
            top: startY + 30,
            fontSize: 13,
            fontStyle: 'italic',
            fill: '#991b1b',
            backgroundColor: '#fee2e2',
            padding: 6,
            width: 700,
            selectable: true,
          });
          fabricCanvas.add(hintBox);
          startY += 28;
        }
      }

      startY += 38;
    });

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
  }
}
