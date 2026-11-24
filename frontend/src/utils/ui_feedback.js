/**
 * Hệ thống Hộp thoại xác nhận (<dialog>) & Thông báo nổi (Popover Toast) nội bộ.
 * Thay thế hoàn toàn window.confirm() và window.alert() mặc định của trình duyệt.
 */

let confirmDialogEl = null;
let toastStackEl = null;

function ensureConfirmDialog() {
  if (confirmDialogEl && confirmDialogEl.isConnected) return confirmDialogEl;

  const dlg = document.createElement('dialog');
  dlg.id = 'appConfirmDialog';
  dlg.className = 'clear-dialog app-confirm-dialog';
  dlg.setAttribute('aria-labelledby', 'appConfirmTitle');
  dlg.setAttribute('aria-describedby', 'appConfirmMessage');

  dlg.innerHTML = `
    <div class="app-confirm-head">
      <span class="app-confirm-kicker" id="appConfirmBadge">Xác nhận thao tác</span>
      <h1 id="appConfirmTitle" class="app-confirm-title">Xác nhận</h1>
    </div>
    <p id="appConfirmMessage" class="app-confirm-message"></p>
    <form method="dialog" class="dialog-actions app-confirm-actions">
      <button type="submit" value="cancel" id="appConfirmCancelBtn" class="dialog-cancel" autofocus>Hủy</button>
      <button type="submit" value="confirm" id="appConfirmAcceptBtn" class="dialog-primary">Đồng ý</button>
    </form>
  `;

  document.body.appendChild(dlg);
  confirmDialogEl = dlg;
  return dlg;
}

/**
 * Hiển thị hộp thoại xác nhận bất đồng bộ thay cho window.confirm().
 * @returns {Promise<boolean>}
 */
export function showAppConfirm({
  title = 'Xác nhận thao tác',
  message = '',
  confirmText = 'Đồng ý',
  cancelText = 'Hủy',
  variant = 'primary',
} = {}) {
  if (typeof document === 'undefined') return Promise.resolve(false);

  const dlg = ensureConfirmDialog();
  const titleEl = dlg.querySelector('#appConfirmTitle');
  const msgEl = dlg.querySelector('#appConfirmMessage');
  const badgeEl = dlg.querySelector('#appConfirmBadge');
  const cancelBtn = dlg.querySelector('#appConfirmCancelBtn');
  const acceptBtn = dlg.querySelector('#appConfirmAcceptBtn');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (badgeEl) {
    badgeEl.textContent = variant === 'danger' ? 'Thao tác quan trọng' : 'Xác nhận phiên học';
    badgeEl.dataset.variant = variant;
  }
  if (cancelBtn) cancelBtn.textContent = cancelText;
  if (acceptBtn) {
    acceptBtn.textContent = confirmText;
    acceptBtn.className = variant === 'danger' ? 'dialog-danger' : 'dialog-primary';
  }

  dlg.returnValue = '';

  return new Promise((resolve) => {
    const handleClose = () => {
      const accepted = dlg.returnValue === 'confirm';
      dlg.returnValue = '';
      resolve(accepted);
    };
    dlg.addEventListener('close', handleClose, { once: true });
    try {
      if (!dlg.open) dlg.showModal();
    } catch {
      dlg.removeEventListener('close', handleClose);
      resolve(false);
    }
  });
}

function ensureToastStack() {
  if (toastStackEl && toastStackEl.isConnected) return toastStackEl;
  const stack = document.createElement('div');
  stack.id = 'appToastStack';
  stack.className = 'app-toast-stack';
  stack.setAttribute('role', 'region');
  stack.setAttribute('aria-label', 'Thông báo hệ thống');
  document.body.appendChild(stack);
  toastStackEl = stack;
  return stack;
}

/**
 * Hiển thị thông báo nổi không chặn luồng thay cho window.alert().
 */
export function showAppToast({
  title = '',
  message = '',
  variant = 'info',
  durationMs = 4200,
} = {}) {
  if (typeof document === 'undefined') return;

  const stack = ensureToastStack();
  const item = document.createElement('div');
  item.className = 'app-toast-item';
  item.dataset.variant = variant;
  item.setAttribute('popover', 'manual');

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'app-toast-copy';

  if (title) {
    const strong = document.createElement('strong');
    strong.className = 'app-toast-title';
    strong.textContent = title;
    bodyWrap.appendChild(strong);
  }

  const p = document.createElement('p');
  p.className = 'app-toast-text';
  p.textContent = message;
  bodyWrap.appendChild(p);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'app-toast-close';
  closeBtn.setAttribute('aria-label', 'Đóng thông báo');
  closeBtn.textContent = '✕';

  item.append(bodyWrap, closeBtn);
  stack.appendChild(item);

  const liveEl = document.getElementById('offlineAriaLive') || document.getElementById('saveState');
  if (liveEl) {
    liveEl.textContent = title ? `${title}: ${message}` : message;
  }

  try {
    if (typeof item.showPopover === 'function') {
      item.showPopover();
    }
  } catch {
    // Fallback hiển thị qua class CSS khi môi trường chưa hỗ trợ showPopover
  }
  item.classList.add('is-open');

  let timer = null;
  const dismiss = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    item.classList.remove('is-open');
    try {
      if (typeof item.hidePopover === 'function') item.hidePopover();
    } catch {
      // Ignore
    }
    setTimeout(() => {
      if (item.isConnected) item.remove();
    }, 180);
  };

  const startTimer = () => {
    if (durationMs <= 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (item.matches(':focus-within') || item.matches(':hover')) {
        startTimer();
        return;
      }
      dismiss();
    }, durationMs);
  };

  closeBtn.addEventListener('click', dismiss);
  item.addEventListener('pointerenter', () => {
    if (timer) clearTimeout(timer);
  });
  item.addEventListener('pointerleave', startTimer);
  item.addEventListener('focusout', startTimer);

  startTimer();
}
