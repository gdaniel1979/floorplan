// Nem mentendő felület-állapot: aktív eszköz, kijelölés, falvastagság.

export const ui = {
  tool: 'select',        // 'select' | 'wall' | 'room'
  selectedWallId: null,
  selectedRoomId: null,
  thickness: 10,         // cm – az új falak vastagsága
  orthoOnly: false,      // csak derékszög (90/180/270°) engedélyezett rajzoláskor
  dragging: false,       // aktív húzás alatt (ilyenkor a helyiség-nyomvonalak gyorsítótárból jönnek)
};
