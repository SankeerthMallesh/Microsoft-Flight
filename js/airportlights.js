// Airport lighting: runway edge / centreline / touchdown zone / threshold / end lights, approach lighting
// systems (ALSF-2, MALSR, ICAO CAT II/III, REIL) with sequenced flashers ("rabbit"), PAPI, taxiway
// centreline (green, green/yellow near runways) and edge (blue) lights, red stop bars, flashing runway
// guard lights and apron floodlights with light pools on the ground.
// Built once per airport into a few BillboardCollections (one shared glow sprite); directional lights are
// split into two "faces" per runway and the visible face follows the camera direction.
import { runwayInfo, offsetLL } from './runways.js';
import { SegGrid, segClosest, pointInRing } from './airportdetail.js';

const FT = 0.3048;
const FAA = new Set(['US', 'CA', 'PR', 'GU', 'VI', 'AS', 'MP']);
let GLOW = null, POOL = null;
function glowURL() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.14, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (GLOW = c.toDataURL());
}
function poolCanvas() {
  if (POOL) return POOL;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,226,170,0.9)'); gr.addColorStop(0.45, 'rgba(255,214,150,0.45)'); gr.addColorStop(1, 'rgba(255,200,130,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (POOL = c);
}

export class AirportLights {
  // opts: { geoid, plane(lat, lon) | null, ground(lat, lon) -> height | undefined, quality }
  constructor(Cesium, scene, ap, opts = {}) {
    this.C = Cesium; this.scene = scene; this.ap = ap; this.opts = opts;
    this.groups = { rwy: [], taxi: [], flood: [], papi: [] };
    this.cols = []; this.prims = []; this.runways = []; this.flashers = []; this.guards = []; this.papis = [];
    this.levels = {}; this.level = { rwy: -1, taxi: -1, flood: -1, papi: -1 };
    const C = Cesium;
    const near = { rwy: new C.NearFarScalar(60, 1.0, 9000, 0.22), cl: new C.NearFarScalar(40, 1.0, 5000, 0.18), taxi: new C.NearFarScalar(30, 1.0, 4000, 0.2), flood: new C.NearFarScalar(100, 1.0, 9000, 0.3) };
    this.nf = near;
    this.fadeTaxi = new C.NearFarScalar(2500, 1, 6500, 0);
    this.eye = new C.Cartesian3(0, 0, -1.5);
    this._t = 0; this._pt = 0;
    this._cb = () => this.frame();
    scene.preRender.addEventListener(this._cb);
  }
  coll(group) {
    const c = this.scene.primitives.add(new this.C.BillboardCollection({ scene: this.scene }));
    this.cols.push(c); if (group) this.groups[group].push(c);
    return c;
  }
  bb(coll, pos, color, size, nf, fade) {
    const b = coll.add({ position: pos, image: glowURL(), color, width: size, height: size, scaleByDistance: nf, eyeOffset: this.eye, translucencyByDistance: fade });
    b._c = color; return b;
  }
  // ---------------------------------------------------------------- runways
  buildRunways() {
    const C = this.C, ap = this.ap, o = this.opts, t0 = performance.now();
    this.clearRunways();
    const faa = FAA.has(ap.k);
    const W = C.Color.fromCssColorString('#fff3d6'), Y = C.Color.fromCssColorString('#ffc21c'), R = C.Color.fromCssColorString('#ff2a1a'),
      G = C.Color.fromCssColorString('#3dff6a'), WA = C.Color.fromCssColorString('#fff8e8'), RR = C.Color.fromCssColorString('#ff3322');
    const omni = this.coll('rwy'), papi = this.coll('papi'), flash = this.coll('rwy');
    this.rwyCols = [omni, papi, flash];
    let n = 0;
    for (const r of ap.r) {
      const info = runwayInfo(r); if (!(info.L > 300)) continue;
      const L = info.L, w = info.w, disp = [(r[10] || 0) * FT, (r[11] || 0) * FT];
      if (disp[0] + disp[1] > L * 0.6) { disp[0] = disp[1] = 0; }
      const big = L >= 2400 && w >= 44, med = !big && L >= 1500 && w >= 29;
      const hAlong = o.plane
        ? (a) => { const [la, lo] = offsetLL(info.la1, info.lo1, info.hdg, Math.max(0, Math.min(L, a))); return o.plane(la, lo); }
        : (a) => info.e1 + (info.e2 - info.e1) * Math.max(0, Math.min(1, a / L)) + o.geoid;
      const start = [[info.la1, info.lo1], [info.la2, info.lo2]];
      const P = (f, s, c, dh) => {
        const brg = info.hdg + f * Math.PI;
        const [la, lo] = offsetLL(start[f][0], start[f][1], brg, s);
        const [la2, lo2] = c ? offsetLL(la, lo, brg + Math.PI / 2, c) : [la, lo];
        const a = f ? L - s : s;
        return C.Cartesian3.fromRadians(lo2, la2, hAlong(a) + dh);
      };
      const faces = [this.coll('rwy'), this.coll('rwy')];
      const ent = { faces, flash: [[], []], face: 0, dir: null };
      const [cla, clo] = offsetLL(info.la1, info.lo1, info.hdg, L / 2);
      const pc = C.Cartesian3.fromRadians(clo, cla, hAlong(L / 2)), pe = C.Cartesian3.fromRadians(...offsetLL(info.la1, info.lo1, info.hdg, L / 2 + 50).reverse(), hAlong(L / 2));
      ent.dir = C.Cartesian3.normalize(C.Cartesian3.subtract(pe, pc, new C.Cartesian3()), new C.Cartesian3());
      // ---- edge lights (white, yellow caution zone, red in a displaced area)
      const edgeCol = (f, s) => (s < disp[f] ? R : L - s < Math.min(600, L / 3) ? Y : W);
      const k = Math.max(2, Math.ceil(L / 60));
      for (let i = 0; i <= k; i++) {
        const s0 = (L * i) / k, c0 = edgeCol(0, s0), c1 = edgeCol(1, L - s0);
        for (const side of [-1, 1]) {
          if (c0 === W && c1 === W) { this.bb(omni, P(0, s0, side * (w / 2 + 1), 0.4), W, 22, this.nf.rwy); n++; }
          else { this.bb(faces[0], P(0, s0, side * (w / 2 + 1), 0.4), c0, 22, this.nf.rwy); this.bb(faces[1], P(1, L - s0, -side * (w / 2 + 1), 0.4), c1, 22, this.nf.rwy); n += 2; }
        }
      }
      for (const f of [0, 1]) {
        const F = faces[f], thr = disp[f];
        // threshold (green, toward the approach) with wing bars; runway end (red, toward the runway)
        for (let c = -w / 2; c <= w / 2 + 0.1; c += 3) { this.bb(F, P(f, thr, c, 0.3), G, 22, this.nf.rwy); this.bb(F, P(f, L, c, 0.3), R, 20, this.nf.rwy); n += 2; }
        if (big || med) for (const sd of [-1, 1]) for (let j = 0; j < 5; j++) { this.bb(F, P(f, thr, sd * (w / 2 + 2 + j * 1.5), 0.4), G, 22, this.nf.rwy); n++; }
        // centreline: white, alternating red/white 900-300 m to go, red last 300 m
        if (big) {
          for (let s0 = 7.5, j = 0; s0 < L; s0 += 15, j++) {
            const s = f ? L - s0 : s0, rem = L - s;
            const col = rem < 300 ? R : rem < 900 ? (j % 2 ? R : W) : W;
            this.bb(F, P(f, s, 0.6, 0.06), col, 14, this.nf.cl); n++;
          }
          // touchdown zone: barrettes either side for 900 m
          for (let s = thr + 60; s < Math.min(thr + 900, L / 2); s += 30) for (const sd of [-1, 1]) for (const c of [11, 12.5, 14]) { this.bb(F, P(f, s, sd * c, 0.06), W, 14, this.nf.cl); n++; }
        }
        // ---- approach lighting
        const appr = (d, c, col, size = 20) => { const s = thr - d; this.bb(F, P(f, s, c, this.apH(P, f, s)), col, size, this.nf.rwy); n++; };
        const barrette = (d) => { for (let c = -2; c <= 2; c++) appr(d, c, WA, 19); };
        const flasher = (d, c = 0) => { const s = thr - d; const b = this.bb(flash, P(f, s, c, this.apH(P, f, s) + 0.4), C.Color.WHITE, 48, this.nf.rwy); b.show = false; ent.flash[f].push(b); n++; };
        if (big && faa) { // ALSF-2: 2400 ft, red side rows, 500/1000 ft bars, sequenced flashers outboard of 1000 ft
          for (let d = 30; d <= 720; d += 30) barrette(d);
          for (const sd of [-1, 1]) { for (let j = 0; j < 4; j++) appr(150, sd * (3.5 + j * 1.5), WA); for (let j = 0; j < 8; j++) appr(300, sd * (4.5 + j * 1.5), WA); }
          for (let d = 30; d <= 270; d += 30) for (const sd of [-1, 1]) for (const c of [11, 12.5, 14]) appr(d, sd * c, RR, 17);
          for (let d = 720; d >= 330; d -= 30) flasher(d);
        } else if (big) { // ICAO CAT II/III (Calvert style): 900 m, five crossbars, red side barrettes inner 270 m
          for (let d = 30; d <= 900; d += 30) barrette(d);
          for (let q = 1; q <= 5; q++) for (const sd of [-1, 1]) for (let c = 3.5; c <= 3 + q * 3; c += 1.5) appr(q * 150, sd * c, WA);
          for (let d = 30; d <= 270; d += 30) for (const sd of [-1, 1]) for (const c of [11, 12.5, 14]) appr(d, sd * c, RR, 17);
        } else if (med && faa) { // MALSR: 1400 ft, 1000 ft bar, five sequenced flashers beyond
          for (let d = 61; d <= 427; d += 61) barrette(d);
          for (const sd of [-1, 1]) for (let j = 0; j < 4; j++) appr(305, sd * (3.5 + j * 1.5), WA);
          for (let d = 732; d >= 488; d -= 61) flasher(d);
        } else if (med) { // ICAO simple approach lighting: 420 m with a 300 m crossbar
          for (let d = 30; d <= 420; d += 30) appr(d, 0, WA);
          for (const sd of [-1, 1]) for (let c = 2; c <= 15; c += 2.5) appr(300, sd * c, WA);
        } else if (L >= 900) { flasher(0, -(w / 2 + 10)); flasher(0, w / 2 + 10); ent.reil = ent.reil || [false, false]; ent.reil[f] = true; }
        // ---- PAPI (left side, 4 units)
        if (L >= 900) {
          const s = thr + Math.min(big ? 320 : 240, L * 0.25);
          const ths = [3.5, 3.17, 2.83, 2.5];
          for (let j = 0; j < 4; j++) {
            const pos = P(f, s, -(w / 2 + 15 + j * 9), 0.6);
            const b = this.bb(papi, pos, C.Color.WHITE, 24, this.nf.rwy);
            this.papis.push({ b, pos, th: ths[j], f, ent, up: C.Ellipsoid.WGS84.geodeticSurfaceNormal(pos, new C.Cartesian3()) });
            n++;
          }
        }
      }
      faces[1].show = false;
      this.runways.push(ent);
    }
    this.counts = { ...(this.counts || {}), runway: n };
    this.buildMs = Math.round(performance.now() - t0);
    this.level.rwy = this.level.papi = -1; this.applyLevels();
  }
  // approach light height: on stanchions above the threshold elevation, or on the ground where it rises
  apH(P, f, s) { return 0.8; }
  clearRunways() {
    for (const e of this.runways) for (const c of e.faces) this.remove(c);
    for (const c of this.rwyCols || []) this.remove(c);
    this.runways = []; this.papis = []; this.rwyCols = [];
  }
  remove(c) { this.scene.primitives.remove(c); this.cols = this.cols.filter((x) => x !== c); for (const g of Object.values(this.groups)) { const i = g.indexOf(c); if (i >= 0) g.splice(i, 1); } }
  // ---------------------------------------------------------------- taxiways, stop bars, floodlights
  buildNet(detail, frame) {
    const C = this.C, t0 = performance.now();
    if (!detail) return;
    for (const c of this.netCols || []) this.remove(c);
    for (const p of this.prims) this.scene.primitives.remove(p);
    this.prims = []; this.guards = [];
    const taxi = this.coll('taxi'), flood = this.coll('flood'), guard = this.coll('taxi');
    this.netCols = [taxi, flood, guard];
    const GR = C.Color.fromCssColorString('#2bff5a'), YE = C.Color.fromCssColorString('#ffcc22'), BL = C.Color.fromCssColorString('#3a6dff'), RD = C.Color.fromCssColorString('#ff2618'), FL = C.Color.fromCssColorString('#ffe7bf');
    const pos = (x, y, dh) => { const [la, lo] = frame.fromXY(x, y); return C.Cartesian3.fromRadians(lo, la, frame.planeXY(x, y) + dh); };
    const { taxis, aprons, rwys, holds } = detail;
    const cap = { high: 9000, medium: 6000, low: 3000 }[this.opts.quality] ?? 6000;
    const grid = new SegGrid(60);
    taxis.forEach((t, wi) => { for (let i = 1; i < t.pts.length; i++) grid.add(t.pts[i - 1], t.pts[i], wi); });
    const onOther = (p, wi) => { for (const e of grid.near(p, 40)) if (e.data !== wi && segClosest(p, e.a, e.b).d < taxis[e.data].hw - 0.5) return true; return false; };
    const rloc = (p, R) => { const v = [p[0] - R.p1[0], p[1] - R.p1[1]]; return { along: v[0] * R.u[0] + v[1] * R.u[1], cross: R.u[0] * v[1] - R.u[1] * v[0] }; };
    const rwyZone = (p) => { let z = 0; for (const R of rwys) { const l = rloc(p, R); if (l.along < -60 || l.along > R.L + 60) continue; const c = Math.abs(l.cross); if (c < R.w / 2 + 4) return 2; if (c < (R.w >= 44 ? 76 : 50)) z = 1; } return z; };
    const inApron = (p) => aprons.some((r) => pointInRing(p[0], p[1], r));
    let n = 0;
    for (let wi = 0; wi < taxis.length && n < cap; wi++) {
      const t = taxis[wi]; if (t.kind !== 'taxiway') continue;
      let carry = 0, j = 0;
      for (let i = 1; i < t.pts.length; i++) {
        const a = t.pts[i - 1], b = t.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 0.1) continue;
        const ux = dx / l, uy = dy / l;
        // tighter spacing on curves
        let step = 30;
        if (i + 1 < t.pts.length) { const c = t.pts[i + 1], ex = c[0] - b[0], ey = c[1] - b[1], el = Math.hypot(ex, ey) || 1; if ((ux * ex + uy * ey) / el < 0.97) step = 15; }
        if (l < 25) step = 15;
        for (let s = carry; s < l; s += step) {
          const p = [a[0] + ux * s, a[1] + uy * s];
          const z = rwyZone(p);
          if (z < 2 && !inApron(p)) { this.bb(taxi, pos(p[0], p[1], 0.05), z === 1 && (j % 2) ? YE : GR, 12, this.nf.taxi, this.fadeTaxi); n++; j++; }
          // blue edge lights where no other pavement continues
          if (j % 2 === 0 && step === 30 || step === 15 && j % 3 === 0) for (const sd of [-1, 1]) {
            const q = [p[0] - uy * sd * (t.hw + 0.6), p[1] + ux * sd * (t.hw + 0.6)];
            if (rwyZone(q) === 2 || inApron(q) || onOther(q, wi)) continue;
            this.bb(taxi, pos(q[0], q[1], 0.35), BL, 11, this.nf.taxi, this.fadeTaxi); n++;
          }
          carry = s + step - l;
        }
        if (carry < 0) carry = 0;
      }
    }
    // red stop bars + yellow runway guard lights (wig-wag) at runway holding positions
    for (const h of holds) {
      if (h.type === 'inter') continue;
      const r = [h.d[1], -h.d[0]];
      if (h.type === 'runway') for (let c = -h.hw + 1; c <= h.hw - 0.9; c += 3) { const p = [h.p[0] + r[0] * c - h.d[0] * 1.5, h.p[1] + r[1] * c - h.d[1] * 1.5]; this.bb(taxi, pos(p[0], p[1], 0.06), RD, 13, this.nf.taxi, this.fadeTaxi); n++; }
      for (const sd of [-1, 1]) for (const k of [-0.25, 0.25]) {
        const p = [h.p[0] + r[0] * sd * (h.hw + 3 + k) - h.d[0] * 2, h.p[1] + r[1] * sd * (h.hw + 3 + k) - h.d[1] * 2];
        const b = this.bb(guard, pos(p[0], p[1], 0.75), YE, 18, this.nf.taxi, this.fadeTaxi); b.show = false;
        this.guards.push({ b, ph: k < 0 ? 0 : 1 }); n++;
      }
    }
    // apron floodlights: glowing heads + warm light pools on the ground
    const pq = { pos: [], st: [], idx: [], nrm: [] };
    for (const f of detail.floods) {
      for (const k of [-1, 0, 1]) { const q = [f.p[0] + f.dir[0] * 0.4 - f.dir[1] * k, f.p[1] + f.dir[1] * 0.4 + f.dir[0] * k]; this.bb(flood, pos(q[0], q[1], f.top + 0.1), FL, 34, this.nf.flood); n++; }
      const c = [f.p[0] + f.dir[0] * 26, f.p[1] + f.dir[1] * 26], rr = f.top * 1.7;
      const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
      const b0 = pq.pos.length / 3;
      for (const [ex, ey, u, v] of corners) {
        const p = pos(c[0] + ex * rr, c[1] + ey * rr, -0.015); pq.pos.push(p.x, p.y, p.z);
        const nn = C.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new C.Cartesian3()); pq.nrm.push(nn.x, nn.y, nn.z); pq.st.push(u, v);
      }
      pq.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    if (pq.idx.length) {
      const geometry = new C.Geometry({
        attributes: {
          position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pq.pos) }),
          normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(pq.nrm) }),
          st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(pq.st) }),
        },
        indices: new Uint32Array(pq.idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pq.pos),
      });
      this.poolMat = C.Material.fromType('Image', { image: poolCanvas(), transparent: true, color: new C.Color(1, 1, 1, 0) });
      this.pools = this.scene.primitives.add(new C.Primitive({
        geometryInstances: new C.GeometryInstance({ geometry }),
        appearance: new C.MaterialAppearance({ material: this.poolMat, flat: true, translucent: true, faceForward: true, closed: false, renderState: { depthMask: false, blending: C.BlendingState.ADDITIVE_BLEND } }),
        asynchronous: false, shadows: C.ShadowMode.DISABLED,
      }));
      this.pools.show = false;
      this.prims.push(this.pools);
    }
    this.counts = { ...(this.counts || {}), net: n };
    this.netMs = Math.round(performance.now() - t0);
    this.level.taxi = this.level.flood = -1; this.applyLevels();
  }
  // ---------------------------------------------------------------- day / night
  setDay(sunK, weather) {
    const night = Math.max(0, Math.min(1, (0.72 - (sunK ?? 1)) / 0.4));
    const lowVis = weather === 'overcast' || weather === 'storm';
    this.levels = { rwy: Math.max(night, lowVis ? 0.75 : 0), taxi: Math.max(night, lowVis ? 0.5 : 0), flood: night, papi: Math.max(0.85, night) };
    this.applyLevels();
  }
  applyLevels() {
    const C = this.C;
    for (const [g, cols] of Object.entries(this.groups)) {
      const lv = Math.round((this.levels[g] ?? 0) * 10) / 10;
      if (lv === this.level[g]) continue;
      this.level[g] = lv;
      for (const c of cols) {
        c.show = lv > 0.02 && c._faceShow !== false;
        if (lv > 0.02) for (let i = 0; i < c.length; i++) { const b = c.get(i); if (b._c) b.color = C.Color.fromAlpha(b._c, b._c.alpha * lv, b.color); }
      }
    }
    if (this.pools) { const v = this.levels.flood || 0; this.pools.show = v > 0.02; this.poolMat.uniforms.color = new C.Color(1, 1, 1, 0.2 * v); }
  }
  // ---------------------------------------------------------------- per frame: faces, flashers, PAPI, guards
  frame() {
    const C = this.C, cam = this.scene.camera;
    if (!cam) return;
    const t = performance.now() / 1000, rwyOn = this.level.rwy > 0.02;
    for (const e of this.runways) {
      const d = C.Cartesian3.dot(cam.directionWC, e.dir);
      const f = d > 0.08 ? 0 : d < -0.08 ? 1 : e.face;
      if (f !== e.face) { e.face = f; }
      e.faces[0]._faceShow = f === 0; e.faces[1]._faceShow = f === 1;
      e.faces[0].show = rwyOn && f === 0; e.faces[1].show = rwyOn && f === 1;
      // sequenced flashers: one pass from the outermost toward the threshold, twice per second
      for (const ff of [0, 1]) {
        const fl = e.flash[ff], on = rwyOn && ff === f;
        if (!fl.length) continue;
        if (e.reil && e.reil[ff]) { const s = on && t % 1 < 0.08; for (const b of fl) b.show = s; continue; }
        const ph = (t % 0.5) / 0.5, k = Math.floor(ph * (fl.length + 2));
        for (let i = 0; i < fl.length; i++) fl[i].show = on && i === k;
      }
    }
    if (this.level.taxi > 0.02) { const a = t % 1 < 0.5; for (const g of this.guards) g.b.show = a === (g.ph === 0); }
    // PAPI colours from the camera's elevation angle above each unit (10 Hz)
    if (t - this._pt > 0.1 && this.papis.length) {
      this._pt = t;
      const v = new C.Cartesian3();
      for (const p of this.papis) {
        C.Cartesian3.subtract(cam.positionWC, p.pos, v);
        const dist = C.Cartesian3.magnitude(v);
        const front = C.Cartesian3.dot(v, p.ent.dir) * (p.f ? 1 : -1) > 0;
        p.b.show = front && dist < 25000;
        if (!p.b.show) continue;
        const ang = Math.asin(C.Cartesian3.dot(v, p.up) / dist) * 180 / Math.PI;
        const c = ang > p.th ? C.Color.WHITE : C.Color.fromCssColorString('#ff2a1a');
        if (p._col !== c.toCssColorString()) { p._col = c.toCssColorString(); p.b._c = c; p.b.color = C.Color.fromAlpha(c, this.level.papi > 0 ? this.level.papi : 1, p.b.color); }
      }
    }
  }
  destroy() {
    this.scene.preRender.removeEventListener(this._cb);
    for (const c of this.cols) this.scene.primitives.remove(c);
    for (const p of this.prims) this.scene.primitives.remove(p);
    this.cols = []; this.prims = []; this.runways = []; this.papis = [];
  }
}
