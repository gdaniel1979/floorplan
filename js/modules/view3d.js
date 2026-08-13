// 3D nézet: az alaprajzból felhúzott tömegmodell (falak nyílásokkal, padlók,
// bútorok) three.js-sel, szabadon körbeforgatható kamerával.
//
// Az egységek a rajzzal egyezően CENTIMÉTEREK. A vízszintes sík a rajz x/y
// tengelye: a plan (x, y) → három (x, z), a magasság a +Y tengely. A rajzon a
// forgatás y-lefelé rendszerben pozitív, ezért a 3D-ben az ellentettje kell
// (mesh.rotation.y = -rotation).
//
// A nyílásokat nem CSG-vel vágjuk ki, hanem a falat DARABOKBÓL rakjuk össze:
// a nyílások között tömör szakaszok, a nyílás alatt könyöklő (ablaknál), fölötte
// áthidaló. Egy alaprajzhoz ez pontosan ugyanazt adja, sokkal egyszerűbben.

import * as THREE from '../../vendor/three.module.js';
import { OrbitControls } from '../../vendor/OrbitControls.js';

import { getPlan, nodeById } from './plan.js';
import { getRoomTrace, DEFAULT_ROOM_HEIGHT } from './rooms.js';
import { furnitureColor, isStair, STAIR_TREAD } from './furniture.js';
import { ui } from './uistate.js';
import { onChange } from './state.js';
import { showToast } from './toast.js';

const WINDOW_SILL = 90;      // cm – ablak könyöklő-magassága, ha nincs külön megadva
const FLOOR_LIFT = 0.4;      // cm – a padló ennyivel a 0 szint fölött, hogy ne villogjon
const CATEGORY_LAYERS = ['szaniter', 'konyha', 'butor', 'epulet'];
// cm – "babaházas" nézet: ilyen magasan elvágott falakkal a berendezés kívülről
// is belátható (teljes magasságú falaknál csak felülről lehetne belesni)
const LOW_WALL_H = 110;
const STAIR_RISER = 17.5;    // cm – egy fok fellépése (bejárati lépcső magasságához)
// a falak áttetszőek, hogy a berendezés a szemközti helyiségekben is látszódjon
const WALL_OPACITY = 0.45;

// A bútorok MAGASSÁGA (cm) — az alaprajz csak alapterületet tárol, a 3D-hez
// típusonként kell egy jellemző magasság. Ami nincs a listában, a kategória
// alapértékét kapja.
const FURNITURE_HEIGHT = {
  wc: 40, wckerek: 40, wcfali: 40, bide: 40, mosdo: 85, duplamosdo: 85,
  kad: 55, kadivessarok: 55, kadovalis: 58, zuhany: 10, zuhanykabin: 200,
  mosogep: 85, szaritogep: 85, bojler: 120,
  tuzhely: 90, suto: 60, mikro: 30, paraelszivo: 15, huto: 180, mosogatogep: 85,
  mosogato: 90, konyhapult: 90, alsoszekreny: 90, felsoszekreny: 70,
  sarokszekreny: 90, konyhasziget: 90, barpult: 110,
  franciaagy: 55, agy: 55, egyagy: 55, emeletesagy: 165, ejjeliszekreny: 50,
  gardrob: 220, szekreny: 200, szekreny1: 200, komod: 85, fogas: 15,
  kanape: 85, sarokkanape: 85, fotel: 85, puff: 45, dohanyzoasztal: 45,
  tvszekreny: 50, konyvespolc: 200, szonyeg: 1,
  etkezoasztal: 75, kerekasztal: 75, szek: 90, iroasztal: 75, irodaiszek: 100,
  oszlop: 300, kemeny: 300, radiator: 60, kandallo: 120, akna: 300, meterszekreny: 60,
};
const CATEGORY_HEIGHT = { szaniter: 85, konyha: 90, butor: 80, epulet: 100 };

let renderer, scene, camera, controls, container, model;
let raf = null, needsRebuild = true;
let lowWalls = false;
let wallMat = null;
let wallOpacity = WALL_OPACITY;

export function initView3d() {
  document.getElementById('view3d-btn').addEventListener('click', open);
  document.getElementById('view3d-close').addEventListener('click', close);

  // a réteg-kapcsolók a 3D fejlécében ugyanazt az ui.layerVisible-t állítják,
  // mint a Rétegek panel — a két hely mindig egyezik
  for (const box of document.querySelectorAll('[data-v3d-layer]')) {
    box.addEventListener('change', () => {
      ui.layerVisible[box.dataset.v3dLayer] = box.checked;
      rebuild();
    });
  }

  const opacityInput = document.getElementById('view3d-opacity');
  opacityInput.value = Math.round(wallOpacity * 100);
  // csak az anyag átlátszósága változik — nem kell újraépíteni a modellt
  opacityInput.addEventListener('input', () => setWallOpacity(opacityInput.value / 100));

  const lowBox = document.getElementById('view3d-lowwalls');
  lowBox.checked = lowWalls;
  lowBox.addEventListener('change', () => { lowWalls = lowBox.checked; rebuild(); });

  // ha a terv változik (szerkesztés, visszavonás, betöltés), a következő
  // megnyitáskor új modell épül
  onChange(() => { needsRebuild = true; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay().hidden) close();
  });
}

function overlay() { return document.getElementById('view3d'); }

function open() {
  const plan = getPlan();
  if (!plan || !plan.walls.length) {
    showToast('Nincs mit megmutatni — előbb rajzolj falakat.');
    return;
  }
  overlay().hidden = false;
  for (const box of document.querySelectorAll('[data-v3d-layer]')) {
    box.checked = !!ui.layerVisible[box.dataset.v3dLayer];
  }
  ensureRenderer();
  if (needsRebuild || !model) rebuild();
  resize();
  start();
}

function close() {
  overlay().hidden = true;
  stop();
}

// --- renderer / kamera ---

function ensureRenderer() {
  if (renderer) return;
  container = document.getElementById('view3d-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9eef3');

  camera = new THREE.PerspectiveCamera(45, 1, 10, 100000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;   // ne lehessen a padló alá fordulni

  scene.add(new THREE.HemisphereLight('#ffffff', '#8899aa', 2.1));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(-700, 1200, 600);
  scene.add(sun);

  window.addEventListener('resize', () => { if (!overlay().hidden) resize(); });
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function start() {
  if (raf) return;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
}

// --- a modell felépítése ---

function rebuild() {
  if (!scene) return;
  if (model) {
    scene.remove(model);
    disposeTree(model);
  }
  const plan = getPlan();
  model = new THREE.Group();
  const levels = roomLevels(plan);
  const wallH = lowWalls ? Math.min(LOW_WALL_H, levels.ceiling) : levels.ceiling;

  addFloors(plan, model, levels);
  addWalls(plan, model, wallH);
  addOpenings(plan, model, wallH);
  addFurniture(plan, model, levels);

  // a rajz origója helyett a lakás közepe legyen a forgatás középpontja
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  scene.add(model);

  const dist = Math.max(size.x, size.z, 300) * 1.4;
  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.8, center.z + dist);
  controls.target.copy(center);
  controls.update();
  needsRebuild = false;
}

// A PADLÓSZINTEK a belmagasságokból következnek. Egy szinten belül a födém
// (mennyezet) közös, ezért az alacsonyabb belmagasságú helyiség padlója van
// FELJEBB — pl. egy 2,00 m-es téli kert padlója 90 cm-rel magasabban van, mint
// a mellette lévő 2,90 m-esé, és éppen ezért vezet oda lépcső.
//
//   mennyezet = a legnagyobb belmagasság
//   padlószint(helyiség) = mennyezet − belmagasság
function roomLevels(plan) {
  let ceiling = 0;
  for (const r of plan.rooms) ceiling = Math.max(ceiling, r.height || 0);
  ceiling = ceiling || DEFAULT_ROOM_HEIGHT;

  const areas = [];
  for (const r of plan.rooms) {
    const trace = getRoomTrace(plan, r);
    if (!trace?.poly?.length) continue;
    areas.push({ room: r, poly: trace.poly, level: ceiling - (r.height || ceiling) });
  }
  return { ceiling, areas };
}

// melyik helyiség padlószintjén áll egy pont; `null`, ha egyik helyiségben
// sincs (pl. a házon KÍVÜL van — ez a bejárati lépcsőnél számít)
function levelAt(levels, x, y) {
  for (const a of levels.areas) {
    if (pointInPolygon(a.poly, x, y)) return a.level;
  }
  return null;
}

function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if ((pi.y > y) !== (pj.y > y) && x < (pj.x - pi.x) * (y - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function addFloors(plan, group, levels) {
  for (const area of levels.areas) {
    const room = area.room;
    const shape = new THREE.Shape();
    area.poly.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);          // a rajz síkja vízszintesbe fordul
    geo.translate(0, area.level + FLOOR_LIFT, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: new THREE.Color(room.color || '#dfe6ec'), side: THREE.DoubleSide,
    }));
    group.add(mesh);
  }
}

// A falszerkezet EGYETLEN, összefüggő testként jelenik meg: nem doboz-darabokból
// rakjuk össze, hanem falanként pontosan a KÜLSŐ FELÜLETEIT rajzoljuk meg —
// két oldallap (a nyílásokkal kilyukasztva), a fal teteje, a nyílások kávái, és
// a falvégek lezárása CSAK ott, ahol tényleg szabad a vég.
//
// Azért így: áttetsző falnál minden belső lap átüt. A régi, dobozokból rakott
// fal a nyílások mellett és a sarkokban is belső lapokat hagyott — ezek
// látszottak függőleges vonalakként, illetve a csatlakozásoknál sötét sávként.
function addWalls(plan, group, wallH) {
  const mat = wallMaterial();
  const joints = wallJoints(plan);

  for (const w of plan.walls) {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;

    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const t = w.thickness;
    // a csomópontokban a fal túlnyúlik vagy visszahúzódik, hogy a sarok pontosan
    // egyszer legyen kitöltve (se hézag, se átfedés)
    const ja = joints.get(`${w.id}|${w.a}`) || { ext: 0, cap: true };
    const jb = joints.get(`${w.id}|${w.b}`) || { ext: 0, cap: true };
    const uStart = -ja.ext, uEnd = len + jb.ext;

    const holes = wallHoles(plan, w, wallH, uStart, uEnd);

    // 1. a két oldalfelület: a fal NÉZETE, a nyílásokkal kilyukasztva —
    //    egyetlen lap, tehát a nyílások mellett nincs függőleges toldás
    const face = new THREE.Shape();
    rectPath(face, uStart, 0, uEnd, wallH);
    for (const h of holes) {
      const hole = new THREE.Path();
      rectPath(hole, h.from, h.bottom, h.to, h.top);
      face.holes.push(hole);
    }
    for (const v of [t / 2, -t / 2]) {
      group.add(new THREE.Mesh(placeFace(new THREE.ShapeGeometry(face), a, ang, v), mat));
    }

    // 2. a fal teteje (a plafonig érő nyílásoknál megszakítva)
    const upTo = holes.filter(h => h.top >= wallH - 0.5);
    for (const [u0, u1] of spansExcluding(uStart, uEnd, upTo)) {
      group.add(new THREE.Mesh(horizQuad(a, ang, t, u0, u1, wallH), mat));
    }

    // 3. falvég-lezárás csak szabad végen (csatlakozásnál a lap a szomszéd
    //    falon belülre esne, és áttetszően sötét sávként ütne át)
    if (ja.cap) group.add(new THREE.Mesh(crossQuad(a, ang, t, uStart, 0, wallH), mat));
    if (jb.cap) group.add(new THREE.Mesh(crossQuad(a, ang, t, uEnd, 0, wallH), mat));

    // 4. a nyílások kávái: két oldal + könyöklő felső lapja + áthidaló alja
    for (const h of holes) {
      group.add(new THREE.Mesh(crossQuad(a, ang, t, h.from, h.bottom, h.top), mat));
      group.add(new THREE.Mesh(crossQuad(a, ang, t, h.to, h.bottom, h.top), mat));
      if (h.bottom > 0) group.add(new THREE.Mesh(horizQuad(a, ang, t, h.from, h.to, h.bottom), mat));
      if (h.top < wallH) group.add(new THREE.Mesh(horizQuad(a, ang, t, h.from, h.to, h.top), mat));
    }
  }
}

// a fal nyílásai a fal saját u-koordinátájában, összevonva. A fal végén TÚLLÓGÓ
// nyílás (pl. a fal utólagos rövidítése után) csak a közös részt vágja ki, az
// átfedő nyílások pedig eggyé olvadnak — különben kétszer kapnának kávát.
function wallHoles(plan, w, wallH, uStart, uEnd) {
  const raw = plan.objects
    .filter(o => o.wallId === w.id)
    .map(o => ({
      from: Math.max(uStart, o.offset - o.width / 2),
      to: Math.min(uEnd, o.offset + o.width / 2),
      ...openingLevels(o, wallH),
    }))
    .filter(h => h.to - h.from > 1)
    .sort((p, q) => p.from - q.from);

  const merged = [];
  for (const h of raw) {
    const last = merged[merged.length - 1];
    if (last && h.from < last.to) {
      last.to = Math.max(last.to, h.to);
      last.bottom = Math.min(last.bottom, h.bottom);
      last.top = Math.max(last.top, h.top);
    } else {
      merged.push({ ...h });
    }
  }
  return merged;
}

// [u0, u1] szakaszok, a megadott nyílások kihagyásával
function spansExcluding(u0, u1, holes) {
  const spans = [];
  let cursor = u0;
  for (const h of holes) {
    if (h.from > cursor) spans.push([cursor, h.from]);
    cursor = Math.max(cursor, h.to);
  }
  if (cursor < u1) spans.push([cursor, u1]);
  return spans;
}

// A CSATLAKOZÁSOK rendezése. Csomópontonként egy fal a "vezető" (a legvastagabb;
// egyenlőségnél a sorrendben első): ez nyúlik túl a másik fal félvastagságával
// és lezárja a sarkot, a többi pedig épp az ő síkjáig húzódik vissza, lezárás
// nélkül. Egy vonalba eső (csak megtört/kettévágott) falak se nem nyúlnak, se
// nem záródnak — ott a fal egyszerűen folytatódik.
function wallJoints(plan) {
  const byNode = new Map();
  for (const w of plan.walls) {
    for (const nodeId of [w.a, w.b]) {
      if (!byNode.has(nodeId)) byNode.set(nodeId, []);
      byNode.get(nodeId).push(w);
    }
  }

  const out = new Map();   // `${wallId}|${nodeId}` -> { ext, cap }
  for (const [nodeId, walls] of byNode) {
    if (walls.length < 2) continue;

    if (walls.length === 2 && collinear(plan, walls[0], walls[1])) {
      for (const w of walls) out.set(`${w.id}|${nodeId}`, { ext: 0, cap: false });
      continue;
    }

    let lead = walls[0];
    for (const w of walls) if (w.thickness > lead.thickness) lead = w;
    let otherMax = 0;
    for (const w of walls) if (w !== lead) otherMax = Math.max(otherMax, w.thickness);

    for (const w of walls) {
      out.set(`${w.id}|${nodeId}`, w === lead
        ? { ext: otherMax / 2, cap: true }
        : { ext: -lead.thickness / 2, cap: false });
    }
  }
  return out;
}

function collinear(plan, w1, w2) {
  const dir = w => {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    return len < 1 ? null : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const d1 = dir(w1), d2 = dir(w2);
  if (!d1 || !d2) return false;
  return Math.abs(d1.x * d2.y - d1.y * d2.x) < 0.02 && Math.abs(w1.thickness - w2.thickness) < 0.5;
}

// --- felület-darabok a fal saját (u = hossz mentén, v = keresztben) rendszerében ---

// pont a fal rendszerében világkoordinátában
function wallPoint(a, ang, u, v, y) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  return new THREE.Vector3(a.x + cos * u - sin * v, y, a.y + sin * u + cos * v);
}

function quad(p1, p2, p3, p4) {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  for (const p of [p1, p2, p3, p1, p3, p4]) pos.push(p.x, p.y, p.z);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// vízszintes lap (fal teteje, könyöklő, áthidaló alja)
function horizQuad(a, ang, t, u0, u1, y) {
  return quad(
    wallPoint(a, ang, u0, -t / 2, y), wallPoint(a, ang, u1, -t / 2, y),
    wallPoint(a, ang, u1, t / 2, y), wallPoint(a, ang, u0, t / 2, y),
  );
}

// keresztirányú lap (falvég, nyíláskáva)
function crossQuad(a, ang, t, u, y0, y1) {
  return quad(
    wallPoint(a, ang, u, -t / 2, y0), wallPoint(a, ang, u, t / 2, y0),
    wallPoint(a, ang, u, t / 2, y1), wallPoint(a, ang, u, -t / 2, y1),
  );
}

// a fal nézeti lapja: a (u, magasság) síkban megrajzolt alakzatot a helyére forgatja
function placeFace(geo, a, ang, v) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(cos, 0, sin),      // u irány
    new THREE.Vector3(0, 1, 0),          // magasság
    new THREE.Vector3(-sin, 0, cos),     // fal-normális
  );
  m.setPosition(a.x - sin * v, 0, a.y + cos * v);
  geo.applyMatrix4(m);
  return geo;
}

function rectPath(path, x0, y0, x1, y1) {
  path.moveTo(x0, y0);
  path.lineTo(x1, y0);
  path.lineTo(x1, y1);
  path.lineTo(x0, y1);
  path.closePath();
}

// a falak anyaga — az áttetszőség a 3D fejléc csúszkájáról állítható, ezért
// megőrizzük a hivatkozást (depthWrite: false, különben az áttetsző fal is
// eltakarná a mögötte lévőket)
function wallMaterial() {
  wallMat = new THREE.MeshLambertMaterial({
    color: '#f2f0eb', side: THREE.DoubleSide,
    transparent: true, opacity: wallOpacity, depthWrite: wallOpacity > 0.98,
  });
  return wallMat;
}

export function setWallOpacity(value) {
  wallOpacity = Math.max(0.05, Math.min(1, value));
  if (!wallMat) return;
  wallMat.opacity = wallOpacity;
  wallMat.depthWrite = wallOpacity > 0.98;
  wallMat.needsUpdate = true;
}

// a nyílás alsó/felső széle: ablaknál könyöklővel, ajtónál padlótól; a nyílás
// mindig beleférjen a falba
function openingLevels(o, wallH) {
  const height = Math.min(o.height > 0 ? o.height : 210, wallH);
  const bottom = o.kind === 'window' ? Math.max(0, Math.min(WINDOW_SILL, wallH - height)) : 0;
  return { bottom, top: Math.min(wallH, bottom + height) };
}

// Az ablakok üvegtáblát kapnak: áttetsző falaknál a puszta nyílás nem látszik,
// és így az is rögtön kiderül, ha egy nyílás rossz helyre került.
function addOpenings(plan, group, wallH) {
  const glass = new THREE.MeshLambertMaterial({
    color: '#a9c9de', transparent: true, opacity: 0.45, depthWrite: false,
  });
  for (const o of plan.objects) {
    if (o.kind !== 'window') continue;
    const w = plan.walls.find(x => x.id === o.wallId);
    if (!w) continue;
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;

    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const { bottom, top } = openingLevels(o, wallH);
    const h = top - bottom;
    if (h < 1) continue;

    const geo = new THREE.BoxGeometry(o.width, h, Math.max(3, w.thickness * 0.3));
    const mesh = new THREE.Mesh(geo, glass);
    mesh.position.set(
      a.x + Math.cos(ang) * o.offset, bottom + h / 2, a.y + Math.sin(ang) * o.offset,
    );
    mesh.rotation.y = -ang;
    group.add(mesh);
    group.add(edges(geo, mesh));
  }
}


function addFurniture(plan, group, levels) {
  for (const item of plan.furniture) {
    if (!ui.layerVisible[item.category]) continue;
    if (isStair(item)) { group.add(stairMesh(item, levels)); continue; }

    const h = FURNITURE_HEIGHT[item.type] ?? CATEGORY_HEIGHT[item.category] ?? 80;
    const base = levelAt(levels, item.x, item.y) ?? 0;   // a tárgy a helyiség padlóján áll
    const geo = new THREE.BoxGeometry(item.w, h, item.h);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: new THREE.Color(furnitureColor(item)),
    }));
    mesh.position.set(item.x, base + h / 2, item.y);
    mesh.rotation.y = -item.rotation * Math.PI / 180;
    group.add(mesh);
    group.add(edges(geo, mesh));
  }
}

// A lépcső valódi fokokkal, és — ami fontosabb — a KÉT VÉGÉNÉL lévő helyiség
// padlószintje között. A két végén kimintavételezzük, melyik helyiségbe lóg ki;
// az alacsonyabb padlóról indul, és a magasabb padlójáig ér fel. Ha a két vég
// egy szinten van (vagy nincs ott helyiség), másik emeletre visz: ilyenkor a
// teljes belmagasságot futja be.
function stairMesh(item, levels) {
  const g = new THREE.Group();
  const ends = stairEndLevels(item, levels);
  const steps = Math.max(2, item.steps || Math.round(item.h / STAIR_TREAD));
  const tread = item.h / steps;
  const rise = (ends.top - ends.bottom) / steps;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(furnitureColor(item)) });

  for (let i = 0; i < steps; i++) {
    const h = rise * (i + 1);
    const geo = new THREE.BoxGeometry(item.w, h, tread);
    const mesh = new THREE.Mesh(geo, mat);
    // a fokok a MAGASABB vég felé emelkednek
    const local = -item.h / 2 + tread * (ends.topAtBack ? steps - i - 0.5 : i + 0.5);
    mesh.position.set(0, h / 2, local);
    g.add(mesh);
    g.add(edges(geo, mesh));
  }
  g.position.set(item.x, ends.bottom, item.y);
  g.rotation.y = -item.rotation * Math.PI / 180;
  return g;
}

// a lépcső két végénél lévő padlószint; `topAtBack` = a magasabb vég a tárgy
// hátsó (a rajzon felső) éle felé van
// a lépcső egyik vége felé, a végétől kifelé haladva keresi az első helyiséget
function probeLevel(levels, x, y, dx, dy, half) {
  for (const d of [10, 25, 45, 70, 100]) {
    const level = levelAt(levels, x + dx * (half + d), y + dy * (half + d));
    if (level != null) return level;
  }
  return null;
}

function stairEndLevels(item, levels) {
  const rad = item.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  // a végeken kicsit TÚL mintavételezünk, hogy a szomszéd helyiségbe érjünk
  // A végén TÚL keresünk helyiséget, több távolságban: az első lépcsőfok
  // gyakran közvetlenül a falnál kezdődik, és a falon belüli pont egyik
  // helyiséghez sem tartozik — egyetlen mintavétel ezért félrevezető lenne.
  const half = item.h / 2;
  const lb = probeLevel(levels, item.x, item.y, sin, -cos, half);
  const lf = probeLevel(levels, item.x, item.y, -sin, cos, half);
  const steps = Math.max(2, item.steps || Math.round(item.h / STAIR_TREAD));

  // BEJÁRATI (kültéri) lépcső: az egyik vége helyiségben van, a másik a házon
  // kívül. Ilyenkor nem a plafonig megy, hanem a terepszintről a helyiség
  // padlójáig — vagyis a padló pont annyival van az utcaszint fölött, amennyi
  // a lépcső magassága (fokszám × fellépés).
  if ((lb == null) !== (lf == null)) {
    const top = lb == null ? lf : lb;
    return { bottom: top - steps * STAIR_RISER, top, topAtBack: lb != null };
  }

  // mindkét vég a házon kívül, vagy azonos padlószinten: a lépcső másik
  // SZINTRE visz, a rajzi FEL/LE irány szerint
  const bothOutside = lb == null && lf == null;
  if (bothOutside || Math.abs(lb - lf) < 1) {
    const base = bothOutside ? 0 : lb;
    const up = item.dir !== 'down';
    return { bottom: base, top: base + levels.ceiling, topAtBack: up };
  }

  return { bottom: Math.min(lb, lf), top: Math.max(lb, lf), topAtBack: lb > lf };
}

// vékony élkiemelés: enélkül az azonos színű dobozok egybefolynak
function edges(geo, mesh) {
  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 25),
    new THREE.LineBasicMaterial({ color: '#5b6672' }),
  );
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  return line;
}

function disposeTree(root) {
  root.traverse(o => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
    else o.material?.dispose?.();
  });
}

// a 3D fejléc réteg-kapcsolói és a Rétegek panel ugyanazt állítják
export const VIEW3D_LAYERS = CATEGORY_LAYERS;
