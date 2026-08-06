// Nem mentendő felület-állapot: aktív eszköz, kijelölés, falvastagság.

export const ui = {
  tool: 'select',        // 'select' | 'wall' | 'room' | 'door' | 'window' | 'furniture'
  selectedWallId: null,
  selectedRoomId: null,
  selectedObjectId: null,
  selectedFurnitureId: null,
  thickness: 10,         // cm – az új falak vastagsága
  wallGrow: 'auto',      // a kijelölt fal hosszának módosításakor melyik vég mozduljon ('auto'|'a'|'b')
  wallAlign: 'center',   // vastagság-váltáskor melyik falsík maradjon ('center'|'plus'|'minus')
  orthoOnly: false,      // csak derékszög (90/180/270°) engedélyezett rajzoláskor
  doorFlipHinge: false,  // az új ajtók zsanérja alapból melyik oldalon legyen
  doorFlipSide: false,   // az új ajtók nyitási iránya alapból melyik oldalra mutasson
  doorWithLeaf: true,    // az új ajtók alapból ajtólappal jöjjenek-e létre (vagy csak nyílás)
  doorLeafCount: 1,      // az új ajtók alapból 1 vagy 2 szárnyúak legyenek
  windowSashCount: 1,    // az új ablakok alapból 1 vagy 2 szárnyúak legyenek
  windowFlipSide: false, // az új ablakok nyitási iránya alapból melyik oldalra mutasson
  doorWidth: 90,         // cm – az új ajtók szélessége
  doorHeight: 210,       // cm – az új ajtók magassága (a méretjelöléshez és a felület-becsléshez)
  windowWidth: 120,      // cm – az új ablakok szélessége
  windowHeight: 150,     // cm – az új ablakok magassága
  furnitureCategory: null,  // a bútor-palettában épp nyitva tartott kategória
  furniturePendingType: null, // a legközelebbi kattintásra elhelyezendő tárgy típusa (ui.tool==='furniture')
  // a rajz ki-/bekapcsolható elemei — a fa-szerkezetét ld. layers.js
  layerVisible: {
    szaniter: true, konyha: true, butor: true, epulet: true,
    dimChains: true, wallLengths: true, openingSizes: true,
    roomName: true, roomArea: true, roomHeight: true, furnitureLabels: true,
    grid: true, origin: true,
  },
  dragging: false,       // aktív húzás alatt (ilyenkor a helyiség-nyomvonalak gyorsítótárból jönnek)
};
