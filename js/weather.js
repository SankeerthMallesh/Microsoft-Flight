// Real-world live weather (METAR + numerical model), and the weather effects layer:
// height fog / haze, overcast darkening, cloud decks, rain / snow, windscreen rain and lightning.
//
// Data sources (all free, no key, CORS-enabled from a browser):
//   1. VATSIM METAR service      https://metar.vatsim.net/<ICAO>            (raw METAR text)
//   2. aviationweather.gov API   https://aviationweather.gov/api/data/metar (JSON; no CORS today, tried as a fallback)
//   3. Open-Meteo                https://api.open-meteo.com/v1/forecast     (current + winds/temps aloft, clouds)
// Open-Meteo is always asked for the upper air; when no station reports a METAR it also stands in
// for the surface observation. Results are cached (15 min fresh, 6 h stale) so the sim degrades
// gracefully offline, finally falling back to a static preset.
/* global Cesium */
import { D2R, R2D, FT, KT, NM, clamp, lerp, distance } from './sim/math.js';

const C = () => window.Cesium;
const FRESH_MS = 15 * 60e3, STALE_MS = 6 * 3600e3;
const LEVELS = [925, 850, 700, 500, 300, 250, 200];
const STD_H = { 925: 760, 850: 1460, 700: 3010, 500: 5570, 300: 9160, 250: 10360, 200: 11790 };
const COVER_OKTAS = { FEW: 2, SCT: 4, BKN: 6, OVC: 8, VV: 8 };

// ------------------------------------------------------------------ fetching
async function getJSON(url, ms = 7000, text = false) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return text ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}
const cache = {
  get(k) { try { return JSON.parse(localStorage.getItem('openskies.wx.' + k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('openskies.wx.' + k, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* quota / private mode */ } },
};

async function fetchMetarRaw(icao) {
  // VATSIM first: it sends Access-Control-Allow-Origin. aviationweather.gov is tried after it.
  try {
    const txt = (await getJSON('https://metar.vatsim.net/' + encodeURIComponent(icao), 6000, true)).trim();
    const line = txt.split('\n').map((s) => s.trim()).find((s) => s.startsWith(icao + ' '));
    if (line) return { raw: line, src: 'VATSIM METAR' };
  } catch (e) { /* next */ }
  try {
    const j = await getJSON(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`, 5000);
    if (Array.isArray(j) && j[0]?.rawOb) return { raw: j[0].rawOb.replace(/^(METAR|SPECI)\s+/, ''), src: 'aviationweather.gov' };
  } catch (e) { /* next */ }
  return null;
}

async function fetchModel(lat, lon) {
  const cur = 'temperature_2m,dew_point_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation,rain,snowfall,showers,weather_code';
  const hr = ['cloud_base', ...LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `temperature_${l}hPa`, `geopotential_height_${l}hPa`])].join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=${cur}&hourly=${hr}&forecast_hours=3&wind_speed_unit=kn&timezone=GMT`;
  return getJSON(url, 8000);
}

// ------------------------------------------------------------------ METAR decoding
const frac = (s) => s.split(' ').reduce((a, p) => a + (p.includes('/') ? (+p.split('/')[0]) / (+p.split('/')[1]) : +p), 0);
export function parseMetar(raw) {
  const wx = { raw, station: null, time: null, wind: { dir: 0, spd: 0, gust: 0, vrb: false, from: null, to: null }, visM: 20000, cavok: false,
    clouds: [], tempC: null, dewC: null, qnh: null, precip: null, obsc: [], ts: false, cb: false };
  let s = raw.replace(/^(METAR|SPECI)\s+/, '').replace(/\s+/g, ' ');
  s = s.split(/ (RMK|TEMPO|BECMG|NOSIG|FM\d{6}|PROB\d\d)\b/)[0];
  // statute-mile visibility can be two tokens ("1 1/2SM"): join them first
  s = s.replace(/\b(\d) (\d\/\dSM)\b/, '$1_$2');
  const tok = s.split(' ');
  wx.station = tok.shift();
  for (const t of tok) {
    let m;
    if (/^\d{6}Z$/.test(t)) wx.time = t;
    else if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/))) {
      const k = m[4] === 'MPS' ? 1.94384 : m[4] === 'KMH' ? 0.539957 : 1;
      wx.wind = { ...wx.wind, dir: m[1] === 'VRB' ? 0 : +m[1], vrb: m[1] === 'VRB', spd: Math.round(+m[2] * k), gust: m[3] ? Math.round(+m[3] * k) : 0 };
    } else if ((m = t.match(/^(\d{3})V(\d{3})$/))) { wx.wind.from = +m[1]; wx.wind.to = +m[2]; }
    else if (t === 'CAVOK') { wx.cavok = true; wx.visM = 30000; }
    else if (/^\d{4}(NDV)?$/.test(t) && !wx._vis) { wx._vis = 1; wx.visM = +t.slice(0, 4) >= 9999 ? 25000 : +t.slice(0, 4); }
    else if ((m = t.match(/^([MP])?([\d_/]+)SM$/))) { wx._vis = 1; const sm = frac(m[2].replace('_', ' ')); wx.visM = m[1] === 'P' || sm >= 10 ? 25000 : Math.max(50, sm * 1609.34); }
    else if ((m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU|\/\/\/)?$/))) { wx.clouds.push({ cover: m[1], baseFt: +m[2] * 100, type: m[3] === '///' ? null : m[3] || null }); if (m[3] === 'CB') wx.cb = true; }
    else if ((m = t.match(/^VV(\d{3}|\/\/\/)$/))) wx.clouds.push({ cover: 'VV', baseFt: m[1] === '///' ? 100 : Math.max(100, +m[1] * 100), type: null });
    else if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) { const n = (v) => (v[0] === 'M' ? -1 : 1) * +v.replace('M', ''); wx.tempC = n(m[1]); if (m[2]) wx.dewC = n(m[2]); }
    else if ((m = t.match(/^Q(\d{4})$/))) wx.qnh = +m[1];
    else if ((m = t.match(/^A(\d{4})$/))) wx.qnh = Math.round(+m[1] / 100 * 33.8639 * 10) / 10;
    else if ((m = t.match(/^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|HZ|DU|SA|VA|PO|SQ|FC|SS|DS)+)?$/)) && (m[2] || m[3])) {
      if (m[1] === 'VC') { if (m[2] === 'TS') wx.ts = true; continue; }
      if (m[2] === 'TS') wx.ts = true;
      const ph = m[3] || '';
      const intensity = m[1] === '-' ? 0.35 : m[1] === '+' ? 1 : 0.65;
      const snow = /SN|SG|IC|PL/.test(ph), liquid = /RA|DZ/.test(ph);
      if (snow || liquid || /GR|GS/.test(ph) || (m[2] === 'TS' && !ph)) {
        const type = snow && !liquid ? 'snow' : /^DZ$/.test(ph) ? 'drizzle' : 'rain';
        if (!wx.precip || intensity > wx.precip.intensity) wx.precip = { type, intensity: m[2] === 'TS' && !ph ? 0 : intensity, shower: m[2] === 'SH', code: (m[1] || '') + (m[2] || '') + ph };
        if (snow && liquid) wx.precip.mixed = true;
      }
      for (const o of ['BR', 'FG', 'HZ', 'FU', 'DU', 'SA']) if (ph.includes(o)) wx.obsc.push(m[2] === 'MI' || m[2] === 'BC' || m[2] === 'PR' ? 'shallow' + o : o);
    }
  }
  delete wx._vis;
  return wx;
}

// Open-Meteo surface data -> METAR-like observation (when no station report is available)
function wmoToWx(code, intensityMm, snowCm) {
  const p = (type, i, shower = false) => ({ type, intensity: i, shower, code: '' });
  if (code >= 95) return { precip: p('rain', code >= 96 ? 1 : 0.7, true), ts: true };
  if (code >= 85) return { precip: p('snow', code === 86 ? 0.9 : 0.5, true) };
  if (code >= 80) return { precip: p('rain', code === 82 ? 1 : code === 81 ? 0.65 : 0.35, true) };
  if (code >= 71) return { precip: p('snow', code >= 75 ? 1 : code >= 73 ? 0.65 : 0.35) };
  if (code >= 61) return { precip: p('rain', code >= 65 ? 1 : code >= 63 ? 0.65 : 0.35) };
  if (code >= 51) return { precip: p('drizzle', code >= 55 ? 0.8 : 0.4) };
  if (intensityMm > 0.1) return { precip: p(snowCm > 0 ? 'snow' : 'rain', clamp(intensityMm / 4, 0.3, 1)) };
  return { precip: null };
}
const coverFromPct = (p) => (p < 8 ? null : p < 30 ? 'FEW' : p < 55 ? 'SCT' : p < 88 ? 'BKN' : 'OVC');
function modelToObs(m, icao) {
  const c = m.current || {};
  const hIdx = 0, hr = m.hourly || {};
  const wx = { raw: '', station: icao, time: null, synthetic: true, wind: { dir: Math.round(c.wind_direction_10m || 0), spd: Math.round(c.wind_speed_10m || 0), gust: 0, vrb: false },
    visM: clamp(c.visibility ?? 20000, 50, 30000), clouds: [], tempC: c.temperature_2m ?? null, dewC: c.dew_point_2m ?? null, qnh: c.pressure_msl ? Math.round(c.pressure_msl) : null, obsc: [], ts: false, cb: false };
  const g = Math.round(c.wind_gusts_10m || 0); if (g > wx.wind.spd + 8) wx.wind.gust = g;
  const { precip, ts } = wmoToWx(c.weather_code || 0, c.precipitation || 0, c.snowfall || 0);
  wx.precip = precip; wx.ts = !!ts;
  const spread = wx.tempC != null && wx.dewC != null ? Math.max(0, wx.tempC - wx.dewC) : 8;
  if (c.weather_code === 45 || c.weather_code === 48) wx.obsc.push('FG'); else if (wx.visM < 5000 && spread < 3) wx.obsc.push('BR');
  let lowBase = hr.cloud_base?.[hIdx]; if (!(lowBase > 0)) lowBase = Math.max(120, spread * 125);
  const add = (pct, baseFt, type) => { const cv = coverFromPct(pct || 0); if (cv) wx.clouds.push({ cover: cv, baseFt: Math.round(baseFt / 100) * 100, type }); };
  add(c.cloud_cover_low, lowBase / FT, ts ? 'CB' : null);
  add(c.cloud_cover_mid, Math.max(8000, lowBase / FT + 4000), null);
  add(c.cloud_cover_high, 25000, null);
  wx.cb = ts;
  wx.raw = synthMetar(wx);
  return wx;
}
function synthMetar(wx) {
  const z = new Date(); const dd = (n) => String(n).padStart(2, '0');
  const w = wx.wind; const vis = wx.visM >= 9999 ? '9999' : String(Math.round(wx.visM / 100) * 100).padStart(4, '0');
  const pre = wx.precip ? (wx.precip.intensity < 0.4 ? '-' : wx.precip.intensity > 0.9 ? '+' : '') + (wx.ts ? 'TS' : wx.precip.shower ? 'SH' : '') + ({ rain: 'RA', snow: 'SN', drizzle: 'DZ' }[wx.precip.type]) : wx.ts ? 'TS' : '';
  const cl = wx.clouds.length ? wx.clouds.map((c) => c.cover + String(Math.round(c.baseFt / 100)).padStart(3, '0') + (c.type || '')).join(' ') : 'NCD';
  const tt = (v) => (v < 0 ? 'M' : '') + dd(Math.abs(Math.round(v)));
  return [wx.station, `${dd(z.getUTCDate())}${dd(z.getUTCHours())}${dd(z.getUTCMinutes())}Z`, `${String(w.dir).padStart(3, '0')}${dd(w.spd)}${w.gust ? 'G' + dd(w.gust) : ''}KT`, vis, pre, wx.obsc.join(' '), cl,
    wx.tempC != null ? `${tt(wx.tempC)}/${wx.dewC != null ? tt(wx.dewC) : ''}` : '', wx.qnh ? 'Q' + Math.round(wx.qnh) : ''].filter(Boolean).join(' ');
}

// winds & temperatures aloft from the model's pressure levels: [{h (m MSL), dir, spd (kt), tC}]
function aloftFromModel(m) {
  const hr = m?.hourly; if (!hr) return null;
  let i = 0; const now = Date.now();
  if (hr.time) { let best = 1e15; hr.time.forEach((t, k) => { const d = Math.abs(Date.parse(t + 'Z') - now); if (d < best) { best = d; i = k; } }); }
  const out = [];
  for (const l of LEVELS) {
    const spd = hr[`wind_speed_${l}hPa`]?.[i], dir = hr[`wind_direction_${l}hPa`]?.[i];
    if (spd == null || dir == null) continue;
    out.push({ h: hr[`geopotential_height_${l}hPa`]?.[i] ?? STD_H[l], dir, spd, tC: hr[`temperature_${l}hPa`]?.[i] ?? null });
  }
  return out.length ? out.sort((a, b) => a.h - b.h) : null;
}

// ------------------------------------------------------------------ public: observation for an airport
// Returns a weather object (see parseMetar) plus: source, aloft[], elevM, lat, lon, stale
export async function getLiveWeather(ap) {
  const key = ap.i;
  const c = cache.get(key);
  if (c && Date.now() - c.t < FRESH_MS) return { ...c.v, cached: true };
  const [metar, model] = await Promise.all([fetchMetarRaw(ap.i).catch(() => null), fetchModel(ap.la, ap.lo).catch(() => null)]);
  let wx = null;
  if (metar) { wx = parseMetar(metar.raw); wx.source = metar.src; }
  else if (model) { wx = modelToObs(model, ap.i); wx.source = 'Open-Meteo model (no METAR)'; }
  if (!wx) {
    if (c && Date.now() - c.t < STALE_MS) return { ...c.v, stale: true };
    return null;
  }
  wx.aloft = aloftFromModel(model);
  if (model && !metar) wx.source = 'Open-Meteo model (no METAR)';
  else if (model) wx.source += ' + Open-Meteo winds aloft';
  wx.lat = ap.la; wx.lon = ap.lo; wx.elevM = (ap.e || 0) * FT; wx.icao = ap.i;
  if (wx.tempC == null) wx.tempC = model?.current?.temperature_2m ?? 15 - 0.0065 * wx.elevM;
  if (wx.qnh == null) wx.qnh = model?.current?.pressure_msl ?? 1013.25;
  cache.set(key, wx);
  return wx;
}

// short human-readable decode for the UI
export function describe(wx) {
  if (!wx) return '';
  const w = wx.wind, p = [];
  p.push(w.spd < 1 ? 'Calm' : `${w.vrb ? 'Variable' : String(w.dir).padStart(3, '0') + '°'} ${w.spd} kt${w.gust ? ' gusting ' + w.gust : ''}`);
  p.push(wx.cavok ? 'CAVOK' : wx.visM >= 9999 ? 'vis 10 km+' : wx.visM >= 5000 ? `vis ${(wx.visM / 1000).toFixed(0)} km` : wx.visM >= 1000 ? `vis ${(wx.visM / 1000).toFixed(1)} km` : `vis ${Math.round(wx.visM)} m`);
  if (wx.precip) p.push(`${wx.precip.intensity < 0.4 ? 'light ' : wx.precip.intensity > 0.9 ? 'heavy ' : ''}${wx.precip.shower ? 'showers of ' : ''}${wx.precip.mixed ? 'rain and snow' : wx.precip.type}`);
  if (wx.ts) p.push('thunderstorm');
  if (wx.obsc.length) p.push(wx.obsc.map((o) => ({ BR: 'mist', FG: 'fog', HZ: 'haze', FU: 'smoke', DU: 'dust', SA: 'sand' }[o.replace('shallow', '')] || o)).join(', '));
  p.push(wx.clouds.length ? wx.clouds.map((c) => `${c.cover} ${c.baseFt.toLocaleString()} ft${c.type ? ' ' + c.type : ''}`).join(', ') : 'no cloud');
  if (wx.tempC != null) p.push(`${Math.round(wx.tempC)}°C`);
  if (wx.qnh) p.push(`QNH ${Math.round(wx.qnh)}`);
  return p.join(' · ');
}

// nearest static preset (for the menu sky / fallbacks)
export function presetFor(wx) {
  if (!wx) return 'scattered';
  if (wx.ts) return 'storm';
  const ok = Math.max(0, ...wx.clouds.filter((c) => c.baseFt < 12000).map((c) => COVER_OKTAS[c.cover] || 0));
  return ok >= 8 ? 'overcast' : ok >= 6 ? 'broken' : ok >= 4 ? 'scattered' : ok >= 1 ? 'few' : 'clear';
}

// ------------------------------------------------------------------ atmosphere / wind model
// wind (from-direction deg, kt) at altitude: surface obs in the boundary layer, model winds aloft above
function windAt(wx, hMsl, agl, latR) {
  const sDir = wx.wind.vrb ? (wx.aloft?.[0]?.dir ?? 0) : wx.wind.dir, sSpd = wx.wind.spd;
  const a = Math.max(2, agl);
  // log/power-law boundary layer, Ekman veering (clockwise in the northern hemisphere)
  const blTop = 600;
  const pl = Math.min(1.45, Math.pow(Math.max(a, 10) / 10, 0.13));
  const veer = (latR >= 0 ? 1 : -1) * 18 * clamp(a / blTop, 0, 1);
  let dir = sDir + veer, spd = sSpd * (a < 10 ? Math.pow(a / 10, 0.3) : pl);
  const prof = wx.aloft;
  let aDir, aSpd;
  if (prof && prof.length) {
    if (hMsl <= prof[0].h) { aDir = prof[0].dir; aSpd = prof[0].spd; }
    else if (hMsl >= prof[prof.length - 1].h) { const l = prof[prof.length - 1]; aDir = l.dir; aSpd = l.spd; }
    else for (let i = 0; i < prof.length - 1; i++) {
      const p0 = prof[i], p1 = prof[i + 1];
      if (hMsl >= p0.h && hMsl <= p1.h) { const t = (hMsl - p0.h) / (p1.h - p0.h); aDir = p0.dir + ((((p1.dir - p0.dir) % 360) + 540) % 360 - 180) * t; aSpd = lerp(p0.spd, p1.spd, t); break; }
    }
  } else { // no model: a rough, plausible profile (veering, ~2.5 kt per 1000 ft)
    const kft = Math.max(0, hMsl / FT / 1000);
    aDir = sDir + (latR >= 0 ? 1 : -1) * Math.min(40, 18 + kft * 1.5); aSpd = Math.min(sSpd + 6 + kft * 2.5, 110);
  }
  const t = clamp((a - blTop) / 600, 0, 1);
  const dd = ((((aDir - dir) % 360) + 540) % 360) - 180;
  return { dir: dir + dd * t, spd: lerp(spd, aSpd, t) };
}
function tempAt(wx, hMsl) {
  const isa = (h) => 15 - 0.0065 * Math.min(h, 11000);
  const dTs = (wx.tempC ?? isa(wx.elevM)) - isa(wx.elevM);
  const prof = wx.aloft?.filter((p) => p.tC != null);
  if (!prof || !prof.length || hMsl < wx.elevM + 300) return dTs;
  const pts = [{ h: wx.elevM, d: dTs }, ...prof.filter((p) => p.h > wx.elevM + 300).map((p) => ({ h: p.h, d: p.tC - isa(p.h) }))];
  if (hMsl >= pts[pts.length - 1].h) return pts[pts.length - 1].d;
  for (let i = 0; i < pts.length - 1; i++) if (hMsl <= pts[i + 1].h) return lerp(pts[i].d, pts[i + 1].d, (hMsl - pts[i].h) / (pts[i + 1].h - pts[i].h));
  return dTs;
}
const windVec = (dir, spd) => { const f = dir * D2R, s = spd * KT; return [-Math.cos(f) * s, -Math.sin(f) * s, 0]; };

// ------------------------------------------------------------------ GLSL: weather post-process
const FX_GLSL = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float u_time, u_sigma, u_H, u_h0, u_dark, u_rain, u_snow, u_cockpit, u_speed, u_flash, u_drops, u_inCloud;
uniform vec3 u_fogColor, u_upEC;
uniform vec2 u_flow;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n)); }
// falling streaks in a rotated, scrolling cell grid
float streaks(vec2 uv, float scale, float spd, float len, float seed) {
  vec2 g = uv * vec2(scale, scale * 0.12);
  float col = floor(g.x); float r = h21(vec2(col, seed));
  g.y += u_time * spd * (0.8 + 0.4 * r) + r * 10.0;
  float x = fract(g.x) - 0.5 - (r - 0.5) * 0.6;
  float y = fract(g.y);
  float w = smoothstep(0.06, 0.0, abs(x));
  return w * smoothstep(0.0, 0.1, y) * smoothstep(len, len - 0.25, y) * step(0.45, h21(vec2(col, floor(g.y) + seed)));
}
float flakes(vec2 uv, float scale, float spd, float seed) {
  vec2 g = uv * scale; g.y += u_time * spd; g.x += sin(u_time * 0.7 + g.y * 0.6 + seed) * 0.35;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5; vec2 o = (h22(id + seed) - 0.5) * 0.7;
  float r = mix(0.04, 0.11, h21(id + seed * 2.0));
  return smoothstep(r, r * 0.3, length(f - o)) * step(0.35, h21(id + 7.1 + seed));
}
void main(void) {
  vec2 uv = v_textureCoordinates;
  vec4 col = texture(colorTexture, uv);
  // distance from the raw logarithmic depth (czm_windowToEyeCoordinates loses it in a post pass)
  float raw = texture(depthTexture, uv).r;
  bool sky = raw >= 1.0;
  float dist = sky ? 1.0e7 : exp2(raw * czm_log2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x;
  vec4 pv = czm_inverseProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vec3 dir = normalize(pv.xyz / pv.w);
  bool near = !sky && dist < 4.5;          // aircraft cabin / cockpit interior: no weather inside
  // windscreen rain: lens-like drops refracting the scene seen through the glass
  if (u_drops > 0.001 && u_cockpit > 0.5 && !near) {
    vec2 a = vec2(uv.x * czm_viewport.z / czm_viewport.w, uv.y);
    float acc = 0.0; vec2 off = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 22.0 : 40.0;
      vec2 g = a * sc; g.y -= u_time * u_speed * (L == 0 ? 1.6 : 2.4); g.x += u_time * u_speed * 0.15;
      vec2 id = floor(g); vec2 f = fract(g) - 0.5;
      vec2 o = (h22(id + float(L) * 3.7) - 0.5) * 0.6;
      float life = fract(u_time * (0.12 + 0.2 * h21(id)) + h21(id + 1.3));
      float r = mix(0.12, 0.32, h21(id + 9.1)) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.75, 1.0, life) * (1.0 - u_speed));
      vec2 q = f - o; q.y *= mix(1.0, 0.45, u_speed);     // stretched by the airflow at speed
      float d = length(q);
      float m = smoothstep(r, r * 0.8, d) * step(1.0 - u_drops, h21(id + 4.2));
      off += m * q / max(r, 1e-3) * (0.018 / sc * 22.0);
      acc = max(acc, m);
    }
    vec3 refr = texture(colorTexture, uv - off).rgb;
    col.rgb = mix(col.rgb, refr * 0.92 + 0.04, acc);
  }
  if (!near) {
    // exponential height fog: optical depth integrated along the view ray
    float s = dot(dir, u_upEC);
    float L = dist;
    float tau;
    float e0 = exp(-max(u_h0, -50.0) / u_H);
    if (abs(s) < 1e-3) tau = u_sigma * e0 * min(L, 6.0e5);
    else { float k = s * min(L, 6.0e5) / u_H; tau = u_sigma * e0 * u_H / s * (1.0 - exp(-clamp(k, -30.0, 60.0))); }
    tau = max(tau, 0.0);
    float fog = 1.0 - exp(-tau);
    fog = max(fog, u_inCloud * (1.0 - exp(-dist / 70.0)));
    col.rgb = mix(col.rgb, u_fogColor, clamp(fog, 0.0, 1.0));
  }
  // overcast: dim, cooler and flatter light
  float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  col.rgb = mix(col.rgb, vec3(lum) * vec3(0.96, 0.99, 1.04), u_dark * 0.45) * (1.0 - u_dark * 0.42);
  // precipitation in the air in front of the camera
  if ((u_rain > 0.001 || u_snow > 0.001) && !(u_cockpit > 0.5 && near)) {
    vec2 a = vec2((uv.x - 0.5) * czm_viewport.z / czm_viewport.w, uv.y - 0.5);
    // at speed precipitation streams out of the direction of flight (radial), otherwise it falls
    vec2 fall = vec2(a.x + u_flow.x * a.y, a.y);
    float ang = atan(a.y, a.x); float rad = log(length(a) + 0.02);
    vec2 polar = vec2(ang * 3.0, -rad * 2.0);
    float pr = 0.0;
    if (u_rain > 0.001) {
      float r1 = streaks(fall, 90.0, 9.0, 0.9, 1.0) * 0.5 + streaks(fall * 1.6, 90.0, 13.0, 0.8, 2.0) * 0.35;
      float r2 = streaks(polar, 70.0, 10.0 + u_speed * 30.0, 0.9, 3.0) * 0.6;
      pr += mix(r1, r2, u_speed) * u_rain;
    }
    if (u_snow > 0.001) {
      float f1 = flakes(fall, 18.0, 0.9, 1.0) + flakes(fall * 1.7, 18.0, 1.3, 2.0) * 0.7 + flakes(fall * 3.1, 18.0, 1.8, 3.0) * 0.45;
      float f2 = flakes(polar * vec2(1.0, 3.0) + vec2(0.0, u_time * u_speed * 6.0), 6.0, 0.0, 4.0);
      pr += mix(f1, f2, u_speed * 0.8) * u_snow;
    }
    vec3 pc = mix(u_fogColor, vec3(1.0), 0.45) * 1.05;
    col.rgb = mix(col.rgb, pc, clamp(pr, 0.0, 0.8));
  }
  col.rgb += u_flash * vec3(0.85, 0.88, 1.0) * (near ? 0.35 : 1.0);
  out_FragColor = col;
}`;

// cloud deck (stratus / stratocumulus layer) material: world-anchored fbm, holes for BKN, edge fade
const DECK_GLSL = `
// uniforms (u_off, u_cov, u_radius, u_below, u_light, u_alpha, u_tint) are declared by the fabric
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
czm_material czm_getMaterial(czm_materialInput mi) {
  czm_material m = czm_getDefaultMaterial(mi);
  vec2 lm = (mi.st - 0.5) * 2.0 * u_radius;            // metres from the deck centre
  vec2 p = (lm + u_off) / 3500.0;
  float n = fbm(p) * 0.75 + fbm(p * 6.0 + 3.0) * 0.25;
  float dens = n + (u_cov - 0.62) * 1.35;
  float a = smoothstep(0.32, 0.6, dens);
  float r = length(lm) / u_radius;
  a *= 1.0 - smoothstep(0.7, 1.0, r);
  float shade = u_below > 0.5 ? mix(0.62, 0.86, smoothstep(0.2, 0.9, 1.0 - dens + 0.4)) : mix(0.78, 1.0, smoothstep(0.3, 0.9, n));
  m.diffuse = u_tint * shade * u_light;
  m.alpha = a * u_alpha;
  return m;
}`;

// ------------------------------------------------------------------ the weather system
export class LiveWeather {
  constructor() {
    this.wx = null;          // active observation (live) or null for presets
    this.stations = [];      // [{wx}] departure (+ destination)
    this.fxParams = null;
    this.gustV = 0; this.gustT = 0; this.flash = 0; this.nextFlash = 0;
    this.decks = [];
  }

  // fetch departure (and a destination within ~60 NM); returns the departure observation or null
  async prepare(ap, destAp, onStatus = () => {}) {
    onStatus('Fetching live weather for ' + ap.i + '…');
    const list = [ap];
    if (destAp && destAp.i !== ap.i && distance(ap.la * D2R, ap.lo * D2R, destAp.la * D2R, destAp.lo * D2R) < 60 * NM) list.push(destAp);
    const res = await Promise.all(list.map((a) => getLiveWeather(a).catch(() => null)));
    this.stations = res.filter(Boolean);
    this.destAp = destAp && destAp.i !== ap.i ? destAp : null;
    this.destFetched = list.length > 1;
    this.wx = res[0] || this.stations[0] || null;
    return this.wx;
  }

  // flight-model spawn parameters: surface wind, turbulence, temperature deviation & pressure ratio
  spawnParams(fallback) {
    const wx = this.wx;
    if (!wx) return { windDir: fallback.windDir, windSpd: fallback.windSpd, turb: fallback.turb, dT: 0, pRatio: 1 };
    return { windDir: wx.wind.vrb ? 0 : wx.wind.dir, windSpd: wx.wind.spd, turb: this.baseTurb(wx), dT: tempAt(wx, wx.elevM), pRatio: (wx.qnh || 1013.25) / 1013.25 };
  }
  baseTurb(wx) {
    const g = wx.wind.gust ? wx.wind.gust - wx.wind.spd : 0;
    return clamp(0.12 + wx.wind.spd / 45 + g / 18 + (wx.ts ? 0.5 : 0) + (wx.cb ? 0.2 : 0), 0, 1.2);
  }

  // apply to the world (clouds, fog, light, effects). preset is the setup choice ('live' or a preset)
  apply(world, preset, geoid = 0) {
    this.world = world; this.geoid = geoid;
    const wx = preset === 'live' ? this.wx : null;
    this.clearDecks();
    if (!wx) {
      if (preset === 'live') { world.setWeather('scattered'); this.fxParams = this.presetFx('scattered'); }
      else { world.setWeather(preset); this.fxParams = this.presetFx(preset); }
      this.active = null;
    } else this.applyObs(wx);
    this.ensureStage();
    this.applyLight();
    this.ensureHud();
  }

  presetFx(p) {
    const t = { clear: [40000, 0, 0, 0], few: [35000, 0, 0, 0], scattered: [30000, 0.05, 0, 0], broken: [22000, 0.15, 0, 0], overcast: [12000, 0.45, 0, 0], storm: [5000, 0.6, 0.75, 1] }[p] || [30000, 0, 0, 0];
    return { visM: t[0], dark: t[1], rain: t[2], snow: 0, H: 1400, ts: !!t[3], ceilM: p === 'overcast' || p === 'storm' ? 900 : null, topM: null, deckCov: 0 };
  }

  applyObs(wx) {
    const world = this.world, base = wx.elevM + this.geoid;
    this.active = wx;
    // cumulus / fair-weather layers as Cesium clouds; stratiform BKN/OVC/VV as a continuous deck
    const layers = [], decks = [];
    for (const c of wx.clouds) {
      const okt = COVER_OKTAS[c.cover] || 0;
      const h = base + c.baseFt * FT;
      if (c.baseFt > 20000) continue; // cirrus: the sky atmosphere already looks high and hazy
      const convective = c.type === 'CB' || c.type === 'TCU';
      if (okt >= 6 && !convective) decks.push({ h, top: h + (c.cover === 'VV' ? 250 : clamp(300 + c.baseFt * FT * 0.35, 300, 1400)), cov: okt >= 8 ? 1 : 0.78 });
      const n = convective ? 26 : okt <= 2 ? 22 : okt <= 4 ? 48 : 34;
      layers.push({ n, base: h, top: h + (convective ? 4000 : okt >= 6 ? 600 : 1200), size: convective ? 2.8 : okt >= 6 ? 2.0 : 1.5, dark: okt >= 6 || convective || !!wx.precip });
    }
    const visM = Math.max(40, wx.visM);
    world.setCloudLayers(layers, Math.min(1.6 / visM, 9e-4));
    for (const d of decks) this.addDeck(d);
    const lowest = decks.length ? Math.min(...decks.map((d) => d.h)) : null;
    const fog = wx.obsc.find((o) => /FG|BR/.test(o));
    const H = wx.obsc.some((o) => /FG/.test(o)) ? 140 : fog ? 320 : wx.precip ? 900 : 1500;
    const dark = lowest != null ? (decks.some((d) => d.cov >= 1) ? 0.55 : 0.32) + (wx.precip ? 0.1 : 0) + (wx.ts ? 0.15 : 0) : (wx.precip ? 0.15 : 0);
    const pi = wx.precip ? wx.precip.intensity : 0;
    this.fxParams = {
      visM, H, dark: clamp(dark, 0, 0.8), ts: wx.ts, ceilM: lowest, topM: decks.length ? Math.max(...decks.map((d) => d.top)) : null,
      rain: wx.precip && wx.precip.type !== 'snow' ? (wx.precip.type === 'drizzle' ? 0.35 : 0.3 + 0.7 * pi) : wx.precip?.mixed ? 0.4 : 0,
      snow: wx.precip && (wx.precip.type === 'snow' || wx.precip.mixed) ? 0.35 + 0.65 * pi : 0,
    };
  }

  // ------------------------------------------------------------------ cloud decks
  addDeck(d) {
    const Cesium = C();
    const material = new Cesium.Material({ fabric: { type: 'OpenSkiesDeck' + Math.random().toString(36).slice(2, 7), uniforms: { u_off: new Cesium.Cartesian2(0, 0), u_cov: d.cov, u_radius: 60000, u_below: 1, u_light: 1, u_alpha: 1, u_tint: new Cesium.Cartesian3(1, 1, 1) }, source: DECK_GLSL }, translucent: true });
    this.decks.push({ ...d, prim: null, material, center: null, anchor: null, drift: [0, 0] });
  }
  // a curved 120 km grid built in world coordinates around (lat, lon) at height h (rebuilt when re-centred)
  buildDeck(d, latR, lonR, h) {
    const Cesium = C(), scene = this.world.viewer.scene;
    const R = 60000, N = 40, pos = new Float64Array((N + 1) * (N + 1) * 3), st = [], nor = [], idx = [];
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromRadians(lonR, latR, h));
    const v = new Cesium.Cartesian3(), w = new Cesium.Cartesian3();
    let k = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = (i / N - 0.5) * 2 * R, y = (j / N - 0.5) * 2 * R;
      v.x = x; v.y = y; v.z = -(x * x + y * y) / (2 * 6371000); // follow the Earth's curvature
      Cesium.Matrix4.multiplyByPoint(enu, v, w);
      pos[k++] = w.x; pos[k++] = w.y; pos[k++] = w.z; st.push(i / N, j / N);
      const n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(w, new Cesium.Cartesian3()); nor.push(n.x, n.y, n.z);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, e = c + 1; idx.push(a, b, e, a, e, c); }
    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nor) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      },
      indices: new Uint16Array(idx), primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(pos),
    });
    const prim = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.MaterialAppearance({ material: d.material, flat: true, translucent: true, closed: false, faceForward: false,
        renderState: { cull: { enabled: false }, depthTest: { enabled: true }, depthMask: false, blending: Cesium.BlendingState.ALPHA_BLEND } }),
      asynchronous: false, compressVertices: false,
    });
    if (d.prim) scene.primitives.remove(d.prim);
    d.prim = scene.primitives.add(prim);
  }
  clearDecks() {
    const scene = this.world?.viewer?.scene;
    for (const d of this.decks) if (d.prim) scene?.primitives.remove(d.prim);
    this.decks = [];
  }
  updateDecks(latR, lonR, camH, dt, windNE) {
    const Cesium = C();
    const k = this.world.sunK ?? 1;
    for (const d of this.decks) {
      if (!d.anchor) d.anchor = { lat: latR, lon: lonR };
      d.drift[0] += windNE[1] * dt; d.drift[1] += windNE[0] * dt; // clouds move with the wind
      const below = camH < (d.h + d.top) / 2;
      if (!d.center || distance(d.center.lat, d.center.lon, latR, lonR) > 8000 || d.center.below !== below) {
        d.center = { lat: latR, lon: lonR, below };
        this.buildDeck(d, latR, lonR, below ? d.h : d.top);
      }
      const e = (d.center.lon - d.anchor.lon) * 6378137 * Math.cos(latR), n = (d.center.lat - d.anchor.lat) * 6378137;
      const u = d.material.uniforms;
      u.u_off = new Cesium.Cartesian2(e - d.drift[0], n - d.drift[1]);
      u.u_below = below ? 1 : 0;
      u.u_light = (below ? 0.85 + 0.15 * (1 - d.cov) : 1.0) * (0.06 + 0.94 * k);
      u.u_tint = below ? new Cesium.Cartesian3(0.93, 0.95, 0.98) : new Cesium.Cartesian3(1.0, 0.99, 0.97);
    }
  }

  // ------------------------------------------------------------------ post-process
  ensureStage() {
    const Cesium = C(), scene = this.world.viewer.scene;
    if (this.stage) return;
    const u = this.u = { u_time: 0, u_sigma: 0, u_H: 1500, u_h0: 0, u_dark: 0, u_rain: 0, u_snow: 0, u_cockpit: 0, u_speed: 0, u_flash: 0, u_drops: 0, u_inCloud: 0,
      u_fogColor: new Cesium.Cartesian3(0.7, 0.74, 0.78), u_upEC: new Cesium.Cartesian3(0, 1, 0), u_flow: new Cesium.Cartesian2(0, 0) };
    const uniforms = {};
    for (const k of Object.keys(u)) uniforms[k] = () => this.u[k];
    try {
      this.stage = scene.postProcessStages.add(new Cesium.PostProcessStage({ name: 'openskies_weather', fragmentShader: FX_GLSL, uniforms }));
    } catch (e) { console.warn('weather effects unavailable', e); this.stage = null; }
  }
  applyLight() {
    const scene = this.world.viewer.scene, p = this.fxParams || {};
    if (this._sunIntensity == null && scene.light) this._sunIntensity = scene.light.intensity;
    if (scene.light && this._sunIntensity != null) scene.light.intensity = this._sunIntensity * (1 - (p.dark || 0) * 0.35);
    if (scene.skyAtmosphere) { scene.skyAtmosphere.saturationShift = -(p.dark || 0) * 0.6; scene.skyAtmosphere.brightnessShift = -(p.dark || 0) * 0.25; }
  }

  // ------------------------------------------------------------------ per frame
  update(fm, dt, ctx = {}) {
    const world = this.world; if (!world || !this.fxParams) return;
    const Cesium = C(), scene = world.viewer.scene, cam = scene.camera;
    const camC = cam.positionCartographic;
    const p = this.fxParams;
    // blend departure / destination observations by distance
    if (this.active && this.stations.length) this.pickStation(fm, ctx);
    const wx = this.active;
    this.t = (this.t || 0) + dt;
    // ----- flight model: wind with height, gusts, temperature & pressure
    if (wx && fm) {
      const hMsl = fm.h - fm.geoid, agl = Math.max(0, fm.agl ?? fm.out.agl * FT);
      const w = windAt(wx, hMsl, agl, fm.lat);
      // gusts: random gust events near the surface, fading with height
      if (wx.wind.gust > wx.wind.spd) {
        this.gustT -= dt;
        if (this.gustT <= 0) { this.gustT = 3 + Math.random() * 9; this.gustTarget = (wx.wind.gust - wx.wind.spd) * (0.4 + Math.random() * 0.6); }
        this.gustV += ((this.gustTarget || 0) - this.gustV) * Math.min(1, dt * 1.2);
        this.gustTarget = (this.gustTarget || 0) * Math.exp(-dt * 0.5);
      } else this.gustV = 0;
      const gk = clamp(1 - agl / 1500, 0.2, 1);
      const spd = w.spd + this.gustV * gk;
      const tw = windVec(w.dir, spd);
      fm.wind = fm.wind ? fm.wind.map((v, i) => v + (tw[i] - v) * Math.min(1, dt * 1.5)) : tw;
      const inCloudTurb = p.ceilM != null && hMsl + fm.geoid > p.ceilM && hMsl + fm.geoid < (p.topM || p.ceilM) ? 0.25 : 0;
      fm.turb = clamp(this.baseTurb(wx) * (agl < 1500 ? 1 : 0.55) + inCloudTurb, 0, 1.4);
      fm.dT = tempAt(wx, hMsl);
      fm.pRatio = (wx.qnh || 1013.25) / 1013.25;
    }
    this.updateHud(fm);
    // ----- clouds
    const windNE = fm ? [fm.wind[0], fm.wind[1]] : [0, 0];
    if (this.decks.length && camC) this.updateDecks(camC.latitude, camC.longitude, camC.height, dt, windNE);
    if (!this.stage) return;
    // ----- post-process uniforms
    const u = this.u;
    const k = world.sunK ?? 1;
    const camH = camC ? camC.height : 0;
    const groundRef = (wx ? wx.elevM : 0) + (this.geoid || 0);
    const below = p.ceilM == null || camH < p.ceilM;
    const inCloud = p.ceilM != null && camH > p.ceilM - 30 && camH < (p.topM || p.ceilM) + 30 ? 1 : 0;
    u.u_inCloud += (inCloud - u.u_inCloud) * Math.min(1, dt * 2);
    u.u_time = this.t;
    u.u_sigma = 3.0 / p.visM * (p.visM > 15000 ? 0.6 : 1);
    u.u_H = p.H; u.u_h0 = camH - groundRef;
    const darkT = below ? p.dark : p.dark * 0.1;
    u.u_dark += (darkT - u.u_dark) * Math.min(1, dt * 1.5);
    // precipitation falls below the cloud base only
    const pk = below ? 1 : 0;
    const view = ctx.view || 'chase';
    const cockpit = view === 'cockpit' ? 1 : 0;
    u.u_cockpit = cockpit;
    u.u_rain = (p.rain || 0) * pk * (cockpit ? 0.45 : 1);
    u.u_snow = (p.snow || 0) * pk;
    const gs = fm ? fm.out.tas : 0;
    u.u_speed = clamp(gs / 160, 0, 1);
    u.u_drops = cockpit ? clamp(((p.rain || 0) + (p.snow || 0) * 0.5) * pk * 1.1 + u.u_inCloud * 0.5, 0, 0.9) : 0;
    u.u_flow = new Cesium.Cartesian2(fm ? clamp(-(fm.out.roll || 0) / 90, -0.5, 0.5) : 0, 0);
    // fog colour: overcast grey / clear haze blue-grey, scaled by daylight
    const dk = 0.04 + 0.96 * k;
    const g = below ? lerp(0.78, 0.6, p.dark / 0.8) : 0.82;
    u.u_fogColor = new Cesium.Cartesian3(g * 0.96 * dk + 0.012, g * 0.99 * dk + 0.016, g * 1.04 * dk + 0.025);
    // eye-space "up" at the camera
    const upW = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(cam.positionWC, new Cesium.Cartesian3());
    const upE = Cesium.Matrix4.multiplyByPointAsVector(cam.viewMatrix, upW, new Cesium.Cartesian3());
    u.u_upEC = Cesium.Cartesian3.normalize(upE, upE);
    // lightning
    if (p.ts && below) {
      if (this.t > this.nextFlash) { this.nextFlash = this.t + 4 + Math.random() * 14; this.flashT = this.t; }
      const ft = this.t - (this.flashT ?? -9);
      u.u_flash = ft < 0.5 ? (ft < 0.07 ? 0.55 : ft > 0.12 && ft < 0.2 ? 0.35 : 0) * (0.4 + 0.6 * (1 - k * 0.6)) : 0;
    } else u.u_flash = 0;
    const need = u.u_sigma > 1e-5 || u.u_dark > 0.01 || u.u_rain > 0 || u.u_snow > 0 || u.u_inCloud > 0.01;
    this.stage.enabled = need;
    scene.sun.show = !(below && p.dark > 0.4) && u.u_inCloud < 0.5;
  }

  pickStation(fm, ctx) {
    // fetch the destination's weather when it comes within ~60 NM
    const dap = ctx.destAp || this.destAp;
    if (dap && dap !== this._fetchedFor && fm && !this._fetching) {
      const dd = distance(fm.lat, fm.lon, dap.la * D2R, dap.lo * D2R);
      if (dd < 60 * NM && !this.stations.some((s) => s.icao === dap.i)) {
        this._fetching = true;
        getLiveWeather(dap).then((w) => { if (w) this.stations.push(w); }).catch(() => {}).finally(() => { this._fetching = false; this._fetchedFor = dap; });
      }
    }
    if (this.stations.length < 2 || !fm) return;
    let best = null, bd = 1e12;
    for (const s of this.stations) { const d = distance(fm.lat, fm.lon, s.lat * D2R, s.lon * D2R); if (d < bd) { bd = d; best = s; } }
    if (best && best !== this.active && (this._switchT || 0) < (this.t || 0)) {
      this._switchT = (this.t || 0) + 60;
      this.clearDecks(); this.applyObs(best); this.applyLight();
    }
  }

  // ------------------------------------------------------------------ HUD readout
  ensureHud() {
    let el = document.getElementById('wxHud');
    const ui = document.getElementById('flightUI');
    if (!ui) return;
    if (!el) {
      el = document.createElement('div'); el.id = 'wxHud'; el.title = 'Live weather — click to expand';
      el.addEventListener('click', () => el.classList.toggle('open'));
      ui.appendChild(el);
    }
    this.hud = el; this._hudFor = null;
    el.classList.toggle('hidden', !this.active);
  }
  updateHud(fm) {
    const el = this.hud, wx = this.active; if (!el || !wx) return;
    const now = this.t || 0;
    if (this._hudFor === wx && now - (this._hudT || 0) < 1) return;
    this._hudFor = wx; this._hudT = now;
    const o = fm?.out;
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    el.innerHTML = `<div class="wx-row"><b>${esc(wx.icao || wx.station)}</b><span class="wx-cat ${flightCat(wx)}">${flightCat(wx)}</span>${o ? `<span>Wind ${String(Math.round(o.windDir)).padStart(3, '0')}°/${Math.round(o.windSpd)} kt · OAT ${Math.round(o.oat)}°C</span>` : ''}</div>`
      + `<div class="wx-raw">${esc(wx.raw)}</div><div class="wx-dec">${esc(describe(wx))}<br><span class="muted">${esc(wx.source || '')}${wx.stale ? ' · cached (offline)' : ''}</span></div>`;
  }

  stop() {
    if (this.stage) this.stage.enabled = false;
    this.clearDecks();
    const scene = this.world?.viewer?.scene;
    if (scene) { scene.sun.show = true; if (scene.light && this._sunIntensity != null) scene.light.intensity = this._sunIntensity; if (scene.skyAtmosphere) { scene.skyAtmosphere.saturationShift = 0; scene.skyAtmosphere.brightnessShift = 0; } }
    this.fxParams = null; this.active = null;
    if (this.hud) this.hud.classList.add('hidden');
  }
}

export function flightCat(wx) {
  const ceil = Math.min(1e9, ...wx.clouds.filter((c) => (COVER_OKTAS[c.cover] || 0) >= 6).map((c) => c.baseFt));
  const sm = wx.visM / 1609.34;
  return ceil < 500 || sm < 1 ? 'LIFR' : ceil < 1000 || sm < 3 ? 'IFR' : ceil <= 3000 || sm <= 5 ? 'MVFR' : 'VFR';
}
