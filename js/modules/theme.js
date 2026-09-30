// Világos/sötét téma kapcsoló a fejlécben. A kezdő témát már az index.html
// fejében lévő szkript beállította (villanás nélkül); itt csak a váltás és a
// mentés történik. Amíg a felhasználó nem választott, a rendszer beállítását
// követjük — akkor is, ha az futás közben változik.

const KEY = 'floorplan.theme';

let btn;

export function initTheme() {
  btn = document.getElementById('theme-toggle');
  if (!btn) return;
  updateButton();

  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* nem elérhető */ }
  });

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener('change', e => {
    if (!savedChoice()) apply(e.matches ? 'dark' : 'light');
  });
}

function current() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function savedChoice() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  updateButton();
}

function updateButton() {
  btn.title = current() === 'dark' ? 'Világos téma' : 'Sötét téma';
}
