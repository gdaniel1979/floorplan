// Az aktív szint rajzának megjelenítése: falak (sraffozott, professzionális
// kinézettel), nyílászárók, láncolt külső méretvonalak, helyiség-körvonalak,
// kijelölés és fogantyúk. Minden változáskor (állapot, nézet, eszköz) teljes
// újrarajzolás.

import { el, getContent, getOverlay, getScale, setGridVisible, setOriginVisible } from './canvas.js';
import { getPlan, nodeById, wallById, wallLengthOf, wallInteriorLengthOf, endDeductionAt, throughPartner, wallClearances } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';
import { getRoomTrace, polygonToPathD } from './rooms.js';
import { objectGeometry, objectHeight } from './objects.js';
import { getDimensionChains, wallOnChains, exteriorSilhouette, wallShapeHoles } from './exterior.js';
import { rotatedPoint, rotateHandlePoint } from './furniture.js';
import { computeRoomSurfaces } from './surfaces.js';

export function renderAll() {
  const content = getContent();
  const overlay = getOverlay();
  content.innerHTML = '';
  overlay.innerHTML = '';

  setGridVisible(ui.layerVisible.grid);
  setOriginVisible(ui.layerVisible.origin);

  const plan = getPlan();
  if (!plan) return;
  const s = getScale();

  // helyiség-körvonalak legalul (nincs szín-kitöltés a rajzon — a szín csak
  // adatként/jegyzetként tárolódik), hogy a falak mindig felettük maradjanak
  const roomTraces = new Map(); // roomId -> nyomvonal, hogy a címke-rajzolásnál ne kelljen újraszámolni
  for (const room of plan.rooms) {
    const trace = getRoomTrace(plan, room);
    if (!trace) continue;
    roomTraces.set(room.id, trace);
    content.appendChild(el('path', {
      d: polygonToPathD(trace.poly), class: 'room-fill', 'data-room': room.id,
    }));
    if (room.id === ui.selectedRoomId) {
      overlay.appendChild(el('path', {
        d: polygonToPathD(trace.poly), class: 'room-selected', 'stroke-width': 2 / s,
      }));
    }
  }

  // fal-test: EGYETLEN, kontúrkövetéssel kikövetkeztetett sraffozott alak az
  // egész (egyenes falakból álló) fal-hálózatra, kilyukasztva a helyiségekkel
  // és a nyílászáró-résekkel — ezért nincs a csatlakozásoknál külön-külön
  // körvonal (varrat), mint a régi, falanként-külön-téglalapos rajzolásnál
  const wallPath = wallShapePathD(plan);
  if (wallPath) {
    content.appendChild(el('path', {
      d: wallPath, class: 'wall-body', 'fill-rule': 'evenodd', 'stroke-width': 1 / s,
    }));
  }

  // ívelt falak (nincs sraffozás, ismert korlát) + minden falhoz láthatatlan,
  // széles kattintható sáv (a nyílászáró-réseket kihagyva)
  for (const w of plan.walls) {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    if (w.bulge) {
      const d = G.wallPathD(a, b, w.bulge);
      content.appendChild(el('path', { d, class: 'wall-body-arc', 'stroke-width': w.thickness }));
      content.appendChild(el('path', {
        d, class: 'wall-hit', 'stroke-width': Math.max(w.thickness + 12 / s, 16 / s), 'data-wall': w.id,
      }));
      continue;
    }
    const wallObjects = plan.objects.filter(o => o.wallId === w.id);
    if (wallObjects.length) appendWallHitWithOpenings(content, a, b, w, wallObjects, s);
    else appendWallHit(content, a, b, w, s);
  }

  // nyílászárók (ajtó/ablak) — mindig láthatók, a fal-réteg része; a
  // méretjelölésük (szélesség/magasság) viszont külön réteg
  for (const obj of plan.objects) {
    const geo = objectGeometry(plan, obj);
    if (!geo) continue;
    content.appendChild(objectSymbol(obj, geo, s));
    if (ui.layerVisible.openingSizes) overlay.appendChild(openingSizeLabel(plan, obj, geo, s));
    if (obj.id === ui.selectedObjectId) {
      overlay.appendChild(el('line', {
        x1: geo.p1.x, y1: geo.p1.y, x2: geo.p2.x, y2: geo.p2.y,
        class: 'object-selected', 'stroke-width': geo.wall.thickness + 6 / s,
      }));
      overlay.appendChild(handle(geo.p1.x, geo.p1.y, s, 'objP1', { 'data-object': obj.id }));
      overlay.appendChild(handle(geo.p2.x, geo.p2.y, s, 'objP2', { 'data-object': obj.id }));
      overlay.appendChild(handle(geo.center.x, geo.center.y, s, 'objCenter', { 'data-object': obj.id }, true));
    }
  }

  // bútor-tárgyak (szaniter/konyha/bútor/épületelem) — kategóriánként a
  // Rétegek panelen ki-/bekapcsolható, a falak/nyílászárók mindig látszanak
  for (const item of plan.furniture) {
    if (!ui.layerVisible[item.category]) continue;
    content.appendChild(furnitureSymbol(item, s));
    if (item.id === ui.selectedFurnitureId) {
      overlay.appendChild(el('rect', {
        x: item.x - item.w / 2, y: item.y - item.h / 2, width: item.w, height: item.h,
        class: 'furniture-selected', 'stroke-width': 2 / s,
        transform: `rotate(${item.rotation} ${item.x} ${item.y})`,
      }));
      const edge = rotatedPoint(item, 0, -item.h / 2);
      const hp = rotateHandlePoint(item);
      overlay.appendChild(el('line', {
        x1: edge.x, y1: edge.y, x2: hp.x, y2: hp.y,
        class: 'furniture-rotate-line', 'stroke-width': 1 / s,
      }));
      overlay.appendChild(el('circle', {
        cx: hp.x, cy: hp.y, r: 6 / s, class: 'furniture-rotate-handle',
        'data-furniture': item.id, 'data-handle': 'furnitureRotate', 'stroke-width': 1.5 / s,
      }));
    }
  }

  // kijelölt fal kiemelése + fogantyúk
  const sel = plan.walls.find(w => w.id === ui.selectedWallId);
  if (sel) {
    const a = nodeById(plan, sel.a), b = nodeById(plan, sel.b);
    if (a && b) {
      overlay.appendChild(el('path', {
        d: G.wallPathD(a, b, sel.bulge || 0),
        class: 'wall-selected', 'stroke-width': sel.thickness,
      }));
      // Az ív-fogantyú a fal MELLETT ül, nem a közepén: a fal közepe a
      // legkézenfekvőbb hely a megfogásra, ha valaki arrébb akarja tolni a
      // falat — ha ott az ív-fogantyú volt, oldalra húzva véletlenül
      // meggörbítette. Az ívelt fal pedig nem sraffozottan, hanem vékony
      // vonalként rajzolódik, ezért úgy tűnt, mintha a fal eltűnt volna.
      const m = sel.bulge ? G.arcMidpoint(a, b, sel.bulge) : G.mid(a, b);
      const nrm = G.normal(a, b);
      const side = sel.bulge ? Math.sign(sel.bulge) : 1;
      const off = sel.thickness / 2 + 16 / s;
      const hp = { x: m.x + nrm.x * off * side, y: m.y + nrm.y * off * side };

      overlay.appendChild(handle(a.x, a.y, s, 'a', { 'data-wall': sel.id }));
      overlay.appendChild(handle(b.x, b.y, s, 'b', { 'data-wall': sel.id }));
      overlay.appendChild(el('line', {
        x1: m.x, y1: m.y, x2: hp.x, y2: hp.y,
        class: 'bulge-handle-line', 'stroke-width': 1 / s,
      }));
      overlay.appendChild(handle(hp.x, hp.y, s, 'mid', { 'data-wall': sel.id }, true));

      // szabad távolság a két oldalán lévő szomszédos falig — húzás közben is
      // frissül, így látszik, mekkorák lesznek a szomszédos helyiségek
      const clear = clearanceLabels(plan, sel, s);
      if (clear) overlay.appendChild(clear);
    }
  }

  // láncolt külső méretvonalak (a sziluett éleire), + a bennük NEM szereplő
  // (belső) falakra a hossz-címke marad — a T-elágazásnál szétvágott, de
  // vizuálisan egyenesen folytatódó fal-szakaszokat egy közös címkével látjuk
  // el (különben minden szakasz saját, apró hossz-számot írna ki egymás alá)
  const chains = getDimensionChains(plan);
  if (ui.layerVisible.dimChains) {
    for (const chain of chains) renderDimensionChain(overlay, chain, s);
  }

  if (ui.layerVisible.wallLengths) {
    for (const run of buildInteriorWallRuns(plan)) {
      if (run.walls.some(w => wallOnChains(plan, w, chains))) continue; // ezt már a méretlánc jelzi
      if (run.walls.length === 1) {
        const w = run.walls[0];
        const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
        if (!a || !b) continue;
        overlay.appendChild(lengthLabel(plan, w, a, b, s));
      } else {
        overlay.appendChild(wallRunLengthLabel(plan, run, s));
      }
    }
  }

  // helyiség-címke-blokk: név / terület / belmagasság, soronként külön réteg
  for (const room of plan.rooms) {
    const trace = roomTraces.get(room.id);
    if (!trace) continue;
    const label = roomLabel(room, trace, s);
    if (label) overlay.appendChild(label);
  }

  updateDoorWindowPanel(plan);
  updateWallOptionsPanel(plan);
  updateFurnitureOptionsPanel(plan);
  updateSurfacesPanel(plan);
}

// helyiségenkénti belmagasság + fal-felület panel — a fókuszban lévő
// belmagasság-mezőt nem írja felül (ne szakítsa félbe a gépelést)
function updateSurfacesPanel(plan) {
  const container = document.getElementById('surfaces-list');
  if (!container || container.contains(document.activeElement)) return;

  const surfaces = computeRoomSurfaces(plan);
  container.innerHTML = '';
  for (const room of plan.rooms) {
    const s = surfaces.get(room.id) || { floorAreaM2: 0, netWallAreaM2: 0 };

    const row = document.createElement('div');
    row.className = 'surface-row';

    const head = document.createElement('div');
    head.className = 'surface-row-head';
    const name = document.createElement('span');
    name.className = 'surface-name';
    name.textContent = room.name;
    const floor = document.createElement('span');
    floor.className = 'muted';
    floor.textContent = `${s.floorAreaM2.toFixed(1)} m² padló`;
    head.append(name, floor);

    const heightRow = document.createElement('div');
    heightRow.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = 'Belmagasság (cm)';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'surface-height';
    input.dataset.room = room.id;
    input.min = '1';
    input.step = '1';
    input.value = room.height;
    heightRow.append(label, input);

    const wallArea = document.createElement('div');
    wallArea.className = 'surface-wall-area muted';
    wallArea.textContent = `${s.netWallAreaM2.toFixed(1)} m² fal (nettó, nyílászárók nélkül)`;

    row.append(head, heightRow, wallArea);
    container.appendChild(row);
  }
}

// --- bútor-tárgyak (szaniter/konyha/bútor/épületelem) ---

// egy bútor-tárgy szimbóluma: középpontra igazított, forgatott téglalap +
// középre írt felirat (a felirat is együtt forog a téglalappal)
function furnitureSymbol(item, s) {
  const g = el('g', {
    class: 'furniture-symbol', transform: `rotate(${item.rotation} ${item.x} ${item.y})`,
  });
  g.appendChild(el('rect', {
    x: item.x - item.w / 2, y: item.y - item.h / 2, width: item.w, height: item.h,
    class: 'furniture-body', 'data-furniture': item.id, 'stroke-width': 1 / s,
  }));
  if (ui.layerVisible.furnitureLabels) {
    const label = el('text', {
      x: item.x, y: item.y, class: 'furniture-label', 'font-size': 11 / s,
    });
    label.textContent = item.label;
    g.appendChild(label);
  }
  return g;
}

// a kijelölt bútor panelje (típus + méret + forgatás) — csak kijelölt
// tárgynál látszik, a mezők mindig az AKTUÁLIS értékét mutatják
function updateFurnitureOptionsPanel(plan) {
  const panel = document.getElementById('furniture-options');
  const item = plan.furniture.find(f => f.id === ui.selectedFurnitureId);
  if (panel) panel.hidden = !item;
  if (!item) return;

  const labelEl = document.getElementById('furniture-sel-label');
  if (labelEl) labelEl.textContent = item.label;

  const widthInput = document.getElementById('furniture-sel-width');
  if (widthInput && document.activeElement !== widthInput) widthInput.value = item.w;

  const depthInput = document.getElementById('furniture-sel-depth');
  if (depthInput && document.activeElement !== depthInput) depthInput.value = item.h;

  const rotInput = document.getElementById('furniture-sel-rotation');
  if (rotInput && document.activeElement !== rotInput) rotInput.value = item.rotation;
}

// az ajtó-/ablak-opciók az oldalsávban csak akkor látszanak, ha az adott
// eszköz aktív, vagy épp olyan fajtájú nyílászáró van kijelölve — kijelölt
// nyílászárónál a vezérlők a TÉNYLEGES állapotát mutatják, különben az új
// nyílászárókra vonatkozó (ui.door*/ui.window*) alapértéket
function updateDoorWindowPanel(plan) {
  const sel = plan.objects.find(o => o.id === ui.selectedObjectId);
  const doorOptions = document.getElementById('door-options');
  const windowOptions = document.getElementById('window-options');
  const showDoor = ui.tool === 'door' || sel?.kind === 'door';
  const showWindow = ui.tool === 'window' || sel?.kind === 'window';
  if (doorOptions) doorOptions.hidden = !showDoor;
  if (windowOptions) windowOptions.hidden = !showWindow;

  if (showDoor) syncDoorControls(sel?.kind === 'door' ? sel : null);
  if (showWindow) syncWindowControls(sel?.kind === 'window' ? sel : null);
}

function syncDoorControls(door) {
  const withLeafSelect = document.getElementById('door-with-leaf');
  const flipHingeBtn = document.getElementById('door-flip-hinge');
  const flipSideBtn = document.getElementById('door-flip-side');
  const withLeaf = door ? door.withLeaf !== false : ui.doorWithLeaf;
  if (withLeafSelect && document.activeElement !== withLeafSelect) withLeafSelect.value = withLeaf ? 'leaf' : 'opening';
  if (flipHingeBtn) flipHingeBtn.classList.toggle('active', door ? !!door.flipHinge : ui.doorFlipHinge);
  if (flipSideBtn) flipSideBtn.classList.toggle('active', door ? !!door.flipSide : ui.doorFlipSide);
  syncSizeInput('door-width', door ? Math.round(door.width) : ui.doorWidth);
  syncSizeInput('door-height', door ? Math.round(objectHeight(door)) : ui.doorHeight);
}

// a méret-mező a kijelölt nyílászáró tényleges méretét mutatja (húzás közben
// is frissül), kijelölés nélkül az új nyílászárók alapértékét — a fókuszban
// lévő mezőt sosem írja felül, hogy gépelés közben ne ugorjon
function syncSizeInput(id, value) {
  const input = document.getElementById(id);
  if (input && document.activeElement !== input) input.value = value;
}

function syncWindowControls(win) {
  const sashSelect = document.getElementById('window-sash-count');
  const flipSideBtn = document.getElementById('window-flip-side');
  const sashCount = win ? win.sashCount : ui.windowSashCount;
  if (sashSelect && document.activeElement !== sashSelect) sashSelect.value = String(sashCount);
  if (flipSideBtn) flipSideBtn.classList.toggle('active', win ? !!win.flipSide : ui.windowFlipSide);
  syncSizeInput('window-width', win ? Math.round(win.width) : ui.windowWidth);
  syncSizeInput('window-height', win ? Math.round(objectHeight(win)) : ui.windowHeight);
}

// a kijelölt fal panelje (hossz + vastagság) — csak kijelölt falnál látszik,
// a mezők mindig a fal AKTUÁLIS értékét mutatják (húzás közben is frissül).
// A fókuszban lévő mezőt nem írja felül, hogy a gépelés közben ne ugorjon.
function updateWallOptionsPanel(plan) {
  const panel = document.getElementById('wall-options');
  const w = wallById(plan, ui.selectedWallId);
  if (panel) panel.hidden = !w;
  if (!w) return;

  const lengthInput = document.getElementById('wall-sel-length');
  if (lengthInput && document.activeElement !== lengthInput) {
    lengthInput.value = Math.round(wallInteriorLengthOf(plan, w));
  }

  updateGrowSelect(plan, w);

  const thickSelect = document.getElementById('wall-sel-thickness');
  const customRow = document.getElementById('wall-sel-custom-row');
  const customInput = document.getElementById('wall-sel-custom-thickness');
  if (thickSelect && customInput && document.activeElement !== thickSelect && document.activeElement !== customInput) {
    const preset = [...thickSelect.options].some(o => o.value !== 'custom' && parseFloat(o.value) === w.thickness);
    thickSelect.value = preset ? String(w.thickness) : 'custom';
    customRow.hidden = preset;
    if (!preset) customInput.value = w.thickness;
  }
}

// A "Merre nőjön" választó feliratai a fal tényleges állásából jönnek (fel/le,
// balra/jobbra), mert a belső "a"/"b" végpont-elnevezés a rajzolás sorrendjéből
// adódik, és a felhasználónak semmit nem mondana. Új fal kijelölésekor
// visszaáll automatikusra.
let growSelectWallId = null;

function updateGrowSelect(plan, w) {
  const sel = document.getElementById('wall-sel-grow');
  if (!sel) return;
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b) return;

  if (growSelectWallId !== w.id) {
    growSelectWallId = w.id;
    ui.wallGrow = 'auto';
    sel.value = 'auto';
  }

  const [optA, optB] = [sel.querySelector('option[value="a"]'), sel.querySelector('option[value="b"]')];
  // az "a" opció azt jelenti: az `a` végpont mozdul el — vagyis a fal abba az
  // irányba nő, amerre az `a` vég van a `b`-hez képest
  optA.textContent = directionLabel(b, a);
  optB.textContent = directionLabel(a, b);
}

function directionLabel(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'Jobbra' : 'Balra';
  return dy >= 0 ? 'Lefelé' : 'Felfelé';
}

// --- fal-alak: egyetlen kontúrkövetett, sraffozott sokszög ---

// a teljes fal-hálózat "evenodd" útvonala: a külső sziluett + minden falak
// által körülzárt üres folt (helyiség-szerű lyuk) + minden nyílászáró saját
// kis kivágása — így a sraffozott terület pontosan a valódi, egybefüggő
// falanyagot fedi, egyetlen körvonallal, varrat-vonalak nélkül
function wallShapePathD(plan) {
  const outer = exteriorSilhouette(plan);
  if (!outer) return null;

  let d = polygonToPathD(outer);
  for (const hole of wallShapeHoles(plan)) d += ' ' + polygonToPathD(hole);

  for (const w of plan.walls) {
    if (w.bulge) continue; // az ívelt falak külön, saját rétegükben rajzolódnak
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    for (const o of plan.objects) {
      if (o.wallId !== w.id) continue;
      d += ' ' + openingCutoutPathD(a, b, w, o);
    }
  }
  return d;
}

// egy nyílászáró helyén a fal testéből kivágandó kis téglalap (a fal teljes
// vastagságában, a nyílás szélességében)
function openingCutoutPathD(a, b, w, o) {
  const dir = G.unit(a, b);
  const n = G.normal(a, b);
  const h = w.thickness / 2;
  const t0 = o.offset - o.width / 2, t1 = o.offset + o.width / 2;
  const p0 = { x: a.x + dir.x * t0, y: a.y + dir.y * t0 };
  const p1 = { x: a.x + dir.x * t1, y: a.y + dir.y * t1 };
  const c1 = { x: p0.x + n.x * h, y: p0.y + n.y * h };
  const c2 = { x: p1.x + n.x * h, y: p1.y + n.y * h };
  const c3 = { x: p1.x - n.x * h, y: p1.y - n.y * h };
  const c4 = { x: p0.x - n.x * h, y: p0.y - n.y * h };
  return `M ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} L ${c4.x} ${c4.y} Z`;
}

// --- fal-testek láthatatlan, széles kattintható sávjai (kijelöléshez/húzáshoz) ---

function appendWallHit(content, a, b, w, s) {
  content.appendChild(el('path', {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, class: 'wall-hit',
    'stroke-width': Math.max(w.thickness + 12 / s, 16 / s), 'data-wall': w.id,
  }));
}

// a nyílászárók helyén megszakítva (ott nincs fal, hanem a nyílászáró saját találati sávja van)
function appendWallHitWithOpenings(content, a, b, w, wallObjects, s) {
  const dir = G.unit(a, b);
  const totalLen = G.dist(a, b);
  const sorted = [...wallObjects].sort((x, y) => x.offset - y.offset);

  let cursor = 0;
  for (const o of sorted) {
    const openStart = o.offset - o.width / 2;
    if (openStart > cursor) appendWallHitBetween(content, a, dir, cursor, openStart, w, s);
    cursor = o.offset + o.width / 2;
  }
  if (cursor < totalLen) appendWallHitBetween(content, a, dir, cursor, totalLen, w, s);
}

function appendWallHitBetween(content, a, dir, t0, t1, w, s) {
  const p0 = { x: a.x + dir.x * t0, y: a.y + dir.y * t0 };
  const p1 = { x: a.x + dir.x * t1, y: a.y + dir.y * t1 };
  appendWallHit(content, p0, p1, w, s);
}

// --- nyílászárók ---

// ajtó: nyíló szárny-vonal + negyedköríves nyílásív; ablak: kitöltött nyílás + szárny-átló(k)
function objectSymbol(obj, geo, s) {
  const g = el('g', { class: `object-symbol object-${obj.kind}` });
  g.appendChild(el('line', {
    x1: geo.p1.x, y1: geo.p1.y, x2: geo.p2.x, y2: geo.p2.y,
    class: 'object-hit', 'data-object': obj.id, 'stroke-width': Math.max(geo.wall.thickness + 12 / s, 20 / s),
  }));

  if (obj.kind === 'door') {
    // a nyílás kávája: a fal testéből kivágott rész kitöltése (a mintarajzokon
    // a nyílászárók okker/narancs kiemelést kapnak a fal sraffozásán belül)
    g.appendChild(el('path', {
      d: openingRevealPathD(geo), class: 'door-reveal', 'data-object': obj.id, 'stroke-width': 1 / s,
    }));
    if (obj.withLeaf !== false) {
      const hinge = obj.flipHinge ? geo.p2 : geo.p1;
      const other = obj.flipHinge ? geo.p1 : geo.p2;
      const side = obj.flipSide ? -1 : 1;
      const leafEnd = { x: hinge.x + geo.normal.x * obj.width * side, y: hinge.y + geo.normal.y * obj.width * side };
      g.appendChild(el('line', {
        x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y,
        class: 'door-leaf', 'data-object': obj.id, 'stroke-width': 1.5 / s,
      }));
      g.appendChild(el('path', {
        d: quarterArcPath(hinge, leafEnd, other, obj.width),
        class: 'door-arc', 'data-object': obj.id, 'stroke-width': 1 / s,
      }));
    }
  } else if (obj.kind === 'window') {
    const half = geo.wall.thickness / 2;
    const n = geo.normal;
    g.appendChild(el('path', {
      d: openingRevealPathD(geo), class: 'window-fill', 'data-object': obj.id, 'stroke-width': 1.5 / s,
    }));

    const side = obj.flipSide ? -1 : 1;
    if (obj.sashCount === 2) {
      const mA = { x: geo.center.x + n.x * half, y: geo.center.y + n.y * half };
      const mB = { x: geo.center.x - n.x * half, y: geo.center.y - n.y * half };
      g.appendChild(el('line', {
        x1: mA.x, y1: mA.y, x2: mB.x, y2: mB.y,
        class: 'window-mullion', 'data-object': obj.id, 'stroke-width': 1.5 / s,
      }));
      g.appendChild(el('path', {
        d: sashDiagonal(geo.p1, geo.center, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
      g.appendChild(el('path', {
        d: sashDiagonal(geo.center, geo.p2, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
    } else {
      g.appendChild(el('path', {
        d: sashDiagonal(geo.p1, geo.p2, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
    }
  }
  return g;
}

// a nyílás téglalapja a fal teljes vastagságában (a fal testéből ezt vágja ki
// az openingCutoutPathD, itt a kitöltéséhez rajzoljuk újra)
function openingRevealPathD(geo) {
  const half = geo.wall.thickness / 2;
  const n = geo.normal;
  const c1 = { x: geo.p1.x + n.x * half, y: geo.p1.y + n.y * half };
  const c2 = { x: geo.p2.x + n.x * half, y: geo.p2.y + n.y * half };
  const c3 = { x: geo.p2.x - n.x * half, y: geo.p2.y - n.y * half };
  const c4 = { x: geo.p1.x - n.x * half, y: geo.p1.y - n.y * half };
  return `M ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} L ${c4.x} ${c4.y} Z`;
}

// egy ablakszárny nyitás-irányát jelző átló: a "zsanér" sarokból (pStart, a
// `side` felőli falsíkon) a szemközti sarokba (pEnd, a másik falsíkon)
function sashDiagonal(pStart, pEnd, n, half, side) {
  const hinge = { x: pStart.x - n.x * half * side, y: pStart.y - n.y * half * side };
  const tip = { x: pEnd.x + n.x * half * side, y: pEnd.y + n.y * half * side };
  return `M ${hinge.x} ${hinge.y} L ${tip.x} ${tip.y}`;
}

// negyedköríves útvonal `from`-ból `to`-ba, `center` körül, a rövidebb (90°-os) irányban
function quarterArcPath(center, from, to, radius) {
  const cross = (from.x - center.x) * (to.y - center.y) - (from.y - center.y) * (to.x - center.x);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${sweep} ${to.x} ${to.y}`;
}

function handle(x, y, s, kind, idAttrs, square = false) {
  const r = 5 / s;
  const attrs = {
    class: 'handle' + (square ? ' handle-mid' : ''),
    'data-handle': kind, ...idAttrs,
    'stroke-width': 1.5 / s,
  };
  if (square) {
    return el('rect', { ...attrs, x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  }
  return el('circle', { ...attrs, cx: x, cy: y, r });
}

// a falakat láncokra ("run") bontja: minden lánc egy vizuálisan egyenes,
// folytonos falszakasz, akár több (T-elágazásnál szétvágott) fal-objektumból
// összefűzve — így egy ilyen falra egy közös hossz-címke kerül, nem
// szakaszonként egy-egy apró szám
function buildInteriorWallRuns(plan) {
  const visited = new Set();
  const runs = [];
  for (const w of plan.walls) {
    if (visited.has(w.id)) continue;
    visited.add(w.id);
    const walls = [w];
    let nodeIds = [w.a, w.b];

    let curNode = w.a, curWall = w;
    while (true) {
      const partner = throughPartner(plan, curNode, curWall.id);
      if (!partner || visited.has(partner.id)) break;
      visited.add(partner.id);
      curNode = partner.a === curNode ? partner.b : partner.a;
      nodeIds.unshift(curNode);
      walls.unshift(partner);
      curWall = partner;
    }
    curNode = w.b; curWall = w;
    while (true) {
      const partner = throughPartner(plan, curNode, curWall.id);
      if (!partner || visited.has(partner.id)) break;
      visited.add(partner.id);
      curNode = partner.a === curNode ? partner.b : partner.a;
      nodeIds.push(curNode);
      walls.push(partner);
      curWall = partner;
    }
    runs.push({ walls, startId: nodeIds[0], endId: nodeIds[nodeIds.length - 1] });
  }
  return runs;
}

// mint lengthLabel, de több összefűzött (egyenes, azonos vastagságú) fal
// teljes hosszára, a lánc egészének közepén
function wallRunLengthLabel(plan, run, s) {
  const a = nodeById(plan, run.startId), b = nodeById(plan, run.endId);
  // belméret: a lánc teljes tengelyhossza, csökkentve a KÉT VÉGÉN csatlakozó
  // falakkal — a lánc belsejében lévő csomópontok egyenes folytatások, ott
  // nincs mit levonni
  const axisLen = run.walls.reduce((sum, w) => sum + wallLengthOf(plan, w), 0);
  const dirAB = G.unit(a, b);
  const totalLen = Math.max(0, axisLen
    - endDeductionAt(plan, a, dirAB, run.walls[0].id)
    - endDeductionAt(plan, b, { x: -dirAB.x, y: -dirAB.y }, run.walls[run.walls.length - 1].id));
  const n = G.normal(a, b);
  const mid = G.mid(a, b);
  const off = run.walls[0].thickness / 2 + 10 / s;
  const x = mid.x - n.x * off, y = mid.y - n.y * off;

  let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  const t = el('text', {
    x, y,
    class: 'len-label',
    'font-size': 12 / s,
    'stroke-width': 3 / s,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    transform: `rotate(${deg} ${x} ${y})`,
  });
  t.textContent = formatMeters(totalLen);
  return t;
}

// a fal hossz-címkéje: a fal közepén, a falra fektetve, kis eltartással
// (csak azokra a falakra, amik NEM szerepelnek a láncolt külső méretezésben)
function lengthLabel(plan, w, a, b, s) {
  const len = wallInteriorLengthOf(plan, w); // belméret, ahogy a bevitel is
  const n = G.normal(a, b);
  const bulge = w.bulge || 0;
  // ívnél a domború oldalra, egyenesnél a normál oldalra kerül a felirat
  const side = bulge ? Math.sign(bulge) : -1;
  const base = bulge ? G.arcMidpoint(a, b, bulge) : G.mid(a, b);
  const off = w.thickness / 2 + 10 / s;
  const x = base.x + n.x * off * side;
  const y = base.y + n.y * off * side;

  let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  const t = el('text', {
    x, y,
    class: 'len-label',
    'data-wall': w.id,
    'font-size': 12 / s,
    'stroke-width': 3 / s,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    transform: `rotate(${deg} ${x} ${y})`,
  });
  // a rajzon minden hossz méterben (mint a méretláncokon); a címkére kattintva
  // nyíló szerkesztő továbbra is cm-ben dolgozik, azt saját "cm" felirat jelzi
  t.textContent = formatMeters(len);
  return t;
}

// --- láncolt külső méretvonalak ---

const DIM_OFF_1 = 45; // cm – szakaszonkénti méretvonal távolsága a fal külső síkjától
const DIM_OFF_2 = 85; // cm – a teljes-hosszt mutató (külső) méretvonal távolsága
const DIM_EXT = 8;    // cm – a kivezető vonal ennyivel nyúlik túl a méretvonalon
const DIM_TICK = 5;   // cm – a pipuk mérete

function renderDimensionChain(overlay, chain, s) {
  const hasMultiple = chain.points.length > 2;
  const farOffset = hasMultiple ? DIM_OFF_2 : DIM_OFF_1;

  // kivezető vonalak minden töréspontból
  for (const pt of chain.points) {
    const far = { x: pt.x + chain.normal.x * (farOffset + DIM_EXT), y: pt.y + chain.normal.y * (farOffset + DIM_EXT) };
    overlay.appendChild(el('line', {
      x1: pt.x, y1: pt.y, x2: far.x, y2: far.y, class: 'dim-ext', 'stroke-width': 0.8 / s,
    }));
  }

  renderDimLine(overlay, chain, DIM_OFF_1, chain.points, s, false);
  if (hasMultiple) {
    renderDimLine(overlay, chain, DIM_OFF_2, [chain.points[0], chain.points[chain.points.length - 1]], s, true);
  }
}

function renderDimLine(overlay, chain, offset, points, s, isTotal) {
  const off = p => ({ x: p.x + chain.normal.x * offset, y: p.y + chain.normal.y * offset });
  const p0 = off(points[0]), pN = off(points[points.length - 1]);

  overlay.appendChild(el('line', {
    x1: p0.x, y1: p0.y, x2: pN.x, y2: pN.y, class: 'dim-line', 'stroke-width': 1 / s,
  }));

  // 45°-os pipuk minden ponton (a fal iránya és a kifelé mutató normál átlója mentén)
  const tx = chain.dir.x - chain.normal.x, ty = chain.dir.y - chain.normal.y;
  const tn = Math.hypot(tx, ty) || 1;
  const tick = DIM_TICK / s;
  for (const p of points) {
    const dp = off(p);
    overlay.appendChild(el('line', {
      x1: dp.x - tx / tn * tick, y1: dp.y - ty / tn * tick,
      x2: dp.x + tx / tn * tick, y2: dp.y + ty / tn * tick,
      class: 'dim-tick', 'stroke-width': 1.2 / s,
    }));
  }

  let deg = Math.atan2(chain.dir.y, chain.dir.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  for (let i = 0; i < points.length - 1; i++) {
    const a = off(points[i]), b = off(points[i + 1]);
    const mid = G.mid(a, b);
    const segLen = isTotal ? chain.len : points[i + 1].t - points[i].t;
    const t = el('text', {
      x: mid.x, y: mid.y,
      class: isTotal ? 'dim-label dim-label-total' : 'dim-label',
      'font-size': (isTotal ? 11 : 10) / s,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      transform: `rotate(${deg} ${mid.x} ${mid.y})`,
    });
    // a mintarajzokhoz igazodva a méretlánc méterben, tizedesvesszővel
    t.textContent = formatMeters(segLen);
    overlay.appendChild(t);
  }
}

// helyiség-címke-blokk az építészeti tervrajzok mintájára: NÉV / terület /
// B.m., egymás alá tördelve, a súlypontra függőlegesen is középre igazítva.
// A sorok külön-külön kapcsolhatók a Rétegek panelen; a blokk magassága a
// ténylegesen megjelenő sorokhoz igazodik, hogy sose csússzon el a középről.
function roomLabel(room, trace, s) {
  const lines = [];
  if (ui.layerVisible.roomName) {
    lines.push({ text: room.name, cls: 'room-name', size: 13 });
  }
  if (ui.layerVisible.roomArea) {
    lines.push({ text: `${trace.areaM2.toFixed(2).replace('.', ',')} m²`, cls: 'room-area', size: 11 });
  }
  if (ui.layerVisible.roomHeight && room.height > 0) {
    lines.push({ text: `B.m.: ${formatMeters(room.height)} m`, cls: 'room-height', size: 10 });
  }
  if (!lines.length) return null;

  const g = el('g', { class: 'room-label' });
  const gap = 4 / s; // cm – sorköz a betűméreten felül
  const heights = lines.map(l => l.size / s);
  const total = heights.reduce((sum, h) => sum + h, 0) + gap * (lines.length - 1);

  let y = trace.centroid.y - total / 2;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    y += heights[i] / 2;
    const t = el('text', {
      x: trace.centroid.x, y,
      class: `room-text ${l.cls}`, 'data-room': room.id,
      'font-size': heights[i], 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    });
    t.textContent = l.text;
    g.appendChild(t);
    y += heights[i] / 2 + gap;
  }
  return g;
}

// cm -> "2,85" (magyar tizedesvessző, 2 tizedes, a felesleges nullák nélkül)
function formatMeters(cm) {
  return (cm / 100).toFixed(2).replace('.', ',');
}

// --- kijelölt fal: szabad távolság a két oldalán lévő szomszédos falig ---
//
// A geometria a plan.js-ben van (wallClearances), mert a szerkesztés is
// használja. Itt csak kirajzoljuk. A szám KATTINTHATÓ: pontos érték írható be,
// ha a 10 cm-es húzási lépték nem elég finom.
function clearanceLabels(plan, w, s) {
  const c = wallClearances(plan, w);
  if (!c) return null;
  const g = el('g', { class: 'clearance' });
  for (const key of ['neg', 'pos']) {
    if (c[key]) g.appendChild(clearanceDim(c, c[key], key, w, s));
  }
  // Maga a fal vastagsága is bekerül a sorba, hogy a három szám együtt kiadja
  // a teljes belméretet (pl. 3,35 + 0,10 + 4,65 = 8,10). Enélkül a két oldal
  // összege 10 cm-rel kevesebbnek látszott a helyiség-szélességnél, és úgy
  // tűnt, mintha a válaszfal kimaradna a lakás szélességéből.
  const thickAt = c.neg || c.pos;
  if (thickAt) g.appendChild(wallThicknessLabel(c, thickAt, w, s));
  return g;
}

// a fal saját vastagsága, a mérővonal mellé írva
function wallThicknessLabel(c, side, w, s) {
  const { a, dir } = c;
  const base = { x: a.x + dir.x * side.overlapAt, y: a.y + dir.y * side.overlapAt };
  const x = base.x + dir.x * 13 / s, y = base.y + dir.y * 13 / s;

  let deg = Math.atan2(dir.y, dir.x) * 180 / Math.PI + 90;
  if (deg > 90 || deg <= -90) deg += 180;

  const t = el('text', {
    x, y, class: 'clearance-thickness', 'font-size': 10 / s, 'stroke-width': 3 / s,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    transform: `rotate(${deg} ${x} ${y})`,
  });
  t.textContent = formatMeters(w.thickness);
  return t;
}

// egy oldal mérővonala: a fal síkjától a szomszéd fal síkjáig, a számmal
function clearanceDim(c, side, sideKey, w, s) {
  const g = el('g');
  const { a, dir, nrm, half } = c;
  const sign = Math.sign(side.offset);
  const base = { x: a.x + dir.x * side.overlapAt, y: a.y + dir.y * side.overlapAt };
  const from = { x: base.x + nrm.x * half * sign, y: base.y + nrm.y * half * sign };
  const to = {
    x: from.x + nrm.x * sign * side.clear,
    y: from.y + nrm.y * sign * side.clear,
  };

  g.appendChild(el('line', {
    x1: from.x, y1: from.y, x2: to.x, y2: to.y,
    class: 'clearance-line', 'stroke-width': 1.2 / s,
  }));
  for (const p of [from, to]) {
    g.appendChild(el('line', {
      x1: p.x - dir.x * 5 / s, y1: p.y - dir.y * 5 / s,
      x2: p.x + dir.x * 5 / s, y2: p.y + dir.y * 5 / s,
      class: 'clearance-tick', 'stroke-width': 1.2 / s,
    }));
  }

  let deg = Math.atan2(dir.y, dir.x) * 180 / Math.PI + 90;
  if (deg > 90 || deg <= -90) deg += 180;
  const mid = G.mid(from, to);
  const label = el('text', {
    x: mid.x, y: mid.y,
    class: 'clearance-label', 'font-size': 12 / s, 'stroke-width': 3 / s,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'data-wall': w.id, 'data-clear-side': sideKey,
    transform: `rotate(${deg} ${mid.x} ${mid.y})`,
  });
  label.textContent = formatMeters(side.clear);
  g.appendChild(label);
  return g;
}

// --- nyílászáró-méretjelölés (90/210) ---

const OPENING_TAG_GAP = 18; // cm – a méretjelölés távolsága a fal síkjától (a falhossz-címke elé)

// egyszerű sugár-metszéses pont-a-sokszögben teszt
function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// melyik oldalra kerüljön a méretjelölés: külső falnál KÍVÜLRE (ahogy a
// mintarajzokon), belső falnál a nyitás-iránnyal ellentétes oldalra, hogy ne
// fedje az ajtóívet
function openingTagSide(plan, obj, geo) {
  const outer = exteriorSilhouette(plan);
  if (outer) {
    const probe = geo.wall.thickness / 2 + 15;
    const plus = { x: geo.center.x + geo.normal.x * probe, y: geo.center.y + geo.normal.y * probe };
    const minus = { x: geo.center.x - geo.normal.x * probe, y: geo.center.y - geo.normal.y * probe };
    const plusIn = pointInPolygon(outer, plus);
    if (plusIn !== pointInPolygon(outer, minus)) return plusIn ? -1 : 1;
  }
  return obj.kind === 'door' && !obj.flipSide ? -1 : 1;
}

// a nyílászáró szélesség/magasság jelölése törtvonalas alakban, a falra
// fektetve, a fal egyik síkján kívül — a mintarajzokon látható módon:
// felül a szélesség cm-ben, alatta vízszintes vonallal a magasság m-ben
function openingSizeLabel(plan, obj, geo, s) {
  const n = geo.normal;
  const half = geo.wall.thickness / 2;
  const side = openingTagSide(plan, obj, geo);
  const off = half + OPENING_TAG_GAP / s;
  const cx = geo.center.x + n.x * off * side;
  const cy = geo.center.y + n.y * off * side;

  let deg = Math.atan2(geo.dir.y, geo.dir.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  const g = el('g', {
    class: 'opening-tag', transform: `rotate(${deg} ${cx} ${cy})`,
  });

  const size = 9 / s;
  const bar = Math.max(obj.width * 0.42, 16 / s); // a törtvonal fél hossza

  const top = el('text', {
    x: cx, y: cy - size * 0.62, 'font-size': size,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
  });
  top.textContent = String(Math.round(obj.width));

  const rule = el('line', {
    x1: cx - bar / 2, y1: cy, x2: cx + bar / 2, y2: cy, 'stroke-width': 0.8 / s,
  });

  const bottom = el('text', {
    x: cx, y: cy + size * 0.62, 'font-size': size,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
  });
  bottom.textContent = formatMeters(objectHeight(obj));

  g.append(top, rule, bottom);
  return g;
}
