// Helyiségenkénti fal-felület (festhető/burkolható) becslése, a tile projekt
// anyagszámításához hasonlóan. Minden (nem íves) fal mindkét oldalát
// megvizsgáljuk: a fal síkján túli mintapont melyik helyiség rács-
// nyomvonalába esik (ugyanaz a rács, amit a rooms.js már kiszámolt) — ha
// egy oldal egy adott helyiségbe esik, annak a fal-szakasznak a hossza ×
// a helyiség belmagassága adja a bruttó felületet, amiből a rajta lévő
// nyílászárók (szélesség × alapértelmezett magasság, ld. objects.js
// DEFAULT_HEIGHT — a magasság egyelőre nem szerkeszthető) területét vonjuk le.

import { nodeById } from './plan.js';
import * as G from './geometry.js';
import { getRoomTrace } from './rooms.js';
import { DEFAULT_HEIGHT as OPENING_HEIGHT } from './objects.js';

const SAMPLE_OFFSET = 5; // cm – ennyivel a fal síkján túl mintavételezünk, hogy biztosan a helyiség belsejében legyen

function isPointInTrace(trace, x, y) {
  const gx = Math.floor((x - trace.minX) / trace.cell);
  const gy = Math.floor((y - trace.minY) / trace.cell);
  if (gx < 0 || gy < 0 || gx >= trace.cols || gy >= trace.rows) return false;
  return !!trace.filled[gy * trace.cols + gx];
}

// { roomId -> { floorAreaM2, grossWallAreaM2, openingsAreaM2, netWallAreaM2 } }
export function computeRoomSurfaces(plan) {
  const traces = new Map();
  const result = new Map();
  for (const room of plan.rooms) {
    const trace = getRoomTrace(plan, room);
    if (trace) traces.set(room.id, trace);
    result.set(room.id, { floorAreaM2: trace ? trace.areaM2 : 0, grossWallAreaM2: 0, openingsAreaM2: 0 });
  }

  for (const w of plan.walls) {
    if (w.bulge) continue; // íves falra egyelőre nincs felület-becslés
    const a = nodeById(plan, w.a), b = nodeById(plan, w.b);
    if (!a || !b) continue;
    const len = G.dist(a, b);
    if (len < 1e-6) continue;

    const mid = G.mid(a, b);
    const n = G.normal(a, b);
    const half = w.thickness / 2 + SAMPLE_OFFSET;
    const sides = [
      { x: mid.x + n.x * half, y: mid.y + n.y * half },
      { x: mid.x - n.x * half, y: mid.y - n.y * half },
    ];

    const openingsAreaM2 = plan.objects
      .filter(o => o.wallId === w.id)
      .reduce((sum, o) => sum + o.width * (o.height || OPENING_HEIGHT[o.kind] || 0), 0) / 10000;

    for (const side of sides) {
      for (const room of plan.rooms) {
        const trace = traces.get(room.id);
        if (!trace || !isPointInTrace(trace, side.x, side.y)) continue;
        const entry = result.get(room.id);
        entry.grossWallAreaM2 += (len * room.height) / 10000;
        entry.openingsAreaM2 += openingsAreaM2;
        break; // egy pont csak egy helyiségbe eshet
      }
    }
  }

  for (const entry of result.values()) {
    entry.netWallAreaM2 = Math.max(0, entry.grossWallAreaM2 - entry.openingsAreaM2);
  }
  return result;
}
