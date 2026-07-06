// Megosztott rács-alapú segédeszközök: falak rasterizálása, kontúrkövetés,
// egyszerűsítés. A helyiség-felismerés (rooms.js) és a külső sziluett-
// felismerés (exterior.js) egyaránt ezekre épül.

import { nodeById, nodeCornerPatchThickness } from './plan.js';
import * as G from './geometry.js';
import { SVG_NS } from './config.js';

export function rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, wall) {
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

// a fal-fal sarkoknál kerek (negyedköríves) rés/rondítás keletkezne pusztán
// a szakasz-alapú rasterizálástól — ezt a render.js-ben már látott
// négyzet-kitöltéssel egyenesítjük ki, hogy a sarkok is élesek maradjanak
export function blockNodeSquares(blocked, cols, rows, minX, minY, cell, plan) {
  for (const n of plan.nodes) {
    const patch = nodeCornerPatchThickness(plan, n.id);
    if (!patch) continue;
    const half = patch / 2;
    const x0 = Math.max(0, Math.floor((n.x - half - minX) / cell));
    const x1 = Math.min(cols, Math.ceil((n.x + half - minX) / cell));
    const y0 = Math.max(0, Math.floor((n.y - half - minY) / cell));
    const y1 = Math.min(rows, Math.ceil((n.y + half - minY) / cell));
    for (let gy = y0; gy < y1; gy++) {
      for (let gx = x0; gx < x1; gx++) blocked[gy * cols + gx] = 1;
    }
  }
}

// Moore-szomszédság alapú kontúrkövetés (bináris rács határának bejárása)
const NBR = [
  { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
  { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
];

// a `filled` rács kitöltött területének határa, a (startX,startY) pontból indulva,
// a `backDir` kezdő (garantáltan HÁTTÉR, nem kitöltött) iránnyal
export function traceContour(filled, cols, rows, startX, startY, backDir) {
  const boundary = [[startX, startY]];
  let cx = startX, cy = startY;

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
    if (!found) break; // elszigetelt, egyetlen cellányi terület
    cx = found[0]; cy = found[1];
    backDir = nextBackDir;
    if (cx === startX && cy === startY) break;
    boundary.push([cx, cy]);
  }
  return boundary;
}

// mint traceContour, de a kezdőpontot (és a hozzá tartozó "háttér" irányt) maga
// keresi meg a rács bal-felső sarkából indulva — egyszerűen összefüggő (lyuk
// nélküli) kitöltött területekhez (pl. egy helyiség)
export function traceContourFromScan(filled, cols, rows) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (filled[y * cols + x]) return traceContour(filled, cols, rows, x, y, 4);
    }
  }
  return [];
}

// a `blocked` (fal) és `filled` (a rács szélétől elért, tehát épületen KÍVÜLI
// terület) rácsban megkeresi az ÖSSZES, falak által teljesen körülzárt üres
// foltot (minden helyiség-szerű "lyukat", akár többet is egymástól
// függetlenül) — a traceContourFromScan csak az elsőt találná meg. Minden
// lyukhoz visszaadja a saját (csak rá vonatkozó) kitöltött-rácsát is, mert a
// cellToFacePoint-nak ez kell a fal felé néző pontos szélpont kiszámolásához
export function traceAllHoles(blocked, filled, cols, rows) {
  const visited = new Uint8Array(cols * rows);
  const holes = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (blocked[idx] || filled[idx] || visited[idx]) continue;

      const comp = new Uint8Array(cols * rows);
      const stack = [[x, y]];
      comp[idx] = 1; visited[idx] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nidx = ny * cols + nx;
          if (blocked[nidx] || filled[nidx] || visited[nidx]) continue;
          visited[nidx] = 1; comp[nidx] = 1;
          stack.push([nx, ny]);
        }
      }
      const contourCells = traceContourFromScan(comp, cols, rows);
      if (contourCells.length >= 3) holes.push({ comp, contourCells });
    }
  }
  return holes;
}

// egy határ-cella közepe helyett a valódi cellaszélig tolt pontot adja vissza —
// a puszta cellaközép fél cellányi rést hagyna a fal felé, mert a kontúr a
// kitöltött cellák KÖZEPÉN, nem a szélén húzódik
export function cellToFacePoint(gx, gy, filled, cols, rows, minX, minY, cell) {
  const half = cell / 2;
  const blockedAt = (x, y) => x < 0 || y < 0 || x >= cols || y >= rows || !filled[y * cols + x];
  let ox = 0, oy = 0;
  if (blockedAt(gx + 1, gy)) ox += half;
  if (blockedAt(gx - 1, gy)) ox -= half;
  if (blockedAt(gx, gy + 1)) oy += half;
  if (blockedAt(gx, gy - 1)) oy -= half;
  return { x: minX + (gx + 0.5) * cell + ox, y: minY + (gy + 0.5) * cell + oy };
}

// egymással kollineáris pontok eldobása, hogy a lépcsős rács-kontúr tiszta töréspontokat adjon
export function simplifyPolygon(pts) {
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

export function polygonAreaAndCentroid(pts) {
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
