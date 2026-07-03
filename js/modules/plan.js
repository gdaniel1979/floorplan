// Az aktív szint rajzának (plan) műveletei: csomópontok és falak.
// A falak közös csomópontokra hivatkoznak, így a sarkok együtt mozognak.

import { activeLevel, newId, notify } from './state.js';
import * as G from './geometry.js';

export function getPlan() {
  const level = activeLevel();
  if (!level) return null;
  const p = level.plan;
  p.nodes ??= [];
  p.walls ??= [];
  p.rooms ??= [];
  p.rooms = p.rooms.filter(r => r.seed && typeof r.seed.x === 'number'); // korábbi (kézzel rajzolt) helyiség-formátum eldobása
  p.objects ??= [];
  return p;
}

export function nodeById(plan, id) { return plan.nodes.find(n => n.id === id); }
export function wallById(plan, id) { return plan.walls.find(w => w.id === id); }

export function findNodeNear(plan, p, tol, excludeId = null) {
  return plan.nodes.find(n => n.id !== excludeId && Math.hypot(n.x - p.x, n.y - p.y) <= tol);
}

export function addNode(plan, p) {
  const n = { id: newId(), x: round1(p.x), y: round1(p.y) };
  plan.nodes.push(n);
  return n;
}

export function addWall(plan, aId, bId, thickness, bulge = 0) {
  if (aId === bId) return null;
  const w = { id: newId(), a: aId, b: bId, thickness, bulge };
  plan.walls.push(w);
  notify();
  return w;
}

export function deleteWall(plan, id) {
  plan.walls = plan.walls.filter(w => w.id !== id);
  cleanupOrphanNodes(plan);
  notify();
}

// két csomópont összevonása (végpont másik pontra ejtésekor)
export function mergeNodes(plan, keepId, dropId) {
  if (keepId === dropId) return;
  for (const w of plan.walls) {
    if (w.a === dropId) w.a = keepId;
    if (w.b === dropId) w.b = keepId;
  }
  // elfajult (önmagába érő) falak eltávolítása
  plan.walls = plan.walls.filter(w => w.a !== w.b);
  cleanupOrphanNodes(plan);
}

export function cleanupOrphanNodes(plan) {
  const used = new Set();
  for (const w of plan.walls) { used.add(w.a); used.add(w.b); }
  plan.nodes = plan.nodes.filter(n => used.has(n.id));
}

// a fal hossza; ívnél az ívhossz
export function wallLengthOf(plan, w) {
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  return G.wallLength(a, b, w.bulge || 0);
}

// a fal hosszának beállítása: a b végpont csúszik az a felől nézett irányban
// (ívnél a húr skálázódik, a görbület aránya marad)
export function setWallLength(plan, w, len) {
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  const current = G.wallLength(a, b, w.bulge || 0);
  if (!(len > 0) || !(current > 0)) return;
  const f = len / current;
  b.x = round1(a.x + (b.x - a.x) * f);
  b.y = round1(a.y + (b.y - a.y) * f);
  notify();
}

// csomópontok fokszáma (hány fal csatlakozik)
export function nodeDegrees(plan) {
  const deg = new Map();
  for (const w of plan.walls) {
    deg.set(w.a, (deg.get(w.a) || 0) + 1);
    deg.set(w.b, (deg.get(w.b) || 0) + 1);
  }
  return deg;
}

export function round1(v) { return Math.round(v * 10) / 10; }
