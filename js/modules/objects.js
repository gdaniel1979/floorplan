// Nyílászárók (ajtó/ablak): a fal-rétegbe ágyazott objektumok, mindig láthatók.
// Csak egyenes falba helyezhetők (íveltbe egyelőre nem); a fal mentén a
// "offset" (az a-csomóponttól mért távolság, cm) írja le a nyílás közepét.

import { newId, notify } from './state.js';
import { nodeById, wallById, wallLengthOf, endDeduction } from './plan.js';
import * as G from './geometry.js';

export const DEFAULT_WIDTH = { door: 90, window: 120 };
// a nyílászáró magassága (cm): a méretjelölésen (90/210) és a felület-
// számításban (surfaces.js) jelenik meg, a rajz geometriáját nem érinti
export const DEFAULT_HEIGHT = { door: 210, window: 150 };
const MIN_MARGIN = 5; // cm – legalább ennyi maradjon a fal végétől a nyílásig

// a nyílás középpontjának megengedett tartománya egy adott falon
function clampOffset(offset, width, wallLen) {
  const half = width / 2;
  const lo = Math.min(half + MIN_MARGIN, wallLen / 2);
  const hi = Math.max(wallLen - half - MIN_MARGIN, wallLen / 2);
  return Math.max(lo, Math.min(hi, offset));
}

export function addObject(plan, wallId, kind, offset, defaults = {}) {
  const w = wallById(plan, wallId);
  if (!w || w.bulge) return null; // íves falba egyelőre nem
  const width = defaults.width > 0 ? defaults.width : DEFAULT_WIDTH[kind];
  const height = defaults.height > 0 ? defaults.height : DEFAULT_HEIGHT[kind];
  const len = wallLengthOf(plan, w);
  const obj = { id: newId(), kind, wallId, width, height, offset: clampOffset(offset, width, len) };
  if (kind === 'door') {
    obj.flipHinge = !!defaults.flipHinge;
    obj.flipSide = !!defaults.flipSide;
    obj.doorType = defaults.doorType || 'swing';
    obj.leafCount = defaults.leafCount === 2 ? 2 : 1;
  } else if (kind === 'window') {
    obj.sashCount = defaults.sashCount === 2 ? 2 : 1;
    obj.flipSide = !!defaults.flipSide;
  }
  plan.objects.push(obj);
  notify();
  return obj;
}

export function deleteObject(plan, id) {
  plan.objects = plan.objects.filter(o => o.id !== id);
  notify();
}

export function moveObjectAlongWall(plan, obj, offset) {
  const w = wallById(plan, obj.wallId);
  if (!w) return;
  obj.offset = clampOffset(offset, obj.width, wallLengthOf(plan, w));
  notify();
}

export function resizeObject(plan, obj, width) {
  const w = wallById(plan, obj.wallId);
  if (!w || !(width > 0)) return;
  obj.width = width;
  obj.offset = clampOffset(obj.offset, width, wallLengthOf(plan, w));
  notify();
}

// a nyílászáró magassága: csak a méretjelölést és a felület-becslést érinti
export function setObjectHeight(plan, obj, height) {
  if (!obj || !(height > 0)) return;
  obj.height = height;
  notify();
}

// Az ajtó fajtája. A régi tervekben csak a withLeaf logikai mező volt
// (ajtólappal / csak nyílás), ezért abból következtetünk, ha nincs doorType.
//   'swing'   – nyíló, ajtólappal és nyitási ívvel
//   'sliding' – tolóajtó: a lap a fal síkja mentén csúszik, nincs ív
//   'opening' – csak nyílás, lap nélkül
export function doorType(obj) {
  if (obj.doorType) return obj.doorType;
  return obj.withLeaf === false ? 'opening' : 'swing';
}

// egy nyílászáró magassága, a régi (magasság nélkül mentett) tervekre is
export function objectHeight(obj) {
  return obj.height > 0 ? obj.height : DEFAULT_HEIGHT[obj.kind] || 0;
}

// az egyik szél (p1 vagy p2) húzása: a MÁSIK szél helyben marad, a szélesség
// és a középpont ennek megfelelően változik
export function resizeObjectEdge(plan, obj, edge, newEdgeOffset) {
  const w = wallById(plan, obj.wallId);
  if (!w) return;
  const len = wallLengthOf(plan, w);
  const otherOffset = edge === 'p1' ? obj.offset + obj.width / 2 : obj.offset - obj.width / 2;
  let width = edge === 'p1' ? otherOffset - newEdgeOffset : newEdgeOffset - otherOffset;
  width = Math.max(20, Math.min(len - 2 * MIN_MARGIN, width));
  const center = edge === 'p1' ? otherOffset - width / 2 : otherOffset + width / 2;
  obj.width = width;
  obj.offset = clampOffset(center, width, len);
  notify();
}

// egy nyílászáró geometriája a világban: a fal iránya, a nyílás két széle,
// középpontja, és a falra merőleges normálvektor
export function objectGeometry(plan, obj) {
  const w = wallById(plan, obj.wallId);
  if (!w) return null;
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b) return null;
  const dir = G.unit(a, b);
  const half = obj.width / 2;
  const center = { x: a.x + dir.x * obj.offset, y: a.y + dir.y * obj.offset };
  const p1 = { x: center.x - dir.x * half, y: center.y - dir.y * half };
  const p2 = { x: center.x + dir.x * half, y: center.y + dir.y * half };
  return { wall: w, a, b, dir, normal: G.normal(a, b), center, p1, p2 };
}

// --- távolság a saroktól ---
//
// Amit egy tervrajzon mérnek: a helyiség SARKÁTÓL a nyílás széléig. A fal
// végpontjai a tengelyen ülnek, ezért mindkét végén levonjuk az oda csatlakozó
// fal félvastagságát (endDeduction) — így a szám a valódi, falsíktól falsíkig
// mért távolság, ugyanúgy, ahogy a fal belmérete is.
export function openingClearances(plan, obj) {
  const w = wallById(plan, obj.wallId);
  if (!w || w.bulge) return null;
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b) return null;

  const len = wallLengthOf(plan, w);
  const startCut = endDeduction(plan, w, w.a);
  const endCut = endDeduction(plan, w, w.b);
  const half = obj.width / 2;

  return {
    wall: w, a, b, len, startCut, endCut,
    dir: G.unit(a, b),
    // a nyílás széle a saroktól (a fal a-vége felől), illetve a másik saroktól
    fromStart: obj.offset - half - startCut,
    fromEnd: len - obj.offset - half - endCut,
  };
}

// a nyílás eltolása úgy, hogy a megadott saroktól pont `value` maradjon
export function setOpeningClearance(plan, obj, which, value) {
  const c = openingClearances(plan, obj);
  if (!c || !(value >= 0)) return;
  const half = obj.width / 2;
  const offset = which === 'fromEnd'
    ? c.len - c.endCut - value - half
    : c.startCut + value + half;
  obj.offset = clampOffset(offset, obj.width, c.len);
  notify();
}

// a kattintott ponthoz legközelebbi "offset" egy egyenes falon (a-tól mérve)
export function offsetOnWall(plan, wall, p) {
  const a = nodeById(plan, wall.a), b = nodeById(plan, wall.b);
  const dir = G.unit(a, b);
  return (p.x - a.x) * dir.x + (p.y - a.y) * dir.y;
}
