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

// kategóriánkénti alap-szín: halvány, hogy a fal-sraffozás fölött is olvasható
// maradjon a rajz; tárgyanként felülírható
export const DEFAULT_COLORS = {
  szaniter: '#e8f1f8',
  konyha: '#f3ecdd',
  butor: '#eef0e9',
  epulet: '#eceaea',
};

// A katalógus kategóriákra, azon belül csoportokra (`group`) bomlik. A
// kategória a RÉTEG-kapcsoláshoz kell (ui.layerVisible), a csoport csak a
// paletta áttekinthetőségéhez — ezért a kategóriák száma nem változott.
export const CATALOG = {
  szaniter: [
    { group: 'Szaniter', type: 'wc', label: 'WC (monoblokkos)', w: 40, h: 68 },
    { group: 'Szaniter', type: 'wckerek', label: 'WC (lekerekített)', w: 38, h: 68 },
    { group: 'Szaniter', type: 'wcfali', label: 'WC (fali)', w: 37, h: 55 },
    { group: 'Szaniter', type: 'mosdo', label: 'Mosdó', w: 60, h: 45 },
    { group: 'Szaniter', type: 'duplamosdo', label: 'Dupla mosdó', w: 120, h: 50 },
    { group: 'Szaniter', type: 'bide', label: 'Bidé', w: 40, h: 60 },
    { group: 'Szaniter', type: 'kad', label: 'Kád (egyenes)', w: 170, h: 75 },
    { group: 'Szaniter', type: 'kadivessarok', label: 'Kád (íves sarokkal)', w: 170, h: 75 },
    { group: 'Szaniter', type: 'kadovalis', label: 'Szabadon álló kád (ovális)', w: 170, h: 80 },
    { group: 'Szaniter', type: 'zuhany', label: 'Zuhanytálca', w: 90, h: 90 },
    { group: 'Szaniter', type: 'zuhanykabin', label: 'Zuhanykabin', w: 90, h: 90 },
    { group: 'Gépek', type: 'mosogep', label: 'Mosógép', w: 60, h: 60 },
    { group: 'Gépek', type: 'szaritogep', label: 'Szárítógép', w: 60, h: 60 },
    { group: 'Gépek', type: 'bojler', label: 'Bojler', w: 45, h: 45 },
  ],
  konyha: [
    { group: 'Gépek', type: 'tuzhely', label: 'Tűzhely', w: 60, h: 60 },
    { group: 'Gépek', type: 'suto', label: 'Beépített sütő', w: 60, h: 60 },
    { group: 'Gépek', type: 'mikro', label: 'Mikró', w: 50, h: 35 },
    { group: 'Gépek', type: 'paraelszivo', label: 'Páraelszívó', w: 60, h: 50 },
    { group: 'Gépek', type: 'huto', label: 'Hűtő', w: 60, h: 65 },
    { group: 'Gépek', type: 'mosogatogep', label: 'Mosogatógép', w: 60, h: 60 },
    { group: 'Szekrények, pultok', type: 'mosogato', label: 'Mosogató', w: 60, h: 60 },
    { group: 'Szekrények, pultok', type: 'konyhapult', label: 'Konyhapult', w: 200, h: 60 },
    { group: 'Szekrények, pultok', type: 'alsoszekreny', label: 'Alsó szekrény', w: 60, h: 60 },
    { group: 'Szekrények, pultok', type: 'felsoszekreny', label: 'Felső szekrény', w: 60, h: 35 },
    { group: 'Szekrények, pultok', type: 'sarokszekreny', label: 'Sarokszekrény', w: 90, h: 90 },
    { group: 'Szekrények, pultok', type: 'konyhasziget', label: 'Konyhasziget', w: 180, h: 90 },
    { group: 'Szekrények, pultok', type: 'barpult', label: 'Bárpult', w: 160, h: 40 },
  ],
  butor: [
    { group: 'Háló', type: 'franciaagy', label: 'Franciaágy', w: 180, h: 200 },
    { group: 'Háló', type: 'agy', label: 'Ágy', w: 160, h: 200 },
    { group: 'Háló', type: 'egyagy', label: 'Egyszemélyes ágy', w: 90, h: 200 },
    { group: 'Háló', type: 'emeletesagy', label: 'Emeletes ágy', w: 90, h: 200 },
    { group: 'Háló', type: 'ejjeliszekreny', label: 'Éjjeliszekrény', w: 45, h: 40 },
    { group: 'Háló', type: 'gardrob', label: 'Gardróbszekrény', w: 200, h: 60 },
    { group: 'Háló', type: 'szekreny1', label: 'Szekrény (1 ajtós)', w: 60, h: 60 },
    { group: 'Háló', type: 'szekreny', label: 'Szekrény (2 ajtós)', w: 100, h: 60 },
    { group: 'Háló', type: 'komod', label: 'Komód', w: 100, h: 45 },
    { group: 'Nappali', type: 'kanape', label: 'Kanapé', w: 200, h: 90 },
    { group: 'Nappali', type: 'sarokkanape', label: 'Sarokkanapé', w: 250, h: 180 },
    { group: 'Nappali', type: 'fotel', label: 'Fotel', w: 80, h: 80 },
    { group: 'Nappali', type: 'puff', label: 'Puff', w: 50, h: 50 },
    { group: 'Nappali', type: 'dohanyzoasztal', label: 'Dohányzóasztal', w: 100, h: 60 },
    { group: 'Nappali', type: 'tvszekreny', label: 'TV-szekrény', w: 150, h: 40 },
    { group: 'Nappali', type: 'konyvespolc', label: 'Könyvespolc', w: 80, h: 30 },
    { group: 'Nappali', type: 'szonyeg', label: 'Szőnyeg', w: 200, h: 300 },
    { group: 'Étkező', type: 'etkezoasztal', label: 'Étkezőasztal', w: 140, h: 80 },
    { group: 'Étkező', type: 'kerekasztal', label: 'Kerek étkezőasztal', w: 120, h: 120 },
    { group: 'Étkező', type: 'szek', label: 'Szék', w: 45, h: 45 },
    { group: 'Előszoba', type: 'fogas', label: 'Fogas', w: 80, h: 15 },
    { group: 'Dolgozó', type: 'iroasztal', label: 'Íróasztal', w: 140, h: 70 },
    { group: 'Dolgozó', type: 'irodaiszek', label: 'Irodai szék', w: 55, h: 55 },
  ],
  epulet: [
    { group: 'Szerkezet', type: 'oszlop', label: 'Oszlop', w: 30, h: 30 },
    { group: 'Szerkezet', type: 'kemeny', label: 'Kémény', w: 50, h: 50 },
    { group: 'Szerkezet', type: 'lepcso', label: 'Lépcső', w: 100, h: 280 },
    { group: 'Gépészet', type: 'radiator', label: 'Radiátor', w: 80, h: 10 },
    { group: 'Gépészet', type: 'kandallo', label: 'Kandalló', w: 120, h: 50 },
    { group: 'Gépészet', type: 'akna', label: 'Gépészeti akna', w: 60, h: 60 },
    { group: 'Gépészet', type: 'meterszekreny', label: 'Mérőóra-szekrény', w: 40, h: 20 },
  ],
};

// a kategórián belüli csoportok, a katalógusbeli sorrendben
export function catalogGroups(category) {
  const seen = [];
  for (const def of CATALOG[category] || []) {
    if (!seen.includes(def.group)) seen.push(def.group);
  }
  return seen;
}

export function catalogItem(category, type) {
  return (CATALOG[category] || []).find(d => d.type === type) || null;
}

// lépcső: alapértelmezett fokmélység, ebből jön ki a fokok száma a hosszból
export const STAIR_TREAD = 28; // cm

export function isStair(item) { return item?.type === 'lepcso'; }

export function addFurniture(plan, category, type, p) {
  const def = catalogItem(category, type);
  if (!def) return null;
  const item = {
    id: newId(), category, type, label: def.label,
    x: round1(p.x), y: round1(p.y), w: def.w, h: def.h, rotation: 0,
    color: DEFAULT_COLORS[category] || '#eeeeee',
  };
  if (type === 'lepcso') {
    item.steps = Math.max(2, Math.round(def.h / STAIR_TREAD));
    item.dir = 'up';        // 'up' = FEL, 'down' = LE
    item.shape = 'straight'; // 'straight' | 'L' | 'U'
    item.armW = def.w;       // a kar (karok) szélessége L/U alaknál
  }
  plan.furniture.push(item);
  notify();
  return item;
}

export function setStairSteps(plan, item, steps) {
  if (!isStair(item)) return;
  const n = Math.round(steps);
  if (!(n >= 2) || n > 60) return;
  item.steps = n;
  notify();
}

export function setStairDir(plan, item, dir) {
  if (!isStair(item)) return;
  item.dir = dir === 'down' ? 'down' : 'up';
  notify();
}

export function furnitureColor(item) {
  return item?.color || DEFAULT_COLORS[item?.category] || '#eeeeee';
}

export function setFurnitureColor(plan, item, color) {
  if (!item || !color) return;
  item.color = color;
  notify();
}

export function stairShape(item) {
  return item?.shape === 'L' || item?.shape === 'U' ? item.shape : 'straight';
}

// a kar szélessége L/U alaknál; régi (alak nélküli) lépcsőnél a teljes szélesség
export function stairArmW(item) {
  const w = item.armW > 0 ? item.armW : item.w;
  // a karnak el kell férnie: U-nál kétszer, plusz maradjon orsótér
  const max = stairShape(item) === 'U' ? item.w / 2 : item.w;
  return Math.max(20, Math.min(max, w));
}

export function setStairShape(plan, item, shape) {
  if (!isStair(item)) return;
  item.shape = shape === 'L' || shape === 'U' ? shape : 'straight';
  notify();
}

export function setStairArmW(plan, item, armW) {
  if (!isStair(item) || !(armW >= 20)) return;
  item.armW = round1(armW);
  notify();
}

export function deleteFurniture(plan, id) {
  plan.furniture = plan.furniture.filter(f => f.id !== id);
  notify();
}

// az összes bútor-tárgy törlése (vagy egy adott kategóriáé, ha meg van adva) —
// pl. véletlenül felhalmozott elhelyezések gyors eltávolítására
export function clearFurniture(plan, category = null) {
  plan.furniture = category ? plan.furniture.filter(f => f.category !== category) : [];
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

// A bútor fél-kiterjedése egy adott irány mentén (elforgatást is figyelembe
// véve): ennyire lóg ki a középpontjától abba az irányba.
function halfExtent(item, u) {
  const rad = item.rotation * Math.PI / 180;
  const ex = { x: Math.cos(rad), y: Math.sin(rad) };
  const ey = { x: -Math.sin(rad), y: Math.cos(rad) };
  return Math.abs(item.w / 2 * (ex.x * u.x + ex.y * u.y))
       + Math.abs(item.h / 2 * (ey.x * u.x + ey.y * u.y));
}

// Falhoz tapasztás: ha a bútor a húzás során `tol`-on belülre kerül egy fal
// SÍKJÁHOZ, a középpontját úgy toljuk el a fal normálisa mentén, hogy az éle
// pontosan a falsíkra kerüljön. Enélkül a 10 cm-es rács miatt szinte sosem
// lehet hézagmentesen falhoz tenni egy tárgyat.
//
// Csak azokat a falakat nézzük, amik mentén a tárgy tényleg ott van (a fal
// hosszára vetítve átfedik egymást), és a legközelebbi illesztést választjuk.
export function wallSnapPosition(plan, item, x, y, tol) {
  let best = null;
  for (const w of plan.walls) {
    if (w.bulge) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = G.dist(a, b);
    if (len < 1) continue;

    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -d.y, y: d.x };
    const along = (x - a.x) * d.x + (y - a.y) * d.y;
    if (along < -halfExtent(item, d) || along > len + halfExtent(item, d)) continue;

    const perp = (x - a.x) * n.x + (y - a.y) * n.y;
    const target = (perp >= 0 ? 1 : -1) * (w.thickness / 2 + halfExtent(item, n));
    const delta = target - perp;
    if (Math.abs(delta) > tol) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, n };
  }
  if (!best) return null;
  return { x: round1(x + best.n.x * best.delta), y: round1(y + best.n.y * best.delta) };
}

// --- a kijelölt bútor négy oldalától a legközelebbi falig mért távolság ---
//
// Mind a négy oldal KÖZEPÉBŐL merőleges sugarat indítunk kifelé (a tárgy saját,
// elforgatott rendszerében), és megkeressük az első falat, amit elmetsz. Így a
// szám elforgatott tárgynál is a valódi távolságot mutatja, és a szemközti
// oldalon lévő fal sem "látszik át" a közelebbin.
export const FURNITURE_SIDES = ['left', 'right', 'back', 'front'];

export function furnitureClearances(plan, item) {
  if (!item) return [];
  const out = [];
  for (const key of FURNITURE_SIDES) {
    const ray = sideRay(item, key);
    const dist = rayToWall(plan, ray.from, ray.dir);
    if (dist == null || dist < 0.5) continue;   // falhoz tapasztva nincs mit mérni
    out.push({ key, from: ray.from, dir: ray.dir, dist: round1(dist) });
  }
  return out;
}

// a bútor adott oldalának közepe és a kifelé mutató egységvektor
function sideRay(item, key) {
  const L = {
    left:  [-item.w / 2, 0, -1, 0], right: [item.w / 2, 0, 1, 0],
    back:  [0, -item.h / 2, 0, -1], front: [0, item.h / 2, 0, 1],
  }[key];
  const rad = item.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    from: { x: item.x + L[0] * cos - L[1] * sin, y: item.y + L[0] * sin + L[1] * cos },
    dir: { x: L[2] * cos - L[3] * sin, y: L[2] * sin + L[3] * cos },
  };
}

// a sugár által elsőként metszett fal távolsága (a falat a vastagságával együtt,
// téglalapként kezeljük) — `null`, ha egyet sem talál el
function rayToWall(plan, from, dir) {
  let best = null;
  for (const w of plan.walls) {
    if (w.bulge) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = G.dist(a, b);
    if (len < 1) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const v = { x: -u.y, y: u.x };
    const o = [(from.x - a.x) * u.x + (from.y - a.y) * u.y, (from.x - a.x) * v.x + (from.y - a.y) * v.y];
    const d = [dir.x * u.x + dir.y * u.y, dir.x * v.x + dir.y * v.y];
    const t = raySlab(o, d, [[0, len], [-w.thickness / 2, w.thickness / 2]]);
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}

// sugár–téglalap metszés a téglalap saját rendszerében (slab-módszer)
function raySlab(o, d, ranges) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 2; i++) {
    const [lo, hi] = ranges[i];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return null;
      continue;
    }
    let ta = (lo - o[i]) / d[i], tb = (hi - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

// a szám átírása: a tárgyat az adott oldal irányában toljuk el annyival, hogy
// ott pontosan a beírt távolság maradjon
export function setFurnitureClearance(plan, item, key, value) {
  const side = furnitureClearances(plan, item).find(c => c.key === key);
  if (!side || !(value >= 0)) return;
  const delta = side.dist - value;
  item.x = round1(item.x + side.dir.x * delta);
  item.y = round1(item.y + side.dir.y * delta);
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
