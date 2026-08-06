// Megosztott rács-alapú segédeszközök: falak rasterizálása, kontúrkövetés,
// egyszerűsítés. A helyiség-felismerés (rooms.js) és a külső sziluett-
// felismerés (exterior.js) egyaránt ezekre épül.

import { nodeById } from './plan.js';
import * as G from './geometry.js';
import { SVG_NS } from './config.js';

export function rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, wall) {
  const a = nodeById(plan, wall.a), b = nodeById(plan, wall.b);
  if (!a || !b) return;
  const half = wall.thickness / 2;

  // Egyenes fal: TÉGLALAP (lapos, derékszögű falvég), nem kapszula. A
  // szakasz-távolságos (kapszula) kitöltés a fal két végén fél-vastagságnyi
  // FÉLKÖRT hagy. A fal-fal sarkoknál ez nem látszik, mert ott a
  // blockNodeCorners sarok-kitöltése kiegyenesíti — de a SZABAD falvéget (pl. miután
  // a szomszédos falat törölték) semmi nem igazítja ki, így ott a lekerekítés
  // a rajzra is kikerült, levágott/ferde sarokként, és a külső méretlánc is
  // apró (0,0x-es) szakaszokra esett szét rajta.
  if (!wall.bulge) {
    rasterizeBox(blocked, cols, rows, minX, minY, cell, a, b, half);
    return;
  }

  // Ívnél marad a kapszula: az ívet apró szakaszokra bontjuk, és ott a kerek
  // végek épp a szakaszok találkozását tömítik el (téglalapokkal az ív külső
  // oldalán rések nyílnának).
  const poly = arcPolyline(a, b, wall.bulge, cell);
  for (let i = 0; i < poly.length - 1; i++) {
    rasterizeSegment(blocked, cols, rows, minX, minY, cell, poly[i], poly[i + 1], half);
  }
}

// egyenes fal kitöltése téglalapként: a hossz menti vetület a [0, hossz]
// szakaszon belül, a merőleges távolság pedig a fél vastagságon belül
function rasterizeBox(blocked, cols, rows, minX, minY, cell, p1, p2, half) {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (len < 1e-9) return;
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;

  const x0 = Math.max(0, Math.floor((Math.min(p1.x, p2.x) - half - minX) / cell));
  const x1 = Math.min(cols, Math.ceil((Math.max(p1.x, p2.x) + half - minX) / cell));
  const y0 = Math.max(0, Math.floor((Math.min(p1.y, p2.y) - half - minY) / cell));
  const y1 = Math.min(rows, Math.ceil((Math.max(p1.y, p2.y) + half - minY) / cell));

  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      const dx = minX + (gx + 0.5) * cell - p1.x, dy = minY + (gy + 0.5) * cell - p1.y;
      const along = dx * ux + dy * uy;
      if (along < 0 || along > len) continue;
      if (Math.abs(dx * -uy + dy * ux) <= half) blocked[gy * cols + gx] = 1;
    }
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

// A falak téglalapjai a sarkoknál nem érnek össze: a csomópont körüli negyed
// kimarad. Ezt csomópontonként, FALPÁRONKÉNT töltjük ki, pontosan a két fal
// külső síkjáig (gérvágás).
//
// Korábban ez egy csomópontra írt, max(vastagság) oldalú NÉGYZET volt. Amíg
// minden fal egyforma vastag, ez pont jó — de eltérő vastagságoknál a négyzet
// túllóg a vékonyabb fal síkján: egy 30-as és egy 20-as fal sarkánál (30-20)/2
// = 5 cm-es lépcső keletkezett a vékonyabb fal külső oldalán, végig a vastagabb
// fal 30 cm-es szélességében. Ez a "nem záródik rendesen" jelenség.
export function blockNodeCorners(blocked, cols, rows, minX, minY, cell, plan) {
  for (const n of plan.nodes) {
    const walls = plan.walls.filter(w => w.a === n.id || w.b === n.id);
    if (walls.length < 2) continue; // szabad falvég: ott lapos lezárás kell, nem folt

    const arms = walls.map(w => {
      const other = nodeById(plan, w.a === n.id ? w.b : w.a);
      return { dir: G.unit(n, other), half: w.thickness / 2 };
    });

    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const quad = cornerQuad(n, arms[i], arms[j]);
        if (quad) fillPolygon(blocked, cols, rows, minX, minY, cell, quad);
      }
    }
  }
}

// A két fal által bezárt sarok kitöltendő négyszöge: a csomóponttól a két fal
// EGYMÁSTÓL ELFELÉ néző külső síkjáig, azok metszéspontjáig (gérpont).
function cornerQuad(n, armA, armB) {
  const cross = armA.dir.x * armB.dir.y - armA.dir.y * armB.dir.x;
  if (Math.abs(cross) < 1e-6) return null; // egy vonalban lévő falak: nincs sarok

  // az a normális, amelyik a másik faltól ELFELÉ mutat
  const outward = (arm, otherDir) => {
    const nx = -arm.dir.y, ny = arm.dir.x;
    return (nx * otherDir.x + ny * otherDir.y) > 0 ? { x: -nx, y: -ny } : { x: nx, y: ny };
  };
  const nA = outward(armA, armB.dir), nB = outward(armB, armA.dir);
  const eA = { x: n.x + nA.x * armA.half, y: n.y + nA.y * armA.half };
  const eB = { x: n.x + nB.x * armB.half, y: n.y + nB.y * armB.half };

  // eA + t*dirA = eB + s*dirB
  const t = ((eB.x - eA.x) * armB.dir.y - (eB.y - eA.y) * armB.dir.x) / cross;
  const maxMiter = 5 * Math.max(armA.half, armB.half); // hegyesszögnél ne szaladjon el a gérpont
  if (!Number.isFinite(t) || Math.abs(t) > maxMiter) return null;
  const p = { x: eA.x + armA.dir.x * t, y: eA.y + armA.dir.y * t };

  return [n, eA, p, eB];
}

// Konvex sokszög kitöltése a rácsban, a cella középpontja alapján — a HATÁRON
// fekvő középpontot is befogadva. Ez utóbbi lényeges: a sarok-négyszög éle
// pontosan a fal síkján fut, és a falak rasterizálása is befogadó (`<= half`),
// szigorú összehasonlítással a sarokból egy cellasor kimaradna (a sziluett
// sarkai 2 cm-rel beljebb csúsztak volna).
function fillPolygon(blocked, cols, rows, minX, minY, cell, poly) {
  let loX = Infinity, loY = Infinity, hiX = -Infinity, hiY = -Infinity;
  for (const p of poly) {
    loX = Math.min(loX, p.x); loY = Math.min(loY, p.y);
    hiX = Math.max(hiX, p.x); hiY = Math.max(hiY, p.y);
  }
  const x0 = Math.max(0, Math.floor((loX - minX) / cell) - 1);
  const x1 = Math.min(cols, Math.ceil((hiX - minX) / cell) + 1);
  const y0 = Math.max(0, Math.floor((loY - minY) / cell) - 1);
  const y1 = Math.min(rows, Math.ceil((hiY - minY) / cell) + 1);

  // a sokszög körüljárási iránya (a sarok-négyszög konvex, de az irány a
  // falak állásától függ) — enélkül a fél-sík teszt előjele fordulna
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  }
  const sign = area >= 0 ? 1 : -1;

  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      const px = minX + (gx + 0.5) * cell, py = minY + (gy + 0.5) * cell;
      if (insideConvex(px, py, poly, sign)) blocked[gy * cols + gx] = 1;
    }
  }
}

function insideConvex(px, py, poly, sign) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross * sign < -1e-6) return false;
  }
  return true;
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

// A rács-kontúr minden sarkán fél-cellányi (2 cm-es cellánál 1,41 cm-es) ferde
// levágás keletkezik: a sarokcella középpontját a cellToFacePoint MINDKÉT
// tengely mentén elmozdítja a fal síkjához, így a sarok "letörve" jön ki.
// Normál nagyításban ez nem látszott, de a méretláncot apró (0,0x-es)
// szakaszokra darabolta, és szabad falvégnél a rajzon is szemet szúrt.
// A valóságban ez éles derékszög: a rövid átlós élt eldobjuk, és a két
// szomszédos, tengely-párhuzamos élt a metszéspontjukig hosszabbítjuk.
export function sharpenCorners(pts, cell) {
  const maxDiag = cell * 1.5;
  let poly = pts;

  for (let pass = 0; pass < 4; pass++) {
    const n = poly.length;
    if (n < 4) break;

    // 1. lépés: minden rövid átlós élhez kiszámoljuk az éles sarkot. Külön
    // lépésben, hogy a listán körbefordulva se essen szét a sorrend (az utolsó
    // él másik végpontja a 0. indexű pont).
    const cornerAt = new Map(); // az él kezdő indexe -> éles sarokpont
    const consumed = new Set(); // az él végpontja, ami beolvad a sarokba
    for (let i = 0; i < n; i++) {
      const cur = poly[i], next = poly[(i + 1) % n];
      const dx = next.x - cur.x, dy = next.y - cur.y;
      if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) continue; // nem átlós
      if (Math.hypot(dx, dy) > maxDiag) continue;               // valódi ferde fal
      if (consumed.has(i) || cornerAt.has((i + 1) % n)) continue; // egymást átfedő átlók
      const corner = axisCorner(poly[(i - 1 + n) % n], cur, next, poly[(i + 2) % n]);
      if (!corner) continue;
      cornerAt.set(i, corner);
      consumed.add((i + 1) % n);
    }
    if (!cornerAt.size) break;

    const out = [];
    for (let i = 0; i < n; i++) {
      if (cornerAt.has(i)) out.push(cornerAt.get(i));
      else if (!consumed.has(i)) out.push(poly[i]);
    }
    poly = out;
  }
  return poly.length >= 3 ? poly : pts;
}

// A levágott sarok visszaállítása. A ferde él két végpontja már a VALÓDI
// falsíkon ül — mindegyik abban a koordinátájában, amelyikben a hozzá tartozó
// hosszú éltől eltér (a hosszú él a rács miatt fél cellával kijjebb fut).
// Ezért az éles sarok e két "szabad" koordináta párja, nem pedig a két hosszú
// él metszéspontja: utóbbi az egész alaprajzot fél cellával felfújná.
function axisCorner(prev, cur, next, after) {
  const EPSA = 1e-6;
  const prevHoriz = Math.abs(cur.y - prev.y) < EPSA && Math.abs(cur.x - prev.x) > EPSA;
  const prevVert = Math.abs(cur.x - prev.x) < EPSA && Math.abs(cur.y - prev.y) > EPSA;
  const nextHoriz = Math.abs(after.y - next.y) < EPSA && Math.abs(after.x - next.x) > EPSA;
  const nextVert = Math.abs(after.x - next.x) < EPSA && Math.abs(after.y - next.y) > EPSA;

  if (prevHoriz && nextVert) return { x: cur.x, y: next.y };
  if (prevVert && nextHoriz) return { x: next.x, y: cur.y };
  return null;
}

// A rács-kontúr visszaillesztése a valódi falsíkokra (ld. plan.js
// wallFacePlanes). Minden csúcs x/y koordinátáját a legközelebbi falsíkra
// húzzuk, ha az `tol`-on belül van — így a legfeljebb egy cellányi
// raszter-hiba eltűnik, és a szomszédos élek is pontosan egy vonalba állnak
// (ettől olvadnak össze a hajszálnyi lépcsők).
export function snapPolygonToPlanes(poly, planes, tol) {
  const snap = (v, list) => {
    let best = v, bestD = tol;
    for (const p of list) {
      const d = Math.abs(p - v);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };
  const snapped = poly.map(p => ({ x: snap(p.x, planes.xs), y: snap(p.y, planes.ys) }));

  // az illesztéstől nulla hosszúvá vált élek kiesnek
  const out = [];
  for (const p of snapped) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-6 && Math.abs(prev.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  while (out.length > 3) {
    const first = out[0], last = out[out.length - 1];
    if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) out.pop();
    else break;
  }
  return out.length >= 3 ? simplifyPolygon(out) : poly;
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
