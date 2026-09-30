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
// cm – "babaházas" nézet: ilyen magasan elvágott falakkal a berendezés kívülről
// is belátható (teljes magasságú falaknál csak felülről lehetne belesni)
const LOW_WALL_H = 110;
const STAIR_RISER = 17.5;    // cm – egy fok fellépése (bejárati lépcső magasságához)
// a KAMERA FELŐLI falak áttetszősége (a hátsó falak tömörek maradnak)
const WALL_OPACITY = 0.2;

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

let renderer, scene, camera, controls, container, model, sun, fill;
let raf = null, needsRebuild = true;
let lowWalls = false;
let wallOpaqueMat = null, wallFadeMat = null;
let wallOpacity = WALL_OPACITY;
let fadeWalls = [];        // falanként: a darabjai + a fal síkja (halványításhoz)
let avatar = null;         // az emberke: ő a nézet középpontja
let planLevels = null;     // az utolsó felépítés padlószintjei (az emberke ehhez igazodik)

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;   // ne lehessen a padló alá fordulni

  scene.add(new THREE.HemisphereLight('#ffffff', '#d5dbe2', 1.0));
  sun = new THREE.DirectionalLight('#fff4e2', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 2;   // cm – vékony falaknál ez tünteti el az árnyék-szemcsét
  scene.add(sun);
  scene.add(sun.target);

  // derítőfény a néző felől, árnyék NÉLKÜL: ettől marad világos a felénk néző
  // falfelület is, miközben az árnyékokat egyedül a nap rajzolja
  fill = new THREE.DirectionalLight('#ffffff', 0.55);
  scene.add(fill);

  initAvatarDrag();
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
    faceCamera();
    updateWallFade();
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
    fadeWalls = [];
  }
  const plan = getPlan();
  model = new THREE.Group();
  const levels = roomLevels(plan);
  const wallH = lowWalls ? Math.min(LOW_WALL_H, levels.ceiling) : levels.ceiling;

  addFloors(plan, model, levels);
  addWalls(plan, model, wallH, levels);
  addOpenings(plan, model, wallH, levels);
  addFurniture(plan, model, levels);

  scene.add(model);
  planLevels = levels;

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 300);

  // A nap a HÁTSÓ falak felől süt: így az árnyékok a néző felé, a nyitott
  // padlófelületre esnek, ahol tényleg látszanak. Hogy közben a felénk néző
  // falak se legyenek sötétek, az égbolt-fény (hemisphere) erős és világos —
  // a nap csak a plasztikát és az árnyékokat adja hozzá.
  sun.position.set(center.x - span * 0.45, span * 2.1, center.z - span * 0.3);
  fill.position.set(center.x + span * 0.8, span * 0.9, center.z + span * 0.9);
  sun.target.position.copy(center);
  const sc = sun.shadow.camera;
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
  sc.near = 10; sc.far = span * 4;
  sc.updateProjectionMatrix();

  // az emberke a nézet középpontja: a kamera hozzá képest áll, és vele mozog
  placeAvatar(avatar ? avatar.position : center, levels, span);
  const dist = span * 1.4;
  camera.position.set(
    avatar.position.x + dist * 0.6, avatar.position.y + dist * 0.8, avatar.position.z + dist,
  );
  aimAtAvatar();
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
    mesh.receiveShadow = true;
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
function addWalls(plan, group, wallH, levels) {
  const mat = wallMaterials().opaque;
  const joints = wallJoints(plan);
  fadeWalls = [];
  let parts = [];   // az ÉPPEN épülő fal darabjai — együtt halványulnak

  // minden faldarab vet és fogad árnyékot
  const solid = geo => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parts.push(mesh);
    return mesh;
  };

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

    const holes = wallHoles(plan, w, wallH, uStart, uEnd, levels);

    // A födémig érő nyílás (pl. zuhanykabin üvegajtaja, ahol nincs áthidaló)
    // nem lyuk a fal nézetében, hanem KETTÉVÁGJA a falat: a lyuk széle egybeesne
    // a lap tetejével, amiből elfajult alakzat lenne. Ezért az ilyen nyílások
    // mentén szakaszokra bontjuk a falat, és a többi nyílás lyukként kerül bele.
    const toCeiling = holes.filter(h => h.top >= wallH - 0.5);
    const inner = holes.filter(h => h.top < wallH - 0.5);
    const spans = spansExcluding(uStart, uEnd, toCeiling);

    // 1. a két oldalfelület: a fal NÉZETE, a nyílásokkal kilyukasztva —
    //    egyetlen lap, tehát a nyílások mellett nincs függőleges toldás
    parts = [];
    for (const [u0, u1] of spans) {
      const face = new THREE.Shape();
      rectPath(face, u0, 0, u1, wallH);
      for (const h of inner) {
        if (h.from < u0 || h.to > u1) continue;
        const hole = new THREE.Path();
        rectPath(hole, h.from, h.bottom, h.to, h.top);
        face.holes.push(hole);
      }
      for (const v of [t / 2, -t / 2]) {
        group.add(solid(placeFace(new THREE.ShapeGeometry(face), a, ang, v)));
      }
    }

    // 2. a fal teteje (a födémig érő nyílásoknál megszakítva)
    for (const [u0, u1] of spans) {
      group.add(solid(horizQuad(a, ang, t, u0, u1, wallH)));
    }

    // 3. falvég-lezárás csak szabad végen (csatlakozásnál a lap a szomszéd
    //    falon belülre esne, és áttetszően sötét sávként ütne át)
    if (ja.cap) group.add(solid(crossQuad(a, ang, t, uStart, 0, wallH)));
    if (jb.cap) group.add(solid(crossQuad(a, ang, t, uEnd, 0, wallH)));

    // 4. a nyílások kávái: két oldal + könyöklő felső lapja + áthidaló alja
    for (const h of holes) {
      group.add(solid(crossQuad(a, ang, t, h.from, h.bottom, h.top)));
      group.add(solid(crossQuad(a, ang, t, h.to, h.bottom, h.top)));
      if (h.bottom > 0) group.add(solid(horizQuad(a, ang, t, h.from, h.to, h.bottom)));
      if (h.top < wallH) group.add(solid(horizQuad(a, ang, t, h.from, h.to, h.top)));
    }

    // a fal SÍKJA és középpontja: ebből dől el képkockánként, hogy takar-e
    fadeWalls.push({
      parts,
      normal: new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)),
      point: new THREE.Vector3(a.x, 0, a.y),
      center: wallPoint(a, ang, (uStart + uEnd) / 2, 0, wallH / 2),
      thickness: t,
    });
  }
}

// a fal nyílásai a fal saját u-koordinátájában, összevonva. A fal végén TÚLLÓGÓ
// nyílás (pl. a fal utólagos rövidítése után) csak a közös részt vágja ki, az
// átfedő nyílások pedig eggyé olvadnak — különben kétszer kapnának kávát.
function wallHoles(plan, w, wallH, uStart, uEnd, levels) {
  const raw = plan.objects
    .filter(o => o.wallId === w.id)
    .map(o => ({
      from: Math.max(uStart, o.offset - o.width / 2),
      to: Math.min(uEnd, o.offset + o.width / 2),
      ...openingLevels(o, wallH, openingBase(levels, plan, w, o)),
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

// A falaknak KÉT anyaga van: a hátsó (a nézőtől távolabbi) falak tömörek, a
// kamera és az emberke KÖZÖTT állók pedig áttetszők — így felülről-oldalról
// belátni a lakásba, de a háttér nem lesz zavaros üvegdoboz.
function wallMaterials() {
  if (!wallOpaqueMat) {
    // DoubleSide: a fal két oldallapja közül az egyik geometriai normálisa
    // befelé néz — kétoldalas anyaggal mindkettő helyesen világítódik.
    // shadowSide: az árnyék viszont elég egy oldalról (a kétszeres árnyék-
    // rajzolás fölösleges, és a vékony lapokon szemcsét is okoz).
    wallOpaqueMat = new THREE.MeshLambertMaterial({
      color: '#f4f2ee', side: THREE.DoubleSide, shadowSide: THREE.FrontSide,
      emissive: '#4a4845',   // a fal sose legyen sötétszürke, ha nem éri nap
    });
    wallFadeMat = new THREE.MeshLambertMaterial({
      color: '#f4f2ee', side: THREE.DoubleSide, shadowSide: THREE.FrontSide,
      emissive: '#4a4845',
      transparent: true, opacity: wallOpacity, depthWrite: false,
    });
  }
  return { opaque: wallOpaqueMat, fade: wallFadeMat };
}

function setWallOpacity(value) {
  wallOpacity = Math.max(0.02, Math.min(1, value));
  if (!wallFadeMat) return;
  wallFadeMat.opacity = wallOpacity;
  wallFadeMat.depthWrite = wallOpacity > 0.98;
  wallFadeMat.needsUpdate = true;
}

// Melyik fal áll a kamera és az emberke KÖZÖTT?
//
// A döntés FALANKÉNT születik, nem laponként: ha csak az egyik oldallap tűnne
// el, a fal fele ott maradna, és a falazat darabjaira esne szét. Egy fal akkor
// takar, ha (1) a kamera és az emberke a fal síkjának ELLENTÉTES oldalán van,
// és (2) a fal közelebb van a kamerához, mint az emberke.
//
function updateWallFade() {
  if (!fadeWalls.length || !camera) return;
  const cam = camera.position, t = controls.target;
  const mats = wallMaterials();
  const camToTarget = cam.distanceTo(t);

  for (const w of fadeWalls) {
    const n = w.normal, p = w.point;
    const dCam = n.x * (cam.x - p.x) + n.z * (cam.z - p.z);
    const dTgt = n.x * (t.x - p.x) + n.z * (t.z - p.z);
    const between = Math.abs(dCam) > w.thickness / 2 && (dCam > 0) !== (dTgt > 0);
    const fade = between && cam.distanceTo(w.center) < camToTarget;

    // Az elhalványított fal TOVÁBBRA IS vet árnyékot: a napfény ugyanúgy
    // megtörik rajta, és enélkül a belső tér teljesen árnyék nélküli, lapos
    // lenne. A nap magasan áll, ezért ez a fal tövénél futó keskeny csík, nem
    // az egész padlót elborító szürke tábla.
    const wanted = fade ? mats.fade : mats.opaque;
    for (const mesh of w.parts) {
      if (mesh.material !== wanted) mesh.material = wanted;
    }
  }
}

// --- az emberke: a nézet középpontja, szabadon húzható ---

const AVATAR_H = 172;   // cm

// Álló női alak, testrészekből összerakva (fej, haj, törzs, miniszoknya, kar,
// láb, cipő). Nem részletes modell — a célja, hogy MÉRETARÁNYOS viszonyítási
// pont legyen a lakásban, és egy pillantásra látszódjon, merre "néz" a nézet.
// Minden méret cm-ben, a teljes magasság AVATAR_H.
function buildAvatar() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: '#f2c6a0' });
  const hair = new THREE.MeshLambertMaterial({ color: '#4a3226' });
  const top = new THREE.MeshLambertMaterial({ color: '#3aa9d6' });
  const skirt = new THREE.MeshLambertMaterial({ color: '#d94f72' });
  const shoe = new THREE.MeshLambertMaterial({ color: '#3a3f47' });

  // a figura a +z irányba néz; a nézethez képest a placeAvatar forgatja el
  const add = (geo, mat, x, y, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(8, 4, 17), shoe, side * 6, 2, 2);                // cipő
    add(new THREE.CylinderGeometry(4.2, 5, 78, 12), skin, side * 6, 43, 0);    // láb
    add(new THREE.CylinderGeometry(3.2, 3.6, 52, 10), skin, side * 15, 113, 0); // kar
  }

  add(new THREE.CylinderGeometry(11.5, 19, 26, 20), skirt, 0, 95, 0);          // miniszoknya
  add(new THREE.CylinderGeometry(12, 11, 40, 20), top, 0, 122, 0);             // törzs (felső)
  add(new THREE.CylinderGeometry(3.6, 3.6, 7, 10), skin, 0, 145, 0);           // nyak
  add(new THREE.SphereGeometry(9.5, 20, 16), skin, 0, 157, 0);                 // fej

  const cap = add(new THREE.SphereGeometry(10.2, 20, 16), hair, 0, 158.5, -0.8); // haj
  cap.scale.set(1, 1.05, 1.05);
  add(new THREE.CapsuleGeometry(5.5, 26, 4, 12), hair, 0, 137, -8);            // hosszú haj hátul

  // talppont-jelölő, hogy húzás közben is látszódjon, hol áll
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(20, 26, 32),
    new THREE.MeshBasicMaterial({ color: '#2f8fd0', transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1;
  g.add(ring);
  return g;
}

// az emberke a megadott pontra áll, annak a helyiségnek a padlójára
function placeAvatar(pos, levels, span) {
  if (!avatar) {
    avatar = buildAvatar();
    scene.add(avatar);
  }
  const scale = Math.max(1, span / 1500);   // nagy alaprajzon ne vesszen el
  avatar.scale.setScalar(scale);
  avatar.position.set(pos.x, (levelAt(levels, pos.x, pos.z) ?? 0), pos.z);
}

// a figura a kamera felé fordul (a hajáról/szoknyájáról így mindig látszik,
// hogy ember, nem egy hasáb)
function faceCamera() {
  if (!avatar || !camera) return;
  avatar.rotation.y = Math.atan2(
    camera.position.x - avatar.position.x, camera.position.z - avatar.position.z,
  );
}

// a kamera az emberke fejmagasságára néz, a jelenlegi irányból
function aimAtAvatar() {
  controls.target.set(avatar.position.x, avatar.position.y + AVATAR_H * 0.6, avatar.position.z);
  controls.update();
}

// Húzás: az emberkére kattintva a vízszintes síkon mozgatható, és a kamera
// vele együtt tolódik — a nézet mindig hozzá képest áll.
function initAvatarDrag() {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let dragFrom = null;

  const toNdc = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  renderer.domElement.addEventListener('pointerdown', e => {
    if (!avatar || e.button !== 0) return;
    toNdc(e);
    ray.setFromCamera(ndc, camera);
    if (!ray.intersectObject(avatar, true).length) return;

    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), avatar.position.clone());
    if (!ray.ray.intersectPlane(plane, hit)) return;
    dragFrom = hit.clone();
    controls.enabled = false;
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* nem támogatott */ }
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    toNdc(e);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;

    const dx = hit.x - dragFrom.x, dz = hit.z - dragFrom.z;
    dragFrom.copy(hit);
    avatar.position.x += dx;
    avatar.position.z += dz;
    // a padlószint a helyiséggel változhat (megemelt padlójú téli kert stb.)
    const y = levelAt(planLevels, avatar.position.x, avatar.position.z);
    if (y != null) avatar.position.y = y;
    camera.position.x += dx;
    camera.position.z += dz;
    aimAtAvatar();
  });

  const end = e => {
    if (!dragFrom) return;
    dragFrom = null;
    controls.enabled = true;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* nem volt elkapva */ }
  };
  renderer.domElement.addEventListener('pointerup', end);
  renderer.domElement.addEventListener('pointercancel', end);
}

// A nyílás alsó/felső széle. A magasságokat annak a helyiségnek a PADLÓJÁTÓL
// mérjük, amelyikbe a nyílás nyílik (`base`) — egy megemelt padlójú helyiségbe
// vezető ajtó a lépcső tetején nyílik, nem az alsó szintről.
function openingLevels(o, wallH, base = 0) {
  // "nincs fölötte fal" (pl. zuhanykabin üvegajtaja): a nyílás a födémig ér
  if (o.noLintel) return { bottom: Math.max(0, Math.min(wallH, base)), top: wallH };
  const height = Math.min(o.height > 0 ? o.height : 210, wallH - base);
  const sill = o.kind === 'window' ? Math.min(WINDOW_SILL, wallH - base - height) : 0;
  const bottom = Math.max(0, Math.min(wallH, base + Math.max(0, sill)));
  return { bottom, top: Math.min(wallH, bottom + height) };
}

// A nyílás padlószintje: a fal KÉT OLDALÁN megnézzük, melyik helyiségbe esik,
// és a magasabbat vesszük — két különböző szintű helyiség közötti ajtó a felső
// padló szintjén ül (a lépcső tetején), a küszöb alatt marad a falszakasz.
function openingBase(levels, plan, w, o) {
  const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
  if (!a || !b) return 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return 0;
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const nrm = { x: -dir.y, y: dir.x };
  const c = { x: a.x + dir.x * o.offset, y: a.y + dir.y * o.offset };
  const d = w.thickness / 2 + 25;

  const l1 = levelAt(levels, c.x + nrm.x * d, c.y + nrm.y * d);
  const l2 = levelAt(levels, c.x - nrm.x * d, c.y - nrm.y * d);
  if (l1 == null && l2 == null) return 0;
  return Math.max(l1 ?? 0, l2 ?? 0);
}

// Az ablakok üvegtáblát kapnak: áttetsző falaknál a puszta nyílás nem látszik,
// és így az is rögtön kiderül, ha egy nyílás rossz helyre került.
function addOpenings(plan, group, wallH, levels) {
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
    const { bottom, top } = openingLevels(o, wallH, openingBase(levels, plan, w, o));
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
    // a falak két anyaga megosztott és újrahasznosuljuk — azt nem dobjuk el
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && m !== wallOpaqueMat && m !== wallFadeMat) m.dispose();
    }
  });
}
