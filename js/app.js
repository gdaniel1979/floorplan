// Belépési pont – a modulok inicializálása.
// Sorrend: előbb a vászon és a feliratkozók (oldalsáv, rajz, automentés),
// utána a betöltés, hogy az első render már a betöltött állapotot mutassa.

import { initCanvas, onViewChange } from './modules/canvas.js';
import { initSidebar } from './modules/sidebar.js';
import { initSaveMenu } from './modules/savemenu.js';
import { initToolbar } from './modules/toolbar.js';
import { initTools } from './modules/tools.js';
import { initHistoryBar } from './modules/historybar.js';
import { initToast } from './modules/toast.js';
import { renderAll } from './modules/render.js';
import { onChange } from './modules/state.js';
import { load, initAutosave } from './modules/storage.js';

initCanvas();
initSidebar();
initSaveMenu();
initTools();
initToolbar();
initHistoryBar();
initToast();
onChange(renderAll);
onViewChange(renderAll);
initAutosave();
load();
