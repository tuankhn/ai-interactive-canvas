import { $, fabricCanvas, stage, ui, state, setStatus } from '../utils/context.js';
import { persistPages } from './pageManager.js';

export function snapshot() {
  return {
    objects: fabricCanvas.getObjects().slice(),
    background: fabricCanvas.backgroundColor || '#ffffff'
  };
}

function stateChanged(before) {
  const currentObjects = fabricCanvas.getObjects();
  return before.background !== fabricCanvas.backgroundColor ||
    before.objects.length !== currentObjects.length ||
    before.objects.some((object, index) => object !== currentObjects[index]);
}

export function updateHistoryButtons() {
  $('undoButton').disabled = state.ended || state.pageBusy || state.undoStack.length === 0;
  $('redoButton').disabled = state.ended || state.pageBusy || state.redoStack.length === 0;
}

export function remember(before) {
  if (!stateChanged(before)) return false;
  state.undoStack.push(before);
  if (state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack = [];
  updateHistoryButtons();
  persistPages();
  return true;
}

export function updateHint() {
  const noObjects = fabricCanvas.getObjects().length === 0;
  ui.hint.classList.toggle('is-hidden', !noObjects);
  ui.hint.classList.toggle('on-dark', fabricCanvas.backgroundColor === '#111827');
}

export function syncBackgroundButtons() {
  const bg = fabricCanvas.backgroundColor || '#ffffff';
  document.querySelectorAll('[data-background]').forEach((button) => {
    const selected = button.dataset.background === bg;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

export function restore(state) {
  const existing = fabricCanvas.getObjects().slice();
  if (existing.length) fabricCanvas.remove(...existing);
  if (state.objects.length) fabricCanvas.add(...state.objects);
  fabricCanvas.backgroundColor = state.background;
  stage.style.backgroundColor = state.background;
  syncBackgroundButtons();
  updateHint();
  fabricCanvas.requestRenderAll();
}

export function undo() {
  if (state.ended || state.pageBusy || state.undoStack.length === 0) return;
  state.redoStack.push(snapshot());
  restore(state.undoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã hoàn tác');
}

export function redo() {
  if (state.ended || state.pageBusy || state.redoStack.length === 0) return;
  state.undoStack.push(snapshot());
  restore(state.redoStack.pop());
  updateHistoryButtons();
  persistPages();
  setStatus('Đã làm lại');
}

export function setupHistoryShortcuts() {
  $('undoButton').addEventListener('click', undo);
  $('redoButton').addEventListener('click', redo);
  document.addEventListener('keydown', (event) => {
    if ($('clearBoardDialog').open || $('deletePageDialog').open) return;
    const element = document.activeElement;
    if (element?.matches('input,textarea,select') || element?.isContentEditable) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    }
  });
}
