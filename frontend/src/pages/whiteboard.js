import { $, stage, surface, toolbar, ui, state, fabricCanvas, blankPage, setStatus } from '../utils/context.js';
import { setTool, closePanels, syncColorSelection, syncWidthSelection, setupToolbar } from '../components/toolbar.js';
import { syncBackgroundButtons, updateHint, setupHistoryShortcuts } from '../components/history.js';
import { refreshPages, restoreSavedPages, persistPages, setupPageControls } from '../components/pageManager.js';
import { finishStroke, setupDrawingCanvas } from '../components/drawingCanvas.js';
import { setupBoardDialogs } from '../components/boardDialogs.js';
import { setupAIRecognition } from '../components/aiRecognition.js';
import { setupOfflineSync } from '../utils/offline_sync.js';
import { setupTeacherAuth, readStoredTeacherSession } from '../utils/auth_client.js';
import { setupExamManager } from '../components/examManager.js';
import { setupQuizBoard } from '../components/quiz_board.js';
import { setupStudentScoreSidebar } from '../components/student_score_sidebar.js';
import { setupEssayGradingManager } from '../components/essayGradingManager.js';
import { setupQuestionVariantManager } from '../components/questionVariantManager.js';
import { showAppConfirm, showAppToast } from '../utils/ui_feedback.js';

const SELECTED_CLASS_KEY = 'ai-canvas:selected-class:v1';
const DEFAULT_CLASSES = ['10A1', '10A2', '12A1', '8A2', '4A1'];

function sanitizeClassToken(raw) {
  const cleaned = String(raw || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
  return cleaned || '';
}

function getTodayCompact() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildRoomAndSession(className, urlParams = null) {
  const slug = className.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '10a1';
  const customRoom = urlParams ? (urlParams.get('room') || urlParams.get('room_id') || '').trim() : '';
  const customSession = urlParams ? (urlParams.get('session') || urlParams.get('session_id') || '').trim() : '';
  return {
    roomId: customRoom || `room-${slug}`,
    sessionId: customSession || `session-${slug}-${getTodayCompact()}`,
  };
}

function getRestrictedTeacherClasses(session) {
  if (!session || (session.expires_at && session.expires_at <= Date.now())) return null;
  const list = Array.isArray(session.allowed_classes)
    ? session.allowed_classes.map(sanitizeClassToken).filter(Boolean)
    : [];
  if (!list.length || list.includes('*')) return null;
  return Array.from(new Set(list));
}

function populateClassSelectOptions(allowedList, activeClass) {
  const selectEl = $('classSelect');
  if (!selectEl) return;
  const baseOptions = allowedList && allowedList.length ? allowedList : DEFAULT_CLASSES;
  const finalOptions = baseOptions.includes(activeClass) ? baseOptions : [activeClass, ...baseOptions];
  selectEl.textContent = '';
  for (const cls of finalOptions) {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    opt.selected = cls === activeClass;
    selectEl.appendChild(opt);
  }
}

function applyClassroomSpans(className, roomId, sessionId) {
  const classEl = $('className');
  const roomEl = $('roomId');
  const sessionEl = $('sessionId');
  if (classEl) classEl.textContent = className;
  if (roomEl) roomEl.textContent = roomId;
  if (sessionEl) sessionEl.textContent = sessionId;
}

function initClassroomContext() {
  const params = new URLSearchParams(window.location.search || '');
  const urlClass = sanitizeClassToken(params.get('class') || params.get('class_name'));
  const storedClass = sanitizeClassToken(localStorage.getItem(SELECTED_CLASS_KEY));
  const teacherSession = readStoredTeacherSession();
  const restricted = getRestrictedTeacherClasses(teacherSession);

  let activeClass = urlClass || storedClass || (restricted ? restricted[0] : '10A1') || '10A1';
  if (restricted && !restricted.includes(activeClass)) {
    activeClass = restricted[0];
  }

  const { roomId, sessionId } = buildRoomAndSession(activeClass, params);
  applyClassroomSpans(activeClass, roomId, sessionId);
  populateClassSelectOptions(restricted, activeClass);
  localStorage.setItem(SELECTED_CLASS_KEY, activeClass);

  async function switchClassroom(nextRawClass) {
    const nextClass = sanitizeClassToken(nextRawClass);
    const currentClass = ($('className')?.textContent || '10A1').trim();
    if (!nextClass || nextClass === currentClass || state.ended || state.pageBusy) return;

    persistPages();
    const nextMeta = buildRoomAndSession(nextClass, null);
    applyClassroomSpans(nextClass, nextMeta.roomId, nextMeta.sessionId);
    localStorage.setItem(SELECTED_CLASS_KEY, nextClass);

    try {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('class', nextClass);
      nextUrl.searchParams.delete('room');
      nextUrl.searchParams.delete('session');
      window.history.replaceState({}, '', nextUrl);
    } catch {
      // Bỏ qua nếu môi trường file:// không hỗ trợ replaceState
    }

    state.pages = [blankPage()];
    state.pageIndex = 0;
    state.undoStack = [];
    state.redoStack = [];
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = '';
    stage.style.removeProperty('background-color');
    stage.classList.toggle('is-dark-board', document.documentElement.dataset.theme === 'dark');
    syncBackgroundButtons();
    updateHint();
    refreshPages();
    await restoreSavedPages();

    window.dispatchEvent(
      new CustomEvent('app:class-changed', {
        detail: { className: nextClass, roomId: nextMeta.roomId, sessionId: nextMeta.sessionId },
      })
    );
    setStatus(`Đã chuyển sang Lớp ${nextClass} (${nextMeta.roomId})`);
  }

  const selectEl = $('classSelect');
  if (selectEl) {
    selectEl.addEventListener('change', () => {
      void switchClassroom(selectEl.value);
    });
  }

  window.addEventListener('app:teacher-authenticated', () => {
    const latest = readStoredTeacherSession();
    const nextRestricted = getRestrictedTeacherClasses(latest);
    const current = ($('className')?.textContent || '10A1').trim();
    if (nextRestricted && !nextRestricted.includes(current)) {
      populateClassSelectOptions(nextRestricted, nextRestricted[0]);
      void switchClassroom(nextRestricted[0]);
    } else {
      populateClassSelectOptions(nextRestricted, current);
    }
  });

  window.addEventListener('app:teacher-logged-out', () => {
    const current = ($('className')?.textContent || '10A1').trim();
    populateClassSelectOptions(null, current);
  });
}

function setupStudioIntroSplash() {
  const splash = $('studioIntroOverlay');
  if (!splash) return;
  const running = typeof splash.getAnimations === 'function' ? splash.getAnimations() : [];
  if (running.length === 0) {
    splash.hidden = true;
    return;
  }
  const dismiss = () => {
    splash.hidden = true;
  };
  splash.addEventListener('animationend', (event) => {
    const anim = 'animation' in event ? event.animation : null;
    if (event.target === splash && (!anim || anim.effect?.pseudoElement == null)) {
      dismiss();
    }
  });
  setTimeout(dismiss, 1600);
}

export async function initWhiteboard() {
  setupStudioIntroSplash();
  initClassroomContext();
  setupToolbar();
  setupHistoryShortcuts();
  setupPageControls();
  setupDrawingCanvas();
  setupBoardDialogs();
  setupAIRecognition();
  setupOfflineSync();
  setupTeacherAuth();
  setupExamManager();
  setupQuizBoard();
  setupStudentScoreSidebar();
  setupEssayGradingManager();
  setupQuestionVariantManager();

  // Phần đếm giờ và kết thúc phiên: chỉ chạy khi ứng dụng đã khởi tạo.
  const startedAt = Date.now();
  const clock = setInterval(() => {
    if (state.ended) return;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const min = String(Math.floor(seconds / 60)).padStart(2, '0');
    const sec = String(seconds % 60).padStart(2, '0');
    $('sessionTimer').textContent = `${min}:${sec}`;
  }, 1000);

  $('endSession').addEventListener('click', async () => {
    if (state.pageBusy || state.ended) return;
    const confirmed = await showAppConfirm({
      title: 'Kết thúc phiên giảng dạy này?',
      message: 'Toàn bộ trang bảng đang vẽ sẽ được tự động lưu trên trình duyệt, sau đó mặt bảng sẽ chuyển sang chế độ chỉ xem.',
      confirmText: 'Kết thúc phiên',
      cancelText: 'Tiếp tục giảng',
      variant: 'danger',
    });
    if (!confirmed || state.pageBusy || state.ended) return;
    persistPages();
    state.ended = true;
    clearInterval(clock);
    closePanels();
    if (state.stroke) finishStroke(false);
    $('sessionTimer').textContent = 'Đã kết thúc';
    $('endSession').disabled = true;
    surface.style.pointerEvents = 'none';
    toolbar.querySelectorAll('button,input').forEach((control) => {
      if (control.id !== 'captureButton') control.disabled = true;
    });
    $('prevPage').disabled = true;
    $('nextPage').disabled = true;
    $('addPageButton').disabled = true;
    $('deletePageButton').disabled = true;
    ui.footer.textContent = 'Phiên đã kết thúc · Đã lưu trang trên trình duyệt';
    setStatus('Đã kết thúc phiên');
    showAppToast({
      title: 'Đã kết thúc tiết học',
      message: 'Bạn vẫn có thể bấm "Chụp bảng" để tải ảnh PNG bài giảng về máy.',
      variant: 'info',
    });
  });

  window.addEventListener('pagehide', () => {
    if (!state.pageBusy) persistPages();
  });



  setTool('pen');
  syncColorSelection();
  syncWidthSelection();
  syncBackgroundButtons();
  updateHint();
  refreshPages();
  await restoreSavedPages();
}
