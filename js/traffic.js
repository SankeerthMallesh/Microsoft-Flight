// Live + AI air traffic ("real-time online traffic").
// - Polls free, no-key ADS-B feeds near the player (airplanes.live, adsb.lol, adsb.fi, OpenSky), falling back
//   from one source to the next and backing off on errors / rate limits.
// - Maps ICAO type + callsign to an OpenSkies aircraft type and airline livery, builds one light GLB per
//   type+livery (1024 px livery atlas, shared GPU resources between instances) and dead-reckons every aircraft
//   between reports (track, ground speed, turn rate, vertical rate) with an error-blending correction, so they glide.
// - Nav / strobe / beacon / landing lights, gear down when low, optional callsign labels.
// - When no live data is reachable, AI aircraft fly arrivals, departures and overflights at the departure airport.
/* global Cesium */
import { getGeometry } from './model/factory.js';
import { paintLivery } from './model/painter.js';
import { writeGLB } from './model/glb.js';
import { getAircraft } from './data/aircraft.js';
import { getLivery } from './data/liveries.js';
import { airportsNear, runwayEnds } from './data/airports.js';
import { D2R, R2D, FT, KT, NM, G0, clamp, wrapPi, eulerToQuat, qrot, distance, destination } from './sim/math.js';

const RANGE_NM = 40; // fetch / keep radius
const MODEL_RANGE = 22000; // m: beyond this an airliner is ~2 px, lights only
const MAX_MODELS = 32;
const MAX_TARGETS = 60;
const MAX_VARIANTS = 14;
const TEX_W = 1024, TEX_H = 512;
const STALE_S = 45;

// ------------------------------------------------------------------ type + airline mapping
const TYPE_MAP = {
  A318: 'a319neo', A319: 'a319neo', A19N: 'a319neo', A320: 'a320neo', A20N: 'a320neo', A321: 'a321neo', A21N: 'a321neo',
  A332: 'a330-200', A333: 'a330-300', A338: 'a330-900', A339: 'a330-900', A342: 'a340-600', A343: 'a340-600', A345: 'a340-600', A346: 'a340-600',
  A359: 'a350-900', A35K: 'a350-1000', A388: 'a380-800', A306: 'a300-600f', A30B: 'a300-600f', A310: 'a300-600f', BCS1: 'a220-300', BCS3: 'a220-300',
  B731: 'b737-700', B732: 'b737-700', B733: 'b737-700', B734: 'b737-700', B735: 'b737-700', B736: 'b737-700', B737: 'b737-700', B738: 'b737-800', B739: 'b737-900er',
  B37M: 'b737-max7', B38M: 'b737-max8', B39M: 'b737-max9', B3XM: 'b737-max10', B741: 'b747-400', B742: 'b747-400', B743: 'b747-400', B744: 'b747-400', B748: 'b747-8i',
  B752: 'b757-200', B753: 'b757-200', B762: 'b767-300er', B763: 'b767-300er', B764: 'b767-400er', B772: 'b777-200er', B77L: 'b777-200er', B77W: 'b777-300er',
  B778: 'b777-9', B779: 'b777-9', B788: 'b787-8', B789: 'b787-9', B78X: 'b787-10', MD11: 'md-11f', DC10: 'md-11f', B712: 'b717-200', MD81: 'b717-200', MD82: 'b717-200', MD83: 'b717-200', MD88: 'b717-200', MD90: 'b717-200',
  E170: 'e175', E75L: 'e175', E75S: 'e175', E190: 'e190', E195: 'e190', E290: 'e190-e2', E295: 'e195-e2', E135: 'crj700', E145: 'crj700', E35L: 'cj4', E545: 'cj4', E550: 'cj4', E55P: 'cj4', E50P: 'cj4',
  CRJ1: 'crj700', CRJ2: 'crj700', CRJ7: 'crj700', CRJ9: 'crj900', CRJX: 'crj900', DH8A: 'dash8-400', DH8B: 'dash8-400', DH8C: 'dash8-400', DH8D: 'dash8-400',
  AT43: 'atr42-600', AT45: 'atr42-600', AT46: 'atr42-600', AT72: 'atr72-600', AT75: 'atr72-600', AT76: 'atr72-600', C919: 'c919', SU95: 'ssj100',
  GLF4: 'g650', GLF5: 'g650', GLF6: 'g650', GA6C: 'g650', GA5C: 'g650', G280: 'g650', GLEX: 'global7500', GL5T: 'global7500', GL7T: 'global7500', GL6T: 'global7500', CL30: 'global7500', CL35: 'global7500', CL60: 'global7500', FA7X: 'global7500', FA8X: 'global7500', F900: 'global7500', F2TH: 'global7500',
  C25A: 'cj4', C25B: 'cj4', C25C: 'cj4', C525: 'cj4', C510: 'cj4', C56X: 'cj4', C560: 'cj4', C68A: 'cj4', C680: 'cj4', C700: 'cj4', C750: 'cj4', LJ45: 'cj4', LJ60: 'cj4', LJ75: 'cj4', H25B: 'cj4', PRM1: 'cj4', HDJT: 'cj4', SF50: 'cj4',
  BE20: 'kingair350', BE30: 'kingair350', B350: 'kingair350', BE9L: 'kingair350', BE40: 'cj4', BE99: 'kingair350', PC12: 'pc12', TBM7: 'pc12', TBM8: 'pc12', TBM9: 'pc12', C208: 'pc12', P46T: 'pc12', PC24: 'cj4',
  C150: 'c172', C152: 'c172', C162: 'c172', C170: 'c172', C172: 'c172', C175: 'c172', C177: 'c172', C182: 'c172', C206: 'c172', C210: 'c172', P210: 'c172',
  SR20: 'sr22', SR22: 'sr22', S22T: 'sr22', DA40: 'sr22', DA42: 'sr22', DA62: 'sr22', BE33: 'sr22', BE35: 'sr22', BE36: 'sr22', BE58: 'sr22', M20P: 'sr22', M20T: 'sr22',
  P28A: 'pa28', P28B: 'pa28', P28R: 'pa28', P28T: 'pa28', PA32: 'pa28', PA34: 'pa28', PA44: 'pa28', PA46: 'pa28', P32R: 'pa28', PA24: 'pa28', PA18: 'pa28', AA5: 'pa28',
};
// airline ICAO prefix -> livery id (regional partners fly in their mainline's colours)
const AIRLINE = {
  SWA: 'southwest', DAL: 'delta', EDV: 'delta', UAE: 'emirates', UAL: 'united', ASH: 'united', GJS: 'united', AAL: 'american', ENY: 'american', JIA: 'american', PDT: 'american',
  BAW: 'british', SHT: 'british', CFE: 'british', DLH: 'lufthansa', CLH: 'lufthansa', AFR: 'airfrance', HOP: 'airfrance', KLM: 'klm', KLC: 'klm', QTR: 'qatar', SIA: 'singapore',
  RYR: 'ryanair', RUK: 'ryanair', EZY: 'easyjet', EJU: 'easyjet', EZS: 'easyjet', ACA: 'aircanada', JZA: 'aircanada', ROU: 'aircanada', QFA: 'qantas', QLK: 'qantas',
  ANA: 'ana', JAL: 'jal', THY: 'turkish', ASA: 'alaska', QXE: 'alaska', JBU: 'jetblue', CPA: 'cathay', ETD: 'etihad', FDX: 'fedex', UPS: 'ups', VIR: 'virgin',
  CES: 'chinaeastern', AFL: 'aeroflot', SKW: 'regional-house', RPA: 'regional-house', EJA: 'exec-gold', LXJ: 'exec-gold', VJT: 'exec-gold',
};
const CODE_OF = Object.fromEntries(Object.entries(AIRLINE).filter(([, v]) => !/house|exec/.test(v)).map(([k, v]) => [v, k]).reverse());
const GA = new Set(['c172', 'sr22', 'pa28']);
const PROPS = new Set(['c172', 'sr22', 'pa28', 'pc12', 'kingair350', 'dash8-400', 'atr72-600', 'atr42-600']);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function classify(t) {
  const cs = (t.cs || '').trim().toUpperCase();
  const pre = /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : '';
  let liveryId = AIRLINE[pre];
  let acId = TYPE_MAP[(t.type || '').toUpperCase()];
  const cat = t.cat || '';
  if (cat === 'A7' || (!acId && /^(H\d|EC\d|AS3|AS5|R22|R44|R66|B06|B407|B429|S76|A109|A139|A169|UH|H60)/.test(t.type || ''))) return { heli: true };
  if (/^B[1-7]$/.test(cat) || /^C\d$/.test(cat)) return { skip: true }; // gliders, balloons, UAVs, ground vehicles
  if (t.ground && !t.type && !pre) return { skip: true }; // unidentified ground transponders (vehicles, tugs)
  if (!acId && liveryId) { // no type in the feed (OpenSky): pick from the airline's real fleet, deterministically
    const fl = getLivery(liveryId).fleet; const pool = Array.isArray(fl) ? fl.filter((id) => !GA.has(id)) : [];
    if (pool.length) acId = pool[hash(t.id) % pool.length];
  }
  if (!acId) acId = { A1: 'c172', A2: 'kingair350', A3: hash(t.id) & 1 ? 'a320neo' : 'b737-800', A4: 'b757-200', A5: 'b777-300er', A6: 'g650' }[cat]
    || (pre ? (hash(t.id) & 1 ? 'a320neo' : 'b737-800') : 'c172');
  if (!liveryId) {
    const c = getAircraft(acId).category;
    liveryId = c === 'General aviation' ? 'ga-classic' : c === 'Business jet' ? (hash(t.id) & 1 ? 'exec-gold' : 'sky-charter') : 'plain-white';
  }
  if (acId === 'b777-200er' && (liveryId === 'fedex' || liveryId === 'ups' || /F$/.test(t.type || ''))) acId = 'b777f';
  return { acId, liveryId };
}

// ------------------------------------------------------------------ data sources
const readsbURL = (base) => (la, lo, r) => `${base}/${la.toFixed(4)}/${lo.toFixed(4)}/${r}`;
function parseReadsb(j) {
  const list = j.ac || j.aircraft || [];
  return list.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number').map((a) => {
    const ground = a.alt_baro === 'ground';
    let alt = ground ? null : typeof a.alt_baro === 'number' ? a.alt_baro : a.alt_geom;
    if (typeof alt === 'number' && alt < 18000 && a.nav_qnh > 900 && a.nav_qnh < 1100) alt += (a.nav_qnh - 1013.25) * 27.3; // pressure -> QNH altitude
    return {
      id: a.hex, cs: (a.flight || a.r || a.hex || '').trim(), reg: a.r, type: a.t, cat: a.category, lat: a.lat, lon: a.lon, altFt: alt,
      gs: (a.gs || 0) * KT, trk: (a.track ?? a.true_heading ?? a.mag_heading ?? 0) * D2R, vs: (a.baro_rate ?? a.geom_rate ?? 0) * FT / 60,
      ground, age: (a.seen_pos ?? a.seen ?? 0),
    };
  });
}
function parseOpenSky(j) {
  const now = j.time || Date.now() / 1000;
  return (j.states || []).filter((s) => s[5] != null && s[6] != null).map((s) => ({
    id: s[0], cs: (s[1] || s[0]).trim(), lat: s[6], lon: s[5], altFt: s[8] ? null : (s[7] ?? s[13] ?? 0) / FT, ground: !!s[8],
    gs: s[9] || 0, trk: (s[10] || 0) * D2R, vs: s[11] || 0, cat: s[17] != null ? ['', '', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3'][s[17]] || '' : '',
    age: Math.max(0, now - (s[3] || now)),
  }));
}
const SOURCES = [
  { name: 'airplanes.live', url: readsbURL('https://api.airplanes.live/v2/point'), parse: parseReadsb, every: 10 },
  { name: 'adsb.lol', url: readsbURL('https://api.adsb.lol/v2/point'), parse: parseReadsb, every: 10 },
  { name: 'adsb.fi', url: (la, lo, r) => `https://opendata.adsb.fi/api/v2/lat/${la.toFixed(4)}/lon/${lo.toFixed(4)}/dist/${r}`, parse: parseReadsb, every: 10 },
  { // anonymous: 400 credits/day, 10 s resolution -> poll gently
    name: 'OpenSky', every: 20, parse: parseOpenSky,
    url: (la, lo, r) => { const d = r / 60, e = d / Math.max(0.2, Math.cos(la * D2R)); return `https://opensky-network.org/api/states/all?lamin=${(la - d).toFixed(3)}&lomin=${(lo - e).toFixed(3)}&lamax=${(la + d).toFixed(3)}&lomax=${(lo + e).toFixed(3)}&extended=1`; },
  },
];

// ------------------------------------------------------------------ helpers
const nowS = () => performance.now() / 1000;
// local metres (north, east) between two lat/lon points (radians); fine for the tens of km we use
const dNE = (la1, lo1, la2, lo2) => [(la2 - la1) * 6371008.8, (lo2 - lo1) * 6371008.8 * Math.cos(la1)];

export class Traffic {
  constructor(world, opts = {}) {
    this.world = world;
    this.enabled = opts.enabled !== false;
    this.labels = opts.labels !== false;
    this.proxy = opts.proxy || ''; // optional CORS proxy prefix, e.g. 'https://my-worker.example/?url='
    this.targets = new Map();
    this.variants = new Map();
    this.buildQueue = []; this.building = false; this.creating = 0;
    this.srcState = SOURCES.map(() => ({ until: 0, fails: 0 }));
    this.srcIdx = 0;
    this.status = 'idle'; this.source = null;
    this.nextFetch = 0; this.lastLive = 0; this.ai = null;
    this.stats = { models: 0, lights: 0, updMs: 0 };
  }

  // ---------------------------------------------------------------- lifecycle
  start(ctx) { // ctx: { ap, rwy, geoid }
    this.stop();
    if (!this.enabled) return;
    const Cesium = window.Cesium, scene = this.world.viewer.scene;
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labelCol = scene.primitives.add(new Cesium.LabelCollection());
    this.ctx = ctx; this.active = true; this.nextFetch = 0; this.lastLive = 0;
    this.ai = new AITraffic(this, ctx);
  }
  stop() {
    this.active = false;
    for (const t of this.targets.values()) this.dropTarget(t, true);
    this.targets.clear();
    const prims = this.world.viewer?.scene.primitives;
    if (this.points) { prims.remove(this.points); this.points = null; }
    if (this.labelCol) { prims.remove(this.labelCol); this.labelCol = null; }
    this.ai = null; this.status = 'idle'; this.source = null;
  }
  setStatus(s) { if (s === this.status) return; this.status = s; if (this.onStatus) this.onStatus(this.statusText(), s); }
  // primitives that the player's ground sampling must ignore
  primitives() { const out = []; if (this.points) out.push(this.points); if (this.labelCol) out.push(this.labelCol); for (const t of this.targets.values()) if (t.model) out.push(t.model); return out; }
  setEnabled(on, ctx) { this.enabled = on; if (!on) this.stop(); else if (ctx) this.start(ctx); }

  // ---------------------------------------------------------------- fetching
  async poll(fm) {
    if (this.fetching) return;
    this.fetching = true;
    const la = fm.lat * R2D, lo = fm.lon * R2D, t = nowS();
    try {
      for (let k = 0; k < SOURCES.length; k++) {
        const i = (this.srcIdx + k) % SOURCES.length, src = SOURCES[i], st = this.srcState[i];
        if (st.until > t) continue;
        try {
          let url = src.url(la, lo, RANGE_NM);
          if (this.proxy) url = this.proxy + encodeURIComponent(url);
          const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 8000);
          const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).finally(() => clearTimeout(to));
          if (r.status === 429) { const ra = +(r.headers.get('retry-after') || r.headers.get('x-rate-limit-retry-after-seconds') || 0); st.until = t + Math.max(ra, 600); continue; }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const list = src.parse(await r.json());
          st.fails = 0; this.srcIdx = i; this.source = src.name; this.setStatus('live'); this.lastLive = nowS();
          this.ingest(list, fm);
          return src.every;
        } catch (e) {
          st.fails++; st.until = t + Math.min(900, 60 * st.fails); // CORS / network / server error: back off, try the next source
        }
      }
      this.setStatus(this.lastLive && nowS() - this.lastLive < 90 ? 'live' : 'ai');
      return 30;
    } finally { this.fetching = false; }
  }

  ingest(list, fm) {
    const t = nowS(), seen = new Set();
    // nearest first, capped
    const withD = list.map((a) => ({ a, d: distance(fm.lat, fm.lon, a.lat * D2R, a.lon * D2R) })).filter((x) => x.d < RANGE_NM * NM * 1.1).sort((x, y) => x.d - y.d).slice(0, MAX_TARGETS);
    for (const { a } of withD) {
      if (!a.id || a.age > 60) continue;
      let tg = this.targets.get(a.id);
      if (!tg) {
        const c = classify(a); if (c.skip) continue;
        tg = this.newTarget(a.id, a, c);
      }
      seen.add(a.id);
      this.report(tg, { lat: a.lat * D2R, lon: a.lon * D2R, altFt: a.altFt, gs: a.gs, trk: a.trk, vs: a.vs, ground: a.ground, t: t - Math.min(a.age || 0, 20) });
      tg.cs = a.cs || tg.cs;
    }
  }

  newTarget(id, a, c) {
    const tg = { id, cs: a.cs || id, typeCode: a.type || '', acId: c.acId, liveryId: c.liveryId, heli: !!c.heli, ai: !!a.ai, rep: null, turn: 0, off: [0, 0, 0], r: null, model: null, variant: null, farT: 0 };
    tg.name = tg.acId ? getAircraft(tg.acId).name : 'Helicopter';
    this.targets.set(id, tg);
    return tg;
  }

  // new position report: keep the drawn position continuous and blend the error out over a few seconds
  report(tg, rep) {
    const t = nowS();
    if (tg.rep && rep.t > tg.rep.t + 0.5) {
      const dtr = rep.t - tg.rep.t;
      const raw = wrapPi(rep.trk - tg.rep.trk) / dtr;
      tg.turn = rep.gs > 25 && dtr < 30 ? clamp(tg.turn * 0.4 + raw * 0.6, -0.06, 0.06) : 0;
    }
    const before = tg.r ? { lat: tg.r.lat, lon: tg.r.lon, altR: tg.r.altR } : null;
    tg.rep = rep;
    const p = this.extrapolate(tg, t);
    if (before && !tg.ai) {
      const [n, e] = dNE(p.lat, p.lon, before.lat, before.lon), u = before.altR != null && p.altFt != null && !p.ground ? (before.altR - p.altFt) * FT : 0;
      tg.off = Math.hypot(n, e) < 3000 && Math.abs(u) < 600 ? [n, e, u] : [0, 0, 0];
    } else tg.off = [0, 0, 0];
  }

  extrapolate(tg, t) {
    const r = tg.rep;
    const dt = clamp(t - r.t, 0, 25);
    const trk = r.trk + tg.turn * dt;
    const [lat, lon] = r.gs > 0.5 ? destination(r.lat, r.lon, r.trk + tg.turn * dt / 2, r.gs * dt) : [r.lat, r.lon];
    let altFt = r.altFt;
    const ground = r.ground || altFt == null;
    if (!ground) altFt += (r.vs * dt) / FT;
    return { lat, lon, trk, altFt, ground, gs: r.gs, vs: ground ? 0 : r.vs, h: 0 };
  }

  // ellipsoid height of the ground under a target (runway / airport surfaces when known, else airport elevation)
  groundAt(lat, lon) {
    const w = this.world;
    const rh = w.runwayHeight(lat, lon); if (rh !== undefined) return rh;
    const sh = w.airportSurfaceHeight(lat, lon); if (sh !== undefined) return sh;
    const g = w.localGeoid(lat, lon) ?? this.ctx?.geoid ?? 0;
    const ap = airportsNear(lat, lon, 15000, 1)[0];
    return (ap ? ap.e * FT : 0) + g;
  }

  // ---------------------------------------------------------------- per-frame update
  update(fm, dt) {
    if (!this.active) return;
    const t0 = performance.now(), t = nowS();
    if (t >= this.nextFetch) { this.nextFetch = t + 15; this.poll(fm).then((s) => { this.nextFetch = nowS() + (s || 15); }); }
    if (this.ai) this.ai.update(fm, dt, this.status === 'ai');
    const Cesium = window.Cesium;
    const sunK = this.world.sunK ?? 1, night = 1 - clamp((sunK - 0.2) / 0.6, 0, 1);
    const blend = Math.exp(-dt / 2.5);
    // gather + rank by distance
    const arr = [];
    for (const tg of this.targets.values()) {
      if (!tg.rep || (!tg.ai && t - tg.rep.t > STALE_S) || tg.dead) { this.dropTarget(tg); this.targets.delete(tg.id); continue; }
      const p = this.extrapolate(tg, t);
      tg.off[0] *= blend; tg.off[1] *= blend; tg.off[2] *= blend;
      p.lat += tg.off[0] / 6371008.8; p.lon += tg.off[1] / (6371008.8 * Math.cos(p.lat));
      // ground under the aircraft: re-sampled every ~0.5 s near the ground (runway slope), every 3 s up high
      if (tg.gnd === undefined || t - tg.gndT > (tg.r && tg.r.agl < 300 ? 0.5 : 3)) { tg.gnd = this.groundAt(p.lat, p.lon); tg.gndT = t; }
      const gnd = tg.gnd;
      const phys = tg.variant?.physics;
      const gz = phys ? -phys.groundZ : 2.5;
      if (p.ground) p.h = gnd + gz;
      else {
        const g = this.world.localGeoid(p.lat, p.lon) ?? this.ctx?.geoid ?? 0;
        p.h = Math.max(gnd + gz, p.altFt * FT + g + tg.off[2]);
        if (p.h - gnd < 15 && p.gs < 90) p.ground = true; // on the runway in the feed's eyes but reported airborne
      }
      p.agl = (p.h - gnd) / FT;
      p.altR = p.ground ? null : p.altFt + tg.off[2] / FT; // drawn altitude, for blending the next report
      // attitude: smoothed heading, bank from turn rate, pitch from flight path + a little AoA
      const hdgTgt = p.trk;
      tg.hdg = tg.hdg == null ? hdgTgt : tg.hdg + wrapPi(hdgTgt - tg.hdg) * (1 - Math.exp(-dt / 0.8));
      const bankT = p.ground ? 0 : clamp(Math.atan(p.gs * tg.turn / G0), -0.5, 0.5);
      const pitchT = p.ground ? 0 : clamp(Math.atan2(p.vs, Math.max(p.gs, 30)) + (p.agl < 3000 && p.vs < 0 ? 0.045 : 0.03), -0.25, 0.3);
      tg.bank = (tg.bank ?? bankT) + (bankT - (tg.bank ?? bankT)) * (1 - Math.exp(-dt / 1.2));
      tg.pitch = (tg.pitch ?? pitchT) + (pitchT - (tg.pitch ?? pitchT)) * (1 - Math.exp(-dt / 1.5));
      p.dist = distance(fm.lat, fm.lon, p.lat, p.lon);
      tg.r = p;
      arr.push(tg);
    }
    arr.sort((a, b) => a.r.dist - b.r.dist);
    let models = 0, lights = 0;
    const enu = this._enu || (this._enu = new Cesium.Matrix4());
    const sc = this._sc || (this._sc = { pos: new Cesium.Cartesian3(), X: [0, 0, 0], Y: [0, 0, 0], Z: [0, 0, 0] });
    for (let i = 0; i < arr.length; i++) {
      const tg = arr[i], p = tg.r;
      const wantModel = !tg.heli && i < MAX_MODELS && p.dist < MODEL_RANGE;
      if (wantModel) { tg.farT = 0; this.ensureModel(tg); } else if (tg.model && (tg.farT += dt) > 20) { this.dropModel(tg); }
      // frame
      Cesium.Cartesian3.fromRadians(p.lon, p.lat, p.h, undefined, sc.pos);
      Cesium.Transforms.eastNorthUpToFixedFrame(sc.pos, undefined, enu);
      const E = [enu[0], enu[1], enu[2]], N = [enu[4], enu[5], enu[6]], U = [enu[8], enu[9], enu[10]];
      const q = eulerToQuat(tg.hdg, tg.pitch, tg.bank);
      const ned = (v, out) => { const r = qrot(q, v); out[0] = N[0] * r[0] + E[0] * r[1] - U[0] * r[2]; out[1] = N[1] * r[0] + E[1] * r[1] - U[1] * r[2]; out[2] = N[2] * r[0] + E[2] * r[1] - U[2] * r[2]; return out; };
      const X = ned([1, 0, 0], sc.X), Y = ned([0, -1, 0], sc.Y), Z = ned([0, 0, -1], sc.Z);
      const P = sc.pos;
      const mp = (v) => new Cesium.Cartesian3(P.x + X[0] * v[0] + Y[0] * v[1] + Z[0] * v[2], P.y + X[1] * v[0] + Y[1] * v[1] + Z[1] * v[2], P.z + X[2] * v[0] + Y[2] * v[1] + Z[2] * v[2]);
      const gearDown = p.ground || (p.agl < 2200 && p.vs < -1) || (p.agl < 600) || (p.agl < 1500 && Math.abs(p.vs) < 2 && p.gs < 95);
      if (tg.model && tg.model.ready) {
        // own matrix per aircraft: Model keeps a reference to what it is given
        tg.mm = Cesium.Matrix4.fromArray([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, P.x, P.y, P.z, 1], 0, tg.mm || new Cesium.Matrix4());
        tg.model.modelMatrix = tg.mm;
        tg.model.show = true;
        if (tg.gearDown !== gearDown) { tg.gearDown = gearDown; for (const n of tg.gearNodes || []) n.show = gearDown; }
        if (tg.modelK !== sunK) {
          tg.modelK = sunK;
          tg.model.lightColor = new Cesium.Cartesian3(sunK * 2.0, sunK * 1.95, sunK * 1.85);
          tg.model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(sunK, sunK);
        }
        if (tg.props && p.dist < 3000) {
          tg.propA = ((tg.propA || 0) + dt * 2.3) % (Math.PI * 2);
          for (const pr of tg.props) pr.n.matrix = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationX(tg.propA), new Cesium.Cartesian3(pr.e.x, pr.e.y, pr.e.z));
        }
        models++;
      }
      // lights
      if (!tg.lights) tg.lights = this.makeLights();
      const L = tg.variant?.physics?.lights || { navLeft: [-2, 15, 0], navRight: [-2, -15, 0], tail: [-20, 0, 2], beaconTop: [0, 0, 3], beaconBot: [0, 0, -2], landing: [8, 0, -1] };
      const ph = (hash(tg.id) % 1000) / 1000, tt = t + ph * 1.2;
      const vis = p.dist < RANGE_NM * NM;
      const sz = 0.55 + 0.45 * night; // lights read as small points by day, bright at night
      const lt = tg.lights;
      const setL = (pt, pos, on, size) => { pt.show = on && vis; if (pt.show) { pt.position = mp(pos); pt.pixelSize = size * sz; } };
      setL(lt.navL, L.navLeft, true, 4); setL(lt.navR, L.navRight, true, 4); setL(lt.tail, L.tail, true, 3);
      const strobe = !p.ground && tt % 1.2 < 0.07;
      setL(lt.strL, L.navLeft, strobe, 8); setL(lt.strR, L.navRight, strobe, 8);
      setL(lt.bcn, tt % 1.0 < 0.5 ? L.beaconTop : L.beaconBot, (tt % 1.0) % 0.5 < 0.1, 6);
      const land = (p.altFt ?? 0) < 10000 && (!p.ground || p.gs > 6);
      setL(lt.land, L.landing ? [L.landing[0] + 3, 0, L.landing[2]] : L.navLeft, land, p.ground ? 5 : 7);
      lights++;
      // label
      if (this.labels && this.labelCol) {
        const show = vis && p.dist < 30 * NM;
        if (show && !tg.label) tg.label = this.labelCol.add({ font: '600 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, scaleByDistance: new Cesium.NearFarScalar(2000, 1, 50000, 0.75), disableDepthTestDistance: 2e4 });
        if (tg.label) {
          tg.label.show = show;
          if (show) {
            tg.label.position = mp([0, 0, 4]);
            const txt = `${tg.cs}  ${tg.typeCode || tg.name}\n${p.ground ? 'GND' : Math.round(p.altFt / 100) * 100 + ' ft'} · ${(p.dist / NM).toFixed(1)} nm`;
            if (tg.labelTxt !== txt) { tg.labelTxt = txt; tg.label.text = txt; }
          }
        }
      }
    }
    this.stats.models = models; this.stats.lights = lights;
    this.stats.updMs = this.stats.updMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  makeLights() {
    const C = window.Cesium;
    const mk = (color) => this.points.add({ position: C.Cartesian3.ZERO, color, pixelSize: 4, show: false, scaleByDistance: new C.NearFarScalar(300, 1.5, 40000, 0.55) });
    return { navL: mk(C.Color.RED), navR: mk(C.Color.LIME), tail: mk(C.Color.WHITE), strL: mk(C.Color.WHITE), strR: mk(C.Color.WHITE), bcn: mk(C.Color.RED), land: mk(C.Color.fromCssColorString('#fffbe8')) };
  }

  dropTarget(tg) {
    this.dropModel(tg);
    if (tg.lights && this.points) for (const p of Object.values(tg.lights)) this.points.remove(p);
    tg.lights = null;
    if (tg.label && this.labelCol) this.labelCol.remove(tg.label);
    tg.label = null;
  }
  dropModel(tg) {
    if (tg.model) { this.world.viewer.scene.primitives.remove(tg.model); tg.model = null; }
    tg.modelPending = false; tg.gearDown = undefined; tg.modelK = undefined;
  }

  // ---------------------------------------------------------------- models (one light GLB per type+livery, shared GPU resources)
  variantFor(tg) {
    const key = tg.acId + '|' + tg.liveryId;
    if (this.variants.has(key)) return this.variants.get(key);
    if (this.variants.size >= MAX_VARIANTS) { // reuse the closest existing look: same type, else same category
      const cat = getAircraft(tg.acId).category;
      let best = null;
      for (const v of this.variants.values()) { if (!v.url) continue; if (v.acId === tg.acId) { best = v; break; } if (!best && getAircraft(v.acId).category === cat) best = v; }
      if (best) return best;
    }
    const v = { key, acId: tg.acId, liveryId: tg.liveryId, url: null, physics: null, promise: null };
    v.promise = new Promise((res) => this.buildQueue.push({ v, res }));
    this.variants.set(key, v);
    this.pumpBuild();
    return v;
  }
  async pumpBuild() {
    if (this.building) return;
    this.building = true;
    try {
      while (this.buildQueue.length) {
        const { v, res } = this.buildQueue.shift();
        try {
          const geo = getGeometry(v.acId);
          const { canvas } = await paintLivery(geo.layout, getLivery(v.liveryId), { canvasOnly: true });
          const small = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TEX_W, TEX_H) : Object.assign(document.createElement('canvas'), { width: TEX_W, height: TEX_H });
          const c2 = small.getContext('2d'); c2.imageSmoothingQuality = 'high'; c2.drawImage(canvas, 0, 0, TEX_W, TEX_H);
          const blob = small.convertToBlob ? await small.convertToBlob({ type: 'image/png' }) : await new Promise((r) => small.toBlob(r, 'image/png'));
          const png = new Uint8Array(await blob.arrayBuffer());
          const lv = getLivery(v.liveryId);
          const glb = writeGLB(geo.nodes, png, { metallic: lv.metallic ?? 0.12, roughness: lv.roughness ?? 0.38 });
          v.url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })); // kept alive: instances share the cached GPU resources
          v.physics = geo.physics;
        } catch (e) { console.warn('traffic model failed', v.key, e); v.failed = true; }
        res(v);
        await new Promise((r) => setTimeout(r, 30)); // spread the work over frames
      }
    } finally { this.building = false; }
  }
  ensureModel(tg) {
    if (tg.model || tg.modelPending || tg.heli) return;
    if (!tg.variant) tg.variant = this.variantFor(tg);
    const v = tg.variant;
    if (!v.url) { if (!v.failed && !tg.waiting) { tg.waiting = true; v.promise.then(() => { tg.waiting = false; }); } return; }
    if (this.creating >= 2) return;
    tg.modelPending = true; this.creating++;
    const Cesium = window.Cesium;
    Cesium.Model.fromGltfAsync({ url: v.url, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false, backFaceCulling: true, show: false })
      .then((model) => {
        if (!tg.modelPending || !this.active || !this.targets.has(tg.id)) { model.destroy(); return; }
        this.world.viewer.scene.primitives.add(model);
        tg.model = model; tg.modelPending = false;
        const onReady = () => {
          const anim = v.physics.anim || { gear: [] };
          tg.gearNodes = anim.gear.map((g) => model.getNode(g.node)).filter(Boolean);
          tg.props = PROPS.has(v.acId) ? v.physics.engines.map((e) => ({ e, n: model.getNode(e.node) })).filter((x) => x.n) : null;
          tg.gearDown = undefined;
        };
        if (model.ready) onReady(); else { const r = model.readyEvent.addEventListener(() => { r(); onReady(); }); }
      })
      .catch((e) => { console.warn('traffic model', e); tg.modelPending = false; })
      .finally(() => { this.creating--; });
  }

  // ---------------------------------------------------------------- outputs for the map / ND
  list() {
    const out = [];
    for (const tg of this.targets.values()) {
      const p = tg.r; if (!p) continue;
      out.push({ id: tg.id, cs: tg.cs, type: tg.typeCode || tg.name, lat: p.lat, lon: p.lon, altFt: p.ground ? null : p.altFt, ground: p.ground, hdg: (tg.hdg ?? p.trk) * R2D, gsKt: p.gs / KT, vsFpm: (p.vs / FT) * 60, ai: tg.ai, dist: p.dist });
    }
    return out;
  }
  statusText() { return !this.active ? 'off' : this.status === 'live' ? `live · ${this.source}` : this.status === 'ai' ? 'AI traffic' : 'connecting…'; }
}

// ================================================================== AI traffic (used when no live feed is reachable)
const REGION_AIRLINES = [
  [/^K|^P/, ['southwest', 'delta', 'united', 'american', 'alaska', 'jetblue', 'fedex', 'ups', 'delta', 'american', 'southwest']],
  [/^C/, ['aircanada', 'aircanada', 'united', 'american', 'delta']],
  [/^E|^L|^B/, ['british', 'lufthansa', 'airfrance', 'klm', 'ryanair', 'easyjet', 'turkish', 'virgin', 'easyjet', 'ryanair']],
  [/^O/, ['emirates', 'qatar', 'etihad', 'turkish', 'emirates']],
  [/^R|^V|^W|^Z/, ['singapore', 'ana', 'jal', 'cathay', 'chinaeastern', 'qatar', 'emirates']],
  [/^Y|^N/, ['qantas', 'qantas', 'virgin', 'singapore', 'emirates']],
  [/^U/, ['aeroflot', 'turkish', 'emirates']],
  [/./, ['emirates', 'british', 'lufthansa', 'qatar', 'turkish', 'united', 'delta']],
];
class AITraffic {
  constructor(traffic, ctx) {
    this.tr = traffic; this.ctx = ctx; this.list = []; this.n = 0; this.tNext = { arr: 0, dep: 25, over: 0 };
    const ap = ctx.ap, prw = ctx.rwy;
    const ends = ap ? runwayEnds(ap) : [];
    // prefer a parallel runway in the same flow so AI doesn't land on top of the player
    const par = ends.filter((r) => r.ident !== prw?.ident && Math.abs(wrapPi(r.heading - (prw?.heading ?? 0))) < 0.35 && r.length > 1500);
    this.rwy = par.sort((a, b) => b.length - a.length)[0] || prw || ends[0];
    this.shared = !par.length;
    this.airlines = (REGION_AIRLINES.find(([re]) => re.test(ap?.i || '')) || REGION_AIRLINES.at(-1))[1];
    this.geoid = ctx.geoid || 0;
  }
  pick(heavyOk = true) {
    const lv = this.airlines[Math.floor(Math.random() * this.airlines.length)];
    const fl = getLivery(lv).fleet;
    let pool = (Array.isArray(fl) ? fl : ['a320neo']).filter((id) => !GA.has(id) && (heavyOk || getAircraft(id).category !== 'Wide-body'));
    if (!pool.length) pool = ['a320neo'];
    const acId = pool[Math.floor(Math.random() * pool.length)];
    const code = CODE_OF[lv] || 'OSK';
    return { acId, liveryId: lv, cs: code + (100 + Math.floor(Math.random() * 8900)) };
  }
  spawn(kind, st) {
    const c = this.pick(kind !== 'dep' || this.rwy.length > 2800);
    const id = 'ai' + (++this.n);
    const tg = this.tr.newTarget(id, { cs: c.cs, ai: true }, c);
    tg.ai = true; tg.typeCode = getAircraft(c.acId).name;
    const a = { tg, kind, ...st };
    this.list.push(a);
    this.push(a);
    return a;
  }
  push(a) { this.tr.report(a.tg, { lat: a.lat, lon: a.lon, altFt: a.ground ? null : a.alt, gs: a.gs, trk: a.trk, vs: a.vs, ground: a.ground, t: nowS() }); a.tg.turn = a.turn || 0; }
  thrAlong(s, side = 0) { // point on the AI runway centreline, s metres past the threshold (negative = on final)
    const r = this.rwy;
    let [la, lo] = destination(r.lat, r.lon, r.heading, s);
    if (side) [la, lo] = destination(la, lo, r.heading + Math.PI / 2, side);
    return [la, lo];
  }
  update(fm, dt, allowSpawn) {
    const r = this.rwy; if (!r) return;
    const t = nowS(), elevFt = r.elevM / FT;
    if (allowSpawn) {
      const busyFinal = this.list.some((a) => a.kind === 'arr' && a.s < -7 * NM);
      if (t > this.tNext.arr && !busyFinal && this.list.filter((a) => a.kind === 'arr').length < 3) {
        const first = !this.started;
        const s0 = -(first ? (this.shared ? 10 : 5.5) : 13 + Math.random() * 3) * NM;
        this.spawn('arr', { s: s0, phase: 'final' });
        if (first) this.spawn('arr', { s: -(this.shared ? 17 : 12.5) * NM, phase: 'final' });
        this.tNext.arr = t + 70 + Math.random() * 50;
      }
      // departures: not while the player sits on the same runway, and with ~3 nm separation from the next arrival
      const playerOnRwy = this.shared && distance(fm.lat, fm.lon, r.lat, r.lon) < r.length + 500 && fm.out.agl < 300;
      const arrClose = this.list.some((a) => a.kind === 'arr' && a.s > -3.5 * NM && a.s < 800);
      if (t > this.tNext.dep && !playerOnRwy && !arrClose && this.list.filter((a) => a.kind === 'dep').length < 2) {
        this.spawn('dep', { s: 0, phase: 'roll', gs: 0 }); this.tNext.dep = t + 100 + Math.random() * 60;
      }
      if (t > this.tNext.over && this.list.filter((a) => a.kind === 'over').length < 3) {
        const b = Math.random() * Math.PI * 2, d = (18 + Math.random() * 14) * NM;
        const [la, lo] = destination(fm.lat, fm.lon, b, d);
        const trk = b + Math.PI + (Math.random() - 0.5) * 1.6;
        this.spawn('over', { lat: la, lon: lo, alt: Math.round(12 + Math.random() * 26) * 1000, gs: (380 + Math.random() * 100) * KT, trk, vs: 0, phase: 'cruise' });
        this.tNext.over = t + 40 + Math.random() * 40;
      }
      this.started = true;
    }
    const tan3 = Math.tan(3 * D2R);
    for (const a of this.list) {
      if (a.kind === 'arr') {
        if (a.phase === 'final') {
          const dNm = -a.s / NM;
          a.gs = (dNm > 6 ? 165 : dNm > 4 ? 150 : 140) * KT;
          a.s += a.gs * dt;
          a.alt = elevFt + 50 + Math.max(0, -a.s) * tan3 / FT; a.vs = -a.gs * tan3; a.ground = false;
          if (a.s >= 0) a.phase = 'flare';
        } else if (a.phase === 'flare') {
          a.s += a.gs * dt; a.gs = Math.max(130 * KT, a.gs - 0.6 * dt);
          const k = clamp(1 - a.s / 380, 0, 1); a.alt = elevFt + 50 * k * k; a.vs = -0.8 - 2.5 * k;
          if (a.s > 380) { a.phase = 'roll'; a.ground = true; }
        } else if (a.phase === 'roll') {
          a.s += a.gs * dt; a.gs = Math.max(12 * KT, a.gs - 2.2 * dt); a.vs = 0;
          if (a.gs <= 12.5 * KT || a.s > r.length - 400) { a.phase = 'vacate'; a.v = 0; }
        } else if (a.phase === 'vacate') { // high-speed turn-off to the right, then gone
          a.v += dt; a.gs = 12 * KT; a.s += a.gs * dt * Math.cos(Math.min(1, a.v / 8) * 0.8);
          a.side = (a.side || 0) + a.gs * dt * Math.sin(Math.min(1, a.v / 8) * 0.8);
          a.turnTrk = Math.min(1, a.v / 8) * 0.8;
          if (a.v > 30) a.tg.dead = true;
        }
        [a.lat, a.lon] = this.thrAlong(a.s, a.side || 0);
        a.trk = r.heading + (a.turnTrk || 0); a.turn = 0;
      } else if (a.kind === 'dep') {
        if (a.phase === 'roll') {
          a.gs += 2.3 * dt; a.s += a.gs * dt; a.ground = true; a.vs = 0; a.alt = elevFt;
          if (a.gs > 150 * KT) { a.phase = 'climb'; a.ground = false; a.climbT = 0; }
          [a.lat, a.lon] = this.thrAlong(a.s); a.trk = r.heading;
        } else {
          a.climbT += dt;
          const agl = a.alt - elevFt;
          a.vs = clamp(a.climbT / 4, 0, 1) * (agl < 10000 ? 11 : 8); // ~2200 fpm
          a.gs = Math.min((agl < 3000 ? 170 : 250) * KT, a.gs + 1.2 * dt);
          a.alt += a.vs * dt / FT;
          if (agl > 1500 && a.exitTrk == null) a.exitTrk = r.heading + (Math.random() - 0.5) * 2.2;
          if (a.exitTrk != null) { const d = wrapPi(a.exitTrk - a.trk), rate = clamp(d, -0.04, 0.04); a.trk += rate * dt; a.turn = rate; } else a.turn = 0;
          [a.lat, a.lon] = destination(a.lat, a.lon, a.trk, a.gs * dt);
          if (distance(fm.lat, fm.lon, a.lat, a.lon) > RANGE_NM * NM) a.tg.dead = true;
        }
      } else { // overflight
        [a.lat, a.lon] = destination(a.lat, a.lon, a.trk, a.gs * dt); a.turn = 0;
        if (distance(fm.lat, fm.lon, a.lat, a.lon) > (RANGE_NM + 5) * NM) a.tg.dead = true;
      }
      if (!a.tg.dead) this.push(a);
    }
    this.list = this.list.filter((a) => !a.tg.dead);
  }
}
