// Helyiség-felismerés: egy kattintott pontból induló, falakkal körbezárt terület
// megkeresése rács-alapú kitöltéssel (flood fill), majd a kontúr vektorizálása
// terület- és súlypont-számításhoz. A falak vastagsága a rácsba "beleég", így
// a kapott terület a valós belső (nettó) alapterületet adja, nem a faltengelyig
// mért méretet — és mindig szinkronban marad a falakkal, mert nincs külön,
// kézzel rajzolt határ: a helyiség alakja a falakból származik.
//
// A rács MINDIG a kattintott pont körül, helyileg épül fel (nem az egész
// alaprajz méretéhez igazodva) — így egy nagy, sok helyiséges lakásban is
// éles (2 cm-es) marad a felbontás akár egy apró fülkénél is. Ha a helyi rács
// nem elég nagy egy adott helyiséghez, egyre nagyobb sugárral újrapróbáljuk.
//
// FONTOS: a helyiség színe (color) csak adatként/jegyzetként tárolódik —
// a rajzon (vászon) NEM jelenik meg kitöltésként, csak a helyiség-szerkesztő
// buborékban választható, későbbi (pl. anyagszámítási) felhasználáshoz.

import { newId, notify } from './state.js';
import { round1 } from './plan.js';
import { ui } from './uistate.js';
import * as R from './raster.js';

const CELL = 2; // cm – mindig ez a felbontás, függetlenül az épület méretétől
const RADII = [500, 1000, 2000]; // cm – próbált fél-oldalhosszak, ha a helyiség nagyobb
export const DEFAULT_ROOM_HEIGHT = 270; // cm – belmagasság, felület-számításhoz (surfaces.js)

const DEFAULT_COLORS = ['#cfe8ff', '#ffe8cf', '#d9f2d0', '#f2d0e8', '#fff3b0', '#d0e8f2', '#e8d0f2', '#f2e0d0'];
let colorCursor = 0;
function nextDefaultColor() {
  const c = DEFAULT_COLORS[colorCursor % DEFAULT_COLORS.length];
  colorCursor++;
  return c;
}

// --- flood fill egy adott pontból, helyi (kattintott pont körüli) rácson ---

function floodFillRoom(plan, seed) {
  for (let i = 0; i < RADII.length; i++) {
    const isFinal = i === RADII.length - 1;
    const res = tryFlood(plan, seed, RADII[i], isFinal);
    if (res === 'expand') continue;
    return res;
  }
  return null;
}

function tryFlood(plan, seed, radius, isFinal) {
  const cell = CELL;
  const minX = seed.x - radius, minY = seed.y - radius;
  const cols = Math.ceil((radius * 2) / cell), rows = Math.ceil((radius * 2) / cell);

  const blocked = new Uint8Array(cols * rows);
  for (const wall of plan.walls) {
    if (!wallNearBox(plan, wall, minX, minY, cols * cell, rows * cell)) continue;
    R.rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, wall);
  }
  R.blockNodeSquares(blocked, cols, rows, minX, minY, cell, plan);

  const sx = Math.floor((seed.x - minX) / cell), sy = Math.floor((seed.y - minY) / cell);
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows || blocked[sy * cols + sx]) return null; // a pont falon van

  const filled = new Uint8Array(cols * rows);
  const stack = [[sx, sy]];
  filled[sy * cols + sx] = 1;
  let touchedEdge = false;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchedEdge = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (blocked[idx] || filled[idx]) continue;
      filled[idx] = 1;
      stack.push([nx, ny]);
    }
  }

  if (touchedEdge) return isFinal ? null : 'expand'; // vagy tényleg nyitott, vagy csak a helyi rács volt kicsi

  const contourCells = R.traceContourFromScan(filled, cols, rows);
  const poly = R.simplifyPolygon(contourCells.map(([gx, gy]) =>
    R.cellToFacePoint(gx, gy, filled, cols, rows, minX, minY, cell)));
  if (poly.length < 3) return null;

  const { area, cx, cy } = R.polygonAreaAndCentroid(poly);
  return { poly, areaM2: area / 10000, centroid: { x: cx, y: cy }, filled, cols, rows, minX, minY, cell };
}

// gyors előszűrés: kihagyja azokat a falakat, amik biztosan nem érnek bele a helyi rácsba
function wallNearBox(plan, wall, minX, minY, w, h) {
  const half = wall.thickness / 2 + 5;
  const maxX = minX + w, maxY = minY + h;
  // a nodeById-t itt nem hívjuk direkt, hogy ne kelljen plan.js-t importálni csak ehhez —
  // helyette a rasterizeWall úgyis ellenőrzi a csomópontok létezését
  const nodeById = (id) => plan.nodes.find(n => n.id === id);
  const a = nodeById(wall.a), b = nodeById(wall.b);
  if (!a || !b) return false;
  const wMinX = Math.min(a.x, b.x) - half, wMaxX = Math.max(a.x, b.x) + half;
  const wMinY = Math.min(a.y, b.y) - half, wMaxY = Math.max(a.y, b.y) + half;
  return !(wMaxX < minX || wMinX > maxX || wMaxY < minY || wMinY > maxY);
}

export function polygonToPathD(poly) {
  return 'M ' + poly.map(p => `${p.x} ${p.y}`).join(' L ') + ' Z';
}

// --- helyiség-cache (render közben, húzás alatt nem számol újra) ---

const traceCache = new Map(); // roomId -> utolsó sikeres nyomvonal

export function getRoomTrace(plan, room) {
  if (ui.dragging && traceCache.has(room.id)) return traceCache.get(room.id);
  const trace = floodFillRoom(plan, room.seed);
  if (trace) traceCache.set(room.id, trace);
  else if (!ui.dragging) traceCache.delete(room.id);
  return trace || traceCache.get(room.id) || null;
}

// --- helyiség CRUD ---

// új helyiség létrehozása egy kattintott pontból; ha a pont egy már létező
// helyiség belsejébe esik, azt adja vissza duplikátum-létrehozás helyett
export function addRoomAt(plan, seed) {
  const trace = floodFillRoom(plan, seed);
  if (!trace) return { ok: false, reason: 'not-enclosed' };

  for (const r of plan.rooms) {
    const sx = Math.floor((r.seed.x - trace.minX) / trace.cell);
    const sy = Math.floor((r.seed.y - trace.minY) / trace.cell);
    if (sx >= 0 && sy >= 0 && sx < trace.cols && sy < trace.rows && trace.filled[sy * trace.cols + sx]) {
      return { ok: true, room: r, existing: true };
    }
  }

  const room = {
    id: newId(),
    name: `Helyiség ${plan.rooms.length + 1}`,
    color: nextDefaultColor(),
    height: DEFAULT_ROOM_HEIGHT,
    seed: { x: round1(seed.x), y: round1(seed.y) },
  };
  plan.rooms.push(room);
  traceCache.set(room.id, trace);
  notify();
  return { ok: true, room, existing: false };
}

export function renameRoom(plan, id, name) {
  const r = plan.rooms.find(r => r.id === id);
  if (r && name) { r.name = name; notify(); }
}

export function recolorRoom(plan, id, color) {
  const r = plan.rooms.find(r => r.id === id);
  if (r) { r.color = color; notify(); }
}

export function setRoomHeight(plan, id, height) {
  const r = plan.rooms.find(r => r.id === id);
  if (r && height > 0) { r.height = round1(height); notify(); }
}

export function deleteRoom(plan, id) {
  plan.rooms = plan.rooms.filter(r => r.id !== id);
  traceCache.delete(id);
  notify();
}
