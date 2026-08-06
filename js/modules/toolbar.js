// Rajzolás-panel: eszközválasztó gombok + falvastagság.

import { ui } from './uistate.js';
import { setTool } from './tools.js';
import { getPlan, wallById, setWallInteriorLength } from './plan.js';
import { notify } from './state.js';
import { snapshot, checkpoint } from './history.js';
import { CATALOG, LAYER_LABELS, setFurnitureSize, setFurnitureRotation, clearFurniture, setStairSteps, setStairDir } from './furniture.js';
import { setRoomHeight } from './rooms.js';
import { LAYER_GROUPS, setLayer, setGroup, groupState } from './layers.js';
import { resizeObject, setObjectHeight } from './objects.js';

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
  initFurnitureControls();
  initSurfacesControls();
}

// helyiségenkénti belmagasság-mező — a lista tartalma render.js-ben (dinamikusan,
// helyiségenként) épül újra, ezért itt a STABIL szülő konténerre iratkozunk fel
// (esemény-delegálás), nem az egyes (újra és újra létrejövő) input elemekre
function initSurfacesControls() {
  const container = document.getElementById('surfaces-list');
  if (!container) return;
  container.addEventListener('change', e => {
    const input = e.target.closest('.surface-height');
    if (!input) return;
    const v = parseFloat(input.value);
    if (!(v > 0)) return;
    const before = snapshot();
    setRoomHeight(getPlan(), input.dataset.room, v);
    checkpoint(before);
  });
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
    setWallInteriorLength(plan, w, v, ui.wallGrow); // a mező belméretet mutat
    checkpoint(before);
  });

  const growSelect = document.getElementById('wall-sel-grow');
  growSelect?.addEventListener('change', () => { ui.wallGrow = growSelect.value; });

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

  initSizeInput('door-width', 'door', 'doorWidth', (plan, o, v) => resizeObject(plan, o, v));
  initSizeInput('door-height', 'door', 'doorHeight', (plan, o, v) => setObjectHeight(plan, o, v));
}

// egy nyílászáró méret-mezője: a kijelölt nyílászárót módosítja (ha van), és
// egyben az új nyílászárók alapértékét is beállítja
function initSizeInput(inputId, kind, uiKey, apply) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!(v > 0)) return;
    ui[uiKey] = v;
    const obj = selectedOfKind(kind);
    if (!obj) return;
    const before = snapshot();
    apply(getPlan(), obj, v);
    checkpoint(before);
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

  initSizeInput('window-width', 'window', 'windowWidth', (plan, o, v) => resizeObject(plan, o, v));
  initSizeInput('window-height', 'window', 'windowHeight', (plan, o, v) => setObjectHeight(plan, o, v));
}

// Rétegek panel: fő csoportonként egy összevont kapcsoló, alatta behúzva a
// részletes alkapcsolók. A fő kapcsoló mindent visz a csoportban, és
// félig-bepipált (indeterminate) állapotot mutat, ha az alrétegek vegyesek.
// A csoportok egymástól függetlenül csukhatók össze (a nyílra vagy a névre
// kattintva) — a becsukás csak a lista megjelenítését érinti, a rétegek
// láthatóságát nem.
function buildLayerTree() {
  const tree = document.getElementById('layer-tree');
  if (!tree) return;

  for (const group of LAYER_GROUPS) {
    const wrap = document.createElement('div');
    wrap.className = 'layer-group';

    // a fejléc nem <label>, hogy a névre kattintás összecsukjon és NE a
    // jelölőnégyzetet kapcsolja — a négyzetre kattintás natívan működik
    const head = document.createElement('div');
    head.className = 'layer-group-head';
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▾';
    const groupBox = document.createElement('input');
    groupBox.type = 'checkbox';
    const groupName = document.createElement('span');
    groupName.className = 'name';
    groupName.textContent = group.label;
    head.append(caret, groupBox, groupName);

    const children = document.createElement('ul');
    children.className = 'layer-children';
    const childBoxes = [];

    for (const child of group.children) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!ui.layerVisible[child.key];
      box.addEventListener('change', () => {
        setLayer(child.key, box.checked);
        syncGroupBox();
      });
      const text = document.createElement('span');
      text.textContent = child.label;
      label.append(box, text);
      li.appendChild(label);
      children.appendChild(li);
      childBoxes.push(box);
    }

    function syncGroupBox() {
      const state = groupState(group);
      groupBox.checked = state !== 'none';
      groupBox.indeterminate = state === 'some';
    }

    groupBox.addEventListener('change', () => {
      // vegyes állapotból az első kattintás mindent bekapcsol
      const visible = groupBox.checked;
      setGroup(group.key, visible);
      for (const box of childBoxes) box.checked = visible;
      syncGroupBox();
    });

    // összecsukás: minden csoport önállóan, egymást nem befolyásolva
    function toggleCollapsed() {
      const collapsed = !children.hidden;
      children.hidden = collapsed;
      caret.textContent = collapsed ? '▸' : '▾';
      wrap.classList.toggle('collapsed', collapsed);
    }
    caret.addEventListener('click', toggleCollapsed);
    groupName.addEventListener('click', toggleCollapsed);

    syncGroupBox();
    wrap.append(head, children);
    tree.appendChild(wrap);
  }
}

// bútor-paletta: kategória-választás → tárgy-választás → elhelyezési mód,
// plusz a kijelölt tárgy méret/forgatás mezői (render.js szinkronizálja az
// értéküket a kijelölés váltásakor/húzás közben — updateFurnitureOptionsPanel)
function initFurnitureControls() {
  const tree = document.getElementById('furniture-tree');

  for (const category of Object.keys(CATALOG)) {
    const group = document.createElement('div');
    group.className = 'furn-cat-group';

    const row = document.createElement('div');
    row.className = 'furn-cat-row';
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▸';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = LAYER_LABELS[category] || category;
    row.append(caret, name);

    const items = document.createElement('ul');
    items.className = 'furn-items';
    items.hidden = true;

    for (const def of CATALOG[category]) {
      const li = document.createElement('li');
      li.className = 'furn-item';
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = def.label;
      const dims = document.createElement('span');
      dims.className = 'muted';
      dims.textContent = `${def.w}×${def.h}`;
      li.append(label, dims);
      li.addEventListener('click', () => {
        ui.furnitureCategory = category;
        ui.furniturePendingType = def.type;
        setTool('furniture');
        for (const other of tree.querySelectorAll('.furn-item')) other.classList.toggle('active', other === li);
      });
      items.appendChild(li);
    }

    row.addEventListener('click', () => {
      const willOpen = items.hidden;
      items.hidden = !willOpen;
      caret.textContent = willOpen ? '▾' : '▸';
    });

    group.append(row, items);
    tree.appendChild(group);
  }

  function selectedFurniture() {
    const plan = getPlan();
    return plan && plan.furniture.find(f => f.id === ui.selectedFurnitureId);
  }

  const widthInput = document.getElementById('furniture-sel-width');
  const depthInput = document.getElementById('furniture-sel-depth');
  const rotInput = document.getElementById('furniture-sel-rotation');

  widthInput.addEventListener('change', () => {
    const item = selectedFurniture();
    const v = parseFloat(widthInput.value);
    if (!item || !(v > 0)) return;
    const before = snapshot();
    setFurnitureSize(getPlan(), item, v, null);
    checkpoint(before);
  });

  depthInput.addEventListener('change', () => {
    const item = selectedFurniture();
    const v = parseFloat(depthInput.value);
    if (!item || !(v > 0)) return;
    const before = snapshot();
    setFurnitureSize(getPlan(), item, null, v);
    checkpoint(before);
  });

  const stepsInput = document.getElementById('stair-steps');
  stepsInput?.addEventListener('change', () => {
    const item = selectedFurniture();
    const v = parseFloat(stepsInput.value);
    if (!item || !(v >= 2)) return;
    const before = snapshot();
    setStairSteps(getPlan(), item, v);
    checkpoint(before);
  });

  const dirSelect = document.getElementById('stair-dir');
  dirSelect?.addEventListener('change', () => {
    const item = selectedFurniture();
    if (!item) return;
    const before = snapshot();
    setStairDir(getPlan(), item, dirSelect.value);
    checkpoint(before);
  });

  rotInput.addEventListener('change', () => {
    const item = selectedFurniture();
    const v = parseFloat(rotInput.value);
    if (!item || Number.isNaN(v)) return;
    const before = snapshot();
    setFurnitureRotation(getPlan(), item, v);
    checkpoint(before);
  });

  buildLayerTree();

  // véletlenül felhalmozott bútor-tárgyak gyors eltávolítása (pl. ha az
  // elhelyezés-mód ragadva maradt, és sok tárgy rakódott le egymás után)
  const clearBtn = document.getElementById('clear-furniture-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const plan = getPlan();
      if (!plan || !plan.furniture.length) return;
      if (!confirm(`Törlöd mind a(z) ${plan.furniture.length} elhelyezett bútor-tárgyat? Ctrl+Z-vel visszavonható.`)) return;
      const before = snapshot();
      clearFurniture(plan);
      checkpoint(before);
    });
  }
}
