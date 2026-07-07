// SVG rajzvászon: rács, pan, zoom (görgő), koordináta-kijelzés.
// A nézetet a viewBox kezeli; a világkoordináta cm-ben értendő.
// Az egér-interakciókat (rajzolás, kijelölés, pan indítása) a tools.js vezérli,
// ide csak a nézet-kezelés tartozik.

import { GRID_MINOR, GRID_MAJOR, ZOOM_MIN, ZOOM_MAX, INITIAL_VIEW_WIDTH, SVG_NS } from './config.js';

let svg, gridRect, minorPath, majorPath, originGroup, contentGroup, overlayGroup;
let coordsEl, zoomEl;
const viewListeners = [];

// viewBox: {x, y, w, h} világ-cm-ben
const vb = { x: 0, y: 0, w: INITIAL_VIEW_WIDTH, h: INITIAL_VIEW_WIDTH * 0.6 };

export function initCanvas() {
  svg = document.getElementById('canvas');
  coordsEl = document.getElementById('coords');
  zoomEl = document.getElementById('zoom-label');

  buildGrid();
  buildOrigin();

  contentGroup = el('g', { id: 'content' });
  overlayGroup = el('g', { id: 'overlay' });
  svg.appendChild(contentGroup);
  svg.appendChild(overlayGroup);

  // induló nézet: origó a bal felső harmadban
  vb.x = -200;
  vb.y = -150;
  fitAspect();
  applyViewBox();

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', () => { fitAspect(); applyViewBox(); });
}

export function getSvg() { return svg; }
export function getContent() { return contentGroup; }
export function getOverlay() { return overlayGroup; }

// px/cm arány – a zoom-kijelzés és a vonalvastagság-korrekció alapja. Sosem ad
// vissza 0-t/NaN-t/Infinity-t (pl. ha a vászonnak pillanatnyilag nincs mérhető
// szélessége) — az egész rajz sok helyen oszt ezzel, egy rossz érték az összes
// koordinátát tartósan elrontaná
export function getScale() {
  const s = svg.clientWidth / vb.w;
  return Number.isFinite(s) && s > 0 ? s : ZOOM_MIN;
}

export function onViewChange(fn) { viewListeners.push(fn); }

export function clientToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  // ha a vászonnak pillanatnyilag nincs mérhető kiterjedése (pl. az elrendezés
  // épp újraszámolódik), 0-val osztanánk — inkább a vb középpontját adjuk vissza,
  // mint hogy NaN/Infinity kerüljön a (tartósan tárolt) nézet-állapotba
  if (!rect.width || !rect.height) return { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
  return {
    x: vb.x + (clientX - rect.left) / rect.width * vb.w,
    y: vb.y + (clientY - rect.top) / rect.height * vb.h,
  };
}

// a nézetet a megadott világ-koordinátás téglalapra igazítja (nyújtás nélkül,
// a vászon arányához illesztve), kis ráhagyással minden oldalon
export function fitToBounds(minX, minY, maxX, maxY) {
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const margin = Math.max(w, h) * 0.08 + 40;
  let bw = w + margin * 2, bh = h + margin * 2;

  const rect = svg.getBoundingClientRect();
  const aspect = (rect.width && rect.height) ? rect.width / rect.height : 1;
  if (bw / bh > aspect) bh = bw / aspect; else bw = bh * aspect;

  vb.x = (minX + maxX) / 2 - bw / 2;
  vb.y = (minY + maxY) / 2 - bh / 2;
  vb.w = bw;
  vb.h = bh;
  applyViewBox();
}

// pan indítása (a tools.js hívja, amikor a helyzet pan-t kíván)
export function beginPan(e) {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return; // lásd clientToWorld megjegyzését
  svg.classList.add('panning');
  const start = { x: e.clientX, y: e.clientY, vbx: vb.x, vby: vb.y };

  function move(ev) {
    vb.x = start.vbx - (ev.clientX - start.x) / rect.width * vb.w;
    vb.y = start.vby - (ev.clientY - start.y) / rect.height * vb.h;
    applyViewBox();
  }
  function up() {
    svg.classList.remove('panning');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// a jobb oldali panel átméretezésekor (nem window-resize, azt a saját
// listener már lekezeli) ezt kell hívni, hogy a vászon ne torzuljon
export function refreshViewport() {
  fitAspect();
  applyViewBox();
}

function fitAspect() {
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0) vb.h = vb.w * rect.height / rect.width;
}

function applyViewBox() {
  // önjavítás: ha a nézet-állapot (pl. egy pillanatnyilag 0 méretű vászon
  // miatti nullával/érvénytelen értékkel osztás következtében) valahogy
  // mégis érvénytelenné válna, inkább egy ép alapállapotra állunk vissza,
  // mint hogy a hiba minden további újrarajzolásnál megismétlődjön
  if (![vb.x, vb.y, vb.w, vb.h].every(Number.isFinite) || vb.w <= 0 || vb.h <= 0) {
    console.warn('Érvénytelen nézet-állapot, visszaállítás alapértelmezettre.');
    vb.x = -200; vb.y = -150; vb.w = INITIAL_VIEW_WIDTH; vb.h = INITIAL_VIEW_WIDTH * 0.6;
  }

  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

  // a rács-téglalap mindig fedje a látható területet
  gridRect.setAttribute('x', vb.x);
  gridRect.setAttribute('y', vb.y);
  gridRect.setAttribute('width', vb.w);
  gridRect.setAttribute('height', vb.h);

  // a rácsvonalak képernyőn kb. 1 px vastagok maradjanak
  const s = getScale();
  minorPath.setAttribute('stroke-width', Math.min(0.75 / s, GRID_MINOR / 4));
  majorPath.setAttribute('stroke-width', Math.min(1.25 / s, GRID_MAJOR / 40));
  originGroup.setAttribute('stroke-width', 1.5 / s);

  zoomEl.textContent = `${Math.round(s * 100)}%`;
  for (const fn of viewListeners) fn();
}

function buildGrid() {
  const defs = el('defs');

  const minor = el('pattern', {
    id: 'grid-minor', width: GRID_MINOR, height: GRID_MINOR, patternUnits: 'userSpaceOnUse',
  });
  minorPath = el('path', {
    d: `M ${GRID_MINOR} 0 L 0 0 0 ${GRID_MINOR}`, fill: 'none', stroke: '#d5d9dd',
  });
  minor.appendChild(minorPath);

  const major = el('pattern', {
    id: 'grid-major', width: GRID_MAJOR, height: GRID_MAJOR, patternUnits: 'userSpaceOnUse',
  });
  const majorFill = el('rect', {
    width: GRID_MAJOR, height: GRID_MAJOR, fill: 'url(#grid-minor)',
  });
  majorPath = el('path', {
    d: `M ${GRID_MAJOR} 0 L 0 0 0 ${GRID_MAJOR}`, fill: 'none', stroke: '#b8bec5',
  });
  major.appendChild(majorFill);
  major.appendChild(majorPath);

  // fal-sraffozás: 45°-os átlós vonalkázás, ahogy egy építészeti tervrajzon
  const hatch = el('pattern', {
    id: 'wall-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  hatch.appendChild(el('rect', { width: 6, height: 6, fill: '#ffffff' }));
  hatch.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#1a1a1a', 'stroke-width': 1.3 }));
  defs.appendChild(hatch);

  defs.appendChild(minor);
  defs.appendChild(major);
  svg.appendChild(defs);

  gridRect = el('rect', { fill: 'url(#grid-major)' });
  svg.appendChild(gridRect);
}

function buildOrigin() {
  // kis kereszt az origónál, hogy legyen viszonyítási pont
  originGroup = el('g', { stroke: '#8a94a0', 'stroke-linecap': 'round' });
  originGroup.appendChild(el('line', { x1: -20, y1: 0, x2: 20, y2: 0 }));
  originGroup.appendChild(el('line', { x1: 0, y1: -20, x2: 0, y2: 20 }));
  svg.appendChild(originGroup);
}

function onWheel(e) {
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return; // lásd clientToWorld megjegyzését
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newScale = getScale() * factor;
  // a Number.isFinite check azért kell, mert egy NaN newScale (pl. ha getScale()
  // már korábban elromlott) egyik "< MIN"/"> MAX" feltételt sem teljesítené,
  // tehát a korábbi kód átengedte volna — ez véglegesen elrontotta a vb-t
  if (!Number.isFinite(newScale) || newScale < ZOOM_MIN || newScale > ZOOM_MAX) return;

  // a kurzor alatti világpont maradjon helyben
  const p = clientToWorld(e.clientX, e.clientY);
  vb.w /= factor;
  vb.h /= factor;
  vb.x = p.x - (e.clientX - rect.left) / rect.width * vb.w;
  vb.y = p.y - (e.clientY - rect.top) / rect.height * vb.h;
  applyViewBox();
}

function onMouseMove(e) {
  const p = clientToWorld(e.clientX, e.clientY);
  coordsEl.textContent = `x: ${Math.round(p.x)} cm · y: ${Math.round(p.y)} cm`;
}

export function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
