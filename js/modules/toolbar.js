// Rajzolás-panel: eszközválasztó gombok + falvastagság.

import { ui } from './uistate.js';
import { setTool } from './tools.js';
import { getPlan, wallById } from './plan.js';
import { notify } from './state.js';
import { snapshot, checkpoint } from './history.js';

export function initToolbar() {
  for (const b of document.querySelectorAll('.tool-btn[data-tool]')) {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  }

  const orthoBtn = document.getElementById('ortho-toggle');
  orthoBtn.addEventListener('click', () => {
    ui.orthoOnly = !ui.orthoOnly;
    orthoBtn.classList.toggle('active', ui.orthoOnly);
  });

  const select = document.getElementById('wall-thickness');
  const customRow = document.getElementById('custom-thickness-row');
  const customInput = document.getElementById('custom-thickness');

  function currentThickness() {
    if (select.value === 'custom') {
      const v = parseFloat(customInput.value);
      return v > 0 ? v : 10;
    }
    return parseFloat(select.value);
  }

  function apply() {
    customRow.hidden = select.value !== 'custom';
    ui.thickness = currentThickness();
    // ha épp ki van jelölve egy fal, annak a vastagságát is átállítja
    const plan = getPlan();
    const w = plan && wallById(plan, ui.selectedWallId);
    if (w && w.thickness !== ui.thickness) {
      const before = snapshot();
      w.thickness = ui.thickness;
      notify();
      checkpoint(before);
    }
  }

  select.addEventListener('change', apply);
  customInput.addEventListener('change', apply);
  apply();

  initDoorControls();
  initWindowControls();
}

// a kijelölt objektumra alkalmazza a módosítást, ha az a megadott fajtájú, history-checkponttal
function applyToSelectedObject(kind, mutate) {
  const plan = getPlan();
  const obj = plan && plan.objects.find(o => o.id === ui.selectedObjectId && o.kind === kind);
  if (!obj) return;
  const before = snapshot();
  mutate(obj);
  notify();
  checkpoint(before);
}

function initDoorControls() {
  const flipHingeBtn = document.getElementById('door-flip-hinge');
  const flipSideBtn = document.getElementById('door-flip-side');
  const withLeafSelect = document.getElementById('door-with-leaf');

  flipHingeBtn.addEventListener('click', () => {
    ui.doorFlipHinge = !ui.doorFlipHinge;
    flipHingeBtn.classList.toggle('active', ui.doorFlipHinge);
    applyToSelectedObject('door', o => { o.flipHinge = ui.doorFlipHinge; });
  });

  flipSideBtn.addEventListener('click', () => {
    ui.doorFlipSide = !ui.doorFlipSide;
    flipSideBtn.classList.toggle('active', ui.doorFlipSide);
    applyToSelectedObject('door', o => { o.flipSide = ui.doorFlipSide; });
  });

  withLeafSelect.addEventListener('change', () => {
    ui.doorWithLeaf = withLeafSelect.value === 'leaf';
    applyToSelectedObject('door', o => { o.withLeaf = ui.doorWithLeaf; });
  });
}

function initWindowControls() {
  const sashSelect = document.getElementById('window-sash-count');
  const flipSideBtn = document.getElementById('window-flip-side');

  sashSelect.addEventListener('change', () => {
    ui.windowSashCount = sashSelect.value === '2' ? 2 : 1;
    applyToSelectedObject('window', o => { o.sashCount = ui.windowSashCount; });
  });

  flipSideBtn.addEventListener('click', () => {
    ui.windowFlipSide = !ui.windowFlipSide;
    flipSideBtn.classList.toggle('active', ui.windowFlipSide);
    applyToSelectedObject('window', o => { o.flipSide = ui.windowFlipSide; });
  });
}
