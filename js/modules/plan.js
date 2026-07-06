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
  plan.objects = plan.objects.filter(o => o.wallId !== id); // a falba ágyazott nyílászárók is törlődnek
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

// az adott fal `nodeId` végén lévő "átmenő" párja: egy másik, pontosan
// ellentétes irányú, azonos vastagságú fal — vagyis vizuálisan egyenesen
// folytatódik ugyanabban a falban (T-elágazás-szétvágás miatt két külön
// fal-objektum reprezentál egy folytonos falat). null, ha a csomópont
// valódi sarok, vég, vagy nem passzoló vastagságú elágazás. Íves falra
// sosem illeszkedik (a húr-irány csak közelítő lenne).
export function throughPartner(plan, nodeId, wallId) {
  const n = nodeById(plan, nodeId);
  const w = wallById(plan, wallId);
  if (!n || !w || w.bulge) return null;
  const dir = G.unit(n, nodeById(plan, w.a === nodeId ? w.b : w.a));
  for (const c of plan.walls) {
    if (c.id === wallId || c.bulge || c.thickness !== w.thickness) continue;
    if (c.a !== nodeId && c.b !== nodeId) continue;
    const cDir = G.unit(n, nodeById(plan, c.a === nodeId ? c.b : c.a));
    if (dir.x * cDir.x + dir.y * cDir.y < -0.999) return c;
  }
  return null;
}

// egy csomópontban a falak sarok-kitöltő foltjának oldalhossza (a render.js és
// a raster.js is ezt használja), vagy null, ha nincs rá szükség. Két,
// pontosan ellentétes irányú, azonos vastagságú fal ("átmenő" pár, pl. egy
// T-elágazásnál kettévágott fal) rés nélkül illeszkedik önmagában — csak a
// valódi sarkoknál (két, egymással szöget bezáró fal vége) kell folt, egy
// átmenő falra merőlegesen csatlakozó ág esetén a téglalapok már fedés
// nélkül összeérnek, függetlenül a vastagságuk különbségétől
export function nodeCornerPatchThickness(plan, nodeId) {
  const n = nodeById(plan, nodeId);
  const walls = plan.walls.filter(w => w.a === nodeId || w.b === nodeId);
  if (!n || walls.length < 2) return null;

  const items = walls.map(w => {
    const other = nodeById(plan, w.a === nodeId ? w.b : w.a);
    return { dir: G.unit(n, other), thickness: w.thickness };
  });

  const used = new Array(items.length).fill(false);
  const throughDirs = [];
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      const dot = items[i].dir.x * items[j].dir.x + items[i].dir.y * items[j].dir.y;
      if (dot < -0.999 && items[i].thickness === items[j].thickness) {
        used[i] = used[j] = true;
        throughDirs.push(items[i].dir);
        break;
      }
    }
  }

  const branches = items.filter((_, i) => !used[i]);
  if (!branches.length) return null; // tiszta kereszteződés, nincs rés
  if (throughDirs.length && branches.every(b => throughDirs.some(t => Math.abs(t.x * b.dir.x + t.y * b.dir.y) < 0.01))) {
    return null; // T-elágazás(ok), mindegyik ág merőleges egy átmenő falra
  }
  return Math.max(...walls.map(w => w.thickness));
}
