// Airport detail from OpenStreetMap, in the local airport frame (x east, y north, metres):
// runway holding positions (hold-short / ILS critical-area / intermediate markings + enhanced centre lines),
// taxiway location / direction / mandatory signs at junctions and holds, runway distance-remaining signs,
// gate stands (lead-in lines, stop bars, stand numbers, safety envelopes), 3D jet bridges and apron
// floodlight masts. Everything is batched into a handful of primitives and built once per airport.
import { runwayInfo } from './runways.js';

const FT = 0.3048;
const FAA = new Set(['US', 'CA', 'PR', 'GU', 'VI', 'AS', 'MP']);

// ------------------------------------------------------------------ small vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const nrm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const crs = (a, b) => a[0] * b[1] - a[1] * b[0];
const right = (d) => [d[1], -d[0]];
const left = (d) => [-d[1], d[0]];
export function segClosest(p, a, b) {
  const v = sub(b, a), l2 = dot(v, v) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), v) / l2));
  const q = add(a, v, t);
  return { q, t, d: len(sub(p, q)) };
}
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringDist(p, ring) {
  let best = Infinity, bq = null, bn = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const c = segClosest(p, a, b);
    if (c.d < best) { best = c.d; bq = c.q; bn = nrm(right(sub(b, a))); }
  }
  return { d: best, q: bq, n: bn };
}
const signedArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
// deterministic pseudo-random numbers (same scenery every visit)
export function rng(seed) {
  let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// uniform grid over line segments for fast "what pavement is here" queries
export class SegGrid {
  constructor(cell = 60) { this.c = cell; this.m = new Map(); }
  key(i, j) { return i * 100003 + j; }
  add(a, b, data) {
    const c = this.c, x0 = Math.floor(Math.min(a[0], b[0]) / c), x1 = Math.floor(Math.max(a[0], b[0]) / c), y0 = Math.floor(Math.min(a[1], b[1]) / c), y1 = Math.floor(Math.max(a[1], b[1]) / c);
    const e = { a, b, data };
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = this.key(i, j); let l = this.m.get(k); if (!l) this.m.set(k, (l = [])); l.push(e); }
  }
  near(p, r = 0) {
    const c = this.c, out = new Set();
    const x0 = Math.floor((p[0] - r) / c), x1 = Math.floor((p[0] + r) / c), y0 = Math.floor((p[1] - r) / c), y1 = Math.floor((p[1] + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const l = this.m.get(this.key(i, j)); if (l) for (const e of l) out.add(e); }
    return out;
  }
}

// ------------------------------------------------------------------ textures
function solidCells(g) {
  const cols = { yellow: '#e2b02a', red: '#b8231d', white: '#ececec', black: '#141414', grey: '#5c5c5c' };
  const cells = {}; let x = 0;
  for (const [k, c] of Object.entries(cols)) { g.fillStyle = c; g.fillRect(x, 0, 16, 16); cells[k] = [x + 5, 5, 6, 6]; x += 16; }
  return cells;
}
function wear(g, x, y, w, h, n = 60) {
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.35})`; const s = 1 + Math.random() * 4; g.fillRect(x + Math.random() * w, y + Math.random() * h, s, s); }
  g.restore();
}
// marking atlas: solid paint, hold-short patterns, enhanced centre line and stand-number cells
function markingAtlas(standRefs) {
  const W = 2048, cellW = 128, cellH = 64, perRow = W / cellW;
  const rows = Math.ceil(Math.max(1, standRefs.length) / perRow);
  let H = 256; while (H < 256 + rows * cellH) H *= 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cells = solidCells(g);
  const Y = '#e2b02a';
  // runway holding position: 2 solid (taxiway side, bottom) + 2 dashed (runway side, top) lines
  g.fillStyle = Y;
  g.fillRect(0, 64 + 54, 512, 10); g.fillRect(0, 64 + 36, 512, 10);
  for (let x = 0; x < 512; x += 44) { g.fillRect(x + 4, 64 + 18, 24, 10); g.fillRect(x + 4, 64 + 0, 24, 10); }
  cells.hold = [0, 64, 512, 64]; wear(g, 0, 64, 512, 64);
  // ILS critical area: ladder
  g.fillRect(0, 128 + 0, 512, 9); g.fillRect(0, 128 + 55, 512, 9);
  for (let x = 6; x < 512; x += 34) g.fillRect(x, 128, 9, 64);
  cells.ils = [0, 128, 512, 64]; wear(g, 0, 128, 512, 64);
  // intermediate holding position: single dashed line
  for (let x = 0; x < 512; x += 44) g.fillRect(x + 4, 192 + 4, 24, 24);
  cells.inter = [0, 192, 512, 32]; wear(g, 0, 192, 512, 32);
  // enhanced taxiway centre line (dashes either side of the centre line), 64 x 192: u across, v along
  for (let y = 0; y < 192; y += 48) { g.fillRect(512 + 18, y + 4, 5, 26); g.fillRect(512 + 41, y + 4, 5, 26); }
  cells.enh = [512, 0, 64, 192];
  // stand numbers: yellow on black boxes
  cells.stand = new Map();
  standRefs.forEach((ref, i) => {
    const x = (i % perRow) * cellW, y = 256 + Math.floor(i / perRow) * cellH;
    g.fillStyle = '#141414'; g.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
    g.fillStyle = Y; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t = String(ref).slice(0, 5);
    g.font = `bold ${t.length > 3 ? 36 : 46}px "Roboto Mono", "Arial Narrow", monospace`;
    g.fillText(t, x + cellW / 2, y + cellH / 2 + 2);
    wear(g, x, y, cellW, cellH, 30);
    cells.stand.set(ref, [x + 2, y + 2, cellW - 4, cellH - 4]);
  });
  return { canvas: c, cells, W, H };
}

// ---- airport signs (FAA AC 150/5340-18 / ICAO Annex 14 style)
// part kinds: loc (yellow on black), dir (black on yellow + arrow), mand (white on red), dist (white on black)
const SIGN_H = 56;
function measureParts(g, parts) {
  let w = 0;
  for (const p of parts) {
    g.font = `bold 38px "Roboto Mono", "Arial Narrow", monospace`;
    const tw = g.measureText(p.text).width;
    p.w = Math.ceil(tw + (p.arrow != null ? 40 : 0) + 22);
    w += p.w + 2;
  }
  return w + 4;
}
function arrow(g, cx, cy, ang, s, col) {
  // ang: 0 = up (straight ahead), positive = clockwise (to the right)
  g.save(); g.translate(cx, cy); g.rotate(ang); g.fillStyle = col;
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.62, -s * 0.15); g.lineTo(s * 0.22, -s * 0.15); g.lineTo(s * 0.22, s); g.lineTo(-s * 0.22, s); g.lineTo(-s * 0.22, -s * 0.15); g.lineTo(-s * 0.62, -s * 0.15); g.closePath(); g.fill();
  g.restore();
}
function drawParts(g, x0, y0, parts) {
  let x = x0 + 2;
  g.fillStyle = '#0b0b0b'; g.fillRect(x0, y0, measureParts(g, parts), SIGN_H);
  for (const p of parts) {
    const bg = { loc: '#101010', dir: '#f1c21b', mand: '#c8201b', dist: '#101010' }[p.kind];
    const fg = { loc: '#f1c21b', dir: '#111', mand: '#fafafa', dist: '#fafafa' }[p.kind];
    g.fillStyle = bg; g.fillRect(x, y0 + 2, p.w, SIGN_H - 4);
    if (p.kind === 'loc') { g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(x + 4, y0 + 6, p.w - 8, SIGN_H - 12); }
    if (p.kind === 'mand') { g.strokeStyle = '#111'; g.lineWidth = 2; g.strokeRect(x + 3, y0 + 5, p.w - 6, SIGN_H - 10); }
    g.fillStyle = fg; g.textBaseline = 'middle'; g.font = `bold 38px "Roboto Mono", "Arial Narrow", monospace`;
    let tx = x + 11;
    if (p.arrow != null && p.arrow < 0) { arrow(g, tx + 14, y0 + SIGN_H / 2, p.arrow, 15, fg); tx += 36; }
    g.textAlign = 'left'; g.fillText(p.text, tx, y0 + SIGN_H / 2 + 2);
    if (p.arrow != null && p.arrow >= 0) { const tw = g.measureText(p.text).width; arrow(g, tx + tw + 20, y0 + SIGN_H / 2, p.arrow, 15, fg); }
    x += p.w + 2;
  }
}
function signAtlas(signs) {
  const W = 2048, rowH = SIGN_H + 4;
  const m = document.createElement('canvas').getContext('2d');
  // pack faces into rows
  const faces = [];
  for (const s of signs) { s.fw = measureParts(m, s.parts); faces.push([s, 'front', s.parts, s.fw]); if (s.back) { s.bw = measureParts(m, s.back); faces.push([s, 'backCell', s.back, s.bw]); } }
  let x = 0, y = 20; const pos = [];
  for (const f of faces) { if (x + f[3] > W) { x = 0; y += rowH; } pos.push([x, y]); x += f[3] + 4; }
  let H = 64; while (H < y + rowH) H *= 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, 16, 16);
  faces.forEach(([s, slot, parts, w], i) => { const [px, py] = pos[i]; drawParts(g, px, py, parts); s[slot === 'front' ? 'cell' : 'bcell'] = [px, py, w, SIGN_H]; });
  return { canvas: c, W, H, blank: [4, 4, 8, 8] };
}

// ------------------------------------------------------------------ geometry batching
class QuadBuf {
  constructor() { this.pos = []; this.nrm = []; this.st = []; this.idx = []; this.n = 0; }
  // p: 4 Cartesian3 (BL, BR, TR, TL); cell: [px, py, pw, ph] in an atlas of size W x H (canvas pixels, y down)
  add(p, cell, W, H, up) {
    const [px, py, pw, ph] = cell, u0 = px / W, u1 = (px + pw) / W, vb = 1 - (py + ph) / H, vt = 1 - py / H;
    const uv = [[u0, vb], [u1, vb], [u1, vt], [u0, vt]];
    for (let k = 0; k < 4; k++) { this.pos.push(p[k].x, p[k].y, p[k].z); this.nrm.push(up.x, up.y, up.z); this.st.push(uv[k][0], uv[k][1]); }
    const b = this.n; this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); this.n += 4;
  }
  geometry(Cesium) {
    if (!this.n) return null;
    return new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(this.pos) }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(this.nrm) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(this.st) }),
      },
      indices: new Uint32Array(this.idx), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(this.pos),
    });
  }
}

// ------------------------------------------------------------------ main
// ctx: { Cesium, ap, F (frame: toXY, planeXY), fromXY, elements, taxis: [{pts, hw, ref, kind}], aprons: [ring], buildings: [{r, tags}] , quality }
export function buildAirportDetail(ctx) {
  const { Cesium, ap, F, fromXY, elements } = ctx;
  const t0 = performance.now();
  const D2R = Math.PI / 180;
  const xyOf = (lat, lon) => F.toXY(lat * D2R, lon * D2R);
  const cart = (x, y, dh = 0) => { const [la, lo] = fromXY(x, y); return Cesium.Cartesian3.fromRadians(lo, la, F.planeXY(x, y) + dh); };
  const upAt = (x, y) => Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(cart(x, y), new Cesium.Cartesian3());
  const faa = FAA.has(ap.k);
  const taxis = ctx.taxis, aprons = ctx.aprons;

  // ---- runways in the local frame
  const rwys = ap.r.map((r) => {
    const info = runwayInfo(r); if (!(info.L > 100)) return null;
    const p1 = F.toXY(info.la1, info.lo1), p2 = F.toXY(info.la2, info.lo2);
    const u = nrm(sub(p2, p1));
    return { info, p1, p2, u, L: info.L, w: info.w, id1: r[0], id2: r[4], d1: (r[10] || 0) * FT, d2: (r[11] || 0) * FT };
  }).filter(Boolean);
  const rwyLocal = (p, R) => { const v = sub(p, R.p1); return { along: dot(v, R.u), cross: crs(R.u, v) }; }; // cross > 0: left of p1->p2
  const onRunway = (p, margin = 0) => rwys.find((R) => { const l = rwyLocal(p, R); return l.along > -60 - margin && l.along < R.L + 60 + margin && Math.abs(l.cross) < R.w / 2 + 8 + margin; });

  // ---- taxiway network: segment grid + shared-vertex junctions
  const grid = new SegGrid(60);
  taxis.forEach((t, wi) => { for (let i = 1; i < t.pts.length; i++) grid.add(t.pts[i - 1], t.pts[i], { wi, i }); });
  const onTaxi = (p, except = -1, shrink = 0) => { for (const e of grid.near(p, 40)) { if (e.data.wi === except) continue; if (segClosest(p, e.a, e.b).d < taxis[e.data.wi].hw - shrink) return e.data.wi; } return -1; };
  const inApron = (p) => aprons.some((r) => pointInRing(p[0], p[1], r));
  const vkey = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const vmap = new Map();
  taxis.forEach((t, wi) => t.pts.forEach((p, i) => { const k = vkey(p); let l = vmap.get(k); if (!l) vmap.set(k, (l = [])); l.push({ wi, i }); }));
  // walk along way wi from vertex i in direction s (+1/-1) for dist metres; returns point + direction of travel (toward i)
  const walk = (wi, i, s, dist) => {
    const pts = taxis[wi].pts; let acc = 0, j = i;
    while (true) {
      const k = j + s; if (k < 0 || k >= pts.length) return null;
      const seg = len(sub(pts[k], pts[j]));
      if (acc + seg >= dist) { const t = (dist - acc) / seg; const p = add(pts[j], sub(pts[k], pts[j]), t); return { p, d: nrm(sub(pts[j], pts[k])) }; }
      acc += seg; j = k;
    }
  };

  // ---- holding positions
  const holds = [];
  const holdNear = (p, r) => holds.some((h) => len(sub(h.p, p)) < r);
  const addHold = (p, dirHint, type, ref, hwHint) => {
    // snap to the nearest taxiway for direction / width
    let best = null;
    for (const e of grid.near(p, 30)) { const c = segClosest(p, e.a, e.b); if (!best || c.d < best.c.d) best = { c, e }; }
    let d = dirHint, hw = hwHint || 11, wi = -1;
    if (best && best.c.d < 25) { d = nrm(sub(best.e.b, best.e.a)); wi = best.e.data.wi; hw = taxis[wi].hw; p = best.c.q; }
    if (!d) return;
    // which runway does it protect, and which way is it?
    let R = null, rd = Infinity;
    for (const r of rwys) { const l = rwyLocal(p, r); if (l.along < -400 || l.along > r.L + 400) continue; const dd = Math.abs(l.cross); if (dd < rd) { rd = dd; R = r; } }
    if (!R || rd > 320) return;
    const lp = rwyLocal(add(p, d, 2), R), lm = rwyLocal(add(p, d, -2), R);
    if (Math.abs(lm.cross) < Math.abs(lp.cross)) d = [-d[0], -d[1]];
    if (rd < R.w / 2 + 6) return; // on the runway itself
    if (holdNear(p, 10)) return;
    const tref = ref && !/@|rwy|runway/i.test(ref) && ref.length <= 4 ? ref : (wi >= 0 ? taxis[wi].ref : '') || '';
    // runway designation as read when facing the runway: the end to the left first
    const leftFirst = crs(d, sub(R.p1, p)) > 0;
    const label = leftFirst ? `${R.id1}-${R.id2}` : `${R.id2}-${R.id1}`;
    holds.push({ p, d, hw, type, ref: tref, label, R, wi });
  };
  for (const e of elements) {
    const aw = e.tags?.aeroway; if (aw !== 'holding_position') continue;
    const typ = String(e.tags['holding_position:type'] || 'runway').toLowerCase();
    const type = typ === 'ils' ? 'ils' : typ === 'intermediate' ? 'inter' : 'runway';
    if (e.type === 'node' && e.lat != null) addHold(xyOf(e.lat, e.lon), null, type, e.tags.ref);
    else if (e.type === 'way' && e.geometry?.length >= 2) {
      const a = xyOf(e.geometry[0].lat, e.geometry[0].lon), b = xyOf(e.geometry[e.geometry.length - 1].lat, e.geometry[e.geometry.length - 1].lon);
      addHold([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nrm(left(sub(b, a))), type, e.tags.ref, Math.max(6, len(sub(b, a)) / 2));
    }
  }
  // synthesize runway holds where OSM has none: where a taxiway that enters a runway crosses the hold distance
  for (const R of rwys) {
    if (holds.some((h) => h.R === R && h.type === 'runway')) continue;
    const Dh = R.w >= 44 ? 76 : R.w >= 29 ? 60 : 38;
    taxis.forEach((t, wi) => {
      if (t.kind !== 'taxiway') return;
      const loc = t.pts.map((p) => rwyLocal(p, R));
      if (!loc.some((l) => Math.abs(l.cross) < R.w / 2 + 2 && l.along > -30 && l.along < R.L + 30)) return;
      for (let i = 1; i < t.pts.length; i++) {
        const a = Math.abs(loc[i - 1].cross), b = Math.abs(loc[i].cross);
        if ((a - Dh) * (b - Dh) > 0 || a === b) continue;
        const k = (Dh - a) / (b - a), p = add(t.pts[i - 1], sub(t.pts[i], t.pts[i - 1]), k);
        const l = rwyLocal(p, R); if (l.along < -20 || l.along > R.L + 20) continue;
        addHold(p, null, 'runway', '');
      }
    });
  }

  // ---- stands (gates)
  const terminals = ctx.buildings.filter((b) => /terminal/.test(b.tags.aeroway || '') || b.tags.building === 'terminal' || b.tags.aeroway === 'terminal');
  const bigBlds = ctx.buildings.filter((b) => b.A > 600);
  const nearestBld = (p, list = bigBlds) => { let best = null; for (const b of list) { if (Math.abs(b.c[0] - p[0]) > 600 || Math.abs(b.c[1] - p[1]) > 600) continue; const r = ringDist(p, b.r); if (!best || r.d < best.d) best = { ...r, b }; } return best; };
  const gateNodes = elements.filter((e) => e.type === 'node' && e.tags?.aeroway === 'gate' && e.lat != null).map((e) => ({ p: xyOf(e.lat, e.lon), ref: e.tags.ref || '' }));
  const stands = [];
  const standNear = (p, r) => stands.find((s) => len(sub(s.p, p)) < r);
  const nearGateRef = (p) => { let best = null, bd = 60; for (const g of gateNodes) { const d = len(sub(g.p, p)); if (d < bd && g.ref) { bd = d; best = g.ref; } } return best; };
  const addStand = (p, f, ref, src) => {
    if (standNear(p, 12)) return;
    if (onRunway(p, 10)) return;
    const nb = nearestBld(p);
    stands.push({ p, f, ref: (ref || nearGateRef(p) || '').toString().slice(0, 5), src, bld: nb && nb.d < 70 ? nb : null, terminal: !!(nb && nb.d < 70 && (nb.b.tags.aeroway === 'terminal' || nb.b.tags.building === 'terminal' || nb.b.A > 8000)) });
  };
  for (const e of elements) {
    if (e.tags?.aeroway !== 'parking_position') continue;
    if (e.type === 'way' && e.geometry?.length >= 2) {
      const pts = e.geometry.map((g) => xyOf(g.lat, g.lon));
      const a = pts[0], b = pts[pts.length - 1];
      if (len(sub(b, a)) < 4) continue;
      const na = nearestBld(a), nb2 = nearestBld(b);
      // nose end is the one nearer a building (nose-in stands); remote stands keep the way direction
      const noseB = !na || (nb2 && nb2.d <= na.d);
      const nose = noseB ? b : a, tail = noseB ? pts[pts.length - 2] : pts[1];
      addStand(nose, nrm(sub(nose, tail)), e.tags.ref, 'pp-way');
    } else if (e.type === 'node' && e.lat != null) {
      const p = xyOf(e.lat, e.lon); const nb = nearestBld(p);
      if (nb && nb.d < 120) { const f = nrm(sub(nb.q, p)); if (len(f) > 0) addStand(p, f, e.tags.ref, 'pp-node'); }
    }
  }
  for (const g of gateNodes) {
    if (standNear(g.p, 35)) continue;
    const nb = nearestBld(g.p, terminals.length ? terminals : bigBlds); if (!nb || nb.d > 40) continue;
    let out = nb.n; if (pointInRing(...add(nb.q, out, 1), nb.b.r)) out = [-out[0], -out[1]];
    addStand(add(nb.q, out, 7), [-out[0], -out[1]], g.ref, 'gate');
  }
  // stand size from the spacing to neighbouring stands
  for (const s of stands) {
    let lat = Infinity;
    for (const o of stands) if (o !== s) { const v = sub(o.p, s.p); const dl = Math.abs(crs(s.f, v)), da = Math.abs(dot(s.f, v)); if (da < 45 && dl < lat) lat = dl; }
    s.maxSpan = Math.max(15, Math.min(80, lat === Infinity ? 65 : lat - 4));
    s.hasBridge = false;
  }

  // ---- jet bridges (OSM jet_bridge ways; synthesized at terminal stands without one)
  const bridges = [];
  for (const e of elements) {
    if (e.tags?.aeroway !== 'jet_bridge' || e.type !== 'way' || !(e.geometry?.length >= 2)) continue;
    let pts = e.geometry.map((g) => xyOf(g.lat, g.lon));
    const na = nearestBld(pts[0]), nb = nearestBld(pts[pts.length - 1]);
    if (na && nb && nb.d < na.d) pts = pts.reverse(); // start at the terminal
    if (len(sub(pts[pts.length - 1], pts[0])) < 5) continue;
    bridges.push(pts);
    const end = pts[pts.length - 1];
    for (const s of stands) if (len(sub(s.p, end)) < 30) s.hasBridge = true;
  }
  for (const s of stands) {
    if (s.hasBridge || !s.terminal || !s.bld || s.maxSpan < 24) continue;
    // left (port) forward door, ~5-7 m behind the nose wheel stop point
    const door = add(add(s.p, s.f, -6), left(s.f), 2.6 + s.maxSpan * 0.012);
    const t = ringDist(door, s.bld.b.r);
    const dl = len(sub(door, t.q));
    if (dl < 7 || dl > 48) continue;
    bridges.push([add(t.q, sub(door, t.q), 0.0), door]); s.hasBridge = true;
  }

  // ---- floodlight masts around apron edges
  const floods = [];
  const fcap = { high: 240, medium: 160, low: 80 }[ctx.quality] ?? 160;
  for (const r of aprons) {
    const A = Math.abs(signedArea(r)); if (A < 5000) continue;
    const ccw = signedArea(r) > 0;
    let acc = 50;
    for (let i = 0; i < r.length && floods.length < fcap; i++) {
      const a = r[i], b = r[(i + 1) % r.length], seg = len(sub(b, a)); if (seg < 1) continue;
      const d = nrm(sub(b, a)), inward = ccw ? left(d) : right(d);
      for (let s = (120 - acc) % 120; s < seg; s += 120) {
        const p = add(add(a, d, s), inward, 7);
        if (onTaxi(p, -1, -3) >= 0 || onRunway(p, 20) || floods.some((f) => len(sub(f.p, p)) < 70) || stands.some((st) => len(sub(st.p, p)) < 18)) continue;
        floods.push({ p, top: A > 60000 ? 28 : 22, dir: inward });
      }
      acc = (acc + seg) % 120;
    }
  }

  // ---- signs
  const signs = [];
  const signCap = { high: 420, medium: 300, low: 150 }[ctx.quality] ?? 300;
  const signOk = (p, d) => !onRunway(p, 12) && !signs.some((s) => len(sub(s.p, p)) < 18 && dot(s.d, d) > 0.5) && onTaxi(p, -1, -1) < 0;
  for (const h of holds) {
    if (h.type === 'inter' || signs.length >= signCap) continue;
    const parts = [];
    if (h.ref) parts.push({ kind: 'loc', text: h.ref });
    parts.push({ kind: 'mand', text: h.type === 'ils' ? `${h.label.split('-')[0]} APCH` : h.label });
    const p = add(add(h.p, h.d, -1.5), left(h.d), h.hw + 5);
    if (signOk(p, h.d)) signs.push({ p, d: h.d, parts, H: 0.95 });
    if (h.hw > 9) { const q = add(add(h.p, h.d, -1.5), right(h.d), h.hw + 5); if (signOk(q, h.d)) signs.push({ p: q, d: h.d, parts: [{ kind: 'mand', text: parts[parts.length - 1].text }], H: 0.95 }); }
  }
  // junctions where differently named taxiways meet
  const qa = (a) => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  for (const [, list] of vmap) {
    if (signs.length >= signCap) break;
    const refs = new Set(list.map((v) => taxis[v.wi].ref).filter(Boolean));
    if (refs.size < 2 || list.length < 2) continue;
    const J = taxis[list[0].wi].pts[list[0].i];
    if (onRunway(J, 30)) continue;
    // outgoing directions of every branch at this junction
    const branches = [];
    for (const v of list) for (const s of [-1, 1]) { const w = walk(v.wi, v.i, s, 25); if (w) branches.push({ v, s, out: [-w.d[0], -w.d[1]], ref: taxis[v.wi].ref }); }
    for (const b of branches) {
      if (!b.ref || taxis[b.v.wi].kind !== 'taxiway') continue;
      const at = walk(b.v.wi, b.v.i, b.s, 32); if (!at) continue; // the sign stands 32 m before the junction
      const d = at.d, hw = taxis[b.v.wi].hw;
      const p = add(at.p, left(d), hw + 4);
      if (!signOk(p, d) || inApron(p)) continue;
      const dirs = new Map();
      for (const o of branches) {
        if (o === b || !o.ref || o.ref === b.ref) continue;
        const ang = Math.atan2(crs(o.out, d), dot(d, o.out)); // >0: to the right
        if (Math.abs(ang) > 2.9) continue;
        const a = qa(ang), key = o.ref + '|' + a;
        if (!dirs.has(key)) dirs.set(key, { kind: 'dir', text: o.ref, arrow: a });
      }
      if (!dirs.size) continue;
      const ds = [...dirs.values()].sort((x, y) => x.arrow - y.arrow).slice(0, 4);
      const parts = [...ds.filter((x) => x.arrow < 0), { kind: 'loc', text: b.ref }, ...ds.filter((x) => x.arrow >= 0)];
      signs.push({ p, d, parts, H: 0.85 });
      if (signs.length >= signCap) break;
    }
  }
  // runway distance-remaining signs (thousands of feet), left side for each direction of travel
  if (faa) {
    for (const R of rwys) {
      const Lft = R.L / FT; if (Lft < 3500) continue;
      for (const dirn of [1, -1]) {
        const start = dirn > 0 ? R.p1 : R.p2, u = dirn > 0 ? R.u : [-R.u[0], -R.u[1]];
        for (let n = Math.floor(Lft / 1000) - 1; n >= 1; n--) {
          const s = R.L - n * 1000 * FT; if (s < 250) continue;
          const p = add(add(start, u, s), left(u), R.w / 2 + 24);
          if (onTaxi(p, -1, -2) >= 0) continue;
          signs.push({ p, d: u, parts: [{ kind: 'dist', text: String(n) }], H: 1.25, base: 0.5 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- geometry
  const prims = [], mats = [], glowMats = [];
  // ground markings (one atlas, one primitive)
  const standRefs = [...new Set(stands.map((s) => s.ref).filter(Boolean))].slice(0, 448);
  const MA = markingAtlas(standRefs);
  const mq = new QuadBuf();
  const DH = -0.03;
  const groundQuad = (c, u, hu, v, hv, cell) => {
    const P = [add(add(c, u, -hu), v, -hv), add(add(c, u, hu), v, -hv), add(add(c, u, hu), v, hv), add(add(c, u, -hu), v, hv)];
    mq.add(P.map((q) => cart(q[0], q[1], DH)), cell, MA.W, MA.H, upAt(c[0], c[1]));
  };
  const line = (a, b, wdt, cell) => { const v = sub(b, a), l = len(v); if (l < 0.2) return; const d = nrm(v); groundQuad(add(a, v, 0.5), right(d), wdt / 2, d, l / 2, cell); };
  for (const h of holds) {
    const across = right(h.d), w = h.hw + 1;
    if (h.type === 'runway') {
      groundQuad(h.p, across, w, h.d, 0.8, MA.cells.hold);
      if (faa) groundQuad(add(h.p, h.d, -23.5), across, 1.25, h.d, 22.5, MA.cells.enh);
    } else if (h.type === 'ils') groundQuad(h.p, across, w, h.d, 0.8, MA.cells.ils);
    else groundQuad(h.p, across, w, h.d, 0.2, MA.cells.inter);
  }
  for (const s of stands) {
    const f = s.f, Y = MA.cells.yellow;
    const lead = s.terminal ? 46 : 34;
    line(add(s.p, f, -lead), add(s.p, f, 1.5), 0.3, Y);                 // lead-in line
    groundQuad(add(s.p, f, 0.4), right(f), 2.2, f, 0.2, Y);               // stop bar
    if (s.maxSpan > 30) groundQuad(add(s.p, f, -6.4), right(f), 1.4, f, 0.15, Y); // narrow-body stop bar
    const cell = MA.cells.stand.get(s.ref);
    if (cell) groundQuad(add(s.p, f, -lead + 6), right(f), 2.1, f, 1.05, cell); // stand number read from the cockpit
    if (s.terminal) {                                                     // red stand safety envelope
      const hw = s.maxSpan / 2, L = Math.min(76, s.maxSpan * 1.05), R = MA.cells.red;
      const c0 = add(s.p, f, 3), c1 = add(s.p, f, -L);
      const l0 = add(c0, left(f), hw), r0 = add(c0, right(f), hw), l1 = add(c1, left(f), hw), r1 = add(c1, right(f), hw);
      line(l0, r0, 0.2, R); line(l0, l1, 0.2, R); line(r0, r1, 0.2, R);
    }
  }
  const mgeo = mq.geometry(Cesium);
  if (mgeo) {
    const mm = Cesium.Material.fromType('Image', { image: MA.canvas, transparent: true }); mats.push(mm);
    prims.push(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: mgeo }),
      appearance: new Cesium.MaterialAppearance({ material: mm, translucent: true, faceForward: true, closed: false }),
      asynchronous: false, shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    }));
  }

  // signs: textured faces (self-lit, scaled separately at night) + dark frames and legs
  const boxes = { frame: [], steel: [], bridge: [], glass: [], rubber: [] };
  const vf = Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat;
  const ENU = (x, y, z) => cart(x, y, z);
  const orient = (x, y, z, f2, pitch = 0) => {
    // box frame: local x along heading f2 (pitched), z up
    const c = ENU(x, y, z);
    const m = Cesium.Transforms.eastNorthUpToFixedFrame(c);
    const E = Cesium.Matrix4.getColumn(m, 0, new Cesium.Cartesian4()), N = Cesium.Matrix4.getColumn(m, 1, new Cesium.Cartesian4()), U = Cesium.Matrix4.getColumn(m, 2, new Cesium.Cartesian4());
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = [E.x * f2[0] + N.x * f2[1], E.y * f2[0] + N.y * f2[1], E.z * f2[0] + N.z * f2[1]];
    const X = [fx[0] * cp + U.x * sp, fx[1] * cp + U.y * sp, fx[2] * cp + U.z * sp];
    const Z = [-fx[0] * sp + U.x * cp, -fx[1] * sp + U.y * cp, -fx[2] * sp + U.z * cp];
    const Yv = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    return new Cesium.Matrix4(X[0], Yv[0], Z[0], c.x, X[1], Yv[1], Z[1], c.y, X[2], Yv[2], Z[2], c.z, 0, 0, 0, 1);
  };
  const box = (group, x, y, z, f2, lx, ly, lz, pitch = 0) => {
    boxes[group].push(new Cesium.GeometryInstance({ geometry: Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(lx, ly, lz), vertexFormat: vf }), modelMatrix: orient(x, y, z, f2, pitch) }));
  };
  if (signs.length) {
    const SA = signAtlas(signs);
    const sq = new QuadBuf();
    for (const s of signs) {
      const base = s.base ?? 0.35, Hm = s.H, wM = (s.fw / SIGN_H) * Hm, r = right(s.d);
      const up = upAt(s.p[0], s.p[1]);
      const face = (off, u, cell) => {
        const c = add(s.p, s.d, off);
        const P = [[...add(c, u, -wM / 2), base], [...add(c, u, wM / 2), base], [...add(c, u, wM / 2), base + Hm], [...add(c, u, -wM / 2), base + Hm]];
        sq.add(P.map((q) => cart(q[0], q[1], q[2])), cell, SA.W, SA.H, up);
      };
      face(-0.07, r, s.cell);
      face(0.07, [-r[0], -r[1]], s.bcell || SA.blank);
      box('frame', s.p[0], s.p[1], base + Hm / 2, s.d, 0.12, wM + 0.1, Hm + 0.1);
      for (const k of [-0.35, 0.35]) box('steel', ...add(s.p, r, k * wM), base / 2, s.d, 0.06, 0.06, base);
    }
    const sg = sq.geometry(Cesium);
    const sm = Cesium.Material.fromType('Image', { image: SA.canvas }); glowMats.push(sm);
    prims.push(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: sg }),
      appearance: new Cesium.MaterialAppearance({ material: sm, flat: true, faceForward: false, closed: false, translucent: false }),
      asynchronous: false, shadows: Cesium.ShadowMode.DISABLED,
    }));
  }
  // jet bridges: rotunda, tunnel (window band), cab and drive column
  for (const pts of bridges) {
    const a = pts[0], b = pts[pts.length - 1];
    const hA = 4.6, hB = 3.4; // floor height at terminal / aircraft door
    box('bridge', a[0], a[1], (hA + 2.6) / 2, nrm(sub(b, a)), 4.2, 4.2, hA + 2.6);   // rotunda
    box('steel', a[0], a[1], hA / 2, [1, 0], 1.2, 1.2, hA);
    let acc = 0; const total = pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], l = len(sub(p1, p0)); if (l < 0.5) continue;
      const d = nrm(sub(p1, p0)), m = add(p0, sub(p1, p0), 0.5);
      const h0 = hA + (hB - hA) * (acc / total), h1 = hA + (hB - hA) * ((acc + l) / total), hm = (h0 + h1) / 2;
      const pitch = Math.atan2(h1 - h0, l);
      box('bridge', m[0], m[1], hm + 0.45, d, l, 2.9, 0.9, pitch);
      box('glass', m[0], m[1], hm + 1.3, d, l - 0.1, 2.75, 0.8, pitch);
      box('bridge', m[0], m[1], hm + 2.05, d, l, 2.95, 0.7, pitch);
      acc += l;
    }
    const d = nrm(sub(b, pts[pts.length - 2]));
    box('bridge', b[0], b[1], hB + 1.3, d, 3.2, 3.6, 2.7);                    // cab
    box('rubber', ...add(b, d, 1.75), hB + 1.3, d, 0.35, 3.0, 2.4);           // canopy bellows
    const col = add(b, d, -Math.min(10, total * 0.35));
    for (const k of [-1, 1]) box('steel', ...add(col, left(d), k * 1.2), (hB - 0.2) / 2, d, 0.35, 0.35, hB - 0.2);
    box('rubber', col[0], col[1], 0.5, d, 1.6, 3.2, 0.9);                    // wheel bogie
  }
  // floodlight masts
  for (const fl of floods) {
    box('steel', fl.p[0], fl.p[1], fl.top / 2, fl.dir, 0.55, 0.55, fl.top);
    box('frame', ...add(fl.p, fl.dir, 0.4), fl.top + 0.4, fl.dir, 0.7, 3.2, 1.1);
  }
  const groupCol = { frame: '#2a2c2e', steel: '#8d9196', bridge: '#c4c8cc', glass: '#2c3a44', rubber: '#1d1d1d' };
  for (const [k, list] of Object.entries(boxes)) {
    if (!list.length) continue;
    const m = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(groupCol[k]) });
    m._base = Cesium.Color.fromCssColorString(groupCol[k]); mats.push(m);
    prims.push(new Cesium.Primitive({ geometryInstances: list, appearance: new Cesium.MaterialAppearance({ material: m, materialSupport: Cesium.MaterialAppearance.MaterialSupport.BASIC, faceForward: true, closed: true }), asynchronous: true, shadows: Cesium.ShadowMode.ENABLED }));
  }
  const ms = performance.now() - t0;
  return {
    prims, mats, glowMats, stands, holds, floods, rwys, taxis, aprons,
    stats: { holds: holds.length, signs: signs.length, stands: stands.length, bridges: bridges.length, floods: floods.length, ms: Math.round(ms) },
  };
}
