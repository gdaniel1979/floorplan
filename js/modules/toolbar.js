// Rajzolás-panel: eszközválasztó gombok + falvastagság.

import { ui } from './uistate.js';
import { setTool } from './tools.js';
import { getPlan, wallById, setWallLength } from './plan.js';
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
  }

  select.addEventListener('change', apply);
  customInput.addEventListener('change', apply);
  apply();

  initDoorControls();
  initWindowControls();
  initWallOptionsControls();
}

// a kijelölt fal saját hossz-/vastagság-szerkesztője (render.js szinkronizálja
// a mezők ÉRTÉKÉT a kijelölés váltásakor/húzás közben — updateWallOptionsPanel)
function initWallOptionsControls() {
  const lengthInput = document.getElementById('wall-sel-length');
  const thickSelect = document.getElementById('wall-sel-thickness');
  const customRow = document.getElementById('wall-sel-custom-row');
  const customInput = document.getElementById('wall-sel-custom-thickness');

  function selectedWall() {
    const plan = getPlan();
    return plan && wallById(plan, ui.selectedWallId);
  }

  lengthInput.addEventListener('change', () => {
    const w = selectedWall();
    const v = parseFloat(lengthInput.value);
    if (!w || !(v > 0)) return;
    const plan = getPlan();
    const before = snapshot();
    setWallLength(plan, w, v);
    checkpoint(before);
  });

  function applyThickness() {
    const w = selectedWall();
    if (!w) return;
    customRow.hidden = thickSelect.value !== 'custom';
    const v = thickSelect.value === 'custom' ? parseFloat(customInput.value) : parseFloat(thickSelect.value);
    if (!(v > 0) || w.thickness === v) return;
    const before = snapshot();
    w.thickness = v;
    notify();
    checkpoint(before);
  }

  thickSelect.addEventListener('change', applyThickness);
  customInput.addEventListener('change', applyThickness);
}

// a kijelölt (adott fajtájú) nyílászáró, vagy null, ha nincs ilyen kijelölve —
// ez adja meg, hogy egy vezérlő a kijelölt objektum TÉNYLEGES állapotát
// olvassa-e (szerkesztéskor), vagy csak az új-nyílászáró alapértéket (ui.*)
function selectedOfKind(kind) {
  const plan = getPlan();
  return plan && plan.objects.find(o => o.id === ui.selectedObjectId && o.kind === kind);
}

// a kijelölt objektumra alkalmazza a módosítást, ha az a megadott fajtájú, history-checkponttal
function applyToSelectedObject(kind, mutate) {
  const obj = selectedOfKind(kind);
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

  // minden gomb a KIJELÖLT ajtó tényleges állapotából indul ki (ha van ilyen),
  // nem a esetleg elavult ui.door* alapértékből — így a gomb a valódi
  // "jelenlegi állapot ellentettjét" állítja be, nem egy véletlenszerű régi értéket
  flipHingeBtn.addEventListener('click', () => {
    const obj = selectedOfKind('door');
    ui.doorFlipHinge = !(obj ? obj.flipHinge : ui.doorFlipHinge);
    flipHingeBtn.classList.toggle('active', ui.doorFlipHinge);
    applyToSelectedObject('door', o => { o.flipHinge = ui.doorFlipHinge; });
  });

  flipSideBtn.addEventListener('click', () => {
    const obj = selectedOfKind('door');
    ui.doorFlipSide = !(obj ? obj.flipSide : ui.doorFlipSide);
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
    const obj = selectedOfKind('window');
    ui.windowFlipSide = !(obj ? obj.flipSide : ui.windowFlipSide);
    flipSideBtn.classList.toggle('active', ui.windowFlipSide);
    applyToSelectedObject('window', o => { o.flipSide = ui.windowFlipSide; });
  });
}
