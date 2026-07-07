// Nem mentendő felület-állapot: aktív eszköz, kijelölés, falvastagság.

export const ui = {
  tool: 'select',        // 'select' | 'wall' | 'room' | 'door' | 'window' | 'furniture'
  selectedWallId: null,
  selectedRoomId: null,
  selectedObjectId: null,
  selectedFurnitureId: null,
  thickness: 10,         // cm – az új falak vastagsága
  orthoOnly: false,      // csak derékszög (90/180/270°) engedélyezett rajzoláskor
  doorFlipHinge: false,  // az új ajtók zsanérja alapból melyik oldalon legyen
  doorFlipSide: false,   // az új ajtók nyitási iránya alapból melyik oldalra mutasson
  doorWithLeaf: true,    // az új ajtók alapból ajtólappal jöjjenek-e létre (vagy csak nyílás)
  windowSashCount: 1,    // az új ablakok alapból 1 vagy 2 szárnyúak legyenek
  windowFlipSide: false, // az új ablakok nyitási iránya alapból melyik oldalra mutasson
  furnitureCategory: null,  // a bútor-palettában épp nyitva tartott kategória
  furniturePendingType: null, // a legközelebbi kattintásra elhelyezendő tárgy típusa (ui.tool==='furniture')
  layerVisible: { szaniter: true, konyha: true, butor: true, epulet: true },
  dragging: false,       // aktív húzás alatt (ilyenkor a helyiség-nyomvonalak gyorsítótárból jönnek)
};
