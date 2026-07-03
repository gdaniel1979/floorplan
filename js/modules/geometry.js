// Geometriai segédfüggvények. Az ívelt falat a "bulge" paraméter írja le
// (DXF-konvenció: bulge = tan(nyílásszög/4); 0 = egyenes fal).

export function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// egységvektor a→b
export function unit(a, b) {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

// egységnyi normálvektor a→b szakaszra
export function normal(a, b) {
  const d = dist(a, b) || 1;
  return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
}

// ív adatai: sugár, nyílásszög, ívhossz, nyílmagasság (sagitta)
export function arcFromBulge(a, b, bulge) {
  const chord = dist(a, b);
  const s = Math.abs(bulge) * chord / 2;
  const r = ((chord / 2) ** 2 + s * s) / (2 * s);
  const theta = 4 * Math.atan(Math.abs(bulge));
  return { chord, sagitta: s, r, theta, arcLen: r * theta };
}

// az ív felezőpontja (a húr felezőjéből a normál irányában sagitta-nyira)
export function arcMidpoint(a, b, bulge) {
  const m = mid(a, b);
  const n = normal(a, b);
  const s = bulge * dist(a, b) / 2;
  return { x: m.x + n.x * s, y: m.y + n.y * s };
}

// fal teljes hossza (egyenesnél húr, ívnél ívhossz)
export function wallLength(a, b, bulge) {
  return bulge ? arcFromBulge(a, b, bulge).arcLen : dist(a, b);
}

// SVG path egy falhoz
export function wallPathD(a, b, bulge) {
  if (!bulge) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const { r, theta } = arcFromBulge(a, b, bulge);
  const large = theta > Math.PI ? 1 : 0;
  const sweep = bulge > 0 ? 0 : 1;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
}

// szög illesztése 45°-os lépésekre, ha elég közel van
export function snapAngle(angle, tolDeg = 10) {
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  return Math.abs(angle - snapped) < tolDeg * Math.PI / 180 ? snapped : angle;
}

// szög kényszerítése a legközelebbi derékszögre (0/90/180/270°) — "csak derékszög" mód
export function snapAngleOrtho(angle) {
  const step = Math.PI / 2;
  return Math.round(angle / step) * step;
}

// pont kerekítése a legközelebbi rácspontra
export function snapToGrid(p, step) {
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

// pont távolsága a-b szakasztól
export function pointSegDist(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
