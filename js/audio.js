// Procedural sound for OpenSkies. Everything is synthesised with the Web Audio API at run time:
// there are no recorded sound files. It covers engines (turbofan, turboprop, piston), APU, wind,
// gear/flap motors, runway roll, touchdown squeal, spoilers, reversers, cockpit ambience,
// GPWS / radio-altimeter callouts, cautions and the autopilot disconnect warning, plus a
// speech manager with a radio effect that the ATC module uses.
import { clamp, qrot } from './sim/math.js';

const R_EARTH = 6371000, C_SOUND = 343;

// ---------------------------------------------------------------- helpers
function periodic(ctx, amps) {
  const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

// ---------------------------------------------------------------- speech manager
// Voices for ATC (controller), the pilot (own readbacks) and the GPWS. speechSynthesis
// cannot be routed through Web Audio, so the "radio" feel comes from squelch clicks and a
// band-limited static bed that play while the voice speaks.
class VoiceBox {
  constructor(audio) {
    this.audio = audio; this.queue = []; this.busy = false; this.current = null; this.voices = [];
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.ok) {
      const load = () => { try { this.voices = speechSynthesis.getVoices() || []; this.pick(); } catch (e) { /* */ } };
      load(); try { speechSynthesis.addEventListener('voiceschanged', load); } catch (e) { /* */ }
    }
  }
  pick() {
    const en = this.voices.filter((v) => /^en/i.test(v.lang));
    const by = (re, list = en) => list.find((v) => re.test(v.name));
    const us = en.filter((v) => /en[-_]US/i.test(v.lang)), gb = en.filter((v) => /en[-_](GB|IE|AU)/i.test(v.lang));
    // prefer male-sounding voices for the controller, a different one for the pilot
    this.vAtcUS = by(/david|guy|alex|fred|daniel|google us english|male/i, us) || us[0] || en[0] || null;
    this.vAtcINT = by(/daniel|george|ryan|google uk english male|arthur|male/i, gb) || gb[0] || this.vAtcUS;
    this.vPilot = by(/mark|aaron|tom|google uk english male|christopher|eric|james/i, en.filter((v) => v !== this.vAtcUS && v !== this.vAtcINT)) || en.find((v) => v !== this.vAtcUS && v !== this.vAtcINT) || this.vAtcUS;
    this.vGpws = by(/david|alex|fred|daniel|male/i, en) || en[0] || null;
  }
  get idle() { return !this.busy && !this.queue.length; }
  estimate(text, rate) { return (500 + text.length * 62) / (rate || 1); }
  utter(text, role, opts = {}) {
    const u = new SpeechSynthesisUtterance(text);
    const a = this.audio;
    if (role === 'gpws') { u.voice = this.vGpws; u.rate = 1.25; u.pitch = 0.55; }
    else if (role === 'pilot') { u.voice = this.vPilot; u.rate = 1.12; u.pitch = 0.92; }
    else { u.voice = opts.intl ? this.vAtcINT : this.vAtcUS; u.rate = 1.17; u.pitch = 0.82; }
    if (!u.voice) delete u.voice;
    u.volume = clamp(a.volume * (role === 'gpws' ? 1 : 0.9), 0, 1);
    return u;
  }
  // GPWS / callouts: immediate, interrupts radio speech (which is re-queued once)
  callout(text) {
    if (!this.ok || this.audio.muted) return;
    if (this.current && this.current.role !== 'gpws') { this.current.interrupted = true; }
    try { speechSynthesis.cancel(); } catch (e) { /* */ }
    const u = this.utter(text, 'gpws');
    const item = { role: 'gpws', text };
    this.current = item; this.gpwsUntil = performance.now() + this.estimate(text, 1.25) + 300;
    u.onend = u.onerror = () => { if (this.current === item) this.current = null; this.gpwsUntil = 0; this.pump(); };
    try { speechSynthesis.speak(u); } catch (e) { /* */ }
  }
  // radio transmission: queued; resolves when spoken (or after an estimate when speech is unavailable)
  radio(text, role, opts = {}) {
    return new Promise((resolve) => { this.queue.push({ text, role, opts, resolve, t: performance.now() }); this.pump(); });
  }
  clear() {
    for (const q of this.queue) q.resolve(false);
    this.queue = []; this.busy = false;
    if (this.current && this.current.role !== 'gpws') { this.current.dead = true; try { speechSynthesis.cancel(); } catch (e) { /* */ } }
    this.audio.radioKey(false, 'atc', true);
  }
  pump() {
    if (this.busy || !this.queue.length) return;
    if (this.gpwsUntil && performance.now() < this.gpwsUntil) { setTimeout(() => this.pump(), 250); return; }
    const item = this.queue.shift();
    this.busy = true; this.current = item;
    if (!item.started) { item.started = true; try { item.opts.onStart?.(); } catch (e) { /* */ } }
    const a = this.audio;
    const speech = this.ok && !a.muted;
    a.radioKey(true, item.role);
    let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(item.watch);
      a.radioKey(false, item.role);
      if (this.current === item) this.current = null;
      if (item.interrupted && !item.dead && !item.retried && performance.now() - item.t < 30000) { item.retried = true; item.interrupted = false; this.queue.unshift(item); }
      else item.resolve(true);
      setTimeout(() => { this.busy = false; this.pump(); }, item.role === 'pilot' ? 450 : 650);
    };
    const est = this.estimate(item.text, 1.15);
    if (speech) {
      const u = this.utter(item.text, item.role, item.opts);
      u.onend = finish; u.onerror = finish;
      // watchdog: some platforms never fire onend (no voices installed, headless browsers)
      item.watch = setTimeout(finish, est * 1.8 + 2500);
      // a short pause after the squelch click, like keying a microphone
      setTimeout(() => { if (!done) { try { speechSynthesis.speak(u); } catch (e) { finish(); } } }, 140);
    } else item.watch = setTimeout(finish, est);
  }
}

// ---------------------------------------------------------------- audio engine
export class Audio {
  constructor() {
    this.ctx = null; this.muted = false; this.volume = 0.7; this.callouts = new Set(); this.lastSpeak = 0;
    this.voice = new VoiceBox(this);
    this.st = {};
  }

  // build the permanent graph; `ctx` may be an OfflineAudioContext (used by tests)
  init(ctx) {
    if (this.ctx) return true;
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; ctx = new AC(); }
    const c = this.ctx = ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    // brick-wall-ish limiter so stacked sounds never clip
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -8; this.limiter.knee.value = 4; this.limiter.ratio.value = 16; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.2;
    this.master.connect(this.limiter); this.limiter.connect(c.destination);
    // exterior bus: propagation delay (gives true Doppler in the fly-by view) + air absorption / cabin insulation
    this.extIn = c.createGain();
    this.extDelay = c.createDelay(5); this.extDelay.delayTime.value = 0;
    this.extAir = c.createBiquadFilter(); this.extAir.type = 'lowpass'; this.extAir.frequency.value = 18000; this.extAir.Q.value = 0.5;
    this.extBody = c.createBiquadFilter(); this.extBody.type = 'peaking'; this.extBody.frequency.value = 160; this.extBody.Q.value = 0.8; this.extBody.gain.value = 0;
    this.extGain = c.createGain(); this.extGain.gain.value = 1;
    this.extIn.connect(this.extDelay); this.extDelay.connect(this.extAir); this.extAir.connect(this.extBody); this.extBody.connect(this.extGain); this.extGain.connect(this.master);
    // cockpit bus (avionics, motors), alerts bus (always audible), radio bus
    this.cabBus = c.createGain(); this.cabBus.connect(this.master);
    this.alertBus = c.createGain(); this.alertBus.gain.value = 0.9; this.alertBus.connect(this.master);
    this.radioBus = c.createGain(); this.radioBus.gain.value = 1; this.radioBus.connect(this.master);
    // noise buffers: white and pink (Paul Kellet filter), 4 s, decorrelated by random start offsets
    const len = c.sampleRate * 4;
    const white = c.createBuffer(1, len, c.sampleRate), pink = c.createBuffer(1, len, c.sampleRate);
    const w = white.getChannelData(0), p = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1; w[i] = x * 0.5;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
    }
    // smooth the loop seam
    for (const d of [w, p]) for (let i = 0; i < 256; i++) { const k = i / 256; d[i] = d[i] * k + d[len - 256 + i] * (1 - k); }
    this.noiseBuf = white; this.pinkBuf = pink;
    this.radioInit();
    return true;
  }

  start(engineType, ac, ctx) {
    if (!this.init(ctx)) return;
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
    this.stopEngines();
    const c = this.ctx;
    this.type = engineType; this.ac = ac || null;
    this.maker = ac?.maker || '';
    const nodes = [];
    const gainNode = (dest, v = 0) => { const g = c.createGain(); g.gain.value = v; g.connect(dest); return g; };
    const noise = (dest, type, f, q, pink = false, rate = 1) => {
      const s = c.createBufferSource(); s.buffer = pink ? this.pinkBuf : this.noiseBuf; s.loop = true; s.playbackRate.value = rate;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = gainNode(dest); s.connect(fl); fl.connect(g); s.start(0, Math.random() * 3.5); nodes.push(s); return { s, fl, g };
    };
    const osc = (dest, type, f, wave) => {
      const o = c.createOscillator(); if (wave) o.setPeriodicWave(wave); else o.type = type; o.frequency.value = f;
      const g = gainNode(dest); o.connect(g); o.start(); nodes.push(o); return { o, g };
    };
    const n = {};
    const E = this.extIn, CB = this.cabBus;
    const thrust = ac?.engines?.thrust || 120, count = Math.min(4, ac?.engines?.count || 2);
    if (engineType === 'turbofan') {
      // fan blade-passing tone per engine (slightly different shaft speeds → natural beating)
      this.fanRpm100 = clamp(4800 * Math.pow(120 / thrust, 0.4), 2400, 9000);
      this.fanBlades = thrust > 250 ? 22 : thrust > 60 ? 24 : 20;
      n.fan = [];
      for (let i = 0; i < count; i++) {
        const tone = osc(E, 'sine', 1000), h2 = osc(E, 'sine', 2000);
        n.fan.push({ tone, h2, detune: 1 + (i - (count - 1) / 2) * 0.0035 });
      }
      // buzz-saw (multiple pure tones at the shaft frequency when the fan tips go supersonic)
      const bz = c.createOscillator(); bz.type = 'sawtooth'; bz.frequency.value = 80;
      const bzF = c.createBiquadFilter(); bzF.type = 'bandpass'; bzF.frequency.value = 900; bzF.Q.value = 0.7;
      const bzG = gainNode(E); bz.connect(bzF); bzF.connect(bzG); bz.start(); nodes.push(bz);
      n.buzz = { o: bz, fl: bzF, g: bzG };
      // high-pressure compressor whine (the characteristic idle whistle)
      n.core = osc(E, 'sine', 4000); n.core2 = osc(E, 'sine', 4100);
      // broadband fan noise, jet mixing roar, low combustion rumble
      n.hiss = noise(E, 'bandpass', 3000, 0.5);
      n.roar = noise(E, 'lowpass', 800, 0.6, true);
      n.rumble = noise(E, 'lowpass', 110, 0.9, true);
    } else {
      const blades = ac?.engines?.blades || (engineType === 'piston' ? 2 : 4);
      const D = ac?.engines?.propD || 2.5;
      this.blades = blades;
      this.propRpm100 = clamp(((engineType === 'piston' ? 248 : 232) * 60) / (Math.PI * D), 900, 2800);
      this.cyl = (ac?.engines?.power || 130) > 200 ? 6 : 4;
      const propWave = periodic(c, Array.from({ length: 24 }, (_, i) => (1 / Math.pow(i + 1, 1.15)) * (i % 2 ? 0.7 : 1)));
      n.prop = osc(E, null, 100, propWave);
      n.propLp = c.createBiquadFilter(); n.propLp.type = 'lowpass'; n.propLp.frequency.value = 1200;
      n.prop.o.disconnect(); n.prop.o.connect(n.propLp); n.propLp.connect(n.prop.g);
      // blade "chop": broadband noise amplitude-modulated at the blade-passing frequency
      n.chop = noise(E, 'bandpass', 700, 0.5, true);
      n.chopLfo = c.createOscillator(); n.chopLfo.type = 'sine'; n.chopLfo.frequency.value = 100;
      n.chopDepth = c.createGain(); n.chopDepth.gain.value = 0;
      n.chopLfo.connect(n.chopDepth); n.chopDepth.connect(n.chop.g.gain); n.chopLfo.start(); nodes.push(n.chopLfo);
      if (engineType === 'piston') {
        // exhaust pulses at the firing frequency, with a half-order "lope" and random roughness
        const pulse = periodic(c, Array.from({ length: 40 }, (_, i) => { const k = i + 1; return Math.abs(Math.sin(k * Math.PI * 0.22) / (k * Math.PI * 0.22)) * (1 / Math.sqrt(k)); }));
        n.exh = osc(E, null, 60, pulse);
        n.exhLp = c.createBiquadFilter(); n.exhLp.type = 'lowpass'; n.exhLp.frequency.value = 900; n.exhLp.Q.value = 1.2;
        n.exh.o.disconnect(); n.exh.o.connect(n.exhLp); n.exhLp.connect(n.exh.g);
        n.lope = osc(E, 'triangle', 30);
        const rough = c.createBufferSource(); rough.buffer = this.pinkBuf; rough.loop = true; rough.playbackRate.value = 0.02;
        const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 12;
        n.roughDepth = c.createGain(); n.roughDepth.gain.value = 0;
        rough.connect(rf); rf.connect(n.roughDepth); n.roughDepth.connect(n.exh.g.gain); rough.start(0, Math.random() * 3); nodes.push(rough);
        n.rumble = noise(E, 'lowpass', 140, 0.8, true);
      } else {
        // turboprop gas-generator whine + exhaust roar
        n.core = osc(E, 'sine', 3000); n.core2 = osc(E, 'sine', 6200);
        n.roar = noise(E, 'lowpass', 600, 0.6, true);
        n.rumble = noise(E, 'lowpass', 120, 0.8, true);
      }
    }
    // reverse-thrust roar, APU, aerodynamic sources, rolling sounds
    n.rev = noise(E, 'bandpass', 650, 0.45, true);
    n.apu = osc(E, 'sine', 1180); n.apu2 = osc(E, 'sine', 7600); n.apuN = noise(E, 'bandpass', 2400, 1.2);
    n.wind = noise(E, 'bandpass', 600, 0.45, true);
    n.windHi = noise(E, 'highpass', 4200, 0.4);
    n.gearAero = noise(E, 'lowpass', 260, 0.7, true);
    n.buffet = noise(E, 'lowpass', 70, 1.5, true);
    n.roll = noise(E, 'lowpass', 130, 1, true);
    n.tyre = noise(E, 'bandpass', 420, 0.8);
    // cockpit: avionics cooling fans, 400 Hz electrical hum, hydraulic/gear motor, flap motor, stick shaker
    n.fans = noise(CB, 'bandpass', 650, 0.5, true); n.fans2 = noise(CB, 'bandpass', 2400, 1.4);
    n.hum = osc(CB, 'sine', 400);
    n.hyd = osc(CB, 'sawtooth', 300); n.hydN = noise(CB, 'bandpass', 900, 2);
    n.flapM = osc(CB, 'triangle', 190);
    const fv = c.createOscillator(); fv.frequency.value = 7; const fvg = c.createGain(); fvg.gain.value = 6; fv.connect(fvg); fvg.connect(n.flapM.o.frequency); fv.start(); nodes.push(fv);
    n.shaker = osc(this.alertBus, 'square', 26);
    const shF = c.createBiquadFilter(); shF.type = 'lowpass'; shF.frequency.value = 160; n.shaker.o.disconnect(); n.shaker.o.connect(shF); shF.connect(n.shaker.g);
    n.nodes = nodes;
    this.n = n;
    this.st = { gear: null, flap: null, spoiler: 0, rev: 0, onGround: null, distAcc: 0, nextJoint: 25, apu: 0, apuTimer: 0, lastDist: null, overspeed: false, clackT: 0, stall: false };
  }
  stopEngines() {
    if (!this.n) return;
    const t = this.ctx.currentTime;
    for (const s of this.n.nodes) { try { s.stop(t + 0.05); } catch (e) { /* */ } }
    this.n = null;
    this.voice.clear();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; if (m && this.voice.ok) { try { speechSynthesis.cancel(); } catch (e) { /* */ } } }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.value = v; }

  // ---------------------------------------------------------------- per-frame update
  // cam: { lat, lon, h } (radians, metres, same frame as fm.h) of the camera in exterior views, or null
  update(fm, view, dt, cam) {
    if (!this.ctx || !this.n) return;
    const c = this.ctx, t = c.currentTime, n = this.n, o = fm.out, st = this.st;
    const set = (p, v, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    const inside = view === 'cockpit';
    // ---- listener geometry
    let dist = inside ? 0 : 45, cosF = -0.7;
    if (!inside && cam) {
      const dN = (cam.lat - fm.lat) * R_EARTH, dE = (cam.lon - fm.lon) * R_EARTH * Math.cos(fm.lat), dD = -(cam.h - fm.h);
      dist = Math.max(4, Math.hypot(dN, dE, dD));
      const f = qrot(fm.q, [1, 0, 0]);
      cosF = (f[0] * dN + f[1] * dE + f[2] * dD) / dist;
    }
    const jump = st.lastDist != null && Math.abs(dist - st.lastDist) > 120;
    st.lastDist = dist;
    if (inside) {
      set(this.extDelay.delayTime, 0, 0.02);
      set(this.extAir.frequency, fm.isGA ? 2600 : 1500, 0.15); set(this.extBody.gain, 5, 0.15); set(this.extGain.gain, fm.isGA ? 0.75 : 0.6, 0.15);
      set(this.cabBus.gain, 1, 0.15);
    } else {
      const d = Math.min(dist / C_SOUND, 4.9);
      if (jump) { this.extDelay.delayTime.cancelScheduledValues(t); this.extDelay.delayTime.setValueAtTime(d, t); this.extGain.gain.setValueAtTime(0.0001, t); }
      else set(this.extDelay.delayTime, d, 0.06);
      set(this.extAir.frequency, clamp(19000 * Math.exp(-dist / 700), 600, 19000), 0.1); set(this.extBody.gain, 0, 0.15);
      set(this.extGain.gain, clamp(55 / dist, 0.004, 1.2), jump ? 0.3 : 0.08);
      set(this.cabBus.gain, 0, 0.15);
    }
    const front = clamp(0.25 + 0.75 * (cosF + 1) / 2, 0, 1); // forward-radiated (fan tones, buzz-saw)
    const aft = clamp(0.3 + 0.7 * (1 - cosF) / 2, 0, 1); // aft-radiated (jet mixing noise)
    const e = fm.engines;
    const run = e.filter((x) => x.running);
    const avg = run.length ? run.reduce((s, x) => s + x.n1, 0) / e.length : e.reduce((s, x) => s + x.n1, 0) / e.length;
    const idle = e[0].idle;
    const pw = clamp((avg - idle) / (100 - idle), 0, 1);
    const rev = e.reduce((s, x) => s + (x.reverse || 0), 0) / e.length;
    const k = inside ? 0.6 : 1;
    if (this.type === 'turbofan') {
      const rpm = (avg / 100) * this.fanRpm100;
      e.forEach((eng, i) => {
        const f = n.fan[i]; if (!f) return;
        const bpf = ((eng.n1 / 100) * this.fanRpm100 * f.detune / 60) * this.fanBlades;
        const on = eng.n1 > 5 ? 1 : 0;
        set(f.tone.o.frequency, Math.max(30, bpf)); set(f.h2.o.frequency, Math.max(60, bpf * 2));
        const lvl = on * (0.012 + 0.03 * clamp(eng.n1 / 70, 0, 1)) / Math.sqrt(n.fan.length);
        set(f.tone.g.gain, lvl * front * (inside ? 0.35 : 1)); set(f.h2.g.gain, lvl * 0.35 * front * (inside ? 0.2 : 1));
      });
      const shaft = rpm / 60;
      set(n.buzz.o.frequency, Math.max(10, shaft)); set(n.buzz.fl.frequency, 500 + shaft * 9);
      set(n.buzz.g.gain, clamp((avg - 78) / 18, 0, 1) * 0.05 * front * (inside ? 1.2 : 1) * (1 - 0.6 * clamp(o.ias / 250, 0, 1)));
      const coreF = 2600 + avg * 42;
      set(n.core.o.frequency, coreF); set(n.core2.o.frequency, coreF * 1.031);
      const coreL = run.length ? (0.006 + 0.01 * clamp(avg / 40, 0, 1)) * (1 - 0.5 * pw) : 0;
      set(n.core.g.gain, coreL * front * (inside ? 0.3 : 1)); set(n.core2.g.gain, coreL * 0.5 * front * (inside ? 0.2 : 1));
      set(n.hiss.g.gain, (0.01 + 0.07 * pw) * k * front); set(n.hiss.fl.frequency, 1800 + pw * 2600);
      set(n.roar.g.gain, (0.03 + 0.42 * pw * pw) * aft * k * (inside ? 0.7 : 1)); set(n.roar.fl.frequency, 350 + pw * 1500);
      set(n.rumble.g.gain, (0.05 + 0.32 * pw) * k * (inside ? 1.1 : aft));
    } else {
      const f = pw;
      const np = this.type === 'piston' ? 0.27 + 0.73 * f : (fm.onGround ? 0.7 : 0.82) + (fm.onGround ? 0.25 : 0.18) * f;
      const prpm = run.length ? np * this.propRpm100 : 0;
      const bpf = (prpm / 60) * this.blades;
      const lvl = run.length ? 1 : 0;
      set(n.prop.o.frequency, Math.max(15, bpf)); set(n.propLp.frequency, 400 + f * 2200);
      set(n.prop.g.gain, lvl * (0.03 + 0.11 * f) * k);
      set(n.chopLfo.frequency, Math.max(15, bpf)); set(n.chop.fl.frequency, 500 + f * 900);
      set(n.chop.g.gain, lvl * (0.015 + 0.05 * f) * k); set(n.chopDepth.gain, lvl * (0.012 + 0.04 * f) * k);
      if (this.type === 'piston') {
        const erpm = run.length ? 700 + f * 2000 : 0;
        const fire = (erpm / 60) * (this.cyl / 2);
        set(n.exh.o.frequency, Math.max(8, fire)); set(n.exhLp.frequency, 500 + f * 1400);
        set(n.exh.g.gain, lvl * (0.06 + 0.12 * f) * k); set(n.roughDepth.gain, lvl * 0.05 * (1 - 0.5 * f));
        set(n.lope.o.frequency, Math.max(4, fire / 2)); set(n.lope.g.gain, lvl * 0.035 * (1 - 0.6 * f) * k);
        set(n.rumble.g.gain, lvl * (0.05 + 0.15 * f) * k);
      } else {
        const coreF = 2400 + avg * 22;
        set(n.core.o.frequency, coreF); set(n.core2.o.frequency, coreF * 2.47);
        set(n.core.g.gain, lvl * 0.012 * front * (inside ? 0.35 : 1)); set(n.core2.g.gain, lvl * 0.004 * front * (inside ? 0.2 : 1));
        set(n.roar.g.gain, lvl * (0.02 + 0.12 * f) * aft * k); set(n.roar.fl.frequency, 300 + f * 700);
        set(n.rumble.g.gain, lvl * (0.04 + 0.16 * f) * k);
      }
    }
    // ---- reverse thrust: deploy clunk, then a big broadband roar that rises with N1
    if (rev > 0.05 && st.rev <= 0.05) this.clunk(0.5);
    st.rev = rev;
    set(n.rev.g.gain, rev * (0.08 + 0.5 * pw) * k * (inside ? 1.2 : 1)); set(n.rev.fl.frequency, 450 + pw * 900);
    // ---- APU: started automatically while taxiing in after landing, stopped at take-off power
    if (fm.onGround && o.gs < 40 && st.landed) { st.apuTimer += dt; if (st.apuTimer > 25) st.apuOn = true; }
    if (!fm.onGround || fm.ctl.throttle > 0.5) { st.apuOn = false; st.apuTimer = 0; }
    if (this.apuForce != null) st.apuOn = this.apuForce;
    st.apu += clamp((st.apuOn ? 1 : 0) - st.apu, -dt / 20, dt / 25); // spool up ~25 s, run down ~20 s
    set(n.apu.o.frequency, 200 + 980 * st.apu); set(n.apu2.o.frequency, 1500 + 6100 * st.apu);
    set(n.apu.g.gain, st.apu * 0.035 * (inside ? 0.25 : 1)); set(n.apu2.g.gain, st.apu * 0.01 * (inside ? 0.1 : 1)); set(n.apuN.g.gain, st.apu * 0.04 * (inside ? 0.2 : 1));
    // ---- aerodynamic noise
    const ias = o.ias, q = clamp(ias / 280, 0, 1.4);
    const gust = 1 + 0.12 * Math.sin(t * 0.7) * Math.sin(t * 1.9);
    set(n.wind.g.gain, q * q * (inside ? (fm.isGA ? 0.3 : 0.2) : 0.32) * gust); set(n.wind.fl.frequency, 250 + ias * 3.2);
    set(n.windHi.g.gain, Math.pow(q, 3) * (inside ? 0.05 : 0.08));
    set(n.gearAero.g.gain, fm.gearPos * q * q * 0.22 + fm.flap * q * q * 0.06);
    set(n.buffet.g.gain, (fm.spoiler || 0) * q * q * 0.35 + (o.stall ? 0.25 : 0));
    // ---- runway roll: rumble and tyre hiss with speed, plus wheel thumps over joints / centreline lights
    const gs = o.gs;
    if (fm.onGround) {
      set(n.roll.g.gain, clamp(gs / 130, 0, 1) * 0.4 + (gs > 1 ? 0.03 : 0)); set(n.roll.fl.frequency, 80 + gs * 1.2);
      set(n.tyre.g.gain, clamp(gs / 150, 0, 1) * 0.07);
      st.distAcc += gs * 0.5144 * dt;
      if (gs > 3 && st.distAcc > st.nextJoint) { st.distAcc = 0; st.nextJoint = 18 + Math.random() * 30; this.thump(clamp(0.05 + gs / 600, 0.05, 0.25), 90 + Math.random() * 40, true); }
    } else { set(n.roll.g.gain, 0, 0.03); set(n.tyre.g.gain, 0, 0.03); }
    // touchdown squeal (main gear spin-up)
    if (st.onGround === false && fm.onGround) { st.landed = true; this.squeal(clamp(gs / 140, 0.3, 1) * clamp(0.6 + -o.vs / 500, 0.6, 1.4)); }
    if (!fm.onGround && fm.out.agl > 50) st.landed = false;
    st.onGround = fm.onGround;
    // ---- gear: hydraulic pump whine while in transit, lock clunk at either end
    const gp = fm.gearPos;
    if (st.gear != null && !fm.ac.geo?.fixedGear) {
      const moving = Math.abs(gp - st.gear) > 1e-5;
      set(n.hyd.g.gain, moving ? 0.018 : 0, 0.15); set(n.hydN.g.gain, moving ? 0.025 : 0, 0.15);
      set(n.hyd.o.frequency, moving ? 290 + 40 * Math.sin(gp * 9) : 250);
      if ((gp >= 1 && st.gear < 1) || (gp <= 0 && st.gear > 0)) this.clunk(gp >= 1 ? 0.7 : 0.55);
      if (gp > 0 && gp < 1 && st.gear === (fm.gearDown ? 0 : 1)) this.clunk(0.3); // uplock release / door
    }
    st.gear = gp;
    // ---- flaps: motor whine while moving
    if (st.flap != null) { const mv = Math.abs(fm.flap - st.flap) > 1e-5 || Math.abs((fm.slat || 0) - (st.slat || 0)) > 1e-5; set(n.flapM.g.gain, mv ? 0.016 : 0, 0.12); }
    st.flap = fm.flap; st.slat = fm.slat;
    // ---- spoilers: deploy thump (hydraulic) when they start to come up
    const sp = fm.spoiler || 0;
    if (sp > 0.15 && st.spoiler <= 0.15) this.clunk(fm.onGround ? 0.6 : 0.3);
    st.spoiler = sp;
    // ---- cockpit ambience
    set(n.fans.g.gain, 0.022); set(n.fans2.g.gain, 0.004); set(n.hum.g.gain, fm.isGA ? 0 : 0.0016);
    // ---- stall: stick shaker; overspeed: clacker (Boeing-style) or continuous repetitive chime (Airbus)
    set(n.shaker.g.gain, o.stall && !fm.isGA ? 0.12 : 0, 0.03);
    if (o.stall && !st.stall && this.maker === 'Airbus') this.voice.callout('Stall. Stall.');
    if (o.stall && !st.stall && fm.isGA) this.stallHorn();
    st.stall = o.stall;
    const vs = fm.vspeeds?.();
    const over = vs && !fm.onGround && (o.ias > vs.vmo + 4 || o.mach > vs.mmo + 0.008);
    if (over) {
      st.clackT -= dt;
      if (st.clackT <= 0) { if (this.maker === 'Airbus') { this.chime(1); st.clackT = 0.5; } else { this.clack(); st.clackT = 1 / 9; } }
    }
    if (over && !st.overspeed) this.masterCaution();
    st.overspeed = over;
    this.callout(fm);
  }

  // ---------------------------------------------------------------- GPWS / callouts
  speak(text, force) {
    const now = performance.now();
    if (!force && now - this.lastSpeak < 900) return;
    this.lastSpeak = now;
    this.voice.callout(text);
  }
  callout(fm) {
    const o = fm.out, cs = this.callouts, airbus = this.maker === 'Airbus';
    const once = (key, text, force = true, repeatMs = 0) => { if (cs.has(key)) return; cs.add(key); this.speak(text, force); if (repeatMs) setTimeout(() => cs.delete(key), repeatMs); };
    if (fm.onGround) {
      if (o.ias < 30) { for (const k of [...cs]) if (!k.startsWith('ra')) cs.delete(k); }
      if (o.ias < 30 && o.gs < 30) cs.clear();
      const vs = this.vs;
      if (vs && fm.ctl.throttle > 0.5 && !fm.reversers) {
        if (o.ias > vs.vr - 6) once('v1', 'V one');
        if (o.ias > vs.vr) once('rot', 'Rotate');
      }
      // Airbus "retard" keeps calling until the thrust levers are at idle
      if (airbus && cs.has('retard') && fm.ctl.throttle > 0.05 && fm.groundTime < 3 && !cs.has('retard2')) { cs.add('retard2'); this.speak('Retard', true); setTimeout(() => cs.delete('retard2'), 1300); }
      return;
    }
    const alts = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
    if (o.vs > 300) { for (const a of alts) if (o.agl > a + 150) cs.delete('ra' + a); cs.delete('retard'); return; }
    const words = airbus
      ? { 2500: 'Two thousand five hundred', 1000: 'One thousand', 500: 'Five hundred', 400: 'Four hundred', 300: 'Hundred above', 200: 'Minimum', 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' }
      : { 2500: 'Twenty five hundred', 1000: 'One thousand', 500: 'Five hundred', 300: 'Approaching minimums', 200: 'Minimums', 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' };
    for (const a of alts) {
      if (o.agl < a && o.agl > a - (a <= 50 ? 9 : 60) && !cs.has('ra' + a) && o.vs < -50) {
        cs.add('ra' + a);
        if (!words[a]) break;
        this.speak(words[a], true);
        // Airbus: "RETARD" at 20 ft for a manual landing, 10 ft in autoland
        const auto = fm.ap?.engaged;
        if (airbus && a === (auto ? 10 : 20) && !cs.has('retard')) { cs.add('retard'); setTimeout(() => { if (!fm.onGround || fm.ctl.throttle > 0.05) this.speak('Retard. Retard.', true); }, 650); }
        break;
      }
    }
    // GPWS modes (simplified envelopes)
    const agl = o.agl, sink = -o.vs;
    if (agl < 2450 && agl > 30 && sink > 0) {
      if (sink > 1700 + agl * 0.9) once('pullup', 'Whoop whoop. Pull up!', true, 2500);
      else if (sink > 1000 + agl * 0.75) once('sink', 'Sink rate. Sink rate.', true, 3500);
    }
    if (fm.gearPos < 0.5 && agl < 500 && agl > 20 && sink > 200 && o.ias < 190 && !fm.ac.geo?.fixedGear) once('gear', 'Too low. Gear!', true, 4000);
    else if (fm.gearPos > 0.98 && agl < 245 && agl > 20 && sink > 200 && o.ias < 159 && fm.flapIndex < fm.flapLevels.length - 2 && !fm.isGA) once('flaps', 'Too low. Flaps!', true, 4000);
    if (Math.abs(o.roll) > 35 && agl > 30 && !fm.isGA) once('bank', 'Bank angle. Bank angle.', true, 3500);
    const ils = fm.ap?.ilsData;
    if (ils && fm.ap.vert === 'GS' && agl < 1000 && agl > 150 && ils.aimDist > 0) {
      const dev = Math.atan2(ils.gsDev, ils.aimDist) * 57.3;
      if (dev < -0.45) once('gs', 'Glideslope', true, 3000);
    }
  }

  // ---------------------------------------------------------------- one-shot effects
  _env(g, t0, peak, a, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  _noiseShot(dest, type, f, q, peak, a, d, t0, rate = 1) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); this._env(g, t0, peak, a, d);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t0, Math.random() * 3); s.stop(t0 + a + d + 0.05);
    return { s, fl, g };
  }
  _tone(dest, type, f, peak, a, d, t0, f2) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
    const g = c.createGain(); this._env(g, t0, peak, a, d);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + a + d + 0.05);
    return { o, g };
  }
  thump(strength = 1, freq = 150, small = false) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime, dest = this.n ? this.extIn : this.master;
    this._noiseShot(dest, 'lowpass', freq, 1.2, clamp(0.55 * strength, 0.002, 0.9), 0.004, small ? 0.12 : 0.45, t0, 0.7);
    this._tone(dest, 'sine', small ? 70 : 55, clamp(0.35 * strength, 0.002, 0.7), 0.003, small ? 0.08 : 0.3, t0, small ? 45 : 32);
  }
  clunk(strength = 0.5) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime, dest = this.n ? this.extIn : this.master;
    this._noiseShot(dest, 'bandpass', 220, 1.5, 0.25 * strength, 0.002, 0.18, t0);
    this._tone(dest, 'triangle', 95, 0.2 * strength, 0.002, 0.15, t0, 60);
  }
  squeal(strength = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime, dest = this.n ? this.extIn : this.master;
    // two or three short chirps as each bogie spins up, plus a puff of tyre smoke noise
    const n = strength > 0.7 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const ti = t0 + i * (0.05 + Math.random() * 0.07);
      this._tone(dest, 'sawtooth', 1100 + Math.random() * 300, 0.05 * strength, 0.01, 0.22, ti, 650);
      this._noiseShot(dest, 'bandpass', 2400 + Math.random() * 800, 2.5, 0.16 * strength, 0.008, 0.25, ti);
    }
    this._noiseShot(dest, 'lowpass', 600, 0.7, 0.08 * strength, 0.02, 0.6, t0);
  }
  click() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    this._tone(this.alertBus, 'square', 2600, 0.05, 0.001, 0.012, t0);
    this._noiseShot(this.alertBus, 'highpass', 3000, 0.7, 0.06, 0.001, 0.03, t0);
  }
  clack() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    this._noiseShot(this.alertBus, 'bandpass', 1800, 3, 0.22, 0.001, 0.035, t0);
    this._tone(this.alertBus, 'square', 900, 0.06, 0.001, 0.03, t0);
  }
  stallHorn() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    this._tone(this.alertBus, 'sawtooth', 1650, 0.035, 0.05, 1.6, t0, 1600);
  }
  // single chime (Airbus-style "ding"): inharmonic bell partials
  chime(strength = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    for (const [m, a] of [[1, 1], [2.0, 0.35], [2.76, 0.25], [5.4, 0.1]]) this._tone(this.alertBus, 'sine', 740 * m, 0.09 * a * strength, 0.004, 1.1 / Math.sqrt(m), t0);
  }
  masterCaution() { this.chime(1); }
  // autopilot disconnect: Airbus "cavalry charge" bugle call; Boeing-style two-tone "wailer"
  apDisconnect() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime;
    if (this.maker === 'Airbus') {
      const notes = [[392, 0, 0.11], [523.3, 0.12, 0.11], [659.3, 0.24, 0.11], [784, 0.36, 0.3], [659.3, 0.7, 0.1], [784, 0.82, 0.55]];
      for (const [f, dt, dur] of notes) {
        const ti = t0 + dt;
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = f * 0.006; vib.connect(vg); vg.connect(o.frequency);
        const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 2;
        fl.frequency.setValueAtTime(500, ti); fl.frequency.linearRampToValueAtTime(3200, ti + 0.04); fl.frequency.linearRampToValueAtTime(1800, ti + dur);
        const g = c.createGain(); g.gain.setValueAtTime(0, ti); g.gain.linearRampToValueAtTime(0.07, ti + 0.02); g.gain.setValueAtTime(0.06, ti + dur - 0.03); g.gain.linearRampToValueAtTime(0, ti + dur);
        o.connect(fl); fl.connect(g); g.connect(this.alertBus); o.start(ti); vib.start(ti); o.stop(ti + dur + 0.05); vib.stop(ti + dur + 0.05);
      }
    } else {
      const o = c.createOscillator(); o.type = 'square';
      for (let i = 0; i < 6; i++) { o.frequency.setValueAtTime(i % 2 ? 1160 : 820, t0 + i * 0.25); }
      const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 2400;
      const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.045, t0 + 0.02); g.gain.setValueAtTime(0.045, t0 + 1.45); g.gain.linearRampToValueAtTime(0, t0 + 1.5);
      o.connect(fl); fl.connect(g); g.connect(this.alertBus); o.start(t0); o.stop(t0 + 1.55);
    }
  }

  // ---------------------------------------------------------------- radio (used by ATC)
  radioInit() {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.pinkBuf; s.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
    this.staticG = c.createGain(); this.staticG.gain.value = 0;
    // slow flutter on the static, like a real AM VHF carrier
    const lfo = c.createOscillator(); lfo.frequency.value = 3.3; const lg = c.createGain(); lg.gain.value = 0;
    lfo.connect(lg); lg.connect(this.staticG.gain); this.staticFlutter = lg;
    s.connect(hp); hp.connect(lp); lp.connect(this.staticG); this.staticG.connect(this.radioBus); s.start(); lfo.start();
  }
  // key / unkey the radio: squelch click on, static while talking, squelch tail when released
  radioKey(on, role = 'atc', silent = false) {
    if (!this.ctx || !this.staticG) return;
    const c = this.ctx, t = c.currentTime;
    const lvl = role === 'pilot' ? 0.006 : 0.016;
    this.staticG.gain.setTargetAtTime(on && !this.muted ? lvl : 0, t, 0.015);
    this.staticFlutter.gain.setTargetAtTime(on && !this.muted ? lvl * 0.35 : 0, t, 0.015);
    if (this.muted || silent) return;
    if (on) { this._tone(this.radioBus, 'square', 1400, 0.03, 0.001, 0.01, t); this._noiseShot(this.radioBus, 'bandpass', 2200, 0.8, 0.05, 0.002, 0.05, t); }
    else if (role !== 'pilot') this._noiseShot(this.radioBus, 'bandpass', 1800, 0.6, 0.06, 0.005, 0.16, t + 0.02);
    else this._tone(this.radioBus, 'square', 1100, 0.02, 0.001, 0.01, t);
  }
}
