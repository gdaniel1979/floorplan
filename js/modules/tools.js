// Egér- és billentyű-interakciók a vásznon: falrajzolás (kattintás + hossz
// begépelése), kijelölés, végpont/fal/ív húzása, hossz-címke szerkesztése,
// helyiség-kijelölés kattintással.

import { getSvg, getOverlay, getScale, clientToWorld, beginPan, el } from './canvas.js';
import { getPlan, findNodeNear, nodeById, wallById, addNode, addWall, deleteWall, mergeNodes, cleanupOrphanNodes, setWallInteriorLength, wallInteriorLengthOf, endDeductionAt, wallClearances, setWallClearance, round1 } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';
import { notify, activeLevel } from './state.js';
import { snapshot, checkpoint } from './history.js';
import { GRID_MINOR } from './config.js';
import { renderAll } from './render.js';
import { addRoomAt, renameRoom, recolorRoom, deleteRoom } from './rooms.js';
import { addObject, deleteObject, moveObjectAlongWall, resizeObjectEdge, offsetOnWall, openingClearances, setOpeningClearance } from './objects.js';
import { addFurniture, deleteFurniture, moveFurniture, snappedRotationInfo, rotateHandlePoint } from './furniture.js';
import { showToast } from './toast.js';
import { repairWallNetwork } from './wallrepair.js';

let svg, wrap, floatEl, editorEl, editorFinish;

// rajzolás alatt: { lastNodeId, mouse, client, typed: '' } — az aktuális lánc állapota
let draw = null;
// húzás alatt: { kind: 'node'|'body'|'mid', ... }
let drag = null;
// szintenként megjegyzett utolsó lerakott pont, ha a lánc nem lett lezárva
const lastNodeByLevel = new Map();
// szóköz lenyomva tartva: bal gombos húzás mindig a nézetet mozgatja
let spaceHeld = false;

export function initTools() {
  svg = getSvg();
  wrap = document.getElementById('canvas-wrap');

  floatEl = document.createElement('div');
  floatEl.id = 'draw-float';
  floatEl.hidden = true;
  wrap.appendChild(floatEl);

  svg.addEventListener('mousedown', onDown);
  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('dblclick', e => { if (ui.tool === 'wall') endChain(); });
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (ui.tool === 'wall') endChain();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onSpaceDown);
  window.addEventListener('keyup', onSpaceUp);

  setTool('select');
}

function onSpaceDown(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space' && !spaceHeld) {
    spaceHeld = true;
    svg.classList.add('space-pan');
    e.preventDefault(); // ne görgessen az oldal
  }
}

function onSpaceUp(e) {
  if (e.code === 'Space') {
    spaceHeld = false;
    svg.classList.remove('space-pan');
  }
}

const HINTS = {
  wall: 'Kattints pontról pontra. Hossz: gépeld be cm-ben és Enter. Befejezés: jobb klikk / Esc / dupla katt. V: kijelölés.',
  room: 'Kattints egy falakkal körbezárt terület belsejébe egy helyiség létrehozásához. V: kijelölés.',
  door: 'Kattints egy egyenes falra az ajtó elhelyezéséhez. Utólag a fal mentén húzható, a szélei a szélesség módosításához. V: kijelölés.',
  window: 'Kattints egy egyenes falra az ablak elhelyezéséhez. Utólag a fal mentén húzható, a szélei a szélesség módosításához. V: kijelölés.',
  furniture: 'Kattints a rajzra a kiválasztott tárgy elhelyezéséhez. Utólag húzható (Shift: 1 cm-es lépték) vagy nyilakkal tologatható. Méret/forgatás a Kijelölt tárgy panelen. V: kijelölés.',
  select: 'Kattints falra, helyiségre, nyílászáróra vagy bútorra a kijelöléshez; húzd a fogantyúkat. Húzás közben Shift: 1 cm-es lépték; kijelölt tárgyat a nyilak is tolnak (Shift: 10 cm). A hossz-/névcímkére kattintva szerkeszthető. Del: törlés. F: falrajzolás, R: helyiség. Szóköz+húzás (vagy középső gomb): nézet mozgatása bárhonnan.',
};

export function setTool(tool) {
  ui.tool = tool;
  ui.selectedWallId = null;
  ui.selectedRoomId = null;
  ui.selectedObjectId = null;
  ui.selectedFurnitureId = null;
  if (tool !== 'furniture') ui.furniturePendingType = null;
  endChain();
  if (tool === 'wall') tryResumeChain();
  svg.dataset.tool = tool;
  for (const b of document.querySelectorAll('.tool-btn[data-tool]')) {
    b.classList.toggle('active', b.dataset.tool === tool);
  }
  if (tool !== 'furniture') {
    for (const b of document.querySelectorAll('#furniture-tree .furn-item')) b.classList.remove('active');
  }
  const hint = document.getElementById('tool-hint');
  if (hint) hint.textContent = HINTS[tool] || '';
  renderAll();
}

// a legutóbb lerakott (de le nem zárt) pontból folytatja a rajzolást, ha van ilyen
function tryResumeChain() {
  const plan = getPlan();
  const level = activeLevel();
  if (!plan || !level) return;
  const nodeId = lastNodeByLevel.get(level.id);
  if (nodeId && nodeById(plan, nodeId)) {
    draw = { lastNodeId: nodeId, mouse: null, typed: '' };
  }
}

// ---------------------------------------------------------------- események

function onDown(e) {
  closeEditor();
  if (e.button === 1) { e.preventDefault(); beginPan(e); return; }
  if (e.button !== 0) return;
  // szóköz lenyomva tartva: bal gombos húzás mindig a nézetet mozgatja,
  // függetlenül attól, mi van a kurzor alatt (fal, helyiség, üres terület)
  if (spaceHeld) { e.preventDefault(); beginPan(e); return; }

  const p = clientToWorld(e.clientX, e.clientY);
  const plan = getPlan();
  if (!plan) return;

  if (ui.tool === 'wall') {
    placePoint(plan, p);
    return;
  }

  if (ui.tool === 'room') {
    placeRoom(plan, p, e.clientX, e.clientY);
    return;
  }

  if (ui.tool === 'door' || ui.tool === 'window') {
    placeObject(plan, ui.tool, e.target, p);
    return;
  }

  if (ui.tool === 'furniture') {
    placeFurniture(plan, p);
    return;
  }

  // --- kijelölés mód ---
  const t = e.target;
  e.preventDefault(); // ne vigye el a fókuszt (pl. a hossz-szerkesztő inputról)

  if (t.dataset?.handle) {
    const kind = t.dataset.handle;
    if (kind === 'objP1' || kind === 'objP2' || kind === 'objCenter') {
      startObjectHandleDrag(plan, kind, t.dataset.object);
    } else if (kind === 'furnitureRotate') {
      startFurnitureRotateDrag(plan, t.dataset.furniture);
    } else {
      startHandleDrag(plan, kind, t.dataset.wall, p);
    }
    return;
  }

  if (t.classList?.contains('len-label')) {
    openLengthEditor(t.dataset.wall, e.clientX, e.clientY);
    return;
  }

  // a szabad-táv szám: pontos érték beírható, ha a húzási lépték nem elég finom
  if (t.classList?.contains('clearance-label')) {
    openClearanceEditor(t.dataset.wall, t.dataset.clearSide, e.clientX, e.clientY);
    return;
  }

  // a nyílászáró saroktól mért távolsága — szintén beírható
  if (t.classList?.contains('opening-dim-label')) {
    openCornerEditor(t.dataset.object, t.dataset.cornerSide, e.clientX, e.clientY);
    return;
  }

  // a helyiség-címke bármelyik sora (név / terület / belmagasság) nyitja a szerkesztőt
  if (t.classList?.contains('room-text')) {
    openRoomEditor(t.dataset.room, e.clientX, e.clientY);
    return;
  }

  if (t.dataset?.furniture) {
    ui.selectedFurnitureId = t.dataset.furniture;
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    renderAll();
    startFurnitureDrag(plan, t.dataset.furniture, p);
    return;
  }

  if (t.dataset?.object) {
    ui.selectedObjectId = t.dataset.object;
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedFurnitureId = null;
    renderAll();
    startObjectHandleDrag(plan, 'objCenter', t.dataset.object);
    return;
  }

  if (t.dataset?.wall) {
    ui.selectedWallId = t.dataset.wall;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    ui.selectedFurnitureId = null;
    renderAll();
    startBodyDrag(plan, t.dataset.wall, p);
    return;
  }

  // helyiség belseje: a kattintás kijelöl, a HÚZÁS viszont a nézetet mozgatja
  // (a helyiséget magát úgysem lehet külön elmozgatni, így nincs mit elrontani)
  // — enélkül az alaprajz közepébe kapaszkodva nem lehetett pásztázni
  if (t.dataset?.room) {
    ui.selectedRoomId = t.dataset.room;
    ui.selectedWallId = null;
    ui.selectedObjectId = null;
    ui.selectedFurnitureId = null;
    renderAll();
    beginPan(e);
    return;
  }

  // üres területre kattintás: kijelölés törlése + pan
  if (ui.selectedWallId || ui.selectedRoomId || ui.selectedObjectId || ui.selectedFurnitureId) {
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    ui.selectedFurnitureId = null;
    renderAll();
  }
  beginPan(e);
}

// bútor (ellentétben az ajtóval/ablakkal) BÁRHOVA lerakható, fal nélkül is —
// ezért itt (eltérően a nyílászáróktól) egy elhelyezés után visszaváltunk
// Kijelölésre, nehogy egy újabb, a falra/helyiségre szánt kattintás
// észrevétlenül újabb és újabb tárgyat rakjon le
function placeFurniture(plan, p) {
  if (!ui.furnitureCategory || !ui.furniturePendingType) {
    showToast('Válassz egy tárgyat a Bútorok panelen.');
    return;
  }
  const before = snapshot();
  const item = addFurniture(plan, ui.furnitureCategory, ui.furniturePendingType, p);
  if (!item) { showToast('Nem sikerült elhelyezni a tárgyat.'); return; }
  checkpoint(before);
  setTool('select');
  ui.selectedFurnitureId = item.id;
  renderAll();
}

function placeObject(plan, kind, target, p) {
  const wallId = target?.dataset?.wall;
  if (!wallId) { showToast('Kattints egy falra a nyílászáró elhelyezéséhez.'); return; }
  const w = wallById(plan, wallId);
  if (!w || w.bulge) { showToast('Íves falba egyelőre nem helyezhető el nyílászáró.'); return; }

  const before = snapshot();
  const defaults = kind === 'door'
    ? {
        flipHinge: ui.doorFlipHinge, flipSide: ui.doorFlipSide, withLeaf: ui.doorWithLeaf,
        width: ui.doorWidth, height: ui.doorHeight,
      }
    : {
        sashCount: ui.windowSashCount, flipSide: ui.windowFlipSide,
        width: ui.windowWidth, height: ui.windowHeight,
      };
  const obj = addObject(plan, wallId, kind, offsetOnWall(plan, w, p), defaults);
  if (!obj) { showToast('Nem sikerült elhelyezni a nyílászárót.'); return; }
  checkpoint(before);
  ui.selectedObjectId = obj.id;
  renderAll();
}

function placeRoom(plan, p, clientX, clientY) {
  const before = snapshot();
  const result = addRoomAt(plan, p);
  if (!result.ok) {
    showToast('A terület nincs teljesen körbezárva falakkal.');
    return;
  }
  checkpoint(before);
  ui.selectedRoomId = result.room.id;
  renderAll();
  if (!result.existing) openRoomEditor(result.room.id, clientX, clientY);
}

function onMove(e) {
  if (ui.tool === 'wall' && draw) updatePreview(e);
}

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (ui.tool === 'wall' && draw) {
    if (/^[0-9]$/.test(e.key)) { draw.typed += e.key; refreshFloat(draw.client, wallFloatText()); return; }
    if (e.key === '.' || e.key === ',') {
      if (!draw.typed.includes('.')) { draw.typed += '.'; refreshFloat(draw.client, wallFloatText()); }
      return;
    }
    if (e.key === 'Backspace') { draw.typed = draw.typed.slice(0, -1); refreshFloat(draw.client, wallFloatText()); return; }
    if (e.key === 'Enter') {
      if (draw.typed) commitTyped();
      else endChain();
      return;
    }
    if (e.key === 'Escape') {
      if (draw.typed) { draw.typed = ''; refreshFloat(draw.client, wallFloatText()); }
      else endChain();
      return;
    }
  }

  if (e.key === 'Escape' && (ui.tool === 'wall' || ui.tool === 'room' || ui.tool === 'door' || ui.tool === 'window' || ui.tool === 'furniture')) {
    setTool('select');
    return;
  }
  if (e.key === 'Escape' && (ui.selectedWallId || ui.selectedRoomId || ui.selectedObjectId || ui.selectedFurnitureId)) {
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    ui.selectedFurnitureId = null;
    renderAll();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedWallId) {
    const before = snapshot();
    deleteWall(getPlan(), ui.selectedWallId);
    checkpoint(before);
    ui.selectedWallId = null;
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedRoomId) {
    const before = snapshot();
    deleteRoom(getPlan(), ui.selectedRoomId);
    checkpoint(before);
    ui.selectedRoomId = null;
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedObjectId) {
    const before = snapshot();
    deleteObject(getPlan(), ui.selectedObjectId);
    checkpoint(before);
    ui.selectedObjectId = null;
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedFurnitureId) {
    const before = snapshot();
    deleteFurniture(getPlan(), ui.selectedFurnitureId);
    checkpoint(before);
    ui.selectedFurnitureId = null;
    return;
  }
  // Nyilakkal a kijelölt tárgy finoman tologatható: 1 cm-enként, Shift-tel
  // 10 cm-enként. A húzás a 10 cm-es rácshoz igazít, ami elhelyezéshez jó, de
  // pár centis igazításhoz durva.
  const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (NUDGE[e.key] && ui.selectedFurnitureId) {
    const plan = getPlan();
    const item = plan?.furniture.find(f => f.id === ui.selectedFurnitureId);
    if (item) {
      e.preventDefault(); // ne görgessen az oldal
      const step = e.shiftKey ? GRID_MINOR : 1;
      const [ux, uy] = NUDGE[e.key];
      const before = snapshot();
      moveFurniture(plan, item, item.x + ux * step, item.y + uy * step);
      checkpoint(before);
    }
    return;
  }

  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'f' || e.key === 'F') setTool('wall');
  if (e.key === 'r' || e.key === 'R') setTool('room');
}

// ---------------------------------------------------------------- falrajzolás

function placePoint(plan, p) {
  const tol = 12 / getScale();

  if (!draw) {
    const near = findNodeNear(plan, p, tol);
    const before = snapshot();
    let node = near;
    if (!node) {
      // meglévő fal testére kattintva a csomópont a fal TENGELYÉRE ugorjon, és
      // rögtön ketté is vágjuk ott — enélkül a kiindulópont nem kapcsolódna a
      // falhoz, így a belméret-levonás is rosszul indulna (a lánc első
      // szakasza a fal fél vastagságával hosszabb lenne a kelleténél)
      const onWall = wallLineNear(plan, p, ui.thickness);
      node = addNode(plan, onWall ? onWall.point : G.snapToGrid(p, GRID_MINOR));
      if (onWall) repairWallNetwork(plan);
    }
    checkpoint(before);
    draw = { lastNodeId: node.id, mouse: p, typed: '' };
    notify();
    refreshFloat(draw.client, wallFloatText());
    return;
  }

  const end = computeEnd(plan, p);
  commitSegment(plan, end);
}

// a szakasz végpontja az egér (vagy begépelt hossz) alapján, illesztésekkel
function computeEnd(plan, mouse, typedLen = null) {
  const last = nodeById(plan, draw.lastNodeId);
  const tol = 12 / getScale();

  // meglévő csomópontra illesztés (kivéve önmaga) — mindig elsőbbséget élvez,
  // hogy a lánc pontosan visszazárható legyen a kiindulópontra
  const near = findNodeNear(plan, mouse, tol, draw.lastNodeId);
  if (near && !typedLen) {
    return withInterior(plan, last, { point: { x: near.x, y: near.y }, nodeId: near.id, len: G.dist(last, near) });
  }

  const raw = Math.atan2(mouse.y - last.y, mouse.x - last.x);
  const ang = ui.orthoOnly ? G.snapAngleOrtho(raw) : G.snapAngle(raw);
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };

  // A beírt/rajzolt hossz BELMÉRET, ezért a tengelyhosszhoz hozzáadjuk mindkét
  // végén a bevágást. Kezdő végen a már ott lévő, nem egyenesen folytatódó fal
  // félvastagságát; a még SZABAD túlsó végen az épp rajzolt fal félvastagságát
  // — vagyis azt feltételezve, hogy oda is ilyen fal fog csatlakozni.
  //
  // Ez utóbbi nélkül a lánc első szakasza kimaradna a levonásból, a többi nem:
  // az átellenes oldalak félvastagságnyival eltérnének, és a négyszög nem
  // záródna derékszögben. A "szabad végen semmit ne vonjon le" változat emiatt
  // nem tartható — lásd a válaszban a mért számokat.
  const startCut = cutAt(plan, last, dir);
  const farCut = ui.thickness / 2;

  let len;
  if (typedLen != null) {
    len = typedLen + startCut + farCut; // belméret -> tengelyhossz
  } else {
    const proj = Math.max(0, (mouse.x - last.x) * dir.x + (mouse.y - last.y) * dir.y);
    // a rácshoz a BELMÉRETET illesztjük, hogy kerek belméret jöjjön ki
    const interior = Math.round(Math.max(0, proj - startCut - farCut) / GRID_MINOR) * GRID_MINOR;
    len = interior + startCut + farCut;
  }
  const point = { x: round1(last.x + dir.x * len), y: round1(last.y + dir.y * len) };

  // A KISZÁMÍTOTT végpont közelében lévő csomópontra is illesztünk. Begépelt
  // hossznál a mutató helye nem mérvadó (a fal a beírt hosszal a snapelt
  // irányba megy, nem a kurzorig), ezért a fenti, egér-alapú illesztés a lánc
  // zárásakor nem talált rá a kiinduló csomópontra: a helyére egy vele
  // egybeeső, de KÜLÖN duplikátum jött létre. A hurok így látszólag zárt volt,
  // valójában nyitott — ettől lett szakadozott a külső kontúr és a méretlánc.
  const snapNode = findNodeNear(plan, point, tol, draw.lastNodeId);
  if (snapNode) {
    return withInterior(plan, last, { point: { x: snapNode.x, y: snapNode.y }, nodeId: snapNode.id, len: G.dist(last, snapNode) });
  }

  // Ha a fal egy MÁSIK FAL testébe érne bele, a végpontja annak a tengelyére
  // ugrik (a rajzolás irányában metszve, hogy a fal egyenes maradjon). Enélkül
  // eltérő vastagságoknál elvétette a célfal tengelyét — a T-elágazás nem jött
  // létre, a célfal nem vágódott ketté, és utána egyben, két helyiségnyi
  // hosszan lehetett csak kijelölni.
  const onWall = wallLineOnRay(plan, last, dir, point, ui.thickness);
  if (onWall) {
    return withInterior(plan, last, { point: onWall.point, nodeId: null, len: G.dist(last, onWall.point) });
  }

  return withInterior(plan, last, { point, nodeId: null, len });
}

// mekkora közelségben számít úgy, hogy a két fal összeér (a testük érintkezik),
// de legalább néhány képernyő-pixelnyi, hogy egérrel is kényelmes legyen
function snapTol(otherThickness, ownThickness) {
  return Math.max(otherThickness / 2 + ownThickness / 2, 12 / getScale());
}

// a ponthoz legközelebbi fal-tengely (merőleges vetülettel), ha elég közel van
// gridAlong: a fal MENTÉN rácsra igazítsunk-e. Új fal indításánál igen (kerek
// helyre kerüljön a csatlakozás), de egy MEGLÉVŐ végpont ráejtésénél nem — ott
// a rácsra rántás akár a fal végére csúsztatná a pontot, és az illesztés
// egyáltalán nem jönne létre.
function wallLineNear(plan, p, ownThickness, excludeNodeId = null, gridAlong = true) {
  let best = null;
  for (const w of plan.walls) {
    if (w.bulge) continue;
    // a húzott csomóponthoz tartozó falakra nem illesztünk (önmagára ugrana)
    if (excludeNodeId && (w.a === excludeNodeId || w.b === excludeNodeId)) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = G.dist(a, b);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    // a fal MENTÉN a rácshoz igazítunk (a rácspontot vetítjük a tengelyre), a
    // falra merőlegesen pedig pontosan a tengelyre — így a csatlakozás kerek
    // helyre kerül, nem oda, ahova épp koppintottunk
    const base = gridAlong ? G.snapToGrid(p, GRID_MINOR) : p;
    const t = (base.x - a.x) * ux + (base.y - a.y) * uy;
    if (t < 1 || t > len - 1) continue; // a végeknél a csomópont-illesztés dolgozik
    const proj = { x: round1(a.x + ux * t), y: round1(a.y + uy * t) };
    const d = G.dist(p, proj);
    if (d > snapTol(w.thickness, ownThickness)) continue;
    if (!best || d < best.d) best = { point: proj, d, dir: { x: ux, y: uy } };
  }
  return best;
}

// a rajzolás sugarát (last-ból dir irányba) melyik fal tengelye metszi a
// számított végpont közelében — a metszéspontot adja vissza
function wallLineOnRay(plan, last, dir, point, ownThickness) {
  let best = null;
  for (const w of plan.walls) {
    if (w.bulge) continue;
    if (w.a === draw.lastNodeId || w.b === draw.lastNodeId) continue; // amiből épp kiindulunk
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = G.dist(a, b);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const cross = dir.x * uy - dir.y * ux;
    if (Math.abs(cross) < 1e-6) continue; // párhuzamos, nincs metszés

    const s = ((a.x - last.x) * uy - (a.y - last.y) * ux) / cross;
    if (s <= 1) continue; // hátrafelé vagy nulla hosszú szakasz
    const ip = { x: round1(last.x + dir.x * s), y: round1(last.y + dir.y * s) };

    const t = (ip.x - a.x) * ux + (ip.y - a.y) * uy;
    if (t < 1 || t > len - 1) continue; // a fal szakaszán kívül metszené a vonalát
    const d = G.dist(point, ip);
    if (d > snapTol(w.thickness, ownThickness)) continue;
    if (!best || d < best.d) best = { point: ip, d };
  }
  return best;
}

// a szakaszhoz kiszámolja a kiírandó BELMÉRETET is — ugyanazzal a feltevéssel,
// amivel a hosszt is számoltuk, hogy a lebegő címkén az a szám álljon, amit a
// felhasználó begépelne (a szabad túlsó véget ilyen vastag falnak vesszük)
function withInterior(plan, last, end) {
  if (end.len <= 0) return { ...end, interior: 0 };
  const dir = { x: (end.point.x - last.x) / end.len, y: (end.point.y - last.y) / end.len };
  const endNode = end.nodeId ? nodeById(plan, end.nodeId) : null;
  const endCut = endNode
    ? cutAt(plan, endNode, { x: -dir.x, y: -dir.y })
    : ui.thickness / 2;
  return { ...end, interior: Math.max(0, end.len - cutAt(plan, last, dir) - endCut) };
}

// Mennyi esik ki a belméretből a fal ezen a végén. Ha a csomópontban már van
// fal, a valódi bevágás számít (egyenes folytatásnál ez 0). Ha viszont a
// csomópont még TELJESEN szabad — ilyen a lánc első pontja is —, azt vesszük,
// hogy oda is az épp rajzolt vastagságú fal fog csatlakozni. Enélkül a lánc
// első szakasza rövidebb tengelyhosszt kapna, mint a többi, és a négyszög nem
// záródna derékszögben.
function cutAt(plan, node, dir) {
  const hasWall = plan.walls.some(w => w.a === node.id || w.b === node.id);
  return hasWall ? endDeductionAt(plan, node, dir, null) : ui.thickness / 2;
}

function commitSegment(plan, end) {
  if (end.len < 1) return; // nulla hosszú fal nem jön létre
  const before = snapshot();
  const endNode = end.nodeId ? nodeById(plan, end.nodeId) : addNode(plan, end.point);
  addWall(plan, draw.lastNodeId, endNode.id, ui.thickness); // notify + render
  repairWallNetwork(plan); // T-elágazás: az új fal más fal vonalára eshet, azt szét kell vágni
  notify();
  checkpoint(before);
  draw.lastNodeId = endNode.id;
  draw.typed = '';
  refreshFloat(draw.client, wallFloatText());
}

function commitTyped() {
  const plan = getPlan();
  const len = parseFloat(draw.typed);
  if (!(len > 0)) { draw.typed = ''; refreshFloat(draw.client, wallFloatText()); return; }
  const end = computeEnd(plan, draw.mouse, len);
  commitSegment(plan, end);
}

function wallFloatText(previewLen = null) {
  const stop = ' <span class="float-hint">· Esc / jobb-katt: fal kész</span>';
  if (draw.typed) return `<b>${draw.typed}</b> cm ⏎`;
  if (previewLen != null) return `${Math.round(previewLen)} cm${stop}`;
  return `kattints a következő pontra, vagy gépeld a hosszt${stop}`;
}

function updatePreview(e) {
  const plan = getPlan();
  const p = clientToWorld(e.clientX, e.clientY);
  draw.mouse = p;
  draw.client = { x: e.clientX, y: e.clientY };

  const overlay = getOverlay();
  overlay.querySelector('#preview')?.remove();

  const last = nodeById(plan, draw.lastNodeId);
  if (!last) return;

  const typedLen = draw.typed ? parseFloat(draw.typed) || null : null;
  const end = computeEnd(plan, p, typedLen);
  const s = getScale();

  const g = el('g', { id: 'preview' });
  g.appendChild(el('path', {
    d: `M ${last.x} ${last.y} L ${end.point.x} ${end.point.y}`,
    class: 'wall-preview', 'stroke-width': ui.thickness,
  }));
  g.appendChild(el('circle', { cx: last.x, cy: last.y, r: 4 / s, class: 'preview-dot' }));
  g.appendChild(el('circle', { cx: end.point.x, cy: end.point.y, r: 4 / s, class: 'preview-dot' }));
  if (end.nodeId) {
    g.appendChild(el('circle', {
      cx: end.point.x, cy: end.point.y, r: 9 / s, class: 'snap-hint', 'stroke-width': 2 / s,
    }));
  }
  overlay.appendChild(g);

  refreshFloat(draw.client, wallFloatText(end.interior));
}

function endChain() {
  if (!draw) return;
  const plan = getPlan();
  const level = activeLevel();
  if (level) lastNodeByLevel.set(level.id, draw.lastNodeId);
  if (plan) { cleanupOrphanNodes(plan); notify(); }
  draw = null;
  floatEl.hidden = true;
  getOverlay().querySelector('#preview')?.remove();
}

// ---------------------------------------------------------------- húzások

function startHandleDrag(plan, kind, wallId, startP) {
  const w = wallById(plan, wallId);
  if (!w) return;
  const before = snapshot();
  ui.dragging = true;

  if (kind === 'mid') {
    // az ív-fogantyú a fal MELLETT van, ezért a megfogás pillanatában mért
    // nyílmagasság nem nulla — ezt az eltolást levonjuk, különben a fal már a
    // puszta megfogástól megugrana
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    const m = G.mid(a, b), n = G.normal(a, b);
    const grabS = (startP.x - m.x) * n.x + (startP.y - m.y) * n.y;
    const curS = (w.bulge || 0) * G.dist(a, b) / 2;
    drag = { kind: 'mid', w, before, grabOffset: grabS - curS };
  } else {
    const nodeId = kind === 'a' ? w.a : w.b;
    const otherId = kind === 'a' ? w.b : w.a;
    drag = { kind: 'node', nodeId, otherId, thickness: w.thickness, before };
  }
  bindDrag(plan);
}

function startBodyDrag(plan, wallId, startP) {
  const w = wallById(plan, wallId);
  if (!w) return;
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  const before = snapshot();
  ui.dragging = true;
  drag = { kind: 'body', w, orig: { ax: a.x, ay: a.y, bx: b.x, by: b.y }, start: startP, before };
  bindDrag(plan);
}

function startObjectHandleDrag(plan, kind, objectId) {
  const obj = plan.objects.find(o => o.id === objectId);
  if (!obj) return;
  const before = snapshot();
  ui.dragging = true;
  drag = { kind, objectId, before };
  bindDrag(plan);
}

function startFurnitureDrag(plan, furnitureId, startP) {
  const item = plan.furniture.find(f => f.id === furnitureId);
  if (!item) return;
  const before = snapshot();
  ui.dragging = true;
  drag = { kind: 'furniture', item, orig: { x: item.x, y: item.y }, start: startP, before };
  bindDrag(plan);
}

function startFurnitureRotateDrag(plan, furnitureId) {
  const item = plan.furniture.find(f => f.id === furnitureId);
  if (!item) return;
  const before = snapshot();
  ui.dragging = true;
  drag = { kind: 'furnitureRotate', item, before };
  bindDrag(plan);
}

function bindDrag(plan) {
  function move(ev) {
    const p = clientToWorld(ev.clientX, ev.clientY);
    applyDrag(plan, p, ev.shiftKey);
  }
  function up(ev) {
    const p = clientToWorld(ev.clientX, ev.clientY);
    finishDrag(plan, p);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function applyDrag(plan, p, shiftKey) {
  const tol = 12 / getScale();

  if (drag.kind === 'node') {
    const n = nodeById(plan, drag.nodeId);
    // Meglévő csomópontra VAGY meglévő fal tengelyére illesztünk — amelyik
    // KÖZELEBB van —, különben a rácsra. A fal-tengelyre illesztés nélkül egy
    // végpontot nem lehetett pontosan egy másik falra ejteni (a rács ritkán
    // esik a fal tengelyére), ezért apró, ferde csonkokkal maradt összekötve.
    // A "közelebbi nyer" azért kell, mert egy sarok-csomópont pár centire
    // lehet attól a helytől, ahova a végpontot tenni akarjuk: ha mindig a
    // csomópont győzne, a fal a sarokra ugorva megferdülne.
    const near = findNodeNear(plan, p, tol, drag.nodeId);
    const onWall = wallLineNear(plan, p, drag.thickness || ui.thickness, drag.nodeId, false);
    const dNode = near ? G.dist(p, near) : Infinity;
    const dWall = onWall ? onWall.d : Infinity;

    if (near && dNode <= dWall) { n.x = near.x; n.y = near.y; }
    else if (onWall) {
      n.x = onWall.point.x; n.y = onWall.point.y;
      // A célfal MENTÉN szabadon csúszhat a pont; ha ezzel a húzott fal
      // majdnem tengelyirányú lenne, tegyük pontosan azzá — különben a
      // kurzor pontosságával pár tized fokot ferdülne, és a csatlakozás
      // megint lépcsős lenne.
      const other = drag.otherId && nodeById(plan, drag.otherId);
      if (other) {
        if (Math.abs(onWall.dir.x) < 1e-6 && Math.abs(other.y - n.y) <= tol) n.y = other.y;
        else if (Math.abs(onWall.dir.y) < 1e-6 && Math.abs(other.x - n.x) <= tol) n.x = other.x;
      }
    }
    else { const g = G.snapToGrid(p, GRID_MINOR); n.x = g.x; n.y = g.y; }
    notify();
    // az illesztés jelzése oda kerül, ahova a végpont TÉNYLEGESEN ugrott
    if (near && dNode <= dWall) {
      const s = getScale();
      getOverlay().appendChild(el('circle', {
        cx: near.x, cy: near.y, r: 9 / s, class: 'snap-hint', 'stroke-width': 2 / s,
      }));
    } else if (onWall) {
      const s = getScale();
      getOverlay().appendChild(el('circle', {
        cx: onWall.point.x, cy: onWall.point.y, r: 9 / s, class: 'snap-hint', 'stroke-width': 2 / s,
      }));
    }
  } else if (drag.kind === 'body') {
    // Shift: finom (1 cm-es) lépték a szokásos 10 cm helyett — a pontos
    // értéket a szabad-táv számra kattintva is be lehet írni
    const step = shiftKey ? 1 : GRID_MINOR;
    const dx = Math.round((p.x - drag.start.x) / step) * step;
    const dy = Math.round((p.y - drag.start.y) / step) * step;
    const a = nodeById(plan, drag.w.a), b = nodeById(plan, drag.w.b);
    a.x = drag.orig.ax + dx; a.y = drag.orig.ay + dy;
    b.x = drag.orig.bx + dx; b.y = drag.orig.by + dy;
    notify();
  } else if (drag.kind === 'mid') {
    const a = nodeById(plan, drag.w.a), b = nodeById(plan, drag.w.b);
    const m = G.mid(a, b);
    const n = G.normal(a, b);
    const chord = G.dist(a, b);
    let s = (p.x - m.x) * n.x + (p.y - m.y) * n.y - (drag.grabOffset || 0); // előjeles nyílmagasság
    if (Math.abs(s) < 8 / getScale()) s = 0;       // kis értéknél visszaugrik egyenesbe
    // legfeljebb félkörig görbíthető
    const maxS = chord / 2;
    s = Math.max(-maxS, Math.min(maxS, s));
    drag.w.bulge = chord ? round1(2 * s / chord * 10) / 10 : 0;
    notify();
  } else if (drag.kind === 'objCenter' || drag.kind === 'objP1' || drag.kind === 'objP2') {
    const obj = plan.objects.find(o => o.id === drag.objectId);
    if (!obj) return;
    const w = wallById(plan, obj.wallId);
    if (!w) return;
    const offset = offsetOnWall(plan, w, p);
    if (drag.kind === 'objCenter') moveObjectAlongWall(plan, obj, offset);
    else resizeObjectEdge(plan, obj, drag.kind === 'objP1' ? 'p1' : 'p2', offset);
  } else if (drag.kind === 'furniture') {
    // Shift: finom (1 cm-es) lépték a szokásos 10 cm helyett
    const step = shiftKey ? 1 : GRID_MINOR;
    const dx = Math.round((p.x - drag.start.x) / step) * step;
    const dy = Math.round((p.y - drag.start.y) / step) * step;
    moveFurniture(plan, drag.item, drag.orig.x + dx, drag.orig.y + dy);
  } else if (drag.kind === 'furnitureRotate') {
    const item = drag.item;
    const raw = Math.atan2(p.y - item.y, p.x - item.x) * 180 / Math.PI + 90;
    const info = snappedRotationInfo(plan, item, raw, !shiftKey);
    item.rotation = info.deg;
    notify();
    if (info.snapped) {
      const s = getScale();
      const hp = rotateHandlePoint(item);
      getOverlay().appendChild(el('circle', {
        cx: hp.x, cy: hp.y, r: 10 / s, class: 'snap-hint', 'stroke-width': 2 / s,
      }));
    }
  }
}

function finishDrag(plan, p) {
  if (drag?.kind === 'node') {
    // Másik csomópontra ejtve: összevonás (falak összekapcsolása). De csak
    // akkor, ha a csomópont KÖZELEBB van, mint a legközelebbi fal tengelye —
    // különben egy pár centire lévő sarok magához rántaná azt a végpontot,
    // amit épp a fal oldalára akartunk tenni, és a fal megferdülne. Ez az
    // összevonás egyébként felül is írta a húzás közbeni fal-illesztést.
    const tol = 12 / getScale();
    const near = findNodeNear(plan, p, tol, drag.nodeId);
    const onWall = wallLineNear(plan, p, drag.thickness || ui.thickness, drag.nodeId, false);
    const dNode = near ? G.dist(p, near) : Infinity;
    const dWall = onWall ? onWall.d : Infinity;
    if (near && dNode <= dWall) {
      mergeNodes(plan, near.id, drag.nodeId);
      if (!wallById(plan, ui.selectedWallId)) ui.selectedWallId = null;
      notify();
    }
  }
  if (drag) {
    repairWallNetwork(plan); // a húzott csomópont/fal más fal vonalára kerülhetett
    notify();
    checkpoint(drag.before);
  }
  drag = null;
  ui.dragging = false;
  renderAll(); // a húzás alatt gyorsítótárazott helyiség-nyomvonalak most frissülnek pontosra
}

// a szabad-táv szám szerkesztése: a fal ONNAN elfelé/felé tolódik, hogy az
// adott oldalon pontosan a beírt méret maradjon
function openClearanceEditor(wallId, sideKey, clientX, clientY) {
  closeEditor();
  const plan = getPlan();
  const w = wallById(plan, wallId);
  const c = w && wallClearances(plan, w);
  const side = c && c[sideKey];
  if (!side) return;

  openValueEditor(Math.round(side.clear), clientX, clientY, v => {
    const before = snapshot();
    setWallClearance(plan, w, sideKey, v);
    repairWallNetwork(plan);
    notify();
    checkpoint(before);
  });
}

// a nyílászáró saroktól mért távolságának szerkesztése: a nyílás a fal mentén
// úgy csúszik, hogy az adott saroktól pont a beírt méret maradjon
function openCornerEditor(objectId, which, clientX, clientY) {
  closeEditor();
  const plan = getPlan();
  const obj = plan?.objects.find(o => o.id === objectId);
  const c = obj && openingClearances(plan, obj);
  if (!c) return;

  openValueEditor(Math.round(which === 'fromEnd' ? c.fromEnd : c.fromStart), clientX, clientY, v => {
    const before = snapshot();
    setOpeningClearance(plan, obj, which, v);
    checkpoint(before);
  });
}

// ------------------------------------------------- hossz-címke szerkesztése

function openLengthEditor(wallId, clientX, clientY) {
  closeEditor();
  const plan = getPlan();
  const w = wallById(plan, wallId);
  if (!w) return;

  ui.selectedWallId = wallId;
  ui.selectedRoomId = null;
  ui.selectedObjectId = null;
  renderAll();

  openValueEditor(Math.round(wallInteriorLengthOf(plan, w)), clientX, clientY, v => {
    const before = snapshot();
    setWallInteriorLength(plan, w, v, ui.wallGrow); // a címke belméretet mutat, a bevitel is az
    checkpoint(before);
  });
}

// a rajzra kitett kis cm-beviteli buborék (hossz- és szabad-táv szerkesztéshez)
function openValueEditor(initial, clientX, clientY, onCommit) {
  const rect = wrap.getBoundingClientRect();
  editorEl = document.createElement('div');
  editorEl.className = 'len-editor';
  editorEl.style.left = `${clientX - rect.left}px`;
  editorEl.style.top = `${clientY - rect.top}px`;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.value = initial;
  editorEl.appendChild(input);
  editorEl.append(' cm');
  wrap.appendChild(editorEl);
  input.focus();
  input.select();

  const box = editorEl;
  let done = false;
  function finish(commit) {
    // az Enter és az utána következő blur is ide fut be — csak egyszer zárunk
    // (enélkül a második hívás már eltávolított elemen dolgozna, és kivételt
    // dobna a húzás/kattintás közepén)
    if (done) return;
    done = true;
    const v = parseFloat(input.value);
    if (commit && v > 0) onCommit(v);
    box.remove();
    if (editorEl === box) editorEl = null;
    editorFinish = null;
  }
  editorFinish = finish;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

// helyiség neve + színe: buborék-szerkesztő a kattintott pont mellett
function openRoomEditor(roomId, clientX, clientY) {
  closeEditor();
  const plan = getPlan();
  const room = plan.rooms.find(r => r.id === roomId);
  if (!room) return;
  const before = snapshot(); // a szerkesztés kezdete előtti állapot — egyetlen visszavonható lépés lesz belőle

  ui.selectedRoomId = roomId;
  ui.selectedWallId = null;
  ui.selectedObjectId = null;
  renderAll();

  const rect = wrap.getBoundingClientRect();
  editorEl = document.createElement('div');
  editorEl.className = 'room-editor';
  editorEl.style.left = `${clientX - rect.left}px`;
  editorEl.style.top = `${clientY - rect.top}px`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = room.name;

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = room.color;
  colorInput.title = 'Szín';

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.textContent = '×';
  delBtn.title = 'Helyiség törlése';

  editorEl.append(nameInput, colorInput, delBtn);
  wrap.appendChild(editorEl);
  nameInput.focus();
  nameInput.select();

  function finish(commit) {
    if (commit) {
      const v = nameInput.value.trim();
      if (v && v !== room.name) renameRoom(plan, roomId, v);
      if (colorInput.value !== room.color) recolorRoom(plan, roomId, colorInput.value);
      checkpoint(before);
    }
    editorEl.remove();
    editorEl = null;
    editorFinish = null;
  }
  editorFinish = finish;

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  // a szín-választóra váltáskor a fókusz a szerkesztőn belül marad — ne zárjuk be
  nameInput.addEventListener('blur', e => {
    if (e.relatedTarget && editorEl.contains(e.relatedTarget)) return;
    finish(true);
  });
  colorInput.addEventListener('click', e => e.stopPropagation());
  delBtn.addEventListener('click', () => {
    const b = snapshot();
    deleteRoom(plan, roomId);
    checkpoint(b);
    ui.selectedRoomId = null;
    editorEl.remove();
    editorEl = null;
    editorFinish = null;
  });
}

function closeEditor(commit = true) {
  if (editorFinish) {
    const f = editorFinish;
    editorFinish = null;
    f(commit);
  } else if (editorEl) {
    editorEl.remove();
    editorEl = null;
  }
}

function refreshFloat(client, html) {
  if (!client) { floatEl.hidden = true; return; }
  const rect = wrap.getBoundingClientRect();
  floatEl.style.left = `${client.x - rect.left + 16}px`;
  floatEl.style.top = `${client.y - rect.top + 16}px`;
  floatEl.innerHTML = html;
  floatEl.hidden = false;
}
