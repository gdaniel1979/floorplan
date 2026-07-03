# Alaprajz szerkesztő

Webes alaprajz-szerkesztő professzionális kinézetű lakás-alaprajzok készítéséhez.
Vanilla JS + SVG, build-lépés nélkül; bármilyen statikus webszerverrel futtatható
(pl. `python3 -m http.server`), GitHub Pages-en is működik.

## Specifikáció

- **Ingatlan szekció**: az ingatlan neve, alatta lenyíló, szabadon bővíthető /
  átnevezhető / sorrendezhető szintek (alapértelmezés: kert, földszint, emelet, szuterén).
- **Falak vastagsággal** (pl. 30 cm főfal, 10 cm válaszfal); a fal körívessé görbíthető.
- **Rajzolás**: pontról pontra kattintva, közben a pontos hossz cm-ben begépelhető;
  minden él húzással is módosítható; az élhossz cm-ben mindig látszik az élen.
- **Helyiségek**: egy zárt fal-terület belsejébe kattintva automatikusan felismerve
  (a valós, belső falsíkig mért nettó alapterülettel, hézagmentesen a szomszédos
  helyiségekkel); színezhetők, a helyiség közepén név + terület (m²); a falak
  utólagos mozgatását is követik.
- **Objektumok rétegeken**: ajtó/ablak a fal-réteg része (mindig látható);
  a szaniter, konyha, bútorok és épületelemek rétegek kattintással ki/be kapcsolhatók.
- **Mentés**: automatikusan localStorage-ba, plusz JSON export/import fájlba.
- **PDF-export**: többoldalas (szintenként egy oldal), valós méretarányban (pl. 1:100),
  rajzkerettel és felirati mezővel (ingatlan neve, szint, dátum, méretarány).

## Futtatás

```bash
cd floorplan
python3 -m http.server 8001
```

Majd böngészőben: `http://<szerver>:8001/`

## Kódstruktúra

- `index.html` – az oldal váza (fejléc, oldalsáv, SVG-vászon)
- `css/style.css` – megjelenés
- `js/app.js` – belépési pont
- `js/modules/config.js` – konstansok (rács, zoom-határok; 1 SVG-egység = 1 cm)
- `js/modules/canvas.js` – SVG-vászon: rács, pan/zoom, koordináta-kijelzés
- `js/modules/state.js` – ingatlanok/szintek állapota, aktív kijelölés
- `js/modules/plan.js` – az aktív szint rajza: csomópontok, falak
- `js/modules/rooms.js` – helyiségek: sokszög-terület/súlypont, CRUD
- `js/modules/geometry.js` – geometriai segédfüggvények (távolság, ív, illesztés)
- `js/modules/tools.js` – egér-/billentyű-interakciók: fal- és helyiség-rajzolás, húzások, szerkesztők
- `js/modules/render.js` – az aktív szint teljes újrarajzolása
- `js/modules/toolbar.js` – eszköz-/falvastagság-panel
- `js/modules/sidebar.js` – Ingatlan-navigátor (fa-nézet)
- `js/modules/savemenu.js` – Mentés-menü (export/import)
- `js/modules/storage.js` – localStorage-mentés, JSON export/import
- `js/modules/history.js` – visszavonás/ismétlés
- `js/modules/historybar.js` – visszavonás/ismétlés gombok + billentyűk
- `js/modules/toast.js` – rövid, magától eltűnő visszajelzés
- `js/modules/uistate.js` – nem mentendő felület-állapot (aktív eszköz, kijelölés)

## Fejlesztési fázisok

1. ✅ Skeleton: projektváz, SVG-vászon ráccsal, pan/zoom
2. ✅ Ingatlan + szintek kezelése, localStorage, JSON export/import
3. ✅ Falrajzolás (hossz beírása, vastagság, húzás, körív, élhossz-címkék, undo/redo, snap)
4. ✅ Helyiségek (automatikus felismerés kattintással, név, szín, m²)
5. Objektumok (ajtó/ablak a falban, könyvtár, rétegek)
6. PDF-export
7. Csiszolás, súgó
