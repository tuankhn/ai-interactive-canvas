'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCanvasStore, apiClient, offlineStorage } from '@/utils';
import { Sparkles, Save, WifiOff, Loader2 } from 'lucide-react';

export default function SmartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);

  const {
    currentTool,
    currentColor,
    brushSize,
    subject,
    sessionId,
    currentPage,
    isOffline,
    isAIProcessing,
    setOffline,
    setAIProcessing,
    setAIResult,
  } = useCanvasStore();

  // Lắng nghe trạng thái trực tuyến / ngoại tuyến
  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      // Đồng bộ snapshot offline nếu có
      const pending = offlineStorage.getPendingSnapshots();
      if (pending.length > 0) {
        pending.forEach(async (snap) => {
          try {
            await apiClient.saveSnapshot(snap.sessionId, snap.pageNumber, snap.imageBase64);
          } catch (e) {
            console.warn('Lỗi đồng bộ snapshot:', e);
          }
        });
        offlineStorage.clearPendingSnapshots();
      }
    };
    const handleOffline = () => setOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setOffline(!navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOffline]);

  // Khởi tạo kích thước canvas tràn màn hình
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a2e26'; // Màu xanh bảng phấn truyền thống
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Xử lý nét vẽ: Bút Stylus, Ngón tay Touch, Chuột
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Chống chạm nhầm lòng bàn tay (Palm rejection cơ bản)
    if (e.pointerType === 'touch' && (e.width > 30 || e.height > 30)) {
      return;
    }

    setIsDrawing(true);
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(e.clientX, e.clientY);

    if (currentTool === 'eraser') {
      ctx.strokeStyle = '#1a2e26';
      ctx.lineWidth = brushSize * 4;
    } else if (currentTool === 'highlighter') {
      ctx.strokeStyle = currentColor + '66';
      ctx.lineWidth = brushSize * 3;
    } else {
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    setLastPos(null);
  };

  // Kích hoạt nhận diện AI
  const handleRecognizeAI = async () => {
    const canvas = canvasRef.current;
    if (!canvas || isOffline) return;

    try {
      setAIProcessing(true);
      const dataUrl = canvas.toDataURL('image/png');
      const result = await apiClient.recognizeCanvas(dataUrl, subject);
      setAIResult(result);
    } catch (err) {
      console.error('Lỗi nhận diện AI:', err);
    } finally {
      setAIProcessing(false);
    }
  };

  // Lưu Snapshot trước khi xóa bảng
  const handleSaveAndClear = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');

    if (isOffline) {
      // Lưu offline vào LocalStorage/IndexedDB
      offlineStorage.saveOfflineSnapshot({
        id: `offline_${Date.now()}`,
        sessionId,
        pageNumber: currentPage,
        imageBase64: dataUrl,
        timestamp: Date.now(),
      });
      alert('Đã lưu bài học vào bộ nhớ tạm ngoại tuyến (sẽ tự động đồng bộ khi có mạng lại)!');
    } else {
      try {
        await apiClient.saveSnapshot(sessionId, currentPage, dataUrl);
        alert('Đã lưu bài học lên máy chủ thành công trước khi xóa bảng!');
      } catch {
        alert('Lỗi lưu bài học, vui lòng kiểm tra kết nối.');
      }
    }

    // Xóa trắng bảng cho nội dung mới
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1a2e26';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setAIResult(null);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-chalkboard-bg">
      {/* Cảnh báo Ngoại tuyến */}
      {isOffline && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-900/90 text-amber-200 border border-amber-600 text-sm font-medium shadow-lg backdrop-blur">
          <WifiOff className="w-4 h-4" />
          <span>Đang ngoại tuyến: Vẽ tay bình thường, tính năng AI tạm dừng.</span>
        </div>
      )}

      {/* Vùng Canvas vẽ */}
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        className="w-full h-full cursor-crosshair touch-none"
      />

      {/* Thanh tác vụ trên cùng bên phải */}
      <div className="absolute top-4 right-6 z-40 flex items-center gap-3">
        <button
          onClick={handleRecognizeAI}
          disabled={isAIProcessing || isOffline}
          className="smartboard-btn px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-950 text-white font-medium shadow-lg flex items-center gap-2"
        >
          {isAIProcessing ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Sparkles className="w-5 h-5" />
          )}
          <span>{isAIProcessing ? 'AI Đang Phân Tích...' : 'AI Phân Tích'}</span>
        </button>

        <button
          onClick={handleSaveAndClear}
          className="smartboard-btn px-4 py-2 bg-chalkboard-light hover:bg-chalkboard-border text-emerald-200 border border-chalkboard-border shadow-lg flex items-center gap-2"
        >
          <Save className="w-5 h-5" />
          <span>Lưu & Xóa Bảng</span>
        </button>
      </div>
    </div>
  );
}
