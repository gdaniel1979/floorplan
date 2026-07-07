// Alkalmazás-állapot: ingatlanok, szintek, aktív kijelölés.
// Minden módosítás notify()-t hív; a feliratkozók (oldalsáv, mentés) újrarajzolnak/mentenek.

const DEFAULT_LEVELS = ['Kert', 'Földszint', 'Emelet', 'Szuterén'];

let state = null;
const listeners = [];

export function onChange(fn) { listeners.push(fn); }
export function notify() { for (const fn of listeners) fn(state); }

export function getState() { return state; }

export function setState(s) {
  state = s;
  normalizeActive();
  notify();
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyPlan() {
  return { nodes: [], walls: [], objects: [], rooms: [], furniture: [] };
}

export function newLevel(name) {
  return { id: newId(), name, plan: emptyPlan() };
}

export function newProperty(name) {
  return { id: newId(), name, levels: DEFAULT_LEVELS.map(newLevel) };
}

export function initialState() {
  const p = newProperty('Új ingatlan');
  return {
    version: 1,
    properties: [p],
    active: { propertyId: p.id, levelId: p.levels[1].id }, // földszint
  };
}

// Ha az aktív ingatlan/szint már nem létezik (törlés, import után), az első létezőre áll.
export function normalizeActive() {
  if (!state.properties.length) state.properties.push(newProperty('Új ingatlan'));
  let prop = state.properties.find(p => p.id === state.active?.propertyId);
  if (!prop) prop = state.properties[0];
  if (!prop.levels.length) prop.levels.push(newLevel('Új szint'));
  let level = prop.levels.find(l => l.id === state.active?.levelId);
  if (!level) level = prop.levels[0];
  state.active = { propertyId: prop.id, levelId: level.id };
}

export function activeProperty() {
  if (!state) return undefined;
  return state.properties.find(p => p.id === state.active.propertyId);
}

export function activeLevel() {
  return activeProperty()?.levels.find(l => l.id === state.active.levelId);
}

// --- Ingatlan-műveletek ---

export function addProperty() {
  const p = newProperty('Új ingatlan');
  state.properties.push(p);
  state.active = { propertyId: p.id, levelId: p.levels[0].id };
  notify();
  return p;
}

export function renameProperty(id, name) {
  const p = state.properties.find(p => p.id === id);
  if (p && name) { p.name = name; notify(); }
}

export function deleteProperty(id) {
  if (state.properties.length <= 1) return false;
  state.properties = state.properties.filter(p => p.id !== id);
  normalizeActive();
  notify();
  return true;
}

export function selectProperty(id) {
  const p = state.properties.find(p => p.id === id);
  if (!p || p.id === state.active.propertyId) return;
  const level = p.levels.find(l => l.id === state.active.levelId) || p.levels[0];
  state.active = { propertyId: p.id, levelId: level.id };
  notify();
}

// --- Szint-műveletek ---

export function addLevel(propertyId, name = 'Új szint') {
  const p = state.properties.find(p => p.id === propertyId);
  if (!p) return null;
  const level = newLevel(name);
  p.levels.push(level);
  state.active = { propertyId: p.id, levelId: level.id };
  notify();
  return level;
}

export function renameLevel(propertyId, levelId, name) {
  const p = state.properties.find(p => p.id === propertyId);
  const l = p?.levels.find(l => l.id === levelId);
  if (l && name) { l.name = name; notify(); }
}

export function deleteLevel(propertyId, levelId) {
  const p = state.properties.find(p => p.id === propertyId);
  if (!p || p.levels.length <= 1) return false;
  p.levels = p.levels.filter(l => l.id !== levelId);
  normalizeActive();
  notify();
  return true;
}

export function moveLevel(propertyId, levelId, dir) {
  const p = state.properties.find(p => p.id === propertyId);
  if (!p) return;
  const i = p.levels.findIndex(l => l.id === levelId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.levels.length) return;
  [p.levels[i], p.levels[j]] = [p.levels[j], p.levels[i]];
  notify();
}

export function setActiveLevel(propertyId, levelId) {
  if (state.active.propertyId === propertyId && state.active.levelId === levelId) return;
  state.active = { propertyId, levelId };
  notify();
}
