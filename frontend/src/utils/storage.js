// Cùng khóa lưu với app.js cũ: tách theo mã phiên buổi dạy (L4) để các lớp/ngày không ghi đè nhau.
export const PAGE_STORAGE_KEY = 'ai-interactive-canvas:pages:v1';

function resolveSessionStorageKey() {
  const sessionEl = typeof document !== 'undefined' ? document.getElementById('sessionId') : null;
  const sessionId = sessionEl?.textContent?.trim();
  if (!sessionId || sessionId === 'session-10a1') return PAGE_STORAGE_KEY;
  return `${PAGE_STORAGE_KEY}:${sessionId}`;
}

export function readStoredPages() {
  const raw = localStorage.getItem(resolveSessionStorageKey());
  return raw ? JSON.parse(raw) : null;
}

export function writeStoredPages(data) {
  localStorage.setItem(resolveSessionStorageKey(), JSON.stringify(data));
}
