// Egér- és billentyű-interakciók a vásznon: falrajzolás (kattintás + hossz
// begépelése), kijelölés, végpont/fal/ív húzása, hossz-címke szerkesztése,
// helyiség-kijelölés kattintással.

import { getSvg, getOverlay, getScale, clientToWorld, beginPan, el } from './canvas.js';
import { getPlan, findNodeNear, nodeById, wallById, addNode, addWall, deleteWall, mergeNodes, cleanupOrphanNodes, setWallLength, wallLengthOf, round1 } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';
import { notify, activeLevel } from './state.js';
import { snapshot, checkpoint } from './history.js';
import { GRID_MINOR } from './config.js';
import { renderAll } from './render.js';
import { addRoomAt, renameRoom, recolorRoom, deleteRoom } from './rooms.js';
import { addObject, deleteObject, moveObjectAlongWall, resizeObjectEdge, offsetOnWall } from './objects.js';
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
  select: 'Kattints falra, helyiségre vagy nyílászáróra a kijelöléshez; húzd a fogantyúkat. A hossz-/névcímkére kattintva szerkeszthető. Del: törlés. F: falrajzolás, R: helyiség. Szóköz+húzás (vagy középső gomb): nézet mozgatása bárhonnan.',
};

export function setTool(tool) {
  ui.tool = tool;
  ui.selectedWallId = null;
  ui.selectedRoomId = null;
  ui.selectedObjectId = null;
  endChain();
  if (tool === 'wall') tryResumeChain();
  svg.dataset.tool = tool;
  for (const b of document.querySelectorAll('.tool-btn[data-tool]')) {
    b.classList.toggle('active', b.dataset.tool === tool);
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

  // --- kijelölés mód ---
  const t = e.target;
  e.preventDefault(); // ne vigye el a fókuszt (pl. a hossz-szerkesztő inputról)

  if (t.dataset?.handle) {
    const kind = t.dataset.handle;
    if (kind === 'objP1' || kind === 'objP2' || kind === 'objCenter') {
      startObjectHandleDrag(plan, kind, t.dataset.object);
    } else {
      startHandleDrag(plan, kind, t.dataset.wall, p);
    }
    return;
  }

  if (t.classList?.contains('len-label')) {
    openLengthEditor(t.dataset.wall, e.clientX, e.clientY);
    return;
  }

  if (t.classList?.contains('room-name') || t.classList?.contains('room-area')) {
    openRoomEditor(t.dataset.room, e.clientX, e.clientY);
    return;
  }

  if (t.dataset?.object) {
    ui.selectedObjectId = t.dataset.object;
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    renderAll();
    startObjectHandleDrag(plan, 'objCenter', t.dataset.object);
    return;
  }

  if (t.dataset?.wall) {
    ui.selectedWallId = t.dataset.wall;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    renderAll();
    startBodyDrag(plan, t.dataset.wall, p);
    return;
  }

  if (t.dataset?.room) {
    ui.selectedRoomId = t.dataset.room;
    ui.selectedWallId = null;
    ui.selectedObjectId = null;
    renderAll();
    return;
  }

  // üres területre kattintás: kijelölés törlése + pan
  if (ui.selectedWallId || ui.selectedRoomId || ui.selectedObjectId) {
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
    renderAll();
  }
  beginPan(e);
}

function placeObject(plan, kind, target, p) {
  const wallId = target?.dataset?.wall;
  if (!wallId) { showToast('Kattints egy falra a nyílászáró elhelyezéséhez.'); return; }
  const w = wallById(plan, wallId);
  if (!w || w.bulge) { showToast('Íves falba egyelőre nem helyezhető el nyílászáró.'); return; }

  const before = snapshot();
  const defaults = kind === 'door'
    ? { flipHinge: ui.doorFlipHinge, flipSide: ui.doorFlipSide, withLeaf: ui.doorWithLeaf }
    : { sashCount: ui.windowSashCount, flipSide: ui.windowFlipSide };
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

  if (e.key === 'Escape' && (ui.tool === 'wall' || ui.tool === 'room' || ui.tool === 'door' || ui.tool === 'window')) {
    setTool('select');
    return;
  }
  if (e.key === 'Escape' && (ui.selectedWallId || ui.selectedRoomId || ui.selectedObjectId)) {
    ui.selectedWallId = null;
    ui.selectedRoomId = null;
    ui.selectedObjectId = null;
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
    const node = near || addNode(plan, G.snapToGrid(p, GRID_MINOR));
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
    return { point: { x: near.x, y: near.y }, nodeId: near.id, len: G.dist(last, near) };
  }

  const raw = Math.atan2(mouse.y - last.y, mouse.x - last.x);
  const ang = ui.orthoOnly ? G.snapAngleOrtho(raw) : G.snapAngle(raw);
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };

  let len;
  if (typedLen != null) {
    len = typedLen;
  } else {
    const proj = Math.max(0, (mouse.x - last.x) * dir.x + (mouse.y - last.y) * dir.y);
    len = Math.round(proj / GRID_MINOR) * GRID_MINOR; // rácshoz illesztett hossz
  }
  return {
    point: { x: round1(last.x + dir.x * len), y: round1(last.y + dir.y * len) },
    nodeId: null,
    len,
  };
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

  refreshFloat(draw.client, wallFloatText(end.len));
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
    drag = { kind: 'mid', w, before };
  } else {
    const nodeId = kind === 'a' ? w.a : w.b;
    drag = { kind: 'node', nodeId, before };
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

function bindDrag(plan) {
  function move(ev) {
    const p = clientToWorld(ev.clientX, ev.clientY);
    applyDrag(plan, p);
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

function applyDrag(plan, p) {
  const tol = 12 / getScale();

  if (drag.kind === 'node') {
    const n = nodeById(plan, drag.nodeId);
    const near = findNodeNear(plan, p, tol, drag.nodeId);
    if (near) { n.x = near.x; n.y = near.y; }
    else { const g = G.snapToGrid(p, GRID_MINOR); n.x = g.x; n.y = g.y; }
    notify();
    if (near) {
      const s = getScale();
      getOverlay().appendChild(el('circle', {
        cx: near.x, cy: near.y, r: 9 / s, class: 'snap-hint', 'stroke-width': 2 / s,
      }));
    }
  } else if (drag.kind === 'body') {
    const dx = Math.round((p.x - drag.start.x) / GRID_MINOR) * GRID_MINOR;
    const dy = Math.round((p.y - drag.start.y) / GRID_MINOR) * GRID_MINOR;
    const a = nodeById(plan, drag.w.a), b = nodeById(plan, drag.w.b);
    a.x = drag.orig.ax + dx; a.y = drag.orig.ay + dy;
    b.x = drag.orig.bx + dx; b.y = drag.orig.by + dy;
    notify();
  } else if (drag.kind === 'mid') {
    const a = nodeById(plan, drag.w.a), b = nodeById(plan, drag.w.b);
    const m = G.mid(a, b);
    const n = G.normal(a, b);
    const chord = G.dist(a, b);
    let s = (p.x - m.x) * n.x + (p.y - m.y) * n.y; // előjeles nyílmagasság
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
  }
}

function finishDrag(plan, p) {
  if (drag?.kind === 'node') {
    // másik csomópontra ejtve: összevonás (falak összekapcsolása)
    const tol = 12 / getScale();
    const near = findNodeNear(plan, p, tol, drag.nodeId);
    if (near) {
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

  const rect = wrap.getBoundingClientRect();
  editorEl = document.createElement('div');
  editorEl.className = 'len-editor';
  editorEl.style.left = `${clientX - rect.left}px`;
  editorEl.style.top = `${clientY - rect.top}px`;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.value = Math.round(wallLengthOf(plan, w));
  editorEl.appendChild(input);
  editorEl.append(' cm');
  wrap.appendChild(editorEl);
  input.focus();
  input.select();

  function finish(commit) {
    const v = parseFloat(input.value);
    if (commit && v > 0) {
      const before = snapshot();
      setWallLength(plan, w, v);
      checkpoint(before);
    }
    editorEl.remove();
    editorEl = null;
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
