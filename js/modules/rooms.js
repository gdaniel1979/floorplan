// Helyiség-felismerés: egy kattintott pontból induló, falakkal körbezárt terület
// megkeresése rács-alapú kitöltéssel (flood fill), majd a kontúr vektorizálása
// terület- és súlypont-számításhoz. A falak vastagsága a rácsba "beleég", így
// a kapott terület a valós belső (nettó) alapterületet adja, nem a faltengelyig
// mért méretet — és mindig szinkronban marad a falakkal, mert nincs külön,
// kézzel rajzolt határ: a helyiség alakja a falakból származik.

import { newId, notify } from './state.js';
import { nodeById, round1 } from './plan.js';
import * as G from './geometry.js';
import { SVG_NS } from './config.js';
import { ui } from './uistate.js';

const CELL_TARGET = 2;    // cm – célzott rács-felbontás
const MAX_CELLS = 260000; // teljesítmény-korlát; ennél nagyobb alaprajznál durvább rács

const DEFAULT_COLORS = ['#cfe8ff', '#ffe8cf', '#d9f2d0', '#f2d0e8', '#fff3b0', '#d0e8f2', '#e8d0f2', '#f2e0d0'];
let colorCursor = 0;
function nextDefaultColor() {
  const c = DEFAULT_COLORS[colorCursor % DEFAULT_COLORS.length];
  colorCursor++;
  return c;
}

// --- megosztott rács (fal-rasterizáció) egy render-körön belül újrahasznosítva ---

let gridCache = null; // { plan, blocked, cols, rows, minX, minY, cell }

function getGrid(plan) {
  if (ui.dragging && gridCache && gridCache.plan === plan) return gridCache;
  gridCache = { plan, ...buildGrid(plan) };
  return gridCache;
}

function buildGrid(plan) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of plan.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  const margin = 60;
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);

  let cell = CELL_TARGET;
  let cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  while (cols * rows > MAX_CELLS) {
    cell *= 1.4;
    cols = Math.ceil(w / cell);
    rows = Math.ceil(h / cell);
  }

  const blocked = new Uint8Array(cols * rows);
  for (const wall of plan.walls) rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, wall);
  return { blocked, cols, rows, minX, minY, cell };
}

function rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, wall) {
  const a = nodeById(plan, wall.a), b = nodeById(plan, wall.b);
  if (!a || !b) return;
  const half = wall.thickness / 2;
  const poly = wall.bulge ? arcPolyline(a, b, wall.bulge, cell) : [a, b];
  for (let i = 0; i < poly.length - 1; i++) {
    rasterizeSegment(blocked, cols, rows, minX, minY, cell, poly[i], poly[i + 1], half);
  }
}

// az ívet a böngésző saját SVG-path-geometriájával mintavételezzük — ez elkerüli
// az ívközéppont/irány-előjel külön levezetését, és pontosan a látott rajzot követi
function arcPolyline(a, b, bulge, cell) {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', G.wallPathD(a, b, bulge));
  const len = path.getTotalLength();
  const n = Math.max(2, Math.ceil(len / cell));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength(len * i / n);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

function rasterizeSegment(blocked, cols, rows, minX, minY, cell, p1, p2, half) {
  const x0 = Math.max(0, Math.floor((Math.min(p1.x, p2.x) - half - minX) / cell));
  const x1 = Math.min(cols, Math.ceil((Math.max(p1.x, p2.x) + half - minX) / cell));
  const y0 = Math.max(0, Math.floor((Math.min(p1.y, p2.y) - half - minY) / cell));
  const y1 = Math.min(rows, Math.ceil((Math.max(p1.y, p2.y) + half - minY) / cell));
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      const wx = minX + (gx + 0.5) * cell, wy = minY + (gy + 0.5) * cell;
      const d = distToSegment({ x: wx, y: wy }, p1, p2);
      if (d <= half) blocked[gy * cols + gx] = 1;
    }
  }
}

function distToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

// --- flood fill egy adott pontból + kontúr-vektorizálás ---

function floodFillRoom(plan, seed) {
  const { blocked, cols, rows, minX, minY, cell } = getGrid(plan);
  const sx = Math.floor((seed.x - minX) / cell), sy = Math.floor((seed.y - minY) / cell);
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows || blocked[sy * cols + sx]) return null;

  const filled = new Uint8Array(cols * rows);
  const stack = [[sx, sy]];
  filled[sy * cols + sx] = 1;
  let leaked = false;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) leaked = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (blocked[idx] || filled[idx]) continue;
      filled[idx] = 1;
      stack.push([nx, ny]);
    }
  }
  if (leaked) return null; // a terület nincs teljesen körbezárva

  const contourCells = traceContourCells(filled, cols, rows);
  const poly = simplifyPolygon(contourCells.map(([gx, gy]) => ({
    x: minX + (gx + 0.5) * cell, y: minY + (gy + 0.5) * cell,
  })));
  if (poly.length < 3) return null;

  const { area, cx, cy } = polygonAreaAndCentroid(poly);
  return { poly, areaM2: area / 10000, centroid: { x: cx, y: cy }, filled, cols, rows, minX, minY, cell };
}

// Moore-szomszédság alapú kontúrkövetés (bináris rács határának bejárása)
const NBR = [
  { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
  { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
];

function traceContourCells(filled, cols, rows) {
  let start = null;
  for (let y = 0; y < rows && !start; y++) {
    for (let x = 0; x < cols; x++) {
      if (filled[y * cols + x]) { start = [x, y]; break; }
    }
  }
  if (!start) return [];

  const [sx, sy] = start;
  const boundary = [[sx, sy]];
  let cx = sx, cy = sy;
  let backDir = 4; // nyugat — a kezdőpont bal szomszédja garantáltan üres (balról-jobbra pásztáztunk)

  for (let iter = 0; iter < 200000; iter++) {
    let found = null, nextBackDir = null;
    for (let i = 1; i <= 8; i++) {
      const idx = (backDir + i) % 8;
      const nb = NBR[idx];
      const nx = cx + nb.dx, ny = cy + nb.dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && filled[ny * cols + nx]) {
        found = [nx, ny];
        nextBackDir = (idx + 4) % 8;
        break;
      }
    }
    if (!found) break; // elszigetelt, egyetlen cellányi "helyiség"
    cx = found[0]; cy = found[1];
    backDir = nextBackDir;
    if (cx === sx && cy === sy) break;
    boundary.push([cx, cy]);
  }
  return boundary;
}

// egymással kollineáris pontok eldobása, hogy a lépcsős rács-kontúr tiszta töréspontokat adjon
function simplifyPolygon(pts) {
  if (pts.length < 3) return pts;
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.abs(cross) > 1e-6) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

function polygonAreaAndCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const cross = p0.x * p1.y - p1.x * p0.y;
    a += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: pts[0].x, cy: pts[0].y };
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
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

export function deleteRoom(plan, id) {
  plan.rooms = plan.rooms.filter(r => r.id !== id);
  traceCache.delete(id);
  notify();
}
