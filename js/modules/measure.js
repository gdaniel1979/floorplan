// Mérés eszköz: lenyomott bal gombbal húzott egyenes, elengedéskor a hossza
// cm-ben. A mérés a következő mérésig / eszközváltásig / Esc-ig látszik.
//
// Hogy egy falszakasz pontosan lemérhető legyen, a végpontok a falak VALÓDI
// sarkaira és síkjaira tapadnak (a sraffozott fal-alak kontúrjára, nem a
// tengelyre), illetve a fal-csomópontokra; ha egyik sincs közel, a vízszintes /
// függőleges irányra. Shift: tapadás nélkül, pontosan a kurzorhoz.

import { el, getOverlay, getScale } from './canvas.js';
import { exteriorSilhouette, wallShapeHoles } from './exterior.js';
import { round1 } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';

const SNAP_PX = 12;    // ennyi képernyő-pixelen belül tapad
const AXIS_DEG = 4;    // ennyi foknál kisebb eltérésnél vízszintesre/függőlegesre egyenesít

// a fal-alak kontúrjai: a külső sziluett + a falak által körülzárt foltok
function outlines(plan) {
  const polys = [];
  const outer = exteriorSilhouette(plan);
  if (outer) polys.push(outer);
  for (const h of wallShapeHoles(plan)) polys.push(h);
  return polys;
}

// a p-hez legközelebbi tapadási pont: { x, y, kind: 'corner'|'face'|'axis'|null }
// `from`: a mérés kezdőpontja (a végpont tengelyre egyenesítéséhez)
export function measureSnap(plan, p, from = null, free = false) {
  if (free) return { x: p.x, y: p.y, kind: null };
  const tol = SNAP_PX / getScale();
  const polys = outlines(plan);

  // 1. sarok: kontúr-csúcs vagy fal-csomópont
  let best = null, bestD = tol;
  const tryCorner = q => {
    const d = G.dist(p, q);
    if (d <= bestD) { bestD = d; best = { x: q.x, y: q.y, kind: 'corner' }; }
  };
  for (const poly of polys) for (const q of poly) tryCorner(q);
  for (const n of plan.nodes) tryCorner(n);
  if (best) return best;

  // 2. falsík: a kontúr legközelebbi éle (a tengelyre egyenesített pontot
  // vetítjük rá, így a vízszintes mérés vége is pontosan a falsíkra kerül)
  const q0 = from ? axisLock(from, p) : p;
  bestD = tol;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const q = closestOnSegment(q0, a, b);
      const d = G.dist(q0, q);
      if (d <= bestD) { bestD = d; best = { x: q.x, y: q.y, kind: 'face' }; }
    }
  }
  if (best) return best;

  // 3. vízszintes / függőleges irány a kezdőponthoz képest
  if (from && (q0.x !== p.x || q0.y !== p.y)) return { x: q0.x, y: q0.y, kind: 'axis' };
  return { x: round1(p.x), y: round1(p.y), kind: null };
}

function axisLock(from, p) {
  const dx = p.x - from.x, dy = p.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return p;
  const deg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  if (deg < AXIS_DEG || deg > 180 - AXIS_DEG) return { x: p.x, y: from.y };
  if (Math.abs(deg - 90) < AXIS_DEG) return { x: from.x, y: p.y };
  return p;
}

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function formatCm(cm) {
  const v = Math.round(cm * 10) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + ' cm';
}

// a tapadási jelzés a kurzor alatt (mozgás közben, újrarajzolás nélkül)
let hoverEl = null;
export function showMeasureHover(pt) {
  const overlay = getOverlay();
  if (!pt || !pt.kind) { hoverEl?.remove(); return; }
  const s = getScale();
  if (!hoverEl) hoverEl = el('circle', { class: 'snap-hint' });
  hoverEl.setAttribute('cx', pt.x);
  hoverEl.setAttribute('cy', pt.y);
  hoverEl.setAttribute('r', 7 / s);
  hoverEl.setAttribute('stroke-width', 2 / s);
  if (hoverEl.parentNode !== overlay) overlay.appendChild(hoverEl);
}

// a mérés rajza: vonal, végpont-pipák és a hossz felirata a vonal fölött
export function renderMeasure(overlay, s) {
  const m = ui.measure;
  if (!m || ui.tool !== 'measure') return;
  const { a, b } = m;
  const len = G.dist(a, b);
  const g = el('g', { class: 'measure' });
  g.appendChild(el('line', {
    x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'measure-line', 'stroke-width': 1.5 / s,
  }));
  if (len > 1e-6) {
    const n = G.normal(a, b);
    const tick = 7 / s;
    for (const p of [a, b]) {
      g.appendChild(el('line', {
        x1: p.x - n.x * tick, y1: p.y - n.y * tick, x2: p.x + n.x * tick, y2: p.y + n.y * tick,
        class: 'measure-line', 'stroke-width': 1.5 / s,
      }));
    }
    let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (deg > 90 || deg <= -90) deg += 180;
    const mid = G.mid(a, b);
    // a felirat a vonal FÖLÖTT (a képernyőn felfelé eső oldalán) üljön
    const up = (deg === Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) ? -1 : 1;
    const off = 12 / s;
    const tp = { x: mid.x + n.x * off * up, y: mid.y + n.y * off * up };
    const t = el('text', {
      x: tp.x, y: tp.y, class: 'measure-label', 'font-size': 13 / s,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      transform: `rotate(${deg} ${tp.x} ${tp.y})`,
    });
    t.textContent = formatCm(len);
    g.appendChild(t);
  }
  overlay.appendChild(g);
}
