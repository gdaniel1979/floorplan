// Nyílászárók (ajtó/ablak): a fal-rétegbe ágyazott objektumok, mindig láthatók.
// Csak egyenes falba helyezhetők (íveltbe egyelőre nem); a fal mentén a
// "offset" (az a-csomóponttól mért távolság, cm) írja le a nyílás közepét.

import { newId, notify } from './state.js';
import { nodeById, wallById, wallLengthOf } from './plan.js';
import * as G from './geometry.js';

export const DEFAULT_WIDTH = { door: 90, window: 120 };
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
  const width = DEFAULT_WIDTH[kind];
  const len = wallLengthOf(plan, w);
  const obj = { id: newId(), kind, wallId, width, offset: clampOffset(offset, width, len) };
  if (kind === 'door') {
    obj.flipHinge = !!defaults.flipHinge;
    obj.flipSide = !!defaults.flipSide;
    obj.withLeaf = defaults.withLeaf !== false;
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

// a kattintott ponthoz legközelebbi "offset" egy egyenes falon (a-tól mérve)
export function offsetOnWall(plan, wall, p) {
  const a = nodeById(plan, wall.a), b = nodeById(plan, wall.b);
  const dir = G.unit(a, b);
  return (p.x - a.x) * dir.x + (p.y - a.y) * dir.y;
}
