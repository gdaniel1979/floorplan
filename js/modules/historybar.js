// Visszavonás/ismétlés gombok a fejlécben + Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) billentyűk.

import { undo, redo, canUndo, canRedo, onHistoryChange } from './history.js';

export function initHistoryBar() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');

  function refresh() {
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  onHistoryChange(refresh);
  refresh();

  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!e.ctrlKey && !e.metaKey) return;

    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      redo();
    }
  });
}
