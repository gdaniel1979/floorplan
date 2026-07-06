// Az épület külső sziluettjének felismerése (a "kívül" terület kitöltésével,
// majd annak a fal felé néző határának bejárásával), és az ebből képzett
// láncolt méretvonalak (szakaszonkénti + teljes hossz), ahogy egy
// építészeti tervrajzon szokás — a méretek a KÜLSŐ falsíkhoz igazodnak.
//
// A rács itt az egész alaprajzra épül fel (nem helyiségenként, mint a
// rooms.js-ben), ezért gyorsítótárazva fut csak újra, ha a falak tényleg
// változtak (lásd getDimensionChains).

import { nodeById } from './plan.js';
import * as G from './geometry.js';
import * as R from './raster.js';
import { ui } from './uistate.js';

const CELL = 2; // cm
const MARGIN = 100; // cm – ennyivel nagyobb rácsot építünk az épület befoglaló téglalapjánál
// ilyen közel eső csomópont számít "ráillesztett" töréspontnak — vastag (pl. 30 cm-es)
// külső falnál egy T-elágazás csomópontja kb. fél-vastagságnyira (itt akár 15 cm) esik
// a fal külső síkjától, ezért ennek a tűrésnek ezt is bőven le kell fednie
const BREAK_TOL = 20;
const MIN_SEG = 3; // cm – ennél közelebbi töréspontokat összevonjuk
const CORNER_TOL = 40; // cm – ilyen közelségben lévő valódi csomópont számít az él saját sarkának
                       // (ezt ki kell zárni a töréspont-keresésből, mert a tengelyponton van,
                       // nem a fal-síkon — máskülönben minden sarok mellett egy hamis "törés" jönne)

// a teljes alaprajzra épülő rács: falak beleégetve ("blocked"), és az onnan
// kívül eső, a rács szélétől elért gyűrű-terület ("filled") — ezt a
// sziluett-bejárás ÉS a lenti lyuk-keresés (findWallHoles) is használja
function buildWallMask(plan) {
  if (plan.nodes.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of plan.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  minX -= MARGIN; minY -= MARGIN; maxX += MARGIN; maxY += MARGIN;
  const cell = CELL;
  const cols = Math.ceil((maxX - minX) / cell), rows = Math.ceil((maxY - minY) / cell);
  if (cols * rows > 4_000_000) return null; // biztonsági korlát nagyon nagy alaprajzokra

  const blocked = new Uint8Array(cols * rows);
  for (const w of plan.walls) R.rasterizeWall(blocked, cols, rows, minX, minY, cell, plan, w);
  R.blockNodeSquares(blocked, cols, rows, minX, minY, cell, plan);

  // a margóból ("kívül") kitöltjük a teret — ez egy gyűrű-alakú terület:
  // a rács saját külső pereme és az épület fala közötti rész
  const filled = new Uint8Array(cols * rows);
  const stack = [[0, 0]];
  filled[0] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (blocked[idx] || filled[idx]) continue;
      filled[idx] = 1;
      stack.push([nx, ny]);
    }
  }
  return { blocked, filled, cols, rows, minX, minY, cell };
}

function traceOuterSilhouette(mask) {
  const { blocked, filled, cols, rows, minX, minY, cell } = mask;

  // a gyűrűnek két határa van: a rács saját (mesterséges) pereme, és az épület
  // fala felé néző belső határ — nekünk ez utóbbi kell. Ezért NEM a szokásos
  // "bal-felső első kitöltött cella" kezdőpontból indulunk (az a rács saját
  // pereme lenne), hanem az első olyan, a rács szélétől távol eső kitöltött
  // cellától, aminek van blokkolt (fal) szomszédja — ez már a valódi falra néz.
  let startX = -1, startY = -1, startBackDir = -1;
  outer:
  for (let y = 1; y < rows - 1 && startX < 0; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!filled[y * cols + x]) continue;
      const dirs = [{ i: 0, dx: 1, dy: 0 }, { i: 2, dx: 0, dy: 1 }, { i: 4, dx: -1, dy: 0 }, { i: 6, dx: 0, dy: -1 }];
      for (const d of dirs) {
        const nx = x + d.dx, ny = y + d.dy;
        if (blocked[ny * cols + nx]) { startX = x; startY = y; startBackDir = d.i; break; }
      }
      if (startX >= 0) break outer;
    }
  }
  if (startX < 0) return null; // nincs épület (üres alaprajz)

  const contourCells = R.traceContour(filled, cols, rows, startX, startY, startBackDir);
  const poly = R.simplifyPolygon(contourCells.map(([gx, gy]) =>
    R.cellToFacePoint(gx, gy, filled, cols, rows, minX, minY, cell)));
  return poly.length >= 3 ? poly : null;
}

// a falak által teljesen körülzárt üres foltok (helyiség-szerű "lyukak") —
// ez a render.js-beli fal-alak belső határainak forrása, függetlenül attól,
// hogy a felhasználó rákattintott-e már az adott foltra a Helyiség eszközzel
function findWallHoles(mask) {
  const { blocked, filled, cols, rows, minX, minY, cell } = mask;
  const rawHoles = R.traceAllHoles(blocked, filled, cols, rows);
  const polys = [];
  for (const { comp, contourCells } of rawHoles) {
    const poly = R.simplifyPolygon(contourCells.map(([gx, gy]) =>
      R.cellToFacePoint(gx, gy, comp, cols, rows, minX, minY, cell)));
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

// gyorsítótárazott alak: a rács-építés (rasterizálás) a drága rész, ezért a
// sziluettet ÉS a lyukakat egy közös gyorsítótár mögé tesszük (ld. getDimensionChains
// hasonló indoklása lentebb)
let shapeCache = null; // { key, silhouette, holes }

function getWallShape(plan) {
  if (ui.dragging && shapeCache) return shapeCache;
  const key = fingerprint(plan);
  if (shapeCache && shapeCache.key === key) return shapeCache;
  const mask = buildWallMask(plan);
  const silhouette = mask ? traceOuterSilhouette(mask) : null;
  const holes = mask ? findWallHoles(mask) : [];
  shapeCache = { key, silhouette, holes };
  return shapeCache;
}

export function exteriorSilhouette(plan) {
  return getWallShape(plan).silhouette;
}

// a falak sraffozott alakjának (render.js) belső határai — minden falak által
// körülzárt üres folt, a Helyiség-objektumoktól függetlenül
export function wallShapeHoles(plan) {
  return getWallShape(plan).holes;
}

// a sziluett minden élére kiszámolja a méretezéshez szükséges töréspontokat
// (a más falaktól odacsatlakozó csomópontok vetületét) és a kifelé mutató irányt
export function dimensionChains(plan, silhouette) {
  if (!silhouette) return [];
  const centroid = polyCentroid(silhouette);
  const n = silhouette.length;
  const chains = [];

  for (let i = 0; i < n; i++) {
    const p1 = silhouette[i], p2 = silhouette[(i + 1) % n];
    const len = G.dist(p1, p2);
    if (len < MIN_SEG) continue;
    const dir = G.unit(p1, p2);
    const rawNormal = G.normal(p1, p2);
    const mid = G.mid(p1, p2);
    const outward = ((mid.x - centroid.x) * rawNormal.x + (mid.y - centroid.y) * rawNormal.y) > 0 ? 1 : -1;
    const normal = { x: rawNormal.x * outward, y: rawNormal.y * outward };

    // az él két végéhez legközelebbi valódi csomópontok — ezek a "sarok" tengelypontjai,
    // nem tényleges töréspontok (a fal félvastagsága miatt csúsznak el a sziluett-végponttól)
    const cornerStart = nearestNode(plan, p1, CORNER_TOL);
    const cornerEnd = nearestNode(plan, p2, CORNER_TOL);

    // töréspontok: a plan összes (nem sarok-) csomópontja, ami erre az élre esik (T-elágazás)
    const breaks = new Set([0, len]);
    for (const node of plan.nodes) {
      if (node === cornerStart || node === cornerEnd) continue;
      const t = (node.x - p1.x) * dir.x + (node.y - p1.y) * dir.y;
      if (t < MIN_SEG || t > len - MIN_SEG) continue;
      const perp = Math.abs((node.x - p1.x) * rawNormal.x + (node.y - p1.y) * rawNormal.y);
      if (perp <= BREAK_TOL) breaks.add(Math.round(t));
    }
    const sortedBreaks = [...breaks].sort((a, b) => a - b);
    const points = sortedBreaks.map(t => ({ x: p1.x + dir.x * t, y: p1.y + dir.y * t, t }));

    chains.push({ p1, p2, dir, normal, len, points });
  }
  return chains;
}

function polyCentroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function nearestNode(plan, p, tol) {
  let best = null, bestD = tol;
  for (const n of plan.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// gyorsítótárazott lánc-számítás — a sziluett-felismerés viszonylag drága
// (rács az egész alaprajzra), ezért kétféleképp kerüljük a felesleges újraszámolást:
// húzás közben (minden egérmozdulatra újrarajzol) mindig az utolsó eredményt adjuk
// vissza; egyébként egy olcsó "ujjlenyomat" alapján csak akkor számolunk újra, ha a
// falak/csomópontok ténylegesen változtak (pl. helyiség átnevezése nem számít újra)
let cache = null; // { key, chains }

export function getDimensionChains(plan) {
  if (ui.dragging && cache) return cache.chains;
  const key = fingerprint(plan);
  if (cache && cache.key === key) return cache.chains;
  const silhouette = exteriorSilhouette(plan);
  const chains = dimensionChains(plan, silhouette);
  cache = { key, chains };
  return chains;
}

function fingerprint(plan) {
  let h = plan.nodes.length * 31 + plan.walls.length;
  for (const n of plan.nodes) h = h * 33 + n.x * 7 + n.y * 13;
  for (const w of plan.walls) h = h * 33 + w.thickness * 3 + (w.bulge || 0) * 5;
  return h;
}

// igaz, ha egy fal (mindkét végpontja) egy méretlánc élére illeszkedik —
// ilyenkor a régi, falra írt hossz-címke elhagyható (a lánc már jelzi)
export function wallOnChains(plan, wall, chains) {
  const a = nodeById(plan, wall.a), b = nodeById(plan, wall.b);
  if (!a || !b) return false;
  return chains.some(ch => onLine(a, ch) && onLine(b, ch));
}

function onLine(p, chain) {
  const t = (p.x - chain.p1.x) * chain.dir.x + (p.y - chain.p1.y) * chain.dir.y;
  if (t < -BREAK_TOL || t > chain.len + BREAK_TOL) return false;
  const perp = (p.x - chain.p1.x) * chain.normal.x + (p.y - chain.p1.y) * chain.normal.y;
  return Math.abs(perp) <= BREAK_TOL;
}
