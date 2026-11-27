// Airport + runway database (OurAirports, public domain).
import { D2R, FT, bearing, distance } from '../sim/math.js';

let AIRPORTS = null;

export async function loadAirports() {
  if (AIRPORTS) return AIRPORTS;
  const res = await fetch(new URL('../../data/airports.json', import.meta.url));
  AIRPORTS = await res.json();
  return AIRPORTS;
}

export function allAirports() { return AIRPORTS || []; }

export function getAirport(icao) { return AIRPORTS?.find((a) => a.i === icao.toUpperCase()); }

export function searchAirports(q, limit = 12) {
  if (!AIRPORTS) return [];
  q = q.trim().toLowerCase();
  if (!q) return AIRPORTS.filter((a) => a.L).slice(0, limit);
  const scored = [];
  for (const a of AIRPORTS) {
    let s = 0;
    if (a.i.toLowerCase() === q || a.a.toLowerCase() === q) s = 100;
    else if (a.i.toLowerCase().startsWith(q)) s = 60;
    else if (a.c.toLowerCase().startsWith(q)) s = 40;
    else if (a.n.toLowerCase().includes(q)) s = 25;
    else if (a.c.toLowerCase().includes(q)) s = 20;
    if (s) scored.push([s + a.L * 10, a]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, limit).map((x) => x[1]);
}

// Each physical runway gives two usable runway "ends".
export function runwayEnds(ap) {
  const ends = [];
  for (const r of ap.r) {
    const [le, lla, llo, lel, he, hla, hlo, hel, lenFt, widthFt, ldisp, hdisp] = r;
    const a = { lat: lla * D2R, lon: llo * D2R }, b = { lat: hla * D2R, lon: hlo * D2R };
    const len = distance(a.lat, a.lon, b.lat, b.lon);
    const mk = (ident, s, e, elev, elevEnd, disp) => ({
      airport: ap.i, ident, lat: s.lat, lon: s.lon, endLat: e.lat, endLon: e.lon,
      heading: bearing(s.lat, s.lon, e.lat, e.lon), elevM: elev * FT, endElevM: elevEnd * FT, length: len,
      width: widthFt * FT, disp: disp * FT, aim: 300 + disp * FT, lengthFt: lenFt,
    });
    ends.push(mk(le, a, b, lel, hel, ldisp));
    ends.push(mk(he, b, a, hel, lel, hdisp));
  }
  return ends;
}

// Nearby airports for the navigation display
export function airportsNear(latR, lonR, radiusM, limit = 40) {
  if (!AIRPORTS) return [];
  const res = [];
  const dLatMax = radiusM / 111000;
  const latD = latR / D2R, lonD = lonR / D2R;
  for (const a of AIRPORTS) {
    if (Math.abs(a.la - latD) > dLatMax) continue;
    const d = distance(latR, lonR, a.la * D2R, a.lo * D2R);
    if (d < radiusM) res.push([d, a]);
  }
  return res.sort((x, y) => x[0] - y[0]).slice(0, limit).map((x) => x[1]);
}
