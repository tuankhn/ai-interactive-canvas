'use client';

import React from 'react';
import Link from 'next/link';
import { useCanvasStore, ChalkColor, SubjectType } from '@/utils';
import { Pen, Highlighter, Eraser, Home, ChevronLeft, ChevronRight } from 'lucide-react';

const COLORS: { label: string; value: ChalkColor }[] = [
  { label: 'Trắng', value: '#f5f5f0' },
  { label: 'Vàng', value: '#fef08a' },
  { label: 'Xanh Lam', value: '#a5f3fc' },
  { label: 'Hồng', value: '#fbcfe8' },
  { label: 'Xanh Lá', value: '#86efac' },
];

const SUBJECTS: { label: string; value: SubjectType }[] = [
  { label: 'Toán', value: 'MATH' },
  { label: 'Vật Lý', value: 'PHYS' },
  { label: 'Hóa Học', value: 'CHEM' },
  { label: 'Tiếng Anh', value: 'ENG' },
];

export default function Toolbar() {
  const {
    currentTool,
    currentColor,
    brushSize,
    subject,
    currentPage,
    setTool,
    setColor,
    setBrushSize,
    setSubject,
    setCurrentPage,
  } = useCanvasStore();

  return (
    <aside className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-chalkboard-dark/95 border border-chalkboard-border rounded-2xl p-2.5 shadow-2xl backdrop-blur flex items-center gap-3">
      {/* Về trang chủ */}
      <Link
        href="/"
        className="smartboard-btn bg-chalkboard-light text-emerald-300 hover:bg-chalkboard-border"
        title="Về Trang Chủ"
      >
        <Home className="w-5 h-5" />
      </Link>

      <div className="w-[1px] h-8 bg-chalkboard-border" />

      {/* Chọn Môn Học */}
      <select
        value={subject}
        onChange={(e) => setSubject(e.target.value as SubjectType)}
        className="h-12 px-3 bg-chalkboard-light border border-chalkboard-border text-emerald-200 rounded-xl text-sm font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
      >
        {SUBJECTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="w-[1px] h-8 bg-chalkboard-border" />

      {/* Bút viết, Dạ quang, Tẩy */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTool('pen')}
          className={`smartboard-btn ${
            currentTool === 'pen'
              ? 'bg-emerald-600 text-white'
              : 'bg-chalkboard-light text-emerald-300 hover:bg-chalkboard-border'
          }`}
          title="Bút Viết Phấn"
        >
          <Pen className="w-5 h-5" />
        </button>

        <button
          onClick={() => setTool('highlighter')}
          className={`smartboard-btn ${
            currentTool === 'highlighter'
              ? 'bg-emerald-600 text-white'
              : 'bg-chalkboard-light text-emerald-300 hover:bg-chalkboard-border'
          }`}
          title="Bút Dạ Quang"
        >
          <Highlighter className="w-5 h-5" />
        </button>

        <button
          onClick={() => setTool('eraser')}
          className={`smartboard-btn ${
            currentTool === 'eraser'
              ? 'bg-emerald-600 text-white'
              : 'bg-chalkboard-light text-emerald-300 hover:bg-chalkboard-border'
          }`}
          title="Khăn Lau Bảng"
        >
          <Eraser className="w-5 h-5" />
        </button>
      </div>

      <div className="w-[1px] h-8 bg-chalkboard-border" />

      {/* Bảng Màu Phấn */}
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => setColor(c.value)}
            className={`w-9 h-9 rounded-full border-2 transition-transform ${
              currentColor === c.value ? 'scale-110 border-white shadow-md' : 'border-transparent hover:scale-105'
            }`}
            style={{ backgroundColor: c.value }}
            title={c.label}
          />
        ))}
      </div>

      <div className="w-[1px] h-8 bg-chalkboard-border" />

      {/* Nét vẽ Slider */}
      <div className="flex items-center gap-2 px-2">
        <span className="text-xs text-emerald-300 font-mono">Nét</span>
        <input
          type="range"
          min="2"
          max="16"
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-20 accent-emerald-500 cursor-pointer"
        />
      </div>

      <div className="w-[1px] h-8 bg-chalkboard-border" />

      {/* Phân trang Bảng */}
      <div className="flex items-center gap-1.5 text-xs text-emerald-200">
        <button
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="smartboard-btn !w-9 !h-9 bg-chalkboard-light disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-mono px-1">Trang {currentPage}</span>
        <button
          onClick={() => setCurrentPage(currentPage + 1)}
          className="smartboard-btn !w-9 !h-9 bg-chalkboard-light"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
