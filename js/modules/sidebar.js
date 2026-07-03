// Oldalsáv: Ingatlan-panel (ingatlanok + szintek fája), Mentés-panel gombjai,
// és a fejléc címének frissítése.

import * as S from './state.js';
import { withHistory } from './history.js';

let listEl, titleEl;
const collapsed = new Set(); // összecsukott ingatlanok id-jai

export function initSidebar() {
  listEl = document.getElementById('property-list');
  titleEl = document.getElementById('property-title');

  document.getElementById('add-property').addEventListener('click', () => {
    const p = withHistory(() => S.addProperty());
    startRename(`.property[data-id="${p.id}"] > .row > .name`,
      name => withHistory(() => S.renameProperty(p.id, name)));
  });

  S.onChange(render);
}

function render(state) {
  const prop = S.activeProperty();
  const level = S.activeLevel();
  titleEl.textContent = prop && level ? `${prop.name} · ${level.name}` : '– nincs ingatlan –';
  titleEl.classList.toggle('muted', !prop);

  listEl.innerHTML = '';
  for (const p of state.properties) listEl.appendChild(renderProperty(p, state));
}

function renderProperty(p, state) {
  const isActive = p.id === state.active.propertyId;
  const isOpen = !collapsed.has(p.id);

  const box = div('property');
  box.dataset.id = p.id;

  const row = div('row' + (isActive ? ' active' : ''));

  const caret = span('caret', isOpen ? '▾' : '▸');
  caret.title = isOpen ? 'Összecsukás' : 'Lenyitás';
  caret.addEventListener('click', e => {
    e.stopPropagation();
    isOpen ? collapsed.add(p.id) : collapsed.delete(p.id);
    render(S.getState());
  });

  const name = span('name', p.name);
  name.title = 'Dupla kattintás: átnevezés';
  name.addEventListener('dblclick', e => {
    e.stopPropagation();
    editInPlace(name, p.name, v => withHistory(() => S.renameProperty(p.id, v)));
  });

  row.addEventListener('click', () => S.selectProperty(p.id));

  const actions = span('actions', '');
  actions.appendChild(actionBtn('＋', 'Új szint', () => {
    collapsed.delete(p.id);
    const l = withHistory(() => S.addLevel(p.id));
    startRename(`.level[data-id="${l.id}"] .name`,
      v => withHistory(() => S.renameLevel(p.id, l.id, v)));
  }));
  actions.appendChild(actionBtn('✎', 'Átnevezés', () =>
    editInPlace(name, p.name, v => withHistory(() => S.renameProperty(p.id, v)))));
  actions.appendChild(actionBtn('×', 'Ingatlan törlése', () => {
    if (S.getState().properties.length <= 1) { alert('Az utolsó ingatlan nem törölhető.'); return; }
    if (confirm(`Törlöd a(z) „${p.name}” ingatlant minden szintjével együtt?`)) withHistory(() => S.deleteProperty(p.id));
  }));

  row.append(caret, name, actions);
  box.appendChild(row);

  if (isOpen) {
    const ul = document.createElement('ul');
    ul.className = 'levels';
    p.levels.forEach((l, i) => ul.appendChild(renderLevel(p, l, i, state)));
    box.appendChild(ul);
  }
  return box;
}

function renderLevel(p, l, index, state) {
  const li = document.createElement('li');
  li.className = 'level' + (l.id === state.active.levelId && p.id === state.active.propertyId ? ' active' : '');
  li.dataset.id = l.id;

  const name = span('name', l.name);
  name.title = 'Dupla kattintás: átnevezés';
  name.addEventListener('dblclick', e => {
    e.stopPropagation();
    editInPlace(name, l.name, v => withHistory(() => S.renameLevel(p.id, l.id, v)));
  });

  li.addEventListener('click', () => S.setActiveLevel(p.id, l.id));

  const actions = span('actions', '');
  actions.appendChild(actionBtn('▲', 'Feljebb', () => withHistory(() => S.moveLevel(p.id, l.id, -1)), index === 0));
  actions.appendChild(actionBtn('▼', 'Lejjebb', () => withHistory(() => S.moveLevel(p.id, l.id, 1)), index === p.levels.length - 1));
  actions.appendChild(actionBtn('✎', 'Átnevezés', () =>
    editInPlace(name, l.name, v => withHistory(() => S.renameLevel(p.id, l.id, v)))));
  actions.appendChild(actionBtn('×', 'Szint törlése', () => {
    if (p.levels.length <= 1) { alert('Az utolsó szint nem törölhető.'); return; }
    if (confirm(`Törlöd a(z) „${l.name}” szintet a rajzával együtt?`)) withHistory(() => S.deleteLevel(p.id, l.id));
  }));

  li.append(name, actions);
  return li;
}

// --- Névszerkesztés a helyén ---

function editInPlace(nameEl, current, apply) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename';
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (commit && v && v !== current) apply(v);
    else S.notify(); // visszarajzolás az eredeti névvel
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('dblclick', e => e.stopPropagation());
}

// Frissen létrehozott elem átnevezésének indítása (a render már lefutott).
function startRename(selector, apply) {
  const el = listEl.querySelector(selector);
  if (el) editInPlace(el, el.textContent, apply);
}

// --- Apró DOM-segédek ---

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function actionBtn(label, title, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}
