// Az aktív szint rajzának megjelenítése: falak (sraffozott, professzionális
// kinézettel), nyílászárók, láncolt külső méretvonalak, helyiség-körvonalak,
// kijelölés és fogantyúk. Minden változáskor (állapot, nézet, eszköz) teljes
// újrarajzolás.

import { el, getContent, getOverlay, getScale } from './canvas.js';
import { getPlan, nodeById, wallById, wallLengthOf, throughPartner } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';
import { getRoomTrace, polygonToPathD } from './rooms.js';
import { objectGeometry } from './objects.js';
import { getDimensionChains, wallOnChains, exteriorSilhouette, wallShapeHoles } from './exterior.js';

export function renderAll() {
  const content = getContent();
  const overlay = getOverlay();
  content.innerHTML = '';
  overlay.innerHTML = '';

  const plan = getPlan();
  if (!plan) return;
  const s = getScale();

  // helyiség-körvonalak legalul (nincs szín-kitöltés a rajzon — a szín csak
  // adatként/jegyzetként tárolódik), hogy a falak mindig felettük maradjanak
  const roomTraces = new Map(); // roomId -> nyomvonal, hogy a címke-rajzolásnál ne kelljen újraszámolni
  for (const room of plan.rooms) {
    const trace = getRoomTrace(plan, room);
    if (!trace) continue;
    roomTraces.set(room.id, trace);
    content.appendChild(el('path', {
      d: polygonToPathD(trace.poly), class: 'room-fill', 'data-room': room.id,
    }));
    if (room.id === ui.selectedRoomId) {
      overlay.appendChild(el('path', {
        d: polygonToPathD(trace.poly), class: 'room-selected', 'stroke-width': 2 / s,
      }));
    }
  }

  // fal-test: EGYETLEN, kontúrkövetéssel kikövetkeztetett sraffozott alak az
  // egész (egyenes falakból álló) fal-hálózatra, kilyukasztva a helyiségekkel
  // és a nyílászáró-résekkel — ezért nincs a csatlakozásoknál külön-külön
  // körvonal (varrat), mint a régi, falanként-külön-téglalapos rajzolásnál
  const wallPath = wallShapePathD(plan);
  if (wallPath) {
    content.appendChild(el('path', {
      d: wallPath, class: 'wall-body', 'fill-rule': 'evenodd', 'stroke-width': 1 / s,
    }));
  }

  // ívelt falak (nincs sraffozás, ismert korlát) + minden falhoz láthatatlan,
  // széles kattintható sáv (a nyílászáró-réseket kihagyva)
  for (const w of plan.walls) {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    if (w.bulge) {
      const d = G.wallPathD(a, b, w.bulge);
      content.appendChild(el('path', { d, class: 'wall-body-arc', 'stroke-width': w.thickness }));
      content.appendChild(el('path', {
        d, class: 'wall-hit', 'stroke-width': Math.max(w.thickness + 12 / s, 16 / s), 'data-wall': w.id,
      }));
      continue;
    }
    const wallObjects = plan.objects.filter(o => o.wallId === w.id);
    if (wallObjects.length) appendWallHitWithOpenings(content, a, b, w, wallObjects, s);
    else appendWallHit(content, a, b, w, s);
  }

  // nyílászárók (ajtó/ablak) — mindig láthatók, a fal-réteg része
  for (const obj of plan.objects) {
    const geo = objectGeometry(plan, obj);
    if (!geo) continue;
    content.appendChild(objectSymbol(obj, geo, s));
    if (obj.id === ui.selectedObjectId) {
      overlay.appendChild(el('line', {
        x1: geo.p1.x, y1: geo.p1.y, x2: geo.p2.x, y2: geo.p2.y,
        class: 'object-selected', 'stroke-width': geo.wall.thickness + 6 / s,
      }));
      overlay.appendChild(handle(geo.p1.x, geo.p1.y, s, 'objP1', { 'data-object': obj.id }));
      overlay.appendChild(handle(geo.p2.x, geo.p2.y, s, 'objP2', { 'data-object': obj.id }));
      overlay.appendChild(handle(geo.center.x, geo.center.y, s, 'objCenter', { 'data-object': obj.id }, true));
    }
  }

  // kijelölt fal kiemelése + fogantyúk
  const sel = plan.walls.find(w => w.id === ui.selectedWallId);
  if (sel) {
    const a = nodeById(plan, sel.a), b = nodeById(plan, sel.b);
    if (a && b) {
      overlay.appendChild(el('path', {
        d: G.wallPathD(a, b, sel.bulge || 0),
        class: 'wall-selected', 'stroke-width': sel.thickness,
      }));
      const m = sel.bulge ? G.arcMidpoint(a, b, sel.bulge) : G.mid(a, b);
      overlay.appendChild(handle(a.x, a.y, s, 'a', { 'data-wall': sel.id }));
      overlay.appendChild(handle(b.x, b.y, s, 'b', { 'data-wall': sel.id }));
      overlay.appendChild(handle(m.x, m.y, s, 'mid', { 'data-wall': sel.id }, true));
    }
  }

  // láncolt külső méretvonalak (a sziluett éleire), + a bennük NEM szereplő
  // (belső) falakra a hossz-címke marad — a T-elágazásnál szétvágott, de
  // vizuálisan egyenesen folytatódó fal-szakaszokat egy közös címkével látjuk
  // el (különben minden szakasz saját, apró hossz-számot írna ki egymás alá)
  const chains = getDimensionChains(plan);
  for (const chain of chains) renderDimensionChain(overlay, chain, s);

  for (const run of buildInteriorWallRuns(plan)) {
    if (run.walls.some(w => wallOnChains(plan, w, chains))) continue; // ezt már a méretlánc jelzi
    if (run.walls.length === 1) {
      const w = run.walls[0];
      const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
      if (!a || !b) continue;
      overlay.appendChild(lengthLabel(plan, w, a, b, s));
    } else {
      overlay.appendChild(wallRunLengthLabel(plan, run, s));
    }
  }

  // helyiség-címkék: név + terület a súlypontban
  for (const room of plan.rooms) {
    const trace = roomTraces.get(room.id);
    if (!trace) continue;
    overlay.appendChild(roomLabel(room, trace, s));
  }

  updateDoorWindowPanel(plan);
  updateWallOptionsPanel(plan);
}

// az ajtó-/ablak-opciók az oldalsávban csak akkor látszanak, ha az adott
// eszköz aktív, vagy épp olyan fajtájú nyílászáró van kijelölve
function updateDoorWindowPanel(plan) {
  const sel = plan.objects.find(o => o.id === ui.selectedObjectId);
  const doorOptions = document.getElementById('door-options');
  const windowOptions = document.getElementById('window-options');
  if (doorOptions) doorOptions.hidden = !(ui.tool === 'door' || sel?.kind === 'door');
  if (windowOptions) windowOptions.hidden = !(ui.tool === 'window' || sel?.kind === 'window');
}

// a kijelölt fal panelje (hossz + vastagság) — csak kijelölt falnál látszik,
// a mezők mindig a fal AKTUÁLIS értékét mutatják (húzás közben is frissül).
// A fókuszban lévő mezőt nem írja felül, hogy a gépelés közben ne ugorjon.
function updateWallOptionsPanel(plan) {
  const panel = document.getElementById('wall-options');
  const w = wallById(plan, ui.selectedWallId);
  if (panel) panel.hidden = !w;
  if (!w) return;

  const lengthInput = document.getElementById('wall-sel-length');
  if (lengthInput && document.activeElement !== lengthInput) {
    lengthInput.value = Math.round(wallLengthOf(plan, w));
  }

  const thickSelect = document.getElementById('wall-sel-thickness');
  const customRow = document.getElementById('wall-sel-custom-row');
  const customInput = document.getElementById('wall-sel-custom-thickness');
  if (thickSelect && customInput && document.activeElement !== thickSelect && document.activeElement !== customInput) {
    const preset = [...thickSelect.options].some(o => o.value !== 'custom' && parseFloat(o.value) === w.thickness);
    thickSelect.value = preset ? String(w.thickness) : 'custom';
    customRow.hidden = preset;
    if (!preset) customInput.value = w.thickness;
  }
}

// --- fal-alak: egyetlen kontúrkövetett, sraffozott sokszög ---

// a teljes fal-hálózat "evenodd" útvonala: a külső sziluett + minden falak
// által körülzárt üres folt (helyiség-szerű lyuk) + minden nyílászáró saját
// kis kivágása — így a sraffozott terület pontosan a valódi, egybefüggő
// falanyagot fedi, egyetlen körvonallal, varrat-vonalak nélkül
function wallShapePathD(plan) {
  const outer = exteriorSilhouette(plan);
  if (!outer) return null;

  let d = polygonToPathD(outer);
  for (const hole of wallShapeHoles(plan)) d += ' ' + polygonToPathD(hole);

  for (const w of plan.walls) {
    if (w.bulge) continue; // az ívelt falak külön, saját rétegükben rajzolódnak
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    for (const o of plan.objects) {
      if (o.wallId !== w.id) continue;
      d += ' ' + openingCutoutPathD(a, b, w, o);
    }
  }
  return d;
}

// egy nyílászáró helyén a fal testéből kivágandó kis téglalap (a fal teljes
// vastagságában, a nyílás szélességében)
function openingCutoutPathD(a, b, w, o) {
  const dir = G.unit(a, b);
  const n = G.normal(a, b);
  const h = w.thickness / 2;
  const t0 = o.offset - o.width / 2, t1 = o.offset + o.width / 2;
  const p0 = { x: a.x + dir.x * t0, y: a.y + dir.y * t0 };
  const p1 = { x: a.x + dir.x * t1, y: a.y + dir.y * t1 };
  const c1 = { x: p0.x + n.x * h, y: p0.y + n.y * h };
  const c2 = { x: p1.x + n.x * h, y: p1.y + n.y * h };
  const c3 = { x: p1.x - n.x * h, y: p1.y - n.y * h };
  const c4 = { x: p0.x - n.x * h, y: p0.y - n.y * h };
  return `M ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} L ${c4.x} ${c4.y} Z`;
}

// --- fal-testek láthatatlan, széles kattintható sávjai (kijelöléshez/húzáshoz) ---

function appendWallHit(content, a, b, w, s) {
  content.appendChild(el('path', {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, class: 'wall-hit',
    'stroke-width': Math.max(w.thickness + 12 / s, 16 / s), 'data-wall': w.id,
  }));
}

// a nyílászárók helyén megszakítva (ott nincs fal, hanem a nyílászáró saját találati sávja van)
function appendWallHitWithOpenings(content, a, b, w, wallObjects, s) {
  const dir = G.unit(a, b);
  const totalLen = G.dist(a, b);
  const sorted = [...wallObjects].sort((x, y) => x.offset - y.offset);

  let cursor = 0;
  for (const o of sorted) {
    const openStart = o.offset - o.width / 2;
    if (openStart > cursor) appendWallHitBetween(content, a, dir, cursor, openStart, w, s);
    cursor = o.offset + o.width / 2;
  }
  if (cursor < totalLen) appendWallHitBetween(content, a, dir, cursor, totalLen, w, s);
}

function appendWallHitBetween(content, a, dir, t0, t1, w, s) {
  const p0 = { x: a.x + dir.x * t0, y: a.y + dir.y * t0 };
  const p1 = { x: a.x + dir.x * t1, y: a.y + dir.y * t1 };
  appendWallHit(content, p0, p1, w, s);
}

// --- nyílászárók ---

// ajtó: nyíló szárny-vonal + negyedköríves nyílásív; ablak: kitöltött nyílás + szárny-átló(k)
function objectSymbol(obj, geo, s) {
  const g = el('g', { class: `object-symbol object-${obj.kind}` });
  g.appendChild(el('line', {
    x1: geo.p1.x, y1: geo.p1.y, x2: geo.p2.x, y2: geo.p2.y,
    class: 'object-hit', 'data-object': obj.id, 'stroke-width': Math.max(geo.wall.thickness + 12 / s, 20 / s),
  }));

  if (obj.kind === 'door') {
    if (obj.withLeaf !== false) {
      const hinge = obj.flipHinge ? geo.p2 : geo.p1;
      const other = obj.flipHinge ? geo.p1 : geo.p2;
      const side = obj.flipSide ? -1 : 1;
      const leafEnd = { x: hinge.x + geo.normal.x * obj.width * side, y: hinge.y + geo.normal.y * obj.width * side };
      g.appendChild(el('line', {
        x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y,
        class: 'door-leaf', 'data-object': obj.id, 'stroke-width': 1.5 / s,
      }));
      g.appendChild(el('path', {
        d: quarterArcPath(hinge, leafEnd, other, obj.width),
        class: 'door-arc', 'data-object': obj.id, 'stroke-width': 1 / s,
      }));
    }
  } else if (obj.kind === 'window') {
    const half = geo.wall.thickness / 2;
    const n = geo.normal;
    const c1 = { x: geo.p1.x + n.x * half, y: geo.p1.y + n.y * half };
    const c2 = { x: geo.p2.x + n.x * half, y: geo.p2.y + n.y * half };
    const c3 = { x: geo.p2.x - n.x * half, y: geo.p2.y - n.y * half };
    const c4 = { x: geo.p1.x - n.x * half, y: geo.p1.y - n.y * half };
    g.appendChild(el('path', {
      d: `M ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} L ${c4.x} ${c4.y} Z`,
      class: 'window-fill', 'data-object': obj.id, 'stroke-width': 1.5 / s,
    }));

    const side = obj.flipSide ? -1 : 1;
    if (obj.sashCount === 2) {
      const mA = { x: geo.center.x + n.x * half, y: geo.center.y + n.y * half };
      const mB = { x: geo.center.x - n.x * half, y: geo.center.y - n.y * half };
      g.appendChild(el('line', {
        x1: mA.x, y1: mA.y, x2: mB.x, y2: mB.y,
        class: 'window-mullion', 'data-object': obj.id, 'stroke-width': 1.5 / s,
      }));
      g.appendChild(el('path', {
        d: sashDiagonal(geo.p1, geo.center, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
      g.appendChild(el('path', {
        d: sashDiagonal(geo.center, geo.p2, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
    } else {
      g.appendChild(el('path', {
        d: sashDiagonal(geo.p1, geo.p2, n, half, side),
        class: 'window-sash', 'data-object': obj.id, 'stroke-width': 1.2 / s,
      }));
    }
  }
  return g;
}

// egy ablakszárny nyitás-irányát jelző átló: a "zsanér" sarokból (pStart, a
// `side` felőli falsíkon) a szemközti sarokba (pEnd, a másik falsíkon)
function sashDiagonal(pStart, pEnd, n, half, side) {
  const hinge = { x: pStart.x - n.x * half * side, y: pStart.y - n.y * half * side };
  const tip = { x: pEnd.x + n.x * half * side, y: pEnd.y + n.y * half * side };
  return `M ${hinge.x} ${hinge.y} L ${tip.x} ${tip.y}`;
}

// negyedköríves útvonal `from`-ból `to`-ba, `center` körül, a rövidebb (90°-os) irányban
function quarterArcPath(center, from, to, radius) {
  const cross = (from.x - center.x) * (to.y - center.y) - (from.y - center.y) * (to.x - center.x);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${sweep} ${to.x} ${to.y}`;
}

function handle(x, y, s, kind, idAttrs, square = false) {
  const r = 5 / s;
  const attrs = {
    class: 'handle' + (square ? ' handle-mid' : ''),
    'data-handle': kind, ...idAttrs,
    'stroke-width': 1.5 / s,
  };
  if (square) {
    return el('rect', { ...attrs, x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  }
  return el('circle', { ...attrs, cx: x, cy: y, r });
}

// a falakat láncokra ("run") bontja: minden lánc egy vizuálisan egyenes,
// folytonos falszakasz, akár több (T-elágazásnál szétvágott) fal-objektumból
// összefűzve — így egy ilyen falra egy közös hossz-címke kerül, nem
// szakaszonként egy-egy apró szám
function buildInteriorWallRuns(plan) {
  const visited = new Set();
  const runs = [];
  for (const w of plan.walls) {
    if (visited.has(w.id)) continue;
    visited.add(w.id);
    const walls = [w];
    let nodeIds = [w.a, w.b];

    let curNode = w.a, curWall = w;
    while (true) {
      const partner = throughPartner(plan, curNode, curWall.id);
      if (!partner || visited.has(partner.id)) break;
      visited.add(partner.id);
      curNode = partner.a === curNode ? partner.b : partner.a;
      nodeIds.unshift(curNode);
      walls.unshift(partner);
      curWall = partner;
    }
    curNode = w.b; curWall = w;
    while (true) {
      const partner = throughPartner(plan, curNode, curWall.id);
      if (!partner || visited.has(partner.id)) break;
      visited.add(partner.id);
      curNode = partner.a === curNode ? partner.b : partner.a;
      nodeIds.push(curNode);
      walls.push(partner);
      curWall = partner;
    }
    runs.push({ walls, startId: nodeIds[0], endId: nodeIds[nodeIds.length - 1] });
  }
  return runs;
}

// mint lengthLabel, de több összefűzött (egyenes, azonos vastagságú) fal
// teljes hosszára, a lánc egészének közepén
function wallRunLengthLabel(plan, run, s) {
  const a = nodeById(plan, run.startId), b = nodeById(plan, run.endId);
  const totalLen = run.walls.reduce((sum, w) => sum + wallLengthOf(plan, w), 0);
  const n = G.normal(a, b);
  const mid = G.mid(a, b);
  const off = run.walls[0].thickness / 2 + 10 / s;
  const x = mid.x - n.x * off, y = mid.y - n.y * off;

  let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  const t = el('text', {
    x, y,
    class: 'len-label',
    'font-size': 12 / s,
    'stroke-width': 3 / s,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    transform: `rotate(${deg} ${x} ${y})`,
  });
  t.textContent = `${Math.round(totalLen)} cm`;
  return t;
}

// a fal hossz-címkéje: a fal közepén, a falra fektetve, kis eltartással
// (csak azokra a falakra, amik NEM szerepelnek a láncolt külső méretezésben)
function lengthLabel(plan, w, a, b, s) {
  const len = wallLengthOf(plan, w);
  const n = G.normal(a, b);
  const bulge = w.bulge || 0;
  // ívnél a domború oldalra, egyenesnél a normál oldalra kerül a felirat
  const side = bulge ? Math.sign(bulge) : -1;
  const base = bulge ? G.arcMidpoint(a, b, bulge) : G.mid(a, b);
  const off = w.thickness / 2 + 10 / s;
  const x = base.x + n.x * off * side;
  const y = base.y + n.y * off * side;

  let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  const t = el('text', {
    x, y,
    class: 'len-label',
    'data-wall': w.id,
    'font-size': 12 / s,
    'stroke-width': 3 / s,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    transform: `rotate(${deg} ${x} ${y})`,
  });
  t.textContent = `${Math.round(len)} cm`;
  return t;
}

// --- láncolt külső méretvonalak ---

const DIM_OFF_1 = 45; // cm – szakaszonkénti méretvonal távolsága a fal külső síkjától
const DIM_OFF_2 = 85; // cm – a teljes-hosszt mutató (külső) méretvonal távolsága
const DIM_EXT = 8;    // cm – a kivezető vonal ennyivel nyúlik túl a méretvonalon
const DIM_TICK = 5;   // cm – a pipuk mérete

function renderDimensionChain(overlay, chain, s) {
  const hasMultiple = chain.points.length > 2;
  const farOffset = hasMultiple ? DIM_OFF_2 : DIM_OFF_1;

  // kivezető vonalak minden töréspontból
  for (const pt of chain.points) {
    const far = { x: pt.x + chain.normal.x * (farOffset + DIM_EXT), y: pt.y + chain.normal.y * (farOffset + DIM_EXT) };
    overlay.appendChild(el('line', {
      x1: pt.x, y1: pt.y, x2: far.x, y2: far.y, class: 'dim-ext', 'stroke-width': 0.8 / s,
    }));
  }

  renderDimLine(overlay, chain, DIM_OFF_1, chain.points, s, false);
  if (hasMultiple) {
    renderDimLine(overlay, chain, DIM_OFF_2, [chain.points[0], chain.points[chain.points.length - 1]], s, true);
  }
}

function renderDimLine(overlay, chain, offset, points, s, isTotal) {
  const off = p => ({ x: p.x + chain.normal.x * offset, y: p.y + chain.normal.y * offset });
  const p0 = off(points[0]), pN = off(points[points.length - 1]);

  overlay.appendChild(el('line', {
    x1: p0.x, y1: p0.y, x2: pN.x, y2: pN.y, class: 'dim-line', 'stroke-width': 1 / s,
  }));

  // 45°-os pipuk minden ponton (a fal iránya és a kifelé mutató normál átlója mentén)
  const tx = chain.dir.x - chain.normal.x, ty = chain.dir.y - chain.normal.y;
  const tn = Math.hypot(tx, ty) || 1;
  const tick = DIM_TICK / s;
  for (const p of points) {
    const dp = off(p);
    overlay.appendChild(el('line', {
      x1: dp.x - tx / tn * tick, y1: dp.y - ty / tn * tick,
      x2: dp.x + tx / tn * tick, y2: dp.y + ty / tn * tick,
      class: 'dim-tick', 'stroke-width': 1.2 / s,
    }));
  }

  let deg = Math.atan2(chain.dir.y, chain.dir.x) * 180 / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;

  for (let i = 0; i < points.length - 1; i++) {
    const a = off(points[i]), b = off(points[i + 1]);
    const mid = G.mid(a, b);
    const segLen = Math.round(isTotal ? chain.len : points[i + 1].t - points[i].t);
    const t = el('text', {
      x: mid.x, y: mid.y,
      class: isTotal ? 'dim-label dim-label-total' : 'dim-label',
      'font-size': (isTotal ? 11 : 10) / s,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      transform: `rotate(${deg} ${mid.x} ${mid.y})`,
    });
    t.textContent = `${segLen} cm`;
    overlay.appendChild(t);
  }
}

// helyiség-címke: név + terület, a súlypontra középre igazítva
function roomLabel(room, trace, s) {
  const g = el('g', { class: 'room-label' });

  const name = el('text', {
    x: trace.centroid.x, y: trace.centroid.y - 8 / s,
    class: 'room-name', 'data-room': room.id,
    'font-size': 13 / s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
  });
  name.textContent = room.name;

  const area = el('text', {
    x: trace.centroid.x, y: trace.centroid.y + 9 / s,
    class: 'room-area', 'data-room': room.id,
    'font-size': 11 / s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
  });
  area.textContent = `${trace.areaM2.toFixed(1)} m²`;

  g.append(name, area);
  return g;
}
