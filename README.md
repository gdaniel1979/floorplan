# Alaprajz szerkesztő

Webes alaprajz-szerkesztő professzionális kinézetű lakás-alaprajzok készítéséhez.
Vanilla JS + SVG, build-lépés nélkül; bármilyen statikus webszerverrel futtatható
(pl. `python3 -m http.server`), GitHub Pages-en is működik. Egyetlen külső
függőség van, az is a repóba másolva (`vendor/`): a three.js a 3D nézethez.

## Funkciók

- **Ingatlan szekció**: az ingatlan neve, alatta lenyíló, szabadon bővíthető /
  átnevezhető / sorrendezhető szintek (alapértelmezés: kert, földszint, emelet, szuterén).
- **Falak vastagsággal** (pl. 30 cm főfal, 10 cm válaszfal); a fal körívessé görbíthető.
- **Rajzolás**: pontról pontra kattintva, közben a pontos hossz cm-ben begépelhető;
  minden él húzással is módosítható; az élhossz cm-ben mindig látszik az élen.
  Kijelölt falnál a két oldalán lévő szabad távolság is megjelenik, és átírható.
- **Helyiségek**: egy zárt fal-terület belsejébe kattintva automatikusan felismerve
  (a valós, belső falsíkig mért nettó alapterülettel, hézagmentesen a szomszédos
  helyiségekkel); színezhetők, a helyiség közepén név + terület (m²) + belmagasság;
  a falak utólagos mozgatását is követik.
- **Nyílászárók**: ajtó (nyíló 1/2 szárnnyal, toló, csak nyílás) és ablak a falba
  ágyazva, méretjelöléssel és a saroktól mért, átírható távolsággal.
- **Bútor-katalógus** sematikus rajzjelekkel: szaniter, konyha, bútorok, épületelemek
  (lépcső valódi fokokkal, L/U alakban is). Elhelyezés, forgatás (falhoz és 15°-hoz
  illesztéssel), falhoz tapasztás, szín. Kijelöléskor mind a négy oldalán megjelenik
  és átírható a legközelebbi falig mért távolság.
- **Külső méretláncok**: az épület sziluettjéhez igazodó, szakaszonkénti és
  teljes-hosszú méretvonalak.
- **Helyiségek fül**: helyiségenkénti fal-felület a nyílászárók területével csökkentve.
- **Rétegek**: a méretezés, feliratok, bútor-kategóriák, épületelemek és segédelemek
  külön-külön ki/be kapcsolhatók.
- **Mentés**: automatikusan localStorage-ba, plusz JSON export/import fájlba.
- **PDF-export**: a böngésző nyomtatási párbeszédén keresztül („Mentés PDF-ként"),
  vektorosan. Állítható a lapméret (A4/A3), a tájolás és a feliratok papíron mért
  mérete; a tartalom rétegenként szűrhető, hogy egy teljes alaprajz se legyen zsúfolt.
- **3D nézet**: a teljes szint tömegmodellje (falak nyílásokkal, padlók, bútorok,
  lépcsők) three.js-sel, szabadon forgatható kamerával, árnyékokkal. A padlószintek
  a belmagasságokból következnek (közös födém: az alacsonyabb belmagasságú helyiség
  padlója van feljebb), a lépcsők a két végüknél lévő szint között futnak. A néző és
  a modell közé eső falak elhalványulnak, a hátsók tömörek maradnak; egy húzható
  emberke a nézet középpontja.

## Futtatás

```bash
python3 -m http.server 8001
```

Majd böngészőben: `http://<szerver>:8001/`

## Kódstruktúra

- `index.html` – az oldal váza (fejléc, oldalsávok, SVG-vászon, PDF- és 3D-panel)
- `css/style.css` – megjelenés: színtokenek világos és sötét témával (a fejlécben
  váltható, választás nélkül a rendszer beállítását követi), a rajzvászon mindkettőben világos; a rajzjelek stílusai a
  PDF-nyomtatásnál is ezek
- `vendor/` – a repóba másolt three.js + OrbitControls (offline működéshez)
- `js/app.js` – belépési pont

Rajz és állapot:

- `js/modules/config.js` – konstansok (rács, zoom-határok; 1 SVG-egység = 1 cm)
- `js/modules/state.js` – ingatlanok/szintek állapota, aktív kijelölés
- `js/modules/plan.js` – az aktív szint rajza: csomópontok, falak, fal-távolságok
- `js/modules/geometry.js` – geometriai segédfüggvények (távolság, ív, illesztés)
- `js/modules/uistate.js` – nem mentendő felület-állapot (aktív eszköz, kijelölés, rétegek)
- `js/modules/history.js` – visszavonás/ismétlés
- `js/modules/storage.js` – localStorage-mentés, JSON export/import

Tartalom:

- `js/modules/objects.js` – nyílászárók (ajtó/ablak) a falban
- `js/modules/rooms.js` – helyiségek: felismerés, terület/súlypont, CRUD
- `js/modules/furniture.js` – bútor-katalógus, elhelyezés, forgatás, fal-távolságok
- `js/modules/symbols.js` – a bútorok sematikus rajzjelei
- `js/modules/raster.js` – közös rács-alapú segédek (rasterizálás, kontúrkövetés)
- `js/modules/exterior.js` – külső sziluett és a belőle képzett méretláncok
- `js/modules/surfaces.js` – helyiségenkénti fal-felület becslése
- `js/modules/wallrepair.js` – fal-hálózat javítása T-elágazásoknál

Megjelenítés és kezelőfelület:

- `js/modules/canvas.js` – SVG-vászon: rács, pan/zoom, koordináta-kijelzés
- `js/modules/render.js` – az aktív szint teljes újrarajzolása
- `js/modules/tools.js` – egér-/billentyű-interakciók: rajzolás, húzások, szerkesztők
- `js/modules/toolbar.js` – bal oldali eszköz-panel + bútor-paletta
- `js/modules/sidebar.js` – Ingatlan-navigátor (fa-nézet)
- `js/modules/rightpanel.js` – jobb oldali sáv (fülek, átméretezés, becsukás)
- `js/modules/layers.js` – réteg-fa
- `js/modules/viewfit.js` – rajz igazítása a vászonhoz
- `js/modules/historybar.js` – visszavonás/ismétlés gombok + billentyűk
- `js/modules/savemenu.js` – Mentés-menü (export/import, PDF)
- `js/modules/pdfexport.js` – PDF-export (nyomtatási nézet, beállításokkal)
- `js/modules/view3d.js` – 3D nézet (three.js)
- `js/modules/toast.js` – rövid, magától eltűnő visszajelzés
- `js/modules/theme.js` – világos/sötét téma kapcsoló

## Fejlesztési fázisok

1. ✅ Skeleton: projektváz, SVG-vászon ráccsal, pan/zoom
2. ✅ Ingatlan + szintek kezelése, localStorage, JSON export/import
3. ✅ Falrajzolás (hossz beírása, vastagság, húzás, körív, élhossz-címkék, undo/redo, snap)
4. ✅ Helyiségek (automatikus felismerés kattintással, név, szín, m²)
5. ✅ Objektumok (ajtó/ablak a falban, bútor-katalógus, rétegek)
6. ✅ PDF-export
7. ✅ 3D nézet
8. Csiszolás, súgó
