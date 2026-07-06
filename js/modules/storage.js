// Tárolás: automatikus mentés localStorage-ba, JSON export/import fájlba.
// Az export az aktív ingatlant menti; az import hozzáadja (azonos id esetén
// rákérdezve felülírja), és a régi, teljes-állapot formátumot is elfogadja.

import { getState, setState, initialState, onChange, activeProperty, normalizeActive, notify } from './state.js';
import { snapshot, checkpoint } from './history.js';
import { repairAllPlans, repairPropertyPlans } from './wallrepair.js';

const KEY = 'floorplan.v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (isFullState(data)) { repairAllPlans(data); setState(data); return; }
    }
  } catch (e) {
    console.warn('A mentett adat nem olvasható, új állapot indul.', e);
  }
  setState(initialState());
}

let saveTimer = null;

export function initAutosave() {
  // húzás közben minden egérmozdulat változást jelez — a mentést késleltetjük
  onChange(state => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.error('A mentés nem sikerült (localStorage).', e);
      }
    }, 300);
  });
}

function isFullState(data) {
  return data && data.version === 1 && Array.isArray(data.properties);
}

function isProperty(p) {
  return p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.levels);
}

export function exportJson() {
  const prop = activeProperty();
  if (!prop) return;
  const data = { version: 1, type: 'property', property: prop };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const safeName = prop.name.replace(/[\\/:*?"<>|]/g, '-').trim();

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName} - alaprajz - ${date}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      alert('A fájl nem érvényes JSON.');
      return;
    }

    let incoming;
    if (data && data.type === 'property' && isProperty(data.property)) {
      incoming = [data.property];
    } else if (isFullState(data) && data.properties.every(isProperty)) {
      incoming = data.properties;
    } else {
      alert('A fájl nem alaprajz-mentés (hiányzó vagy ismeretlen formátum).');
      return;
    }

    const before = snapshot();
    const state = getState();
    let lastImported = null;
    for (const p of incoming) {
      repairPropertyPlans(p);
      const i = state.properties.findIndex(q => q.id === p.id);
      if (i >= 0) {
        if (!confirm(`A(z) „${state.properties[i].name}” ingatlan már létezik. Felülírjam a fájlban lévővel („${p.name}”)? A Mégse kihagyja.`)) continue;
        state.properties[i] = p;
      } else {
        state.properties.push(p);
      }
      lastImported = p;
    }

    if (!lastImported) return;
    state.active = { propertyId: lastImported.id, levelId: lastImported.levels[0]?.id };
    normalizeActive();
    notify();
    checkpoint(before);
  };
  reader.readAsText(file);
}
