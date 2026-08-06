// Réteg-fa: a rajz minden ki-/bekapcsolható eleme fő csoportokba rendezve,
// csoportonként alkapcsolókkal. A fő kapcsoló az összes alatta lévőt viszi,
// és félig-bepipált (indeterminate) állapotot mutat, ha az alkapcsolók
// vegyesek. A tényleges láthatóságot a render.js/canvas.js az ui.layerVisible
// lapos térképéből olvassa — a csoportok csak a kezelőfelület szervezéséhez
// kellenek, ezért az itteni kulcsok egy az egyben megfelelnek annak.

import { ui } from './uistate.js';
import { notify } from './state.js';

export const LAYER_GROUPS = [
  {
    key: 'dimensions', label: 'Méretezés',
    children: [
      { key: 'dimChains', label: 'Külső méretláncok' },
      { key: 'wallLengths', label: 'Belső falhosszak' },
      { key: 'openingSizes', label: 'Nyílászáró-méretek' },
    ],
  },
  {
    key: 'labels', label: 'Feliratok',
    children: [
      { key: 'roomName', label: 'Helyiség neve' },
      { key: 'roomArea', label: 'Terület (m²)' },
      { key: 'roomHeight', label: 'Belmagasság (B.m.)' },
      { key: 'furnitureLabels', label: 'Bútor-feliratok' },
    ],
  },
  {
    key: 'furnitureItems', label: 'Bútor-tárgyak',
    children: [
      { key: 'szaniter', label: 'Szaniter' },
      { key: 'konyha', label: 'Konyha' },
      { key: 'butor', label: 'Bútorok' },
      { key: 'epulet', label: 'Épületelemek' },
    ],
  },
  {
    key: 'helpers', label: 'Segédelemek',
    children: [
      { key: 'grid', label: 'Rács' },
      { key: 'origin', label: 'Origó-kereszt' },
    ],
  },
];

export function setLayer(key, visible) {
  ui.layerVisible[key] = visible;
  notify();
}

// egy fő csoport összes alrétegének együttes állítása
export function setGroup(groupKey, visible) {
  const group = LAYER_GROUPS.find(g => g.key === groupKey);
  if (!group) return;
  for (const child of group.children) ui.layerVisible[child.key] = visible;
  notify();
}

// 'all' | 'none' | 'some' – a fő kapcsoló pipa/üres/félig állapotához
export function groupState(group) {
  const on = group.children.filter(c => ui.layerVisible[c.key]).length;
  if (on === 0) return 'none';
  return on === group.children.length ? 'all' : 'some';
}
