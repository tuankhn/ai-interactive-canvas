// Cùng khóa lưu với app.js cũ: dữ liệu của người dùng không bị mất khi tách module.
export const PAGE_STORAGE_KEY = 'ai-interactive-canvas:pages:v1';
export function readStoredPages() {
  const raw = localStorage.getItem(PAGE_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function writeStoredPages(data) {
  localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(data));
}
