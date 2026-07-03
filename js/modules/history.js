// Visszavonás/ismétlés: a teljes állapot pillanatképeit tárolja.
// checkpoint(before) csak akkor kerül a verembe, ha a mentés óta tényleg
// változott valami — így a mozdulatlan húzások nem hoznak létre üres lépést.

import { getState, setState } from './state.js';

const undoStack = [];
const redoStack = [];
const MAX = 200;
const listeners = [];

function clone(s) { return JSON.parse(JSON.stringify(s)); }

export function snapshot() { return clone(getState()); }

export function checkpoint(before) {
  if (JSON.stringify(before) === JSON.stringify(getState())) return;
  undoStack.push(before);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
  emit();
}

// segéd: snapshot + fn futtatása + checkpoint egy lépésben
export function withHistory(fn) {
  const before = snapshot();
  const result = fn();
  checkpoint(before);
  return result;
}

export function undo() {
  if (!undoStack.length) return;
  const cur = snapshot();
  const prev = undoStack.pop();
  redoStack.push(cur);
  setState(prev);
  emit();
}

export function redo() {
  if (!redoStack.length) return;
  const cur = snapshot();
  const next = redoStack.pop();
  undoStack.push(cur);
  setState(next);
  emit();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function onHistoryChange(fn) { listeners.push(fn); }
function emit() { for (const fn of listeners) fn(); }
