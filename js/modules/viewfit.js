// "Vászonhoz igazítás" gomb: a nézetet az aktív szint teljes rajzára (fal-csomópontok
// befoglaló téglalapjára) állítja, függetlenül az aktuális zoom/pan állapottól.

import { fitToBounds } from './canvas.js';
import { getPlan } from './plan.js';

export function initViewFit() {
  document.getElementById('fit-view-btn').addEventListener('click', () => {
    const plan = getPlan();
    if (!plan || !plan.nodes.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of plan.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    fitToBounds(minX, minY, maxX, maxY);
  });
}
