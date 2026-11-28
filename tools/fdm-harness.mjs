#!/usr/bin/env node
// Headless flight-test harness for the OpenSkies flight model.
// Flies scripted take-offs, landings, cruise, engine spool, stall and a full LNAV/VNAV autoland
// for representative types and prints the numbers next to published real-world references.
//   node tools/fdm-harness.mjs                 all tests, all types
//   node tools/fdm-harness.mjs b737-800 to     one type, one test (to|ldg|crz|spool|stall|xwind|auto|sys)
import { FlightModel } from '../js/sim/flightmodel.js';
import { Autopilot } from '../js/sim/autopilot.js';
import { Systems } from '../js/sim/systems.js';
import { buildAircraft } from '../js/model/builder.js';
import { getAircraft } from '../js/data/aircraft.js';
import { PERF_REF } from '../js/data/perf.js';
import { D2R, R2D, KT, FT, NM, G0, clamp, isa, destination, eulerToQuat, distance } from '../js/sim/math.js';

const TYPES = ['b737-800', 'a320neo', 'b777-300er', 'a380-800', 'atr72-600', 'c172'];
const DT = 1 / 60;
const args = process.argv.slice(2);
const onlyType = args.find((a) => TYPES.includes(a) || getAircraft(a).id === a && a.includes('-') || /^[a-z0-9-]+$/.test(a) && a.length > 3 && !['spool', 'stall', 'xwind', 'auto', 'crz', 'ldg'].includes(a));
const onlyTest = args.find((a) => ['to', 'ldg', 'crz', 'spool', 'stall', 'xwind', 'auto', 'sys', 'wet'].includes(a));

const LAT0 = 40 * D2R, LON0 = -100 * D2R, ELEV = 0;
const RWY = (hdg = 0) => ({ lat: LAT0, lon: LON0, heading: hdg, elevM: ELEV, endElevM: ELEV, aim: 300, airport: 'TEST', ident: '36', length: 4000, width: 45 });

function make(id, opts = {}) {
  const ac = getAircraft(id);
  const phys = buildAircraft(ac).physics;
  const fm = new FlightModel(ac, phys);
  fm.assist = opts.assist || 'assisted';
  const ap = new Autopilot(fm);
  ap.on(() => {});
  const sys = new Systems(fm);
  fm.systems = sys;
  return { ac, phys, fm, ap, sys };
}
function massFor(ac, mass) {
  // split a target gross mass into fuel + payload
  const fuel = Math.min(ac.fuel * 0.5, Math.max(ac.fuel * 0.15, (mass - ac.oew) * 0.4));
  return { fuel, payload: Math.max(0, mass - ac.oew - fuel) };
}
function groundStart(t, ref, extra = {}) {
  const { ac, phys, fm, sys } = t;
  const m = massFor(ac, ref.toMass);
  fm.reset({ lat: LAT0, lon: LON0, h: ELEV - phys.groundZ - 0.1, groundH: ELEV, heading: 0, parkingBrake: false, gearDown: true, flapIndex: ref.toFlap, fuel: m.fuel, payload: m.payload, ...extra });
  sys.setState('runway');
  for (let i = 0; i < 120; i++) fm.step(DT); // settle on the gear
  return m;
}
const along = (fm) => distance(LAT0, LON0, fm.lat, fm.lon) * Math.sign(fm.lat - LAT0 || 1);

// --------------------------------------------------------------- take-off
function takeoff(id, ref, opts = {}) {
  const t = make(id, opts);
  const { fm } = t;
  groundStart(t, ref, opts.reset || {});
  if (opts.wind) fm.wind = opts.wind;
  const vs = fm.vspeeds();
  const Vr = vs.vr, V2 = vs.v2;
  const x0 = along(fm);
  let time = 0, rotT = null, lofX = null, lofV = null, x35 = null, v35 = null, maxPitch = 0, tailStrike = false;
  let vsSamples = [], pitchTgt = 0, gearUp = false, maxXte = 0;
  // standing start: brakes on, spool to ~40 % then TOGA (Boeing/Airbus SOP), release
  fm.ctl.brakeL = fm.ctl.brakeR = 1; fm.ctl.throttle = fm.isGA ? 1 : 0.4;
  for (let i = 0; i < (fm.isGA ? 60 : 240); i++) fm.step(DT);
  fm.ctl.brakeL = fm.ctl.brakeR = 0; fm.ctl.throttle = 1;
  const xs = along(fm);
  while (time < 150 && !fm.crashed) {
    const o = fm.out;
    // rotate: ~2.5-3 deg/s to the target attitude
    const targetMax = ref.toPitch;
    if (o.ias >= Vr && rotT == null) rotT = time;
    // rotate ~2.5-3 deg/s; on the gear stay ~1.5 deg below the tail-strike attitude
    if (rotT != null) pitchTgt = Math.min(fm.onGround ? Math.min(targetMax, t.phys.tailAngle - 1) : targetMax, (time - rotT) * (fm.isGA ? 4 : 2.8) + (fm.onGround ? 0 : 0));
    if (x35 != null) {
      // pitch for V2+15 once airborne
      const spdErr = o.ias - (fm.isGA ? V2 : V2 + 15); // GA: climb at Vy
      pitchTgt = clamp(targetMax + spdErr * 0.4, 3, targetMax + 6);
      if (!gearUp && o.vs > 300) { fm.gearDown = false; gearUp = true; }
    }
    const pe = pitchTgt - o.pitch;
    fm.ctl.pitch = rotT != null ? clamp((fm.isGA ? 0.45 : 0.25) * pe - 0.5 * fm.w[1] * R2D * 0.2, -1, 1) : 0;
    // keep the centreline with rudder / roll on the wings level
    const xte = distance(LAT0, LON0, LAT0, fm.lon) * Math.sign(fm.lon - LON0);
    maxXte = Math.max(maxXte, Math.abs(xte));
    if (fm.onGround) { fm.ctl.yaw = clamp(-xte * 0.05 - (o.hdg > 180 ? o.hdg - 360 : o.hdg) * 0.15 - fm.w[2] * 2, -1, 1); fm.ctl.roll = clamp(-o.roll * 0.1, -1, 1); }
    else { fm.ctl.yaw = 0; fm.ctl.roll = clamp(-o.roll * 0.05 - ((o.track > 180 ? o.track - 360 : o.track)) * 0.05, -1, 1); }
    fm.step(DT); time += DT;
    if (process.env.TRACE && rotT != null && Math.round(time * 60) % 15 === 0 && x35 == null) console.log(`   t${(time - rotT).toFixed(2)} ias ${fm.out.ias.toFixed(1)} pitch ${fm.out.pitch.toFixed(1)} tgt ${pitchTgt.toFixed(1)} alpha ${fm.out.alpha.toFixed(1)} de ${fm.surf.de.toFixed(2)} ctl ${fm.ctl.pitch.toFixed(2)} wow ${fm.wow} CL ${fm.air.CL.toFixed(2)} agl ${fm.out.agl.toFixed(1)}`);
    for (const e of fm.events.splice(0)) if (e.type === 'tailstrike') tailStrike = true;
    maxPitch = Math.max(maxPitch, fm.out.pitch);
    if (lofX == null && !fm.onGround && fm.airTime > 0.3) { lofX = along(fm) - xs; lofV = fm.out.ias; }
    if (x35 == null && fm.out.agl > 35) { x35 = along(fm) - xs; v35 = fm.out.ias; }
    if (fm.out.agl > 400 && fm.out.agl < 1500 && gearUp) vsSamples.push(fm.out.vs);
    if (fm.out.agl > 1500) break;
  }
  const climb = vsSamples.length ? vsSamples.reduce((a, b) => a + b, 0) / vsSamples.length : NaN;
  return { Vr, V2, lofV, lofX, x35, v35, climb, maxPitch, tailStrike, crashed: fm.crashed, mass: fm.mass, maxXte };
}

// --------------------------------------------------------------- landing (manual-style, AP to flare)
function landing(id, ref, opts = {}) {
  const t = make(id, opts);
  const { fm, ap, sys, ac } = t;
  const m = massFor(ac, ref.ldgMass);
  const rwy = RWY(0);
  const dist = 4 * NM;
  const [aimLa, aimLo] = destination(rwy.lat, rwy.lon, 0, rwy.aim);
  const [la, lo] = destination(aimLa, aimLo, Math.PI, dist);
  const altMsl = rwy.elevM + dist * Math.tan(3 * D2R) + 15;
  fm.reset({ lat: la, lon: lo, h: altMsl, groundH: ELEV, heading: 0, flapIndex: ac.flaps.length - 1 - (ref.ldgFlapFromFull || 0), gearDown: true, fuel: m.fuel, payload: m.payload });
  sys.setState('air');
  if (opts.autobrake) sys.autobrake = opts.autobrake;
  if (opts.wet) fm.runwayWet = true;
  if (opts.wind) fm.wind = opts.wind;
  const vs = fm.vspeeds();
  const ias = vs.vref + (fm.isGA ? 5 : 5);
  trimAir(fm, altMsl, ias, -3 * D2R, true);
  ap.sync(); ap.setApproach(rwy); ap.appArmed = true; ap.spd = Math.round(vs.vref + 5); ap.at = true; ap.engaged = true; ap.vert = 'VS'; ap.vs = -Math.round(ias * 101.27 * Math.tan(3 * D2R));
  fm.spoilersArmed = !fm.isGA;
  let time = 0, x50 = null, tdX = null, tdV = null, tdFpm = null, stopX = null, revOn = false, maxDecel = 0, vPrev = null;
  while (time < 400 && !fm.crashed) {
    ap.update(DT);
    if (fm.onGround && fm.groundTime > 0.5) {
      // after touchdown: reversers, then manual brakes or autobrake
      fm.ctl.throttle = 0;
      if (!fm.isGA && opts.reversers !== false && !revOn && fm.out.gs > 60) { fm.reversers = true; revOn = true; }
      if (fm.reversers) fm.ctl.throttle = fm.out.gs > 70 ? 1 : 0;
      if (fm.out.gs < 60 && fm.reversers) { fm.reversers = false; fm.ctl.throttle = 0; }
      if (!opts.autobrake) fm.ctl.brakeL = fm.ctl.brakeR = opts.brake ?? 1;
      fm.ctl.pitch = -0.1; // nose down
      const hdgErr = fm.out.hdg > 180 ? fm.out.hdg - 360 : fm.out.hdg;
      fm.ctl.yaw = clamp(-hdgErr * 0.2, -1, 1);
    }
    fm.step(DT); time += DT;
    if (process.env.TRACE && !fm.onGround && fm.out.agl < 60 && Math.round(time * 60) % 20 === 0) console.log(`   x ${along(fm).toFixed(0)} agl ${fm.out.agl.toFixed(1)} ias ${fm.out.ias.toFixed(1)} vs ${fm.out.vs.toFixed(0)} pitch ${fm.out.pitch.toFixed(1)} thr ${fm.ctl.throttle.toFixed(2)} flare ${ap.flare}`);
    for (const e of fm.events.splice(0)) if (e.type === 'touchdown') { tdX = along(fm); tdV = fm.out.ias; tdFpm = e.fpm; }
    const x = along(fm);
    if (x50 == null && fm.out.agl < 50) x50 = x;
    const gs = fm.out.gs;
    if (vPrev != null && fm.onGround) maxDecel = Math.max(maxDecel, (vPrev - gs) * KT / DT / G0);
    if (process.env.TRACE && fm.onGround && Math.round(time * 60) % 30 === 0) console.log(`   roll x ${(x - (tdX ?? x)).toFixed(0)} gs ${gs.toFixed(0)} dec ${((vPrev - gs) * KT / DT / G0).toFixed(2)} wow ${fm.wow} CL ${fm.air.CL.toFixed(2)} L/W ${(fm.air.qbar * fm.S * fm.air.CL / fm.mass / G0).toFixed(2)} rev ${fm.engines[0].reverse.toFixed(2)} T ${(fm.engines[0].thrust / 1000).toFixed(1)} sp ${fm.spoiler.toFixed(2)} pitch ${fm.out.pitch.toFixed(1)}`);
    vPrev = gs;
    if (tdX != null && gs < 2) { stopX = x; break; }
  }
  return { vref: vs.vref, tdV, tdFpm, air: tdX != null && x50 != null ? tdX - x50 : NaN, roll: stopX != null ? stopX - tdX : NaN, total: stopX != null && x50 != null ? stopX - x50 : NaN, tdX, crashed: fm.crashed, mass: fm.mass, maxDecel };
}

// trim the aircraft in the air for a given IAS / flight-path angle
function trimAir(fm, altMsl, ias, gamma, approach) {
  const atm = isa(altMsl, 0);
  const V = (ias * KT) / Math.sqrt(atm.sigma);
  const A = fm.aero;
  fm.flap = fm.flapLevels[fm.flapIndex].flap; fm.slat = fm.flapLevels[fm.flapIndex].slat;
  const CL = (fm.mass * G0 * Math.cos(gamma)) / (0.5 * atm.rho * V * V * fm.S);
  const alpha = (CL - A.cl0 - A.flapLin * Math.pow(fm.flap, A.flapExp)) / A.clAlpha;
  const hdg = 0;
  fm.q = eulerToQuat(hdg, alpha + gamma, 0);
  fm.vel = [V * Math.cos(gamma), 0, -V * Math.sin(gamma)];
  fm.airTime = 10; fm.gearPos = fm.gearDown ? 1 : 0; fm.onGround = false;
  // elevator trim for zero pitching moment at this alpha (matters in direct law)
  const d = fm.d; fm.trim = clamp(-(d.Cma * (alpha - d.a0) + d.Cmflap * fm.flap + d.Cmgear * fm.gearPos) / d.Cmde, -1, 1);
  // throttle for thrust = drag (iterate a few seconds)
  fm.ctl.throttle = approach ? 0.45 : 0.75;
  for (const e of fm.engines) e.n1 = e.idle + fm.ctl.throttle * (100 - e.idle);
  fm.calcOutputs(atm, fm.wind);
}

// --------------------------------------------------------------- cruise
function cruise(id, ref) {
  const t = make(id);
  const { fm, ap, sys, ac } = t;
  const m = massFor(ac, ref.crzMass);
  const altMsl = ref.crzAlt * FT;
  fm.reset({ lat: LAT0, lon: LON0, h: altMsl, groundH: 0, heading: 0, flapIndex: 0, gearDown: false, fuel: m.fuel, payload: m.payload });
  sys.setState('air');
  const atm = isa(altMsl, 0);
  const tas = ac.perf.cruiseMach ? ac.perf.cruiseMach * atm.a : ac.perf.cruiseKtas * KT;
  // calibrated airspeed that gives that TAS (compressible)
  fm.gearDown = false; trimAir(fm, altMsl, tas / KT * Math.sqrt(atm.sigma), 0, false);
  fm.vel = [tas, 0, 0]; fm.calcOutputs(atm, [0, 0, 0]);
  const ias = fm.out.ias;
  ap.sync(); ap.alt = ref.crzAlt; ap.vert = 'ALT'; ap.lat = 'HDG'; ap.hdg = 0; ap.spd = ias; ap.engaged = true; ap.at = true;
  let time = 0, f0 = null, fuelT0 = 0, n1 = 0, k = 0, mach = 0, alpha = 0, tasS = 0;
  while (time < 240) {
    ap.update(DT); fm.step(DT); time += DT;
    if (time > 120) {
      if (f0 == null) { f0 = fm.fuel; fuelT0 = time; }
      n1 += fm.engines[0].n1; mach += fm.out.mach; alpha += fm.out.alpha; tasS += fm.out.tas; k++;
    }
  }
  const burn = (f0 - fm.fuel) / ((time - fuelT0) / 3600);
  return { burn, n1: n1 / k, mach: mach / k, tas: tasS / k, alpha: alpha / k, alt: fm.out.alt, ias, mass: fm.mass };
}

// --------------------------------------------------------------- engine spool
function spool(id, ref) {
  const t = make(id);
  const { fm } = t;
  groundStart(t, ref);
  fm.parkingBrake = true;
  fm.ctl.throttle = 0;
  for (let i = 0; i < 600; i++) fm.step(DT);
  const e = fm.engines[0];
  const nIdle = e.n1, tIdle = e.thrust;
  fm.ctl.throttle = 1;
  let time = 0, t95 = null, tMax = 0;
  // max static thrust reference
  while (time < 20) { fm.step(DT); time += DT; tMax = Math.max(tMax, e.thrust); }
  // re-run measuring
  const t2 = make(id); groundStart(t2, ref); t2.fm.parkingBrake = true; t2.fm.ctl.throttle = 0;
  for (let i = 0; i < 600; i++) t2.fm.step(DT);
  t2.fm.ctl.throttle = 1; time = 0;
  const e2 = t2.fm.engines[0];
  while (time < 20) { t2.fm.step(DT); time += DT; if (t95 == null && e2.thrust >= 0.95 * tMax) t95 = time; }
  return { nIdle, t95, tMax, idleThrust: tIdle };
}

// --------------------------------------------------------------- stall
function stall(id, ref) {
  const t = make(id, { assist: 'realistic' });
  const { fm, sys, ac } = t;
  const m = massFor(ac, ref.ldgMass);
  const altMsl = (fm.isGA ? 4000 : 10000) * FT;
  fm.reset({ lat: LAT0, lon: LON0, h: altMsl, groundH: 0, heading: 0, flapIndex: 0, gearDown: false, fuel: m.fuel, payload: m.payload });
  sys.setState('air');
  const vs = fm.vspeeds();
  trimAir(fm, altMsl, vs.vs1 * 1.4, 0, false);
  fm.ctl.throttle = 0; for (const e of fm.engines) e.n1 = e.idle;
  // FBW: full back stick (normal law holds alpha max). Conventional: hold altitude with the
  // elevator as speed decays ~1 kt/s, then at the stall break recover (stick forward).
  let time = 0, minIas = 999, maxRoll = 0, buffet = 0, stallIas = null, maxAlpha = 0, warnIas = null, tStall = null;
  const fbw = !!ac.fbw;
  while (time < 200) {
    const o = fm.out;
    if (fbw) { fm.assist = 'assisted'; fm.ctl.pitch = 1; }
    else if (tStall == null) fm.ctl.pitch = clamp(fm.ctl.pitch + DT * (-o.vs / 30000 - 0.6 * fm.w[1]), -1, 1);
    else if (time - tStall > 1.5) fm.ctl.pitch = clamp(0.04 * (-3 - o.pitch) - 0.3 * fm.w[1] * R2D * 0.1, -0.5, 0.3); // recover: nose to ~3 deg below the horizon
    fm.ctl.roll = 0;
    fm.step(DT); time += DT;
    minIas = Math.min(minIas, fm.out.ias); maxAlpha = Math.max(maxAlpha, fm.out.alpha);
    if (fm.out.stall && warnIas == null) warnIas = fm.out.ias;
    if (fm.stallFactor > 0.05 && stallIas == null) { stallIas = fm.out.ias; tStall = time; }
    if (process.env.TRACE && tStall != null && Math.round(time * 60) % 15 === 0 && time - tStall < 4) console.log(`   ${(time - tStall).toFixed(2)} roll ${fm.out.roll.toFixed(1)} p ${(fm.w[0] * R2D).toFixed(1)} r ${(fm.w[2] * R2D).toFixed(1)} beta ${fm.out.beta.toFixed(1)} alpha ${fm.out.alpha.toFixed(1)} stall ${fm.stallFactor.toFixed(2)} drop ${fm.wingDrop} da ${fm.surf.da.toFixed(2)} dr ${fm.surf.dr.toFixed(2)} pitch ${fm.out.pitch.toFixed(1)}`);
    buffet = Math.max(buffet, fm.buffet || 0);
    if (tStall != null && time - tStall < 5) maxRoll = Math.max(maxRoll, Math.abs(fm.out.roll)); // wing drop before the recovery takes effect
    if (tStall != null && time - tStall > 6) break;
  }
  return { vs1: vs.vs1, warnIas, stallIas, minIas, maxRoll, buffet, maxAlpha, alphaStall: fm.alphaStall * R2D, fbw };
}

// --------------------------------------------------------------- crosswind take-off roll
function xwind(id, ref) {
  // 25 kt direct crosswind from the right (from 090), no pilot rudder -> weathervane (nose turns into wind)
  const t = make(id);
  const { fm } = t;
  groundStart(t, ref);
  const ws = (fm.isGA ? 15 : 25) * KT;
  fm.wind = [0, -ws, 0]; // blowing toward the west (from the east)
  fm.ctl.throttle = fm.isGA ? 0.8 : 0.6;
  let time = 0;
  while (time < 25 && fm.out.ias < fm.vspeeds().vr - 15) { fm.ctl.yaw = 0; fm.ctl.tiller = 0; fm.step(DT); time += DT; }
  const hdg = fm.out.hdg > 180 ? fm.out.hdg - 360 : fm.out.hdg;
  return { hdgChange: hdg, ias: fm.out.ias, time };
}

// --------------------------------------------------------------- full LNAV/VNAV route + ILS autoland
function autoland(id, ref) {
  const t = make(id);
  const { fm, ap, sys, ac } = t;
  const m = massFor(ac, ref.ldgMass);
  const rwy = RWY(0);
  const fafDist = (fm.isGA ? 5 : 10) * NM;
  const [fla, flo] = destination(rwy.lat, rwy.lon, Math.PI, fafDist);
  const [ila, ilo] = destination(rwy.lat, rwy.lon, Math.PI, fafDist + 8 * NM);
  const route = { ap: { i: 'TEST' }, rwy, fafDist, faf: { lat: fla, lon: flo }, ifix: { lat: ila, lon: ilo } };
  // start 45 NM out, abeam to the south-west, at cruise-ish level
  const startAlt = fm.isGA ? 4500 : 11000;
  const [la, lo] = destination(rwy.lat, rwy.lon, 200 * D2R, (fm.isGA ? 22 : 45) * NM);
  const hdg = 30 * D2R;
  fm.reset({ lat: la, lon: lo, h: startAlt * FT, groundH: ELEV, heading: hdg, flapIndex: 0, gearDown: false, fuel: m.fuel, payload: m.payload });
  sys.setState('air');
  trimAirHdg(fm, startAlt * FT, fm.isGA ? 100 : 250, hdg);
  ap.sync(); ap.alt = startAlt; ap.spd = fm.isGA ? 100 : 250; ap.engaged = true; ap.at = true; ap.setRoute(route); ap.lat = 'NAV'; ap.vert = 'VNAV';
  fm.spoilersArmed = false;
  let time = 0, td = null, stopX = null, msgs = [];
  ap.listeners = [(mm) => msgs.push(`${time.toFixed(0)}s ${mm}`)];
  const last = fm.flapLevels.length - 1;
  while (time < 2400 && !fm.crashed) {
    const nav = ap.navInfo(), o = fm.out, vref = fm.vspeeds().vref;
    // pilot: flaps on speed schedule, gear at ~9 NM, spoilers armed, autobrake
    if (!fm.onGround && nav) {
      const nm = nav.togo / NM;
      const fmax = fm.flapLevels.length - 1;
      const want = nm < 6 ? fmax : nm < 9 ? Math.max(fm.flapIndex, fmax - 1) : nm < 14 ? Math.max(fm.flapIndex, Math.min(fmax - 2, 2)) : nm < 20 ? Math.max(fm.flapIndex, 1) : fm.flapIndex;
      if (nm < 9 && !fm.gearDown) fm.gearDown = true;
      if (nm < 12 && !fm.isGA && !fm.spoilersArmed) { fm.spoilersArmed = true; sys.setAutobrake('MED'); }
      // pilot uses the speedbrake when the aircraft is fast on the descent ("DRAG REQUIRED")
      if (!fm.isGA) fm.spoilerHandle = ap.spdAuto && o.ias > ap.spdAuto + 12 && o.vs < -300 && o.agl > 1200 ? 0.6 : 0;
      if (want > fm.flapIndex && o.ias < fm.vspeeds().flapMax + 10 && time - (t.lastFlap || 0) > 4) { t.lastFlap = time; fm.setFlapIndex(fm.flapIndex + 1); }
    }
    ap.update(DT); fm.step(DT); time += DT;
    if (process.env.TRACE && (Math.round(time * 60) % (60 * 10) === 0 || (o.agl < 60 && Math.round(time * 60) % 15 === 0))) console.log(`  t${time.toFixed(0)} togo ${(nav ? nav.togo / NM : 0).toFixed(1)} alt ${o.alt.toFixed(0)} agl ${o.agl.toFixed(0)} ias ${o.ias.toFixed(0)} vs ${o.vs.toFixed(0)} pitch ${o.pitch.toFixed(1)} roll ${o.roll.toFixed(1)} flap ${fm.flapLabel} thr ${fm.ctl.throttle.toFixed(2)} ${ap.lat}/${ap.vert} gsDev ${ap.ilsData ? ap.ilsData.gsDev.toFixed(0) : '-'}`);
    for (const e of fm.events.splice(0)) if (e.type === 'touchdown') td = { fpm: e.fpm, x: along(fm), ias: fm.out.ias, xte: distance(LAT0, LON0, LAT0, fm.lon) };
    if (process.env.TRACE && o.agl < 4) console.log(`   ${time.toFixed(2)} agl ${o.agl.toFixed(1)} pitch ${o.pitch.toFixed(1)} q ${(fm.w[1] * R2D).toFixed(1)} wow ${fm.wow} gs ${o.gs.toFixed(0)} comp ${fm.gear.map((g) => g.comp.toFixed(2))} de ${fm.surf.de.toFixed(2)} law ${fm.law}`);
    if (td && fm.onGround) {
      fm.ctl.throttle = 0;
      if (fm.isGA) fm.ctl.brakeL = fm.ctl.brakeR = 0.7;
      if (fm.out.gs < 2) { stopX = along(fm); break; }
    }
  }
  return { td, stopX, time, crashed: fm.crashed, msgs };
}
function trimAirHdg(fm, altMsl, ias, hdg) {
  const atm = isa(altMsl, 0);
  const V = (ias * KT) / Math.sqrt(atm.sigma);
  const A = fm.aero;
  const CL = (fm.mass * G0) / (0.5 * atm.rho * V * V * fm.S);
  const alpha = (CL - A.cl0) / A.clAlpha;
  fm.q = eulerToQuat(hdg, alpha, 0);
  fm.vel = [V * Math.cos(hdg), V * Math.sin(hdg), 0];
  fm.airTime = 10; fm.gearPos = 0; fm.onGround = false; fm.ctl.throttle = 0.6;
  for (const e of fm.engines) e.n1 = e.idle + 0.6 * (100 - e.idle);
  fm.calcOutputs(atm, fm.wind);
}

// --------------------------------------------------------------- systems: cold & dark start
function systemsTest(id, ref) {
  const t = make(id);
  const { fm, sys } = t;
  groundStart(t, ref);
  sys.setState('cold');
  const log = [];
  sys.onEvent = (e) => log.push(e);
  let time = 0;
  const run = (s) => { for (let i = 0; i < s / DT; i++) { sys.update(DT); fm.step(DT); time += DT; } };
  run(1);
  const cold = { running: fm.engines.filter((e) => e.running).length, bat: sys.elec.battery };
  sys.set('battery', true); run(1);
  if (sys.hasApu) { sys.set('apu', true); run(70); sys.set('apuBleed', true); run(2); }
  else { sys.set('extPower', true); run(1); }
  const apu = { apuN: sys.apu ? sys.apu.n : null, apuAvail: sys.apu ? sys.apu.avail : null };
  sys.set('beacon', true); run(0.5);
  const starts = [];
  for (let i = fm.engines.length - 1; i >= 0; i--) {
    sys.startEngine(i);
    const e = fm.engines[i];
    let tFuel = null, tLight = null, tAvail = null, egtMax = 0, t0 = time;
    for (let k = 0; k < 120 / DT; k++) {
      sys.update(DT); fm.step(DT); time += DT;
      const st = sys.eng[i];
      if (tFuel == null && st.fuelOn) tFuel = { t: time - t0, n2: e.n2 };
      if (tLight == null && st.lit) tLight = time - t0;
      egtMax = Math.max(egtMax, e.egt);
      if (e.running && st.phase === 'run') { tAvail = time - t0; break; }
    }
    starts.push({ eng: i + 1, fuelAtN2: tFuel ? tFuel.n2.toFixed(0) : '-', tFuel: tFuel ? tFuel.t.toFixed(1) : '-', tLight: tLight?.toFixed(1), tAvail: tAvail?.toFixed(1), egtMax: Math.round(egtMax), n1: e.n1.toFixed(1), n2: e.n2.toFixed(1) });
  }
  return { cold, apu, starts, log: log.slice(0, 40) };
}

// --------------------------------------------------------------- report
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v));
const pct = (sim, ref) => (sim == null || ref == null || Number.isNaN(sim) ? '' : `${sim >= ref ? '+' : ''}${(((sim - ref) / ref) * 100).toFixed(0)}%`);
function row(name, sim, ref, unit = '', d = 0) {
  const r = Array.isArray(ref) ? `${ref[0]}–${ref[1]}` : fmt(ref, d);
  const mid = Array.isArray(ref) ? (ref[0] + ref[1]) / 2 : ref;
  const ok = Array.isArray(ref) ? sim >= ref[0] * 0.95 && sim <= ref[1] * 1.05 : ref == null || typeof ref === 'string' ? true : Math.abs(sim - ref) / Math.abs(ref) < 0.1;
  console.log(`  ${name.padEnd(28)} ${(fmt(sim, d) + ' ' + unit).padEnd(16)} ref ${(r + ' ' + unit).padEnd(18)} ${pct(sim, mid).padEnd(6)} ${ok ? 'ok' : '<-- check'}`);
  return ok;
}

let fails = 0;
const check = (ok) => { if (!ok) fails++; };
for (const id of TYPES.filter((x) => !onlyType || x === onlyType)) {
  const ref = PERF_REF[id];
  const ac = getAircraft(id);
  console.log(`\n=== ${ac.maker} ${ac.name} (${id}) ===`);
  if (!onlyTest || onlyTest === 'to') {
    const r = takeoff(id, ref);
    console.log(` Take-off  ${(r.mass / 1000).toFixed(1)} t, flaps ${ac.flaps[ref.toFlap].label}, SL ISA, TOGA${r.crashed ? '  CRASH: ' + r.crashed : ''}${r.tailStrike ? '  TAIL STRIKE' : ''}`);
    check(row('Vr (IAS)', r.Vr, ref.vr, 'kt'));
    check(row('V2 (IAS)', r.V2, ref.v2, 'kt'));
    check(row('Lift-off IAS', r.lofV, ref.vlof, 'kt'));
    check(row('Ground roll', r.lofX, ref.toRoll, 'm'));
    check(row('Distance to 35 ft', r.x35, ref.to35, 'm'));
    check(row('Initial climb (gear up)', r.climb, ref.climb, 'fpm'));
    row('Max pitch', r.maxPitch, null, 'deg', 1);
  }
  if (!onlyTest || onlyTest === 'ldg') {
    const r = landing(id, ref, { autobrake: null });
    console.log(` Landing  ${(r.mass / 1000).toFixed(1)} t, full flaps, max manual braking${ac.engines.type !== 'piston' ? ' + reversers' : ''}${r.crashed ? '  CRASH: ' + r.crashed : ''}`);
    check(row('Vref', r.vref, ref.vref, 'kt'));
    row('Touchdown IAS', r.tdV, null, 'kt'); row('Touchdown sink', r.tdFpm, null, 'fpm');
    check(row('Ground roll (max brake)', r.roll, ref.ldgRoll, 'm'));
    check(row('Landing dist. from 50 ft', r.total, ref.ldgDist, 'm'));
    row('Peak decel', r.maxDecel, null, 'g', 2);
    if (!ac.engines.type.includes('piston')) {
      for (const ab of getAircraft(id) && make(id).fm.tune.ab ? ['LO', 'MED', 'MAX'] : []) {
        const a = landing(id, ref, { autobrake: ab });
        row(`Autobrake ${ab} ground roll`, a.roll, ref.ab?.[ab], 'm');
      }
      const w = landing(id, ref, { autobrake: null, wet: true });
      row('Wet rwy ground roll (max)', w.roll, null, 'm');
    }
  }
  if (!onlyTest || onlyTest === 'crz') {
    const r = cruise(id, ref);
    console.log(` Cruise  ${(r.mass / 1000).toFixed(1)} t at FL${Math.round(ref.crzAlt / 100)}, AP ALT + A/T`);
    if (ac.perf.cruiseMach) check(row('Mach', r.mach, ac.perf.cruiseMach, '', 3)); else check(row('TAS', r.tas, ac.perf.cruiseKtas, 'kt'));
    check(row('Fuel burn (total)', r.burn, ref.burn, 'kg/h'));
    row('N1 / power', r.n1, ref.crzN1, '%', 1);
    row('Alpha (body)', r.alpha, null, 'deg', 1);
    row('Altitude held', r.alt, ref.crzAlt, 'ft');
  }
  if (!onlyTest || onlyTest === 'spool') {
    const r = spool(id, ref);
    console.log(' Engine spool (ground idle -> TOGA, static)');
    check(row('Time to 95% thrust', r.t95, ref.spool, 's', 1));
    row('Idle N1', r.nIdle, ref.idleN1, '%', 1);
    row('Static max thrust/eng', r.tMax / 1000, ac.engines.thrust || null, 'kN', 1);
  }
  if (!onlyTest || onlyTest === 'stall') {
    const r = stall(id, ref);
    console.log(` Stall, clean, idle${r.fbw ? ' (FBW normal law, full aft stick)' : ' (direct law, slow decel)'}`);
    check(row('Vs1g (calc)', r.vs1, ref.vs1, 'kt'));
    row('Stall warning IAS', r.warnIas, null, 'kt');
    row('Stall (CL break) IAS', r.stallIas, null, 'kt');
    row('Min IAS', r.minIas, null, 'kt');
    row('Max alpha', r.maxAlpha, null, 'deg', 1);
    row('Alpha stall', r.alphaStall, null, 'deg', 1);
    row('Max bank in stall', r.maxRoll, r.fbw ? 'held level' : 'wing drop', 'deg', 1);
    row('Buffet peak', r.buffet, null, '', 2);
  }
  if (!onlyTest || onlyTest === 'xwind') {
    const r = xwind(id, ref);
    console.log(' Crosswind take-off roll from the right, no rudder');
    row('Heading change', r.hdgChange, 'into wind (+)', 'deg', 1);
  }
  if (!onlyTest || onlyTest === 'auto') {
    const r = autoland(id, ref);
    console.log(` LNAV/VNAV route + ILS autoland${r.crashed ? '  CRASH: ' + r.crashed : ''}`);
    row('Touchdown sink', r.td?.fpm, ref.autoTd || [60, 400], 'fpm');
    row('Touchdown past threshold', r.td?.x, [150, 700], 'm');
    row('Centreline error at TD', r.td?.xte, null, 'm', 1);
    row('Stopped', r.stopX != null ? 1 : 0, 1, '');
    check(r.td && !r.crashed && r.stopX != null);
    if (process.env.VERBOSE) console.log(r.msgs.join('\n'));
  }
  if (onlyTest === 'sys' || (!onlyTest && process.env.SYS)) {
    const r = systemsTest(id, ref);
    console.log(' Systems: cold & dark -> engines running');
    console.log('  cold:', JSON.stringify(r.cold), 'apu:', JSON.stringify(r.apu));
    for (const s of r.starts) console.log('  start', JSON.stringify(s));
    if (process.env.VERBOSE) console.log(r.log);
  }
}
console.log(`\n${fails ? fails + ' check(s) outside tolerance' : 'all checks within tolerance'}`);
