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
- **Helyiségek**: színezhetők, a helyiség közepén név + terület (m²).
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

## Fejlesztési fázisok

1. ✅ Skeleton: projektváz, SVG-vászon ráccsal, pan/zoom
2. Ingatlan + szintek kezelése, localStorage, JSON export/import
3. Falrajzolás (hossz beírása, vastagság, húzás, körív, élhossz-címkék)
4. Helyiségek (felismerés, név, szín, m²)
5. Objektumok (ajtó/ablak a falban, könyvtár, rétegek)
6. PDF-export
7. Csiszolás, súgó
