import { $, fabricCanvas, state, ui, setStatus } from '../utils/context.js';
import { snapshot, updateHint, remember } from './history.js';
import { closePanels } from './toolbar.js';
import { deleteCurrentPage } from './pageManager.js';

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


export async function downloadCurrentPageSnapshot() {
  const filename = `snapshot-trang-${state.pageIndex + 1}-${new Date().toISOString().slice(0, 10)}.png`;
  const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.append(link);
  link.click();
  link.remove();
  return filename;
}

export function clearCurrentPage() {
  if (state.ended || state.pageBusy || state.stroke) return;
  const objects = fabricCanvas.getObjects().slice();
  if (!objects.length) {
    setStatus(`Trang ${state.pageIndex + 1} đang trống`);
    return;
  }

  const before = snapshot();
  fabricCanvas.remove(...objects);
  fabricCanvas.requestRenderAll();
  updateHint();
  remember(before); // Ghi vào lịch sử hoàn tác và chỉ cập nhật trang hiện tại trong localStorage.
  setStatus(`Đã xóa nét vẽ ở trang ${state.pageIndex + 1}; các trang khác được giữ nguyên`);
}

function setDeleteDialogBusy(busy) {
  deleteDialogBusy = busy;
  cancelDeletePageButton.disabled = busy;
  deletePageWithoutSavingButton.disabled = busy;
  saveAndDeletePageButton.disabled = busy;
  saveAndDeletePageButton.textContent = busy ? 'Đang tạo ảnh...' : 'Lưu ảnh rồi xóa';
}

function setClearDialogBusy(busy) {
  cancelClearButton.disabled = busy;
  clearWithoutSavingButton.disabled = busy;
  saveAndClearButton.disabled = busy;
  saveAndClearButton.textContent = busy ? 'Đang tạo snapshot...' : 'Lưu snapshot rồi xóa';
}

export function setupBoardDialogs() {
  deletePageDialog.addEventListener('cancel', (event) => {
    if (deleteDialogBusy) event.preventDefault();
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
    deletePageDialog.close(); // Chính popup đã là bước xác nhận.
    await deleteCurrentPage();
  });

  saveAndDeletePageButton.addEventListener('click', async () => {
    if (deleteDialogBusy || state.pageBusy || state.ended) return;
    deletePageDialogError.hidden = true;
    setDeleteDialogBusy(true);
    try {
      const filename = await downloadCurrentPageSnapshot();
      deletePageDialog.close();
      // Browser chỉ xác nhận đã yêu cầu tải về, không xác nhận tệp đã nằm trên ổ đĩa.
      if (window.confirm(`Đã yêu cầu tải ${filename}.\n\n` +
        `Sau khi kiểm tra ảnh tải về, chọn OK để xóa hẳn trang ${state.pageIndex + 1}; ` +
        'chọn Hủy để giữ nguyên trang.')) {
        await deleteCurrentPage();
      } else {
        setStatus('Đã giữ nguyên trang; hãy kiểm tra ảnh đã tải');
      }
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
      return;
    }
    closePanels();
    clearDialogError.hidden = true;
    clearDialogError.textContent = '';
    clearDialog.showModal();
  });

  cancelClearButton.addEventListener('click', () => clearDialog.close());
  clearWithoutSavingButton.addEventListener('click', () => {
    if (!window.confirm(`Xóa nét vẽ ở trang ${state.pageIndex + 1} mà không lưu snapshot? Các trang khác sẽ được giữ nguyên.`)) return;
    clearDialog.close();
    clearCurrentPage();
  });

  saveAndClearButton.addEventListener('click', async () => {
    if (state.pageBusy || state.ended) return;
    clearDialogError.hidden = true;
    setClearDialogBusy(true);
    try {
      const filename = await downloadCurrentPageSnapshot();
      clearDialog.close();
      // Tải xuống được yêu cầu chưa có nghĩa tệp đã lưu thành công trên thiết bị.
      if (window.confirm(`Đã yêu cầu tải tệp ${filename}.\n\nChọn OK để xóa nét vẽ CHỈ TRÊN TRANG ${state.pageIndex + 1} sau khi kiểm tra ảnh tải về. Chọn Hủy để giữ nguyên trang hiện tại.`)) {
        clearCurrentPage();
      } else {
        setStatus('Đã giữ nguyên trang hiện tại; bạn có thể kiểm tra snapshot');
      }
    } catch (error) {
      console.error('Lỗi xuất snapshot:', error);
      clearDialogError.textContent = error.message || 'Không thể lưu snapshot. Bảng chưa bị xóa.';
      clearDialogError.hidden = false;
    } finally {
      setClearDialogBusy(false);
    }
  });

  $('captureButton').addEventListener('click', () => {
    if (state.pageBusy || state.stroke) return;
    closePanels();
    const link = document.createElement('a');
    link.download = `bang-ve-trang-${state.pageIndex + 1}.png`;
    link.href = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
    document.body.append(link);
    link.click();
    link.remove();
    setStatus('Đã xuất hình PNG');
  });


}
