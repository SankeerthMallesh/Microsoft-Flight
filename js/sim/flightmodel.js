// 6-DOF rigid-body flight model.
// Frames: NED world (x north, y east, z down); body (x forward, y right, z down).
import { deriveAero } from '../data/aircraft.js';
import {
  D2R, R2D, KT, FT, G0, clamp, lerp, qmul, qnorm, qrot, qrotInv, eulerToQuat, quatToEuler, cross, add, scale, dot, radii, isa, wrapPi,
} from './math.js';

export class Engine {
  constructor(ac, pos) {
    this.type = ac.engines.type;
    this.pos = pos; // body coords
    this.maxThrust = (ac.engines.thrust || 0) * 1000;
    this.maxPower = (ac.engines.power || 0) * 1000;
    this.idle = this.type === 'turbofan' ? 21 : this.type === 'turboprop' ? 62 : 25;
    this.n1 = this.idle; this.running = true;
    this.thrust = 0; this.ff = 0; this.egt = 400; this.reverse = 0;
  }
}

export class FlightModel {
  constructor(ac, phys, opts = {}) {
    this.ac = ac; this.phys = phys;
    this.aero = deriveAero(ac);
    this.S = ac.wingArea; this.b = ac.span; this.c = this.aero.mac;
    this.isGA = ac.category === 'General aviation';
    this.isJet = ac.engines.type === 'turbofan';
    // model (x fwd, y left, z up) -> body (x fwd, y right, z down)
    const toBody = (p) => [p[0], -p[1], -p[2]];
    this.gear = phys.gear.map((g) => ({ ...g, rb: toBody([g.x, g.y, g.z]), comp: 0, onGround: false }));
    this.strikes = phys.strikes.map((s) => ({ ...s, rb: toBody([s.x, s.y, s.z]) }));
    const engPos = phys.engines.length ? phys.engines : [{ x: 0, y: 0, z: 0 }];
    this.engines = engPos.map((e) => new Engine(ac, toBody([e.x, e.y, e.z])));
    // aero/stability derivatives
    const ga = this.isGA;
    this.d = {
      Clb: -0.09, Clp: ga ? -0.5 : -0.45, Clr: 0.12, Clda: ga ? 0.14 : 0.075, Cldr: 0.012,
      Cma: ga ? -0.9 : -1.15, Cmq: ga ? -12 : -24, Cmde: ga ? 1.2 : 1.1, Cmflap: -0.1, Cmgear: 0.004, a0: 2 * D2R,
      Cnb: ga ? 0.07 : 0.12, Cnr: ga ? -0.1 : -0.17, Cnp: -0.03, Cndr: ga ? 0.075 : 0.085, Cnda: -0.006, CYb: -0.9,
    };
    this.Ixx = ac.mtow * this.aero.kx ** 2; this.Iyy = ac.mtow * this.aero.ky ** 2; this.Izz = ac.mtow * this.aero.kz ** 2;
    this.flapLevels = ac.flaps;
    this.reset(opts);
  }

  reset(o = {}) {
    this.lat = o.lat || 0; this.lon = o.lon || 0; this.h = o.h || 0;
    this.vel = o.vel || [0, 0, 0]; // NED m/s
    this.q = o.q || eulerToQuat(o.heading || 0, o.pitch || 0, 0);
    this.w = [0, 0, 0];
    this.fuel = o.fuel ?? this.ac.fuel * 0.4;
    this.payload = o.payload ?? (this.ac.mtow - this.ac.oew - this.ac.fuel * 0.4) * 0.6;
    this.updateMass();
    this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: o.throttle ?? 0, brakeL: 0, brakeR: 0, tiller: 0 };
    this.surf = { de: 0, da: 0, dr: 0 };
    this.trim = o.trim ?? 0;
    this.flapIndex = o.flapIndex ?? 0; this.flap = this.flapLevels[this.flapIndex].flap; this.slat = this.flapLevels[this.flapIndex].slat;
    this.gearDown = o.gearDown ?? true; this.gearPos = this.gearDown ? 1 : 0;
    this.spoilerHandle = 0; this.spoilersArmed = false; this.spoiler = 0;
    this.reversers = false; this.parkingBrake = !!o.parkingBrake;
    this.groundH = o.groundH ?? 0; this.geoid = o.geoid ?? 0;
    this.wind = o.wind || [0, 0, 0]; this.turb = o.turbulence || 0; this.gust = [0, 0, 0];
    this.dT = o.dT || 0;
    this.onGround = false; this.wow = 0; this.airTime = 0; this.groundTime = 0; this.time = 0;
    this.crashed = null; this.events = [];
    this.fbwRef = { pitch: null, roll: 0 };
    this.lastVs = 0; this.nz = 1; this.maxComp = 0;
    for (const e of this.engines) { e.n1 = o.n1 ?? e.idle; e.reverse = 0; }
    this.calcOutputs(isa(this.h - this.geoid, this.dT), [0, 0, 0]);
  }

  updateMass() { this.mass = this.ac.oew + this.payload + this.fuel; }

  setFlapIndex(i) { this.flapIndex = clamp(i, 0, this.flapLevels.length - 1); }
  get flapLabel() { return this.flapLevels[this.flapIndex].label; }

  emit(type, data) { this.events.push({ type, ...data }); }

  // ---------------------------------------------------------------------------
  step(dt, env) {
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.substep(h, env);
  }

  substep(dt, env) {
    if (this.crashed) return;
    this.time += dt;
    const ac = this.ac, A = this.aero, d = this.d;
    const atm = isa(this.h - this.geoid, this.dT);
    const euler = quatToEuler(this.q);
    this.euler = euler;

    // ----- systems: flaps, gear, spoilers
    const fl = this.flapLevels[this.flapIndex];
    const fRate = dt / (this.isGA ? 4 : 9);
    this.flap += clamp(fl.flap - this.flap, -fRate, fRate);
    this.slat += clamp(fl.slat - this.slat, -fRate * 2, fRate * 2);
    if (!ac.geo.fixedGear) this.gearPos = clamp(this.gearPos + (this.gearDown ? 1 : -1) * dt / (this.isGA ? 5 : 8), 0, 1);
    let spTarget = this.spoilerHandle;
    if (this.spoilersArmed && this.onGround && this.ctl.throttle < 0.1 && this.groundTime > 0.3) spTarget = 1;
    this.spoiler += clamp(spTarget - this.spoiler, -dt * 1.5, dt * 1.5);

    // ----- turbulence (filtered noise)
    if (this.turb > 0) {
      const k = Math.min(1, dt * 0.8);
      const agl = Math.max(0, this.agl);
      const sig = this.turb * 4 * (agl < 300 ? 0.5 + agl / 600 : 1);
      for (let j = 0; j < 3; j++) this.gust[j] += k * ((Math.random() * 2 - 1) * sig * (j === 2 ? 0.6 : 1) * 3 - this.gust[j]);
    }
    const windNED = add(this.wind, this.gust);

    // ----- air data
    const vAir = [this.vel[0] - windNED[0], this.vel[1] - windNED[1], this.vel[2] - windNED[2]];
    const vb = qrotInv(this.q, vAir);
    const V = Math.max(0.01, Math.hypot(vb[0], vb[1], vb[2]));
    const alpha = Math.atan2(vb[2], Math.max(0.1, Math.abs(vb[0]))) * (vb[0] >= 0 ? 1 : 1);
    const beta = Math.asin(clamp(vb[1] / V, -1, 1));
    const qbar = 0.5 * atm.rho * V * V;
    const M = V / atm.a;
    const [p, q, r] = this.w;
    const Vd = Math.max(V, 15);
    const ph = (p * this.b) / (2 * Vd), qh = (q * this.c) / (2 * Vd), rh = (r * this.b) / (2 * Vd);

    // ----- lift
    const flap = this.flap, slat = this.slat;
    const clLin0 = A.cl0 + A.dclFlaps * flap * 0.8;
    const clmax = A.clmaxClean + A.dclFlaps * flap + A.dclSlats * slat;
    const aStall = (clmax - clLin0) / A.clAlpha;
    const aStallNeg = -(clmax * 0.75 + clLin0) / A.clAlpha;
    let CL, stall = 0;
    if (alpha <= aStall && alpha >= aStallNeg) CL = clLin0 + A.clAlpha * alpha;
    else if (alpha > aStall) {
      stall = clamp((alpha - aStall) / (4 * D2R), 0, 1);
      const post = Math.max(1.15 * Math.sin(2 * alpha), 0);
      CL = lerp(clmax, Math.max(clmax * 0.62, post), stall);
      if (alpha > 35 * D2R) CL = post;
    } else {
      stall = clamp((aStallNeg - alpha) / (4 * D2R), 0, 1);
      CL = lerp(clLin0 + A.clAlpha * aStallNeg, -0.8, stall);
    }
    this.stallFactor = stall; this.alphaStall = aStall;
    // ground effect
    const hge = Math.max(0.5, this.agl + 2);
    const ge = hge < this.b ? (16 * hge / this.b) ** 2 / (1 + (16 * hge / this.b) ** 2) : 1;
    if (hge < this.b) CL *= 1 + 0.08 * (1 - hge / this.b);
    CL -= 0.55 * this.spoiler * Math.max(0, CL) / Math.max(1, clmax) * 1.6;
    // ----- drag
    const Mcrit = A.mcrit;
    const wave = M > Mcrit ? 25 * (M - Mcrit) ** 3 + 0.6 * Math.max(0, M - Mcrit - 0.08) ** 2 : 0;
    const CD = A.cd0 + (CL * CL) / (Math.PI * A.e * A.AR) * ge + 0.075 * flap + 0.012 * slat + 0.02 * this.gearPos + 0.07 * this.spoiler + wave + 1.2 * Math.sin(alpha) ** 2 * stall + 0.3 * Math.abs(Math.sin(beta));
    const CY = d.CYb * beta;
    const Lf = qbar * this.S * CL, Df = qbar * this.S * CD, Yf = qbar * this.S * CY;
    // wind axes -> body
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    let F = [Lf * sa - Df * ca, Yf, -Lf * ca - Df * sa];

    // ----- control laws
    this.computeSurfaces(dt, { qbar, V, alpha, beta, euler, ph, qh, rh, CL, aStall });
    const { de, da, dr } = this.surf;

    // ----- moments
    const stallRoll = stall * 0.04 * Math.sin(this.time * 1.7 + 1.3) * (this.isGA ? 1 : 0.6);
    const Cl = d.Clb * beta + d.Clp * (1 - 0.6 * stall) * ph + d.Clr * rh + d.Clda * da * (1 - 0.5 * stall) + d.Cldr * dr + stallRoll - 0.02 * this.spoiler * 0;
    const Cm = d.Cma * (alpha - d.a0) + d.Cmq * qh + d.Cmde * de + d.Cmflap * flap + d.Cmgear * this.gearPos - 0.25 * stall * Math.sign(alpha);
    const Cn = d.Cnb * beta + d.Cnr * rh + d.Cnp * ph + d.Cndr * dr + d.Cnda * da;
    let Mb = [qbar * this.S * this.b * Cl, qbar * this.S * this.c * Cm, qbar * this.S * this.b * Cn];

    // ----- engines
    this.updateEngines(dt, atm, V, M);
    for (const e of this.engines) {
      const T = e.thrust;
      F[0] += T;
      Mb = add(Mb, cross(e.pos, [T, 0, 0]));
    }

    // ----- gravity
    const gB = qrotInv(this.q, [0, 0, G0 * this.mass]);
    F = add(F, gB);

    // ----- ground contact
    const gc = this.groundContact(dt);
    F = add(F, gc.F); Mb = add(Mb, gc.M);

    // ----- integrate
    const aNED = scale(qrot(this.q, F), 1 / this.mass);
    this.vel = add(this.vel, scale(aNED, dt));
    const I = [this.Ixx, this.Iyy, this.Izz];
    const Iw = [I[0] * p, I[1] * q, I[2] * r];
    const gyro = cross(this.w, Iw);
    const wdot = [(Mb[0] - gyro[0]) / I[0], (Mb[1] - gyro[1]) / I[1], (Mb[2] - gyro[2]) / I[2]];
    this.w = add(this.w, scale(wdot, dt));
    // ground: kill tiny drift
    if (this.onGround && Math.hypot(this.vel[0], this.vel[1]) < 0.05 && this.ctl.throttle < 0.05 && (this.parkingBrake || this.ctl.brakeL > 0.2)) { this.vel[0] *= 0.5; this.vel[1] *= 0.5; this.w[2] *= 0.5; }
    const dq = qmul(this.q, [0, this.w[0], this.w[1], this.w[2]]);
    this.q = qnorm([this.q[0] + 0.5 * dq[0] * dt, this.q[1] + 0.5 * dq[1] * dt, this.q[2] + 0.5 * dq[2] * dt, this.q[3] + 0.5 * dq[3] * dt]);
    const { M: Rm, N: Rn } = radii(this.lat);
    this.lat += (this.vel[0] * dt) / (Rm + this.h);
    this.lon += (this.vel[1] * dt) / ((Rn + this.h) * Math.cos(this.lat));
    this.h -= this.vel[2] * dt;

    // body load factor (specific force along -z body / g)
    const fz = -(F[2] - gB[2]) / (this.mass * G0);
    this.nz = lerp(this.nz, fz, Math.min(1, dt * 8));
    this.air = { V, alpha, beta, qbar, M, atm, CL, ge };
    this.calcOutputs(atm, windNED);
  }

  computeSurfaces(dt, s) {
    const c = this.ctl, d = this.d;
    const assisted = this.assist !== 'realistic' || (this.ap && this.ap.engaged);
    const airborne = !this.onGround && this.airTime > 1.5;
    const qS = Math.max(50, s.qbar * this.S);
    const { euler } = s;
    // yaw damper + turn coordination contribution
    let dr = c.yaw + (this.onGround ? 0 : -1.4 * s.rh * (this.isGA ? 0.3 : 1));
    let de, da;
    const apCmd = this.ap && this.ap.engaged ? this.ap.cmd : null;
    const law = (assisted && airborne) || apCmd ? 'normal' : 'direct';
    this.law = law;
    if (law === 'direct') {
      de = c.pitch + this.trim; da = c.roll;
      this.fbwRef.pitch = euler.pitch; this.fbwRef.roll = euler.roll;
    } else {
      // --- pitch: commanded Euler pitch rate -> body q via NDI
      const thMax = (this.isGA ? 10 : 4) * D2R;
      let thDot;
      if (apCmd && Math.abs(c.pitch) < 0.4) {
        thDot = clamp(1.2 * (apCmd.pitch - euler.pitch), -2.5 * D2R, 2.5 * D2R);
        this.fbwRef.pitch = euler.pitch;
      } else if (Math.abs(c.pitch) > 0.02) {
        thDot = c.pitch * thMax; this.fbwRef.pitch = euler.pitch;
        if (apCmd && Math.abs(c.pitch) > 0.4) this.ap.disconnect('pilot input');
      } else {
        if (this.fbwRef.pitch == null) this.fbwRef.pitch = euler.pitch;
        thDot = 1.0 * (this.fbwRef.pitch - euler.pitch);
      }
      // protections
      const aProt = s.aStall - 2.5 * D2R;
      if (s.alpha > aProt) thDot = Math.min(thDot, -(s.alpha - aProt) * 3);
      if (euler.pitch > 30 * D2R) thDot = Math.min(thDot, -(euler.pitch - 30 * D2R));
      if (euler.pitch < -15 * D2R) thDot = Math.max(thDot, -(euler.pitch + 15 * D2R));
      const phi = clamp(euler.roll, -1.2, 1.2);
      const qd = (thDot + this.w[2] * Math.sin(phi)) / Math.cos(phi);
      const kq = this.isGA ? 4 : 2.5;
      const cmOther = d.Cma * (s.alpha - d.a0) + d.Cmq * s.qh + d.Cmflap * this.flap;
      const cmReq = (this.Iyy * kq * (qd - this.w[1])) / (qS * this.c) - cmOther;
      de = clamp(cmReq / d.Cmde, -1, 1);
      // --- roll
      const pMax = (this.isGA ? 35 : 15) * D2R;
      let pd;
      if (apCmd && Math.abs(c.roll) < 0.4) { pd = clamp(1.0 * (apCmd.roll - euler.roll), -5 * D2R, 5 * D2R); this.fbwRef.roll = euler.roll; }
      else if (Math.abs(c.roll) > 0.02) { pd = c.roll * pMax; this.fbwRef.roll = euler.roll; if (apCmd && Math.abs(c.roll) > 0.4) this.ap.disconnect('pilot input'); }
      else {
        const lim = 33 * D2R;
        if (Math.abs(this.fbwRef.roll) < 5 * D2R && Math.abs(euler.roll) < 5 * D2R) this.fbwRef.roll = 0;
        if (Math.abs(this.fbwRef.roll) > lim) this.fbwRef.roll = Math.sign(this.fbwRef.roll) * lim;
        pd = 1.2 * (this.fbwRef.roll - euler.roll);
      }
      if (Math.abs(euler.roll) > 67 * D2R) pd = Math.min(Math.abs(pd), 0) * Math.sign(pd) - (euler.roll - Math.sign(euler.roll) * 67 * D2R) * 2;
      const kp = this.isGA ? 5 : 3;
      const clOther = d.Clb * s.beta + d.Clp * s.ph + d.Clr * s.rh;
      const clReq = (this.Ixx * kp * (pd - this.w[0])) / (qS * this.b) - clOther;
      da = clamp(clReq / d.Clda, -1, 1);
      // auto-coordination
      const rd = (G0 / Math.max(s.V, 30)) * Math.sin(euler.roll) * Math.cos(euler.pitch);
      const cnOther = d.Cnb * s.beta + d.Cnr * s.rh + d.Cnp * s.ph + d.Cnda * da;
      const cnReq = (this.Izz * 1.5 * (rd - this.w[2])) / (qS * this.b) - cnOther;
      dr = clamp(c.yaw + cnReq / d.Cndr * 0.8, -1, 1);
      // auto-trim keeps trim indicator meaningful for the EICAS
      this.trim = lerp(this.trim, clamp(de, -1, 1), dt * 0.3);
    }
    this.surf.de = lerp(this.surf.de, clamp(de, -1, 1), Math.min(1, dt * 12));
    this.surf.da = lerp(this.surf.da, clamp(da, -1, 1), Math.min(1, dt * 12));
    this.surf.dr = lerp(this.surf.dr, clamp(dr, -1, 1), Math.min(1, dt * 8));
  }

  updateEngines(dt, atm, V, M) {
    const thr = clamp(this.ctl.throttle, 0, 1);
    for (const e of this.engines) {
      if (!e.running) { e.n1 = Math.max(0, e.n1 - dt * 3); e.thrust = 0; e.ff = 0; continue; }
      const revTarget = this.reversers && this.onGround ? 1 : 0;
      e.reverse += clamp(revTarget - e.reverse, -dt / 2, dt / 2);
      const maxN1 = 100;
      let target = e.idle + thr * (maxN1 - e.idle);
      const k = e.type === 'piston' ? 3 : e.type === 'turboprop' ? 0.9 : 0.16 + 0.5 * Math.pow(e.n1 / 100, 2);
      e.n1 += (target - e.n1) * Math.min(1, k * dt);
      const f = Math.pow(clamp((e.n1 - e.idle) / (maxN1 - e.idle), 0, 1), e.type === 'turbofan' ? 2.0 : 1.3);
      let T;
      if (e.type === 'turbofan') {
        const lapse = Math.pow(atm.sigma, 0.68) * (1 - 0.62 * M + 0.42 * M * M);
        T = e.maxThrust * lapse * (0.035 + 0.965 * f);
        e.ff = T * 1.05e-5 * (1 + 0.55 * M) + 0.06;
        e.egt = 380 + 520 * Math.pow(e.n1 / 100, 2.2);
      } else {
        const lapse = e.type === 'piston' ? Math.pow(atm.sigma, 1.05) : Math.min(1, Math.pow(atm.sigma, 0.7) * 1.25);
        const P = e.maxPower * lapse * (0.06 + 0.94 * f);
        const Tstatic = e.maxPower * (e.type === 'piston' ? 0.0165 : 0.0135) * lapse * (0.06 + 0.94 * f);
        T = Math.min(Tstatic, (0.82 * P) / Math.max(V, 1));
        e.ff = P * (e.type === 'piston' ? 0.3 : 0.29) / 3.6e6 + 0.004;
        e.egt = 450 + 400 * f;
        e.power = P;
      }
      if (e.reverse > 0.01) T = lerp(T, -Math.abs(T) * (e.type === 'turbofan' ? 0.42 : 0.35), e.reverse);
      e.thrust = this.fuel > 0 ? T : 0;
      if (this.fuel <= 0) { e.running = false; this.emit('msg', { text: 'Fuel exhausted — engines flamed out' }); }
      this.fuel = Math.max(0, this.fuel - e.ff * dt);
    }
    this.updateMass();
  }

  groundContact(dt) {
    let F = [0, 0, 0], M = [0, 0, 0];
    const gH = this.groundH;
    let anyContact = false, wow = 0;
    const R = this.q;
    const heading = quatToEuler(R).yaw;
    const vSpeed = Math.hypot(this.vel[0], this.vel[1]);
    const steerMax = (this.isGA ? 30 : 70 - clamp((vSpeed / KT - 10) * 2.2, 0, 62)) * D2R;
    const mg = this.mass * G0;
    const pts = [];
    if (this.gearPos > 0.98) for (const g of this.gear) pts.push({ g, gear: true });
    for (const s of this.strikes) pts.push({ g: s, gear: false });
    for (const { g, gear } of pts) {
      const rN = qrot(R, g.rb);
      const ptAlt = this.h - rN[2];
      const pen = gH - ptAlt;
      if (pen <= (gear ? 0 : 0.05)) { if (gear) { g.comp = 0; g.onGround = false; } continue; }
      if (!gear) {
        if (g.kind === 'tail') { if (!this._tailStruck) { this._tailStruck = true; this.emit('warn', { text: 'TAIL STRIKE' }); this.emit('tailstrike', { pitch: quatToEuler(this.q).pitch * R2D }); } }
        else if (g.kind === 'wing' || g.kind === 'engine' || g.kind === 'nose') { this.crash(g.kind === 'wing' ? 'Wingtip struck the ground' : g.kind === 'engine' ? 'Engine pod struck the ground' : 'Nose impact'); return { F, M }; }
      }
      anyContact = true;
      const wB = cross(this.w, g.rb);
      const vP = add(this.vel, qrot(R, wB)); // NED velocity of contact point
      const share = gear ? (g.name === 'nose' ? 0.12 : 0.44) : 0.5;
      const k = (share * mg) / 0.12;
      const cdmp = 2 * 0.7 * Math.sqrt(k * share * this.mass);
      let Fn = k * pen + cdmp * vP[2];
      if (gear && !g.onGround) {
        g.onGround = true;
        if (!this.onGround && this.airTime > 1 && !this._tdFrame) { this._tdFrame = true; this.touchdown(vP[2]); }
      }
      Fn = clamp(Fn, 0, mg * 4);
      if (pen > (gear ? 1.1 : 0.6) && Math.abs(vP[2]) > 3) { this.crash('Structural failure on impact'); return { F, M }; }
      if (gear) { g.comp = pen; wow++; }
      // wheel direction
      let dir = heading;
      if (gear && g.steer) dir += clamp(this.ctl.tiller !== 0 ? this.ctl.tiller : this.ctl.yaw, -1, 1) * steerMax;
      const fwd = [Math.cos(dir), Math.sin(dir), 0], side = [-Math.sin(dir), Math.cos(dir), 0];
      const vl = vP[0] * fwd[0] + vP[1] * fwd[1];
      const vs = vP[0] * side[0] + vP[1] * side[1];
      let mu = gear ? 0.018 : 0.45;
      if (gear && g.brake) {
        const br = this.parkingBrake ? 1 : g.name === 'left' ? this.ctl.brakeL : this.ctl.brakeR;
        mu += 0.48 * br;
      }
      const Fl = -clamp(vl * Fn * 3, -mu * Fn, mu * Fn);
      const latMu = gear ? 0.75 : 0.5;
      const Fs = -clamp(vs * Fn * 4, -latMu * Fn, latMu * Fn);
      const FN = [fwd[0] * Fl + side[0] * Fs, fwd[1] * Fl + side[1] * Fs, -Fn];
      const Fb = qrotInv(R, FN);
      F = add(F, Fb); M = add(M, cross(g.rb, Fb));
    }
    // heavy rotational damping on ground to stop oscillations
    if (wow > 0) {
      M = add(M, [-this.w[0] * this.Ixx * 1.2, 0, -this.w[2] * this.Izz * 0.6 * (vSpeed < 3 ? 2 : 0.15)]);
    }
    const was = this.onGround;
    this._tdFrame = false;
    this.onGround = wow > 0;
    this.wow = wow;
    if (this.onGround) { this.groundTime += dt; if (this.groundTime > 0.5) this.airTime = 0; }
    else { this.airTime += dt; this.groundTime = 0; if (this.airTime > 3) this._tailStruck = false; }
    if (was && !this.onGround && this.groundTime === 0 && this.airTime < dt * 2 && vSpeed > 20) this.emit('liftoff', {});
    return { F, M };
  }

  touchdown(vDown) {
    const fpm = vDown / 0.00508;
    let rating = 'Butter!';
    if (fpm > 600) rating = 'Hard landing'; else if (fpm > 360) rating = 'Firm'; else if (fpm > 180) rating = 'Smooth';
    this.emit('touchdown', { fpm: Math.round(fpm), rating, g: this.nz });
    if (fpm > 1000) this.crash('Touchdown at ' + Math.round(fpm) + ' fpm — gear collapsed');
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = reason; this.vel = [0, 0, 0]; this.w = [0, 0, 0];
    this.emit('crash', { reason });
  }

  calcOutputs(atm, windNED) {
    const e = quatToEuler(this.q);
    const vAir = [this.vel[0] - windNED[0], this.vel[1] - windNED[1], this.vel[2] - windNED[2]];
    const tas = Math.hypot(...vAir);
    // calibrated airspeed from impact pressure (compressible)
    const Mn = tas / atm.a;
    const qc = atm.p * (Math.pow(1 + 0.2 * Mn * Mn, 3.5) - 1);
    const ias = 340.294 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 2 / 7) - 1));
    const gs = Math.hypot(this.vel[0], this.vel[1]);
    // radio altitude measured from the main gear contact
    const mainZ = this.gear[1] ? qrot(this.q, this.gear[1].rb)[2] : 0;
    this.agl = this.h - mainZ - this.groundH;
    this.out = {
      ias: ias / KT, tas: tas / KT, gs: gs / KT, mach: tas / atm.a,
      alt: (this.h - this.geoid) / FT, agl: Math.max(0, this.agl) / FT,
      vs: -this.vel[2] / 0.00508,
      hdg: ((e.yaw * R2D) % 360 + 360) % 360, pitch: e.pitch * R2D, roll: e.roll * R2D,
      track: ((Math.atan2(this.vel[1], this.vel[0]) * R2D) % 360 + 360) % 360,
      alpha: (this.air?.alpha || 0) * R2D, beta: (this.air?.beta || 0) * R2D,
      oat: atm.T - 273.15, windDir: ((Math.atan2(-windNED[1], -windNED[0]) * R2D) + 360) % 360, windSpd: Math.hypot(windNED[0], windNED[1]) / KT,
      stall: (this.air && this.air.alpha > this.alphaStall - 1.5 * D2R && !this.onGround) || false,
    };
  }

  // Speeds (kt IAS) for the current weight & config
  vspeeds() {
    const A = this.aero;
    const W = this.mass * G0;
    const vs = (cl) => Math.sqrt((2 * W) / (1.225 * this.S * cl)) / KT;
    const land = A.clmaxClean + A.dclFlaps + A.dclSlats;
    const to = A.clmaxClean + A.dclFlaps * 0.3 + A.dclSlats * 0.8;
    return {
      vs0: vs(land), vs1: vs(A.clmaxClean), vref: 1.23 * vs(land), vr: 1.15 * vs(to), v2: 1.25 * vs(to),
      vmo: this.ac.perf.vmo, mmo: this.ac.perf.mmo,
      flapMax: this.ac.perf.vmo * (this.isGA ? 0.53 : 0.6),
    };
  }
}
