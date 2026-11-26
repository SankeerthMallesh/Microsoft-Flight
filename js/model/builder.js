// Procedural aircraft geometry built from real dimensions.
// Model space: +X forward (nose), +Y left wing, +Z up. Origin = centre of gravity.
// Produces mesh "nodes" (body, gear, props, fans) with UVs into a shared texture atlas
// painted by painter.js, plus physical layout info (gear contact points, lights...).

export const ATLAS_W = 4096;
export const ATLAS_H = 2048;

export const SW = {
  wingTop: 0, wingUnder: 1, metal: 2, dark: 3, glass: 4, tire: 5, gear: 6, stab: 7,
  wingletOut: 8, wingletIn: 9, pylon: 10, blade: 11, bladeTip: 12, spinner: 13, intake: 14, exhaust: 15,
  belly: 16, base: 17, finBase: 18, red: 19, green: 20, white: 21, fan: 22, stabUnder: 23,
};
export function swatchUV(i) {
  const col = i % 8, row = Math.floor(i / 8);
  return [(2048 + col * 256 + 128) / ATLAS_W, (1536 + row * 128 + 64) / ATLAS_H];
}
export function swatchRect(i) {
  const col = i % 8, row = Math.floor(i / 8);
  return [2048 + col * 256, 1536 + row * 128, 256, 128];
}

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- mesh piece
class Piece {
  constructor(smoothAll = true) { this.p = []; this.uv = []; this.i = []; this.smooth = smoothAll; }
  v(x, y, z, u, w) { this.p.push(x, y, z); this.uv.push(u, w); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // Grid of rings: rings[j][k] = [x,y,z,u,v]; connects ring j to j+1.
  grid(rings, flip = false) {
    const base = this.p.length / 3;
    const n = rings[0].length;
    for (const r of rings) for (const q of r) this.v(q[0], q[1], q[2], q[3], q[4]);
    for (let j = 0; j < rings.length - 1; j++) {
      for (let k = 0; k < n - 1; k++) {
        const a = base + j * n + k, b = a + 1, c = a + n + 1, d = a + n;
        if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
      }
    }
  }
}

function computeNormals(piece) {
  const P = piece.p, I = piece.i, nv = P.length / 3;
  const N = new Float32Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  if (piece.smooth) {
    // merge normals of coincident vertices (UV seams)
    const map = new Map();
    for (let k = 0; k < nv; k++) {
      const key = `${Math.round(P[k * 3] * 500)},${Math.round(P[k * 3 + 1] * 500)},${Math.round(P[k * 3 + 2] * 500)}`;
      let g = map.get(key); if (!g) { g = []; map.set(key, g); } g.push(k);
    }
    for (const g of map.values()) {
      if (g.length < 2) continue;
      let x = 0, y = 0, z = 0;
      for (const k of g) { x += N[k * 3]; y += N[k * 3 + 1]; z += N[k * 3 + 2]; }
      for (const k of g) { N[k * 3] = x; N[k * 3 + 1] = y; N[k * 3 + 2] = z; }
    }
  }
  for (let k = 0; k < nv; k++) {
    const x = N[k * 3], y = N[k * 3 + 1], z = N[k * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    N[k * 3] = x / l; N[k * 3 + 1] = y / l; N[k * 3 + 2] = z / l;
  }
  return N;
}

class NodeMesh {
  constructor(name, translation = [0, 0, 0]) { this.name = name; this.translation = translation; this.pieces = []; }
  piece(smoothAll = true) { const p = new Piece(smoothAll); this.pieces.push(p); return p; }
  // Merge pieces into flat typed arrays.
  finalize() {
    let nv = 0, ni = 0;
    for (const p of this.pieces) { nv += p.p.length / 3; ni += p.i.length; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const p of this.pieces) {
      const N = computeNormals(p);
      pos.set(p.p, vo * 3); nor.set(N, vo * 3); uv.set(p.uv, vo * 2);
      for (let k = 0; k < p.i.length; k++) idx[io + k] = p.i[k] + vo;
      vo += p.p.length / 3; io += p.i.length;
    }
    return { name: this.name, translation: this.translation, positions: pos, normals: nor, uvs: uv, indices: idx };
  }
}

// ----------------------------------------------------------- airfoil section
function airfoil(n, tc, camber = 0.02) {
  // returns loop from TE (upper) -> LE -> TE (lower); each [xf, zf, s] with s in 0..1
  const pts = [];
  const yt = (x) => 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < 0.4 ? (camber / 0.16) * (0.8 * x - x * x) : (camber / 0.36) * (0.2 + 0.8 * x - x * x));
  for (let k = 0; k <= n; k++) {
    const x = 0.5 * (1 + Math.cos((k / n) * Math.PI)); // 1 -> 0
    pts.push([x, yc(x) + yt(x), 0.5 * (k / n)]);
  }
  for (let k = 1; k <= n; k++) {
    const x = 0.5 * (1 - Math.cos((k / n) * Math.PI)); // 0 -> 1
    pts.push([x, yc(x) - yt(x), 0.5 + 0.5 * (k / n)]);
  }
  return pts;
}

// ============================================================ main builder
export function buildAircraft(ac) {
  const g = ac.geo;
  const L = ac.length, b = ac.span, s = b / 2;
  const R = g.d / 2, H0 = (g.dh || g.d) / 2;
  const isProp = ac.engines.type !== 'turbofan';
  const isGA = ac.category === 'General aviation';
  const highWing = g.wingZ === 'high';

  // ---------------------------------------------------------------- profile
  const noseLenD = g.noseLen || ({ airbus: 1.75, boeing: 1.55, '757': 1.85, '767': 1.7, '777': 1.75, '787': 1.95, a350: 1.95,
    a380: 1.6, b747: 1.4, dc10: 1.55, embraer: 1.85, crj: 2.1, bizjet: 2.4, atr: 1.7, q400: 2.0, kingair: 2.2, c172: 1.4 })[g.nose] || 1.75;
  const Ln = noseLenD * g.d;
  const Lt = (g.tailLen || (isProp ? 2.7 : 2.6)) * g.d;
  const tailStart = L - Lt;
  const tipZ = -0.28 * H0;
  const pointy = { '787': 1.6, a350: 1.7, bizjet: 1.5, crj: 1.7, embraer: 1.8, q400: 1.7 }[g.nose] || 2;
  const deck2 = g.deck2 ? g.deck2 * L : 0;
  const wingX = g.wingX * L;

  // wing planform (needed for fairing)
  const sweepLE = (g.sweep + (g.sweep > 10 ? 2.5 : 0)) * D2R;
  const T = Math.tan(sweepLE);
  const lam = g.taper;
  const A = ac.wingArea / 2;
  const yk = g.sweep > 10 ? 0.33 * s : 0;
  let cr;
  if (yk > 0) cr = (2 * A + yk * yk * T + (s - yk) * yk * T) / (2 * yk + (s - yk) * (1 + lam));
  else cr = (2 * A) / (s * (1 + lam));
  const ck = yk > 0 ? cr - yk * T : cr;
  const ct = lam * cr;
  const xLE = (y) => wingX + y * T;
  const chord = (y) => (yk > 0 && y <= yk ? cr - y * T : ck + (ct - ck) * ((y - yk) / (s - yk)));
  const xcg = wingX + 0.3 * cr + (g.eng[0].mount === 'tail' ? 0.15 * cr : 0);

  function profile(x) {
    // returns {cz, ht, hw} at distance x from nose
    let top = H0, bot = -H0, hw = R;
    if (x < Ln) {
      const t = clamp(x / Ln, 0, 1);
      const sB = Math.pow(1 - Math.pow(1 - t, pointy), 1 / pointy);
      const sT = Math.pow(1 - Math.pow(1 - t, 1.75), 1 / 1.75);
      top = tipZ + (H0 - tipZ) * sT;
      bot = tipZ - (H0 + tipZ) * sB;
      hw = R * sB;
      if (g.nose === 'c172') { top = lerp(-0.1 * H0, 0.55 * H0, sT); bot = lerp(-0.1 * H0, -0.75 * H0, sB); hw = R * lerp(0.35, 0.85, sB); }
    }
    const Ltb = Lt * (isGA ? 1 : 1.4); // bottom upsweep starts ahead of the tail cone
    if (x > L - Ltb && g.nose !== 'c172') {
      const tb = clamp((x - (L - Ltb)) / Ltb, 0, 1);
      bot = -H0 + H0 * (1 + (isGA ? 0.15 : 0.25)) * Math.pow(tb, isGA ? 0.9 : 1.35);
    }
    if (x > tailStart) {
      const t = clamp((x - tailStart) / Lt, 0, 1);
      const endTop = g.eng.some((e) => e.mount === 'tail3') ? 0.75 : isGA ? 0.35 : 0.42;
      top = H0 - H0 * (1 - endTop) * Math.pow(t, 1.6);
      if (bot > top - 0.08 * H0) bot = top - 0.08 * H0;
      hw = R * (1 - (isGA ? 0.88 : 0.86) * Math.pow(t, 1.25));
    }
    if (g.nose === 'c172' && x >= Ln) {
      // cabin: tall, then tapering tail boom
      const cabinEnd = 0.45 * L;
      if (x < cabinEnd) { top = lerp(0.55 * H0, H0, smooth((x - Ln) / (0.1 * L))); bot = -0.75 * H0; hw = R * 0.85 + 0.15 * R * smooth((x - Ln) / (0.1 * L)); }
      else { const t = (x - cabinEnd) / (L - cabinEnd); top = lerp(H0, 0.35 * H0, Math.pow(t, 0.8)); bot = lerp(-0.75 * H0, 0.0, Math.pow(t, 0.7)); hw = R * lerp(1, 0.14, Math.pow(t, 0.9)); }
    }
    // 747 upper deck hump
    if (deck2 > 0) {
      const hTop = H0 * 1.42;
      let hump;
      if (x < Ln * 1.6) { const t = clamp(x / (Ln * 1.6), 0, 1); hump = tipZ + (hTop - tipZ) * Math.pow(1 - Math.pow(1 - t, 1.8), 1 / 1.8); }
      else if (x < deck2) hump = hTop;
      else hump = lerp(hTop, H0, smooth((x - deck2) / (0.09 * L)));
      top = Math.max(top, hump);
    }
    // wing-body fairing
    if (!isGA && !highWing) {
      const f0 = wingX - 0.15 * cr, f1 = wingX + cr * 1.25;
      if (x > f0 && x < f1) {
        const t = (x - f0) / (f1 - f0);
        const bump = Math.sin(Math.PI * Math.pow(t, 0.8));
        bot -= 0.13 * H0 * bump; hw *= 1 + 0.05 * bump;
      }
    }
    if (highWing && g.sponson) {
      const f0 = wingX + 0.1 * cr, f1 = wingX + 1.6 * cr;
      if (x > f0 && x < f1) { const bump = Math.sin(Math.PI * (x - f0) / (f1 - f0)); hw *= 1 + 0.12 * bump; bot -= 0.04 * H0 * bump; }
    }
    return { cz: (top + bot) / 2, ht: (top - bot) / 2, hw, top, bot };
  }

  const X = (xn) => xcg - xn; // nose-distance -> model x
  const body = new NodeMesh('body');
  const gear = new NodeMesh('gear');
  const extraNodes = [];

  // ------------------------------------------------------------- fuselage
  {
    const nth = 28; // segments per side
    const stations = [];
    const nNose = 34, nMid = 40, nTail = 46;
    for (let k = 0; k <= nNose; k++) stations.push(Ln * 1.25 * Math.pow(k / nNose, 1.7));
    for (let k = 1; k <= nMid; k++) stations.push(lerp(Ln * 1.25, tailStart, k / nMid));
    for (let k = 1; k <= nTail; k++) stations.push(lerp(tailStart, L, Math.pow(k / nTail, 0.85)));
    const ex = g.boxy ? 2.6 : g.dh && g.dh / g.d > 1.15 && !g.deck2 ? 2.25 : 2;
    for (const side of [1, -1]) {
      const rings = [];
      for (const xn of stations) {
        const pr = profile(xn);
        const ring = [];
        for (let k = 0; k <= nth; k++) {
          const th = (k / nth) * Math.PI;
          const c = Math.cos(th), sn = Math.sin(th);
          const sc = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex), ss = Math.pow(sn, 2 / ex);
          let z = pr.cz + pr.ht * sc;
          let y = pr.hw * ss;
          if (deck2 > 0 && z > H0 * 0.9) y *= 1 - 0.32 * clamp((z - H0 * 0.9) / (H0 * 0.5), 0, 1);
          const uS = side > 0 ? xn / L : 1 - xn / L;
          const vS = (side > 0 ? 0.25 : 0) + (k / nth) * 0.25;
          ring.push([X(xn), side * Math.max(y, 0.0005), z, uS, vS]);
        }
        rings.push(ring);
      }
      const pc = body.piece();
      pc.grid(rings, side < 0);
    }
  }

  // ----------------------------------------------------------------- wings
  const tcRoot = isGA ? 0.15 : 0.15, tcTip = isGA ? 0.13 : 0.105;
  const zRootWing = highWing ? profile(wingX).cz + H0 * 0.86 : g.wingZ === 'mid' ? 0 : profile(wingX + cr * 0.3).cz - H0 * 0.52;
  const dih = g.dihedral * D2R;
  const flex = g.wingFlex || 0;
  const wingZ = (y) => zRootWing + y * Math.tan(dih) + flex * Math.pow(y / s, 2);
  const yStart = 0;
  const wingStations = [];
  wingStations.push(yStart);
  if (yk > 0) wingStations.push(yk);
  const outerStart = yk > 0 ? yk : 0;
  for (let k = 1; k <= 5; k++) wingStations.push(lerp(outerStart, s, k / 5));
  const raked = g.tip === 'raked';
  const tipInfo = {};
  function wingSection(y) {
    let xl = xLE(y), c = chord(y);
    if (raked && y > s * 0.86) { const t = (y - s * 0.86) / (s * 0.14); xl += t * t * c * 0.55; c *= 1 - 0.55 * t; }
    const tc = lerp(tcRoot, tcTip, clamp(y / s, 0, 1));
    return { xl, c, tc, z: wingZ(y) };
  }
  const foil = airfoil(14, 1, isGA ? 0.025 : 0.02);
  function buildWing(side) {
    const pc = body.piece();
    const rings = [];
    for (const y of wingStations) {
      const sec = wingSection(y);
      const ring = [];
      for (const [xf, zf, sp] of foil) {
        const tcs = sec.tc;
        ring.push([X(sec.xl + xf * sec.c), side * y, sec.z + zf * sec.c * tcs / 1.0, 0.75 + 0.25 * sp, 0.5 + 0.25 * (y / s)]);
      }
      rings.push(ring);
    }
    // NACA formula already scaled by thickness 1 -> rescale zf by tc: done above (zf*c*tc)
    pc.grid(rings, side < 0);
    // tip cap
    const last = rings[rings.length - 1];
    const cap = body.piece(false);
    const [su, sv] = swatchUV(SW.wingTop);
    const idx = last.map((q) => cap.v(q[0], q[1], q[2], su, sv));
    const n = idx.length;
    for (let k = 1; k < n / 2 - 1; k++) {
      const a = idx[k], bb = idx[k + 1], c = idx[n - 1 - k], d = idx[n - 2 - k];
      if (side > 0) { cap.quad(a, bb, d, c); } else { cap.quad(a, c, d, bb); }
    }
    const sec = wingSection(s);
    tipInfo.x = X(sec.xl + sec.c * 0.5); tipInfo.xl = sec.xl; tipInfo.c = sec.c; tipInfo.z = sec.z;
  }
  buildWing(1); buildWing(-1);

  // ------------------------------------------------------- wingtip devices
  function finSurface(node, base, top, side, swOut, swIn, sweepDeg = 38) {
    // generic thin vertical-ish fin between base section and top section
    const pc = node.piece();
    const rings = [];
    const n = 8;
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      const cx = lerp(base.xl, top.xl, t), c = lerp(base.c, top.c, t);
      const p0 = [lerp(base.y, top.y, t), lerp(base.z, top.z, t)];
      const ring = [];
      for (let k = 0; k <= n * 2; k++) {
        const a = (k / (n * 2)) * Math.PI * 2;
        const xf = 0.5 + 0.5 * Math.cos(a);
        const th = 0.045 * c * Math.sin(a) * (1 - 0.6 * t);
        const [u, v] = swatchUV(Math.sin(a) * side >= 0 ? swOut : swIn);
        ring.push([X(cx + xf * c), side * (p0[0] + th * Math.cos(base.cant || 0)), p0[1] - th * Math.sin(base.cant || 0), u, v]);
      }
      rings.push(ring);
    }
    pc.grid(rings, side < 0);
  }
  if (['sharklet', 'blended', 'split', 'curved', 'canted', 'fence', 'md11', 'winglet-small'].includes(g.tip)) {
    const h = g.tipH || (g.tip === 'sharklet' ? 2.4 : 2.0);
    const sec = wingSection(s);
    for (const side of [1, -1]) {
      const cant = { canted: 32, sharklet: 12, blended: 14, split: 10, curved: 16, fence: 0, md11: 8, 'winglet-small': 10 }[g.tip] * D2R;
      const sweepW = { fence: 30, curved: 50 }[g.tip] || 42;
      const baseC = g.tip === 'fence' ? sec.c * 0.95 : sec.c * 0.85;
      const base = { xl: sec.xl + (sec.c - baseC) * 0.5, c: baseC, y: s - 0.02, z: sec.z, cant };
      const topC = g.tip === 'fence' ? baseC * 0.6 : baseC * 0.32;
      const hh = g.tip === 'fence' ? h * 0.6 : h;
      const top = { xl: base.xl + hh * Math.tan(sweepW * D2R), c: topC, y: s - 0.02 + hh * Math.sin(cant), z: sec.z + hh * Math.cos(cant) };
      if (top.xl + top.c > base.xl + base.c + 0.5 * baseC) top.xl = base.xl + base.c + 0.5 * baseC - top.c;
      finSurface(body, base, top, side, SW.wingletOut, SW.wingletIn);
      if (g.tip === 'split' || g.tip === 'fence' || g.tip === 'md11') {
        const hd = g.tip === 'split' ? h * 0.42 : g.tip === 'fence' ? h * 0.4 : h * 0.3;
        const bot = { xl: base.xl + hd * 0.6, c: baseC * 0.35, y: s - 0.02 + hd * Math.sin(cant), z: sec.z - hd };
        finSurface(body, base, bot, side, SW.wingletOut, SW.wingletIn);
      }
    }
  }

  // ------------------------------------------------------ vertical tail
  const vt = g.vt || {};
  const tail3 = g.eng.some((e) => e.mount === 'tail3');
  const vh = vt.h || 0.18 * L;
  const vcr = (g.tTail ? 0.19 : isGA ? 0.2 : 0.165) * L * (vt.cr || 1) * (b > 60 ? 0.95 : 1);
  const vct = vcr * (g.tTail ? 0.68 : 0.36);
  const vsweep = (g.tTail ? 36 : isGA ? 30 : isProp ? 32 : 39) * D2R;
  let vxRoot = (vt.x || 0.77) * L;
  if (vxRoot + vcr > L - 0.2) vxRoot = L - 0.2 - vcr;
  const nacTail3D = g.nacD;
  const finRootZ = (() => { const pr = profile(vxRoot + vcr * 0.45); return pr.top - 0.04 * H0 + (tail3 ? nacTail3D * 0.9 : 0); })();
  const fin = {
    rootLE: vxRoot, rootTE: vxRoot + vcr, tipLE: vxRoot + vh * Math.tan(vsweep), h: vh, zRoot: finRootZ,
  };
  fin.tipTE = fin.tipLE + vct;
  fin.xMin = Math.min(fin.rootLE, fin.tipLE) - 0.3; fin.xMax = Math.max(fin.rootTE, fin.tipTE) + 0.3;
  {
    const n = 14, rows = 8;
    for (const side of [1, -1]) {
      const pc = body.piece();
      const rings = [];
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        // extend below root into fuselage
        const zz = fin.zRoot - (j === 0 ? 0.35 * H0 : 0) + vh * t;
        const le = lerp(fin.rootLE, fin.tipLE, t), te = lerp(fin.rootTE, fin.tipTE, t);
        const c = te - le;
        const tc = lerp(0.12, 0.09, t);
        const ring = [];
        for (let k = 0; k <= n; k++) {
          const xf = 0.5 * (1 - Math.cos((k / n) * Math.PI));
          const th = 5 * tc * (0.2969 * Math.sqrt(xf) - 0.126 * xf - 0.3516 * xf * xf + 0.2843 * xf ** 3 - 0.1036 * xf ** 4) * c;
          const xn = le + xf * c;
          const uf = (xn - fin.xMin) / (fin.xMax - fin.xMin);
          const vf = 1 - clamp((zz - fin.zRoot) / vh, 0, 1);
          ring.push([X(xn), side * Math.max(th, 0.002), zz, side > 0 ? 0.5 * uf : 0.5 * (1 - uf), (side > 0 ? 0.5 : 0.75) + 0.25 * vf]);
        }
        rings.push(ring);
      }
      pc.grid(rings, side > 0);
    }
    // fin tip cap
    const cap = body.piece(false);
    const [su, sv] = swatchUV(SW.finBase);
    const zt = fin.zRoot + vh;
    const a = cap.v(X(fin.tipLE), 0, zt, su, sv), bb = cap.v(X(fin.tipTE), 0, zt, su, sv);
    const c1 = cap.v(X((fin.tipLE + fin.tipTE) / 2), 0.04 * vct, zt + 0.01, su, sv), c2 = cap.v(X((fin.tipLE + fin.tipTE) / 2), -0.04 * vct, zt + 0.01, su, sv);
    cap.tri(a, c1, bb); cap.tri(a, bb, c2);
  }

  // ---------------------------------------------------- horizontal tail
  {
    const hsSpan = (g.tTail ? 0.34 : isGA ? 0.31 : isProp ? 0.3 : 0.37) * b * (b > 60 ? 0.92 : 1);
    const hsArea = (g.tTail ? 0.2 : isGA ? 0.2 : 0.25) * ac.wingArea;
    const hTaper = isGA ? 0.65 : 0.33;
    const hcr = (2 * hsArea) / (hsSpan * (1 + hTaper));
    const hsweep = (isGA ? 3 : isProp ? 8 : g.tTail ? 32 : 34) * D2R;
    let hxRoot, hz;
    if (g.tTail) { hxRoot = fin.tipLE + (vct - hcr * 0.9) * 0.5 + 0.05 * vct; hz = fin.zRoot + vh - 0.05; }
    else { hxRoot = Math.min(L - hcr - 0.25 * Lt, fin.rootLE + vcr * 0.25); const pr = profile(hxRoot + hcr * 0.4); hz = pr.cz + pr.ht * (isGA ? 0.1 : 0.05); }
    const hs = hsSpan / 2;
    const hdih = (g.tTail ? -2 : isGA ? 0 : 7) * D2R;
    const sts = [0, hs * 0.5, hs];
    for (const side of [1, -1]) {
      const pc = body.piece();
      const rings = [];
      for (const y of sts) {
        const xl = hxRoot + y * Math.tan(hsweep);
        const c = lerp(hcr, hcr * hTaper, y / hs);
        const zz = hz + y * Math.tan(hdih);
        const ring = [];
        for (const [xf, zf, sp] of airfoil(10, 0.1, 0)) {
          const [u, v] = swatchUV(zf >= 0 ? SW.stab : SW.stabUnder);
          ring.push([X(xl + xf * c), side * y, zz + zf * c, u, v]);
        }
        rings.push(ring);
      }
      pc.grid(rings, side < 0);
      const last = rings[rings.length - 1];
      const cap = body.piece(false);
      const ids = last.map((q) => cap.v(q[0], q[1], q[2], q[3], q[4]));
      const n = ids.length;
      for (let k = 1; k < n / 2 - 1; k++) {
        if (side > 0) cap.quad(ids[k], ids[k + 1], ids[n - 2 - k], ids[n - 1 - k]); else cap.quad(ids[k], ids[n - 1 - k], ids[n - 2 - k], ids[k + 1]);
      }
    }
  }

  // ------------------------------------------------------------ engines
  const engines = []; // {x,y,z, D, len, type, node}
  const D = g.nacD || 2;
  function revolve(node, prof, cx, cy, cz, swOrRegion, opts = {}) {
    // prof: [[dx, r], ...] from front to back; revolves around x axis
    const pc = node.piece();
    const seg = opts.seg || 28;
    const rings = [];
    const total = prof.length - 1;
    prof.forEach(([dx, r], j) => {
      const ring = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        let yy = Math.cos(a) * r, zz = Math.sin(a) * r;
        if (opts.flatBottom && zz < 0) zz *= opts.flatBottom;
        let u, v;
        if (swOrRegion === 'nacelle') { u = 0.5 + 0.25 * (k / seg); v = 0.5 + 0.25 * (j / total); }
        else [u, v] = swatchUV(typeof swOrRegion === 'function' ? swOrRegion(j, k) : swOrRegion);
        ring.push([cx - dx, cy + yy, cz + zz, u, v]);
      }
      rings.push(ring);
    });
    pc.grid(rings, true);
    return pc;
  }
  function pylon(x0, x1, y, zBot, zTop, w) {
    const pc = body.piece(false);
    const [u, v] = swatchUV(SW.pylon);
    const pts = [
      [x0, y + w, zBot], [x1, y + w, zBot], [x1 - 0.1, y + w, zTop], [x0 - (x0 - x1) * 0.15, y + w, zTop],
      [x0, y - w, zBot], [x1, y - w, zBot], [x1 - 0.1, y - w, zTop], [x0 - (x0 - x1) * 0.15, y - w, zTop],
    ];
    const id = pts.map((p) => pc.v(p[0], p[1], p[2], u, v));
    const f = (a, b2, c, d) => pc.quad(id[a], id[b2], id[c], id[d]);
    f(0, 1, 2, 3); f(5, 4, 7, 6); f(4, 0, 3, 7); f(1, 5, 6, 2); f(3, 2, 6, 7); f(4, 5, 1, 0);
  }
  function turbofan(xn0, y, zc, Dn, idx) {
    const len = Dn * (Dn > 3 ? 1.75 : 1.95);
    const cx = X(xn0);
    const prof = [
      [0, 0.42 * Dn], [0.02 * len, 0.47 * Dn], [0.08 * len, 0.5 * Dn], [0.35 * len, 0.5 * Dn], [0.7 * len, 0.45 * Dn], [0.9 * len, 0.38 * Dn], [len, 0.33 * Dn],
    ];
    revolve(body, prof, cx, y, zc, 'nacelle', { flatBottom: g.flatNacelle ? 0.85 : 1 });
    // intake inner wall
    revolve(body, [[0.1 * len, 0.42 * Dn], [0, 0.42 * Dn]], cx, y, zc, SW.intake);
    // core / exhaust
    revolve(body, [[len - 0.02, 0.31 * Dn], [len + 0.18 * len, 0.27 * Dn], [len + 0.2 * len, 0.2 * Dn], [len + 0.4 * len, 0.08 * Dn], [len + 0.45 * len, 0.01]], cx, y, zc, (j) => (j < 2 ? SW.exhaust : SW.metal));
    // fan + spinner node (rotates)
    const fan = new NodeMesh('fan' + idx, [cx - 0.12 * len, y, zc]);
    const disc = fan.piece(false);
    const [fu, fv] = swatchUV(SW.fan);
    const nb = 22;
    const c0 = disc.v(0, 0, 0, fu, fv);
    for (let k = 0; k < nb; k++) {
      const a0 = (k / nb) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / nb * 0.55;
      const r = 0.415 * Dn;
      const p1 = disc.v(-0.02, Math.cos(a0) * r, Math.sin(a0) * r, fu, fv);
      const p2 = disc.v(0.03, Math.cos(a1) * r, Math.sin(a1) * r, fu, fv);
      disc.tri(c0, p1, p2); disc.tri(c0, p2, p1);
    }
    const back = fan.piece(false); const [iu, iv] = swatchUV(SW.intake);
    const bc = back.v(-0.06, 0, 0, iu, iv); const ringIds = [];
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ringIds.push(back.v(-0.06, Math.cos(a) * 0.42 * Dn, Math.sin(a) * 0.42 * Dn, iu, iv)); }
    for (let k = 0; k < 24; k++) back.tri(bc, ringIds[k + 1], ringIds[k]);
    revolve(fan, [[-0.25 * Dn, 0.005], [-0.18 * Dn, 0.06 * Dn], [-0.06 * Dn, 0.12 * Dn], [0.02, 0.13 * Dn]], 0, 0, 0, SW.spinner, { seg: 16 });
    // spinner swirl mark
    const sw = fan.piece(false); const [wu, wv] = swatchUV(SW.white);
    const a1 = sw.v(0.2 * Dn + 0.0, 0, 0.0, wu, wv);
    const a2 = sw.v(0.1 * Dn, 0.04 * Dn, 0.105 * Dn, wu, wv), a3 = sw.v(0.0, 0.0, 0.131 * Dn, wu, wv);
    sw.tri(a1, a2, a3); sw.tri(a1, a3, a2);
    extraNodes.push(fan);
    engines.push({ x: cx, y, z: zc, D: Dn, len, type: 'fan', node: 'fan' + idx });
    return len;
  }
  function propEngine(xn0, y, zc, Dn, len, idx, shape = 'nacelle') {
    const cx = X(xn0);
    if (shape === 'nacelle') {
      const prof = [[0.06 * len, 0.2 * Dn], [0.12 * len, 0.42 * Dn], [0.25 * len, 0.5 * Dn], [0.6 * len, 0.48 * Dn], [0.85 * len, 0.32 * Dn], [len, 0.08 * Dn]];
      revolve(body, prof, cx, y, zc, 'nacelle');
    }
    // propeller node
    const pd = ac.engines.propD || 2;
    const hub = [cx + 0.02, y, zc];
    const pr = new NodeMesh('prop' + idx, hub);
    revolve(pr, [[-0.32 * Dn, 0.01], [-0.25 * Dn, 0.12 * Dn], [-0.08 * Dn, 0.2 * Dn], [0.06 * len, 0.2 * Dn]], 0, 0, 0, SW.spinner, { seg: 16 });
    const nb = ac.engines.blades || 4;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2;
      const bl = pr.piece(false);
      const r0 = 0.12 * Dn, r1 = pd / 2;
      const chordB = Math.max(0.12, pd * 0.07);
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [];
      for (const [r, cw, twist] of [[r0, chordB * 0.7, 0.9], [r1 * 0.5, chordB, 0.55], [r1 * 0.92, chordB * 0.75, 0.3], [r1, chordB * 0.3, 0.25]]) {
        const dxp = Math.sin(twist) * cw * 0.5, dt = Math.cos(twist) * cw * 0.5;
        // tangent direction (perp to radial in YZ plane)
        const ty = -sa, tz = ca;
        pts.push([[dxp, ca * r + ty * dt, sa * r + tz * dt], [-dxp, ca * r - ty * dt, sa * r - tz * dt], r]);
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const tipCol = pts[j + 1][2] > r1 * 0.9 ? SW.bladeTip : SW.blade;
        const [u, v] = swatchUV(tipCol);
        const [u2, v2] = swatchUV(SW.blade);
        const A1 = bl.v(...pts[j][0], u2, v2), B1 = bl.v(...pts[j][1], u2, v2), A2 = bl.v(...pts[j + 1][0], u, v), B2 = bl.v(...pts[j + 1][1], u, v);
        bl.quad(A1, A2, B2, B1); bl.quad(A1, B1, B2, A2);
      }
    }
    extraNodes.push(pr);
    engines.push({ x: cx, y, z: zc, D: Dn, len, type: 'prop', node: 'prop' + idx, propD: pd });
  }

  let ei = 0;
  for (const e of g.eng) {
    if (e.mount === 'wing') {
      for (const side of [1, -1]) {
        const y = e.y * s;
        const sec = wingSection(y);
        const len = D * (D > 3 ? 1.75 : 1.95);
        const xn0 = sec.xl - len * (D > 3 ? 0.62 : 0.55);
        const zc = sec.z - (g.flatNacelle ? 0.42 : 0.62) * D - 0.08 * sec.c * 0.12;
        turbofan(xn0, side * y, zc, D, ei++);
        pylon(X(xn0 + len * 0.15), X(sec.xl + sec.c * 0.55), side * y, zc + 0.35 * D, sec.z + 0.02, 0.09 * D);
      }
    } else if (e.mount === 'tail') {
      const len = D * 2.3;
      const xn0 = (g.vt?.x || 0.78) * L - len * 0.62;
      const pr = profile(xn0 + len * 0.5);
      const zc = pr.cz + pr.ht * 0.3;
      for (const side of [1, -1]) {
        const y = side * (pr.hw * 0.95 + 0.62 * D);
        turbofan(xn0, y, zc, D, ei++);
        const pc = body.piece(false); const [u, v] = swatchUV(SW.pylon);
        const x0 = X(xn0 + len * 0.3), x1 = X(xn0 + len * 0.75);
        const yi = side * pr.hw * 0.6, yo = y - side * 0.4 * D;
        const t = 0.08 * D;
        const ids = [[x0, yi, zc + t], [x1, yi, zc + t], [x1, yo, zc + t], [x0, yo, zc + t], [x0, yi, zc - t], [x1, yi, zc - t], [x1, yo, zc - t], [x0, yo, zc - t]].map((p) => pc.v(p[0], p[1], p[2], u, v));
        pc.quad(ids[0], ids[1], ids[2], ids[3]); pc.quad(ids[0], ids[3], ids[2], ids[1]);
        pc.quad(ids[4], ids[5], ids[6], ids[7]); pc.quad(ids[4], ids[7], ids[6], ids[5]);
      }
    } else if (e.mount === 'tail3') {
      const len = D * 2.6;
      const xn0 = fin.rootLE - len * 0.15;
      const pr = profile(xn0 + len * 0.5);
      const zc = pr.top + D * 0.45;
      turbofan(xn0, 0, zc, D, ei++);
    } else if (e.mount === 'highwing' || e.mount === 'lowwing') {
      for (const side of [1, -1]) {
        const y = e.y * s;
        const sec = wingSection(y);
        const len = e.mount === 'highwing' ? sec.c * 1.9 : sec.c * 1.55;
        const xn0 = sec.xl - len * (e.mount === 'highwing' ? 0.32 : 0.4);
        const zc = e.mount === 'highwing' ? sec.z - D * 0.18 : sec.z + D * 0.05;
        propEngine(xn0, side * y, zc, D, len, ei++);
      }
    } else if (e.mount === 'nose') {
      propEngine(-0.05, 0, profile(0.3).cz, g.d * 0.55, 0.3, ei++, 'none');
    }
  }

  // ------------------------------------------------------- C172 wing strut
  if (g.strut) {
    for (const side of [1, -1]) {
      const pc = body.piece(); const [u, v] = swatchUV(SW.base);
      const y0 = R * 0.95, z0 = profile(wingX + cr * 0.4).bot + 0.15, y1 = s * 0.55, z1 = wingZ(y1) - 0.05;
      const xx = X(wingX + cr * 0.3), w = 0.05, t = 0.02;
      const ids = [[xx + w, y0, z0], [xx - w, y0, z0], [xx - w, y1, z1], [xx + w, y1, z1]].map((p) => pc.v(p[0], side * p[1], p[2] + t, u, v));
      const ids2 = [[xx + w, y0, z0], [xx - w, y0, z0], [xx - w, y1, z1], [xx + w, y1, z1]].map((p) => pc.v(p[0], side * p[1], p[2] - t, u, v));
      pc.quad(...ids); pc.quad(ids[0], ids[3], ids[2], ids[1]); pc.quad(...ids2); pc.quad(ids2[0], ids2[3], ids2[2], ids2[1]);
    }
  }

  // ------------------------------------------------------- landing gear
  const wheelR = Math.min(0.68, 0.2 + 0.0013 * Math.sqrt(ac.mtow));
  let groundZ = -(H0 + g.gc); // contact plane in model z (at mid fuselage)
  // keep realistic clearance under engine pods / propellers
  for (const e of engines) {
    const bottom = e.z - (e.type === 'prop' && e.propD ? Math.max(e.D * 0.5, e.propD * 0.5) : e.D * 0.5);
    const need = e.type === 'prop' ? 0.3 : 0.45;
    if (Math.abs(e.y) > 0.1 && bottom - groundZ < need) groundZ = bottom - need;
  }
  const mainX = X(xcg + 0.055 * L * (isGA ? 0.4 : 1) + (g.eng[0].mount === 'tail' ? 0.01 * L : 0));
  const noseX = X(isGA ? 0.06 * L : g.eng[0].mount === 'tail' ? 0.085 * L : Math.max(0.09 * L, Ln * 0.55));
  let track;
  if (g.eng[0].mount === 'highwing' && !g.sponson) track = 2 * g.eng[0].y * s;
  else if (g.sponson) track = 2 * (R * 1.3);
  else if (isGA) track = 0.23 * b;
  else track = Math.max(0.16 * b, R * 2.2);
  if (g.eng[0].mount === 'lowwing') track = 2 * g.eng[0].y * s;
  const contactZ = groundZ; // wheel bottom
  function wheel(node, cx, cy, cz, r, w) {
    // cylinder along y
    const pc = node.piece();
    const seg = 18;
    const [tu, tv] = swatchUV(SW.tire);
    const [hu, hv] = swatchUV(SW.metal);
    const rings = [];
    for (const [yy, rr, sw] of [[-w / 2, r * 0.6, 1], [-w / 2, r, 0], [w / 2, r, 0], [w / 2, r * 0.6, 1]]) {
      const ring = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const [u, v] = sw ? [hu, hv] : [tu, tv];
        ring.push([cx + Math.cos(a) * rr, cy + yy, cz + Math.sin(a) * rr, u, v]);
      }
      rings.push(ring);
    }
    pc.grid(rings, false);
  }
  function strut(node, x, y, z0, z1, r) {
    revolveZ(node, x, y, z0, z1, r);
  }
  function revolveZ(node, x, y, z0, z1, r) {
    const pc = node.piece();
    const seg = 10; const [u, v] = swatchUV(SW.gear);
    const rings = [];
    for (const zz of [z0, z1]) {
      const ring = [];
      for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r, zz, u, v]); }
      rings.push(ring);
    }
    pc.grid(rings, true);
  }
  const gearNode = g.fixedGear ? body : gear;
  const strutTopMain = highWing ? profile(xcg).bot + 0.2 : zRootWing;
  // main gear
  const mw = g.mainWheels || 2;
  for (const side of [1, -1]) {
    const y = side * track / 2;
    const axleZ = contactZ + wheelR;
    strut(gearNode, mainX, y, axleZ, isGA ? profile(xcg).bot + 0.1 : strutTopMain + 0.1, Math.max(0.06, wheelR * 0.22));
    const ww = wheelR * 0.75;
    if (mw === 1) wheel(gearNode, mainX, y, axleZ, wheelR, ww);
    else if (mw === 2) { wheel(gearNode, mainX, y + ww * 0.6, axleZ, wheelR, ww); wheel(gearNode, mainX, y - ww * 0.6, axleZ, wheelR, ww); }
    else {
      const rowsN = mw / 2;
      for (let r = 0; r < rowsN; r++) {
        const dx = (r - (rowsN - 1) / 2) * wheelR * 2.25;
        wheel(gearNode, mainX + dx, y + ww * 0.65, axleZ, wheelR, ww); wheel(gearNode, mainX + dx, y - ww * 0.65, axleZ, wheelR, ww);
      }
    }
  }
  if (g.bodyGear) {
    for (const side of [1, -1]) {
      const y = side * R * 0.55;
      const axleZ = contactZ + wheelR;
      strut(gearNode, mainX - wheelR * 1.5, y, axleZ, profile(xcg).bot + 0.2, wheelR * 0.22);
      const rowsN = g.bodyGear / 2;
      for (let r = 0; r < rowsN; r++) {
        const dx = -wheelR * 1.5 + (r - (rowsN - 1) / 2) * wheelR * 2.25;
        wheel(gearNode, mainX + dx, y + wheelR * 0.45, axleZ, wheelR, wheelR * 0.75); wheel(gearNode, mainX + dx, y - wheelR * 0.45, axleZ, wheelR, wheelR * 0.75);
      }
    }
  }
  if (g.centerGear) {
    const axleZ = contactZ + wheelR;
    strut(gearNode, mainX + 0.5, 0, axleZ, profile(xcg).bot + 0.2, wheelR * 0.22);
    wheel(gearNode, mainX + 0.5, wheelR * 0.45, axleZ, wheelR, wheelR * 0.75); wheel(gearNode, mainX + 0.5, -wheelR * 0.45, axleZ, wheelR, wheelR * 0.75);
  }
  // nose gear
  const nwR = wheelR * (isGA ? 0.85 : 0.72);
  {
    const axleZ = contactZ + nwR;
    const nb = profile(xcg - noseX).bot;
    strut(gearNode, noseX, 0, axleZ, nb + 0.15, Math.max(0.05, nwR * 0.22));
    if (isGA) wheel(gearNode, noseX, 0, axleZ, nwR, nwR * 0.7);
    else { wheel(gearNode, noseX, nwR * 0.5, axleZ, nwR, nwR * 0.7); wheel(gearNode, noseX, -nwR * 0.5, axleZ, nwR, nwR * 0.7); }
  }

  // ------------------------------------------------------------ layout
  // tail-strike point: the fuselage-bottom point with the smallest rotation angle about the main gear
  const tailBot = (() => {
    let best = null;
    for (let xn = xcg + 1; xn < L; xn += 0.1) {
      const arm = X(xn) - mainX; if (arm > -1) continue;
      const ang = Math.atan2(profile(xn).bot - contactZ, -arm);
      if (!best || ang < best.ang) best = { x: X(xn), z: profile(xn).bot, ang };
    }
    return best;
  })();
  // published tail-strike pitch attitudes (deg, main gear compressed)
  const TAIL_STRIKE = { 'a220-300': 12, a319neo: 13.5, a320neo: 11.7, a321neo: 9.7, 'a330-300': 10, 'a330-900': 10, 'a340-600': 9, 'a350-900': 11, 'a350-1000': 9.5,
    'a380-800': 11.5, 'b737-700': 14.7, 'b737-800': 11, 'b737-max8': 11, 'b737-max9': 9.7, 'b747-400': 12.5, 'b747-8i': 11, 'b757-200': 12, 'b767-300er': 11,
    'b777-200er': 10.5, 'b777-300er': 8.5, b777f: 10.5, 'b777-9': 9, 'b787-8': 11, 'b787-9': 9.5, 'b787-10': 8.7, 'md-11f': 9.5, e175: 12, 'e190-e2': 11,
    'e195-e2': 9.5, crj900: 9.5, 'dash8-400': 8, 'atr72-600': 9.5, c919: 11, ssj100: 11, g650: 12, kingair350: 14, c172: 12 };
  if (TAIL_STRIKE[ac.id]) { const arm = mainX - tailBot.x; tailBot.ang = TAIL_STRIKE[ac.id] * D2R; tailBot.z = contactZ + Math.tan(tailBot.ang) * arm; }
  const layout = {
    L, R, H0, Ln, Lt, tailStart, xcg, profile, fin, wingX, cr, sweepLE,
    deck2, g, ac,
    doors: computeDoors(ac, L, Ln, wingX, cr, tailStart),
  };
  const physics = {
    gear: [
      { name: 'nose', x: noseX, y: 0, z: contactZ, steer: true, r: nwR },
      { name: 'left', x: mainX, y: track / 2, z: contactZ, brake: true, r: wheelR },
      { name: 'right', x: mainX, y: -track / 2, z: contactZ, brake: true, r: wheelR },
    ],
    strikes: [
      { name: 'tail', x: tailBot.x, y: 0, z: tailBot.z, kind: 'tail' },
      { name: 'leftWingtip', x: tipInfo.x, y: s, z: tipInfo.z, kind: 'wing' },
      { name: 'rightWingtip', x: tipInfo.x, y: -s, z: tipInfo.z, kind: 'wing' },
      { name: 'nose', x: X(0.2), y: 0, z: profile(0.2).bot, kind: 'nose' },
      ...engines.filter((e) => Math.abs(e.z) > 0.1 && e.z < 0).map((e, i) => ({ name: 'engine' + i, x: e.x, y: e.y, z: e.z - e.D * 0.48, kind: 'engine' })),
    ],
    lights: {
      navLeft: [tipInfo.x - 0.3, s + (g.tip === 'none' || g.tip === 'raked' ? 0.05 : 0.1), tipInfo.z + 0.1],
      navRight: [tipInfo.x - 0.3, -s - 0.05, tipInfo.z + 0.1],
      tail: [X(L) + 0.1, 0, profile(L - 0.05).cz],
      beaconTop: [X(wingX + cr * 0.4), 0, profile(wingX).top + 0.1],
      beaconBot: [X(wingX + cr * 0.2), 0, profile(wingX + cr).bot - 0.1],
      landing: [X(wingX + 0.3), 0, zRootWing],
    },
    eye: (() => { const xn = Ln * (g.deck2 ? 0.75 : 0.58); const pr = profile(xn); return [X(xn), R * 0.28, pr.top - Math.max(0.55, 0.32 * H0)]; })(),
    engines: engines.map((e) => ({ x: e.x, y: e.y, z: e.z, D: e.D, node: e.node, type: e.type, len: e.len })),
    tailAngle: tailBot.ang * 180 / Math.PI, xcg, tailArm: (fin.rootLE + vcr * 0.4) - xcg, groundZ: contactZ, wheelR,
  };
  if (g.nose === 'c172') physics.eye = [X(Ln + 0.6), R * 0.3, profile(Ln + 0.6).cz + 0.35];
  const nodes = [body.finalize(), ...(g.fixedGear ? [] : [gear.finalize()]), ...extraNodes.map((n) => n.finalize())];
  return { nodes, layout, physics };
}

function computeDoors(ac, L, Ln, wingX, cr, tailStart) {
  const cat = ac.category;
  if (cat === 'General aviation') return [];
  const doors = [];
  const w = cat === 'Wide-body' || cat === 'Cargo' ? 1.07 : cat === 'Business jet' || cat === 'Turboprop' && ac.length < 20 ? 0.8 : 0.86;
  const h = cat === 'Wide-body' || cat === 'Cargo' ? 1.93 : cat === 'Business jet' ? 1.6 : 1.85;
  doors.push({ x: Ln * 1.05, w, h, kind: 'main' });
  if (cat === 'Wide-body') {
    const n = ac.length > 70 ? 5 : ac.length > 60 ? 4 : 4;
    const x0 = Ln * 1.05, x1 = tailStart + 0.4;
    for (let k = 1; k < n; k++) doors.push({ x: lerp(x0, x1, k / (n - 1)), w, h, kind: 'main' });
  } else if (cat !== 'Business jet') {
    doors.push({ x: tailStart + 0.6, w, h, kind: 'main' });
    if (cat === 'Narrow-body') {
      doors.push({ x: wingX + cr * 0.32, w: 0.51, h: 0.97, kind: 'overwing' });
      if (ac.length > 37) doors.push({ x: wingX + cr * 0.32 + 1.1, w: 0.51, h: 0.97, kind: 'overwing' });
    }
  }
  if (ac.cargo) return [doors[0]];
  return doors;
}
