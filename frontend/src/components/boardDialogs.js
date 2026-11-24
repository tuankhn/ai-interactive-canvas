import { $, fabricCanvas, state, setStatus, withOpaqueBoardExport } from '../utils/context.js';
import { snapshot, updateHint, remember } from './history.js';
import { closePanels } from './toolbar.js';
import { deleteCurrentPage } from './pageManager.js';
import { captureAndSaveSnapshot } from '../utils/offline_sync.js';
import { showAppToast } from '../utils/ui_feedback.js';

const deletePageDialog = $('deletePageDialog');
const deletePageDialogTitle = $('deletePageDialogTitle');
const deletePageDialogDescription = $('deletePageDialogDescription');
const deletePageDialogError = $('deletePageDialogError');
const cancelDeletePageButton = $('cancelDeletePageButton');
const deletePageWithoutSavingButton = $('deletePageWithoutSavingButton');
const saveAndDeletePageButton = $('saveAndDeletePageButton');
let deleteDialogBusy = false;

const clearDialog = $('clearBoardDialog');
const clearDialogError = $('clearDialogError');
const cancelClearButton = $('cancelClearButton');
const clearWithoutSavingButton = $('clearWithoutSavingButton');
const saveAndClearButton = $('saveAndClearButton');
let clearDialogBusy = false;

function triggerPngDownload(dataUrl, filename) {
  try {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.append(link);
    link.click();
    link.remove();
  } catch (err) {
    console.warn('Trình duyệt chặn tải tệp tự động:', err);
  }
}

export async function downloadCurrentPageSnapshot(triggerType = 'MANUAL') {
  const pageNum = state.pageIndex + 1;
  const filename = `snapshot-trang-${pageNum}-${new Date().toISOString().slice(0, 10)}.png`;

  // 1. Đẩy ảnh bảng độ nét cao lên Cổng Học Sinh (/api/v1/sessions/snapshots) trước tiên
  let syncResult = null;
  let dataUrl = '';
  try {
    syncResult = await captureAndSaveSnapshot({
      triggerType,
      pageNumber: pageNum,
    });
    dataUrl = syncResult?.imageBase64 || '';
    if (syncResult?.mode === 'offline_indexeddb') {
      setStatus(`Đã lưu tạm snapshot vào IndexedDB (${syncResult.pendingCount} ảnh chờ đồng bộ)`);
    }
  } catch (syncError) {
    console.warn('Không thể đồng bộ snapshot lên máy chủ:', syncError);
  }

  // 2. Xuất bản sao PNG về máy tính giáo viên
  if (!dataUrl) {
    dataUrl = withOpaqueBoardExport(
      () => fabricCanvas.toDataURL({ format: 'png', multiplier: 2 }),
      '#f4f7f5',
      '#121214'
    );
  }
  triggerPngDownload(dataUrl, filename);

  return { filename, syncResult };
}

export function clearCurrentPage({ skipAutoSnapshot = false } = {}) {
  if (state.ended || state.pageBusy || state.stroke) return;
  const objects = fabricCanvas.getObjects().slice();
  if (!objects.length) {
    setStatus(`Trang ${state.pageIndex + 1} đang trống`);
    return;
  }

  if (!skipAutoSnapshot) {
    // Task TF28512: Tự động lưu ảnh Snapshot bảo vệ dữ liệu trước khi xóa bảng
    try {
      captureAndSaveSnapshot({
        triggerType: 'BEFORE_CLEAR',
        pageNumber: state.pageIndex + 1,
      }).catch((err) => console.warn('Lưu snapshot nền trước khi xóa:', err));
    } catch (err) {
      console.warn('Lỗi kích hoạt lưu snapshot trước khi xóa:', err);
    }
  }

  const before = snapshot();
  fabricCanvas.remove(...objects);
  fabricCanvas.requestRenderAll();
  updateHint();
  remember(before);
  setStatus(`Đã xóa nét vẽ ở trang ${state.pageIndex + 1}; bấm Hoàn tác (Ctrl + Z) nếu cần khôi phục`);
}

function setDeleteDialogBusy(busy) {
  deleteDialogBusy = busy;
  cancelDeletePageButton.disabled = busy;
  deletePageWithoutSavingButton.disabled = busy;
  saveAndDeletePageButton.disabled = busy;
  saveAndDeletePageButton.textContent = busy ? 'Đang lưu lên Cổng HS...' : 'Lưu ảnh rồi xóa';
}

function setClearDialogBusy(busy) {
  clearDialogBusy = busy;
  cancelClearButton.disabled = busy;
  clearWithoutSavingButton.disabled = busy;
  saveAndClearButton.disabled = busy;
  saveAndClearButton.textContent = busy ? 'Đang lưu lên Cổng HS...' : 'Lưu snapshot rồi xóa';
}

export function setupBoardDialogs() {
  deletePageDialog.addEventListener('cancel', (event) => {
    if (deleteDialogBusy) event.preventDefault();
  });

  clearDialog.addEventListener('cancel', (event) => {
    if (clearDialogBusy) event.preventDefault();
  });

  $('deletePageButton').addEventListener('click', () => {
    if (state.ended || state.pageBusy || state.stroke || state.pages.length <= 1) return;
    closePanels();
    deletePageDialogTitle.textContent = `Xóa trang ${state.pageIndex + 1}?`;
    deletePageDialogDescription.textContent =
      `Trang ${state.pageIndex + 1} sẽ biến mất khỏi danh sách và không thể hoàn tác. ` +
      `${state.pages.length - 1} trang còn lại sẽ được giữ nguyên.`;
    deletePageDialogError.textContent = '';
    deletePageDialogError.hidden = true;
    deletePageDialog.showModal();
  });

  cancelDeletePageButton.addEventListener('click', () => deletePageDialog.close());

  deletePageWithoutSavingButton.addEventListener('click', async () => {
    if (deleteDialogBusy || state.pageBusy || state.ended) return;
    const removedNum = state.pageIndex + 1;
    deletePageDialog.close();
    await deleteCurrentPage();
    showAppToast({
      title: `Đã xóa Trang ${removedNum}`,
      message: `Còn lại ${state.pages.length} trang trên bảng vẽ.`,
      variant: 'info',
    });
  });

  saveAndDeletePageButton.addEventListener('click', async () => {
    if (deleteDialogBusy || state.pageBusy || state.ended) return;
    deletePageDialogError.hidden = true;
    setDeleteDialogBusy(true);
    const removedNum = state.pageIndex + 1;
    try {
      const { filename, syncResult } = await downloadCurrentPageSnapshot('BEFORE_DELETE_PAGE');
      deletePageDialog.close();
      await deleteCurrentPage();
      const cls = syncResult?.className || '10A1';
      showAppToast({
        title:
          syncResult?.mode === 'online'
            ? `Đã lưu lên Cổng Học Sinh (Lớp ${cls}) & xóa Trang ${removedNum}`
            : `Đã xuất ${filename} & xóa Trang ${removedNum}`,
        message:
          syncResult?.mode === 'online'
            ? 'Học sinh có thể xem lại ngay trên Cổng Ôn Tập.'
            : 'Ảnh đã tải về máy và xếp hàng đồng bộ.',
        variant: 'info',
      });
    } catch (error) {
      console.error('Không thể tạo snapshot trước khi xóa trang:', error);
      deletePageDialogError.textContent = error.message || 'Không thể tạo ảnh. Trang chưa bị xóa.';
      deletePageDialogError.hidden = false;
    } finally {
      setDeleteDialogBusy(false);
    }
  });

  $('clearButton').addEventListener('click', () => {
    if (state.ended || state.pageBusy || state.stroke) return;
    if (fabricCanvas.getObjects().length === 0) {
      setStatus(`Trang ${state.pageIndex + 1} đang trống`);
      showAppToast({
        title: `Trang ${state.pageIndex + 1} đang trống`,
        message: 'Chưa có nét vẽ nào trên trang hiện tại để xóa.',
        variant: 'info',
      });
      return;
    }
    closePanels();
    clearDialogError.hidden = true;
    clearDialogError.textContent = '';
    clearDialog.showModal();
  });

  cancelClearButton.addEventListener('click', () => clearDialog.close());

  clearWithoutSavingButton.addEventListener('click', () => {
    if (clearDialogBusy || state.pageBusy || state.ended) return;
    const pageNum = state.pageIndex + 1;
    clearDialog.close();
    clearCurrentPage({ skipAutoSnapshot: true });
    showAppToast({
      title: `Đã làm sạch Trang ${pageNum}`,
      message: 'Bấm Hoàn tác (Ctrl + Z) nếu bạn muốn khôi phục lại nét vẽ.',
      variant: 'info',
    });
  });

  saveAndClearButton.addEventListener('click', async () => {
    if (clearDialogBusy || state.pageBusy || state.ended) return;
    clearDialogError.hidden = true;
    setClearDialogBusy(true);
    const pageNum = state.pageIndex + 1;
    try {
      const { filename, syncResult } = await downloadCurrentPageSnapshot('BEFORE_CLEAR');
      clearDialog.close();
      clearCurrentPage({ skipAutoSnapshot: true });
      const cls = syncResult?.className || '10A1';
      showAppToast({
        title:
          syncResult?.mode === 'online'
            ? `Đã lưu bảng lên Cổng Học Sinh (Lớp ${cls})`
            : `Đã xuất ảnh ${filename} & làm sạch bảng`,
        message:
          syncResult?.mode === 'online'
            ? `Ảnh bài giảng Trang ${pageNum} đã hiển thị trên Cổng Ôn Tập của học sinh và tải bản sao PNG về máy.`
            : `Ảnh Trang ${pageNum} đã tải về máy và lưu tạm chờ đồng bộ.`,
        variant: 'info',
      });
    } catch (error) {
      console.error('Lỗi xuất snapshot:', error);
      clearDialogError.textContent = error.message || 'Không thể lưu snapshot. Bảng chưa bị xóa.';
      clearDialogError.hidden = false;
    } finally {
      setClearDialogBusy(false);
    }
  });

  $('captureButton').addEventListener('click', async () => {
    if (state.pageBusy || state.stroke) return;
    closePanels();
    const pageNum = state.pageIndex + 1;
    const { filename, syncResult } = await downloadCurrentPageSnapshot('MANUAL');
    const cls = syncResult?.className || '10A1';
    setStatus('Đã xuất hình PNG và đồng bộ bài giảng lên Cổng Học Sinh');
    showAppToast({
      title:
        syncResult?.mode === 'online'
          ? `Đã lưu bài giảng lên Cổng Học Sinh (Lớp ${cls})`
          : `Đã tải ảnh ${filename}`,
      message:
        syncResult?.mode === 'online'
          ? `Ảnh Trang ${pageNum} đã đồng bộ sang Cổng Ôn Tập và tải tệp PNG về máy.`
          : `Ảnh Trang ${pageNum} đã lưu về máy và chờ đồng bộ mạng.`,
      variant: 'info',
    });
  });
}
