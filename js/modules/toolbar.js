// Rajzolás-panel: eszközválasztó gombok + falvastagság.

import { ui } from './uistate.js';
import { setTool } from './tools.js';
import { getPlan, wallById } from './plan.js';
import { notify } from './state.js';
import { snapshot, checkpoint } from './history.js';

export function initToolbar() {
  for (const b of document.querySelectorAll('.tool-btn[data-tool]')) {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  }

  const orthoBtn = document.getElementById('ortho-toggle');
  orthoBtn.addEventListener('click', () => {
    ui.orthoOnly = !ui.orthoOnly;
    orthoBtn.classList.toggle('active', ui.orthoOnly);
  });

  const select = document.getElementById('wall-thickness');
  const customRow = document.getElementById('custom-thickness-row');
  const customInput = document.getElementById('custom-thickness');

  function currentThickness() {
    if (select.value === 'custom') {
      const v = parseFloat(customInput.value);
      return v > 0 ? v : 10;
    }
    return parseFloat(select.value);
  }

  function apply() {
    customRow.hidden = select.value !== 'custom';
    ui.thickness = currentThickness();
    // ha épp ki van jelölve egy fal, annak a vastagságát is átállítja
    const plan = getPlan();
    const w = plan && wallById(plan, ui.selectedWallId);
    if (w && w.thickness !== ui.thickness) {
      const before = snapshot();
      w.thickness = ui.thickness;
      notify();
      checkpoint(before);
    }
  }

  select.addEventListener('change', apply);
  customInput.addEventListener('change', apply);
  apply();
}
