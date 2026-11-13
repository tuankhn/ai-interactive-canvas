// Khởi chạy bảng vẽ, nhận dạng chữ viết tay và đồ thị Plotly.js.
// Dùng duy nhất index.html, không cần thêm entry hay trang HTML mới.
try {
  await import('../../app.js');
  const { setupHandwriting, setupGraphExtension } = await import('./handwriting.js');
  setupHandwriting();
  setupGraphExtension();
} catch (error) {
  console.error('Không thể khởi chạy bảng vẽ:', error);
  const notice = document.createElement('div');
  notice.style.cssText = 'position:fixed;z-index:9999;bottom:12px;left:12px;right:12px;padding:12px;border-radius:8px;background:#fff1f2;border:1px solid #fda4af;color:#881337;font:14px Arial';
  notice.textContent = 'Không tải được bảng vẽ. Hãy chạy bằng Live Server, kiểm tra Internet và xem Console (F12).';
  document.body.append(notice);
}
