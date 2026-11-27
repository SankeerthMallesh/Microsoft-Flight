// Procedural sound: engines, wind, runway rumble, warnings and synthesized voice callouts.
import { clamp } from './sim/math.js';

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.volume = 0.7; this.callouts = new Set(); this.lastSpeak = 0; }

  start(engineType) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(this.ctx.destination);
      this.cabin = this.ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 20000; this.cabin.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
      this.noiseBuf = buf;
    }
    this.ctx.resume();
    this.stopEngines();
    const c = this.ctx;
    const noise = (type, f, q) => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.cabin); s.start(); return { s, fl, g }; };
    const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); g.gain.value = 0; o.connect(g); g.connect(this.cabin); o.start(); return { o, g }; };
    this.type = engineType;
    this.n = {
      rumble: noise('lowpass', 300, 0.7), roar: noise('bandpass', 900, 0.6), whine: osc('sawtooth', 400), whine2: osc('sine', 1200),
      prop: osc('sawtooth', 80), wind: noise('bandpass', 600, 0.4), ground: noise('lowpass', 120, 1), shaker: noise('bandpass', 60, 3),
    };
    this.whineFilter = c.createBiquadFilter(); this.whineFilter.type = 'lowpass'; this.whineFilter.frequency.value = 3000;
  }
  stopEngines() {
    if (!this.n) return;
    for (const v of Object.values(this.n)) { try { (v.s || v.o).stop(); } catch (e) { /* */ } }
    this.n = null;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.value = v; }

  update(fm, view, dt) {
    if (!this.ctx || !this.n) return;
    const t = this.ctx.currentTime, n = this.n, o = fm.out;
    const set = (p, v) => p.setTargetAtTime(v, t, 0.08);
    const inside = view === 'cockpit';
    set(this.cabin.frequency, inside ? 1800 : 18000);
    const e = fm.engines;
    const avg = e.reduce((s, x) => s + (x.running ? x.n1 : 0), 0) / e.length;
    const pw = clamp((avg - 15) / 85, 0, 1);
    const k = inside ? 0.55 : 1;
    if (this.type === 'turbofan') {
      set(n.rumble.g.gain, (0.12 + 0.55 * pw * pw) * k);
      set(n.roar.g.gain, 0.25 * pw * pw * k); set(n.roar.fl.frequency, 500 + pw * 900);
      set(n.whine.o.frequency, 180 + avg * 9); set(n.whine.g.gain, 0.018 * clamp(avg / 30, 0, 1) * (inside ? 0.4 : 1));
      set(n.whine2.o.frequency, 900 + avg * 28); set(n.whine2.g.gain, 0.012 * clamp(avg / 25, 0, 1) * k);
      set(n.prop.g.gain, 0);
    } else {
      const rpm = fm.engines[0].running ? 900 + pw * 1500 : 0;
      const blades = fm.ac.engines.blades || 4;
      set(n.prop.o.frequency, Math.max(20, (rpm / 60) * blades * (this.type === 'piston' ? 0.5 : 1)));
      set(n.prop.g.gain, rpm ? (0.05 + 0.1 * pw) * k : 0);
      set(n.rumble.g.gain, (0.1 + 0.35 * pw) * k); set(n.roar.g.gain, 0.08 * pw * k);
      set(n.whine.o.frequency, this.type === 'turboprop' ? 600 + avg * 6 : 100); set(n.whine.g.gain, this.type === 'turboprop' ? 0.012 * k : 0);
      set(n.whine2.g.gain, 0);
    }
    const ias = o.ias;
    set(n.wind.g.gain, clamp((ias / 300) ** 2, 0, 1) * (inside ? 0.18 : 0.35)); set(n.wind.fl.frequency, 300 + ias * 4);
    set(n.ground.g.gain, fm.onGround ? clamp(o.gs / 120, 0, 1) * 0.45 : 0);
    set(n.shaker.g.gain, o.stall ? 0.5 : 0);
    this.callout(fm);
  }

  speak(text, force) {
    if (this.muted || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!force && now - this.lastSpeak < 900) return;
    this.lastSpeak = now;
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.pitch = 0.8; u.volume = this.volume;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  callout(fm) {
    const o = fm.out;
    if (fm.onGround) {
      if (o.ias < 30) this.callouts.clear();
      const vs = this.vs;
      if (vs && fm.ctl.throttle > 0.5) {
        if (o.ias > vs.vr - 6 && !this.callouts.has('v1')) { this.callouts.add('v1'); this.speak('V one', true); }
        if (o.ias > vs.vr && !this.callouts.has('rot')) { this.callouts.add('rot'); this.speak('Rotate', true); }
      }
      return;
    }
    if (o.vs > 200) { for (const a of [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10]) if (o.agl > a + 150) this.callouts.delete('ra' + a); return; }
    for (const a of [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10]) {
      if (o.agl < a && o.agl > a - 60 && !this.callouts.has('ra' + a) && o.vs < -50) {
        this.callouts.add('ra' + a);
        const words = { 2500: 'Twenty five hundred', 1000: 'One thousand', 500: 'Five hundred', 400: 'Four hundred', 300: 'Three hundred', 200: 'Two hundred', 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' };
        this.speak(words[a], a <= 50);
        if (a === 20 && fm.ac.fbw) setTimeout(() => this.speak('Retard', true), 500);
        break;
      }
    }
    if (o.agl < 1500 && o.vs < -2200 && !this.callouts.has('sink')) { this.callouts.add('sink'); this.speak('Sink rate. Pull up!', true); setTimeout(() => this.callouts.delete('sink'), 3000); }
    if (fm.gearPos < 0.5 && o.agl < 500 && o.vs < -300 && !this.callouts.has('gear')) { this.callouts.add('gear'); this.speak('Too low. Gear!', true); setTimeout(() => this.callouts.delete('gear'), 4000); }
  }
  thump(strength = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    const g = c.createGain(); g.gain.setValueAtTime(0.9 * strength, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 0.6);
  }
  click() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1800; g.gain.setValueAtTime(0.08, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.06);
  }
  apDisconnect() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    for (let i = 0; i < 3; i++) { const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 880 + (i % 2) * 220; const t0 = c.currentTime + i * 0.28; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 0.02); g.gain.linearRampToValueAtTime(0, t0 + 0.25); o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.3); }
  }
}
