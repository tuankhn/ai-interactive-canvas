import { create } from 'zustand';
import { ChalkColor, SubjectType, ToolType, AIRecognitionResult } from './types';

interface CanvasState {
  currentTool: ToolType;
  currentColor: ChalkColor;
  brushSize: number;
  subject: SubjectType;
  
  currentPage: number;
  sessionId: string;
  className: string;
  
  isOffline: boolean;
  isAIProcessing: boolean;
  lastAIResult: AIRecognitionResult | null;

  setTool: (tool: ToolType) => void;
  setColor: (color: ChalkColor) => void;
  setBrushSize: (size: number) => void;
  setSubject: (subject: SubjectType) => void;
  setCurrentPage: (page: number) => void;
  setOffline: (offline: boolean) => void;
  setAIProcessing: (processing: boolean) => void;
  setAIResult: (result: AIRecognitionResult | null) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  currentTool: 'pen',
  currentColor: '#f5f5f0',
  brushSize: 4,
  subject: 'MATH',
  
  currentPage: 1,
  sessionId: 'session_demo_10a1',
  className: 'Lớp 10A1',
  
  isOffline: false,
  isAIProcessing: false,
  lastAIResult: null,

  setTool: (tool) => set({ currentTool: tool }),
  setColor: (color) => set({ currentColor: color }),
  setBrushSize: (size) => set({ brushSize: size }),
  setSubject: (subject) => set({ subject }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setOffline: (isOffline) => set({ isOffline }),
  setAIProcessing: (isAIProcessing) => set({ isAIProcessing }),
  setAIResult: (lastAIResult) => set({ lastAIResult }),
}));
