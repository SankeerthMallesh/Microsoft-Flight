// Autopilot / autothrottle with HDG, LOC, ALT, V/S, FLCH, G/S (ILS) and autoland flare.
import { D2R, R2D, KT, FT, clamp, wrap180, distance, bearing } from './math.js';

export class Autopilot {
  constructor(fm) {
    this.fm = fm; fm.ap = this;
    this.engaged = false; this.at = false;
    this.lat = 'HDG'; this.vert = 'VS'; this.atMode = 'SPD';
    this.spd = 250; this.hdg = 0; this.alt = 10000; this.vs = 0;
    this.cmd = { pitch: 0, roll: 0 };
    this.appArmed = false; this.runway = null; this.flare = false; this.retard = false;
    this.listeners = [];
    this.thrI = null; this.lastIas = null; this.pitchI = 0;
  }
  on(fn) { this.listeners.push(fn); }
  notify(msg) { for (const l of this.listeners) l(msg); }
  sync() {
    const o = this.fm.out;
    this.hdg = Math.round(o.hdg); this.alt = Math.round(o.alt / 100) * 100; this.spd = Math.round(o.ias);
  }
  engage() {
    if (this.fm.onGround) { this.notify('Autopilot cannot engage on the ground'); return; }
    if (!this.engaged) { this.engaged = true; this.lat = this.lat === 'LOC' ? 'LOC' : 'HDG'; this.vert = this.vert || 'VS';
      if (this.vert === 'VS' && this.vs === 0) this.vs = Math.round(this.fm.out.vs / 100) * 100;
      this.notify('Autopilot engaged'); }
  }
  disconnect(reason = '') {
    if (!this.engaged) return;
    this.engaged = false; this.appArmed = false; this.flare = false;
    this.fm.fbwRef.pitch = null;
    this.notify('Autopilot disconnected' + (reason ? ` (${reason})` : ''), true);
  }
  toggle() { this.engaged ? this.disconnect() : this.engage(); }
  toggleAT() { this.at = !this.at; this.thrI = null; this.notify(this.at ? 'Autothrottle armed' : 'Autothrottle off'); }
  setVert(m) {
    this.vert = m; this.flare = false;
    if (m === 'VS') this.vs = Math.round(this.fm.out.vs / 100) * 100;
    if (m === 'FLCH') this.spd = Math.round(this.fm.out.ias);
  }
  setApproach(rwy) {
    if (!rwy) { this.notify('No runway selected for approach'); return; }
    this.runway = rwy; this.appArmed = true; this.lat = 'LOC'; this.vert = this.vert === 'GS' ? 'GS' : this.vert;
    this.notify(`Approach armed: ${rwy.airport} RWY ${rwy.ident}`);
  }

  // ILS geometry relative to runway (returns metres)
  ils() {
    const r = this.runway; if (!r) return null;
    const fm = this.fm;
    const d = distance(fm.lat, fm.lon, r.lat, r.lon); // to threshold
    const brgTo = bearing(fm.lat, fm.lon, r.lat, r.lon);
    const crs = r.heading;
    const ang = wrap180((brgTo - crs) * R2D) * D2R;
    const along = d * Math.cos(ang); // + when before threshold
    const xtk = d * Math.sin(ang); // + when left of centreline
    const aimDist = along + r.aim; // distance to touchdown aim point
    const gsAlt = r.elevM + Math.max(0, aimDist) * Math.tan(3 * D2R) + 15;
    const alt = fm.h - fm.geoid;
    return { along, xtk, aimDist, gsDev: alt - gsAlt, d };
  }

  update(dt) {
    const fm = this.fm, o = fm.out;
    if (!o) return;
    const V = Math.max(o.tas * KT, 30);
    // ---------------- autothrottle
    if (this.at) {
      let target = this.spd;
      const ias = o.ias;
      const accel = this.lastIas == null ? 0 : (ias - this.lastIas) / Math.max(dt, 1e-3);
      this.lastIas = ias;
      if (this.thrI == null) this.thrI = fm.ctl.throttle;
      if (this.engaged && this.vert === 'FLCH') {
        const climbing = this.alt > o.alt;
        fm.ctl.throttle += clamp((climbing ? 0.95 : 0.0) - fm.ctl.throttle, -dt * 0.25, dt * 0.25);
      } else if (this.retard) {
        fm.ctl.throttle = Math.max(0, fm.ctl.throttle - dt * 0.4);
      } else {
        this.accF = (this.accF || 0) + (accel - (this.accF || 0)) * Math.min(1, dt * 1.5);
        const err = target - ias;
        this.thrI = clamp(this.thrI + dt * 0.004 * err, 0, 1);
        const cmd = clamp(this.thrI + 0.025 * err - 0.06 * this.accF, 0, 1);
        fm.ctl.throttle += clamp(cmd - fm.ctl.throttle, -dt * 0.15, dt * 0.15);
      }
    } else this.lastIas = null;

    if (!this.engaged) return;
    if (fm.onGround && fm.groundTime > 2) { this.disconnect('touchdown'); return; }

    // ---------------- approach capture
    let ils = null;
    if (this.runway && (this.lat === 'LOC' || this.appArmed)) ils = this.ils();
    this.ilsData = ils;

    // ---------------- lateral
    let rollCmd = 0;
    if (this.lat === 'HDG') {
      const err = wrap180(this.hdg - o.hdg);
      rollCmd = clamp(err * 1.4, -25, 25);
    } else if (this.lat === 'LOC' && ils) {
      const crsDeg = this.runway.heading * R2D;
      const intercept = clamp(Math.atan2(ils.xtk, Math.max(300, ils.along * 0.08)) * R2D * 2.2, -30, 30);
      const desiredTrack = crsDeg + intercept;
      const err = wrap180(desiredTrack - o.track);
      rollCmd = clamp(err * 1.6, -25, 25);
      if (fm.out.agl < 30) rollCmd = clamp(rollCmd, -3, 3);
    }
    this.cmd.roll = rollCmd * D2R;

    // ---------------- vertical
    let vsCmd = 0; // fpm
    const altErr = this.alt - o.alt;
    if ((this.vert === 'VS' || this.vert === 'FLCH') && Math.abs(altErr) < Math.max(150, Math.abs(o.vs) * 0.12)) { this.vert = 'ALT'; this.notify('Altitude captured'); }
    if (this.appArmed && ils && this.vert !== 'GS' && ils.gsDev < 15 && Math.abs(ils.xtk) < 400 && ils.along > 0) { this.vert = 'GS'; this.notify('Glideslope captured'); }
    if (this.vert === 'ALT') vsCmd = clamp(altErr * 4, -2000, 2000);
    else if (this.vert === 'VS') vsCmd = this.vs;
    else if (this.vert === 'FLCH') {
      // pitch for speed
      const spdErr = o.ias - this.spd;
      this.pitchI = clamp(this.pitchI + spdErr * dt * 0.02, -8, 8);
      const base = altErr > 0 ? 1800 : -2000;
      vsCmd = clamp(base + spdErr * 120 + this.pitchI * 100, altErr > 0 ? 0 : -4000, altErr > 0 ? 5000 : 0);
    } else if (this.vert === 'GS' && ils) {
      const gsVs = -(o.gs * KT) * Math.tan(3 * D2R) / 0.00508;
      vsCmd = gsVs - ils.gsDev / FT * 6;
      vsCmd = clamp(vsCmd, -1800, 200);
      const ra = o.agl;
      const flareH = clamp(Math.abs(o.vs) * 0.075, fm.isGA ? 15 : 40, 70);
      if (ra < flareH && !this.flare) { this.flare = true; this.flareVs = o.vs; this.notify('FLARE'); }
      if (this.flare) { this.flareVs += (-(90 + ra * 4) - this.flareVs) * Math.min(1, dt * 1.6); vsCmd = this.flareVs; }
      if (ra < 25 && this.at && !this.retard) { this.retard = true; this.notify('RETARD'); }
    }
    // flight-path-angle loop: pitch command = current pitch + K * (gamma error) + integral
    const gammaT = Math.asin(clamp((vsCmd * 0.00508) / V, -0.3, 0.3));
    const gammaNow = Math.asin(clamp((o.vs * 0.00508) / V, -0.5, 0.5));
    const gErr = gammaT - gammaNow;
    const gRate = this.lastGamma == null ? 0 : (gammaNow - this.lastGamma) / Math.max(dt, 1e-3);
    this.lastGamma = gammaNow;
    this.gRateF = (this.gRateF || 0) + (gRate - (this.gRateF || 0)) * Math.min(1, dt * 3);
    const kG = +(globalThis.AP_KG ?? 0.9), kD = +(globalThis.AP_KD ?? 1.2), kI = +(globalThis.AP_KI ?? 0.12);
    this.gI = clamp((this.gI || 0) + gErr * dt * kI, -0.06, 0.06);
    this.cmd.pitch = clamp(o.pitch * D2R + kG * gErr - kD * this.gRateF + this.gI, -15 * D2R, 25 * D2R);
  }
}
