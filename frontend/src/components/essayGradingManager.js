import { $, fabricCanvas, state, setStatus, isDarkBoardActive, withOpaqueBoardExport } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { escapeHtml } from '../utils/escape.js';
import { authFetch } from '../utils/auth_client.js';
import { showAppToast } from '../utils/ui_feedback.js';
import { FabricText, Line, Path, Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

const LINE_CLUSTER_GAP_PX = 24;
let isDirectGradingBusy = false;
let lastEssayResult = null;

function showEssayFloatingPill(summaryText, isError = false) {
  const pill = $('essayBoardFloatingPill');
  const summaryEl = $('essayPillSummary');
  if (!pill || !summaryEl) return;
  summaryEl.textContent = summaryText;
  pill.dataset.state = isError ? 'error' : 'ok';
  pill.hidden = false;
}

function hideEssayFloatingPill() {
  const pill = $('essayBoardFloatingPill');
  if (pill) pill.hidden = true;
}

function cleanupOrphanQuestionBadges() {
  if (!fabricCanvas) return;
  const all = fabricCanvas.getObjects();
  const validGroupIds = new Set(
    all
      .filter((o) => ['question', 'answer_formatted'].includes(o?.meta?.dataRole))
      .map((o) => o.meta.questionGroupId)
      .filter(Boolean)
  );
  const orphans = all.filter(
    (o) => o?.meta?.dataRole === 'question_badge' && !validGroupIds.has(o.meta.linkedGroupId)
  );
  if (orphans.length > 0) {
    fabricCanvas.remove(...orphans);
  }
}

/**
 * Xóa toàn bộ lớp hiển thị kết quả chấm cũ (tích xanh, gạch chân đỏ, nút gợi ý)
 * mà giữ nguyên đề bài và nét viết của học sinh.
 */
export function clearGradingOverlays() {
  if (!fabricCanvas) return;
  const overlays = fabricCanvas
    .getObjects()
    .filter((obj) => obj?.meta?.dataRole === 'grading_overlay');
  if (overlays.length > 0) {
    fabricCanvas.remove(...overlays);
    fabricCanvas.requestRenderAll();
  }
  hideEssayFloatingPill();
}

/**
 * Gom các nét viết tay (Path) thành từng dòng độc lập theo trục dọc Y.
 */
function clusterStrokesIntoLines(strokeObjects) {
  if (!strokeObjects.length) return [];

  const items = strokeObjects
    .map((obj) => ({ obj, bbox: obj.getBoundingRect() }))
    .sort((a, b) => a.bbox.top - b.bbox.top);

  const lines = [];
  for (const item of items) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push({ objects: [item.obj], bbox: { ...item.bbox } });
      continue;
    }

    const lastBottom = lastLine.bbox.top + lastLine.bbox.height;
    const verticalGap = item.bbox.top - lastBottom;

    if (verticalGap <= LINE_CLUSTER_GAP_PX) {
      lastLine.objects.push(item.obj);
      const minLeft = Math.min(lastLine.bbox.left, item.bbox.left);
      const minTop = Math.min(lastLine.bbox.top, item.bbox.top);
      const maxRight = Math.max(
        lastLine.bbox.left + lastLine.bbox.width,
        item.bbox.left + item.bbox.width
      );
      const maxBottom = Math.max(lastBottom, item.bbox.top + item.bbox.height);
      lastLine.bbox = {
        left: minLeft,
        top: minTop,
        width: maxRight - minLeft,
        height: maxBottom - minTop,
      };
    } else {
      lines.push({ objects: [item.obj], bbox: { ...item.bbox } });
    }
  }
  return lines;
}

/**
 * Chụp riêng vùng 1 dòng nét viết tay theo tọa độ World trên Infinite Canvas
 * và gọi /api/v1/recognize để đọc nội dung chính xác ở mọi mức zoom/pan.
 */
async function recognizeLineCluster(lineBbox, subject) {
  const pad = 16;
  const prevBg = fabricCanvas.backgroundColor;
  const prevVpt = (fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
  let imageBase64 = '';

  try {
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.backgroundColor = isDarkBoardActive() ? '#191816' : '#FFFFFF';
    fabricCanvas.renderAll();
    imageBase64 = fabricCanvas.toDataURL({
      format: 'png',
      left: Math.floor(lineBbox.left - pad),
      top: Math.floor(lineBbox.top - pad),
      width: Math.max(24, Math.ceil(lineBbox.width + pad * 2)),
      height: Math.max(24, Math.ceil(lineBbox.height + pad * 2)),
      multiplier: 2,
    });
  } finally {
    fabricCanvas.backgroundColor = prevBg || '';
    fabricCanvas.setViewportTransform(prevVpt);
    fabricCanvas.renderAll();
  }

  const res = await authFetch('/api/v1/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
      room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
      subject: subject || 'TOAN',
      page_number: (state.pageIndex || 0) + 1,
      image_base64: imageBase64,
      provider: 'auto',
    }),
  });

  if (!res.ok) {
    throw new Error(`Lỗi OCR dòng bài làm (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (data?.subject_details?.status === 'error') {
    throw new Error(data.explanation || 'AI tạm thời gián đoạn khi đọc dòng viết tay');
  }
  return String(data.recognized_text || data.latex || '').trim();
}

/**
 * Vẽ dấu tích xanh (✓) hoặc gạch chân đỏ đất + nút gợi ý (✕ Gợi ý) trực tiếp lên dòng bài làm.
 */
function renderOnBoardStepOverlay(stepEval, bbox) {
  const isCorrect = Boolean(stepEval.is_step_correct);
  const isDark = isDarkBoardActive();
  const rightX = bbox.left + bbox.width + 16;
  const centerY = bbox.top + bbox.height / 2 - 12;

  if (isCorrect) {
    const checkObj = new FabricText('✓', {
      left: rightX,
      top: centerY,
      fontSize: 26,
      fontWeight: 'bold',
      fontFamily: 'Be Vietnam Pro, sans-serif',
      fill: isDark ? '#78A87B' : '#3D6940',
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    checkObj.meta = { dataRole: 'grading_overlay', stepNumber: stepEval.step_number };
    fabricCanvas.add(checkObj);
    return;
  }

  const errStroke = isDark ? '#E07A68' : '#9E3B2B';
  const underlineY = bbox.top + bbox.height + 5;
  const redLine = new Line([bbox.left, underlineY, bbox.left + bbox.width, underlineY], {
    stroke: errStroke,
    strokeWidth: 3,
    strokeDashArray: [8, 4],
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  redLine.meta = { dataRole: 'grading_overlay', stepNumber: stepEval.step_number };

  const hintObj = new FabricText(' ✕ Gợi ý ', {
    left: rightX,
    top: centerY + 2,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Be Vietnam Pro, sans-serif',
    fill: '#FAF8F4',
    backgroundColor: '#9E3B2B',
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  hintObj.meta = {
    dataRole: 'grading_overlay',
    isHintTrigger: true,
    stepNumber: stepEval.step_number,
    feedback: stepEval.feedback || '',
    guidance: stepEval.guidance || 'Hãy kiểm tra lại phép biến đổi ở dòng này.',
  };

  fabricCanvas.add(redLine, hintObj);
}

/**
 * Chuyển đổi vai trò của 1 khối đã dán giữa [ĐỀ BÀI] và [BƯỚC GIẢI] khi chạm vào badge.
 */
function toggleQuestionBadgeRole(badgeObj) {
  const linkedId = badgeObj?.meta?.linkedGroupId;
  if (!linkedId) return;

  const targetObj = fabricCanvas
    .getObjects()
    .find(
      (obj) =>
        obj?.meta?.questionGroupId === linkedId &&
        ['question', 'answer_formatted'].includes(obj?.meta?.dataRole)
    );
  if (!targetObj) return;

  const before = snapshot();
  const nextIsQuestion = targetObj.meta.dataRole !== 'question';
  targetObj.meta.dataRole = nextIsQuestion ? 'question' : 'answer_formatted';
  badgeObj.set({
    text: nextIsQuestion ? ' ĐỀ BÀI ' : ' BƯỚC GIẢI ',
    backgroundColor: nextIsQuestion ? '#9C3F23' : '#3D6940',
  });
  fabricCanvas.requestRenderAll();
  remember(before);
  setStatus(
    nextIsQuestion
      ? `Đã đặt "${targetObj.meta.rawLatex}" làm ĐỀ BÀI`
      : `Đã chuyển "${targetObj.meta.rawLatex}" thành BƯỚC GIẢI`
  );
}

/**
 * LUỒNG CHÍNH 1-CLICK: Chấm tự luận trực tiếp trên mặt bảng (hỗ trợ cả khối [ĐỀ BÀI] đã gắn nhãn
 * lẫn bài viết tay tự do nhiều dòng trực tiếp trên bảng).
 */
export async function gradeEssayDirectlyOnBoard() {
  if (!fabricCanvas || state.ended || isDirectGradingBusy) return null;

  const subject = $('subjectSelect')?.value || $('essaySubjectSelect')?.value || 'TOAN';
  cleanupOrphanQuestionBadges();
  clearGradingOverlays();

  const allObjects = fabricCanvas
    .getObjects()
    .filter((obj) => !['grading_overlay', 'question_badge'].includes(obj?.meta?.dataRole));

  const questions = allObjects
    .filter((obj) => obj?.meta?.dataRole === 'question')
    .map((obj) => ({ obj, bbox: obj.getBoundingRect() }))
    .sort((a, b) => a.bbox.top - b.bbox.top);

  const freehandLines =
    questions.length === 0
      ? clusterStrokesIntoLines(allObjects.filter((obj) => obj instanceof Path))
      : [];

  if (questions.length === 0 && freehandLines.length < 2) {
    return { noQuestionOnBoard: true };
  }

  isDirectGradingBusy = true;
  const gradeBtn = $('gradeEssayBtn');
  if (gradeBtn) gradeBtn.disabled = true;
  showEssayFloatingPill('Đang quét & chấm từng dòng trên bảng...', false);
  setStatus('AI đang chấm trực tiếp từng dòng bài làm trên bảng...');

  const before = snapshot();
  let totalCheckedSteps = 0;
  let totalErrors = 0;

  try {
    if (questions.length > 0) {
      for (let i = 0; i < questions.length; i += 1) {
        const q = questions[i];
        const minY = q.bbox.top + q.bbox.height - 6;
        const maxY = i + 1 < questions.length ? questions[i + 1].bbox.top : Infinity;

        const regionObjects = allObjects.filter((obj) => {
          if (obj === q.obj || obj?.meta?.dataRole === 'question') return false;
          const b = obj.getBoundingRect();
          const centerY = b.top + b.height / 2;
          return centerY >= minY && centerY < maxY;
        });

        const formattedSteps = regionObjects
          .filter((obj) => obj?.meta?.dataRole === 'answer_formatted')
          .map((obj) => ({
            writtenText: String(obj.meta.rawLatex || '').trim(),
            bbox: obj.getBoundingRect(),
          }));

        const rawStrokes = regionObjects.filter((obj) => obj instanceof Path);
        const lineClusters = clusterStrokesIntoLines(rawStrokes);
        const ocrSteps = await Promise.all(
          lineClusters.map(async (cluster) => ({
            writtenText: await recognizeLineCluster(cluster.bbox, subject),
            bbox: cluster.bbox,
          }))
        );

        const orderedSteps = [...formattedSteps, ...ocrSteps]
          .filter((s) => s.writtenText.length > 0)
          .sort((a, b) => a.bbox.top - b.bbox.top);

        if (orderedSteps.length === 0) continue;

        const resp = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: q.obj.meta.questionGroupId || `board_q_${i + 1}`,
            question_content: q.obj.meta.rawLatex || '',
            subject,
            steps: orderedSteps.map((s) => s.writtenText),
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.detail || `Lỗi chấm bài (HTTP ${resp.status})`);
        }

        const gradeData = await resp.json();
        const evaluations = Array.isArray(gradeData.steps_evaluation)
          ? gradeData.steps_evaluation
          : [];

        evaluations.forEach((stepEval, idx) => {
          const targetLine = orderedSteps[idx];
          if (targetLine) {
            renderOnBoardStepOverlay(stepEval, targetLine.bbox);
            totalCheckedSteps += 1;
            if (!stepEval.is_step_correct) totalErrors += 1;
          }
        });
      }
    } else {
      // Chấm thẳng từ các dòng viết tay tự do: dòng đầu làm đề bài, các dòng dưới làm bước giải
      const ocrLines = await Promise.all(
        freehandLines.map(async (cluster) => ({
          writtenText: await recognizeLineCluster(cluster.bbox, subject),
          bbox: cluster.bbox,
        }))
      );
      const validLines = ocrLines.filter((l) => l.writtenText.length > 0);
      if (validLines.length >= 2) {
        const problemLine = validLines[0];
        const answerLines = validLines.slice(1);
        const resp = await authFetch('/api/v1/exam/grade-essay-solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: 'board_freehand_q1',
            question_content: problemLine.writtenText,
            subject,
            steps: answerLines.map((s) => s.writtenText),
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.detail || `Lỗi chấm bài (HTTP ${resp.status})`);
        }
        const gradeData = await resp.json();
        const evaluations = Array.isArray(gradeData.steps_evaluation)
          ? gradeData.steps_evaluation
          : [];
        evaluations.forEach((stepEval, idx) => {
          const targetLine = answerLines[idx];
          if (targetLine) {
            renderOnBoardStepOverlay(stepEval, targetLine.bbox);
            totalCheckedSteps += 1;
            if (!stepEval.is_step_correct) totalErrors += 1;
          }
        });
      }
    }

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);

    if (totalCheckedSteps === 0) {
      showEssayFloatingPill('Chưa thấy dòng bài làm nào bên dưới đề bài.', true);
      setStatus('Chưa phát hiện dòng bài làm nào bên dưới khối ĐỀ BÀI.');
    } else if (totalErrors === 0) {
      showEssayFloatingPill(`✓ Đúng hoàn toàn ${totalCheckedSteps}/${totalCheckedSteps} bước trên bảng!`, false);
      setStatus(`✓ Đã chấm trực tiếp ${totalCheckedSteps} bước trên bảng: Đúng hoàn toàn!`);
    } else {
      showEssayFloatingPill(
        `Chấm xong ${totalCheckedSteps} bước: ${totalErrors} dòng cần sửa (chạm ✕ Gợi ý để xem)`,
        true
      );
      setStatus(`Đã chấm ${totalCheckedSteps} bước: phát hiện ${totalErrors} dòng cần sửa.`);
    }

    return { totalCheckedSteps, totalErrors };
  } catch (err) {
    showEssayFloatingPill(`Lỗi chấm trên bảng: ${err.message}`, true);
    setStatus(`Lỗi chấm tự luận trên bảng: ${err.message}`);
    return null;
  } finally {
    isDirectGradingBusy = false;
    if (gradeBtn) gradeBtn.disabled = false;
  }
}

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
        const imageBase64 = withOpaqueBoardExport(() =>
          fabricCanvas.toDataURL({ format: 'png', multiplier: 1.5 })
        );
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
        scanCanvasForEssayBtn.textContent = 'Quét từ bảng vẽ';
      }
    });
  }

  // 1-click thông minh: Có khối [ĐỀ BÀI] hoặc >= 2 dòng viết tay trên bảng -> chấm thẳng trên bảng; ngược lại -> mở khung nhập tay
  if (gradeEssayBtn) {
    gradeEssayBtn.addEventListener('click', async () => {
      if (state.ended) return;
      cleanupOrphanQuestionBadges();
      const objs = fabricCanvas.getObjects();
      const hasTaggedQuestion = objs.some((obj) => obj?.meta?.dataRole === 'question');
      const freehandLinesCount = hasTaggedQuestion
        ? 0
        : clusterStrokesIntoLines(objs.filter((obj) => obj instanceof Path)).length;

      if (hasTaggedQuestion || freehandLinesCount >= 2) {
        const res = await gradeEssayDirectlyOnBoard();
        if (res?.noQuestionOnBoard) {
          showStatus('');
          essayGradingDialog.showModal();
        }
      } else {
        showStatus('');
        essayGradingDialog.showModal();
      }
    });
  }

  // Các nút điều khiển trên thanh nổi #essayBoardFloatingPill
  $('essayPillClearOverlayBtn')?.addEventListener('click', () => {
    clearGradingOverlays();
    setStatus('Đã ẩn dấu chấm trên bảng');
  });

  $('essayPillOpenDialogBtn')?.addEventListener('click', () => {
    showStatus('');
    essayGradingDialog.showModal();
  });

  $('essayPillCloseBtn')?.addEventListener('click', () => {
    hideEssayFloatingPill();
  });

  // Hit-test thủ công khi chạm ngắn (tương thích skipTargetFind: true & Infinite Canvas)
  let tapStart = null;
  fabricCanvas.on('mouse:down', (e) => {
    if (!e?.e) return;
    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (pt) tapStart = { x: pt.x, y: pt.y, t: performance.now() };
  });

  fabricCanvas.on('mouse:up', (e) => {
    if (!tapStart || !e?.e) {
      tapStart = null;
      return;
    }
    const start = tapStart;
    tapStart = null;
    const pt = typeof fabricCanvas.getScenePoint === 'function'
      ? fabricCanvas.getScenePoint(e.e)
      : (e.scenePoint || null);
    if (!pt) return;

    if (performance.now() - start.t > 350 || Math.hypot(pt.x - start.x, pt.y - start.y) > 10) {
      return;
    }

    const objects = fabricCanvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i];
      const role = obj?.meta?.dataRole;
      if (role !== 'question_badge' && !obj?.meta?.isHintTrigger) continue;

      const b = obj.getBoundingRect();
      if (pt.x >= b.left - 8 && pt.x <= b.left + b.width + 8 && pt.y >= b.top - 8 && pt.y <= b.top + b.height + 8) {
        if (role === 'question_badge') {
          toggleQuestionBadgeRole(obj);
        } else if (obj.meta.isHintTrigger) {
          setStatus(`Gợi ý dòng ${obj.meta.stepNumber}: ${obj.meta.guidance}`);
          showAppToast({
            title: `Gợi ý sửa dòng ${obj.meta.stepNumber}`,
            message: `${obj.meta.feedback ? `${obj.meta.feedback} — ` : ''}${obj.meta.guidance}`,
            variant: 'warning',
            durationMs: 6500,
          });
        }
        break;
      }
    }
  });

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
    const isDark = isDarkBoardActive();
    const startX = 60;
    let startY = 148;

    // Tiêu đề khối bài giải
    const headerTitle = new TextboxClass('BÀI GIẢI TỰ LUẬN (AI ĐÁNH DẤU TỪNG BƯỚC)', {
      left: startX,
      top: startY,
      fontSize: 16,
      fontWeight: 'bold',
      fill: isDark ? '#ECE7DF' : '#26231F',
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
