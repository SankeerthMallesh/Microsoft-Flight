// Gates: picks a free stand for "Start at gate", parks a few static airliners (low-detail procedural
// models in plausible local liveries) at other stands, and provides a simple tug pushback.
import { getGeometry } from './model/factory.js';
import { paintLivery } from './model/painter.js';
import { writeGLB } from './model/glb.js';
import { getAircraft } from './data/aircraft.js';
import { LIVERIES, getLivery } from './data/liveries.js';
import { rng } from './airportdetail.js';
import { eulerToQuat, quatToEuler } from './sim/math.js';

// home carriers of major airports (livery ids from data/liveries.js); others fall back to the country
const HUBS = {
  KDAL: ['southwest'], KHOU: ['southwest'], KMDW: ['southwest'], KBWI: ['southwest'], KLAS: ['southwest'], KDEN: ['united', 'southwest'],
  KATL: ['delta'], KMSP: ['delta'], KDTW: ['delta'], KSLC: ['delta'], KDFW: ['american'], KCLT: ['american'], KMIA: ['american'], KPHL: ['american'], KPHX: ['american', 'southwest'],
  KORD: ['united', 'american'], KIAH: ['united'], KEWR: ['united'], KSFO: ['united', 'alaska'], KIAD: ['united'], KLAX: ['american', 'delta', 'united', 'alaska'],
  KSEA: ['alaska', 'delta'], KPDX: ['alaska'], KJFK: ['jetblue', 'delta', 'american'], KBOS: ['jetblue', 'delta'], KMEM: ['fedex'], KSDF: ['ups'],
  EGLL: ['british', 'virgin'], EGKK: ['easyjet', 'british'], EGSS: ['ryanair', 'easyjet'], LFPG: ['airfrance'], EHAM: ['klm'], EDDF: ['lufthansa'], EDDM: ['lufthansa'],
  OMDB: ['emirates'], OTHH: ['qatar'], OMAA: ['etihad'], WSSS: ['singapore'], RJTT: ['ana', 'jal'], RJAA: ['ana', 'jal'], LTFM: ['turkish'], VHHH: ['cathay'],
  CYYZ: ['aircanada'], CYVR: ['aircanada'], CYUL: ['aircanada'], YSSY: ['qantas'], YMML: ['qantas'], ZSPD: ['chinaeastern'], UUEE: ['aeroflot'], EIDW: ['ryanair'],
};
const AIRLINE = (l) => Array.isArray(l.fleet) && !/house|plain|ga-|exec|charter/.test(l.id) && l.country !== '—';

const glbCache = new Map();
async function lowDetailGLB(acId, lvId) {
  const key = acId + '|' + lvId;
  if (!glbCache.has(key)) glbCache.set(key, (async () => {
    const geo = getGeometry(acId), lv = getLivery(lvId);
    const { bytes } = await paintLivery(geo.layout, lv);
    const glb = writeGLB(geo.nodes, bytes, { metallic: lv.metallic ?? 0.12, roughness: lv.roughness ?? 0.38 });
    return { url: URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })), physics: geo.physics };
  })());
  return glbCache.get(key);
}

// model matrix: x forward (heading from north, clockwise), y left, z up
function standMatrix(Cesium, lon, lat, h, hdg) {
  const p = Cesium.Cartesian3.fromRadians(lon, lat, h);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p);
  const E = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4()), N = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4()), U = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
  const s = Math.sin(hdg), c = Math.cos(hdg);
  const X = [N.x * c + E.x * s, N.y * c + E.y * s, N.z * c + E.z * s], Y = [N.x * s - E.x * c, N.y * s - E.y * c, N.z * s - E.z * c];
  return new Cesium.Matrix4(X[0], Y[0], U.x, p.x, X[1], Y[1], U.y, p.y, X[2], Y[2], U.z, p.z, 0, 0, 0, 1);
}

export class AirportGates {
  constructor(Cesium, scene, ap, detail, frame, opts = {}) {
    this.C = Cesium; this.scene = scene; this.ap = ap; this.frame = frame; this.opts = opts;
    this.stands = (detail?.stands || []).filter((s) => s.maxSpan >= 15);
    this.models = []; this.k = 1; this.dead = false;
    this.stats = { stands: this.stands.length, parked: 0 };
  }
  // world position of a stand (radians) and heading
  where(s) {
    const [lat, lon] = this.frame.fromXY(s.p[0], s.p[1]);
    return { lat, lon, hdg: Math.atan2(s.f[0], s.f[1]), h: this.frame.planeXY(s.p[0], s.p[1]) - 0.09 };
  }
  // pick a free stand big enough for a wingspan (prefers terminal stands with a jet bridge)
  pick(span) {
    const r = Math.random;
    const free = this.stands.filter((s) => !s.occupied && s.maxSpan >= span + 1);
    const pool = free.length ? free : this.stands.filter((s) => !s.occupied);
    if (!pool.length) return null;
    const score = (s) => (s.hasBridge ? 3 : 0) + (s.terminal ? 2 : 0) - Math.max(0, s.maxSpan - span - 25) * 0.05 + r() * 1.5;
    const s = pool.sort((a, b) => score(b) - score(a))[0];
    s.occupied = 'player';
    const w = this.where(s);
    return { ...w, ref: s.ref, stand: s };
  }
  airlines() {
    const all = LIVERIES.filter(AIRLINE);
    const hub = (HUBS[this.ap.i] || []).map((id) => all.find((l) => l.id === id)).filter(Boolean);
    const local = all.filter((l) => l.country === this.ap.k && !hub.includes(l));
    const rnd = rng(this.ap.i + 'visitors');
    const visitors = all.filter((l) => !hub.includes(l) && !local.includes(l)).sort(() => rnd() - 0.5).slice(0, 3);
    const w = [];
    for (const l of hub) for (let i = 0; i < 6; i++) w.push(l);
    for (const l of local) for (let i = 0; i < 2; i++) w.push(l);
    for (const l of visitors) w.push(l);
    return w.length ? w : all;
  }
  async populate() {
    const Cesium = this.C;
    const n = this.opts.count ?? ({ high: 14, medium: 9, low: 4 }[this.opts.quality] ?? 9);
    if (!n || !this.stands.length) return;
    await new Promise((r) => setTimeout(r, 1500)); // let a "Start at gate" pick its stand first
    const rnd = rng(this.ap.i + 'parked');
    const airlines = this.airlines();
    const cands = this.stands.filter((s) => s.terminal || s.hasBridge).sort(() => rnd() - 0.5);
    const combos = new Map();
    const t0 = performance.now();
    for (const s of cands) {
      if (this.dead || this.stats.parked >= n) break;
      if (s.occupied || rnd() < 0.25) continue; // leave some gates empty
      // airline + a type from its fleet that fits the stand
      let choice = null;
      for (let tries = 0; tries < 6 && !choice; tries++) {
        const lv = airlines[Math.floor(rnd() * airlines.length)];
        const types = (lv.fleet || []).map(getAircraft).filter((a) => a && a.span <= s.maxSpan && !/General aviation|Business/.test(a.category));
        if (!types.length) continue;
        const key = [...combos.keys()].find((k) => k.endsWith('|' + lv.id) && types.some((t) => k.startsWith(t.id + '|')));
        if (key) choice = key;
        else if (combos.size < 5) { const t = types[Math.floor(rnd() * types.length)]; choice = t.id + '|' + lv.id; }
      }
      if (!choice) continue;
      if (!combos.has(choice)) combos.set(choice, lowDetailGLB(...choice.split('|')));
      let g;
      try { g = await combos.get(choice); } catch (e) { continue; }
      if (this.dead || s.occupied) continue;
      s.occupied = 'static';
      const w = this.where(s), noseX = g.physics.gear[0].x;
      const [la, lo] = this.frame.fromXY(s.p[0] - s.f[0] * noseX, s.p[1] - s.f[1] * noseX);
      try {
        const model = await Cesium.Model.fromGltfAsync({
          url: g.url, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X, incrementallyLoadTextures: false,
          modelMatrix: standMatrix(Cesium, lo, la, w.h - g.physics.groundZ, w.hdg),
          shadows: this.opts.quality === 'high' ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED,
        });
        if (this.dead) { model.destroy(); break; }
        this.scene.primitives.add(model);
        this.models.push(model); this.stats.parked++;
        this.applyTint(model);
      } catch (e) { console.warn('parked aircraft failed', e); }
    }
    this.stats.ms = Math.round(performance.now() - t0);
  }
  applyTint(m) {
    const k = this.k;
    m.lightColor = new this.C.Cartesian3(k * 2.0, k * 1.95, k * 1.85);
    if (m.imageBasedLighting) m.imageBasedLighting.imageBasedLightingFactor = new this.C.Cartesian2(k, k);
  }
  tint(k) { if (Math.abs(k - this.k) < 0.01) return; this.k = k; for (const m of this.models) this.applyTint(m); }
  destroy() { this.dead = true; for (const m of this.models) this.scene.primitives.remove(m); this.models = []; }
}

// Tug pushback: rolls the aircraft straight back; rudder / aileron input swings the tail.
export class Pushback {
  constructor(fm, span = 30) {
    this.fm = fm; this.lat = fm.lat; this.lon = fm.lon; this.v = 0; this.dist = 0;
    this.maxDist = Math.max(45, fm.ac.length * 1.3 + 25);
    const e = quatToEuler(fm.q); this.hdg = e.yaw;
    fm.parkingBrake = false;
  }
  // returns false when finished
  update(dt, steer) {
    const fm = this.fm, R = 6371008.8;
    if (!fm.onGround || fm.ctl.throttle > 0.3) return false;
    const left = this.maxDist - this.dist;
    const target = left < 6 ? Math.max(0.25, left / 4) : 1.6;
    this.v += Math.max(-0.5 * dt, Math.min(0.4 * dt, target - this.v));
    const step = this.v * dt;
    this.dist += step;
    this.hdg -= Math.max(-1, Math.min(1, steer || 0)) * (this.v / 22) * dt; // tail right -> nose left
    this.lat -= (Math.cos(this.hdg) * step) / R;
    this.lon -= (Math.sin(this.hdg) * step) / (R * Math.cos(this.lat));
    const e = quatToEuler(fm.q);
    fm.lat = this.lat; fm.lon = this.lon;
    fm.q = eulerToQuat(this.hdg, e.pitch, e.roll);
    fm.vel = [-Math.cos(this.hdg) * this.v, -Math.sin(this.hdg) * this.v, fm.vel ? fm.vel[2] : 0];
    fm.w = [0, 0, 0];
    if (this.dist >= this.maxDist) { fm.vel = [0, 0, 0]; fm.parkingBrake = true; return false; }
    return true;
  }
}
