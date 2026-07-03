// Mentés-menü a fejlécben: exportálás/importálás lenyíló menüből.

import { exportJson, importJson } from './storage.js';

export function initSaveMenu() {
  const btn = document.getElementById('save-menu-btn');
  const menu = document.getElementById('save-menu');
  const fileInput = document.getElementById('import-file');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  // kattintás a menün kívül: bezárás
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  document.getElementById('export-json').addEventListener('click', () => {
    menu.hidden = true;
    exportJson();
  });

  document.getElementById('import-json').addEventListener('click', () => {
    menu.hidden = true;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) importJson(fileInput.files[0]);
    fileInput.value = '';
  });
}
