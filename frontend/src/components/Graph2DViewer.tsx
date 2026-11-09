'use client';

import React, { useState } from 'react';
import { useCanvasStore } from '@/utils';
import { X, Sliders, Info, LineChart } from 'lucide-react';

export default function Graph2DViewer() {
  const { lastAIResult, setAIResult } = useCanvasStore();
  const [a, setA] = useState(1);
  const [b, setB] = useState(-4);
  const [c, setC] = useState(3);

  if (!lastAIResult || !lastAIResult.visualization) {
    return null;
  }

  const { visualization, explanation } = lastAIResult;

  const vx = (-b / (2 * a)).toFixed(2);
  const vy = (a * Math.pow(-b / (2 * a), 2) + b * (-b / (2 * a)) + c).toFixed(2);

  return (
    <div className="absolute top-20 right-6 z-40 w-96 rounded-2xl bg-chalkboard-dark/95 border border-chalkboard-border shadow-2xl backdrop-blur p-5 text-chalkboard-chalk space-y-4 animate-in fade-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between border-b border-chalkboard-border pb-3">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold text-base">
          <LineChart className="w-5 h-5" />
          <span>{visualization.title || 'Mô Hình Trực Quan Hóa AI'}</span>
        </div>
        <button
          onClick={() => setAIResult(null)}
          className="p-1 rounded-lg text-emerald-300 hover:bg-chalkboard-light transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-3 rounded-xl bg-chalkboard-bg border border-chalkboard-border text-center">
        <span className="text-xs text-emerald-400/80 block mb-1">Công thức nhận diện</span>
        <span className="text-xl font-mono font-bold text-amber-300">
          y = {a !== 1 ? a : ''}x² {b >= 0 ? `+ ${b}` : `- ${Math.abs(b)}`}x {c >= 0 ? `+ ${c}` : `- ${Math.abs(c)}`}
        </span>
      </div>

      <div className="w-full h-44 rounded-xl bg-chalkboard-dark border border-chalkboard-border flex flex-col items-center justify-center relative overflow-hidden p-2">
        <svg viewBox="-10 -10 20 20" className="w-full h-full stroke-emerald-400 fill-none">
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#34594a" strokeWidth="0.4" />
          <line x1="0" y1="-10" x2="0" y2="10" stroke="#34594a" strokeWidth="0.4" />
          <path
            d={`M -5 ${(a * 25 + b * -5 + c) * -1} Q 0 ${(c) * -1} 5 ${(a * 25 + b * 5 + c) * -1}`}
            stroke="#fef08a"
            strokeWidth="0.8"
            fill="none"
          />
        </svg>

        <div className="absolute bottom-2 left-2 text-[11px] font-mono text-emerald-300 bg-chalkboard-bg/80 px-2 py-0.5 rounded">
          Đỉnh I({vx}, {vy})
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <span className="font-medium text-emerald-200">Điều chỉnh hệ số tương tác:</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-chalkboard-light border border-chalkboard-border text-center">
            <span className="block text-[11px] text-emerald-300 mb-1">a = {a}</span>
            <input
              type="range"
              min="-3"
              max="3"
              step="1"
              value={a}
              onChange={(e) => setA(Number(e.target.value) || 1)}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="p-2 rounded-lg bg-chalkboard-light border border-chalkboard-border text-center">
            <span className="block text-[11px] text-emerald-300 mb-1">b = {b}</span>
            <input
              type="range"
              min="-6"
              max="6"
              value={b}
              onChange={(e) => setB(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="p-2 rounded-lg bg-chalkboard-light border border-chalkboard-border text-center">
            <span className="block text-[11px] text-emerald-300 mb-1">c = {c}</span>
            <input
              type="range"
              min="-5"
              max="5"
              value={c}
              onChange={(e) => setC(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {explanation && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-200/90 flex gap-2">
          <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{explanation}</span>
        </div>
      )}
    </div>
  );
}
