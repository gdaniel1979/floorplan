// Sematikus bútor-rajzjelek. Minden tárgy egy adott szélességű/mélységű
// téglalapba (a "test") van beírva; itt csak az AZON BELÜLI részleteket
// rajzoljuk meg, hogy ránézésre felismerhető legyen, mi az.
//
// A rajzoló függvények normalizált koordinátákban dolgoznak: u és v a 0..1
// tartományban fut a tárgy szélessége/mélysége mentén (0,0 a bal felső sarok).
// A körvonal-vastagságok képernyőhöz igazodnak (1/s), hogy nagyításkor se
// hízzanak el. A tárgy elfordulását a hívó csoport transzformációja intézi.

import { el } from './canvas.js';

// A rajzoló segédek egy "ctx"-ben jönnek, hogy az egyes jelek rövidek legyenek.
function makeCtx(item, s) {
  const x0 = item.x - item.w / 2, y0 = item.y - item.h / 2;
  const X = u => x0 + u * item.w;
  const Y = v => y0 + v * item.h;
  const sw = 1 / s;                       // alap vonalvastagság
  const out = [];

  return {
    out, X, Y, sw,
    // téglalap normalizált sarkokkal
    rect(u0, v0, u1, v1, opts = {}) {
      out.push(el('rect', {
        x: X(Math.min(u0, u1)), y: Y(Math.min(v0, v1)),
        width: Math.abs(u1 - u0) * item.w, height: Math.abs(v1 - v0) * item.h,
        class: 'furn-line', 'stroke-width': sw, ...opts,
      }));
    },
    line(u0, v0, u1, v1, opts = {}) {
      out.push(el('line', {
        x1: X(u0), y1: Y(v0), x2: X(u1), y2: Y(v1),
        class: 'furn-line', 'stroke-width': sw, ...opts,
      }));
    },
    // ellipszis: a sugarak a tárgy méretének arányában
    ell(u, v, ru, rv, opts = {}) {
      out.push(el('ellipse', {
        cx: X(u), cy: Y(v), rx: ru * item.w, ry: rv * item.h,
        class: 'furn-line', 'stroke-width': sw, ...opts,
      }));
    },
    path(d, opts = {}) {
      out.push(el('path', { d, class: 'furn-line', 'stroke-width': sw, ...opts }));
    },
  };
}

// --- az egyes tárgyak rajzjelei ---

const SYMBOLS = {
  // szaniter
  wc(c) {
    c.rect(0.05, 0, 0.95, 0.22);                 // tartály
    c.ell(0.5, 0.6, 0.34, 0.26);                 // kagyló
    c.ell(0.5, 0.58, 0.22, 0.16, { class: 'furn-line furn-faint' });
  },
  mosdo(c) {
    c.rect(0, 0, 1, 1, { rx: 6 });
    c.ell(0.5, 0.55, 0.36, 0.32);                // medence
    c.ell(0.5, 0.16, 0.05, 0.06);                // csaptelep
  },
  kad(c) {
    c.rect(0, 0, 1, 1, { rx: 8 });
    c.rect(0.06, 0.12, 0.94, 0.88, { rx: 8 });   // belső kagyló
    c.ell(0.86, 0.5, 0.025, 0.055);              // lefolyó
  },
  zuhany(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0, 1, 1, { class: 'furn-line furn-faint' });
    c.line(1, 0, 0, 1, { class: 'furn-line furn-faint' });
    c.ell(0.5, 0.5, 0.06, 0.06);                 // folyóka
  },

  // konyha
  mosogato(c) {
    c.rect(0, 0, 1, 1, { rx: 4 });
    c.rect(0.08, 0.22, 0.6, 0.9, { rx: 4 });     // medence
    c.ell(0.82, 0.16, 0.05, 0.05);               // csaptelep
    c.ell(0.34, 0.56, 0.04, 0.04, { class: 'furn-line furn-faint' });
  },
  tuzhely(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    for (const [u, v] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
      c.ell(u, v, 0.15, 0.15);                   // főzőlapok
    }
  },
  huto(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.line(0, 0.32, 1, 0.32);                    // fagyasztó-elválasztó
    c.line(0.86, 0.06, 0.86, 0.26, { 'stroke-width': c.sw * 2 });  // fogantyú
    c.line(0.86, 0.4, 0.86, 0.7, { 'stroke-width': c.sw * 2 });
  },
  konyhapult(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0.86, 1, 0.86, { class: 'furn-line furn-faint' });   // pultél
  },

  // bútorok
  agy(c) {
    c.rect(0, 0, 1, 1, { rx: 4 });
    c.rect(0.06, 0.04, 0.94, 0.2, { rx: 5 });    // párna(k)
    c.line(0, 0.28, 1, 0.28);                    // takaró hajtása
    c.line(0.5, 0.04, 0.5, 0.2, { class: 'furn-line furn-faint' });
  },
  kanape(c) {
    c.rect(0, 0, 1, 1, { rx: 6 });
    c.rect(0, 0, 1, 0.26, { rx: 5 });            // háttámla
    c.rect(0, 0.26, 0.14, 1, { rx: 5 });         // kartámlák
    c.rect(0.86, 0.26, 1, 1, { rx: 5 });
    c.line(0.5, 0.3, 0.5, 0.96, { class: 'furn-line furn-faint' }); // ülőpárnák
  },
  fotel(c) {
    c.rect(0, 0, 1, 1, { rx: 6 });
    c.rect(0, 0, 1, 0.3, { rx: 5 });
    c.rect(0, 0.3, 0.18, 1, { rx: 5 });
    c.rect(0.82, 0.3, 1, 1, { rx: 5 });
  },
  etkezoasztal(c) {
    c.rect(0, 0, 1, 1, { rx: 6 });
    c.rect(0.08, 0.12, 0.92, 0.88, { rx: 5, class: 'furn-line furn-faint' });
  },
  dohanyzoasztal(c) {
    c.rect(0, 0, 1, 1, { rx: 8 });
    c.rect(0.12, 0.18, 0.88, 0.82, { rx: 6, class: 'furn-line furn-faint' });
  },
  szek(c) {
    c.rect(0.08, 0.18, 0.92, 1, { rx: 4 });      // ülőlap
    c.rect(0, 0, 1, 0.16, { rx: 3 });            // háttámla
  },
  szekreny(c) {
    c.rect(0, 0, 1, 1);
    c.line(0.5, 0, 0.5, 1);                      // ajtók találkozása
    // nyitási irány jelzése szaggatottal, ahogy bútorozási rajzon szokás
    c.path(`M ${c.X(0)} ${c.Y(1)} L ${c.X(0.5)} ${c.Y(0)}`, { class: 'furn-line furn-dash' });
    c.path(`M ${c.X(1)} ${c.Y(1)} L ${c.X(0.5)} ${c.Y(0)}`, { class: 'furn-line furn-dash' });
  },

  // épületelemek
  oszlop(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0, 1, 1, { class: 'furn-line furn-faint' });
    c.line(1, 0, 0, 1, { class: 'furn-line furn-faint' });
  },
  kemeny(c) {
    c.rect(0, 0, 1, 1);
    c.rect(0.25, 0.25, 0.75, 0.75);              // füstjárat
  },
};

// --- bővített készlet ---

Object.assign(SYMBOLS, {
  // szaniter
  duplamosdo(c) {
    c.rect(0, 0, 1, 1, { rx: 6 });
    c.ell(0.27, 0.55, 0.17, 0.32);
    c.ell(0.73, 0.55, 0.17, 0.32);
    c.ell(0.27, 0.15, 0.025, 0.06);
    c.ell(0.73, 0.15, 0.025, 0.06);
  },
  bide(c) {
    c.ell(0.5, 0.55, 0.4, 0.36);
    c.ell(0.5, 0.55, 0.24, 0.22, { class: 'furn-line furn-faint' });
    c.rect(0.25, 0, 0.75, 0.12);
  },
  zuhanykabin(c) {
    c.rect(0, 0, 1, 1);
    // negyedköríves nyíló ajtó
    c.path(`M ${c.X(0)} ${c.Y(1)} A ${c.X(1) - c.X(0)} ${c.Y(1) - c.Y(0)} 0 0 0 ${c.X(1)} ${c.Y(0)}`,
      { class: 'furn-line furn-dash' });
    c.ell(0.5, 0.5, 0.05, 0.05);
  },
  mosogep(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.ell(0.5, 0.56, 0.3, 0.3);                  // dob
    c.rect(0.08, 0.06, 0.92, 0.2, { class: 'furn-line furn-faint' }); // kezelőpanel
  },
  szaritogep(c) { SYMBOLS.mosogep(c); },
  bojler(c) {
    c.rect(0, 0, 1, 1, { rx: 4 });
    c.ell(0.5, 0.5, 0.32, 0.32);
    c.ell(0.5, 0.5, 0.1, 0.1, { class: 'furn-line furn-faint' });
  },

  // konyha
  mosogatogep(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.rect(0.1, 0.18, 0.9, 0.9, { rx: 3, class: 'furn-line furn-faint' });
    c.line(0.1, 0.1, 0.9, 0.1, { 'stroke-width': c.sw * 2 });
  },
  suto(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.rect(0.12, 0.28, 0.88, 0.9, { rx: 3 });    // sütőajtó
    c.line(0.12, 0.14, 0.88, 0.14, { 'stroke-width': c.sw * 2 });
  },
  mikro(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.rect(0.06, 0.12, 0.7, 0.88, { rx: 2, class: 'furn-line furn-faint' });
    c.line(0.78, 0.12, 0.78, 0.88, { class: 'furn-line furn-faint' });
  },
  paraelszivo(c) {
    c.rect(0, 0, 1, 1, { class: 'furn-line furn-dash' });   // a pult FÖLÖTT van
    c.rect(0.18, 0.24, 0.82, 0.76, { class: 'furn-line furn-faint' });
  },
  alsoszekreny(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0.86, 1, 0.86, { class: 'furn-line furn-faint' });
  },
  felsoszekreny(c) {
    c.rect(0, 0, 1, 1, { class: 'furn-line furn-dash' });   // szemmagasság fölött
    c.line(0.5, 0, 0.5, 1, { class: 'furn-line furn-faint' });
  },
  sarokszekreny(c) {
    c.rect(0, 0, 1, 1);
    c.path(`M ${c.X(0)} ${c.Y(1)} L ${c.X(1)} ${c.Y(0)}`, { class: 'furn-line furn-faint' });
    c.path(`M ${c.X(0.12)} ${c.Y(1)} A ${0.88 * (c.X(1) - c.X(0))} ${0.88 * (c.Y(1) - c.Y(0))} 0 0 0 ${c.X(1)} ${c.Y(0.12)}`,
      { class: 'furn-line furn-dash' });
  },
  konyhasziget(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.rect(0.06, 0.12, 0.94, 0.88, { rx: 3, class: 'furn-line furn-faint' });
  },
  barpult(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.line(0, 0.35, 1, 0.35, { class: 'furn-line furn-faint' });
  },

  // háló
  franciaagy(c) {
    c.rect(0, 0, 1, 1, { rx: 4 });
    c.rect(0.05, 0.04, 0.48, 0.2, { rx: 5 });
    c.rect(0.52, 0.04, 0.95, 0.2, { rx: 5 });
    c.line(0, 0.28, 1, 0.28);
  },
  egyagy(c) {
    c.rect(0, 0, 1, 1, { rx: 4 });
    c.rect(0.12, 0.04, 0.88, 0.2, { rx: 5 });
    c.line(0, 0.28, 1, 0.28);
  },
  emeletesagy(c) {
    SYMBOLS.egyagy(c);
    // létra a lábvégnél
    c.rect(0, 0.86, 1, 1, { class: 'furn-line furn-dash' });
    for (const u of [0.25, 0.5, 0.75]) c.line(u, 0.86, u, 1, { class: 'furn-line furn-faint' });
  },
  ejjeliszekreny(c) {
    c.rect(0, 0, 1, 1, { rx: 3 });
    c.rect(0.15, 0.2, 0.85, 0.8, { rx: 2, class: 'furn-line furn-faint' });
  },
  gardrob(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0.3, 1, 0.3, { class: 'furn-line furn-faint' });   // akasztórúd
    for (const u of [0.25, 0.5, 0.75]) c.line(u, 0, u, 1, { class: 'furn-line furn-faint' });
  },
  komod(c) {
    c.rect(0, 0, 1, 1, { rx: 2 });
    for (const u of [0.33, 0.66]) c.line(u, 0, u, 1, { class: 'furn-line furn-faint' });
    c.line(0, 0.5, 1, 0.5, { class: 'furn-line furn-faint' });
  },

  // nappali
  sarokkanape(c) {
    // L alakú ülőgarnitúra: a hosszú szár mentén háttámla, a rövid szár a sarokban
    c.path(`M ${c.X(0)} ${c.Y(0)} L ${c.X(1)} ${c.Y(0)} L ${c.X(1)} ${c.Y(1)} `
         + `L ${c.X(0.62)} ${c.Y(1)} L ${c.X(0.62)} ${c.Y(0.5)} L ${c.X(0)} ${c.Y(0.5)} Z`);
    c.rect(0, 0, 1, 0.16, { rx: 4 });                 // háttámla a hosszú száron
    c.rect(0.84, 0.16, 1, 1, { rx: 4 });              // háttámla a rövid száron
    c.line(0.4, 0.2, 0.4, 0.46, { class: 'furn-line furn-faint' });
  },
  puff(c) { c.ell(0.5, 0.5, 0.48, 0.48, { rx: 6 }); },
  tvszekreny(c) {
    c.rect(0, 0, 1, 1, { rx: 2 });
    c.line(0, 0.6, 1, 0.6, { class: 'furn-line furn-faint' });
    c.rect(0.3, 0.05, 0.7, 0.2, { class: 'furn-line furn-faint' });  // TV
  },
  konyvespolc(c) {
    c.rect(0, 0, 1, 1);
    for (const u of [0.2, 0.4, 0.6, 0.8]) c.line(u, 0, u, 1, { class: 'furn-line furn-faint' });
  },
  szonyeg(c) {
    c.rect(0, 0, 1, 1, { class: 'furn-line furn-dash' });
    c.rect(0.06, 0.04, 0.94, 0.96, { class: 'furn-line furn-faint' });
  },

  // étkező, dolgozó
  kerekasztal(c) {
    c.ell(0.5, 0.5, 0.5, 0.5);
    c.ell(0.5, 0.5, 0.38, 0.38, { class: 'furn-line furn-faint' });
  },
  iroasztal(c) {
    c.rect(0, 0, 1, 1, { rx: 2 });
    c.rect(0.62, 0.12, 0.96, 0.9, { rx: 2, class: 'furn-line furn-faint' }); // konténer
  },
  irodaiszek(c) {
    c.ell(0.5, 0.56, 0.4, 0.38);
    c.path(`M ${c.X(0.1)} ${c.Y(0.24)} A ${0.4 * (c.X(1) - c.X(0))} ${0.3 * (c.Y(1) - c.Y(0))} 0 0 1 ${c.X(0.9)} ${c.Y(0.24)}`);
  },

  // épületgépészet
  radiator(c) {
    c.rect(0, 0, 1, 1);
    for (let i = 1; i < 10; i++) c.line(i / 10, 0, i / 10, 1, { class: 'furn-line furn-faint' });
  },
  kandallo(c) {
    c.rect(0, 0, 1, 1);
    c.path(`M ${c.X(0.2)} ${c.Y(1)} L ${c.X(0.2)} ${c.Y(0.45)} `
         + `A ${0.3 * (c.X(1) - c.X(0))} ${0.45 * (c.Y(1) - c.Y(0))} 0 0 1 ${c.X(0.8)} ${c.Y(0.45)} `
         + `L ${c.X(0.8)} ${c.Y(1)}`);
  },
  akna(c) {
    c.rect(0, 0, 1, 1);
    c.line(0, 0, 1, 1, { class: 'furn-line furn-faint' });
    c.line(1, 0, 0, 1, { class: 'furn-line furn-faint' });
    c.rect(0.3, 0.3, 0.7, 0.7, { class: 'furn-line furn-faint' });
  },
  meterszekreny(c) {
    c.rect(0, 0, 1, 1);
    c.rect(0.15, 0.2, 0.85, 0.8, { class: 'furn-line furn-faint' });
  },
});

// ezeknél a rajzjel maga adja a körvonalat, a befoglaló téglalapot elhagyjuk
const CUSTOM_BODY = new Set(['sarokkanape', 'puff', 'kerekasztal', 'bide', 'irodaiszek']);
export function hidesBody(type) { return CUSTOM_BODY.has(type); }

export function hasSymbol(type) { return !!SYMBOLS[type]; }

// a tárgy rajzjelének elemei (a testet a hívó rajzolja alá)
export function furnitureSymbolParts(item, s) {
  const draw = SYMBOLS[item.type];
  if (!draw) return [];
  const c = makeCtx(item, s);
  draw(c);
  return c.out;
}
