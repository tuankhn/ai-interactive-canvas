'use client';

import React from 'react';
import SmartCanvas from '@/components/SmartCanvas';
import Toolbar from '@/components/Toolbar';
import Graph2DViewer from '@/components/Graph2DViewer';

export default function BoardPage() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-chalkboard-bg">
      <SmartCanvas />
      <Toolbar />
      <Graph2DViewer />
    </main>
  );
}
