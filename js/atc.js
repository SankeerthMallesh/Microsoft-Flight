// Air traffic control: a phase-aware ATC flow modelled on real ICAO / FAA procedures.
// Clearance delivery → ground → tower → departure → centre → approach → tower → ground.
// ATC only ever *talks*: it reads the aircraft and autopilot state and issues instructions
// that match what the autopilot or the pilot is doing. It never touches the controls.
import { getAirport, runwayEnds, airportsNear } from './data/airports.js';
import { getLivery } from './data/liveries.js';
import { D2R, R2D, FT, NM, clamp, wrap180, wrap360, distance, bearing } from './sim/math.js';

// ---------------------------------------------------------------- phraseology helpers
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const PHON = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words99 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const digits = (s) => String(s).split('').map((ch) => (/\d/.test(ch) ? DIG[+ch] : PHON[ch.toUpperCase()] || ch)).join(' ');
const spell = (s) => String(s).toUpperCase().split('').map((ch) => (/\d/.test(ch) ? DIG[+ch] : PHON[ch] || '')).filter(Boolean).join(' ');
// airline flight numbers are spoken in groups: 1234 → "twelve thirty four", 512 → "five twelve"
function flightWords(n) {
  if (n < 100) return words99(n);
  const s = String(n);
  const tail = (x) => (x === 0 ? 'hundred' : x < 10 ? 'zero ' + ONES[x] : words99(x));
  if (s.length === 3) return ONES[+s[0]] + ' ' + tail(+s.slice(1));
  return words99(+s.slice(0, 2)) + ' ' + tail(+s.slice(2));
}
// deterministic pseudo-random from a string
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function freq(seed, lo, hi) {
  // 25 kHz channels, shown with three decimals as on a real radio
  const ch = Math.round((hi - lo) / 0.025);
  return (lo + (hash(seed) % ch) * 0.025).toFixed(3);
}

// radio telephony callsigns for the liveries in js/data/liveries.js
const TELEPHONY = {
  southwest: ['Southwest', 'SWA'], delta: ['Delta', 'DAL'], emirates: ['Emirates', 'UAE'], united: ['United', 'UAL'], american: ['American', 'AAL'],
  british: ['Speedbird', 'BAW'], lufthansa: ['Lufthansa', 'DLH'], airfrance: ['Air France', 'AFR'], klm: ['KLM', 'KLM'], qatar: ['Qatari', 'QTR'],
  singapore: ['Singapore', 'SIA'], ryanair: ['Ryanair', 'RYR'], easyjet: ['Easy', 'EZY'], aircanada: ['Air Canada', 'ACA'], qantas: ['Qantas', 'QFA'],
  ana: ['All Nippon', 'ANA'], jal: ['Japan Air', 'JAL'], turkish: ['Turkish', 'THY'], alaska: ['Alaska', 'ASA'], jetblue: ['JetBlue', 'JBU'],
  cathay: ['Cathay', 'CPA'], etihad: ['Etihad', 'ETD'], fedex: ['FedEx', 'FDX'], ups: ['UPS', 'UPS'], virgin: ['Virgin', 'VIR'],
  chinaeastern: ['China Eastern', 'CES'], aeroflot: ['Aeroflot', 'AFL'], 'airbus-house': ['Airbus', 'AIB'], 'boeing-house': ['Boeing', 'BOE'], 'embraer-house': ['Embraer', 'EMB'],
  'regional-house': ['Regional', 'RGL'],
};
const REG_PREFIX = { US: 'N', CA: 'C-F', GB: 'G-', DE: 'D-', FR: 'F-', AU: 'VH-', NL: 'PH-', IE: 'EI-', CH: 'HB-', IT: 'I-', ES: 'EC-', JP: 'JA', BR: 'PR-', AE: 'A6-', NZ: 'ZK-', ZA: 'ZS-' };
// approximate centres of the US air route traffic control centres (ARTCCs)
const ARTCC = [['Seattle', 47.3, -120.5], ['Oakland', 38.5, -121.5], ['Los Angeles', 34.6, -117.5], ['Salt Lake', 41.5, -112.5], ['Denver', 39.5, -105.5], ['Albuquerque', 34.8, -106.5],
  ['Minneapolis', 45.5, -94], ['Kansas City', 38.8, -95.5], ['Fort Worth', 32.8, -98], ['Houston', 29.8, -94.5], ['Chicago', 41.8, -88.3], ['Indianapolis', 39.3, -85.8], ['Memphis', 35.2, -89.5],
  ['Cleveland', 41.3, -81.5], ['Atlanta', 33.5, -84.5], ['Jacksonville', 30.5, -82], ['Miami', 26, -80.5], ['Washington', 38.5, -77.5], ['New York', 40.8, -73.5], ['Boston', 42.7, -71.5],
  ['Anchorage', 61.2, -150], ['Honolulu', 21.3, -157.9]];
const ACC = { GB: 'London Control', IE: 'Shannon Control', FR: 'Paris Control', DE: 'Langen Radar', NL: 'Amsterdam Radar', BE: 'Brussels Control', CH: 'Swiss Radar', AT: 'Vienna Radar', IT: 'Roma Control', ES: 'Madrid Control', PT: 'Lisboa Control',
  AE: 'Emirates Radar', QA: 'Doha Control', SG: 'Singapore Radar', JP: 'Tokyo Control', AU: 'Melbourne Centre', NZ: 'Christchurch Control', HK: 'Hong Kong Radar', CN: 'Shanghai Control', RU: 'Moscow Control',
  TR: 'Ankara Control', BR: 'Brasília Center', IN: 'Mumbai Control', MX: 'Mexico Center', SA: 'Jeddah Control', KR: 'Incheon Control', TH: 'Bangkok Control', ZA: 'Johannesburg Control', DK: 'Copenhagen Control', SE: 'Sweden Control', NO: 'Polaris Control', FI: 'Helsinki Control', PL: 'Warszawa Radar' };

function placeName(ap) {
  // "London Heathrow Airport" → "Heathrow", "Dallas Love Field" → "Love Field", "Dubai International Airport" → "Dubai"
  let s = ap.n.replace(/\b(International|Intl\.?|Airport|Aeropuerto|Aéroport|Flughafen|Regional|Municipal|Airfield|Aerodrome|County|Executive|Air Base|Memorial)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (ap.c && s.toLowerCase().startsWith(ap.c.toLowerCase() + ' ') && s.length > ap.c.length + 2) s = s.slice(ap.c.length + 1);
  const w = s.split(' ').filter(Boolean);
  if (w.length > 2) s = w[w.length - 1].length > 3 ? w[w.length - 1] : w.slice(-2).join(' ');
  return s || ap.c || ap.i;
}

// ---------------------------------------------------------------- styles (kept here so shared CSS stays untouched)
const CSS = `
#atcPanel{position:absolute;top:58px;right:12px;width:min(390px,calc(100vw - 24px));max-height:min(62vh,560px);display:flex;flex-direction:column;background:rgba(10,14,20,.88);border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.45);font-size:.82rem;z-index:40;pointer-events:auto;backdrop-filter:blur(10px)}
#atcPanel.hidden{display:none}
#atcPanel header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.1)}
#atcPanel header b{font-family:'Roboto Mono',monospace;color:#3cf26b;font-size:.9rem}
#atcPanel header span{color:#9aa6b2;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#atcPanel header button{background:none;border:none;color:#9aa6b2;cursor:pointer;font-size:.9rem}
#atcLog{overflow:auto;padding:6px 10px;flex:1;min-height:80px}
#atcLog p{margin:4px 0;line-height:1.35}
#atcLog p small{color:#6f7b87;font-family:'Roboto Mono',monospace;margin-right:6px}
#atcLog p.atc i{color:#7cc4ff;font-style:normal;font-weight:700}
#atcLog p.pilot{color:#cfd6dd} #atcLog p.pilot i{color:#ffcf5a;font-style:normal;font-weight:700}
#atcLog p.sys{color:#9aa6b2;font-style:italic}
#atcMenu{border-top:1px solid rgba(255,255,255,.1);padding:6px;display:flex;flex-direction:column;gap:3px}
#atcMenu button{text-align:left;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#e8edf3;border-radius:7px;padding:6px 9px;cursor:pointer;font-size:.8rem}
#atcMenu button:hover{background:rgba(58,160,255,.25)} #atcMenu button kbd{margin-right:7px;font-size:.75rem}
#atcSub{position:absolute;top:58px;right:12px;max-width:min(420px,calc(100vw - 24px));background:rgba(8,12,18,.78);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:7px 11px;font-size:.82rem;color:#e8edf3;pointer-events:none;transition:opacity .4s;z-index:39}
#atcSub.off{opacity:0} #atcSub i{color:#7cc4ff;font-style:normal;font-weight:700} #atcSub.pilot i{color:#ffcf5a}
`;

// ---------------------------------------------------------------- ATC
export class ATC {
  constructor(audio) {
    this.audio = audio; this.active = false; this.log = []; this.open = false;
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  // ---------------------------------------------------------------- lifecycle
  start(app, plan) {
    try { this._start(app, plan); } catch (e) { console.warn('ATC start failed', e); this.active = false; }
  }
  _start(app, plan) {
    this.app = app; this.plan = plan; this.active = true; this.log = []; this.t = 0; this.tick = 0; this.gen = (this.gen || 0) + 1;
    this.audio.voice.clear();
    const fm = app.fm, ac = fm.ac;
    this.origin = getAirport(plan.airport); this.depRwy = app.rwy;
    this.country = this.origin?.k || 'US';
    this.usStyle = ['US', 'CA'].includes(this.country);
    this.ta = this.usStyle ? 18000 : this.country === 'AU' ? 10000 : 6000; // transition altitude
    // callsign
    const lv = getLivery(plan.liveryId) || {};
    const tel = TELEPHONY[lv.id];
    const seed = hash(plan.acId + plan.liveryId + Date.now());
    const heavy = ac.id && /a380/.test(ac.id) ? ' super' : ac.mtow > 136000 ? ' heavy' : '';
    if (tel) {
      const num = tel[0] === 'Airbus' || tel[0] === 'Boeing' || tel[0] === 'Embraer' ? 1 + (seed % 9) * 11 : 10 + (seed % 2980);
      this.cs = { text: `${tel[0]} ${num}${heavy}`, speech: `${tel[0]} ${flightWords(num)}${heavy}`, short: `${tel[0]} ${flightWords(num)}${heavy}` };
    } else {
      const pre = REG_PREFIX[this.country] || 'N';
      const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
      let reg;
      if (pre === 'N') reg = 'N' + (100 + (seed % 899)) + L[(seed >> 10) % L.length] + L[(seed >> 15) % L.length];
      else reg = pre + Array.from({ length: pre.length > 2 ? 3 : 4 }, (_, i) => L[(seed >> (i * 5)) % L.length]).join('');
      const raw = reg.replace(/-/g, '');
      const sp = spell(raw);
      // after first contact, US controllers abbreviate to type/last three; keep the full call for clarity
      this.cs = { text: reg + heavy, speech: sp + heavy, short: sp + heavy };
    }
    this.cargo = /fedex|ups/.test(lv.id || '') || /F$/.test(ac.name || '');
    this.isGA = fm.isGA;
    this.squawk = (() => { let s; do { s = Array.from({ length: 4 }, (_, i) => (seed >> (i * 3)) & 7).join(''); } while (/^(7500|7600|7700|1200|7000|2000)$/.test(s)); return s; })();
    this.atis = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[seed % 26];
    this.atisArr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(seed >> 7) % 26];
    this.assigned = { alt: null, hdg: null };
    this.flags = {};
    this.lastMcpAlt = null; this.mcpStable = 0; this.devTimer = 0; this.minAgl = 1e9;
    // initial altitude from the clearance: what the autopilot (MCP) is set to
    this.initAlt = Math.round((app.ap?.alt || (this.origin ? this.origin.e + 5000 : 5000)) / 100) * 100;
    this.crzAlt = this.estimateCruise();
    // phase from the start position
    this.freeArr = null;
    this.arrOverride = plan.start === 'approach' || (plan.start === 'air' && !app.dest) ? { ap: this.origin, rwy: app.rwy } : null;
    if (plan.start === 'runway' || plan.start === 'gate') { this.phase = 'PARKED'; this.fac = this.facility(this.origin, 'clearance'); }
    else if (plan.start === 'cruise') { this.phase = 'CRUISE'; this.fac = this.centerFacility(); this.assigned.alt = Math.round(fm.out.alt / 100) * 100; this.later(3, () => this.checkIn()); }
    else if (plan.start === 'approach') { this.phase = 'APPROACH'; this.flags.appCleared = true; this.flags.twr = true; this.fac = this.facility(this.arrival().ap, 'tower'); this.assigned.alt = Math.round(fm.out.alt / 100) * 100; this.later(2, () => this.handoffTower()); }
    else if (app.dest) { this.phase = 'DEPARTURE'; this.fac = this.facility(this.origin, 'departure'); this.assigned.alt = Math.round(fm.out.alt / 100) * 100; this.later(3, () => this.checkIn()); }
    else { this.phase = 'APPROACH'; this.fac = this.facility(this.arrival().ap, 'approach'); this.assigned.alt = Math.round(fm.out.alt / 100) * 100; this.later(3, () => this.checkIn()); }
    this.buildUI();
    this.sys(`ATC online — you are ${this.cs.text}. Press \` or L for the ATC window.`);
    this.renderMenu();
  }
  stop() { this.active = false; this.gen = (this.gen || 0) + 1; this.timers = []; this.audio.voice.clear(); if (this.panel) this.panel.classList.add('hidden'); if (this.sub) this.sub.classList.add('off'); }
  later(sec, fn) { (this.timers = this.timers || []).push({ at: this.t + sec, fn, gen: this.gen }); }

  // ---------------------------------------------------------------- facilities
  facility(ap, role) {
    if (!ap) ap = this.origin;
    const place = placeName(ap), city = ap.c || place;
    const f = {
      clearance: [`${place} Clearance`, freq(ap.i + 'clr', 118.0, 121.5)],
      ground: [`${place} Ground`, freq(ap.i + 'gnd', 121.6, 122.0)],
      tower: [`${place} Tower`, freq(ap.i + 'twr', 118.0, 121.0)],
      departure: [`${city} Departure`, freq(ap.i + 'dep', 119.0, 127.0)],
      approach: [`${city} Approach`, freq(ap.i + 'app', 119.0, 127.0)],
    }[role];
    return { name: f[0], freq: f[1], role, ap };
  }
  centerFacility() {
    const fm = this.app.fm;
    const near = airportsNear(fm.lat, fm.lon, 400 * NM, 1)[0];
    const k = near?.k || this.country;
    let name;
    if (k === 'US') {
      let best = null, bd = 1e12;
      for (const [nm, la, lo] of ARTCC) { const d = distance(fm.lat, fm.lon, la * D2R, lo * D2R); if (d < bd) { bd = d; best = nm; } }
      name = best + ' Center';
    } else if (k === 'CA') name = (fm.lon * R2D < -110 ? 'Vancouver' : fm.lon * R2D < -90 ? 'Winnipeg' : fm.lon * R2D < -70 ? 'Toronto' : 'Moncton') + ' Centre';
    else name = ACC[k] || ((near?.c || 'Area') + ' Control');
    return { name, freq: freq(name, 124.0, 135.9), role: 'center' };
  }
  arrival() {
    const app = this.app;
    if (this.arrOverride) return this.arrOverride;
    if (app.dest) return { ap: app.dest.ap, rwy: app.dest.rwy, route: app.dest };
    // no destination: treat the departure airport as the arrival (pattern work / return)
    return this.freeArr || { ap: this.origin, rwy: app.rwy || this.depRwy };
  }
  estimateCruise() {
    const app = this.app, ac = app.fm.ac, dest = app.dest?.ap;
    if (!dest || !this.origin) return this.initAlt;
    const nm = distance(this.origin.la * D2R, this.origin.lo * D2R, dest.la * D2R, dest.lo * D2R) / NM;
    let crz = this.isGA ? 6500 : ac.engines.type === 'turboprop' ? Math.min(ac.perf.ceiling - 3000, 21000) : Math.min(ac.perf.ceiling - 4000, ac.category === 'Business jet' ? 43000 : 35000);
    crz = Math.min(crz, Math.max(this.isGA ? 4500 : 12000, nm * 120));
    return Math.max(this.initAlt, Math.round(crz / 1000) * 1000);
  }

  // ---------------------------------------------------------------- message formatting
  // tokens: {cs} {alt:N} {hdg:N} {rwy:X} {fq:N} {sq:N} {wind} {qnh} {spd:N} {ph:X}
  fmt(s, mode) {
    const sp = mode === 'speech';
    return s.replace(/\{(\w+)(?::([^}]*))?\}/g, (m, k, v) => {
      switch (k) {
        case 'cs': return sp ? this.cs.speech : this.cs.text;
        case 'alt': {
          const a = Math.round(+v / 100) * 100;
          if (a >= this.ta) { const fl = String(Math.round(a / 100)).padStart(3, '0'); return sp ? 'flight level ' + digits(fl) : 'FL' + fl; }
          if (!sp) return a.toLocaleString('en-US');
          const th = Math.floor(a / 1000), hu = Math.round((a % 1000) / 100);
          return (th ? (th >= 10 ? digits(th) : ONES[th]) + ' thousand' : '') + (hu ? (th ? ' ' : '') + ONES[hu] + ' hundred' : '');
        }
        case 'hdg': { const h = String(Math.round(wrap360(+v) / 5) * 5 % 360 || 360).padStart(3, '0'); return sp ? digits(h) : h; }
        case 'rwy': {
          if (!sp) return v;
          const mm = /^(\d+)([LRC]?)$/.exec(v); if (!mm) return spell(v);
          return digits(mm[1].padStart(2, '0')) + (mm[2] ? ' ' + { L: 'left', R: 'right', C: 'center' }[mm[2]] : '');
        }
        case 'fq': {
          const t = (+v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
          if (!sp) return (+v).toFixed(3);
          const [a, b] = t.split('.');
          return digits(a) + (b ? (this.usStyle ? ' point ' : ' decimal ') + digits(b) : '');
        }
        case 'sq': return sp ? digits(v) : v;
        case 'ph': return sp ? PHON[v] : v;
        case 'spd': return sp ? digits(Math.round(+v)) + ' knots' : Math.round(+v) + ' kt';
        case 'wind': {
          const p = this.plan, d = String(Math.round(wrap360(p.windDir) / 10) * 10 % 360 || 360).padStart(3, '0'), s2 = Math.round(p.windSpd);
          if (s2 < 3) return sp ? 'wind calm' : 'wind calm';
          if (this.usStyle) return sp ? `wind ${digits(d)} at ${words99(Math.min(99, s2))}` : `wind ${d} at ${s2}`;
          return sp ? `wind ${digits(d)} degrees, ${words99(Math.min(99, s2))} knots` : `wind ${d} degrees ${s2} knots`;
        }
        case 'qnh': return this.usStyle ? (sp ? 'altimeter two niner niner two' : 'altimeter 29.92') : (sp ? 'Q N H one zero one three' : 'QNH 1013');
        default: return m;
      }
    });
  }

  // ---------------------------------------------------------------- transmissions
  stamp() { const d = new Date(); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + 'Z'; }
  push(kind, who, text) {
    this.log.push({ kind, who, text, at: this.stamp() });
    if (this.log.length > 120) this.log.shift();
    this.renderLog();
  }
  sys(text) { this.push('sys', '', text); }
  // ATC speaks (text with tokens), then the pilot reads back (if given)
  atc(msg, readback) {
    const gen = this.gen, fac = this.fac;
    const text = this.fmt(msg, 'text'), speech = this.fmt(msg, 'speech');
    this.lastAtc = msg;
    // the log entry and subtitle appear when the transmission actually starts
    const p = this.audio.voice.radio(speech, 'atc', { intl: !this.usStyle, onStart: () => { if (gen !== this.gen) return; this.push('atc', fac.name, text); this.showSub('atc', fac.name, text); } })
      .then((spoken) => spoken !== false && gen === this.gen);
    if (readback) this.pilot(readback);
    return p;
  }
  pilot(msg) {
    const gen = this.gen;
    const text = this.fmt(msg, 'text'), speech = this.fmt(msg, 'speech');
    return this.audio.voice.radio(speech, 'pilot', { onStart: () => { if (gen !== this.gen) return; this.push('pilot', this.cs.text, text); this.showSub('pilot', this.cs.text, text); } })
      .then((spoken) => spoken !== false && gen === this.gen);
  }
  contact(fac) { this.fac = fac; }

  // ---------------------------------------------------------------- geometry
  ilsGeom(rwy) {
    const fm = this.app.fm;
    const d = distance(fm.lat, fm.lon, rwy.lat, rwy.lon);
    const ang = wrap180((bearing(fm.lat, fm.lon, rwy.lat, rwy.lon) - rwy.heading) * R2D) * D2R;
    return { d, along: d * Math.cos(ang), xtk: d * Math.sin(ang) };
  }
  onRunway(rwy) {
    if (!rwy) return false;
    const g = this.ilsGeom(rwy);
    return Math.abs(g.xtk) < (rwy.width || 45) / 2 + 12 && g.along < 40 && g.along > -(rwy.length + 40);
  }
  anyRunwayHere() {
    const fm = this.app.fm;
    const ap = airportsNear(fm.lat, fm.lon, 6000, 1)[0];
    if (!ap) return null;
    return runwayEnds(ap).find((r) => this.onRunway(r)) || null;
  }
  altRound(a, step = 1000) { return Math.max(step, Math.round(a / step) * step); }

  // ---------------------------------------------------------------- flow: departure
  reqClearance() {
    const dest = this.app.dest?.ap;
    this.contact(this.facility(this.origin, 'clearance'));
    this.flags.ifr = true;
    const dep = this.facility(this.origin, 'departure');
    const twr = this.facility(this.origin, 'tower');
    const onRwy = this.onRunway(this.depRwy);
    if (dest) {
      this.pilot(`${this.fac.name}, {cs}, IFR to ${dest.i}, with information {ph:${this.atis}}, request clearance.`);
      this.assigned.alt = this.initAlt;
      this.atc(`{cs}, cleared to ${dest.i} airport via radar vectors, then as filed. Climb and maintain {alt:${this.initAlt}}, expect {alt:${this.crzAlt}} one zero minutes after departure. Departure frequency {fq:${dep.freq}}, squawk {sq:${this.squawk}}.`,
        `Cleared to ${dest.i} via radar vectors then as filed, climb and maintain {alt:${this.initAlt}}, expect {alt:${this.crzAlt}} in ten, departure {fq:${dep.freq}}, squawk {sq:${this.squawk}}, {cs}.`)
        .then((ok) => { if (ok) this.atc(`{cs}, readback correct. ${onRwy ? `Contact ${twr.name} on {fq:${twr.freq}} when ready.` : `Contact ${this.facility(this.origin, 'ground').name} on {fq:${this.facility(this.origin, 'ground').freq}} for taxi.`}`, onRwy ? `${twr.name.split(' ').pop()} {fq:${twr.freq}}, {cs}.` : `Ground {fq:${this.facility(this.origin, 'ground').freq}}, {cs}.`); });
    } else {
      this.pilot(`${this.fac.name}, {cs}, VFR departure to the local area, with information {ph:${this.atis}}.`);
      this.assigned.alt = this.initAlt;
      this.atc(`{cs}, maintain VFR at or below {alt:${this.initAlt}}, departure frequency {fq:${dep.freq}}, squawk {sq:${this.squawk}}.`, `At or below {alt:${this.initAlt}}, departure {fq:${dep.freq}}, squawk {sq:${this.squawk}}, {cs}.`);
    }
    this.phase = 'CLEARED';
  }
  reqTaxi() {
    const gnd = this.facility(this.origin, 'ground');
    this.contact(gnd);
    const r = this.depRwy.ident;
    this.pilot(`${gnd.name}, {cs}, ${this.cargo ? 'at the cargo ramp' : this.isGA ? 'at general aviation parking' : 'at the gate'}, request taxi${this.flags.ifr ? '' : `, with information {ph:${this.atis}}`}.`);
    this.atc(`{cs}, ${gnd.name}, runway {rwy:${r}}, taxi via the parallel taxiway, hold short of runway {rwy:${r}}. {qnh}.`, `Runway {rwy:${r}}, taxi via the parallel taxiway, hold short runway {rwy:${r}}, {cs}.`);
    this.phase = 'TAXI';
  }
  readyForDeparture(auto) {
    const twr = this.facility(this.origin, 'tower');
    this.contact(twr);
    const r = this.depRwy.ident;
    const onRwy = this.onRunway(this.depRwy);
    this.pilot(`${twr.name}, {cs}, ${onRwy ? 'holding in position' : 'holding short'} runway {rwy:${r}}, ready for departure.`);
    const after = this.app.dest ? (this.app.ap?.lat === 'NAV' ? '' : ' Fly runway heading.') : ' Fly runway heading.';
    if (!onRwy && !auto) {
      this.atc(`{cs}, ${twr.name}, runway {rwy:${r}}, line up and wait.`, `Line up and wait runway {rwy:${r}}, {cs}.`);
      this.phase = 'LINEUP';
      return;
    }
    this.flags.takeoff = true; this.phase = 'TAKEOFF';
    this.atc(`{cs}, ${twr.name}, {wind}, runway {rwy:${r}}, cleared for take-off.${after}`, `Cleared for take-off runway {rwy:${r}},${after ? ' runway heading,' : ''} {cs}.`);
  }
  takeoffCleared() {
    const r = this.depRwy.ident;
    this.flags.takeoff = true; this.phase = 'TAKEOFF';
    this.atc(`{cs}, {wind}, runway {rwy:${r}}, cleared for take-off.`, `Cleared for take-off runway {rwy:${r}}, {cs}.`);
  }
  // what the aircraft is doing laterally, as an ATC instruction
  lateralInstr() {
    const ap = this.app.ap, fm = this.app.fm, arr = this.arrival();
    if (ap?.engaged && ap.lat === 'NAV' && arr) return `proceed direct ${arr.ap.i}`;
    if (ap?.engaged && ap.lat === 'HDG') { this.assigned.hdg = ap.hdg; return `fly heading {hdg:${ap.hdg}}`; }
    if (!this.app.dest) return 'resume own navigation';
    return `fly heading {hdg:${fm.out.hdg}}, vectors ${arr ? 'toward ' + arr.ap.i : 'on course'}`;
  }
  handoffDeparture() {
    const dep = this.facility(this.origin, 'departure');
    this.atc(`{cs}, contact ${dep.name} {fq:${dep.freq}}. Good day.`, `${dep.name.split(' ').slice(-1)[0]} {fq:${dep.freq}}, {cs}, good day.`)
      .then((ok) => { if (!ok) return; this.contact(dep); this.checkIn(); });
    this.phase = 'DEPARTURE';
  }
  // first call on a new radar frequency
  checkIn() {
    const fm = this.app.fm, o = fm.out, ap = this.app.ap;
    const alt = Math.round(o.alt / 100) * 100;
    const climbing = o.vs > 400, desc = o.vs < -400;
    const tgt = ap?.engaged ? ap.alt : this.assigned.alt || alt;
    const passing = climbing ? `passing {alt:${alt}}, climbing {alt:${tgt}}` : desc ? `descending through {alt:${alt}} for {alt:${this.assigned.alt || tgt}}` : `level {alt:${alt}}`;
    const f = this.fac;
    if (f.role === 'departure') {
      this.pilot(`${f.name}, {cs}, ${passing}.`);
      const climbTo = Math.max(tgt, alt);
      this.assigned.alt = climbTo;
      const lat = this.lateralInstr();
      this.atc(`{cs}, ${f.name}, radar contact. Climb and maintain {alt:${climbTo}}, ${lat}.`, `Climb and maintain {alt:${climbTo}}, ${lat}, {cs}.`);
    } else if (f.role === 'center') {
      this.pilot(`${f.name}, {cs}, ${passing}.`);
      const a = ap?.engaged ? ap.alt : (climbing ? this.altRound(Math.max(alt + 2000, this.crzAlt)) : alt);
      this.assigned.alt = a;
      if (Math.abs(a - alt) > 300) this.atc(`{cs}, ${f.name}, roger. ${a > alt ? 'Climb' : 'Descend'} and maintain {alt:${a}}.`, `${a > alt ? 'Climb' : 'Descend'} and maintain {alt:${a}}, {cs}.`);
      else this.atc(`{cs}, ${f.name}, roger, maintain {alt:${a}}.`, `Maintain {alt:${a}}, {cs}.`);
    } else if (f.role === 'approach') {
      const arr = this.arrival();
      this.pilot(`${f.name}, {cs}, ${passing}, with information {ph:${this.atisArr}}.`);
      const appAlt = this.approachAlt();
      this.assigned.alt = alt > appAlt + 300 ? appAlt : alt;
      const rw = arr?.rwy?.ident;
      const desc2 = alt > this.assigned.alt + 300 ? `descend and maintain {alt:${this.assigned.alt}}` : `maintain {alt:${this.assigned.alt}}`;
      if (rw) this.atc(`{cs}, ${f.name}, ${desc2}, expect ILS runway {rwy:${rw}} approach, {qnh}.`, `${desc2[0].toUpperCase() + desc2.slice(1)}, expect ILS runway {rwy:${rw}}, {qnh}, {cs}.`);
      else this.atc(`{cs}, ${f.name}, radar contact, ${desc2}, {qnh}.`, `${desc2[0].toUpperCase() + desc2.slice(1)}, {cs}.`);
    }
  }
  approachAlt() {
    const arr = this.arrival();
    const elev = arr ? arr.ap.e : 0;
    return Math.ceil((elev + (this.isGA ? 2000 : 3000)) / 100) * 100;
  }
  handoffCenter() {
    const c = this.centerFacility();
    this.atc(`{cs}, contact ${c.name} {fq:${c.freq}}.`, `${c.name} {fq:${c.freq}}, {cs}.`).then((ok) => { if (!ok) return; this.contact(c); this.checkIn(); });
    this.phase = 'CRUISE';
  }
  issueDescent(requested) {
    const fm = this.app.fm, o = fm.out, arr = this.arrival();
    const alt = Math.round(o.alt / 100) * 100;
    const target = Math.max(this.approachAlt() + (this.fac.role === 'approach' ? 0 : 6000), 0);
    const a = this.altRound(Math.min(target, alt - 1000));
    this.flags.descent = true; this.assigned.alt = a;
    if (requested) this.pilot(`{cs}, request descent.`);
    const vnav = this.app.ap?.engaged && this.app.ap.vert === 'VNAV';
    const rw = arr?.rwy?.ident;
    this.atc(`{cs}, descend ${vnav ? 'at pilot\'s discretion, ' : ''}and maintain {alt:${a}}${rw ? `, expect ILS runway {rwy:${rw}} at ${arr.ap.i}` : ''}. ${arr ? `${arr.ap.i} ` : ''}{qnh}.`,
      `Descend${vnav ? ' at pilot\'s discretion,' : ''} and maintain {alt:${a}}, {qnh}, {cs}.`);
  }
  handoffApproach() {
    const arr = this.arrival(); if (!arr) return;
    const f = this.facility(arr.ap, 'approach');
    if (this.fac.role === 'approach' && this.fac.ap === arr.ap) { this.phase = 'APPROACH'; return; }
    this.atc(`{cs}, contact ${f.name} {fq:${f.freq}}.`, `${f.name.split(' ').slice(-1)[0]} {fq:${f.freq}}, {cs}.`).then((ok) => { if (!ok) return; this.contact(f); this.checkIn(); });
    this.phase = 'APPROACH';
  }
  approachClearance() {
    const arr = this.arrival(); if (!arr?.rwy) return;
    const ap = this.app.ap, fm = this.app.fm, rw = arr.rwy.ident;
    const g = this.ilsGeom(arr.rwy);
    const appAlt = this.approachAlt();
    this.flags.appCleared = true;
    const route = arr.route;
    if (ap?.engaged && ap.lat === 'HDG') {
      // vector to a 30° intercept on the side of the centreline the aircraft is on
      const crs = arr.rwy.heading * R2D;
      const ih = wrap360(crs + (g.xtk > 0 ? -30 : 30));
      const turn = wrap180(ih - fm.out.hdg) > 0 ? 'right' : 'left';
      this.atc(`{cs}, turn ${turn} heading {hdg:${ih}}, maintain {alt:${appAlt}} until established on the localizer, cleared ILS runway {rwy:${rw}} approach.`,
        `${turn[0].toUpperCase() + turn.slice(1)} heading {hdg:${ih}}, {alt:${appAlt}} until established, cleared ILS runway {rwy:${rw}}, {cs}.`);
    } else {
      const fafNm = route ? Math.max(1, Math.round(distance(fm.lat, fm.lon, route.faf.lat, route.faf.lon) / NM)) : Math.max(1, Math.round((g.along - 8 * NM) / NM));
      const lead = g.along > 9 * NM ? `${fafNm} miles from the final approach fix, ` : '';
      this.atc(`{cs}, ${lead}maintain {alt:${appAlt}} until established on the localizer, cleared ILS runway {rwy:${rw}} approach.`,
        `{alt:${appAlt}} until established, cleared ILS runway {rwy:${rw}} approach, {cs}.`);
    }
    this.assigned.alt = appAlt;
  }
  handoffTower() {
    const arr = this.arrival(); if (!arr) return;
    const t = this.facility(arr.ap, 'tower');
    const go = () => {
      this.contact(t);
      const g = this.ilsGeom(arr.rwy);
      const nm = Math.max(1, Math.round(g.along / NM));
      this.pilot(`${t.name}, {cs}, ${nm} mile final, ILS runway {rwy:${arr.rwy.ident}}.`);
      this.flags.land = true;
      this.atc(`{cs}, ${t.name}, {wind}, runway {rwy:${arr.rwy.ident}}, cleared to land.`, `Cleared to land runway {rwy:${arr.rwy.ident}}, {cs}.`);
    };
    this.phase = 'FINAL'; this.minAgl = 1e9;
    if (this.fac.role === 'tower' && this.fac.ap === arr.ap) { go(); return; }
    this.atc(`{cs}, contact ${t.name} {fq:${t.freq}}.`, `Tower {fq:${t.freq}}, {cs}.`).then((ok) => { if (ok) go(); });
  }
  goAround(pilotInit) {
    const arr = this.arrival(); if (!arr) return;
    const appAlt = this.approachAlt();
    this.pilot(`{cs}, going around.`);
    void pilotInit;
    const a = this.facility(arr.ap, 'approach');
    this.atc(`{cs}, roger, fly runway heading, climb and maintain {alt:${appAlt}}, contact ${a.name} {fq:${a.freq}}.`, `Runway heading, climb and maintain {alt:${appAlt}}, ${a.name.split(' ').pop()} {fq:${a.freq}}, {cs}.`)
      .then((ok) => { if (!ok) return; this.contact(a); this.pilot(`${a.name}, {cs}, missed approach, climbing {alt:${appAlt}}.`); this.atc(`{cs}, ${a.name}, radar contact, maintain {alt:${appAlt}}, expect vectors for another ILS runway {rwy:${arr.rwy.ident}} approach.`, `Maintain {alt:${appAlt}}, vectors for the ILS, {cs}.`); });
    this.assigned.alt = appAlt;
    this.flags.land = false; this.flags.appCleared = false; this.flags.twr = false;
    this.phase = 'APPROACH'; this.goAroundAt = this.t;
  }
  rollout() {
    const arr = this.arrival() || { ap: airportsNear(this.app.fm.lat, this.app.fm.lon, 8000, 1)[0] };
    if (!arr?.ap) return;
    const g = this.facility(arr.ap, 'ground');
    const side = hash(arr.ap.i + (arr.rwy?.ident || '')) & 1 ? 'right' : 'left';
    this.atc(`{cs}, turn ${side} at the next available taxiway, contact ${g.name} {fq:${g.freq}} when clear.`, `${side[0].toUpperCase() + side.slice(1)} next taxiway, ground {fq:${g.freq}}, {cs}.`);
    this.phase = 'LANDED'; this.gndFac = g;
  }
  taxiIn(requested) {
    const g = this.gndFac || this.facility(this.arrival()?.ap, 'ground');
    this.contact(g);
    const rw = this.arrival()?.rwy?.ident || this.landRwy?.ident;
    this.pilot(`${g.name}, {cs}, clear of runway${rw ? ` {rwy:${rw}}` : ''}, request taxi to ${this.cargo ? 'the cargo ramp' : this.isGA ? 'parking' : 'the gate'}.`);
    const seed = hash(this.cs.text + (this.arrival()?.ap?.i || ''));
    const gate = 'ABCDE'[seed % 5] + (1 + (seed >> 4) % 38);
    const where = this.cargo ? 'the cargo ramp' : this.isGA ? 'general aviation parking' : `gate ${gate}`;
    this.atc(`{cs}, ${g.name}, taxi to ${where} via the parallel taxiway${this.isGA ? '' : ', monitor ramp on reaching the apron'}.`, `Taxi to ${where} via the parallel, {cs}.`);
    this.phase = 'TAXI_IN';
    void requested;
  }
  requestAltitude(alt, auto) {
    const o = this.app.fm.out;
    const up = alt > o.alt;
    this.pilot(`{cs}, request ${up ? 'climb' : 'descent'} to {alt:${alt}}.`);
    this.assigned.alt = alt;
    const f = this.fac.role === 'tower' || this.fac.role === 'ground' || this.fac.role === 'clearance' ? null : this.fac;
    if (!f) return;
    this.atc(`{cs}, ${up ? 'climb' : 'descend'} and maintain {alt:${alt}}.`, `${up ? 'Climb' : 'Descend'} and maintain {alt:${alt}}, {cs}.`);
    void auto;
  }
  requestDirect() {
    const arr = this.arrival(); if (!arr) return;
    this.pilot(`{cs}, request direct ${arr.ap.i}.`);
    this.atc(`{cs}, proceed direct ${arr.ap.i}.`, `Direct ${arr.ap.i}, {cs}.`);
  }
  requestLanding() {
    const fm = this.app.fm;
    const cands = airportsNear(fm.lat, fm.lon, 80 * NM, 12).filter((a) => runwayEnds(a).some((r) => r.lengthFt >= (this.isGA ? 2500 : 6000)));
    const ap = cands[0];
    if (!ap) { this.sys('No suitable airport within 80 NM.'); return; }
    const ends = runwayEnds(ap); const maxL = Math.max(...ends.map((r) => r.length));
    const rwy = ends.filter((r) => r.length >= maxL * 0.75).sort((a, b) => Math.abs(wrap180(a.heading * R2D - this.plan.windDir)) - Math.abs(wrap180(b.heading * R2D - this.plan.windDir)))[0];
    this.freeArr = { ap, rwy };
    this.pilot(`{cs}, request ILS approach and full stop landing at ${ap.i}, ${placeName(ap)}.`);
    this.atc(`{cs}, roger, expect ILS runway {rwy:${rwy.ident}} at ${ap.i}, proceed direct ${ap.i}.`, `Expect ILS runway {rwy:${rwy.ident}}, direct ${ap.i}, {cs}.`);
    this.sys(`Tip: set ${ap.i} as your destination on the map (M) to let LNAV/VNAV fly the approach.`);
  }
  requestWeather() {
    const arr = this.arrival();
    const ap = arr?.ap || this.origin;
    const wx = { clear: 'sky clear', few: 'few clouds at five thousand', scattered: 'scattered clouds at four thousand', broken: 'ceiling broken three thousand five hundred', overcast: 'ceiling overcast two thousand', storm: 'thunderstorm, ceiling broken one thousand five hundred' }[this.plan.weather] || 'sky clear';
    const vis = this.plan.weather === 'storm' ? 'visibility three miles' : 'visibility one zero miles';
    this.pilot(`{cs}, request ${ap.i} weather.`);
    this.atc(`{cs}, ${ap.i} weather: {wind}, ${vis}, ${wx}, temperature one five, {qnh}.`, `Copy the weather, {cs}.`);
  }
  sayAgain() {
    if (!this.lastAtc) return;
    this.pilot(`{cs}, say again.`);
    this.atc(this.lastAtc);
  }

  // ---------------------------------------------------------------- main update (state machine)
  update(dt) {
    if (!this.active || !this.app?.fm) return;
    try { this._update(dt); } catch (e) { if (!this.warned) { this.warned = true; console.warn('ATC error (ignored):', e); } }
  }
  _update(dt) {
    this.t += dt;
    if (this.timers?.length) { const due = this.timers.filter((x) => x.at <= this.t); this.timers = this.timers.filter((x) => x.at > this.t); for (const x of due) if (x.gen === this.gen) x.fn(); }
    this.tick += dt; if (this.tick < 0.25) return; const step = this.tick; this.tick = 0;
    const app = this.app, fm = app.fm, o = fm.out, ap = app.ap;
    if (fm.crashed) { this.stop(); return; }
    const onG = fm.onGround;
    const arr = this.arrival();
    const ph = this.phase;
    // ----- departure ground phases
    if (['PARKED', 'CLEARED', 'TAXI', 'LINEUP'].includes(ph)) {
      if (ph === 'LINEUP' && this.onRunway(this.depRwy) && !this.flags.toPending) { this.flags.toPending = true; this.later(4, () => { if (this.phase === 'LINEUP') this.takeoffCleared(); }); }
      // the pilot is rolling for take-off without a clearance: call ready and clear them, rather than block the flight
      if (onG && fm.ctl.throttle > 0.55 && o.gs > 5 && !this.flags.takeoff && this.onRunway(this.depRwy)) { this.readyForDeparture(true); }
      if (!onG && o.agl > 50) { this.phase = 'TAKEOFF'; this.flags.takeoff = true; }
    }
    if (this.phase === 'TAKEOFF') {
      if (!this.fac || this.fac.role !== 'tower') this.contact(this.facility(this.origin, 'tower'));
      if (!onG && o.agl > (this.isGA ? 500 : 900) && o.vs > 0) this.handoffDeparture();
    }
    // ----- radar phases: keep ATC assignments matched to the autopilot / pilot
    if (['DEPARTURE', 'CRUISE', 'APPROACH'].includes(this.phase) && !onG && this.fac && ['departure', 'center', 'approach'].includes(this.fac.role)) {
      // MCP altitude changed and held for a few seconds → pilot requests it
      if (ap?.engaged && ap.vert !== 'VNAV' && ap.vert !== 'GS') {
        if (ap.alt !== this.lastMcpAlt) { this.lastMcpAlt = ap.alt; this.mcpStable = 0; }
        else this.mcpStable += step;
        if (this.assigned.alt != null && this.mcpStable > 4 && Math.abs(ap.alt - this.assigned.alt) >= 500 && Math.abs(ap.alt - o.alt) > 300 && !!this.audio.voice.idle) this.requestAltitude(ap.alt, true);
      } else if (!ap?.engaged && this.assigned.alt != null) {
        // hand flying: if the pilot settles well away from the assigned level, re-clear to where they are going
        const dev = o.alt - this.assigned.alt;
        if (Math.abs(dev) > 1200 && Math.sign(dev) === Math.sign(o.vs || dev)) this.devTimer += step; else this.devTimer = 0;
        if (this.devTimer > 20 && !!this.audio.voice.idle) {
          this.devTimer = 0;
          const a = this.altRound(o.alt + Math.sign(o.vs) * Math.min(3000, Math.abs(o.vs) * 0.5));
          this.assigned.alt = a;
          this.atc(`{cs}, altitude ${a > o.alt ? 'climb' : 'descend'} at your discretion, maintain {alt:${a}}.`, `Maintain {alt:${a}}, {cs}.`);
        }
      }
    }
    if (this.phase === 'DEPARTURE') {
      const dOrig = this.origin ? distance(fm.lat, fm.lon, this.origin.la * D2R, this.origin.lo * D2R) / NM : 0;
      const dArr = arr?.rwy ? distance(fm.lat, fm.lon, arr.rwy.lat, arr.rwy.lon) / NM : 1e9;
      if (arr && arr.ap !== this.origin && dArr < 35 && dOrig > 8 && this.fac?.role === 'departure') this.handoffApproach();
      else if (o.alt > Math.min(12000, this.crzAlt - 2000) && dOrig > 20 && o.alt > 9000 && this.fac?.role === 'departure') this.handoffCenter();
    }
    if (this.phase === 'CRUISE') {
      if (arr && arr.rwy && this.fac && this.fac.role !== 'approach') {
        const dArr = distance(fm.lat, fm.lon, arr.rwy.lat, arr.rwy.lon) / NM;
        const todNm = (o.alt - arr.ap.e) / 1000 * 3.1 + 12;
        if (!this.flags.descent && o.alt > arr.ap.e + 7000 && ((ap?.tod && ap.vert === 'VNAV') || dArr < todNm) && !!this.audio.voice.idle && this.fac.role !== 'departure') this.issueDescent(!!ap?.tod);
        if (dArr < 40 || (o.alt < 13000 && o.vs < -300 && dArr < 70 && this.fac.role === 'center')) this.handoffApproach();
      }
    }
    if (this.phase === 'APPROACH' && arr?.rwy && this.fac?.role === 'approach') {
      const g = this.ilsGeom(arr.rwy);
      const aligned = Math.abs(wrap180(o.track - arr.rwy.heading * R2D)) < 35 && g.along > 0;
      const nav = arr.route && ap?.route === arr.route ? ap.navInfo() : null;
      const nearFaf = nav ? (nav.pastFaf || nav.togo < arr.route.fafDist + 15 * NM) : g.along < 20 * NM;
      if (!this.flags.appCleared && (nearFaf || ap?.appArmed || ap?.lat === 'LOC') && this.t - (this.goAroundAt || -99) > 40 && !!this.audio.voice.idle) this.approachClearance();
      const established = (ap?.lat === 'LOC' && Math.abs(g.xtk) < 600) || (aligned && Math.abs(g.xtk) < 450);
      if (this.flags.appCleared && (established && g.along < 13 * NM || g.along < 7 * NM && aligned) && !this.flags.twr) { this.flags.twr = true; this.handoffTower(); }
    }
    if (this.phase === 'FINAL') {
      if (!onG) this.minAgl = Math.min(this.minAgl, o.agl);
      if (!onG && this.minAgl < 1500 && o.vs > 700 && o.agl > this.minAgl + 250 && fm.ctl.throttle > 0.6) this.goAround(false);
      if (onG && fm.groundTime > 1) { this.phase = 'ROLLOUT'; this.landRwy = arr?.rwy; }
    }
    // touchdown anywhere (e.g. free flight without ATC landing flow)
    if (onG && fm.groundTime > 1 && ['DEPARTURE', 'CRUISE', 'APPROACH'].includes(this.phase) && o.ias < 140) {
      const here = this.anyRunwayHere();
      if (here) { const ap2 = airportsNear(fm.lat, fm.lon, 6000, 1)[0]; this.arrOverride = { ap: ap2, rwy: here }; this.contact(this.facility(ap2, 'tower')); this.phase = 'ROLLOUT'; this.landRwy = here; }
    }
    if (this.phase === 'ROLLOUT' && onG && o.gs < 75) this.rollout();
    if (this.phase === 'LANDED' && onG) {
      const offRwy = !this.landRwy || !this.onRunway(this.landRwy);
      this.slowT = o.gs < 25 ? (this.slowT || 0) + step : 0;
      if ((offRwy && o.gs < 30) || this.slowT > 12) { this.phase = 'LANDED_WAIT'; this.later(1.5, () => { if (this.phase === 'LANDED_WAIT') this.taxiIn(); }); }
    }
    if (!onG && ['LANDED', 'LANDED_WAIT', 'TAXI_IN', 'ROLLOUT'].includes(this.phase) && o.agl > 300) { this.phase = 'DEPARTURE'; this.fac = this.facility(this.arrival()?.ap || this.origin, 'departure'); }
    if (this.phase !== this.lastPhase) { this.lastPhase = this.phase; this.renderMenu(); }
    if (this.open && (this.menuT = (this.menuT || 0) + step) > 2) { this.menuT = 0; this.renderMenu(); }
  }

  // touchdown / liftoff events from the flight model (optional hooks)
  event(ev) { if (ev?.type === 'crash') this.stop(); }

  // ---------------------------------------------------------------- pilot menu (like the MSFS ATC window)
  options() {
    if (!this.active) return [];
    const app = this.app, fm = app.fm, o = fm.out, ap = app.ap, ph = this.phase, arr = this.arrival();
    const opts = [];
    const add = (label, fn) => opts.push({ label, fn });
    const onRwy = this.onRunway(this.depRwy);
    if (ph === 'PARKED') {
      add(app.dest ? `Request IFR clearance to ${app.dest.ap.i}` : 'Request VFR departure', () => this.reqClearance());
      if (!onRwy) add('Request taxi', () => this.reqTaxi());
      add(`Ready for departure, runway ${this.depRwy.ident}`, () => this.readyForDeparture());
    } else if (ph === 'CLEARED' || ph === 'TAXI') {
      if (!onRwy && ph === 'CLEARED') add('Request taxi', () => this.reqTaxi());
      add(`Ready for departure, runway ${this.depRwy.ident}`, () => this.readyForDeparture());
    } else if (ph === 'LINEUP') {
      add('Request take-off clearance', () => this.takeoffCleared());
    } else if (['DEPARTURE', 'CRUISE', 'APPROACH'].includes(ph) && !fm.onGround) {
      const mcp = ap?.alt;
      if (mcp && this.assigned.alt != null && Math.abs(mcp - this.assigned.alt) >= 500) add(`Request ${mcp > o.alt ? 'climb' : 'descent'} to ${this.fmt(`{alt:${mcp}}`, 'text')} (MCP)`, () => this.requestAltitude(mcp));
      const base = this.assigned.alt ?? Math.round(o.alt / 1000) * 1000;
      add(`Request higher (${this.fmt(`{alt:${base + 2000}}`, 'text')})`, () => this.requestAltitude(base + 2000));
      if (base - 2000 > (arr?.ap?.e || 0) + 1500) add(`Request lower (${this.fmt(`{alt:${base - 2000}}`, 'text')})`, () => this.requestAltitude(base - 2000));
      if (arr && ph !== 'APPROACH') add(`Request direct ${arr.ap.i}`, () => this.requestDirect());
      if (arr && ph === 'CRUISE' && !this.flags.descent) add('Request descent', () => this.issueDescent(true));
      if (arr && ph === 'APPROACH' && !this.flags.appCleared) add(`Request ILS runway ${arr.rwy.ident} approach`, () => this.approachClearance());
      if (!arr) add('Request landing at the nearest airport', () => this.requestLanding());
      add(`Request ${arr ? arr.ap.i : 'local'} weather`, () => this.requestWeather());
    } else if (ph === 'FINAL') {
      add('Going around', () => this.goAround(true));
    } else if (ph === 'LANDED' || ph === 'LANDED_WAIT') {
      add(`Request taxi to ${this.cargo ? 'the cargo ramp' : this.isGA ? 'parking' : 'the gate'}`, () => this.taxiIn(true));
    }
    if (this.lastAtc) add('Say again', () => this.sayAgain());
    return opts.slice(0, 9);
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    if (!document.getElementById('atcStyle')) { const s = document.createElement('style'); s.id = 'atcStyle'; s.textContent = CSS; document.head.appendChild(s); }
    const host = document.getElementById('flightUI') || document.body;
    if (!this.panel) {
      this.panel = document.createElement('div'); this.panel.id = 'atcPanel'; this.panel.className = 'hidden';
      this.panel.innerHTML = '<header><b id="atcFreq">---.---</b><span id="atcFac">ATC</span><button id="atcClose" title="Close (` or L)">✕</button></header><div id="atcLog"></div><div id="atcMenu"></div>';
      host.appendChild(this.panel);
      this.panel.querySelector('#atcClose').onclick = () => this.toggle(false);
      this.sub = document.createElement('div'); this.sub.id = 'atcSub'; this.sub.className = 'off'; host.appendChild(this.sub);
      // keep clicks in the panel from reaching the 3D view
      this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.panel.classList.toggle('hidden', !this.open);
    this.renderLog();
  }
  toggle(on = !this.open) { this.open = on; if (this.panel) this.panel.classList.toggle('hidden', !on); if (on) { this.sub?.classList.add('off'); this.renderMenu(); this.renderLog(); } }
  onKey(e) {
    if (!this.active || !this.app?.flying) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === '`' || e.key === 'l' || e.key === 'L') { if (!e.repeat) this.toggle(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    // with the ATC window open, number keys pick menu entries (like MSFS)
    if (this.open && /^[1-9]$/.test(e.key) && !e.repeat && !this.app.paused) {
      const opt = this.options()[+e.key - 1];
      if (opt) { opt.fn(); this.renderMenu(); e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }
  renderMenu() {
    if (!this.panel) return;
    const m = this.panel.querySelector('#atcMenu');
    const opts = this.options();
    m.innerHTML = '';
    opts.forEach((op, i) => {
      const b = document.createElement('button'); b.innerHTML = `<kbd>${i + 1}</kbd>`; b.appendChild(document.createTextNode(op.label));
      b.onclick = () => { try { op.fn(); } catch (err) { console.warn(err); } this.renderMenu(); };
      m.appendChild(b);
    });
    if (this.fac) { this.panel.querySelector('#atcFreq').textContent = this.fac.freq; this.panel.querySelector('#atcFac').textContent = this.fac.name + (this.assigned.alt != null ? ` · ALT ${this.fmt(`{alt:${this.assigned.alt}}`, 'text')}` : '') + ` · SQK ${this.squawk}`; }
  }
  renderLog() {
    if (!this.panel || !this.open) return;
    const el = this.panel.querySelector('#atcLog');
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    el.innerHTML = this.log.slice(-60).map((l) => (l.kind === 'sys' ? `<p class="sys"><small>${l.at}</small>${esc(l.text)}</p>` : `<p class="${l.kind}"><small>${l.at}</small><i>${esc(l.who)}:</i> ${esc(l.text)}</p>`)).join('');
    el.scrollTop = el.scrollHeight;
    this.renderMenu();
  }
  showSub(kind, who, text) {
    if (!this.sub || this.open) return;
    this.sub.className = kind;
    this.sub.innerHTML = '';
    const i = document.createElement('i'); i.textContent = who + ': '; this.sub.appendChild(i); this.sub.appendChild(document.createTextNode(text));
    clearTimeout(this.subT); this.subT = setTimeout(() => this.sub.classList.add('off'), 4000 + text.length * 55);
  }
}
