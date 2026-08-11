// PDF-export: a rajzot egy nyomtatási ablakba tesszük ki, ahol a böngésző
// "Nyomtatás → Mentés PDF-be" funkciója írja ki a fájlt. Így az eredmény
// VEKTOROS marad (a méretszámok, feliratok élesek, nagyíthatók), és nincs
// szükség külső PDF-könyvtárra sem — az alkalmazás offline is működik.
//
// Két dolog kell ahhoz, hogy a lap olvasható legyen:
//
//  1. A feliratok és vonalvastagságok a képernyő-léptékből (px/cm) számolódnak,
//     ezért nem elég a mostani nézetet klónozni. Az export idejére a léptéket a
//     PAPÍRHOZ igazítjuk (setScaleOverride), így a szöveg pontosan akkora lesz,
//     ahány mm-t kértek — a rajz méretarányától függetlenül.
//  2. Egy teljes alaprajz minden feliratával együtt egy A4-en olvashatatlanul
//     zsúfolt. Ezért a párbeszéd megengedi, hogy mit vigyünk papírra; a
//     legsűrűbb rétegek (nyílászáró-méretek, belmagasság, falhosszak,
//     bútorfeliratok) alapból KI vannak kapcsolva.

import { getSvg, getViewBox, setViewBox, setScaleOverride } from './canvas.js';
import { getPlan } from './plan.js';
import { renderAll } from './render.js';
import { ui } from './uistate.js';
import { showToast } from './toast.js';

// cm – ennyi levegő maradjon a rajz körül; a külső méretlánc 85 cm-re fut a
// faltól, annak (és a számainak) is ki kell férnie
const MARGIN = 150;

const PAPER = { A4: { w: 297, h: 210 }, A3: { w: 420, h: 297 } }; // fekvő mm
const PAGE_MARGIN = 10;   // mm
const LABEL_FONT = 11;    // a render.js alap betűmérete (px), erre méretezünk

const LAYER_KEYS = ['dimChains', 'wallLengths', 'openingSizes', 'roomName', 'roomArea', 'roomHeight', 'furnitureLabels'];

export function initPdfExport() {
  const dlg = document.getElementById('pdf-dialog');
  document.getElementById('pdf-cancel').addEventListener('click', () => { dlg.hidden = true; });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.hidden = true; });
  document.getElementById('pdf-go').addEventListener('click', () => {
    dlg.hidden = true;
    runExport(readOptions());
  });
}

export function openPdfDialog() {
  const plan = getPlan();
  if (!plan || !plan.nodes.length) {
    showToast('Nincs mit exportálni — előbb rajzolj falakat.');
    return;
  }
  document.getElementById('pdf-dialog').hidden = false;
}

function readOptions() {
  const paper = PAPER[document.getElementById('pdf-paper').value] || PAPER.A4;
  const layers = {};
  for (const key of LAYER_KEYS) {
    const box = document.querySelector(`[data-pdf-layer="${key}"]`);
    layers[key] = !!box?.checked;
  }
  return {
    paper,
    orient: document.getElementById('pdf-orient').value,
    textMm: parseFloat(document.getElementById('pdf-text').value) || 2.6,
    layers,
  };
}

function runExport(opt) {
  const plan = getPlan();
  const svg = getSvg();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of plan.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  const planW = maxX - minX + 2 * MARGIN, planH = maxY - minY + 2 * MARGIN;

  // tájolás: automatikusnál a rajz alakja dönt
  const p = opt.paper;
  const landscape = opt.orient === 'landscape' || (opt.orient === 'auto' && planW >= planH);
  const page = landscape ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
  const useW = page.w - 2 * PAGE_MARGIN, useH = page.h - 2 * PAGE_MARGIN;

  // a nézet a lap oldalarányára igazodik, a rajz köré középre
  const aspect = useW / useH;
  const vbW = Math.max(planW, planH * aspect);
  const vbH = vbW / aspect;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const view = { x: cx - vbW / 2, y: cy - vbH / 2, w: vbW, h: vbH };

  // a papírhoz igazított lépték: a 11 px-es alapbetű pont `textMm` legyen
  const mmPerCm = useW / vbW;
  const scale = LABEL_FONT * mmPerCm / opt.textMm;

  const saved = {
    view: getViewBox(),
    sel: {
      wall: ui.selectedWallId, room: ui.selectedRoomId,
      object: ui.selectedObjectId, furniture: ui.selectedFurnitureId,
    },
    layers: { ...ui.layerVisible },
  };

  ui.selectedWallId = ui.selectedRoomId = ui.selectedObjectId = ui.selectedFurnitureId = null;
  for (const key of LAYER_KEYS) ui.layerVisible[key] = opt.layers[key];
  setScaleOverride(scale);
  setViewBox(view);
  renderAll();
  const clone = svg.cloneNode(true);

  // minden visszaáll: a felhasználó ott folytatja, ahol volt
  setScaleOverride(null);
  ui.layerVisible = saved.layers;
  ui.selectedWallId = saved.sel.wall;
  ui.selectedRoomId = saved.sel.room;
  ui.selectedObjectId = saved.sel.object;
  ui.selectedFurnitureId = saved.sel.furniture;
  setViewBox(saved.view);
  renderAll();

  prepareClone(clone, useW, useH);
  openPrintWindow(clone, page, planTitle());
}

// a klónból kikerül minden, ami csak a szerkesztést segíti
function prepareClone(clone, useW, useH) {
  clone.removeAttribute('id');    // a #canvas elrendezési szabályai ne vonatkozzanak rá
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  clone.querySelector('#grid-rect')?.remove();
  clone.querySelector('#origin-cross')?.remove();
  clone.setAttribute('width', `${useW}mm`);
  clone.setAttribute('height', `${useH}mm`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}

function planTitle() {
  const t = document.getElementById('property-title')?.textContent?.trim();
  return t && !t.startsWith('–') ? t : 'Alaprajz';
}

function openPrintWindow(clone, page, title) {
  const win = window.open('', '_blank');
  if (!win) {
    showToast('A böngésző letiltotta a felugró ablakot — engedélyezd, és próbáld újra.');
    return;
  }

  const css = new URL('css/style.css', document.baseURI).href;
  win.document.write(`<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${css}">
<style>
  @page { size: ${page.w}mm ${page.h}mm; margin: ${PAGE_MARGIN}mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #222; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; }
  svg { display: block; margin: 0 auto; }
  .print-hint { padding: 8px 12px; font-size: 13px; }
  @media print { .print-hint { display: none; } }
</style></head>
<body>
  <p class="print-hint">A nyomtatási ablakban válaszd a „Mentés PDF-ként” célt.</p>
</body></html>`);
  win.document.close();
  // a klón a MI dokumentumunkhoz tartozik — a másik ablakba importálni kell
  win.document.body.appendChild(win.document.importNode(clone, true));

  // A nyomtatás csak a külső stíluslap betöltése után induljon, különben
  // stílus nélküli rajz kerülne a lapra. A `load` esemény már el is sülhetett,
  // mire feliratkozunk, ezért van időzített tartalék — de csak egyszer nyomtatunk.
  let printed = false;
  const print = () => {
    if (printed || !win || win.closed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.addEventListener('load', print);
  setTimeout(print, 1500);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
