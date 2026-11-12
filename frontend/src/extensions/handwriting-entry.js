// Khởi chạy bảng vẽ gốc trước, sau đó mới cài tiện ích chuyển chữ.
// Giữ nguyên frontend/app.js và toàn bộ các module sẵn có.
try {
  await import('../../app.js');
  const { setupHandwriting } = await import('./handwriting.js');
  setupHandwriting();
} catch (error) {
  console.error('Không thể khởi chạy bảng vẽ:', error);
  const notice = document.createElement('div');
  notice.style.cssText = 'position:fixed;z-index:9999;bottom:12px;left:12px;right:12px;padding:12px;border-radius:8px;background:#fff1f2;border:1px solid #fda4af;color:#881337;font:14px Arial';
  notice.textContent = 'Không tải được bảng vẽ. Hãy chạy bằng Live Server, kiểm tra Internet và xem Console (F12).';
  document.body.append(notice);
}
