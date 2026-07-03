// Az aktív szint rajzának megjelenítése: falak, csomópont-foltok,
// élhossz-címkék, kijelölés és fogantyúk. Minden változáskor (állapot,
// nézet, eszköz) teljes újrarajzolás.

import { el, getContent, getOverlay, getScale } from './canvas.js';
import { getPlan, nodeById, nodeDegrees, wallLengthOf } from './plan.js';
import * as G from './geometry.js';
import { ui } from './uistate.js';

export function renderAll() {
  const content = getContent();
  const overlay = getOverlay();
  content.innerHTML = '';
  overlay.innerHTML = '';

  const plan = getPlan();
  if (!plan) return;
  const s = getScale();

  // fal-testek + kattintható (láthatatlan, széles) találati sávok
  for (const w of plan.walls) {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const d = G.wallPathD(a, b, w.bulge || 0);
    content.appendChild(el('path', { d, class: 'wall-body', 'stroke-width': w.thickness }));
    content.appendChild(el('path', {
      d, class: 'wall-hit', 'stroke-width': Math.max(w.thickness + 12 / s, 16 / s),
      'data-wall': w.id,
    }));
  }

  // csomópont-foltok: ahol több fal találkozik, a sarok kitöltése
  const deg = nodeDegrees(plan);
  for (const n of plan.nodes) {
    if ((deg.get(n.id) || 0) < 2) continue;
    const maxT = Math.max(...plan.walls.filter(w => w.a === n.id || w.b === n.id).map(w => w.thickness));
    content.appendChild(el('circle', { cx: n.x, cy: n.y, r: maxT / 2, class: 'wall-joint' }));
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
      overlay.appendChild(handle(a.x, a.y, s, 'a', sel.id));
      overlay.appendChild(handle(b.x, b.y, s, 'b', sel.id));
      overlay.appendChild(handle(m.x, m.y, s, 'mid', sel.id, true));
    }
  }

  // élhossz-címkék (mindig láthatók)
  for (const w of plan.walls) {
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    overlay.appendChild(lengthLabel(plan, w, a, b, s));
  }
}

function handle(x, y, s, kind, wallId, square = false) {
  const r = 5 / s;
  const attrs = {
    class: 'handle' + (square ? ' handle-mid' : ''),
    'data-handle': kind, 'data-wall': wallId,
    'stroke-width': 1.5 / s,
  };
  if (square) {
    return el('rect', { ...attrs, x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  }
  return el('circle', { ...attrs, cx: x, cy: y, r });
}

// a fal hossz-címkéje: a fal közepén, a falra fektetve, kis eltartással
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
