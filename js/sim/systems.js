// Aircraft systems: electrics, APU, bleed air, engine start / shutdown (N2, fuel, light-off, EGT),
// fuel tanks and feed, hydraulics, external lights, cabin signs, autobrake (LO/MED/MAX/RTO),
// alpha floor, master caution / warning alerts and optional failures.
//
// The flight model calls three hooks (all optional):
//   systems.engineOff(e, i, dt, atm, V)  every sub-step for an engine that is not running
//   systems.burn(i, kg)                  fuel used by engine i; false = no fuel reaches it
//   systems.autobrakeCmd(dt)             brake demand 0..1 from the autobrake
// and reads fm.hyd / fm.lawDegraded / fm.gearJam / fm.gearAltExt / fm.runwayWet set here.
import { clamp, lerp, KT, D2R, R2D } from './math.js';

export const AUTOBRAKE_LEVELS = ['OFF', 'LO', 'MED', 'MAX', 'RTO'];
export const LIGHTS = ['nav', 'beacon', 'strobe', 'landing', 'taxi', 'logo', 'wing'];

// start-sequence characteristics by engine type
const START = {
  // motoring max, fuel-on N2, starter cut-out, ignition delay, accel constant, peak EGT, idle EGT
  turbofan: { motor: 28, fuelAt: 25, cutout: 56, ign: 3, k: 0.11, peak: 640, n1Lag: 20 },
  turboprop: { motor: 24, fuelAt: 13, cutout: 45, ign: 2, k: 0.16, peak: 780, n1Lag: 10 },
  piston: { motor: 9, fuelAt: 9, cutout: 0, ign: 1.2, k: 2.5, peak: 650, n1Lag: 0 },
};
const PEAK_EGT = { 'GE90-115B': 600, 'RR Trent 900 / EA GP7200': 560, 'CFM LEAP-1A / PW1100G': 660, 'CFM56-7B27': 650 };

export class Systems {
  constructor(fm) {
    this.fm = fm; fm.systems = this;
    const ac = fm.ac;
    this.kind = fm.isGA ? 'ga' : ac.engines.type === 'turboprop' ? 'turboprop' : 'jet';
    this.brand = fm.isGA ? 'ga' : fm.lawType === 'airbus' || ac.maker === 'Airbus' ? 'airbus' : 'boeing';
    const n = fm.engines.length;
    // APU: jets and the Q400; ATR 72 uses "hotel mode" (No. 2 engine with the prop brake) -> ground power here
    this.hasApu = this.kind === 'jet' || ac.id === 'dash8-400';
    this.abAvail = !!fm.tune.ab;
    this.abTargets = fm.tune.ab || {};
    this.elec = { battery: true, extPower: false, ac: true, dc: true, charge: 1, genOn: Array(n).fill(true), apuGen: true };
    this.apu = { master: false, n: 0, egt: 15, avail: false, bleed: false, state: 'off', t: 0, door: 0 };
    this.lights = { nav: true, beacon: true, strobe: false, landing: false, taxi: false, logo: true, wing: false };
    this.signs = { seatbelt: true, noSmoking: true };
    this.engBleed = Array(n).fill(true);
    this.eng = fm.engines.map(() => ({ phase: 'run', fuelOn: true, lit: true, starter: false, t: 0, fail: null, fire: false, handle: false, bottle: 0 }));
    this.autostart = null;
    this.autobrake = 'OFF'; this.abActive = false; this.abCmd = 0; this.abDecel = 0; this.abGs = null; this.rtoActive = false;
    this.runwayWet = false;
    this.fuelPumps = true; this.crossfeed = false;
    this.buildTanks();
    this.buildHydraulics();
    this.failures = { hyd: {}, gear: false, elec: false, random: null };
    this.alerts = []; this.ackd = new Set(); this.masterWarn = false; this.masterCaution = false;
    this.events = []; this.onEvent = null;
    this.time = 0; this.wasAirborne = false;
  }

  emit(type, data = {}) { const ev = { type, ...data }; this.events.push(ev); if (this.onEvent) this.onEvent(ev); }
  msg(text, kind = '') { this.emit('msg', { text, kind }); }

  // ------------------------------------------------------------------ fuel
  buildTanks() {
    const fm = this.fm, n = fm.engines.length, cap = fm.ac.fuel;
    if (this.kind !== 'jet') this.tanks = [{ id: 'L', name: 'LEFT', cap: cap / 2, q: 0 }, { id: 'R', name: 'RIGHT', cap: cap / 2, q: 0 }];
    else {
      // wing (main) tanks hold roughly 3/4 of the fuel on most airliners; the centre tank the rest
      const wing = cap * (n === 4 ? 0.4 : 0.36);
      this.tanks = [{ id: 'L', name: n === 4 ? 'L WING' : 'MAIN 1', cap: wing, q: 0 }, { id: 'C', name: 'CTR', cap: cap - 2 * wing, q: 0 }, { id: 'R', name: n === 4 ? 'R WING' : 'MAIN 2', cap: wing, q: 0 }];
    }
    this.distributeFuel(fm.fuel);
  }
  distributeFuel(total) {
    // fill the wing tanks first, then the centre
    let rest = Math.max(0, total);
    for (const t of this.tanks) t.q = 0;
    const wings = this.tanks.filter((t) => t.id !== 'C');
    const each = Math.min(rest / wings.length, wings[0].cap);
    for (const t of wings) t.q = each;
    rest -= each * wings.length;
    const c = this.tanks.find((t) => t.id === 'C');
    if (c) c.q = Math.min(c.cap, rest);
    this.fm.fuel = this.totalFuel();
  }
  totalFuel() { return this.tanks.reduce((s, t) => s + t.q, 0); }
  tank(id) { return this.tanks.find((t) => t.id === id); }
  feedSide(i) { const n = this.fm.engines.length; return n === 1 ? null : i < n / 2 ? 'L' : 'R'; }
  // draw fuel for engine i; centre tank pumps override the wing pumps while it holds fuel
  burn(i, kg) {
    if (kg <= 0) return true;
    const st = this.eng[i];
    if (st && !st.fuelOn) return false;
    const c = this.tank('C');
    let src = null;
    if (c && c.q > 1 && this.fuelPumps) src = c;
    else {
      const side = this.feedSide(i);
      if (side == null) src = this.tanks.reduce((a, b) => (b.q > a.q ? b : a));
      else {
        const own = this.tank(side), other = this.tank(side === 'L' ? 'R' : 'L');
        src = own.q > 0.5 ? own : this.crossfeed && other.q > 0.5 ? other : null;
      }
    }
    if (!src || src.q <= 0) {
      if (st && st.phase === 'run') { st.phase = 'off'; st.fuelOn = false; st.lit = false; this.msg(`ENGINE ${i + 1} FLAMEOUT — fuel starvation`, 'bad'); }
      return false;
    }
    src.q = Math.max(0, src.q - kg);
    this.fm.fuel = this.totalFuel();
    return true;
  }

  // ------------------------------------------------------------------ hydraulics
  buildHydraulics() {
    const n = this.fm.engines.length, id = this.fm.ac.id, fam = this.fm.ac.family;
    const edp = (e) => ({ type: 'edp', eng: e, on: true }), elec = () => ({ type: 'elec', on: true });
    if (this.kind === 'ga') { this.hyd = []; this.hydRole = {}; return; }
    if (n === 1) {
      // single-engine jet (F-16): two engine-driven systems A and B, electric backup on B
      this.hyd = [{ id: 'A', name: 'SYS A', pumps: [edp(0)] }, { id: 'B', name: 'SYS B', pumps: [edp(0), elec()] }];
      this.hydRole = { gear: ['B'], flaps: ['A', 'B'], brakes: ['B'], altBrakes: ['A'], nws: ['B'] };
    } else if (this.brand === 'airbus' && n === 2) {
      this.hyd = [{ id: 'G', name: 'GREEN', pumps: [edp(0)] }, { id: 'B', name: 'BLUE', pumps: [elec()] }, { id: 'Y', name: 'YELLOW', pumps: [edp(1), elec()] }];
      this.hydRole = { gear: ['G'], flaps: ['G', 'Y'], brakes: ['G'], altBrakes: ['Y'], nws: ['Y'] };
    } else if (n === 4) {
      this.hyd = this.brand === 'airbus'
        ? [{ id: 'G', name: 'GREEN', pumps: [edp(0), edp(1)] }, { id: 'Y', name: 'YELLOW', pumps: [edp(2), edp(3)] }]
        : [1, 2, 3, 4].map((k) => ({ id: String(k), name: 'SYS ' + k, pumps: [edp(k - 1), elec()] }));
      this.hydRole = this.brand === 'airbus' ? { gear: ['G'], flaps: ['G', 'Y'], brakes: ['G'], altBrakes: ['Y'], nws: ['G'] } : { gear: ['1', '4'], flaps: ['1'], brakes: ['4'], altBrakes: ['1', '2'], nws: ['1'] };
    } else if (/777|787|767/.test(fam) || id.startsWith('b777') || id.startsWith('b787')) {
      this.hyd = [{ id: 'L', name: 'LEFT', pumps: [edp(0), elec()] }, { id: 'C', name: 'CENTER', pumps: [elec(), elec()] }, { id: 'R', name: 'RIGHT', pumps: [edp(1), elec()] }];
      this.hydRole = { gear: ['C'], flaps: ['C'], brakes: ['R'], altBrakes: ['C'], nws: ['C'] };
    } else if (this.kind === 'turboprop') {
      this.hyd = [{ id: 'B', name: 'BLUE', pumps: [elec()] }, { id: 'G', name: 'GREEN', pumps: [elec()] }];
      this.hydRole = { gear: ['G'], flaps: ['B'], brakes: ['G'], altBrakes: ['B'], nws: ['B'] };
    } else {
      // Boeing narrow-body / regional: A + B (+ standby)
      this.hyd = [{ id: 'A', name: 'SYS A', pumps: [edp(0), elec()] }, { id: 'B', name: 'SYS B', pumps: [edp(1), elec()] }];
      this.hydRole = { gear: ['A'], flaps: ['B'], brakes: ['B'], altBrakes: ['A'], nws: ['A'] };
    }
    for (const h of this.hyd) h.press = 3000;
  }
  hydOk(roles) { return (roles || []).some((id) => { const h = this.hyd.find((x) => x.id === id); return h && h.press > 1500; }); }
  updateHydraulics(dt) {
    const fm = this.fm;
    for (const h of this.hyd) {
      const failed = this.failures.hyd[h.id] || this.failures.hyd.all;
      const pumping = !failed && h.pumps.some((p) => p.on && (p.type === 'edp' ? (fm.engines[p.eng] || fm.engines[0]).n2 > 40 : this.elec.ac));
      h.press += ((pumping ? 3000 : 0) - h.press) * Math.min(1, dt * (pumping ? 2 : 0.6));
    }
    if (this.kind === 'ga') { fm.hyd = { ctl: 1, gear: true, flaps: 1, brakes: 1, nws: true, spoilers: 1 }; return; }
    const nPress = this.hyd.filter((h) => h.press > 1500).length;
    const R = this.hydRole;
    const brakes = this.hydOk(R.brakes) || this.hydOk(R.altBrakes) ? 1 : 0.45; // accumulator only
    fm.hyd = {
      ctl: nPress >= 1 ? 1 : 0.35, // manual reversion / mechanical backup
      gear: this.hydOk(R.gear),
      flaps: this.hydOk(R.flaps) ? 1 : (this.brand === 'boeing' && this.elec.ac ? 0.12 : 0), // alternate (electric) flaps
      brakes, nws: this.hydOk(R.nws), spoilers: nPress >= 1 ? 1 : 0,
    };
    // Airbus: loss of two hydraulic systems -> alternate law (no hard protections)
    fm.lawDegraded = this.brand === 'airbus' && nPress <= this.hyd.length - 2;
  }

  // ------------------------------------------------------------------ switches
  set(name, v) {
    const fm = this.fm;
    if (v === undefined) v = !this.get(name);
    if (LIGHTS.includes(name)) { this.lights[name] = !!v; return; }
    switch (name) {
      case 'battery': this.elec.battery = !!v; break;
      case 'extPower':
        if (v && !(fm.onGround && fm.out.gs < 2)) { this.msg('Ground power only available when parked'); return; }
        this.elec.extPower = !!v; break;
      case 'apu':
        if (!this.hasApu) return;
        if (v && !this.elec.dc) { this.msg('APU start needs battery power'); return; }
        this.apu.master = !!v;
        if (v && (this.apu.state === 'off' || this.apu.state === 'cooldown')) { this.apu.state = 'starting'; this.apu.t = 0; this.msg('APU starting'); }
        if (!v && this.apu.state !== 'off') { this.apu.state = 'cooldown'; this.apu.t = 0; this.apu.bleed = false; this.msg(this.apu.avail ? 'APU cooling down (60 s) then shutdown' : 'APU start aborted'); }
        break;
      case 'apuBleed': this.apu.bleed = !!v && this.hasApu; break;
      case 'fuelPumps': this.fuelPumps = !!v; break;
      case 'crossfeed': this.crossfeed = !!v; break;
      case 'seatbelt': case 'noSmoking':
        if (this.signs[name] !== !!v) { this.signs[name] = !!v; if (this.elec.dc) this.emit('chime', { kind: 'pax' }); }
        break;
      case 'hydPumps': for (const h of this.hyd) for (const p of h.pumps) if (p.type === 'elec') p.on = !!v; break;
      default: break;
    }
  }
  get(name) {
    if (LIGHTS.includes(name)) return this.lights[name];
    switch (name) {
      case 'battery': return this.elec.battery; case 'extPower': return this.elec.extPower; case 'apu': return this.apu.master;
      case 'apuBleed': return this.apu.bleed; case 'fuelPumps': return this.fuelPumps; case 'crossfeed': return this.crossfeed;
      case 'seatbelt': return this.signs.seatbelt; case 'noSmoking': return this.signs.noSmoking;
      case 'hydPumps': return this.hyd.some((h) => h.pumps.some((p) => p.type === 'elec' && p.on));
      default: return false;
    }
  }
  lightOn(name) { return !!this.lights[name] && this.elec.dc; }
  cycleAutobrake(dir = 1) {
    if (!this.abAvail) { this.msg('No autobrake on this aircraft'); return this.autobrake; }
    let i = AUTOBRAKE_LEVELS.indexOf(this.autobrake);
    for (let k = 0; k < AUTOBRAKE_LEVELS.length; k++) {
      i = (i + dir + AUTOBRAKE_LEVELS.length) % AUTOBRAKE_LEVELS.length;
      const lv = AUTOBRAKE_LEVELS[i];
      if (lv === 'RTO' && !this.fm.onGround) continue; // RTO arms on the ground only
      break;
    }
    this.setAutobrake(AUTOBRAKE_LEVELS[i]);
    return this.autobrake;
  }
  setAutobrake(lv) { this.autobrake = this.abAvail ? lv : 'OFF'; this.abActive = false; this.rtoActive = false; this.abCmd = 0; }
  abLabel(lv = this.autobrake) {
    if (this.brand !== 'boeing') return lv;
    return { OFF: 'OFF', LO: '2', MED: '3', MAX: 'MAX', RTO: 'RTO' }[lv];
  }

  bleedAvailable(exceptEng = -1) {
    if (this.apu.avail && this.apu.bleed) return true;
    return this.fm.engines.some((e, k) => k !== exceptEng && e.running && e.n2 > 55 && this.engBleed[k]);
  }

  // ------------------------------------------------------------------ engines
  startEngine(i) {
    const fm = this.fm, e = fm.engines[i], st = this.eng[i];
    if (!e || e.running || st.phase === 'crank' || st.phase === 'lightoff' || st.phase === 'accel') return false;
    if (st.fail === 'seized' || st.fire || st.handle) { this.msg(`ENGINE ${i + 1} cannot be started`, 'bad'); return false; }
    if (!this.elec.dc) { this.msg('Engine start needs electrical power — battery on'); return false; }
    const windmill = !fm.onGround && e.n2 > 15;
    if (e.type !== 'piston' && !windmill && !this.bleedAvailable(i) && !(this.kind === 'turboprop' && this.elec.dc)) {
      this.msg(this.hasApu ? 'No bleed air for start — start the APU and open APU BLEED' : 'No air for start'); return false;
    }
    if (this.totalFuel() <= 0) { this.msg('No fuel'); return false; }
    st.phase = 'crank'; st.starter = !windmill; st.fuelOn = false; st.lit = false; st.t = 0; st.fail = st.fail === 'flameout' ? null : st.fail;
    this.emit('engineStart', { eng: i });
    this.msg(`Engine ${i + 1} start${windmill ? ' (windmilling relight)' : ''}`);
    return true;
  }
  shutdownEngine(i) {
    const e = this.fm.engines[i], st = this.eng[i];
    if (!e) return;
    e.running = false; st.phase = 'off'; st.fuelOn = false; st.lit = false; st.starter = false;
    this.msg(`Engine ${i + 1} fuel cut-off`);
  }
  // fire handle: shuts the engine, cuts fuel / bleed; second pull discharges the bottle
  fireHandle(i) {
    const st = this.eng[i];
    if (!st.handle) { st.handle = true; this.shutdownEngine(i); this.msg(`ENG ${i + 1} fire handle pulled`); }
    else if (st.bottle === 0) { st.bottle = 1; st.tBottle = 0; this.msg(`ENG ${i + 1} fire bottle discharged`); }
  }
  // MSFS-style auto-start: battery, APU, bleed, engines in sequence, then APU off
  autoStart() {
    if (this.fm.engines.every((e) => e.running)) { this.msg('Engines already running'); return; }
    this.autostart = { step: 0, t: 0 };
    this.msg('Auto-start sequence…', 'good');
  }
  autoShutdown() {
    this.autostart = null;
    this.fm.engines.forEach((e, i) => { if (e.running || this.eng[i].phase !== 'off') this.shutdownEngine(i); });
    this.lights.beacon = false; this.lights.strobe = false; this.lights.landing = false; this.lights.taxi = false;
    this.set('apu', false); this.elec.extPower = false;
    this.msg('Engines shut down');
  }
  runAutostart(dt) {
    const a = this.autostart; if (!a) return;
    a.t += dt;
    const fm = this.fm;
    const next = () => { a.step++; a.t = 0; };
    switch (a.step) {
      case 0: this.set('battery', true); this.fuelPumps = true; this.lights.nav = true; this.lights.logo = true; next(); break;
      case 1:
        if (!this.hasApu) { if (fm.onGround) this.elec.extPower = true; a.step = 3; break; }
        if (!this.apu.master) this.set('apu', true);
        if (this.apu.avail) { this.apu.bleed = true; next(); }
        break;
      case 2: next(); break;
      case 3: {
        this.lights.beacon = true; this.signs.seatbelt = true;
        // start the engines one at a time (Boeing / Airbus: No. 2 first)
        const order = fm.engines.map((_, k) => k).reverse();
        const busy = this.eng.some((s) => s.phase === 'crank' || s.phase === 'lightoff' || s.phase === 'accel');
        if (busy || a.t < 1.5) break;
        const k = order.find((j) => !fm.engines[j].running && this.eng[j].phase === 'off' && !this.eng[j].handle && this.eng[j].fail !== 'seized');
        if (k === undefined) { next(); break; }
        if (!this.startEngine(k)) { this.autostart = null; }
        a.t = 0;
        break;
      }
      case 4:
        if (a.t < 3) break;
        if (this.hasApu && this.apu.master) { this.apu.bleed = false; this.set('apu', false); }
        this.elec.extPower = false;
        for (const h of this.hyd) for (const p of h.pumps) p.on = true;
        this.msg('Auto-start complete — engines stable at idle', 'good');
        this.autostart = null; break;
      default: this.autostart = null;
    }
  }

  // called by the flight model each sub-step for a non-running engine
  engineOff(e, i, dt, atm, V) {
    const st = this.eng[i];
    const S = START[e.type] || START.turbofan;
    const oat = atm.T - 273.15;
    const kt = V / KT;
    const seized = st.fail === 'seized';
    // windmill speeds in flight (fan driven by ram air)
    const wmN1 = seized ? 0 : clamp((kt - 60) / 240, 0, 1) * (e.type === 'turbofan' ? 16 : e.type === 'turboprop' ? 8 : 0);
    const wmN2 = seized ? 0 : wmN1 * (e.type === 'turbofan' ? 1.3 : 1.5);
    st.t += dt;
    if (st.phase === 'crank' || st.phase === 'lightoff' || st.phase === 'accel') {
      if (!this.elec.dc && e.type === 'piston') { st.phase = 'off'; return; }
      const idle = e.n2Idle;
      if (st.phase === 'crank') {
        if (e.type === 'piston') { e.n1 += (S.motor - e.n1) * Math.min(1, dt * 4); e.n2 = e.n1; if (st.t > S.ign) { st.phase = 'accel'; st.fuelOn = true; st.lit = true; st.t = 0; this.emit('lightoff', { eng: i }); } }
        else {
          // starter (air turbine) motors the core
          const motor = st.starter ? S.motor : wmN2;
          e.n2 += (Math.max(motor, wmN2) - e.n2) * Math.min(1, dt * 0.16) + (st.starter ? dt * 0.4 : 0);
          e.n1 = Math.max(e.n1 + (wmN1 - e.n1) * dt * 0.2, clamp((e.n2 - 10) / 3.5, 0, e.idle * 0.25));
          if (e.n2 >= S.fuelAt) { st.phase = 'lightoff'; st.fuelOn = true; st.t = 0; this.emit('fuelOn', { eng: i, n2: e.n2 }); }
        }
        e.ff = 0;
      } else if (st.phase === 'lightoff') {
        // fuel and igniters on: light-off within a few seconds (EGT rise)
        e.n2 += (S.motor + 2 - e.n2) * Math.min(1, dt * 0.2) + dt * 0.3;
        e.ff = 0.03 + 0.02 * (e.maxThrust / 150000);
        if (st.t > S.ign) { st.phase = 'accel'; st.lit = true; st.t = 0; st.egtStart = e.egt; this.emit('lightoff', { eng: i }); }
      }
      if (st.phase === 'accel') {
        if (e.type === 'piston') {
          e.n1 += (e.idle + 1 - e.n1) * Math.min(1, dt * S.k); e.n2 = e.n1;
          e.egt += (380 - e.egt) * Math.min(1, dt * 0.5);
          if (e.n1 >= e.idle - 0.3) this.engineRunning(e, i);
          return;
        }
        // combustion + starter accelerate the core to idle; starter cuts out ~55 % N2
        const rate = (idle + 2.5 - e.n2) * S.k * (st.starter ? 1 : 0.85);
        e.n2 = Math.min(idle + 0.5, e.n2 + Math.max(0.25, rate) * dt);
        if (st.starter && e.n2 >= S.cutout && S.cutout > 0) { st.starter = false; this.emit('starterCut', { eng: i }); }
        e.n1 = e.idle * Math.pow(clamp((e.n2 - S.n1Lag) / (idle - S.n1Lag), 0, 1), 1.4);
        // EGT: rapid rise after light-off, peak about half way, settling at idle EGT
        const x = clamp((e.n2 - S.fuelAt) / (idle - S.fuelAt), 0, 1);
        const peak = (PEAK_EGT[this.fm.ac.engines.name] || S.peak) + (oat - 15) * 1.5;
        const idleEgt = (e.type === 'turbofan' ? 395 : 520) + (oat - 15) * 0.9;
        const tgt = x < 0.4 ? lerp(oat + 80, peak, clamp(x / 0.35, 0, 1)) : lerp(peak, idleEgt, (x - 0.4) / 0.6);
        e.egt += (tgt - e.egt) * Math.min(1, dt * 1.6);
        e.ff = lerp(0.03, 0.06 * Math.sqrt(e.maxThrust / 120000 || 1), x);
        if (e.n2 >= idle - 0.5) this.engineRunning(e, i);
      }
      return;
    }
    // stopped / running down
    e.n2 += (wmN2 - e.n2) * Math.min(1, dt * (e.type === 'piston' ? 1.5 : 0.07));
    e.n1 += (wmN1 - e.n1) * Math.min(1, dt * (e.type === 'piston' ? 1.5 : 0.12));
    const hot = st.fire ? 900 : oat;
    e.egt += (hot - e.egt) * Math.min(1, dt * (st.fire ? 0.5 : 0.015));
    e.ff = 0;
  }
  engineRunning(e, i) {
    const st = this.eng[i];
    e.running = true; e.n1 = Math.max(e.n1, e.idle); st.phase = 'run'; st.starter = false; st.fuelOn = true; st.lit = true;
    this.elec.genOn[i] = true;
    this.emit('engineAvail', { eng: i });
    this.msg(`Engine ${i + 1} stabilised at idle`, 'good');
  }

  // ------------------------------------------------------------------ autobrake (sub-step)
  autobrakeCmd(dt) {
    const fm = this.fm;
    const gs = Math.hypot(fm.vel[0], fm.vel[1]);
    if (this.abGs == null) this.abGs = gs;
    const dec = (this.abGs - gs) / Math.max(dt, 1e-4); this.abGs = gs;
    this.abDecel += (dec - this.abDecel) * Math.min(1, dt * 6);
    if (this.autobrake === 'OFF' || !this.abAvail || fm.hyd.brakes < 0.9) { this.abCmd = 0; return 0; }
    const kt = gs / KT;
    if (this.autobrake === 'RTO') {
      // full braking if thrust levers are closed above ~85 kt (Boeing) / 72 kt (Airbus)
      if (fm.onGround && !this.rtoActive && kt > (this.brand === 'airbus' ? 72 : 85) && fm.ctl.throttle < 0.08) { this.rtoActive = true; this.emit('rto', {}); }
      if (this.rtoActive) { if (kt < 1) { this.rtoActive = false; } return 1; }
      return 0;
    }
    // landing modes: apply after main-gear touchdown with thrust at idle
    if (!this.abActive && fm.onGround && fm.groundTime > 0.4 && this.wasAirborne && fm.ctl.throttle < 0.1) { this.abActive = true; this.abCmd = 0.25; }
    if (!this.abActive) return 0;
    if (kt < 3) return 0.6; // hold to a stop
    const tgt = this.abTargets[this.autobrake] || 2;
    if (this.autobrake === 'MAX' && this.brand === 'airbus') return 1;
    // brake demand closes the loop on total deceleration (drag + reverse + brakes)
    this.abCmd = clamp(this.abCmd + (tgt - this.abDecel) * dt * 0.6, 0, 1);
    return this.abCmd;
  }

  // ------------------------------------------------------------------ failures
  fail(kind, arg) {
    const fm = this.fm;
    switch (kind) {
      case 'engine': {
        const i = arg ?? 0, st = this.eng[i];
        if (!fm.engines[i]) return;
        fm.engines[i].running = false; st.phase = 'off'; st.fuelOn = false; st.lit = false; st.fail = 'flameout';
        this.msg(`ENGINE ${i + 1} FAILURE`, 'bad'); break;
      }
      case 'engineFire': {
        const i = arg ?? 0, st = this.eng[i];
        if (!fm.engines[i]) return;
        st.fire = true; st.fail = 'fire'; st.fireT = 0;
        this.msg(`ENGINE ${i + 1} FIRE`, 'bad'); break;
      }
      case 'engineSeize': {
        const i = arg ?? 0, st = this.eng[i];
        fm.engines[i].running = false; st.phase = 'off'; st.fuelOn = false; st.lit = false; st.fail = 'seized';
        this.msg(`ENGINE ${i + 1} SEVERE DAMAGE`, 'bad'); break;
      }
      case 'hydraulic': this.failures.hyd[arg || 'all'] = true; this.msg(`HYDRAULIC ${arg && arg !== 'all' ? (this.hyd.find((h) => h.id === arg)?.name || arg) : 'ALL SYSTEMS'} FAILURE`, 'bad'); break;
      case 'gear': this.failures.gear = true; fm.gearJam = true; this.msg('LANDING GEAR JAMMED', 'bad'); break;
      case 'elec': this.failures.elec = true; this.msg('ELECTRICAL: ALL GENERATORS FAILED', 'bad'); break;
      default: break;
    }
  }
  repairAll() {
    const fm = this.fm;
    this.failures = { hyd: {}, gear: false, elec: false, random: null };
    fm.gearJam = false; fm.gearAltExt = false;
    this.eng.forEach((st) => { if (st.fail) st.fail = null; st.fire = false; st.handle = false; st.bottle = 0; });
    this.msg('All failures cleared', 'good');
  }
  scheduleRandom(minutes = 20) { this.failures.random = { at: this.time + Math.random() * minutes * 60 }; this.msg(`A random failure will occur within ${minutes} min`); }
  triggerRandom() {
    const n = this.fm.engines.length, r = Math.random();
    const e = Math.floor(Math.random() * n);
    if (r < 0.35) this.fail('engine', e); else if (r < 0.5) this.fail('engineFire', e);
    else if (r < 0.75 && this.hyd.length) this.fail('hydraulic', this.hyd[Math.floor(Math.random() * this.hyd.length)].id);
    else if (r < 0.88 && !this.fm.ac.geo.fixedGear) this.fail('gear'); else this.fail('elec');
  }
  altGearExtension() {
    const fm = this.fm;
    if (fm.ac.geo.fixedGear) return;
    if (this.failures.gear) { this.msg('Alternate extension: gear still jammed'); }
    fm.gearAltExt = true; fm.gearDown = true; this.msg('Alternate (gravity) gear extension');
  }

  // ------------------------------------------------------------------ state presets
  setState(state) {
    const fm = this.fm;
    this.state = state;
    this.autostart = null;
    const all = (v) => { for (const k of LIGHTS) this.lights[k] = v; };
    const engines = (on) => fm.engines.forEach((e, i) => {
      const st = this.eng[i];
      e.running = on; st.phase = on ? 'run' : 'off'; st.fuelOn = on; st.lit = on; st.starter = false;
      if (!on) { e.n1 = 0; e.n2 = 0; e.egt = fm.out ? fm.out.oat : 15; e.ff = 0; e.thrust = 0; } else { e.n2 = e.n2Idle; if (e.n1 < e.idle) e.n1 = e.idle; }
    });
    this.distributeFuel(fm.fuel);
    const pumps = (on) => { for (const h of this.hyd) for (const p of h.pumps) if (p.type === 'elec') p.on = on; };
    if (state === 'cold') {
      engines(false); all(false);
      this.elec.battery = false; this.elec.extPower = false; this.apu.master = false; this.apu.state = 'off'; this.apu.n = 0; this.apu.avail = false; this.apu.bleed = false;
      this.signs.seatbelt = false; this.signs.noSmoking = false; this.fuelPumps = false; pumps(false);
      fm.parkingBrake = true; fm.setFlapIndex(0); fm.flap = 0; fm.slat = 0; fm.ctl.throttle = 0; fm.spoilersArmed = false;
      this.setAutobrake('OFF');
      for (const h of this.hyd) h.press = 0;
    } else {
      engines(true);
      this.elec.battery = true; this.elec.extPower = false; this.apu.master = false; this.apu.state = 'off'; this.apu.n = 0; this.apu.avail = false; this.apu.bleed = false;
      this.fuelPumps = true; pumps(true);
      this.signs.seatbelt = true; this.signs.noSmoking = true;
      all(false); this.lights.nav = true; this.lights.beacon = true; this.lights.logo = true;
      if (state === 'taxi') { this.lights.taxi = true; this.setAutobrake('OFF'); }
      if (state === 'runway') { this.lights.strobe = true; this.lights.landing = true; this.lights.taxi = true; this.setAutobrake(this.abAvail ? 'RTO' : 'OFF'); }
      if (state === 'air') { this.lights.strobe = true; this.lights.landing = fm.out ? fm.out.alt < 10000 : true; this.setAutobrake('OFF'); this.wasAirborne = true; }
      for (const h of this.hyd) h.press = 3000;
    }
    this.alerts = []; this.ackd.clear(); this.masterWarn = this.masterCaution = false;
    this.updateElectrics(0); this.updateHydraulics(1);
  }

  // ------------------------------------------------------------------ per-frame update
  updateElectrics(dt) {
    const fm = this.fm, E = this.elec;
    if (E.extPower && !(fm.onGround && fm.out.gs < 3)) { E.extPower = false; this.msg('Ground power disconnected'); }
    const genEng = fm.engines.some((e, i) => e.running && e.n2 > 50 && E.genOn[i]) && !this.failures.elec;
    const apuGen = this.apu.avail && E.apuGen && !this.failures.elec;
    E.ac = E.battery && (E.extPower || apuGen || genEng || (this.kind === 'ga' && genEng));
    if (this.kind === 'ga') E.ac = E.battery && E.charge > 0.02; // GA: battery bus powers everything; alternator charges
    // battery: ~40 min on its own, recharges when a generator is on line
    const charging = E.extPower || apuGen || genEng;
    if (E.battery) E.charge = clamp(E.charge + dt * (charging ? 1 / 600 : -1 / 2400), 0, 1);
    E.dc = E.battery && E.charge > 0.02;
  }
  updateApu(dt) {
    const A = this.apu;
    if (!this.hasApu) return;
    A.t += dt;
    if (A.state === 'starting') {
      if (!this.elec.dc) { A.state = 'off'; A.master = false; return; }
      A.door = Math.min(1, A.door + dt / 3);
      if (A.door >= 1) A.n = Math.min(100, A.n + dt * (A.n < 20 ? 2.2 : 3.4)); // ~45 s to 100 %
      const x = A.n / 100;
      A.egt += ((x < 0.45 ? lerp(15, 720, x / 0.45) : lerp(720, 420, (x - 0.45) / 0.55)) - A.egt) * Math.min(1, dt * 1.5);
      if (A.n >= 95 && !A.avail) { A.avail = true; A.state = 'run'; this.emit('apuAvail', {}); this.msg('APU AVAIL', 'good'); }
    } else if (A.state === 'run') {
      A.n += (100 - A.n) * Math.min(1, dt); A.egt += (420 + (A.bleed ? 120 : 0) - A.egt) * Math.min(1, dt * 0.5);
      // APU fuel (~ 110 kg/h narrow-body, ~250 kg/h wide-body), from the left / centre tank
      const t = this.tank('C')?.q > 0 ? this.tank('C') : this.tanks[0];
      t.q = Math.max(0, t.q - dt * (this.fm.engines.length > 2 || this.fm.ac.mtow > 200000 ? 0.07 : 0.03)); this.fm.fuel = this.totalFuel();
    } else if (A.state === 'cooldown') {
      A.bleed = false;
      if (A.t > (A.avail ? 60 : 0)) { A.avail = false; A.n = Math.max(0, A.n - dt * 4); A.egt += (15 - A.egt) * dt * 0.05; if (A.n <= 0) { A.state = 'off'; A.door = 0; this.emit('apuOff', {}); } }
    } else { A.n = Math.max(0, A.n - dt * 4); A.egt += (15 - A.egt) * dt * 0.02; A.door = Math.max(0, A.door - dt / 3); }
  }
  computeAlerts() {
    const fm = this.fm, o = fm.out, out = [];
    const W = (id, text) => out.push({ id, text, level: 'warning' }), C = (id, text) => out.push({ id, text, level: 'caution' });
    const air = !fm.onGround;
    fm.engines.forEach((e, i) => {
      const st = this.eng[i];
      if (st.fire) W('fire' + i, `ENG ${i + 1} FIRE`);
      if (air && !e.running && (st.phase === 'off')) C('eng' + i, `ENG ${i + 1} ${st.fail === 'seized' ? 'FAIL' : 'FLAMEOUT'}`);
      if (e.running && e.egt > (e.type === 'turbofan' ? 1060 : 1000)) C('egt' + i, `ENG ${i + 1} EGT OVERLIMIT`);
    });
    for (const h of this.hyd) if (h.press < 1500 && (fm.engines.some((e) => e.running) || air)) C('hyd' + h.id, `HYD ${h.name} PRESS`);
    if (this.failures.elec && air) C('elec', 'ELEC GEN FAULT · BAT ONLY');
    else if (this.elec.battery && !this.elec.ac && this.kind !== 'ga' && (fm.engines.some((e) => e.running) || this.apu.master)) C('bat', 'ELEC BAT DISCHARGE');
    const lowFuel = Math.max(fm.ac.fuel * 0.06, fm.ac.mtow * 0.008);
    if (fm.fuel < lowFuel) C('fuel', 'FUEL LOW');
    const L = this.tank('L'), R = this.tank('R');
    if (L && R && Math.abs(L.q - R.q) > Math.max(400, L.cap * 0.15)) C('imbal', 'FUEL IMBALANCE');
    // configuration warnings
    if (fm.onGround && fm.ctl.throttle > 0.7 && !fm.reversers && o.gs < 80) {
      const fl = fm.flapIndex, nfl = fm.flapLevels.length;
      if (!fm.isGA && (fl === 0 || fl >= nfl - 1)) W('cfgFlap', 'CONFIG FLAPS');
      if (fm.parkingBrake) W('cfgPark', 'CONFIG PARK BRK');
      if (fm.spoilerHandle > 0.1) W('cfgSpd', 'CONFIG SPD BRK');
      if (!fm.isGA && Math.abs(fm.trim) > 0.6) W('cfgTrim', 'CONFIG PITCH TRIM');
    }
    if (air && !fm.ac.geo.fixedGear && fm.gearPos < 0.98 && o.agl < 800 && (fm.flapIndex >= fm.flapLevels.length - 2 || (fm.ctl.throttle < 0.15 && o.agl < 500))) W('gear', 'GEAR NOT DOWN');
    if (fm.gearJam && fm.gearDown !== (fm.gearPos > 0.5)) W('gearDis', 'GEAR DISAGREE');
    if (air && o.stall) W('stall', 'STALL');
    if (o.ias > fm.ac.perf.vmo + 6 || (fm.ac.perf.mmo && o.mach > fm.ac.perf.mmo + 0.01)) W('ovspd', 'OVERSPEED');
    if (fm.lawDegraded && air) C('law', 'F/CTL ALTN LAW');
    if (this.autobrake !== 'OFF' && fm.hyd.brakes < 0.9) C('ab', 'AUTOBRAKE FAULT');
    if (!fm.hyd.nws && fm.onGround && this.kind !== 'ga' && fm.engines.some((e) => e.running)) C('nws', 'NOSE WHEEL STEERING');
    if (this.apu.state === 'starting' && this.apu.t > 120) C('apu', 'APU FAULT');
    return out;
  }

  update(dt) {
    const fm = this.fm;
    if (!fm.out) return;
    this.time += dt;
    this.runwayWet = !!fm.runwayWet;
    if (!fm.onGround && fm.airTime > 3) this.wasAirborne = true;
    if (fm.onGround && fm.out.gs < 3) this.wasAirborne = false;
    this.runAutostart(dt);
    this.updateApu(dt);
    this.updateElectrics(dt);
    this.updateHydraulics(dt);
    // engine fire: burns until the bottle is discharged (a few seconds after)
    this.eng.forEach((st, i) => {
      if (st.fire) { st.fireT = (st.fireT || 0) + dt; if (st.bottle) { st.tBottle += dt; if (st.tBottle > 4) { st.fire = false; this.msg(`ENG ${i + 1} fire extinguished`, 'good'); } } }
      // electrical starter / ignition need DC
      if ((st.phase === 'crank' || st.phase === 'lightoff') && !this.elec.dc) { st.phase = 'off'; st.starter = false; this.msg(`Engine ${i + 1} start aborted — no power`); }
      // hung start: no bleed air while cranking on the ground
      if (st.phase === 'crank' && st.starter && !this.bleedAvailable(i) && this.kind === 'jet' && fm.onGround) { st.phase = 'off'; st.starter = false; this.msg(`Engine ${i + 1} start aborted — bleed air lost`); }
    });
    // RTO disarms after lift-off; landing autobrake disarms on thrust advance or pedal braking
    if (this.autobrake === 'RTO' && !fm.onGround && fm.airTime > 1) { this.setAutobrake('OFF'); this.emit('abDisarm', { quiet: true }); }
    if (this.abActive && fm.onGround && (fm.ctl.brakeL > 0.5 || fm.ctl.throttle > 0.3 && !fm.reversers)) { this.setAutobrake('OFF'); this.msg('AUTOBRAKE DISARM'); this.emit('abDisarm', {}); }
    if (this.abActive && fm.onGround && fm.out.gs < 2) { this.setAutobrake('OFF'); this.msg('Autobrake off — stopped'); }
    // Airbus alpha floor: automatic TOGA thrust at very high alpha in normal law
    if (fm.lawType === 'airbus' && !fm.lawDegraded && !fm.onGround && fm.air && fm.alphaStall && fm.air.alpha > fm.alphaStall - 2.2 * D2R && fm.out.agl > 100) {
      if (!this.aFloor) { this.aFloor = true; this.msg('A.FLOOR — TOGA thrust', 'bad'); }
      fm.ctl.throttle = 1;
    } else if (this.aFloor && fm.air && fm.air.alpha < fm.alphaStall - 5 * D2R) { this.aFloor = false; this.msg('TOGA LK — reduce thrust when safe'); }
    // random failure
    if (this.failures.random && this.time >= this.failures.random.at && !fm.onGround) { this.failures.random = null; this.triggerRandom(); }
    // alerts and master caution / warning
    const alerts = this.computeAlerts();
    const ids = new Set(alerts.map((a) => a.id));
    for (const id of [...this.ackd]) if (!ids.has(id)) this.ackd.delete(id);
    const fresh = alerts.filter((a) => !this.ackd.has(a.id));
    const warn = fresh.some((a) => a.level === 'warning'), caut = fresh.some((a) => a.level === 'caution');
    if (warn && !this.masterWarn) this.emit('chime', { kind: alerts.some((a) => a.id.startsWith('fire') && !this.ackd.has(a.id)) ? 'fire' : 'warning' });
    else if (caut && !this.masterCaution && !this.prevIds?.has(fresh.find((a) => a.level === 'caution').id)) this.emit('chime', { kind: 'caution' });
    this.masterWarn = warn && this.elec.dc; this.masterCaution = caut && this.elec.dc;
    this.alerts = alerts; this.prevIds = ids;
  }
  // pilot presses the flashing master caution / warning light
  acknowledge() { for (const a of this.alerts) this.ackd.add(a.id); this.masterWarn = false; this.masterCaution = false; this.emit('ack', {}); }

  // ------------------------------------------------------------------ summary for UI / checklists
  get enginesRunning() { return this.fm.engines.filter((e) => e.running).length; }
  get allEnginesRunning() { return this.fm.engines.every((e) => e.running); }
}
