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
  for (const r of p.rooms) r.height ??= 270; // korábbi mentésekben még nincs belmagasság (lásd rooms.js DEFAULT_ROOM_HEIGHT)
  p.objects ??= [];
  p.furniture ??= [];
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
// --- belső (nettó) hosszak ---
//
// A csomópontok a falak TENGELYÉN ülnek, a felhasználó viszont belméretben
// gondolkodik: egy 4 m-es szoba fala legyen 4 m SZABAD hosszú. Ezért a
// hossz-bevitel és a rajzon látható hossz-címkék is belméretet használnak
// (a külső, láncolt méretvonalak maradnak külső méretek, ahogy tervrajzon
// szokás). Levonás csak ott van, ahol tényleg csatlakozik egy MÁSIK fal, ami
// belevág ebbe a falba: a szabad (nyitott) végen nincs levonás, és az
// egyenesen továbbfutó (kollineáris) szomszéd sem számít, mert nem keresztezi.

// mennyivel rövidebb a belső hossz a csomópontnál, ha onnan `dir` irányba
// indul a fal (excludeWallId: maga a vizsgált fal, azt nem nézzük)
export function endDeductionAt(plan, node, dir, excludeWallId) {
  if (!node) return 0;
  let max = 0;
  for (const o of plan.walls) {
    if (o.id === excludeWallId) continue;
    if (o.a !== node.id && o.b !== node.id) continue;
    const other = nodeById(plan, o.a === node.id ? o.b : o.a);
    if (!other) continue;
    const oDir = G.unit(node, other);
    if (Math.abs(dir.x * oDir.x + dir.y * oDir.y) > 0.999) continue; // egyenes folytatás
    max = Math.max(max, o.thickness / 2);
  }
  return max;
}

// a fal egyik végén (nodeId) levonandó félvastagság
export function endDeduction(plan, w, nodeId) {
  const node = nodeById(plan, nodeId);
  const far = nodeById(plan, nodeId === w.a ? w.b : w.a);
  if (!node || !far) return 0;
  return endDeductionAt(plan, node, G.unit(node, far), w.id);
}

// a fal belső (nettó) hossza
export function wallInteriorLengthOf(plan, w) {
  const len = wallLengthOf(plan, w) - endDeduction(plan, w, w.a) - endDeduction(plan, w, w.b);
  return Math.max(0, len);
}

// a belső hossz beállítása: visszaszámoljuk tengelyhosszra, azt állítjuk be
export function setWallInteriorLength(plan, w, interior, grow = 'auto') {
  if (!(interior > 0)) return;
  setWallLength(plan, w, interior + endDeduction(plan, w, w.a) + endDeduction(plan, w, w.b), grow);
}

// Melyik végpont mozduljon el a hossz módosításakor.
//   'a' | 'b' — az adott végpont mozog, a másik marad
//   'auto'    — a kevésbé beépített vég mozog; azonos fokszámnál a rajz
//               közepétől TÁVOLABBI, hogy az épület kifelé nőjön, és a
//               belső szerkezet maradjon a helyén
export function growingEnd(plan, w, grow = 'auto') {
  if (grow === 'a' || grow === 'b') return grow;
  const deg = nodeDegrees(plan);
  const da = deg.get(w.a) || 0, db = deg.get(w.b) || 0;
  if (da !== db) return da < db ? 'a' : 'b';

  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b || !plan.nodes.length) return 'b';
  let cx = 0, cy = 0;
  for (const n of plan.nodes) { cx += n.x; cy += n.y; }
  cx /= plan.nodes.length; cy /= plan.nodes.length;
  return G.dist(a, { x: cx, y: cy }) > G.dist(b, { x: cx, y: cy }) ? 'a' : 'b';
}

// A hossz módosításakor az egyik végpont marad, a másik elmozdul. Az elmozduló
// végponttal EGYÜTT MOZOGNAK azok a falak, amik MERŐLEGESEK az elmozdulásra:
// azok csak eltolódnak, nem ferdülnek meg. Enélkül a mozduló sarkon lógó
// szomszédos falak megdőltek, és a derékszögű szoba trapézzá torzult.
//
// Az elmozdulással PÁRHUZAMOS falak nem terjesztik tovább a mozgást, csak
// megnyúlnak/rövidülnek — így egy téglalap alakú szoba téglalap marad, csak
// abban az irányban lesz nagyobb.
//
// Ferde (se nem párhuzamos, se nem merőleges) szomszédnál nincs mit tenni:
// az ilyen fal a mozgatástól szükségszerűen elfordul.
export function setWallLength(plan, w, len, grow = 'auto') {
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b) return;
  const current = G.wallLength(a, b, w.bulge || 0);
  if (!(len > 0) || !(current > 0)) return;

  const movingId = growingEnd(plan, w, grow) === 'a' ? w.a : w.b;
  const moving = nodeById(plan, movingId);
  const fixed = movingId === w.a ? b : a;

  const dirX = (moving.x - fixed.x) / current, dirY = (moving.y - fixed.y) / current;
  const delta = len - current;
  if (Math.abs(delta) < 1e-6) return;
  const d = { x: dirX * delta, y: dirY * delta };
  const dLen = Math.hypot(d.x, d.y);
  const dHat = { x: d.x / dLen, y: d.y / dLen };

  // ívnél nincs mit merevíteni, marad a régi, egyszerű nyújtás
  if (w.bulge) {
    moving.x = round1(fixed.x + dirX * len);
    moving.y = round1(fixed.y + dirY * len);
    notify();
    return;
  }

  // az elmozdulásra merőleges falakon át terjed a mozgás
  const move = new Set([movingId]);
  const queue = [movingId];
  while (queue.length) {
    const id = queue.pop();
    const node = nodeById(plan, id);
    for (const o of plan.walls) {
      if (o.bulge) continue;
      if (o.a !== id && o.b !== id) continue;
      const otherId = o.a === id ? o.b : o.a;
      if (move.has(otherId)) continue;
      const other = nodeById(plan, otherId);
      if (!other) continue;
      const oLen = G.dist(node, other);
      if (oLen < 1e-6) continue;
      const dot = ((other.x - node.x) * dHat.x + (other.y - node.y) * dHat.y) / oLen;
      if (Math.abs(dot) > 1e-3) continue; // nem merőleges: nem visz tovább
      move.add(otherId);
      queue.push(otherId);
    }
  }
  // ha a mozgás visszaérne a rögzített véghez, a merevítés önellentmondó —
  // ilyenkor inkább csak a végpontot mozgatjuk (a régi viselkedés)
  if (move.has(fixed.id)) move.clear(), move.add(movingId);

  for (const id of move) {
    const n = nodeById(plan, id);
    n.x = round1(n.x + d.x);
    n.y = round1(n.y + d.y);
  }
  notify();
}

// --- szabad távolság a fal két oldalán lévő szomszédos falig ---
//
// A legközelebbi PÁRHUZAMOS fal síkjáig mért távolság mindkét oldalon — ez az,
// amit a felhasználó "a helyiség mérete"-ként lát. Tisztán analitikus, ezért
// húzás közben is újraszámolható (a helyiség-nyomvonalak raszterezése nem az).
export function wallClearances(plan, w) {
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b || w.bulge) return null;
  const len = G.dist(a, b);
  if (len < 1) return null;

  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const nrm = { x: -dir.y, y: dir.x };
  const half = w.thickness / 2;

  // a fallal párhuzamos falak, a saját tengelyünkre vetítve
  const par = [];
  for (const o of plan.walls) {
    if (o.id === w.id || o.bulge) continue;
    const oa = nodeById(plan, o.a), ob = nodeById(plan, o.b);
    if (!oa || !ob) continue;
    const oLen = G.dist(oa, ob);
    if (oLen < 1) continue;
    const oDir = { x: (ob.x - oa.x) / oLen, y: (ob.y - oa.y) / oLen };
    if (Math.abs(dir.x * oDir.y - dir.y * oDir.x) > 1e-3) continue; // nem párhuzamos

    // csak akkor szomszéd, ha a hossza mentén át is fedik egymást
    const t0 = (oa.x - a.x) * dir.x + (oa.y - a.y) * dir.y;
    const t1 = (ob.x - a.x) * dir.x + (ob.y - a.y) * dir.y;
    if (Math.min(t0, t1) > len - 1 || Math.max(t0, t1) < 1) continue;

    const offset = (oa.x - a.x) * nrm.x + (oa.y - a.y) * nrm.y;
    const clear = Math.abs(offset) - half - o.thickness / 2;
    if (clear < 0.5) continue; // egy vonalban vagy átfedésben, nincs mit mérni

    par.push({ id: o.id, lo: Math.min(t0, t1), hi: Math.max(t0, t1), offset, clear });
  }
  if (!par.length) return null;

  // Mintavételezés a fal mentén: minden pontban oldalanként a LEGKÖZELEBBI
  // szomszédot vesszük. Egy hosszú fal több helyiséget is határolhat, ezért a
  // "legközelebbi átfedő fal" önmagában kevés: a mérővonal könnyen egy másik
  // helyiség fölé kerülne (ott a szám nem is igaz), a másik oldal pedig
  // olvashatatlanul takarásba került. A mintákból oldalanként a leghosszabb
  // ÖSSZEFÜGGŐ, ugyanahhoz a falhoz tartozó szakaszt választjuk.
  const hits = { neg: [], pos: [] };
  for (let i = 0; i < CLEAR_SAMPLES; i++) {
    const t = len * (i + 0.5) / CLEAR_SAMPLES;
    for (const key of ['neg', 'pos']) {
      const sign = key === 'neg' ? -1 : 1;
      let best = null;
      for (const p of par) {
        if (Math.sign(p.offset) !== sign || t < p.lo || t > p.hi) continue;
        if (!best || p.clear < best.clear) best = p;
      }
      hits[key].push(best);
    }
  }

  // a két oldal címkéje a szakaszán belül eltérő helyre kerül, hogy a fal
  // ugyanazon pontján ne fedjék egymást (és a helyiség-feliratot se)
  const neg = longestRun(hits.neg, len, 0.34);
  const pos = longestRun(hits.pos, len, 0.66);
  if (!neg && !pos) return null;
  return { a, dir, nrm, half, neg, pos };
}

const CLEAR_SAMPLES = 64;

// a minták leghosszabb, egyazon szomszéd falhoz tartozó összefüggő szakasza;
// a mérővonal ezen belül `frac` arányban áll
function longestRun(samples, len, frac) {
  let best = null;
  for (let i = 0; i < samples.length;) {
    const cur = samples[i];
    if (!cur) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && samples[j + 1]?.id === cur.id) j++;
    const n = j - i + 1;
    if (!best || n > best.n) best = { n, side: cur, lo: i / samples.length, hi: (j + 1) / samples.length };
    i = j + 1;
  }
  if (!best) return null;
  return {
    offset: best.side.offset, clear: best.side.clear,
    overlapAt: len * (best.lo + (best.hi - best.lo) * frac),
  };
}

// A fal ELTOLÁSA önmagára merőlegesen úgy, hogy a megadott oldalon a szabad
// távolság pontosan `value` legyen. A fal két végpontja együtt mozdul; a
// végein csatlakozó (az elmozdulással párhuzamos) falak csak megnyúlnak vagy
// rövidülnek — a derékszögek megmaradnak.
export function setWallClearance(plan, w, sideKey, value) {
  const c = wallClearances(plan, w);
  const side = c && c[sideKey];
  if (!side || !(value > 0)) return;

  const delta = value - side.clear;
  if (Math.abs(delta) < 0.01) return;
  const dirSign = -Math.sign(side.offset); // a szomszédtól ELFELÉ növelünk
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  for (const n of [a, b]) {
    n.x = round1(n.x + c.nrm.x * dirSign * delta);
    n.y = round1(n.y + c.nrm.y * dirSign * delta);
  }
  notify();
}

// A fal vastagságának módosítása FALSÍK-IGAZÍTÁSSAL.
//
// A falak a tengelyükre szimmetrikusak, ezért vastagság-váltáskor alapból
// mindkét síkjuk elmozdul a felével. Ha viszont az egyik síkot a helyén
// akarjuk tartani (pl. egy lelépcsőző fal felső síkja végig egyvonalban
// maradjon), a tengelyt el kell tolni a különbség felével.
//
//   align: 'center' — a tengely marad (alapértelmezés, a régi viselkedés)
//          'plus'   — a normál (+) irányú falsík marad a helyén
//          'minus'  — a másik falsík marad a helyén
//
// Az eltolás merőleges a falra: a két végpont EGYÜTT mozdul, a végein
// csatlakozó (az elmozdulással párhuzamos) falak csak megnyúlnak — a
// derékszögek megmaradnak, ahogy a setWallClearance-nél is.
export function setWallThickness(plan, w, thickness, align = 'center') {
  if (!(thickness > 0)) return;
  const delta = thickness - w.thickness;
  w.thickness = thickness;

  if (align !== 'plus' && align !== 'minus') { notify(); return; }
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b || w.bulge || Math.abs(delta) < 0.01) { notify(); return; }

  const n = G.normal(a, b);
  const shift = (align === 'plus' ? -1 : 1) * delta / 2;
  for (const node of [a, b]) {
    node.x = round1(node.x + n.x * shift);
    node.y = round1(node.y + n.y * shift);
  }
  notify();
}

// A falak VALÓDI síkjai, tengelyre merőlegesen bontva. A rács-alapú
// alak-felismerés (raster.js) 2 cm-es cellákkal dolgozik, ezért a kontúr
// legfeljebb egy cellányit tévedhet: a falsík hol pont a helyére, hol 1 cm-rel
// mellé esik. Ez eltérő vastagságú falak találkozásánál apró lépcsőként is
// kilátszik. A nyers kontúrt ezekre a síkokra illesztjük vissza.
//
// Csak a tengelyirányú (vízszintes/függőleges) falakkal foglalkozunk — ferde
// falnál nincs egyetlen x/y sík, amire illeszteni lehetne.
export function wallFacePlanes(plan) {
  const xs = new Set(), ys = new Set();
  for (const w of plan.walls) {
    if (w.bulge) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const half = w.thickness / 2;
    if (Math.abs(a.y - b.y) < 0.01) {        // vízszintes fal
      ys.add(a.y - half); ys.add(a.y + half);
      xs.add(a.x); xs.add(b.x);              // a fal lapos vége
    } else if (Math.abs(a.x - b.x) < 0.01) { // függőleges fal
      xs.add(a.x - half); xs.add(a.x + half);
      ys.add(a.y); ys.add(b.y);
    }
  }
  return { xs: [...xs], ys: [...ys] };
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

