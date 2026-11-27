// Autopilot / autothrottle with HDG, LOC, ALT, V/S, FLCH, G/S (ILS) and autoland flare.
import { D2R, R2D, KT, FT, NM, clamp, wrap180, distance, bearing } from './math.js';

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
  // route to a destination runway: fly direct to a final approach fix 10 NM out, then the ILS
  setRoute(route) {
    this.route = route; this.runway = route ? route.rwy : this.runway; this.tod = false;
    if (route) this.notify(`Route set: ${route.rwy.airport} RWY ${route.rwy.ident}`);
  }
  navInfo() {
    const r = this.route; if (!r) return null;
    const fm = this.fm;
    let dFaf = distance(fm.lat, fm.lon, r.faf.lat, r.faf.lon);
    const dThr = distance(fm.lat, fm.lon, r.rwy.lat, r.rwy.lon);
    let brgFaf = bearing(fm.lat, fm.lon, r.faf.lat, r.faf.lon) * R2D;
    // join the centreline at an intermediate fix (IF) when arriving at a large angle
    if (r.ifix && !r.ifDone) {
      const dIf = distance(fm.lat, fm.lon, r.ifix.lat, r.ifix.lon);
      const angle = Math.abs(wrap180(brgFaf - r.rwy.heading * R2D));
      if (angle < 40 || dIf < 2 * NM) r.ifDone = true;
      else { return { dFaf, dThr, brgFaf: bearing(fm.lat, fm.lon, r.ifix.lat, r.ifix.lon) * R2D, pastFaf: false, togo: dIf + distance(r.ifix.lat, r.ifix.lon, r.faf.lat, r.faf.lon) + r.fafDist }; }
    }
    const pastFaf = this.lat === 'LOC' || dThr < r.fafDist - 500;
    return { dFaf, dThr, brgFaf, pastFaf, togo: pastFaf ? dThr : dFaf + r.fafDist };
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
    // glidepath referenced to the main wheels: ~50 ft over the threshold, touching down at the aim point
    const gearH = clamp(fm.h - fm.groundH - fm.agl, 1, 12);
    const gsAlt = r.elevM + Math.max(0, aimDist) * Math.tan(3 * D2R) + gearH + 2;
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
      if (this.engaged && this.route && (this.vert === 'VNAV' || this.vert === 'GS' || this.lat === 'NAV' || this.lat === 'LOC')) {
        const nav = this.navInfo();
        const vref = fm.vspeeds().vref;
        if (nav && nav.togo < 12 * NM) target = Math.min(target, Math.round(vref + 8));
        else if (nav && nav.togo < 30 * NM) target = Math.min(target, Math.max(Math.round(vref + 60), fm.isGA ? 90 : 210));
        if (o.alt < 10000 && !fm.isGA) target = Math.min(target, 250);
        this.spdAuto = target;
      } else this.spdAuto = null;
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
    if (this.runway && (this.lat === 'LOC' || this.appArmed || this.vert === 'VNAV')) ils = this.ils();
    this.ilsData = ils;

    // ---------------- lateral
    let rollCmd = 0;
    if (this.lat === 'HDG') {
      const err = wrap180(this.hdg - o.hdg);
      rollCmd = clamp(err * 1.4, -25, 25);
    } else if (this.lat === 'NAV' && this.route) {
      const nav = this.navInfo();
      const ilsR = this.ils();
      const aligned = ilsR && ilsR.along > 0 && Math.abs(wrap180(o.track - this.route.rwy.heading * R2D)) < 70 && Math.abs(ilsR.xtk) < 4000;
      if (nav.dFaf < 2.5 * NM || (aligned && nav.dThr < this.route.fafDist + 2 * NM)) { this.lat = 'LOC'; this.appArmed = true; this.notify('Localizer captured'); }
      const err = wrap180(nav.brgFaf - o.track);
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
    } else if (this.vert === 'VNAV') {
      const nav = this.navInfo();
      if (!nav) vsCmd = clamp(altErr * 4, -2000, 2000);
      else {
        const tg = nav.togo / NM;
        const pathAlt = this.route.rwy.elevM / FT + (tg <= 10 ? 50 + tg * 318 : 2750 + (tg - 10) * 285); // 3 deg final, ~2.7 deg descent above
        const crz = this.alt;
        const descending = pathAlt < crz;
        const target = Math.min(crz, pathAlt);
        if (descending && !this.tod && o.alt > target + 300) { this.tod = true; this.notify('Top of descent — VNAV descending'); }
        const base = descending ? -(o.gs * 101.27) * Math.tan((nav.togo / NM <= 10 ? 3 : 2.7) * D2R) : 0;
        if (o.alt < target - 300) vsCmd = clamp((target - o.alt) * 2, 600, 2200);
        else vsCmd = clamp(base + (target - o.alt) * 1.5, -2500, 2000);
        // too fast in the descent: shallow out so the autothrottle can slow the aircraft
        if (this.spdAuto && o.ias > this.spdAuto + 12 && vsCmd < -700) vsCmd = Math.max(vsCmd, -700 - Math.max(0, o.alt - target) * 0.5);
      }
    } else if (this.vert === 'GS' && ils) {
      const gsVs = -(o.gs * KT) * Math.tan(3 * D2R) / 0.00508;
      vsCmd = gsVs - ils.gsDev / FT * 6;
      vsCmd = clamp(vsCmd, -1800, 200);
      const ra = o.agl;
      const flareH = clamp(Math.abs(o.vs) * 0.075, fm.isGA ? 15 : 40, 70);
      if (ra < flareH && !this.flare) { this.flare = true; this.flareVs = o.vs; this.notify('FLARE'); }
      if (this.flare) { this.flareVs += (-((fm.isGA ? 100 : 170) + ra * 3.5) - this.flareVs) * Math.min(1, dt * 1.6); vsCmd = this.flareVs; }
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
