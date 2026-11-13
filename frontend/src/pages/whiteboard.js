import { $, surface, toolbar, ui, state, setStatus } from '../utils/context.js';
import { setTool, closePanels, syncColorSelection, syncWidthSelection, setupToolbar } from '../components/toolbar.js';
import { syncBackgroundButtons, updateHint, setupHistoryShortcuts } from '../components/history.js';
import { refreshPages, restoreSavedPages, persistPages, setupPageControls } from '../components/pageManager.js';
import { finishStroke, setupDrawingCanvas } from '../components/drawingCanvas.js';
import { setupBoardDialogs } from '../components/boardDialogs.js';
import { setupAIRecognition } from '../components/aiRecognition.js';

export async function initWhiteboard() {
  setupToolbar();
  setupHistoryShortcuts();
  setupPageControls();
  setupDrawingCanvas();
  setupBoardDialogs();
  setupAIRecognition();

  // Phần đếm giờ và kết thúc phiên: chỉ chạy khi ứng dụng đã khởi tạo.
  const startedAt = Date.now();
  const clock = setInterval(() => {
    if (state.ended) return;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const min = String(Math.floor(seconds / 60)).padStart(2, '0');
    const sec = String(seconds % 60).padStart(2, '0');
    $('sessionTimer').textContent = `Đang diễn ra ${min}:${sec}`;
  }, 1000);

  $('endSession').addEventListener('click', () => {
    if (state.pageBusy || state.ended || !window.confirm('Kết thúc phiên vẽ trên trình duyệt này?')) return;
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
    ui.footer.textContent = 'Phiên đã kết thúc · Chưa đồng bộ máy chủ';
    setStatus('Đã kết thúc phiên');
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
