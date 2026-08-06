// Fal-hálózat javítása: T-elágazásoknál előfordulhat, hogy egy csomópont egy
// másik fal vonalának BELSEJÉRE esik anélkül, hogy az a fal ott ténylegesen
// két falra lenne bontva (a rajzoló-eszköz és a csomópont-húzás csak létező
// csomópontra illeszt, fal közepére nem). Emiatt a render.js/raster.js
// sarok-kitöltése — ami a közös csomópontok fokszámára épül — ott nem
// ismeri fel az érintkezést, és a metsződő fal-téglalapok nyers éle látszik.
// Ez a modul ezt (és a véletlenül duplikált, fordított irányú falakat) javítja.

import { newId } from './state.js';
import { nodeById, round1 } from './plan.js';
import { GRID_MINOR } from './config.js';
import * as G from './geometry.js';

const EPS = 0.5; // cm – ennél közelebb a fal vonalához, de nem a végpontjaihoz, "rajta van"

// cm – ennél rövidebb fal nem lehet valódi fal (a legvékonyabb válaszfal is
// 10 cm), csak rajzolási maradék: a két végpontja egybeolvad. Ez tünteti el a
// lánc zárásakor keletkezett csonkokat, amitől a sarok "lépcsős" lett.
const STUB_MAX = 5;

export function repairAllPlans(state) {
  for (const p of state.properties || []) repairPropertyPlans(p);
}

export function repairPropertyPlans(property) {
  for (const level of property.levels || []) {
    if (level.plan) repairWallNetwork(level.plan);
  }
}

// a plan-t helyben módosítja; a hívó felelőssége a notify()/checkpoint()
//
// A két lépést (duplikátum-összevonás, T-elágazás-szétvágás) néhányszor
// felváltva futtatjuk: két, egymást részlegesen átfedő (de nem azonos
// végpontú) fal szétvágás UTÁN válhat pontos duplikátummá — enélkül egy
// kör után maradna néhány kettőzött szakasz.
export function repairWallNetwork(plan) {
  // régebbi/érintetlen (pl. sosem megnyitott) szintek plan-ja hiányos
  // tömbökkel is érkezhet — a getPlan()-ban látott lazy-init mintát követve
  plan.nodes ??= [];
  plan.walls ??= [];
  plan.objects ??= [];
  if (!plan.walls.length) return;

  for (let i = 0; i < 5; i++) {
    const a = mergeCoincidentNodes(plan);
    const b = mergeDuplicateWalls(plan);
    const c = splitWallsAtCrossingNodes(plan);
    if (!a && !b && !c) break;
  }
}

// Egybeeső (vagy csak jelképes csonkkal elválasztott) csomópontok összevonása.
// Három esetet kezel, mindet a lánc zárásakor keletkező hibákra:
//   1. két csomópont gyakorlatilag ugyanott van (EPS-en belül) — a duplikátum
//      miatt a hurok topológiailag nyitva marad, és a kontúr-/méretlánc-
//      számítás összezavarodik (ettől lesznek a 0,0x-es szemét-méretláncok);
//   2. két csomópontot STUB_MAX-nál rövidebb fal köt össze — ez nem lehet
//      valódi fal, csak rajzolási maradék (a "lépcsős" sarok oka);
//   3. két SZABAD VÉG (csak egy falat fogó csomópont) van STUB_MAX-nál
//      közelebb — a lánc épp csak nem ért vissza a kiindulópontra.
// A 3. eset szándékosan csak szabad végekre vonatkozik: két, egyébként beépített
// csomópontot néhány cm közelség miatt összerántani már a rajz geometriáját
// rontaná el. A megmaradó csomópont a több falat összefogó (a valódi sarok),
// azonos fokszámnál a rácson ülő — így a rajz nem mozdul el, csak a csonk tűnik el.
function mergeCoincidentNodes(plan) {
  const degree = new Map();
  for (const w of plan.walls) {
    degree.set(w.a, (degree.get(w.a) || 0) + 1);
    degree.set(w.b, (degree.get(w.b) || 0) + 1);
  }
  const deg = n => degree.get(n.id) || 0;

  // pár keresése: egybeesők, csonkkal összekötöttek, majd a közeli szabad végek
  let pair = null;
  for (let i = 0; i < plan.nodes.length && !pair; i++) {
    for (let j = i + 1; j < plan.nodes.length; j++) {
      if (G.dist(plan.nodes[i], plan.nodes[j]) <= EPS) { pair = [plan.nodes[i], plan.nodes[j]]; break; }
    }
  }
  if (!pair) {
    for (const w of plan.walls) {
      if (w.bulge) continue; // ívnél a rövid húr nem jelent csonkot
      const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
      if (a && b && G.dist(a, b) < STUB_MAX) { pair = [a, b]; break; }
    }
  }
  if (!pair) {
    const loose = plan.nodes.filter(n => deg(n) === 1);
    for (let i = 0; i < loose.length && !pair; i++) {
      for (let j = i + 1; j < loose.length; j++) {
        if (G.dist(loose[i], loose[j]) < STUB_MAX) { pair = [loose[i], loose[j]]; break; }
      }
    }
  }
  if (!pair) return false;

  const [x, y] = pair;
  const onGrid = n => n.x % GRID_MINOR === 0 && n.y % GRID_MINOR === 0;
  let keep;
  if (deg(x) !== deg(y)) keep = deg(x) > deg(y) ? x : y;
  else if (onGrid(x) !== onGrid(y)) keep = onGrid(x) ? x : y;
  else keep = x;
  const drop = keep === x ? y : x;

  for (const w of plan.walls) {
    if (w.a === drop.id) w.a = keep.id;
    if (w.b === drop.id) w.b = keep.id;
  }
  // az összevonással nulla hosszúvá vált falak (köztük maga a csonk) kiesnek
  const dead = new Set(plan.walls.filter(w => w.a === w.b).map(w => w.id));
  if (dead.size) {
    plan.walls = plan.walls.filter(w => !dead.has(w.id));
    plan.objects = plan.objects.filter(o => !dead.has(o.wallId));
  }
  plan.nodes = plan.nodes.filter(n => n.id !== drop.id);
  return true;
}

function wallKey(w) { return [w.a, w.b].sort().join('|'); }

function mergeDuplicateWalls(plan) {
  const kept = [];
  const byKey = new Map(); // key -> megtartott fal
  let changed = false;
  for (const w of plan.walls) {
    const key = wallKey(w);
    const dup = byKey.get(key);
    if (!dup) { byKey.set(key, w); kept.push(w); continue; }
    changed = true;
    const len = G.dist(nodeById(plan, dup.a), nodeById(plan, dup.b));
    for (const o of plan.objects) {
      if (o.wallId !== w.id) continue;
      o.wallId = dup.id;
      if (w.a !== dup.a) o.offset = round1(len - o.offset); // fordított irányú duplikátum volt
    }
  }
  plan.walls = kept;
  return changed;
}

function splitWallsAtCrossingNodes(plan) {
  const splitsByWall = new Map(); // wallId -> [{ nodeId, dist }]

  for (const n of plan.nodes) {
    for (const w of plan.walls) {
      if (w.bulge || w.a === n.id || w.b === n.id) continue;
      const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
      if (!a || !b) continue;
      const len = G.dist(a, b);
      if (len < 1e-6) continue;
      const t = ((n.x - a.x) * (b.x - a.x) + (n.y - a.y) * (b.y - a.y)) / (len * len);
      if (t <= 0 || t >= 1) continue;
      const dist = t * len;
      if (dist < EPS || dist > len - EPS) continue; // gyakorlatilag a végponton van
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      if (Math.hypot(n.x - px, n.y - py) > EPS) continue; // nincs a fal vonalán
      if (!splitsByWall.has(w.id)) splitsByWall.set(w.id, []);
      const list = splitsByWall.get(w.id);
      if (!list.some(p => Math.abs(p.dist - dist) < EPS)) list.push({ nodeId: n.id, dist });
    }
  }
  if (!splitsByWall.size) return false;

  const newWalls = [];
  for (const w of plan.walls) {
    const splits = splitsByWall.get(w.id);
    if (!splits) { newWalls.push(w); continue; }

    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    const totalLen = G.dist(a, b);
    const sorted = splits.slice().sort((x, y) => x.dist - y.dist).map(p => ({ id: p.nodeId, dist: p.dist }));
    const chain = [{ id: w.a, dist: 0 }, ...sorted, { id: w.b, dist: totalLen }];
    const objsOnWall = plan.objects.filter(o => o.wallId === w.id);
    const assigned = new Set();

    for (let i = 0; i < chain.length - 1; i++) {
      const segA = chain[i], segB = chain[i + 1];
      if (segA.id === segB.id) continue;
      const seg = { id: newId(), a: segA.id, b: segB.id, thickness: w.thickness, bulge: 0 };
      newWalls.push(seg);
      const isLast = i === chain.length - 2;
      for (const o of objsOnWall) {
        if (assigned.has(o)) continue;
        if (isLast || o.offset <= segB.dist + 1e-6) {
          o.wallId = seg.id;
          o.offset = round1(o.offset - segA.dist);
          assigned.add(o);
        }
      }
    }
  }
  plan.walls = newWalls;
  return true;
}
