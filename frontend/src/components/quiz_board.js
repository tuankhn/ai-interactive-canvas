import { $, fabricCanvas, state, setStatus } from '../utils/context.js';
import { snapshot, remember, updateHint } from './history.js';
import { authFetch } from '../utils/auth_client.js';
import { Circle, FabricText, Rect, Textbox } from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/+esm';

const CIRCLE_ANSWER_ENDPOINT = '/api/v1/exam/circle-answer';

const quizState = {
  questions: [],
  currentIndex: 0,
  subject: 'TOAN',
  mode: 'STUDENT',
  busy: false,
  lastSubmission: null,
};

/**
 * Tính hộp bao tọa độ (bounding box) và độ dài đường đi từ danh sách điểm nét bút.
 */
export function computeBoundingBoxFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0, pathLength: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let pathLength = 0;

  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
    if (i > 0) {
      pathLength += Math.hypot(pt.x - points[i - 1].x, pt.y - points[i - 1].y);
    }
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
    pathLength,
  };
}

/**
 * Kiểm tra nét vẽ tay hoặc công cụ hình tròn/elip có phải thao tác khoanh tròn đáp án hay không.
 */
export function detectCircleSelectionGesture(points, strokeBbox = null, tool = 'pen') {
  const computed = computeBoundingBoxFromPoints(points);
  const bbox = strokeBbox
    ? {
        x: strokeBbox.left ?? strokeBbox.x ?? computed.x,
        y: strokeBbox.top ?? strokeBbox.y ?? computed.y,
        width: strokeBbox.width ?? computed.width,
        height: strokeBbox.height ?? computed.height,
      }
    : { x: computed.x, y: computed.y, width: computed.width, height: computed.height };

  if (bbox.width < 14 || bbox.height < 14 || bbox.width > 460 || bbox.height > 280) {
    return { isCircle: false, circularityScore: 0, bbox };
  }

  if (tool === 'circle' || tool === 'ellipse') {
    return { isCircle: true, circularityScore: 0.96, bbox };
  }

  if (!Array.isArray(points) || points.length < 8) {
    return { isCircle: false, circularityScore: 0, bbox };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const diag = Math.hypot(bbox.width, bbox.height);
  const endGap = Math.hypot(last.x - first.x, last.y - first.y);
  if (diag <= 0 || endGap > diag * 0.72) {
    return { isCircle: false, circularityScore: 0, bbox };
  }

  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  let totalAngleSweep = 0;
  let prevAngle = Math.atan2(points[0].y - cy, points[0].x - cx);

  for (let i = 1; i < points.length; i += 1) {
    const angle = Math.atan2(points[i].y - cy, points[i].x - cx);
    let delta = angle - prevAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    totalAngleSweep += delta;
    prevAngle = angle;
  }

  const absSweep = Math.abs(totalAngleSweep);
  if (absSweep < 3.6) {
    return { isCircle: false, circularityScore: 0, bbox };
  }

  const closureScore = Math.max(0, 1 - endGap / (diag * 0.75));
  const sweepScore = Math.min(1, absSweep / (2 * Math.PI));
  const circularityScore = Number((0.55 * sweepScore + 0.45 * closureScore).toFixed(3));
  return { isCircle: true, circularityScore, bbox };
}

/**
 * Thu thập tọa độ vùng đáp án A, B, C, D đang hiển thị trên Fabric Canvas.
 */
export function findOptionTargetsOnCanvas(canvas) {
  if (!canvas || typeof canvas.getObjects !== 'function') return [];

  const grouped = new Map();
  for (const obj of canvas.getObjects()) {
    const meta = obj?.meta;
    if (!meta || (meta.type !== 'quiz_option_target' && meta.type !== 'answer_option')) {
      continue;
    }
    const label = String(meta.label || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(label)) continue;

    const rect = obj.getBoundingRect ? obj.getBoundingRect() : null;
    if (!rect) continue;

    const key = `${meta.question_id || 'q'}:${label}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        label,
        questionId: meta.question_id || 'q_board',
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        badgeX: meta.badgeX ?? rect.left,
        badgeY: meta.badgeY ?? rect.top,
        targetObject: obj,
      });
    } else {
      const minX = Math.min(existing.x, rect.left);
      const minY = Math.min(existing.y, rect.top);
      const maxX = Math.max(existing.x + existing.width, rect.left + rect.width);
      const maxY = Math.max(existing.y + existing.height, rect.top + rect.height);
      existing.x = minX;
      existing.y = minY;
      existing.width = maxX - minX;
      existing.height = maxY - minY;
    }
  }
  return Array.from(grouped.values());
}

/**
 * Đối chiếu hình học giữa vùng tọa độ nét khoanh với vùng đáp án A, B, C, D trên mặt bảng.
 */
export function matchCircleToQuizOption(strokeBbox, optionTargets) {
  if (!strokeBbox || !Array.isArray(optionTargets) || optionTargets.length === 0) {
    return null;
  }

  const sx1 = strokeBbox.x;
  const sy1 = strokeBbox.y;
  const sx2 = strokeBbox.x + Math.max(1, strokeBbox.width);
  const sy2 = strokeBbox.y + Math.max(1, strokeBbox.height);
  const scx = (sx1 + sx2) / 2;
  const scy = (sy1 + sy2) / 2;
  const strokeArea = Math.max(1, (sx2 - sx1) * (sy2 - sy1));

  let best = null;
  let bestScore = -1;

  for (const target of optionTargets) {
    const rx1 = target.x;
    const ry1 = target.y;
    const rx2 = target.x + Math.max(1, target.width);
    const ry2 = target.y + Math.max(1, target.height);
    const targetArea = Math.max(1, (rx2 - rx1) * (ry2 - ry1));

    const ix1 = Math.max(sx1, rx1);
    const iy1 = Math.max(sy1, ry1);
    const ix2 = Math.min(sx2, rx2);
    const iy2 = Math.min(sy2, ry2);
    const interArea = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);

    const containment = interArea / strokeArea;
    const iou = interArea / Math.max(1, strokeArea + targetArea - interArea);
    const yInside = scy >= ry1 - 10 && scy <= ry2 + 10 ? 1 : 0;
    const xNear = sx2 >= rx1 - 18 && sx1 <= rx2 + 18 ? 1 : 0;
    const score = 0.65 * containment + 0.2 * iou + 0.15 * yInside * xNear;

    if (score > bestScore) {
      bestScore = score;
      best = { target, score: Number(Math.min(1, score).toFixed(3)) };
    }
  }

  if (best && best.score > 0.08) {
    return best;
  }
  return null;
}

export function setupQuizBoard() {
  const toggleBtn = $('quizBoardToggleBtn');
  const panel = $('quizBoardPanel');
  if (!panel) return;

  if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
    import('https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js').catch(() => {});
  }

  const closeBtn = $('closeQuizBoardBtn');
  const subjectSelect = $('quizBoardSubjectSelect');
  const loadSampleBtn = $('quizLoadSampleBtn');
  const prevBtn = $('quizPrevQuestionBtn');
  const nextBtn = $('quizNextQuestionBtn');
  const counterEl = $('quizQuestionCounter');
  const clearCanvasBtn = $('quizClearCardBtn');
  const statusEl = $('quizBoardStatus');

  function setQuizPanelStatus(msg, variant = 'info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.variant = variant;
  }

  function updateQuizControls() {
    const total = quizState.questions.length;
    if (counterEl) {
      counterEl.textContent = total > 0 ? `Câu ${quizState.currentIndex + 1} / ${total}` : 'Chưa có câu hỏi';
    }
    if (prevBtn) prevBtn.disabled = total <= 1 || quizState.currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = total <= 1 || quizState.currentIndex >= total - 1;
    if (clearCanvasBtn) clearCanvasBtn.disabled = total === 0;
  }

  function clearManagedQuizObjects() {
    const toRemove = fabricCanvas.getObjects().filter((obj) => obj?.meta?.quizCardManaged);
    if (toRemove.length > 0) {
      fabricCanvas.remove(...toRemove);
    }
  }

  function renderQuizQuestionOnCanvas(question, index, total) {
    if (!question) return;
    const before = snapshot();
    clearManagedQuizObjects();

    const startX = 48;
    const startY = 36;
    const cardWidth = Math.min(820, Math.max(460, fabricCanvas.getWidth() - 96));

    const header = new Textbox(
      `[Trắc nghiệm ${index + 1}/${total}] ${question.content || ''}`,
      {
        left: startX,
        top: startY,
        width: cardWidth,
        fontSize: 19,
        fontWeight: 'bold',
        fill: fabricCanvas.backgroundColor === '#111827' ? '#f8fafc' : '#172554',
        selectable: false,
        evented: false,
        lineHeight: 1.3,
      }
    );
    header.meta = { quizCardManaged: true, question_id: question.id, type: 'quiz_header' };
    fabricCanvas.add(header);

    const headerRect = header.getBoundingRect();
    let optionTop = startY + Math.max(48, (headerRect?.height || 40) + 18);

    const options = Array.isArray(question.options) ? question.options : [];
    const inkColor = fabricCanvas.backgroundColor === '#111827' ? '#e2e8f0' : '#1e293b';
    const cardBg = fabricCanvas.backgroundColor === '#111827' ? 'rgba(30, 41, 59, 0.85)' : '#f8fafc';
    const cardStroke = fabricCanvas.backgroundColor === '#111827' ? '#475569' : '#cbd5e1';

    for (const opt of options) {
      const label = String(opt.label || 'A').toUpperCase();
      const rowHeight = 46;

      const rowBox = new Rect({
        left: startX,
        top: optionTop,
        width: cardWidth,
        height: rowHeight,
        rx: 10,
        ry: 10,
        fill: cardBg,
        stroke: cardStroke,
        strokeWidth: 1.5,
        selectable: false,
        evented: false,
      });
      rowBox.meta = {
        quizCardManaged: true,
        type: 'quiz_option_target',
        question_id: question.id,
        label,
        badgeX: startX + 26,
        badgeY: optionTop + rowHeight / 2,
      };
      fabricCanvas.add(rowBox);

      const circleBadge = new Circle({
        left: startX + 12,
        top: optionTop + 8,
        radius: 15,
        fill: '#ffffff',
        stroke: '#222f71',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      circleBadge.meta = {
        quizCardManaged: true,
        type: 'quiz_option_target',
        question_id: question.id,
        label,
      };
      fabricCanvas.add(circleBadge);

      const letterText = new FabricText(label, {
        left: startX + 21,
        top: optionTop + 14,
        fontSize: 16,
        fontWeight: 'bold',
        fill: '#222f71',
        selectable: false,
        evented: false,
      });
      letterText.meta = { quizCardManaged: true, type: 'quiz_option_letter', label };
      fabricCanvas.add(letterText);

      const optionBody = new Textbox(opt.content || '', {
        left: startX + 54,
        top: optionTop + 13,
        width: cardWidth - 70,
        fontSize: 16,
        fill: inkColor,
        selectable: false,
        evented: false,
      });
      optionBody.meta = {
        quizCardManaged: true,
        type: 'quiz_option_target',
        question_id: question.id,
        label,
      };
      fabricCanvas.add(optionBody);

      optionTop += rowHeight + 12;
    }

    fabricCanvas.requestRenderAll();
    updateHint();
    remember(before);
    updateQuizControls();
    setQuizPanelStatus(`Đang hiển thị Câu ${index + 1}/${total}. Hãy dùng Bút vẽ khoanh tròn A, B, C hoặc D trên bảng!`, 'info');
  }

  function highlightCircledOptionOnCanvas(target, isCorrect, matchedLabel) {
    const color = isCorrect ? '#16a34a' : '#dc2626';
    const badgeRing = new Circle({
      left: (target.badgeX ?? target.x + 26) - 21,
      top: (target.badgeY ?? target.y + target.height / 2) - 21,
      radius: 21,
      fill: 'transparent',
      stroke: color,
      strokeWidth: 3.5,
      selectable: false,
      evented: false,
    });
    badgeRing.meta = { quizCardManaged: true, type: 'quiz_feedback_mark', label: matchedLabel };

    const markText = new FabricText(isCorrect ? `✓ ${matchedLabel}` : `✕ ${matchedLabel}`, {
      left: target.x + Math.min(target.width - 54, 420),
      top: target.y + 12,
      fontSize: 16,
      fontWeight: 'bold',
      fill: color,
      selectable: false,
      evented: false,
    });
    markText.meta = { quizCardManaged: true, type: 'quiz_feedback_mark', label: matchedLabel };

    fabricCanvas.add(badgeRing, markText);
    fabricCanvas.requestRenderAll();
  }

  async function loadSampleQuiz(subject) {
    setQuizPanelStatus(`Đang tải câu hỏi trắc nghiệm môn ${subject}...`, 'info');
    try {
      const res = await authFetch(`/api/v1/exam/sample?subject=${encodeURIComponent(subject)}&mode=${encodeURIComponent(quizState.mode)}`);
      if (!res.ok) throw new Error('Không tải được đề trắc nghiệm mẫu.');
      const data = await res.json();
      const mcqOnly = (data.questions || []).filter((q) => Array.isArray(q.options) && q.options.length >= 2);
      if (mcqOnly.length === 0) {
        setQuizPanelStatus('Đề mẫu hiện tại chưa có câu trắc nghiệm A/B/C/D.', 'error');
        return;
      }
      quizState.questions = mcqOnly;
      quizState.currentIndex = 0;
      quizState.subject = subject;
      renderQuizQuestionOnCanvas(mcqOnly[0], 0, mcqOnly.length);
    } catch (err) {
      setQuizPanelStatus(err.message || 'Lỗi tải đề trắc nghiệm.', 'error');
    }
  }

  async function submitCircleGestureToBackend(matched, gesture, pointsCount) {
    if (quizState.busy) return;
    quizState.busy = true;
    const { target, score } = matched;
    const question =
      quizState.questions.find((q) => q.id === target.questionId) ||
      quizState.questions[quizState.currentIndex] ||
      { id: target.questionId || 'q_board', number: quizState.currentIndex + 1, content: '' };

    const optionRegions = findOptionTargetsOnCanvas(fabricCanvas)
      .filter((opt) => !target.questionId || opt.questionId === target.questionId)
      .map((opt) => ({
        label: opt.label,
        x: Number(opt.x.toFixed(1)),
        y: Number(opt.y.toFixed(1)),
        width: Number(opt.width.toFixed(1)),
        height: Number(opt.height.toFixed(1)),
      }));

    const payload = {
      question_id: question.id || 'q_board',
      session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
      room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
      stroke_bbox: {
        x: Number(gesture.bbox.x.toFixed(1)),
        y: Number(gesture.bbox.y.toFixed(1)),
        width: Number(gesture.bbox.width.toFixed(1)),
        height: Number(gesture.bbox.height.toFixed(1)),
      },
      option_regions: optionRegions,
      selected_label: target.label,
      stroke_points_count: pointsCount,
      circularity_score: gesture.circularityScore,
      selection_method: state.tool === 'circle' || state.tool === 'ellipse' ? 'ELLIPSE_SHAPE' : 'CIRCLE_GESTURE',
      question_content: question.content || null,
      correct_label: question.correct_option || null,
      explanation: question.explanation || null,
      subject: $('subjectSelect')?.value || quizState.subject,
    };

    setStatus(`Đã nhận diện khoanh tròn phương án ${target.label} (khớp ${Math.round(score * 100)}%) — đang gửi Backend...`);
    setQuizPanelStatus(
      `Khoanh vùng (${Math.round(gesture.bbox.x)}, ${Math.round(gesture.bbox.y)}) → Phương án ${target.label}. Đang gửi Backend...`,
      'info'
    );

    try {
      const res = await authFetch(CIRCLE_ANSWER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Lỗi HTTP ${res.status}`);
      }
      const data = await res.json();
      quizState.lastSubmission = data;

      const isCorrect = Boolean(data.grade_result?.is_correct);
      highlightCircledOptionOnCanvas(target, isCorrect, data.matched_label);

      const summaryText = isCorrect
        ? `✓ Khoanh ${data.matched_label} CHÍNH XÁC! (${data.submission_id})`
        : `✕ Khoanh ${data.matched_label} chưa đúng (Đáp án: ${data.grade_result?.correct_label}).`;
      setQuizPanelStatus(summaryText, isCorrect ? 'correct' : 'incorrect');
      setStatus(summaryText);

      window.dispatchEvent(
        new CustomEvent('app:show-grade-feedback', {
          detail: { gradeResult: data.grade_result, question },
        })
      );
    } catch (err) {
      setQuizPanelStatus(`Không gửi được vùng khoanh: ${err.message}`, 'error');
      setStatus(`Lỗi gửi vùng khoanh: ${err.message}`);
    } finally {
      quizState.busy = false;
    }
  }

  function openOrTogglePanel() {
    const isOpen = panel.matches(':popover-open') || panel.classList.contains(':popover-open') || panel.hasAttribute('open');
    if (isOpen) {
      if (typeof panel.hidePopover === 'function') panel.hidePopover();
      else panel.removeAttribute('open');
      return;
    }
    if (typeof panel.showPopover === 'function') {
      panel.showPopover();
    } else {
      panel.setAttribute('open', '');
    }
    if (quizState.questions.length === 0) {
      void loadSampleQuiz(subjectSelect?.value || $('subjectSelect')?.value || 'TOAN');
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', openOrTogglePanel);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (typeof panel.hidePopover === 'function') panel.hidePopover();
      else panel.removeAttribute('open');
    });
  }
  if (loadSampleBtn) {
    loadSampleBtn.addEventListener('click', () => {
      void loadSampleQuiz(subjectSelect?.value || 'TOAN');
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (quizState.currentIndex > 0) {
        quizState.currentIndex -= 1;
        renderQuizQuestionOnCanvas(
          quizState.questions[quizState.currentIndex],
          quizState.currentIndex,
          quizState.questions.length
        );
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (quizState.currentIndex < quizState.questions.length - 1) {
        quizState.currentIndex += 1;
        renderQuizQuestionOnCanvas(
          quizState.questions[quizState.currentIndex],
          quizState.currentIndex,
          quizState.questions.length
        );
      }
    });
  }
  if (clearCanvasBtn) {
    clearCanvasBtn.addEventListener('click', () => {
      clearManagedQuizObjects();
      fabricCanvas.requestRenderAll();
      updateHint();
      setQuizPanelStatus('Đã gỡ khung trắc nghiệm khỏi mặt bảng.', 'info');
    });
  }

  // Đồng bộ đề đã tải từ modal ExamManager
  window.addEventListener('app:exam-loaded', (event) => {
    const data = event.detail;
    const mcqOnly = (data?.questions || []).filter((q) => Array.isArray(q.options) && q.options.length >= 2);
    if (mcqOnly.length > 0) {
      quizState.questions = mcqOnly;
      quizState.currentIndex = 0;
      quizState.mode = data.mode || 'STUDENT';
      updateQuizControls();
      setQuizPanelStatus(`Đã đồng bộ ${mcqOnly.length} câu trắc nghiệm. Hãy khoanh tròn A/B/C/D để chấm.`, 'info');
    }
  });

  // Lắng nghe từng nét bút hoàn tất trên Canvas để nhận diện khoanh tròn A/B/C/D
  window.addEventListener('app:stroke-finished', (event) => {
    const detail = event.detail || {};
    const optionTargets = findOptionTargetsOnCanvas(fabricCanvas);
    if (optionTargets.length === 0) return;

    const gesture = detectCircleSelectionGesture(detail.points, detail.bounds, detail.tool);
    if (!gesture.isCircle) return;

    const matched = matchCircleToQuizOption(gesture.bbox, optionTargets);
    if (!matched) return;

    // Ngăn Debounce AI 800ms tự bật bảng nhận diện đè lên khi học sinh khoanh đáp án
    window.dispatchEvent(new CustomEvent('app:cancel-ai-debounce'));
    void submitCircleGestureToBackend(matched, gesture, (detail.points || []).length);
  });

  updateQuizControls();
}
