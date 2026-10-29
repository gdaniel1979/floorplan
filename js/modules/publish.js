// Mentés a My Life-ba: az aktív ingatlan minden megrajzolt szintjét vektoros SVG-ként (puszta alaprajz + berendezett)
// és a teljes ingatlant JSON-ként elküldi a szerverre (POST publish/ → a My Life fogadója: my_life/sync/floorplan_publish.py).
// A My Life Otthon › Alaprajz oldala ezeket mutatja, a szerver pedig minden mentésnél biztonsági másolatot tesz el a JSON-ról.
//
// A kérés a My Life belépési sütijével megy (ugyanaz a domain): ha ebben a böngészőben nincs belépés a My Life-ba, a
// szerver elutasítja (401). A rajzolás ugyanaz, mint a PDF-exportnál (pdfexport.js): rögzített lépték, a rajz köré keret,
// rács és origó nélkül; a stíluslapból a világos színek és az SVG-rajz szabályai kerülnek a fájlba.

import { getSvg, getViewBox, setViewBox, setScaleOverride } from './canvas.js';
import { getPlan } from './plan.js';
import { renderAll } from './render.js';
import { ui } from './uistate.js';
import { activeProperty, getState, setActiveLevel } from './state.js';
import { showToast } from './toast.js';

const MARGIN = 150;     // cm – a külső méretlánc is kiférjen
const PX_W = 1100;      // a feliratok ekkora szélességű megjelenítésnél lesznek 11 px-esek
const LABELS = { dimChains: true, wallLengths: true, openingSizes: true, roomName: true, roomArea: true, roomHeight: true };
const VIEWS = {
  alap: { szaniter: false, konyha: false, butor: false, epulet: true, furnitureLabels: false },
  berendezve: { szaniter: true, konyha: true, butor: true, epulet: true, furnitureLabels: true },
};

let busy = false;

export async function publishToMyLife() {
  if (busy) return;
  const prop = activeProperty();
  const levels = (prop?.levels || []).filter(l => l.plan?.nodes?.length);
  if (!levels.length) {
    showToast('Nincs mit menteni — előbb rajzolj falakat.');
    return;
  }
  busy = true;
  showToast('Mentés a My Life-ba…');
  let payload;
  try {
    payload = { property: prop, levels: await renderLevels(prop, levels) };
  } catch (e) {
    console.error(e);
    showToast('A rajzok előállítása nem sikerült.');
    busy = false;
    return;
  }
  try {
    const res = await fetch(new URL('publish/', document.baseURI), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(`Elmentve a My Life-ba: ${levels.map(l => l.name).join(', ')}.`);
    } else if (res.status === 401) {
      showToast('Előbb lépj be a My Life-ba ebben a böngészőben, aztán próbáld újra.');
    } else {
      showToast(`A mentés nem sikerült: ${body.error || res.status}`);
    }
  } catch (e) {
    console.error(e);
    showToast('A My Life nem érhető el — próbáld újra később.');
  } finally {
    busy = false;
  }
}

// Szintenként kirajzolja a két nézetet; a végén minden (aktív szint, nézet, rétegek, kijelölés) visszaáll.
async function renderLevels(prop, levels) {
  const style = await drawingStyle();
  const state = getState();
  const saved = {
    levelId: state.active.levelId, view: getViewBox(), layers: { ...ui.layerVisible },
    sel: [ui.selectedWallId, ui.selectedRoomId, ui.selectedObjectId, ui.selectedFurnitureId],
  };
  ui.selectedWallId = ui.selectedRoomId = ui.selectedObjectId = ui.selectedFurnitureId = null;
  const out = [];
  try {
    for (const level of levels) {
      setActiveLevel(prop.id, level.id);
      const view = frame(getPlan());
      const svgs = {};
      for (const [name, layers] of Object.entries(VIEWS)) {
        Object.assign(ui.layerVisible, LABELS, layers);
        setScaleOverride(PX_W / view.w);
        setViewBox(view);
        renderAll();
        svgs[name] = serialize(getSvg(), view, style);
      }
      out.push({ id: level.id, name: level.name, svgs });
    }
  } finally {
    setScaleOverride(null);
    ui.layerVisible = saved.layers;
    [ui.selectedWallId, ui.selectedRoomId, ui.selectedObjectId, ui.selectedFurnitureId] = saved.sel;
    setActiveLevel(prop.id, saved.levelId);
    setViewBox(saved.view);
    renderAll();
  }
  return out;
}

function frame(plan) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of plan.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  return { x: minX - MARGIN, y: minY - MARGIN, w: maxX - minX + 2 * MARGIN, h: maxY - minY + 2 * MARGIN };
}

function serialize(svg, view, style) {
  const clone = svg.cloneNode(true);
  clone.removeAttribute('id'); clone.removeAttribute('class'); clone.removeAttribute('style');
  clone.querySelector('#grid-rect')?.remove();
  clone.querySelector('#origin-cross')?.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  clone.setAttribute('width', PX_W);
  clone.setAttribute('height', Math.round(PX_W * view.h / view.w));
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  st.textContent = style;
  clone.insertBefore(st, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

// A stíluslapból a világos téma színei (:root) és az SVG-rajz szabályai — a rajz így önállóan is ugyanúgy néz ki.
async function drawingStyle() {
  const css = (await fetch(new URL('css/style.css', document.baseURI)).then(r => r.text())).split('\n');
  const rootStart = css.findIndex(l => l.startsWith(':root {'));
  const rootEnd = css.findIndex((l, i) => i > rootStart && l.startsWith('}'));
  const drawStart = css.findIndex(l => l.includes('Falak és szerkesztő-elemek az SVG-ben'));
  return css.slice(rootStart, rootEnd + 1).join('\n') + '\n' + css.slice(drawStart).join('\n');
}
