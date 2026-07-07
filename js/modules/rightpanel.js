// Jobb oldali sáv: fülek (Bútorok / Rétegek) + a bal sidebarhoz hasonló,
// húzással átméretezhető szélesség (localStorage-ban megjegyezve).

import { refreshViewport } from './canvas.js';

const WIDTH_KEY = 'floorplan.rightPanelWidth';
const MIN_W = 200, MAX_W = 480;

export function initRightPanel() {
  initTabs();
  initResizer();
}

function initTabs() {
  const tabs = document.getElementById('right-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', e => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    activateTab(btn.dataset.tab);
  });
}

// máshonnan is hívható (pl. render.js, ha kijelölés miatt a Bútorok fület kell mutatni)
export function activateTab(tab) {
  const tabs = document.getElementById('right-tabs');
  if (!tabs) return;
  for (const b of tabs.querySelectorAll('button[data-tab]')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  for (const p of document.querySelectorAll('#right-panel [data-tabpanel]')) {
    p.hidden = p.dataset.tabpanel !== tab;
  }
}

function initResizer() {
  const resizer = document.getElementById('right-resizer');
  const root = document.documentElement;
  if (!resizer) return;

  let saved = 0;
  try { saved = parseInt(localStorage.getItem(WIDTH_KEY), 10); } catch { /* nincs mentett érték */ }
  if (saved >= MIN_W && saved <= MAX_W) root.style.setProperty('--right-panel-w', `${saved}px`);

  let dragging = false, startX = 0, startW = 0;

  resizer.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = document.getElementById('right-panel').getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    // jobb oldali panel: balra húzva szélesedik, jobbra húzva szűkül
    const w = Math.max(MIN_W, Math.min(MAX_W, startW - (e.clientX - startX)));
    root.style.setProperty('--right-panel-w', `${w}px`);
    refreshViewport();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    try {
      localStorage.setItem(WIDTH_KEY, Math.round(document.getElementById('right-panel').getBoundingClientRect().width));
    } catch { /* localStorage nem elérhető */ }
  });
}
