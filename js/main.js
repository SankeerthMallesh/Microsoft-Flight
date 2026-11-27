// OpenSkies Flight Simulator — application controller.
import { FACTS, GENERAL_FACTS } from './data/facts.js';
import { music } from './music.js';
import { brandSVG } from './brands.js';
import { AIRCRAFT, MAKERS, getAircraft, deriveAero } from './data/aircraft.js';
import { LIVERIES, liveriesFor, getLivery } from './data/liveries.js';
import { loadAirports, searchAirports, getAirport, runwayEnds, airportsNear, allAirports } from './data/airports.js';
import { MiniMap, gcPoints } from './minimap.js';
import { getAircraftGLB } from './model/factory.js';
import { World } from './world.js';
import { Traffic } from './traffic.js';
import { FlightModel } from './sim/flightmodel.js';
import { Autopilot } from './sim/autopilot.js';
import { Input, KEY_HELP } from './input.js';
import { Audio } from './audio.js';
import { drawPFD, drawND, drawEICAS } from './cockpit/instruments.js';
import { panelStyleFor, drawAirbusPFD, drawECAM, drawSixPack, drawEngineStrip } from './cockpit/panels.js';
import { D2R, R2D, KT, FT, NM, G0, clamp, isa, destination, eulerToQuat, wrap360, wrap180, distance, bearing } from './sim/math.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('openskies.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('openskies.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ------------------------------------------------------------------ state
const settings = Object.assign({ ionToken: '', scenery: 'photoreal', quality: 'medium', shadows: false, assist: 'assisted', invertPitch: false, volume: 0.7, music: true }, store.get('settings', {}));
// cinematic menu music: browsers only allow audio after a user gesture, so start on the first click/key
music.enabled = settings.music !== false; music.volume = settings.volume ?? 0.7;
const startMusicOnGesture = () => { if (!app.flying) music.play(); window.removeEventListener('pointerdown', startMusicOnGesture); window.removeEventListener('keydown', startMusicOnGesture); };
window.addEventListener('pointerdown', startMusicOnGesture); window.addEventListener('keydown', startMusicOnGesture);
// A token in config.js (written by the setup script) is used when none was saved in Settings.
const fileToken = (window.OPENSKIES_CONFIG && String(window.OPENSKIES_CONFIG.ionToken || '').trim()) || '';
if (fileToken && !settings.ionToken) settings.ionToken = fileToken;
const plan = Object.assign({ acId: 'b737-800', liveryId: 'southwest', airport: 'KDAL', runway: null, start: 'runway', hour: 11, weather: 'scattered', windDir: 270, windSpd: 8, turb: 0.3, fuel: 40, payload: 60, dest: null, destRwy: '' }, store.get('plan', {}));
const app = { screen: 'menu', history: [], world: null, hangar: null, fm: null, ap: null, rwy: null, paused: false, flying: false, view: 'chase', panel: true, ndRange: 20, nearby: [], lastNear: 0 };
const input = new Input();
const audio = new Audio();
input.invertPitch = settings.invertPitch;
audio.setVolume(settings.volume);

// ------------------------------------------------------------------ screens
const SCREENS = ['menu', 'setup', 'hangar', 'settings', 'help', 'pause', 'crash'];
function show(name, push = true) {
  if (name === 'back') { name = app.history.pop() || 'menu'; push = false; }
  if (push && app.screen && app.screen !== name) app.history.push(app.screen);
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  app.screen = name;
  if (name === 'hangar') openHangar(); else if (app.hangar) app.hangar.stop();
  if (name === 'setup') refreshSetup();
  if (name === 'settings') loadSettingsForm();
  if (name === 'menu') refreshMenu();
  $('cesium').style.visibility = name === 'hangar' ? 'hidden' : 'visible';
}
// main menu: picture tiles + "ready to fly" summary of the current plan
function refreshMenu() {
  try {
    const ac = getAircraft(plan.acId), lv = getLivery(plan.liveryId), ap = getAirport(plan.airport);
    $('tileFlyBg').style.backgroundImage = `url("images/aircraft/${plan.acId}.jpg")`;
    const alt = ['a380-800', 'b747-8i', 'b787-9', 'a350-900', 'b777-300er'].find((id) => id !== plan.acId);
    $('tileHangarBg').style.backgroundImage = `url("images/aircraft/${alt}.jpg")`;
    $('menuReady').innerHTML = `<span>Ready to fly</span><b>${ac.maker} ${ac.name}</b> · ${lv.name}<br>${ap ? ap.i + ' · ' + ap.n : ''}`;
  } catch (e) { /* data not loaded yet */ }
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); show(go.dataset.go); }
});
function hideAllScreens() { for (const s of SCREENS) $(s).classList.add('hidden'); app.screen = null; }

function toast(text, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, 3200);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
// rotating "Did you know?" facts: the selected aircraft first, then others in the game
let factTimer = null, factQueue = [];
function nextFact() {
  if (!factQueue.length) {
    const ids = Object.keys(FACTS).filter((id) => id !== plan.acId).sort(() => Math.random() - 0.5);
    factQueue = ids.map((id) => ['ac', id]).slice(0, 10);
    factQueue.splice(3, 0, ['gen', GENERAL_FACTS[Math.floor(Math.random() * GENERAL_FACTS.length)]]);
  }
  const [kind, v] = factQueue.shift();
  let title, text;
  if (kind === 'ac') { const a = getAircraft(v); title = a ? `${a.maker} ${a.name}` : v; text = FACTS[v]; } else { title = 'Flying tip'; text = v; }
  const card = $('factCard');
  card.classList.add('fade');
  const img = kind === 'ac' ? `images/aircraft/${v}.jpg` : (FACTS[plan.acId] ? `images/aircraft/${plan.acId}.jpg` : '');
  const apply = () => {
    $('factTitle').textContent = title; $('factText').textContent = text; card.classList.remove('fade');
    if (img && img !== factBgImg) {
      // crossfade between two full-screen layers
      factBgImg = img; factBgFlip = !factBgFlip;
      const show = $(factBgFlip ? 'ldBgA' : 'ldBgB'), hide = $(factBgFlip ? 'ldBgB' : 'ldBgA');
      show.style.backgroundImage = `url("${img}")`;
      show.classList.remove('show'); void show.offsetWidth; show.classList.add('show'); hide.classList.remove('show');
    }
  };
  // preload the picture so the swap is clean
  if (img) { const pre = new Image(); pre.onload = pre.onerror = () => setTimeout(apply, factTimer ? 600 : 0); pre.src = img; } else setTimeout(apply, factTimer ? 600 : 0);
}
let factBgImg = null, factBgFlip = false;
function startFacts() {
  if (factTimer) return;
  factQueue = FACTS[plan.acId] ? [['ac', plan.acId]] : [];
  $('factCard').classList.remove('off');
  $('loading').classList.add('cinematic');
  const ac = getAircraft(plan.acId), lv = getLivery(plan.liveryId), ap = getAirport(plan.airport);
  $('ldFlight').innerHTML = `<b>${ac.maker} ${ac.name}</b> · ${lv.name}<br>${ap ? ap.i + ' · ' + ap.n : ''}${plan.dest ? ' → ' + plan.dest : ''}`;
  nextFact(); factTimer = setInterval(nextFact, 9000);
}
function stopFacts() {
  clearInterval(factTimer); factTimer = null; $('factCard').classList.add('off'); $('loading').classList.remove('cinematic');
  for (const id of ['ldBgA', 'ldBgB']) $(id).classList.remove('show'); factBgImg = null;
}
function loading(on, text, frac) {
  $('loading').classList.toggle('hidden', !on);
  if (on && app.screen !== 'menu' && !$('loading').dataset.boot) startFacts(); else if (!on) stopFacts();
  if (text) $('loadingText').textContent = text;
  if (frac != null) $('loadingBar').style.width = Math.round(frac * 100) + '%';
}

// ------------------------------------------------------------------ help table
$('helpTable').innerHTML = KEY_HELP.map(([a, k]) => `<tr><td>${a}</td><td>${k}</td></tr>`).join('');

// ------------------------------------------------------------------ settings form
function updateTokenStatus() {
  const entered = $('tokenInput').value.trim();
  const saved = String(settings.ionToken || '').trim();
  const changed = entered !== saved;
  const state = $('tokenState');
  const help = $('tokenHelp');
  state.classList.remove('is-ready', 'is-pending');
  if (!entered && changed) {
    state.textContent = 'Removal pending';
    state.classList.add('is-pending');
    help.textContent = 'The saved token will be removed when you choose Save & reload.';
  } else if (!entered) {
    state.textContent = 'No token saved';
    help.innerHTML = 'A token is needed for photorealistic cities and streamed terrain. It stays in this browser, not in the game files. <a href="https://ion.cesium.com/tokens" target="_blank" rel="noopener">Get a free token</a>.';
  } else if (changed) {
    state.textContent = 'Unsaved token';
    state.classList.add('is-pending');
    help.textContent = 'Token entered. Select your scenery and choose Save & reload to store it in this browser.';
  } else {
    state.textContent = 'Token configured';
    state.classList.add('is-ready');
    help.textContent = 'A token is configured. Cesium checks its permissions when the selected 3D scenery loads.';
  }
}
function loadSettingsForm() {
  $('tokenInput').value = settings.ionToken;
  $('tokenInput').type = 'password';
  $('toggleToken').textContent = 'Show';
  $('toggleToken').setAttribute('aria-pressed', 'false');
  $('scenerySel').value = settings.scenery; $('qualitySel').value = settings.quality;
  $('shadowsChk').checked = settings.shadows; $('assistSel').value = settings.assist; $('invertChk').checked = settings.invertPitch; $('volSel').value = settings.volume;
  $('musicChk').checked = settings.music !== false;
  updateTokenStatus();
  $('trafficChk').checked = settings.traffic !== false; $('trafficLblChk').checked = settings.trafficLabels !== false;
}
$('tokenInput').addEventListener('input', updateTokenStatus);
$('toggleToken').addEventListener('click', () => {
  const reveal = $('tokenInput').type === 'password';
  $('tokenInput').type = reveal ? 'text' : 'password';
  $('toggleToken').textContent = reveal ? 'Hide' : 'Show';
  $('toggleToken').setAttribute('aria-pressed', String(reveal));
  $('tokenInput').focus();
});
$('clearToken').addEventListener('click', () => {
  $('tokenInput').value = '';
  updateTokenStatus();
  $('tokenInput').focus();
});
$('saveSettings').onclick = () => {
  settings.ionToken = $('tokenInput').value.trim(); settings.scenery = $('scenerySel').value; settings.quality = $('qualitySel').value;
  settings.shadows = $('shadowsChk').checked; settings.assist = $('assistSel').value; settings.invertPitch = $('invertChk').checked; settings.volume = +$('volSel').value; settings.music = $('musicChk').checked;
  settings.traffic = $('trafficChk').checked; settings.trafficLabels = $('trafficLblChk').checked;
  store.set('settings', settings); location.reload();
};

// ------------------------------------------------------------------ livery chips
function chipsHTML(lv) {
  const cols = [lv.base || '#fff', lv.belly, lv.finBase || lv.base, lv.engine].filter(Boolean);
  return cols.map((c) => `<i style="background:${c}"></i>`).join('');
}

// ------------------------------------------------------------------ setup screen
let airportResults = [];
function refreshSetup() {
  const ac = getAircraft(plan.acId), lv = getLivery(plan.liveryId);
  $('acName').textContent = `${ac.maker} ${ac.name}`;
  $('liveryName').textContent = `${lv.name} — ${lv.subtitle || ''}`;
  $('liveryChips').innerHTML = brandSVG(lv);
  const ap = getAirport(plan.airport);
  if (ap) {
    $('airportPicked').textContent = `${ap.i}${ap.a ? ' / ' + ap.a : ''} — ${ap.n}, ${ap.c} (${ap.k}) · elev ${ap.e} ft`;
    const ends = runwayEnds(ap).sort((a, b) => b.length - a.length);
    $('runwaySel').innerHTML = ends.map((r) => `<option value="${r.ident}">RWY ${r.ident} — ${Math.round(r.lengthFt).toLocaleString()} ft, hdg ${String(Math.round(wrap360(r.heading * R2D))).padStart(3, '0')}°</option>`).join('');
    if (plan.runway && ends.some((r) => r.ident === plan.runway)) $('runwaySel').value = plan.runway; else plan.runway = ends[0]?.ident;
  }
  const dap = plan.dest ? getAirport(plan.dest) : null;
  if (dap) {
    const from = getAirport(plan.airport);
    const nm = from ? distance(from.la * D2R, from.lo * D2R, dap.la * D2R, dap.lo * D2R) / NM : 0;
    $('destPicked').innerHTML = `${dap.i} — ${dap.n}, ${dap.c} · ${Math.round(nm).toLocaleString()} NM <a href="#" id="destClear">clear</a>`;
    $('destClear').onclick = (e) => { e.preventDefault(); plan.dest = null; plan.destRwy = ''; store.set('plan', plan); refreshSetup(); };
    $('destRwySel').innerHTML = '<option value="">Best for wind</option>' + runwayEnds(dap).map((r) => `<option value="${r.ident}">RWY ${r.ident} — ${Math.round(r.lengthFt).toLocaleString()} ft</option>`).join('');
    $('destRwySel').value = plan.destRwy || '';
  } else { $('destPicked').textContent = 'No destination — free flight. You can also pick one in flight from the map (M).'; $('destRwySel').innerHTML = '<option value="">—</option>'; }
  $('startSel').value = plan.start; $('timeSel').value = plan.hour; $('wxSel').value = plan.weather;
  $('windDir').value = plan.windDir; $('windSpd').value = plan.windSpd; $('turbSel').value = String(plan.turb);
  $('fuelSel').value = plan.fuel; $('payloadSel').value = plan.payload;
  updateSetupLabels();
}
function updateSetupLabels() {
  const h = +$('timeSel').value; const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  $('timeLbl').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local`;
  const ac = getAircraft(plan.acId);
  const fuel = ac.fuel * (+$('fuelSel').value / 100);
  const payloadMax = Math.max(0, ac.mtow - ac.oew - ac.fuel * 0.3);
  const payload = payloadMax * (+$('payloadSel').value / 100) * 0.55;
  $('fuelLbl').textContent = `${Math.round(fuel).toLocaleString()} kg`;
  $('payloadLbl').textContent = `${Math.round(payload).toLocaleString()} kg`;
  const gw = ac.oew + fuel + payload;
  $('weightInfo').innerHTML = `Gross weight <b>${(gw / 1000).toFixed(1)} t</b> / MTOW ${(ac.mtow / 1000).toFixed(1)} t` + (gw > ac.mtow ? ' <span style="color:var(--bad)">OVERWEIGHT</span>' : '');
  $('windLbl').textContent = '';
}
for (const id of ['timeSel', 'fuelSel', 'payloadSel']) $(id).addEventListener('input', updateSetupLabels);
const savePlanFromForm = () => {
  plan.runway = $('runwaySel').value; plan.start = $('startSel').value; plan.hour = +$('timeSel').value; plan.weather = $('wxSel').value;
  plan.windDir = +$('windDir').value || 0; plan.windSpd = +$('windSpd').value || 0; plan.turb = +$('turbSel').value; plan.fuel = +$('fuelSel').value; plan.payload = +$('payloadSel').value;
  store.set('plan', plan);
};
['runwaySel', 'startSel', 'wxSel', 'windDir', 'windSpd', 'turbSel', 'fuelSel', 'payloadSel', 'timeSel'].forEach((id) => $(id).addEventListener('change', savePlanFromForm));
let resIdx = -1;
$('airportSearch').addEventListener('input', () => {
  airportResults = searchAirports($('airportSearch').value);
  resIdx = -1; renderResults();
});
$('airportSearch').addEventListener('focus', () => { airportResults = searchAirports($('airportSearch').value); renderResults(); });
$('airportSearch').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { resIdx = Math.min(airportResults.length - 1, resIdx + 1); renderResults(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { resIdx = Math.max(0, resIdx - 1); renderResults(); e.preventDefault(); }
  if (e.key === 'Enter' && airportResults.length) pickAirport(airportResults[Math.max(0, resIdx)]);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('airportResults').classList.add('hidden'); });
function renderResults() {
  const ul = $('airportResults');
  ul.innerHTML = airportResults.map((a, i) => `<li data-i="${i}" class="${i === resIdx ? 'active' : ''}"><b>${a.i}</b><span>${a.n}<br><small class="muted">${a.c}, ${a.k}${a.a ? ' · ' + a.a : ''}</small></span></li>`).join('');
  ul.classList.toggle('hidden', !airportResults.length);
  ul.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', (e) => { e.preventDefault(); pickAirport(airportResults[+li.dataset.i]); }));
}
function pickAirport(a) {
  plan.airport = a.i; plan.runway = null; $('airportSearch').value = ''; $('airportResults').classList.add('hidden');
  store.set('plan', plan); refreshSetup();
  if (app.world && !app.flying) app.world.menuOrbit(a.la, a.lo);
}
$('flyBtn').onclick = () => { savePlanFromForm(); startFlight(); };
let destResults = [];
$('destSearch').addEventListener('input', () => {
  destResults = searchAirports($('destSearch').value, 10);
  const ul = $('destResults');
  ul.innerHTML = destResults.map((a, i) => `<li data-i="${i}"><b>${a.i}</b><span>${a.n}<br><small class="muted">${a.c}, ${a.k}${a.a ? ' · ' + a.a : ''}</small></span></li>`).join('');
  ul.classList.toggle('hidden', !destResults.length);
  ul.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', (e) => { e.preventDefault(); const a = destResults[+li.dataset.i]; $('destSearch').value = ''; ul.classList.add('hidden'); plan.dest = a.i; plan.destRwy = ''; store.set('plan', plan); refreshSetup(); }));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('destResults').classList.add('hidden'); });
$('destRwySel').addEventListener('change', () => { plan.destRwy = $('destRwySel').value; store.set('plan', plan); });

// ------------------------------------------------------------------ hangar
let hangarSel = { acId: plan.acId, liveryId: plan.liveryId };
async function openHangar() {
  if (!app.hangar) {
    try {
      const { Hangar } = await import('./hangar.js');
      app.hangar = new Hangar($('hangarCanvas'));
    } catch (e) { console.error(e); toast('Hangar 3D view failed to load: ' + e.message, 'bad'); }
  }
  hangarSel = { acId: plan.acId, liveryId: plan.liveryId };
  renderAcList(); selectHangarAc(hangarSel.acId, hangarSel.liveryId);
  app.hangar?.start();
}
function renderAcList() {
  const f = $('acFilter').value.trim().toLowerCase();
  const html = MAKERS.map((m) => {
    const items = AIRCRAFT.filter((a) => a.maker === m && (!f || (a.maker + ' ' + a.name + ' ' + a.category).toLowerCase().includes(f)));
    if (!items.length) return '';
    return `<div class="ac-group"><h4>${m}</h4>${items.map((a) => `<div class="ac-item ${a.id === hangarSel.acId ? 'active' : ''}" data-ac="${a.id}"><span>${a.name}</span><small>${a.category}</small></div>`).join('')}</div>`;
  }).join('');
  $('acList').innerHTML = html;
  $('acList').querySelectorAll('.ac-item').forEach((el) => el.addEventListener('click', () => selectHangarAc(el.dataset.ac)));
}
$('acFilter').addEventListener('input', renderAcList);
$('allLiveries').addEventListener('change', () => renderLiveries());
function selectHangarAc(acId, liveryId) {
  const ac = getAircraft(acId);
  const lvs = liveriesFor(acId);
  if (!liveryId || !(lvs.some((l) => l.id === liveryId) || $('allLiveries').checked)) liveryId = (lvs.find((l) => l.id !== 'plain-white') || lvs[0]).id;
  hangarSel = { acId, liveryId };
  document.querySelectorAll('.ac-item').forEach((el) => el.classList.toggle('active', el.dataset.ac === acId));
  $('hMaker').textContent = ac.maker; $('hName').textContent = ac.name; $('hCat').textContent = ac.category + (ac.fbw ? ' · Fly-by-wire' : '');
  const e = ac.engines, p = ac.perf;
  const rows = [
    ['Length', `${ac.length.toFixed(2)} m`], ['Wingspan', `${ac.span.toFixed(2)} m`], ['Height', `${ac.height.toFixed(2)} m`], ['Wing area', `${ac.wingArea} m²`],
    ['Max take-off weight', `${(ac.mtow / 1000).toFixed(1)} t`], ['Empty weight', `${(ac.oew / 1000).toFixed(1)} t`], ['Fuel capacity', `${(ac.fuel / 1000).toFixed(1)} t`],
    ['Engines', `${e.count} × ${e.name}`], [e.thrust ? 'Thrust (each)' : 'Power (each)', e.thrust ? `${e.thrust} kN` : `${e.power} kW (${Math.round(e.power * 1.341)} shp)`],
    ['Cruise', p.cruiseMach ? `Mach ${p.cruiseMach}` : `${p.cruiseKtas} KTAS`], ['Max operating', p.cruiseMach ? `${p.vmo} KIAS / M${p.mmo}` : `${p.vmo} KIAS`],
    ['Range', `${p.range.toLocaleString()} km (${Math.round(p.range / 1.852).toLocaleString()} nm)`], ['Service ceiling', `${p.ceiling.toLocaleString()} ft`], ['Seats', p.seats],
  ];
  $('hSpecs').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  renderLiveries();
  showHangarModel();
}
function renderLiveries() {
  const acId = hangarSel.acId;
  const list = $('allLiveries').checked ? LIVERIES : liveriesFor(acId);
  $('hLiveries').innerHTML = list.map((l) => `<div class="livery ${l.id === hangarSel.liveryId ? 'active' : ''}" data-lv="${l.id}">${brandSVG(l)}<div><b>${l.name}</b><small>${l.subtitle || ''}${l.fleet !== '*' && !l.fleet.includes(acId) ? ' · not in real fleet' : ''}</small></div></div>`).join('');
  $('hLiveries').querySelectorAll('.livery').forEach((el) => el.addEventListener('click', () => { hangarSel.liveryId = el.dataset.lv; renderLiveries(); showHangarModel(); }));
}
async function showHangarModel() {
  if (!app.hangar) return;
  $('hangarLoading').classList.remove('hidden');
  try { await app.hangar.show(hangarSel.acId, hangarSel.liveryId); } catch (e) { console.error(e); toast('Could not build model: ' + e.message, 'bad'); }
  $('hangarLoading').classList.add('hidden');
}
$('hSelect').onclick = () => {
  plan.acId = hangarSel.acId; plan.liveryId = hangarSel.liveryId; store.set('plan', plan);
  toast(`${getAircraft(plan.acId).name} · ${getLivery(plan.liveryId).name} selected`, 'good');
  show('setup');
};

// ------------------------------------------------------------------ destination / route
function bestRunwayFor(ap, ident) {
  const ends = runwayEnds(ap);
  if (ident) { const e = ends.find((r) => r.ident === ident); if (e) return e; }
  const maxLen = Math.max(...ends.map((r) => r.length));
  const cands = ends.filter((r) => r.length >= maxLen * 0.75);
  return cands.sort((a, b) => Math.abs(wrap180(a.heading * R2D - plan.windDir)) - Math.abs(wrap180(b.heading * R2D - plan.windDir)))[0] || ends[0];
}
function buildRoute(ap, ident, isGA) {
  const rwy = bestRunwayFor(ap, ident);
  const fafDist = (isGA ? 5 : 10) * NM;
  const [fla, flo] = destination(rwy.lat, rwy.lon, rwy.heading + Math.PI, fafDist);
  const [ila, ilo] = destination(rwy.lat, rwy.lon, rwy.heading + Math.PI, fafDist + 8 * NM);
  return { ap, rwy, fafDist, faf: { lat: fla, lon: flo }, ifix: { lat: ila, lon: ilo } };
}
function setDestination(ap, ident, quiet) {
  if (!ap) return;
  plan.dest = ap.i; plan.destRwy = ident || ''; store.set('plan', plan);
  const ac = getAircraft(plan.acId);
  const route = buildRoute(ap, ident, ac.category === 'General aviation');
  app.dest = route; app.destAirport = ap; app.destLights = false; app.routeCache = null;
  if (app.ap && app.flying) app.ap.setRoute(route);
  app.map?.setDest(ap);
  if (app.fm && app.flying) {
    const d = distance(app.fm.lat, app.fm.lon, route.rwy.lat, route.rwy.lon) / NM;
    if (!quiet) toast(`Destination ${ap.i} RWY ${route.rwy.ident} · ${Math.round(d)} NM` + (app.ap.lat === 'NAV' ? ' — rerouting' : ' — press LNAV + VNAV to let the autopilot fly there'), 'good');
  } else if (!quiet) refreshSetup();
}
function routePoints(fm) {
  const r = app.dest; if (!r) return null;
  const pts = [];
  const nav = app.ap?.navInfo();
  if (r.ifix && !r.ifDone && !(nav && nav.pastFaf)) pts.push({ ...r.ifix, name: 'IF' });
  if (!(nav && nav.pastFaf)) pts.push({ ...r.faf, name: 'FAF' });
  pts.push({ lat: r.rwy.lat, lon: r.rwy.lon, name: r.rwy.airport });
  return pts;
}

// ------------------------------------------------------------------ flight start
async function startFlight() {
  const world = app.world;
  if (!world) return;
  hideAllScreens();
  loading(true, 'Preparing aircraft…', 0.05);
  try {
    const ap = getAirport(plan.airport);
    const ends = runwayEnds(ap);
    const rwy = ends.find((r) => r.ident === plan.runway) || ends[0];
    app.rwy = rwy;
    const ac = getAircraft(plan.acId);
    const built = await getAircraftGLB(plan.acId, plan.liveryId);
    loading(true, 'Loading aircraft into the world…', 0.15);
    await world.loadAircraft(built.glb, built.physics);
    loading(true, 'Loading 3D cockpit…', 0.17);
    const ck = ac.cockpit && settings.cockpit3d !== false ? await world.loadCockpit(ac.cockpit) : await world.loadCockpit(null);
    $('flightUI').classList.toggle('ck3d', !!ck);
    // 2D panel style for aircraft without a 3D flight deck (3D decks keep the shared glass displays)
    app.panelStyle = ck ? 'boeing' : panelStyleFor(ac);
    for (const k of ['airbus', 'ga', 'boeing']) $('flightUI').classList.toggle('panel-' + k, app.panelStyle === k);
    world.model.show = false;
    world.stopMenuOrbit();
    world.viewer.scene.screenSpaceCameraController.enableInputs = false;
    world.setWeather(plan.weather);
    world.setTimeOfDay(plan.hour, rwy.lon);
    // load scenery around the runway threshold first (to measure terrain/geoid offset)
    const Cesium = window.Cesium;
    world.viewer.camera.setView({ destination: Cesium.Cartesian3.fromRadians(rwy.lon, rwy.lat, rwy.elevM + 250), orientation: { heading: rwy.heading, pitch: -0.35, roll: 0 } });
    loading(true, 'Streaming scenery for ' + ap.n + '…', 0.2);
    await world.waitForScenery(world.mode === 'lite' ? 3000 : 20000, (f) => loading(true, null, 0.2 + f * 0.5));
    let hThr;
    // the ellipsoid-to-sea-level offset is within about -110..+90 m everywhere on Earth: reject implausible samples
    const plausible = (h) => h !== undefined && isFinite(h) && (world.mode === 'lite' || Math.abs(h - rwy.elevM) < 130);
    for (let i = 0; i < 30 && !plausible(hThr); i++) { hThr = world.groundHeight(rwy.lat, rwy.lon); if (!plausible(hThr)) { hThr = undefined; await new Promise((r) => setTimeout(r, 120)); } }
    if (!plausible(hThr) && world.mode !== 'lite') {
      try { const [p] = await window.Cesium.sampleTerrainMostDetailed(world.viewer.scene.terrainProvider, [new window.Cesium.Cartographic(rwy.lon, rwy.lat)]); if (plausible(p.height)) hThr = p.height; } catch (e) { /* ignore */ }
    }
    let geoid = plausible(hThr) ? hThr - rwy.elevM : 0;
    world.aptGeoid = world.aptGeoid || {}; world.aptGeoid[ap.i] = geoid;
    // refine against the median of the 3D tiles along the runways, then lay flat runway surfaces
    world.clearRunwaySurfaces();
    if (world.mode === 'photoreal' && world.calibrateAirport(ap)) geoid = world.aptGeoid[ap.i];
    world.flattenAirport(ap);
    app.calibrated = { [ap.i]: true }; app.lastNear = 0;
    world.setGroundAirports(airportsNear(rwy.lat, rwy.lon, 40 * NM, 12).concat([ap]));
    // spawn
    const fm = new FlightModel(ac, built.physics);
    fm.assist = settings.assist;
    const apl = new Autopilot(fm);
    apl.on((msg, bad) => { toast(msg, /disconnect/i.test(msg) ? 'warn' : ''); if (/disconnected/i.test(msg)) audio.apDisconnect(); });
    app.fm = fm; app.ap = apl;
    const isGA = ac.category === 'General aviation';
    const fuel = ac.fuel * (plan.fuel / 100);
    const payload = Math.max(0, ac.mtow - ac.oew - ac.fuel * 0.3) * (plan.payload / 100) * 0.55;
    const windFrom = plan.windDir * D2R, ws = plan.windSpd * KT;
    const wind = [-Math.cos(windFrom) * ws, -Math.sin(windFrom) * ws, 0];
    const base = { fuel, payload, geoid, wind, turbulence: plan.turb, heading: rwy.heading };
    let spawn;
    if (plan.start === 'runway') {
      const [la, lo] = destination(rwy.lat, rwy.lon, rwy.heading, 35 + ac.length * 0.5);
      let hg = world.groundHeight(la, lo); if (hg === undefined || !isFinite(hg) || Math.abs(hg - (rwy.elevM + geoid)) > 15) hg = rwy.elevM + geoid;
      spawn = { ...base, lat: la, lon: lo, h: hg - built.physics.groundZ - 0.1, groundH: hg, parkingBrake: true, flapIndex: Math.min(isGA ? 1 : 2, ac.flaps.length - 1), gearDown: true };
      fm.reset(spawn);
    } else {
      const approach = plan.start === 'approach';
      const destAp = plan.dest ? getAirport(plan.dest) : null;
      let la, lo, hdg, altMsl, ias, cruise = false;
      if (plan.start === 'cruise' && destAp && distance(rwy.lat, rwy.lon, destAp.la * D2R, destAp.lo * D2R) > 80 * NM) {
        cruise = true;
        const dTot = distance(rwy.lat, rwy.lon, destAp.la * D2R, destAp.lo * D2R);
        let crzFt = isGA ? 6500 : ac.engines.type === 'turboprop' ? Math.min(ac.perf.ceiling - 3000, 21000) : Math.min(ac.perf.ceiling - 4000, ac.category === 'Business jet' ? 43000 : 35000);
        crzFt = Math.min(crzFt, Math.max(isGA ? 4500 : 12000, (dTot / NM) * 120));
        const todNm = (crzFt - destAp.e) / 285 + 18;
        const togo = Math.min(dTot * 0.6, (todNm + 60) * NM);
        const brgTot = bearing(rwy.lat, rwy.lon, destAp.la * D2R, destAp.lo * D2R);
        [la, lo] = destination(rwy.lat, rwy.lon, brgTot, dTot - togo);
        hdg = bearing(la, lo, destAp.la * D2R, destAp.lo * D2R);
        altMsl = crzFt * FT;
        const atmC = isa(altMsl, 0);
        const tas = ac.perf.cruiseMach ? ac.perf.cruiseMach * atmC.a : (ac.perf.cruiseKtas || 120) * KT;
        ias = Math.min(ac.perf.vmo - 10, Math.round((tas * Math.sqrt(atmC.sigma)) / KT));
      } else {
        const dist = (approach ? 6 : 12) * NM;
        const [aimLa, aimLo] = destination(rwy.lat, rwy.lon, rwy.heading, rwy.aim);
        [la, lo] = destination(aimLa, aimLo, rwy.heading + Math.PI, dist);
        hdg = rwy.heading;
        altMsl = approach ? rwy.elevM + dist * Math.tan(3 * D2R) + 15 : rwy.elevM + (isGA ? 3000 : ac.engines.type === 'turboprop' ? 5000 : 6000) * FT;
      }
      fm.reset({ ...base, heading: hdg, lat: la, lon: lo, h: altMsl + geoid, groundH: cruise ? 0 : rwy.elevM + geoid, flapIndex: approach ? ac.flaps.length - 1 : 0, gearDown: approach });
      const vs = fm.vspeeds();
      if (!ias) ias = approach ? vs.vref + 5 : isGA ? 100 : ac.engines.type === 'turboprop' ? 200 : 250;
      const atm = isa(altMsl, 0);
      const V = (ias * KT) / Math.sqrt(atm.sigma);
      const gamma = approach ? -3 * D2R : 0;
      const A = fm.aero;
      const CL = (fm.mass * G0) / (0.5 * atm.rho * V * V * ac.wingArea);
      const alpha = (CL - A.cl0 - A.dclFlaps * fm.flapLevels[fm.flapIndex].flap * 0.8) / A.clAlpha;
      fm.flap = fm.flapLevels[fm.flapIndex].flap; fm.slat = fm.flapLevels[fm.flapIndex].slat;
      fm.q = eulerToQuat(hdg, alpha + gamma, 0);
      fm.vel = [V * Math.cos(gamma) * Math.cos(hdg), V * Math.cos(gamma) * Math.sin(hdg), -V * Math.sin(gamma)];
      fm.airTime = 10; fm.gearPos = approach ? 1 : 0;
      // thrust to balance drag (approximate L/D)
      const LD = approach ? (isGA ? 7 : 8.5) : isGA ? 9 : 15;
      const Treq = (fm.mass * G0) / LD + fm.mass * G0 * Math.sin(gamma);
      let thr = 0.5;
      for (let i = 0; i < 25; i++) {
        fm.ctl.throttle = thr; for (const e of fm.engines) e.n1 = e.idle + thr * (100 - e.idle);
        fm.updateEngines(1e-4, atm, V, V / atm.a);
        const T = fm.engines.reduce((s, e) => s + e.thrust, 0);
        thr = clamp(thr + (Treq - T) / (fm.engines.length * (fm.engines[0].maxThrust || fm.engines[0].maxPower * 0.004)) * 0.6, 0.05, 1);
      }
      fm.calcOutputs(atm, wind);
      apl.sync();
      if (approach) { apl.setApproach(rwy); apl.appArmed = true; apl.engaged = false; apl.spd = Math.round(ias); }
      else { apl.alt = Math.round(fm.out.alt / 100) * 100; apl.hdg = Math.round(wrap360(hdg * R2D)); apl.spd = ias; apl.vert = 'ALT'; apl.lat = 'HDG'; apl.engaged = true; apl.at = true; apl.runway = rwy; }
      app.cruiseStart = cruise;
    }
    if (plan.start === 'runway') { apl.sync(); apl.alt = Math.round((rwy.elevM / FT + (isGA ? 3000 : 5000)) / 100) * 100; apl.hdg = Math.round(wrap360(rwy.heading * R2D)); apl.spd = Math.round(isGA ? 90 : 220); apl.vs = isGA ? 700 : 1800; apl.vert = 'VS'; apl.runway = rwy; }
    // destination route
    app.dest = null; app.destAirport = null; app.destLights = false;
    const destAp = plan.dest ? getAirport(plan.dest) : null;
    if (destAp && destAp.i !== ap.i) {
      setDestination(destAp, plan.destRwy || null, true);
      apl.setRoute(app.dest);
      if (app.cruiseStart) { apl.lat = 'NAV'; apl.vert = 'VNAV'; apl.engaged = true; apl.at = true; }
    }
    if (plan.start !== 'cruise' || !app.cruiseStart) world.setRunwayLights(rwy, geoid); else world.setRunwayLights(null);
    world.resetCamera();
    app.view = plan.start === 'runway' ? 'chase' : 'chase';
    setView(app.view);
    // stream scenery at spawn point for air starts
    world.updateAircraft(fm, 0, true);
    world.updateCamera(fm, 0.016);
    if (plan.start !== 'runway') { loading(true, 'Streaming scenery around the aircraft…', 0.75); await world.waitForScenery(world.mode === 'lite' ? 1500 : 8000, (f) => loading(true, null, 0.75 + f * 0.2)); }
    audio.start(ac.engines.type); audio.vs = fm.vspeeds(); audio.callouts.clear();
    app.flying = true; app.paused = false; app.crashed = false;
    if (app.traffic) app.traffic.start({ ap, rwy, geoid }); // live / AI air traffic
    music.stop(4);
    if (app.map) { app.map.reset(fm, plan.start === 'cruise' ? 8 : 11); app.map.setDest(app.destAirport); }
    input.enabled = true;
    $('flightUI').classList.remove('hidden');
    loading(false);
    toast(`${ac.name} · ${getLivery(plan.liveryId).name} at ${ap.i} RWY ${rwy.ident}`, 'good');
    if (plan.start === 'runway') setTimeout(() => toast('Parking brake set — press N to release, W for thrust', 'warn'), 1500);
    if (world.mode === 'lite' && settings.scenery !== 'lite') toast('Using Lite scenery — add a Cesium ion token in Settings for 3D terrain', 'warn');
    app.lastT = performance.now();
    clearTimeout(app.qkTimer); const qk = $('quickKeys'); if (qk) { qk.style.opacity = '1'; app.qkTimer = setTimeout(() => { qk.style.transition = 'opacity 1s'; qk.style.opacity = '0'; }, 20000); }
  } catch (err) {
    console.error(err);
    loading(false);
    toast('Could not start flight: ' + err.message, 'bad');
    show('setup');
  }
}

// ------------------------------------------------------------------ views
const VIEWS = ['cockpit', 'chase', 'orbit', 'tower'];
const VIEW_NAMES = { cockpit: 'Cockpit', chase: 'Chase', orbit: 'Orbit (drag)', tower: 'Fly-by' };
function setView(v) {
  app.view = v; app.world.cam.mode = v; app.world.cam.lookYaw = 0; app.world.cam.lookPitch = v === 'cockpit' ? -6 * D2R : 0; app.world.cam.zoom = 1; app.world.cam.towerPos = null;
  app.world.cam.fov = v === 'cockpit' ? (app.world.ckMeta ? 76 : 70) : 60;
  if (v === 'cockpit' && app.world.ckMeta) app.world.cam.lookPitch = (app.world.ckMeta.pitchDeg ?? -13) * D2R;
  const ui = $('flightUI'); ui.classList.toggle('view-cockpit', v === 'cockpit');
  $('viewName').textContent = VIEW_NAMES[v];
}
function togglePanel() {
  if (app.view !== 'cockpit') { $('flightUI').classList.toggle('show-mini'); return; }
  app.panel = !app.panel; $('flightUI').classList.toggle('panel-off', !app.panel);
}

// ------------------------------------------------------------------ actions
const act = {
  gear: () => { const fm = app.fm; if (!fm || fm.ac.geo.fixedGear) return; if (fm.onGround && fm.gearDown) { toast('Gear locked down on the ground', 'warn'); return; } fm.gearDown = !fm.gearDown; audio.click(); toast('Gear ' + (fm.gearDown ? 'down' : 'up')); },
  flapsDown: () => { const fm = app.fm; if (!fm) return; fm.setFlapIndex(fm.flapIndex + 1); audio.click(); toast('Flaps ' + fm.flapLabel); },
  flapsUp: () => { const fm = app.fm; if (!fm) return; fm.setFlapIndex(fm.flapIndex - 1); audio.click(); toast('Flaps ' + fm.flapLabel); },
  parkingBrake: () => { const fm = app.fm; if (!fm) return; fm.parkingBrake = !fm.parkingBrake; toast('Parking brake ' + (fm.parkingBrake ? 'set' : 'released')); },
  spoiler: () => { const fm = app.fm; if (!fm) return; fm.spoilerHandle = fm.spoilerHandle > 0 ? 0 : fm.onGround ? 1 : 0.6; fm.spoilersArmed = false; toast('Speedbrake ' + (fm.spoilerHandle ? 'extended' : 'retracted')); },
  spoilerArm: () => { const fm = app.fm; if (!fm) return; fm.spoilersArmed = !fm.spoilersArmed; fm.spoilerHandle = 0; toast('Ground spoilers ' + (fm.spoilersArmed ? 'armed' : 'disarmed')); },
  reversers: () => { const fm = app.fm; if (!fm) return; if (!fm.onGround) { toast('Reversers only on the ground', 'warn'); return; } fm.reversers = !fm.reversers; if (fm.reversers) fm.ctl.throttle = Math.min(fm.ctl.throttle, 0.05); toast('Reverse thrust ' + (fm.reversers ? 'deployed' : 'stowed')); },
  ap: () => { app.ap?.toggle(); }, at: () => { app.ap?.toggleAT(); },
  camera: () => setView(VIEWS[(VIEWS.indexOf(app.view) + 1) % VIEWS.length]),
  cam1: () => setView('cockpit'), cam2: () => setView('chase'), cam3: () => setView('orbit'), cam4: () => setView('tower'),
  mouseYoke: () => { input.mouseYoke = !input.mouseYoke; $('yokeMark').classList.toggle('hidden', !input.mouseYoke); toast(input.mouseYoke ? 'Mouse flying ON — move the pointer to steer (Y to turn off)' : 'Mouse flying OFF', 'good'); },
  map: () => { $('minimap').classList.toggle('hidden-map'); setTimeout(() => app.map?.map?.invalidateSize(), 50); },
  panel: togglePanel, mute: () => { audio.setMuted(!audio.muted); $('btnMute').textContent = audio.muted ? '🔇' : '🔊'; },
  resetView: () => { app.world.cam.lookYaw = 0; app.world.cam.lookPitch = app.view === 'cockpit' ? (app.world.ckMeta ? (app.world.ckMeta.pitchDeg ?? -13) : -6) * D2R : 0; app.world.cam.zoom = 1; },
  idle: () => { if (app.fm) app.fm.ctl.throttle = 0; }, full: () => { if (app.fm) app.fm.ctl.throttle = 1; },
  help: () => { if (app.flying) { pause(true); show('help'); } },
  pause: () => { if (!app.flying) { if (app.screen && app.screen !== 'menu') show('back'); return; } if (app.crashed) return; pause(!app.paused); },
};
for (const [k, fn] of Object.entries(act)) input.on(k, fn);
function pause(on) {
  app.paused = on; input.enabled = !on;
  if (on) { show('pause'); } else { hideAllScreens(); app.lastT = performance.now(); }
}
$('resumeBtn').onclick = () => pause(false);
$('restartBtn').onclick = () => { $('pause').classList.add('hidden'); endFlight(false); startFlight(); };
$('quitBtn').onclick = () => endFlight(true);
$('crashRestart').onclick = () => { endFlight(false); startFlight(); };
$('crashQuit').onclick = () => endFlight(true);
$('btnView').onclick = act.camera; $('btnMap').onclick = act.map; $('btnYoke').onclick = act.mouseYoke; $('qkClose').onclick = () => $('quickKeys').remove(); $('btnPanel').onclick = togglePanel; $('btnMute').onclick = act.mute; $('btnPause').onclick = () => pause(true);
$('gearLever').onclick = act.gear;
$('rngDn').onclick = () => { app.ndRange = Math.max(5, app.ndRange / 2); }; $('rngUp').onclick = () => { app.ndRange = Math.min(160, app.ndRange * 2); };

function endFlight(toMenu) {
  app.flying = false; input.enabled = false; app.paused = false;
  audio.stopEngines();
  if (app.traffic) app.traffic.stop();
  $('flightUI').classList.add('hidden');
  if (app.world.model) app.world.model.show = false;
  if (app.world.cockpit) app.world.cockpit.show = false;
  app.world.points.removeAll(); app.world.rwyPoints.removeAll();
  if (music.ctx) music.play();
  if (toMenu) { app.history = []; show('menu', false); const a = getAirport(plan.airport); if (a) app.world.menuOrbit(a.la, a.lo); }
}

// ------------------------------------------------------------------ MCP
function mcpInc(key, dir, big) {
  const ap = app.ap; if (!ap) return;
  if (key === 'spd') ap.spd = clamp(ap.spd + dir * (big ? 10 : 1), 60, 400);
  if (key === 'hdg') ap.hdg = wrap360(ap.hdg + dir * (big ? 10 : 1));
  if (key === 'alt') ap.alt = clamp(ap.alt + dir * (big ? 1000 : 100), 0, 50000);
  if (key === 'vs') ap.vs = clamp(ap.vs + dir * 100, -6000, 6000);
}
document.querySelectorAll('[data-inc]').forEach((b) => {
  let timer;
  const [key, d] = b.dataset.inc.split(':');
  const fire = (e) => mcpInc(key, +d, e.shiftKey);
  b.addEventListener('pointerdown', (e) => { fire(e); let n = 0; timer = setInterval(() => { n++; mcpInc(key, +d, n > 10); }, 90); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearInterval(timer)));
});
for (const [id, key] of [['mcpSpd', 'spd'], ['mcpHdg', 'hdg'], ['mcpAlt', 'alt'], ['mcpVs', 'vs']]) {
  $(id).addEventListener('wheel', (e) => { e.preventDefault(); mcpInc(key, e.deltaY < 0 ? 1 : -1, e.shiftKey); }, { passive: false });
}
document.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', () => {
  const ap = app.ap; if (!ap) return; audio.click();
  switch (b.dataset.ap) {
    case 'at': ap.toggleAT(); break;
    case 'flch': ap.setVert('FLCH'); ap.spd = Math.round(app.fm.out.ias); if (!ap.at) ap.toggleAT(); break;
    case 'hdg': ap.lat = 'HDG'; ap.appArmed = false; break;
    case 'alt': ap.vert = 'ALT'; ap.alt = Math.round(app.fm.out.alt / 100) * 100; break;
    case 'vs': ap.setVert('VS'); break;
    case 'app': if (ap.appArmed || ap.lat === 'LOC') { ap.appArmed = false; ap.lat = 'HDG'; if (ap.vert === 'GS') ap.vert = 'VS'; toast('Approach disarmed'); } else ap.setApproach(app.dest && app.destLights ? app.dest.rwy : app.rwy); break;
    case 'cmd': ap.toggle(); break;
    case 'nav': if (!app.dest) { toast('Pick a destination first — open the map (M) and click an airport', 'warn'); break; } ap.setRoute(app.dest); ap.lat = 'NAV'; if (!ap.engaged) ap.engage(); break;
    case 'vnav': if (!app.dest) { toast('Pick a destination first — open the map (M) and click an airport', 'warn'); break; } ap.setRoute(app.dest); ap.vert = 'VNAV'; if (!ap.at) ap.toggleAT(); if (!ap.engaged) ap.engage(); break;
  }
}));

// ------------------------------------------------------------------ main loop
let frame = 0, groundTimer = 0, tileTimer = 0, cloudTimer = 0, lastIas = 0, trend = 0;
function tick() {
  if (!app.flying) return;
  const now = performance.now();
  let dt = Math.min(0.1, (now - (app.lastT || now)) / 1000); app.lastT = now;
  const fm = app.fm, world = app.world, ap = app.ap;
  if (!fm) return;
  frame++;
  if (!app.paused && !app.crashed) {
    const c = input.poll(dt, fm);
    fm.ctl.pitch = c.pitch; fm.ctl.roll = c.roll; fm.ctl.yaw = c.yaw;
    // taxi: roll input also steers the nosewheel at low speed
    fm.ctl.tiller = fm.onGround && fm.out.gs < 40 ? clamp(c.yaw + c.roll, -1, 1) : 0;
    // adding takeoff power releases the parking brake automatically
    if (fm.parkingBrake && fm.onGround && fm.ctl.throttle > 0.4 && c.throttleRate > 0) { fm.parkingBrake = false; toast('Parking brake released'); }
    if (c.throttleAbs != null) fm.ctl.throttle = c.throttleAbs;
    else if (c.throttleRate) { fm.ctl.throttle = clamp(fm.ctl.throttle + c.throttleRate * dt, 0, 1); if (ap.at && Math.abs(c.throttleRate) > 0.1 && !fm.onGround) { /* manual override */ ap.thrI = fm.ctl.throttle; } }
    if (fm.reversers && c.throttleRate > 0) fm.ctl.throttle = clamp(fm.ctl.throttle, 0, 1);
    fm.ctl.brakeL = fm.ctl.brakeR = c.brake;
    if (c.brake && fm.parkingBrake && fm.onGround) { /* holding B with park brake: keep */ }
    if (c.trimRate) fm.trim = clamp(fm.trim + c.trimRate * dt, -1, 1);
    if (c.look) { world.cam.lookPitch = clamp(world.cam.lookPitch + c.look.pitch * dt, -1.2, 1.2); }
    // ground height: runway database + async terrain (no per-frame GPU picking)
    groundTimer -= dt;
    if (groundTimer <= 0) {
      groundTimer = 0.1;
      let hg = world.groundFast(fm.lat, fm.lon);
      if (world.tileset && world.runwayHeight(fm.lat, fm.lon) === undefined && world.airportSurfaceHeight(fm.lat, fm.lon) === undefined && (fm.onGround || fm.out.agl < 12)) {
        tileTimer -= 0.1;
        if (tileTimer <= 0) { tileTimer = 0.3; const ht = world.sampleTile(fm.lat, fm.lon); app.tileH = ht !== undefined && isFinite(ht) && (hg === undefined || Math.abs(ht - hg) < 40) ? ht : undefined; }
        if (app.tileH !== undefined) hg = app.tileH;
      } else app.tileH = undefined;
      if (hg !== undefined && isFinite(hg)) {
        const d = hg - fm.groundH;
        fm.groundH = Math.abs(d) < 0.05 || !fm.onGround ? hg : fm.groundH + clamp(d, -1.5, 1.5);
      }
      const lg = world.localGeoid(fm.lat, fm.lon);
      if (lg !== undefined) fm.geoid += (lg - fm.geoid) * 0.05;
    }
    ap.update(dt);
    fm.step(dt, null);
    for (const ev of fm.events.splice(0)) handleEvent(ev);
  }
  // camera input
  const m = input.takeMouse();
  const cam = world.cam;
  if (m.dx || m.dy) {
    if (app.view === 'orbit') { cam.orbitYaw += m.dx * 0.006; cam.orbitPitch = clamp(cam.orbitPitch - m.dy * 0.005, -1.4, 1.4); }
    else { cam.lookYaw = clamp(cam.lookYaw + m.dx * 0.004, -2.6, 2.6); cam.lookPitch = clamp(cam.lookPitch - m.dy * 0.004, -1.3, 1.3); }
  }
  if (m.wheel) cam.zoom = clamp(cam.zoom * (m.wheel > 0 ? 0.88 : 1.14), 0.3, 5);
  // camera shake: runway rumble, turbulence and touchdown jolts
  {
    const sh = world.cam;
    const rumble = fm.onGround ? Math.min(1, fm.out.gs / 140) * 0.006 + (fm.onGround && fm.out.gs > 2 ? 0.0015 : 0) : 0;
    const turb = !fm.onGround ? Math.min(0.01, Math.hypot(...fm.gust) * 0.0018) : 0;
    sh.jolt = (sh.jolt || 0) * Math.exp(-dt * 5);
    sh.shakeAmp = app.paused ? 0 : rumble + turb + sh.jolt;
  }
  world.updateAircraft(fm, app.paused ? 0 : dt, app.view !== 'cockpit');
  if (app.traffic) app.traffic.update(fm, dt);
  world.updateCamera(fm, dt);
  world.updatePapi(fm);
  cloudTimer -= dt; if (cloudTimer <= 0) { cloudTimer = 1; world.updateClouds(fm.lat, fm.lon, fm.h); }
  if (now - app.lastNear > 4000) {
    app.lastNear = now; app.nearby = airportsNear(fm.lat, fm.lon, app.ndRange * NM * 1.3, 25);
    const close = airportsNear(fm.lat, fm.lon, 40 * NM, 12);
    if (app.destAirport && !close.includes(app.destAirport)) close.push(app.destAirport);
    world.setGroundAirports(close);
    app.calibrated = app.calibrated || {};
    if (app.dest && !app.destLights) {
      const dd = distance(fm.lat, fm.lon, app.dest.rwy.lat, app.dest.rwy.lon);
      const g = world.aptGeoid?.[app.dest.ap.i];
      if (dd < 45 * NM && g !== undefined) { world.setRunwayLights(app.dest.rwy, g); app.rwy = app.dest.rwy; app.destLights = true; }
    }
    const near = airportsNear(fm.lat, fm.lon, 12000, 1)[0];
    if (near && !app.calibrated[near.i] && world.calibrateAirport(near)) app.calibrated[near.i] = true;
    if (near && app.calibrated[near.i]) world.flattenAirport(near);
  }
  audio.update(fm, app.view, dt);
  if (app.map && now - (app.lastMap || 0) > 250 && !$('minimap').classList.contains('hidden-map')) {
    app.lastMap = now;
    if (!app.routeCache || now - app.routeCache.t > 2000) {
      const pts = routePoints(fm);
      let line = null;
      if (pts) { const first = pts[0]; line = [...gcPoints(fm.lat * R2D, fm.lon * R2D, first.lat * R2D, first.lon * R2D, 48), ...pts.slice(1).map((p) => [p.lat * R2D, p.lon * R2D])]; }
      app.routeCache = { t: now, pts, line };
    }
    app.map.update(fm, app.routeCache.line);
    if (app.traffic && app.map.setTraffic) app.map.setTraffic(app.traffic.active ? app.traffic.list() : null);
  }
  // speed trend (kt per second, smoothed)
  const o = fm.out;
  if (dt > 0) trend += ((o.ias - lastIas) / dt - trend) * Math.min(1, dt * 2); lastIas = o.ias;
  // frame-rate tracking + adaptive quality
  app.fps = app.fps ? app.fps + ((1 / Math.max(dt, 1e-3)) - app.fps) * 0.05 : 60;
  if (now - (app.lastAdapt || 0) > 2000) { app.lastAdapt = now; if (settings.autoQuality !== false) world.adaptQuality(app.fps); $('fpsVal').textContent = Math.round(app.fps) + ' FPS'; }
  if (now - (app.lastInst || 0) > 50) { app.lastInst = now; drawInstruments(); }
  if (now - (app.lastHud || 0) > 100) { app.lastHud = now; updateHud(); }
}

function handleEvent(ev) {
  if (ev.type === 'touchdown') {
    toast(`Touchdown ${-ev.fpm > 0 ? '' : '-'}${Math.abs(ev.fpm)} fpm · ${ev.rating}`, ev.fpm > 600 ? 'bad' : ev.fpm > 360 ? 'warn' : 'good');
    audio.thump(clamp(ev.fpm / 400, 0.3, 1.5));
    app.world.cam.jolt = clamp(ev.fpm / 6000, 0.01, 0.08);
  } else if (ev.type === 'liftoff') {
    toast('Positive rate', 'good');
  } else if (ev.type === 'crash') {
    app.crashed = true; input.enabled = false; audio.thump(2); audio.stopEngines();
    $('crashReason').textContent = ev.reason; show('crash', false);
  } else if (ev.type === 'warn') { toast(ev.text, 'bad'); }
  else if (ev.type === 'msg') toast(ev.text, 'warn');
}

function instrumentState() {
  const fm = app.fm, ap = app.ap;
  const vs = fm.vspeeds();
  const stallSpeed = vs.vs1 * Math.sqrt((fm.aero.clmaxClean) / (fm.aero.clmaxClean + fm.aero.dclFlaps * fm.flap + fm.aero.dclSlats * fm.slat));
  const ils = ap.runway ? ap.ils() : null;
  const fma = [
    ap.at ? (ap.retard ? 'RETARD' : ap.engaged && ap.vert === 'FLCH' ? (ap.alt > fm.out.alt ? 'THR' : 'IDLE') : 'SPD') : '',
    ap.engaged ? ({ LOC: 'LOC', NAV: 'LNAV' }[ap.lat] || 'HDG SEL') : ap.appArmed ? 'LOC (arm)' : '',
    ap.engaged ? ({ ALT: 'ALT HOLD', VS: 'V/S', FLCH: 'FLCH SPD', VNAV: 'VNAV PTH', GS: ap.flare ? 'FLARE' : 'G/S' }[ap.vert] || '') : '',
  ];
  return {
    style: app.panelStyle, out: fm.out, ap, vspeeds: vs, stallSpeed, phase: fm.onGround && fm.out.ias < vs.vr + 20 && fm.ctl.throttle > 0.3 ? 'takeoff' : fm.onGround ? 'takeoff' : 'air',
    trend, fma, ils: ils && ils.along > -200 && ils.d < 30 * NM && (ap.lat === 'LOC' || ap.appArmed) ? ils : null,
    routePts: app.routeCache?.pts || null,
    lat: fm.lat, lon: fm.lon, nearby: app.nearby, ndRange: app.ndRange, runway: app.dest ? app.dest.rwy : app.rwy, dist: app.dest ? ap.navInfo()?.togo : ils ? ils.d : null, fm,
    traffic: app.traffic?.active ? app.traffic.list() : null,
    warn: fm._tailStruck ? 'TAIL STRIKE' : fm.out.alt > fm.ac.perf.ceiling + 2000 ? 'ABOVE CEILING' : fm.out.ias > vs.vmo + 5 || fm.out.mach > vs.mmo + 0.01 ? 'OVERSPEED' : '',
  };
}
// live displays projected onto the 3D cockpit's screens (CSS homography of the canvas onto the screen quad)
const CK_SCREENS = [['pfd', drawPFD], ['nd', drawND], ['eicas', drawEICAS], ['pfd2', drawPFD], ['nd2', drawND], ['isis', drawPFD]];
const CK_PX = 320;
function homography(q) {
  // maps unit square (0,0),(1,0),(1,1),(0,1) -> quad q (TL,TR,BR,BL)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1; if (Math.abs(den) < 1e-9) return null;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  const S = 1 / CK_PX; // canvas px -> unit square
  return [a * S, d * S, 0, g * S, b * S, e * S, 0, h * S, 0, 0, 1, 0, x0, y0, 0, 1];
}
function drawCockpit3D(s) {
  const box = $('ck3dScreens');
  if (!box.children.length) for (const [k] of CK_SCREENS) { const c = document.createElement('canvas'); c.dataset.k = k; c.dataset.dpr = '1.2'; c.style.width = c.style.height = CK_PX + 'px'; box.appendChild(c); }
  app.ckTick = (app.ckTick || 0) + 1;
  const rect = app.world.viewer.canvas.getBoundingClientRect();
  for (const c of box.children) {
    const k = c.dataset.k, q = app.world.screenQuad(k), m = q && homography(q.map(([x, y]) => [x + rect.left, y + rect.top]));
    if (!m || q.every(([x]) => x < 0) || q.every(([x]) => x > rect.width) || q.every(([, y]) => y > rect.height) || q.every(([, y]) => y < 0)) { c.style.display = 'none'; continue; }
    c.style.display = 'block'; c.style.transform = `matrix3d(${m.join(',')})`;
    // first officer's side and standby refresh at half rate (they are usually off to the side)
    if (/2$|isis/.test(k) && app.ckTick % 2 && c.width) continue;
    CK_SCREENS.find((e) => e[0] === k)[1](c, s);
    // cover glass: soft diagonal glare + slight edge falloff, like a real display unit
    const g = c.getContext('2d'), w = c.width, h = c.height;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const gl = g.createLinearGradient(0, 0, w, h);
    gl.addColorStop(0, 'rgba(255,255,255,0.07)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.015)'); gl.addColorStop(0.36, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0.03)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    g.restore();
  }
}
function drawInstruments() {
  const s = instrumentState();
  if (app.view === 'cockpit' && app.world.ckMeta) { drawCockpit3D(s); return; }
  const st = app.panelStyle;
  if (app.view === 'cockpit') {
    if (!app.panel) return;
    if (st === 'ga') { drawSixPack($('pfd'), s); drawEngineStrip($('eicas'), s); }
    else if (st === 'airbus') { drawAirbusPFD($('pfd'), s); drawND($('nd'), s); drawECAM($('eicas'), s); }
    else { drawPFD($('pfd'), s); drawND($('nd'), s); drawEICAS($('eicas'), s); }
  } else if (app.panel) (st === 'ga' ? drawSixPack : st === 'airbus' ? drawAirbusPFD : drawPFD)($('pfdMini'), s);
}
function updateHud() {
  const fm = app.fm, o = fm.out, ap = app.ap;
  $('hIas').textContent = Math.round(o.ias); $('hAlt').textContent = Math.round(o.alt).toLocaleString();
  $('hVs').textContent = (o.vs > 0 ? '+' : '') + Math.round(o.vs / 10) * 10; $('hHdg').textContent = String(Math.round(o.hdg) % 360).padStart(3, '0');
  $('hThr').textContent = Math.round(fm.ctl.throttle * 100) + '%' + (fm.reversers ? ' R' : '');
  $('hFlaps').textContent = fm.flapLabel;
  const gear = fm.ac.geo.fixedGear ? 'FIX' : fm.gearPos > 0.98 ? 'DN' : fm.gearPos < 0.02 ? 'UP' : '···';
  $('hGear').textContent = gear; $('gearState').textContent = gear;
  $('hAp').textContent = (ap.engaged ? 'CMD' : 'OFF') + (ap.at ? ' A/T' : '');
  // cockpit panel bits
  $('mcpSpd').textContent = Math.round(ap.spd); $('mcpHdg').textContent = String(Math.round(ap.hdg) % 360).padStart(3, '0');
  $('mcpAlt').textContent = ap.alt; $('mcpVs').textContent = (ap.vs >= 0 ? '+' : '−') + String(Math.abs(ap.vs)).padStart(4, '0');
  const on = (k, v) => document.querySelector(`[data-ap="${k}"]`)?.classList.toggle('on', !!v);
  on('at', ap.at); on('cmd', ap.engaged); on('hdg', ap.engaged && ap.lat === 'HDG'); on('alt', ap.engaged && ap.vert === 'ALT'); on('vs', ap.engaged && ap.vert === 'VS'); on('flch', ap.engaged && ap.vert === 'FLCH'); on('nav', ap.engaged && ap.lat === 'NAV'); on('vnav', ap.engaged && ap.vert === 'VNAV'); on('app', ap.appArmed || ap.lat === 'LOC');
  const g = fm.gearPos > 0.98 ? 'g' : fm.gearPos < 0.02 ? '' : 'a';
  for (const id of ['lgtL', 'lgtN', 'lgtR']) $(id).className = g;
  $('rngVal').textContent = app.ndRange;
  $('thrFill').style.width = Math.round(fm.ctl.throttle * 100) + '%'; $('thrVal').textContent = Math.round(fm.ctl.throttle * 100) + '%';
  const navI = app.dest ? ap.navInfo() : null;
  if (navI) {
    const nm = navI.togo / NM, mins = o.gs > 30 ? (nm / o.gs) * 60 : null;
    $('hDestLbl').textContent = app.dest.ap.i; $('hDest').textContent = `${nm < 100 ? nm.toFixed(1) : Math.round(nm)} NM${mins ? ' · ' + (mins >= 60 ? Math.floor(mins / 60) + 'h' + String(Math.round(mins % 60)).padStart(2, '0') : Math.round(mins) + ' min') : ''}`;
  } else { $('hDestLbl').textContent = 'DEST'; $('hDest').textContent = '—'; }
  if (ap.spdAuto && (ap.vert === 'VNAV' || ap.lat === 'NAV' || ap.lat === 'LOC')) $('mcpSpd').textContent = Math.round(ap.spdAuto);
  let hint = '';
  if (navI && !fm.onGround) {
    const nm = navI.togo / NM, last = fm.flapLevels.length - 1;
    if (nm < 6 && fm.flapIndex < last) hint = 'Final approach — landing flaps (F)';
    else if (nm < 9 && !fm.gearDown) hint = 'Gear down (G)';
    else if (nm < 12 && !fm.spoilersArmed && !fm.isGA) hint = 'Arm spoilers (Shift + /)';
    else if (nm < 16 && fm.flapIndex < Math.min(2, last) && o.ias < ap.spdAuto + 40) hint = 'Approach — extend flaps (F) as you slow down';
  }
  if (fm.parkingBrake && fm.onGround && fm.ctl.throttle > 0.2) hint = 'Parking brake is set — press N';
  else if (o.stall) hint = 'STALL — lower the nose, add thrust';
  else if (fm.onGround && fm.out.gs < 1 && !fm.parkingBrake && fm.ctl.throttle < 0.05 && frame < 400) hint = 'Hold W to add thrust';
  if (!hint && navI && ap.engaged && ap.lat !== 'NAV' && ap.lat !== 'LOC' && !fm.onGround && o.alt > 1500) hint = 'Destination set — press LNAV and VNAV on the autopilot panel to fly there';
  $('hint').textContent = hint;
}

// ------------------------------------------------------------------ boot
async function boot() {
  $('tokenNote').textContent = settings.ionToken ? '' : 'Tip: add your free Cesium ion token in Settings for 3D terrain & photorealistic cities.';
  loading(true, 'Starting OpenSkies…', 0.1);
  try {
    if (!window.Cesium) throw new Error('CesiumJS failed to load (check your internet connection).');
    const world = new World('cesium');
    await world.init(settings);
    app.world = world;
    input.attachMouse(world.viewer.canvas);
    world.viewer.scene.preUpdate.addEventListener(tick);
    app.traffic = new Traffic(world, { enabled: settings.traffic !== false, labels: settings.trafficLabels !== false, proxy: settings.trafficProxy });
    app.traffic.onStatus = (txt, st) => { if (app.flying) toast(st === 'live' ? `Live traffic: ${txt.replace('live · ', '')}` : st === 'ai' ? 'Live traffic unavailable — showing AI traffic' : txt, st === 'live' ? 'good' : 'warn'); };
    world.excludeExtra = () => app.traffic.primitives();
    loading(true, 'Loading airports…', 0.3);
    await loadAirports();
    try { app.map = new MiniMap($('minimap'), { airports: allAirports, onSetDest: (a, ident) => setDestination(a, ident) }); } catch (e) { console.warn('map failed', e); }
    loading(true, 'Loading scenery…', 0.5);
    const mode = await world.setScenery(settings.scenery, (t) => loading(true, t, 0.6));
    if (mode !== settings.scenery && settings.scenery !== 'lite') {
      $('tokenNote').textContent = settings.ionToken
        ? '3D scenery did not load. Check the Cesium token permissions and your connection in Settings.'
        : 'Add your free Cesium ion token in Settings to unlock photorealistic 3D cities and terrain.';
    } else if (mode === 'photoreal') {
      $('tokenNote').textContent = 'Photorealistic 3D scenery is ready.';
    }
    world.setWeather(plan.weather);
    const a = getAirport(plan.airport) || getAirport('KDAL');
    world.setTimeOfDay(plan.hour, a.lo * D2R);
    world.menuOrbit(a.la, a.lo);
  } catch (e) {
    console.error(e);
    toast(e.message, 'bad');
  }
  loading(false);
  show('menu', false);
}
window.__app = app; // handy for debugging in the console
boot();
