// Rövid, magától eltűnő visszajelzés a vászon fölött (pl. "nincs körbezárva").

let el, timer;

export function initToast() {
  el = document.createElement('div');
  el.id = 'toast';
  el.hidden = true;
  document.getElementById('canvas-wrap').appendChild(el);
}

export function showToast(msg) {
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, 2200);
}
