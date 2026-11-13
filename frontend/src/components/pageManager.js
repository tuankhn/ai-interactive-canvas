import { $, state, ui, stage, fabricCanvas, blankPage, setStatus } from '../utils/context.js';
import { readStoredPages, writeStoredPages } from '../utils/storage.js';
import { updateHint, syncBackgroundButtons, updateHistoryButtons } from './history.js';
import { closePanels } from './toolbar.js';

function serializeCurrentPage() {
  return {
    objects: fabricCanvas.getObjects().map((object) =>
      object.toObject(['_hitPoints', '_hitWidth', '_isPlotlyGraph'])
    ),
    background: fabricCanvas.backgroundColor || '#ffffff'
  };
}

export function persistPages() {
  if (state.pageBusy) return false;
  state.pages[state.pageIndex] = serializeCurrentPage();
  try {
    writeStoredPages({ version: 1, pageIndex: state.pageIndex, pages: state.pages });
    ui.footer.textContent = 'Trạng thái: Đã tự động lưu trên trình duyệt · Chưa đồng bộ máy chủ';
    return true;
  } catch (error) {
    console.warn('Không thể lưu trang vào localStorage:', error);
    ui.footer.textContent = 'Cảnh báo: Không thể tự động lưu (có thể đã đầy bộ nhớ)';
    return false;
  }
}

function syncLoadedCanvas() {
  stage.style.backgroundColor = fabricCanvas.backgroundColor || '#ffffff';
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
}

async function loadPageData(data) {
  const safePage = data && Array.isArray(data.objects) ? data : blankPage();
  await fabricCanvas.loadFromJSON({
    objects: safePage.objects,
    background: safePage.background || '#ffffff'
  }, (original, object) => {
    if (!object) return;
    object.set({ selectable: false, evented: false, objectCaching: false });
    if (Array.isArray(original._hitPoints)) object._hitPoints = original._hitPoints;
    if (Number.isFinite(original._hitWidth)) object._hitWidth = original._hitWidth;
    if (original._isPlotlyGraph === true) object._isPlotlyGraph = true;
  });
  syncLoadedCanvas();
}

export function refreshPages() {
  $('pageIndicator').textContent = `Trang ${state.pageIndex + 1} / ${state.pages.length}`;
  $('prevPage').disabled = state.ended || state.pageBusy || state.pageIndex === 0;
  $('nextPage').disabled = state.ended || state.pageBusy || state.pageIndex >= state.pages.length - 1;
  $('addPageButton').disabled = state.ended || state.pageBusy;
  // Luôn giữ lại ít nhất một trang bảng.
  $('deletePageButton').disabled = state.ended || state.pageBusy || state.pages.length <= 1;
  updateHistoryButtons();
}

export async function switchPage(nextIndex) {
  if (state.ended || state.pageBusy || state.stroke || nextIndex < 0 ||
      nextIndex >= state.pages.length || nextIndex === state.pageIndex) return;

  state.pages[state.pageIndex] = serializeCurrentPage();
  const oldIndex = state.pageIndex;
  state.pageBusy = true;
  closePanels();
  refreshPages();

  try {
    await loadPageData(state.pages[nextIndex]);
    state.pageIndex = nextIndex;
    state.undoStack = [];
    state.redoStack = [];
    setStatus(`Đang ở trang ${state.pageIndex + 1}`);
  } catch (error) {
    console.error('Không thể chuyển trang:', error);
    try { await loadPageData(state.pages[oldIndex]); } catch (restoreError) {
      console.error('Không thể khôi phục trang cũ:', restoreError);
    }
    setStatus('Không thể chuyển trang');
  } finally {
    state.pageBusy = false;
    refreshPages();
    persistPages();
  }
}

export async function addPage() {
  if (state.ended || state.pageBusy || state.stroke) return;
  const newPageIndex = state.pages.length;
  state.pages.push(blankPage());
  await switchPage(newPageIndex);
  if (state.pageIndex !== newPageIndex) {
    // Không giữ trang rỗng nếu khởi tạo/chuyển trang thất bại.
    state.pages.splice(newPageIndex, 1);
    refreshPages();
    persistPages();
  }
}

export async function deleteCurrentPage() {
  if (state.ended || state.pageBusy || state.stroke || state.pages.length <= 1) return false;

  state.pages[state.pageIndex] = serializeCurrentPage();
  const removedIndex = state.pageIndex;
  const removedPage = state.pages[removedIndex];
  const targetIndex = removedIndex < state.pages.length - 1 ? removedIndex + 1 : removedIndex - 1;
  const targetPage = state.pages[targetIndex];

  state.pageBusy = true;
  closePanels();
  refreshPages();
  try {
    // Chỉ xóa trang khỏi mảng sau khi đã nạp thành công trang kế tiếp.
    await loadPageData(targetPage);
    state.pages.splice(removedIndex, 1);
    state.pageIndex = targetIndex > removedIndex ? targetIndex - 1 : targetIndex;
    state.undoStack = [];
    state.redoStack = [];
    setStatus(`Đã xóa trang ${removedIndex + 1}; còn ${state.pages.length} trang`);
    return true;
  } catch (error) {
    console.error('Không thể xóa trang:', error);
    try { await loadPageData(removedPage); } catch (restoreError) {
      console.error('Không thể khôi phục trang vừa xóa:', restoreError);
    }
    setStatus('Không thể xóa trang. Các trang vẫn được giữ nguyên.');
    return false;
  } finally {
    state.pageBusy = false;
    refreshPages();
    persistPages();
  }
}

export async function restoreSavedPages() {
  state.pageBusy = true;
  refreshPages();
  try {
    const saved = readStoredPages();
    if (saved) {
      if (saved.version === 1 && Array.isArray(saved.pages) && saved.pages.length > 0 &&
          saved.pages.every((page) => page && Array.isArray(page.objects) && typeof page.background === 'string')) {
        state.pages = saved.pages;
        state.pageIndex = Number.isInteger(saved.pageIndex)
          ? Math.max(0, Math.min(saved.pageIndex, state.pages.length - 1)) : 0;
        await loadPageData(state.pages[state.pageIndex]);
        setStatus(`Đã khôi phục ${state.pages.length} trang`);
      }
    }
  } catch (error) {
    console.warn('Không thể khôi phục dữ liệu đã lưu:', error);
    state.pages = [blankPage()];
    state.pageIndex = 0;
    await loadPageData(state.pages[0]);
    setStatus('Không thể khôi phục bản lưu cũ');
  } finally {
    state.pageBusy = false;
    refreshPages();
  }
}

export function setupPageControls() {
  $('prevPage').addEventListener('click', () => switchPage(state.pageIndex - 1));
  $('nextPage').addEventListener('click', () => switchPage(state.pageIndex + 1));
  $('addPageButton').addEventListener('click', addPage);
}
