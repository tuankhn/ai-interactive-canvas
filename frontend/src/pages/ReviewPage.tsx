'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Calendar, BookOpen, Download, ArrowLeft, Image as ImageIcon, Sparkles } from 'lucide-react';

export default function ReviewPage() {
  const [selectedDate, setSelectedDate] = useState('2026-11-09');
  const [selectedSubject, setSelectedSubject] = useState('Toán Học');

  const sampleSnapshots = [
    {
      id: 'snap-1',
      page: 1,
      time: '08:15',
      aiSummary: 'Khảo sát sự biến thiên và vẽ đồ thị hàm số bậc 2: y = ax^2 + bx + c. Tìm tọa độ đỉnh I(-b/2a, -Δ/4a).',
    },
    {
      id: 'snap-2',
      page: 2,
      time: '08:45',
      aiSummary: 'Bài tập áp dụng: Tìm tham số m để đồ thị hàm số cắt trục hoành tại 2 điểm phân biệt.',
    },
  ];

  return (
    <div className="min-h-screen bg-chalkboard-dark text-chalkboard-chalk p-6 md:p-10 flex flex-col items-center">
      <div className="max-w-5xl w-full space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-chalkboard-border pb-6">
          <div className="space-y-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay Lại Trang Chủ</span>
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-chalkboard-chalk">
              Cổng Ôn Tập Bài Giảng Trên Lớp
            </h1>
            <p className="text-sm text-emerald-200/70">
              Xem lại toàn bộ ảnh chụp bảng theo ngày và môn học. Dữ liệu lưu trữ an toàn 6 tháng.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-chalkboard-bg border border-chalkboard-border text-xs text-emerald-200">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-emerald-200 focus:outline-none cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-chalkboard-bg border border-chalkboard-border text-xs text-emerald-200">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="bg-transparent text-emerald-200 focus:outline-none cursor-pointer"
              >
                <option value="Toán Học" className="bg-chalkboard-dark">Toán Học</option>
                <option value="Vật Lý" className="bg-chalkboard-dark">Vật Lý</option>
                <option value="Hóa Học" className="bg-chalkboard-dark">Hóa Học</option>
                <option value="Tiếng Anh" className="bg-chalkboard-dark">Tiếng Anh</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sampleSnapshots.map((snap) => (
            <div
              key={snap.id}
              className="rounded-2xl bg-chalkboard-bg border border-chalkboard-border overflow-hidden hover:border-emerald-500 transition-all duration-200 flex flex-col justify-between"
            >
              <div className="h-56 bg-chalkboard-dark/80 relative flex items-center justify-center p-4 border-b border-chalkboard-border">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-chalkboard-light mx-auto flex items-center justify-center text-emerald-400">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono text-emerald-300/80 block">
                    Bảng Giảng Dạy — Trang {snap.page} ({snap.time})
                  </span>
                </div>

                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-chalkboard-dark/80 border border-chalkboard-border text-[11px] font-mono text-emerald-300">
                  {selectedSubject}
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Nội dung AI bóc tách:</span>
                  </div>
                  <p className="text-sm text-chalkboard-chalk/90 leading-relaxed">
                    {snap.aiSummary}
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-chalkboard-border/60">
                  <span className="text-xs text-emerald-200/50">Lớp 10A1 • Ngày {selectedDate}</span>
                  <button
                    onClick={() => alert('Đang tải ảnh chất lượng gốc về máy...')}
                    className="smartboard-btn !min-h-9 !px-3 py-1.5 bg-chalkboard-light hover:bg-emerald-600 text-emerald-200 hover:text-white text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải Ảnh Gốc</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
