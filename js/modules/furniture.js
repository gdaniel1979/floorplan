// Bútor-könyvtár: szabadon elhelyezhető (nem fal-beágyazott) tárgyak — szaniter,
// konyha, bútorok, épületelemek. Mindegyik egy pozícionált (középpont), adott
// szélességű/mélységű, forgatható téglalap, felirattal. A négy kategória a
// Rétegek panelen külön ki-/bekapcsolható.

import { newId, notify } from './state.js';
import { round1 } from './plan.js';

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
