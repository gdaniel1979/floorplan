// Bútor-könyvtár: szabadon elhelyezhető (nem fal-beágyazott) tárgyak — szaniter,
// konyha, bútorok, épületelemek. Mindegyik egy pozícionált (középpont), adott
// szélességű/mélységű, forgatható téglalap, felirattal. A négy kategória a
// Rétegek panelen külön ki-/bekapcsolható.

import { newId, notify } from './state.js';
import { round1, nodeById } from './plan.js';
import * as G from './geometry.js';

const ROTATE_GRID_STEP = 15; // fok – ilyen léptékű szögekhez illeszkedik a forgató fogantyú
const ROTATE_SNAP_TOL = 6;   // fok – ilyen közelségen belül kattan rá egy illesztési pontra
const ROTATE_WALL_DIST = 200; // cm – ilyen közelségben lévő fal irányához (és arra merőlegesen) illeszkedik

export const LAYER_LABELS = {
  szaniter: 'Szaniter', konyha: 'Konyha', butor: 'Bútorok', epulet: 'Épületelemek',
};

export const CATALOG = {
  szaniter: [
    { type: 'wc', label: 'WC', w: 40, h: 65 },
    { type: 'mosdo', label: 'Mosdó', w: 60, h: 45 },
    { type: 'kad', label: 'Kád', w: 170, h: 75 },
    { type: 'zuhany', label: 'Zuhanytálca', w: 90, h: 90 },
  ],
  konyha: [
    { type: 'mosogato', label: 'Mosogató', w: 60, h: 60 },
    { type: 'tuzhely', label: 'Tűzhely', w: 60, h: 60 },
    { type: 'huto', label: 'Hűtő', w: 60, h: 65 },
    { type: 'konyhapult', label: 'Konyhapult', w: 200, h: 60 },
  ],
  butor: [
    { type: 'agy', label: 'Ágy', w: 160, h: 200 },
    { type: 'kanape', label: 'Kanapé', w: 200, h: 90 },
    { type: 'fotel', label: 'Fotel', w: 80, h: 80 },
    { type: 'etkezoasztal', label: 'Étkezőasztal', w: 140, h: 80 },
    { type: 'dohanyzoasztal', label: 'Dohányzóasztal', w: 100, h: 60 },
    { type: 'szek', label: 'Szék', w: 45, h: 45 },
    { type: 'szekreny', label: 'Szekrény', w: 100, h: 60 },
  ],
  epulet: [
    { type: 'oszlop', label: 'Oszlop', w: 30, h: 30 },
    { type: 'kemeny', label: 'Kémény', w: 50, h: 50 },
    { type: 'lepcso', label: 'Lépcső', w: 100, h: 280 },
  ],
};

export function catalogItem(category, type) {
  return (CATALOG[category] || []).find(d => d.type === type) || null;
}

export function addFurniture(plan, category, type, p) {
  const def = catalogItem(category, type);
  if (!def) return null;
  const item = {
    id: newId(), category, type, label: def.label,
    x: round1(p.x), y: round1(p.y), w: def.w, h: def.h, rotation: 0,
  };
  plan.furniture.push(item);
  notify();
  return item;
}

export function deleteFurniture(plan, id) {
  plan.furniture = plan.furniture.filter(f => f.id !== id);
  notify();
}

export function moveFurniture(plan, item, x, y) {
  item.x = round1(x);
  item.y = round1(y);
  notify();
}

export function setFurnitureSize(plan, item, w, h) {
  if (w > 0) item.w = round1(w);
  if (h > 0) item.h = round1(h);
  notify();
}

export function setFurnitureRotation(plan, item, deg) {
  item.rotation = round1(((deg % 360) + 360) % 360);
  notify();
}

// egy, a tárgy középpontjához és forgatásához igazított helyi (localX,localY)
// pont világkoordinátája — a forgató fogantyú és a hozzá vezető vonal
// pozíciójához (render.js és tools.js is ezt használja, hogy ne kelljen
// SVG-transzformációt alkalmazni ezekre a külön elemekre)
export function rotatedPoint(item, localX, localY) {
  const rad = item.rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: item.x + localX * cos - localY * sin, y: item.y + localX * sin + localY * cos };
}

export function rotateHandlePoint(item) {
  return rotatedPoint(item, 0, -Math.max(item.h / 2 + 25, 30));
}

// a forgató fogantyú húzása közben: a nyers szöget (fok) illeszti a
// 15°-os rácshoz ÉS a közeli falak irányához (mindkét, egymásra merőleges
// tájoláshoz) — amelyik illesztési pont a legközelebbi, és a tűrésen belül
// van. `allowSnap=false` (Shift lenyomva) esetén szabad forgatás.
export function snappedRotationInfo(plan, item, rawDeg, allowSnap = true) {
  const raw = ((rawDeg % 360) + 360) % 360;
  if (!allowSnap) return { deg: round1(raw), snapped: false };

  const candidates = [];
  for (let a = 0; a < 360; a += ROTATE_GRID_STEP) candidates.push(a);

  for (const w of plan.walls) {
    if (w.bulge) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    if (G.distToSegment(item, a, b) > ROTATE_WALL_DIST) continue;
    const wallDeg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + 360) % 360;
    candidates.push(wallDeg, (wallDeg + 90) % 360, (wallDeg + 180) % 360, (wallDeg + 270) % 360);
  }

  let best = raw, bestDiff = Infinity;
  for (const c of candidates) {
    const diff = G.angleDiff(raw, c);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return bestDiff <= ROTATE_SNAP_TOL ? { deg: round1(best), snapped: true } : { deg: round1(raw), snapped: false };
}
