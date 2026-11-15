import { $, fabricCanvas, state, ui, setStatus } from './context.js';

const OFFLINE_DB_NAME = 'ai-canvas-offline-db';
const OFFLINE_DB_VERSION = 1;
const SNAPSHOT_STORE = 'pending_snapshots';

// Tải polyfill có điều kiện khi trình duyệt chưa hỗ trợ native Popover API.
if (typeof HTMLElement !== 'undefined' && !Object.hasOwn(HTMLElement.prototype, 'popover')) {
  import('https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js').catch(() => {});
}

let isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
let isSyncing = false;
let pendingToastPayload = null;
let autoHideTimer = null;
let lastFocusedBeforeToast = null;

const getOfflineElements = () => ({
  toastRegion: $('offlineToastRegion'),
  toast: $('offlineCornerToast'),
  toastTitle: $('offlineToastTitle'),
  toastBody: $('offlineToastBody'),
  toastClose: $('offlineToastCloseBtn'),
  ariaLive: $('offlineAriaLive'),
  aiStatus: $('aiStatusIndicator'),
  syncBadge: $('offlineSyncBadge'),
  subjectSelect: $('subjectSelect'),
});

function createSyncId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getSessionMeta() {
  const aiSubject = getOfflineElements().subjectSelect;
  return {
    session_id: $('sessionId')?.textContent?.trim() || 'session-10a1',
    room_id: $('roomId')?.textContent?.trim() || 'room-10a1',
    class_name: $('className')?.textContent?.trim() || '10A1',
    teacher_name: 'Nguyễn Tuấn Khang',
    subject: aiSubject ? aiSubject.value : 'TOAN',
    period_number: 1,
  };
}

export function isOfflineMode() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    isOffline = true;
  }
  return isOffline;
}

export function openOfflineDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB'));
      return;
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'client_sync_id' });
        store.createIndex('captured_at', 'captured_at', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không thể mở IndexedDB'));
  });
}

export async function saveSnapshotToIndexedDB(item) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOT_STORE);
    const record = {
      ...item,
      client_sync_id: item.client_sync_id || createSyncId(),
      captured_at: item.captured_at || new Date().toISOString(),
    };
    store.put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(err || new Error('Không thể lưu snapshot vào IndexedDB'));
    };
  });
}

export async function getPendingSnapshots() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const store = tx.objectStore(SNAPSHOT_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = Array.isArray(req.result) ? req.result : [];
      items.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
      db.close();
      resolve(items);
    };
    req.onerror = () => {
      const err = req.error;
      db.close();
      reject(err || new Error('Không thể đọc danh sách snapshot trong IndexedDB'));
    };
  });
}

export async function deletePendingSnapshots(clientSyncIds) {
  if (!Array.isArray(clientSyncIds) || clientSyncIds.length === 0) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOT_STORE);
    for (const id of clientSyncIds) {
      store.delete(id);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(err || new Error('Không thể xóa bản ghi đã đồng bộ khỏi IndexedDB'));
    };
  });
}

export async function countPendingSnapshots() {
  try {
    const items = await getPendingSnapshots();
    return items.length;
  } catch {
    return 0;
  }
}

function announceToastMessage(text) {
  if (!text) return;
  if (typeof document !== 'undefined' && typeof document.ariaNotify === 'function') {
    document.ariaNotify(text);
    return;
  }
  const { ariaLive } = getOfflineElements();
  if (ariaLive) {
    ariaLive.textContent = '';
    requestAnimationFrame(() => {
      ariaLive.textContent = text;
    });
  }
}

function hasOpenModalDialog() {
  return Boolean(document.querySelector('dialog[open]'));
}

function hideCornerToast({ restoreFocus = false } = {}) {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
  const { toast, toastClose } = getOfflineElements();
  if (!toast) return;
  const wasFocusedInside = toast.contains(document.activeElement);
  try {
    if (typeof toast.hidePopover === 'function') {
      if (toast.matches(':popover-open')) toast.hidePopover();
    } else {
      toast.classList.remove(':popover-open');
    }
  } catch {
    toast.classList.remove(':popover-open');
  }
  if (restoreFocus && wasFocusedInside && lastFocusedBeforeToast && typeof lastFocusedBeforeToast.focus === 'function') {
    lastFocusedBeforeToast.focus();
  } else if (restoreFocus && wasFocusedInside && toastClose) {
    lastFocusedBeforeToast = null;
  }
}

export function showCornerNotification({ title, body, variant = 'offline', autoDismissMs = 0 }) {
  const els = getOfflineElements();
  if (!els.toast) return;

  if (hasOpenModalDialog()) {
    pendingToastPayload = { title, body, variant, autoDismissMs };
    return;
  }
  pendingToastPayload = null;

  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  els.toast.setAttribute('popover', 'manual');
  els.toast.dataset.variant = variant;
  if (els.toastTitle) els.toastTitle.textContent = title;
  if (els.toastBody) els.toastBody.textContent = body;

  lastFocusedBeforeToast = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  try {
    if (typeof els.toast.showPopover === 'function') {
      if (!els.toast.matches(':popover-open')) els.toast.showPopover();
    } else {
      els.toast.classList.add(':popover-open');
    }
  } catch {
    els.toast.classList.add(':popover-open');
  }

  announceToastMessage(`${title}. ${body}`);

  if (autoDismissMs > 0) {
    autoHideTimer = setTimeout(() => {
      if (els.toast.contains(document.activeElement)) {
        // Giữ lại khi người dùng đang focus bên trong toast.
        autoHideTimer = setTimeout(() => hideCornerToast(), autoDismissMs);
        return;
      }
      hideCornerToast();
    }, autoDismissMs);
  }
}

export async function refreshOfflineUI() {
  const { aiStatus, syncBadge } = getOfflineElements();
  const pendingCount = await countPendingSnapshots();

  if (syncBadge) {
    if (pendingCount > 0) {
      syncBadge.textContent = `Chờ đồng bộ: ${pendingCount} ảnh`;
      syncBadge.hidden = false;
    } else {
      syncBadge.hidden = true;
      syncBadge.textContent = '';
    }
  }

  if (aiStatus) {
    if (isOffline) {
      aiStatus.textContent = pendingCount > 0
        ? `AI: Tạm dừng (Mất mạng · ${pendingCount} ảnh chờ)`
        : 'AI: Tạm dừng (Mất mạng)';
      aiStatus.classList.add('is-offline');
      aiStatus.classList.remove('is-analyzing');
    } else {
      aiStatus.textContent = isSyncing ? 'Đang đồng bộ ảnh...' : 'AI: Sẵn sàng';
      aiStatus.classList.remove('is-offline');
    }
  }

  return pendingCount;
}

export async function markNetworkOffline(reason = '') {
  const changed = !isOffline;
  isOffline = true;
  const pendingCount = await refreshOfflineUI();

  if (ui.footer) {
    ui.footer.textContent = pendingCount > 0
      ? `Chế độ mất mạng · Đã tạm dừng AI · ${pendingCount} ảnh đang lưu trong IndexedDB`
      : 'Chế độ mất mạng · Đã tạm dừng AI · Vẽ, xóa, chuyển trang hoạt động bình thường';
  }

  if (changed || reason) {
    const queueNote = pendingCount > 0 ? ` (${pendingCount} snapshot đang chờ đồng bộ).` : '.';
    showCornerNotification({
      title: 'Mất mạng — Tạm dừng AI',
      body: `Các thao tác vẽ, xóa, chuyển trang vẫn hoạt động bình thường; ảnh snapshot sẽ lưu tạm vào IndexedDB${queueNote}`,
      variant: 'offline',
      autoDismissMs: 0,
    });
    window.dispatchEvent(new CustomEvent('app:network-offline'));
  }
}

export async function syncPendingSnapshots({ silentIfEmpty = true } = {}) {
  if (isOfflineMode() || isSyncing) return { synced: 0, remaining: await countPendingSnapshots() };

  let items = [];
  try {
    items = await getPendingSnapshots();
  } catch (err) {
    console.warn('Không thể đọc IndexedDB:', err);
    return { synced: 0, remaining: 0 };
  }

  if (items.length === 0) {
    if (!silentIfEmpty) {
      await refreshOfflineUI();
    }
    return { synced: 0, remaining: 0 };
  }

  isSyncing = true;
  await refreshOfflineUI();

  try {
    const response = await fetch('/api/v1/offline-sync/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    const completedIds = (result.results || [])
      .filter((entry) => entry.status === 'synced' || entry.status === 'duplicate')
      .map((entry) => entry.client_sync_id);

    if (completedIds.length > 0) {
      await deletePendingSnapshots(completedIds);
    }

    const remaining = await countPendingSnapshots();
    const syncedTotal = (result.synced_count || 0) + (result.duplicate_count || 0);
    if (syncedTotal > 0) {
      setStatus(`Đã tự động đồng bộ ${syncedTotal} ảnh snapshot lên máy chủ`);
      if (ui.footer) {
        ui.footer.textContent = remaining > 0
          ? `Đã đồng bộ ${syncedTotal} ảnh · Còn ${remaining} ảnh chờ thử lại`
          : `Đã có mạng trở lại · Đã đồng bộ ${syncedTotal} snapshot lên máy chủ`;
      }
      showCornerNotification({
        title: 'Đã có mạng lại — Đồng bộ hoàn tất',
        body: `Đã đẩy ${syncedTotal} snapshot từ IndexedDB lên máy chủ thành công. AI đã sẵn sàng hoạt động trở lại.`,
        variant: 'synced',
        autoDismissMs: 5000,
      });
    }
    return { synced: syncedTotal, remaining };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      await markNetworkOffline();
    }
    return { synced: 0, remaining: await countPendingSnapshots() };
  } finally {
    isSyncing = false;
    await refreshOfflineUI();
  }
}

export async function markNetworkOnline() {
  const wasOffline = isOffline;
  isOffline = false;
  await refreshOfflineUI();

  const syncResult = await syncPendingSnapshots({ silentIfEmpty: true });
  if (wasOffline && syncResult.synced === 0) {
    if (ui.footer) {
      ui.footer.textContent = 'Đã kết nối lại máy chủ · AI sẵn sàng hoạt động';
    }
    showCornerNotification({
      title: 'Đã kết nối lại mạng',
      body: 'Tính năng AI nhận diện và đồng bộ bảng học đã hoạt động trở lại.',
      variant: 'online',
      autoDismissMs: 4000,
    });
  }

  if (wasOffline) {
    window.dispatchEvent(new CustomEvent('app:network-online'));
  }
}

export function isLikelyNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (error.name === 'TypeError') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
}

export async function handlePossibleNetworkError(error) {
  if (isLikelyNetworkError(error)) {
    await markNetworkOffline('network-error');
    return true;
  }
  return false;
}

export async function checkServerConnectivity() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await markNetworkOffline();
    return false;
  }
  try {
    const res = await fetch('/api/v1/offline-sync/status', { method: 'GET', cache: 'no-store' });
    if (res.ok) {
      await markNetworkOnline();
      return true;
    }
    return true; // Backend trả lỗi HTTP (không phải rớt mạng).
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      await markNetworkOffline('probe-failed');
      return false;
    }
    return false;
  }
}

/**
 * Chụp và lưu Snapshot lên máy chủ nếu có mạng, hoặc lưu tạm vào IndexedDB nếu mất mạng.
 */
export async function captureAndSaveSnapshot({ triggerType = 'MANUAL', pageNumber = state.pageIndex + 1, recognizedLatex = '' } = {}) {
  const meta = getSessionMeta();
  const imageBase64 = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
  const payload = {
    client_sync_id: createSyncId(),
    ...meta,
    page_number: pageNumber,
    trigger_type: triggerType,
    image_base64: imageBase64,
    recognized_latex: recognizedLatex,
    captured_at: new Date().toISOString(),
  };

  if (isOfflineMode()) {
    await saveSnapshotToIndexedDB(payload);
    const pendingCount = await refreshOfflineUI();
    showCornerNotification({
      title: 'Đã lưu tạm Snapshot (Offline)',
      body: `Ảnh trang ${pageNumber} đã được lưu vào IndexedDB (${pendingCount} ảnh chờ) và sẽ tự đẩy lên server khi có mạng lại.`,
      variant: 'offline',
      autoDismissMs: 0,
    });
    return { mode: 'offline_indexeddb', pendingCount };
  }

  try {
    const response = await fetch('/api/v1/sessions/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return { mode: 'online', data };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      await saveSnapshotToIndexedDB(payload);
      await markNetworkOffline('snapshot-fallback');
      const pendingCount = await countPendingSnapshots();
      return { mode: 'offline_indexeddb', pendingCount };
    }
    throw err;
  }
}

export function setupOfflineSync() {
  const { toastClose, toast } = getOfflineElements();

  if (toastClose && toast) {
    toastClose.addEventListener('click', () => {
      hideCornerToast({ restoreFocus: true });
    });
    toast.addEventListener('toggle', (event) => {
      if (event.newState === 'closed' && autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
    });
  }

  // Hiển thị lại toast đang chờ ngay sau khi modal dialog đóng lại.
  document.addEventListener('close', (event) => {
    if (event.target instanceof HTMLDialogElement && pendingToastPayload && !hasOpenModalDialog()) {
      const queued = pendingToastPayload;
      pendingToastPayload = null;
      showCornerNotification(queued);
    }
  }, true);

  window.addEventListener('offline', () => {
    markNetworkOffline('browser-offline-event');
  });

  window.addEventListener('online', () => {
    checkServerConnectivity();
  });

  // Kiểm tra trạng thái mạng & đẩy các ảnh còn tồn trong IndexedDB lúc khởi động.
  if (isOfflineMode()) {
    markNetworkOffline('initial-offline');
  } else {
    refreshOfflineUI().then((pendingCount) => {
      if (pendingCount > 0) {
        syncPendingSnapshots({ silentIfEmpty: true });
      }
    });
  }
}
