// Original generative cinematic ambient score for the menus and loading screens (Web Audio, no files).
// Warm detuned string pads over a slow D-major progression, soft sub bass, a sparse piano-like
// arpeggio and a large synthetic hall reverb.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chords as MIDI notes: [bass, pad voicing..., arpeggio pool...]
const PROGRESSION = [
  { bass: 38, pad: [62, 66, 69, 73, 76], arp: [74, 78, 81, 85, 88, 90] },   // Dmaj9
  { bass: 35, pad: [59, 62, 66, 69, 76], arp: [71, 74, 78, 81, 83, 86] },   // Bm11
  { bass: 31, pad: [59, 62, 66, 67, 73], arp: [71, 74, 79, 81, 83, 86] },   // Gmaj7(#11 colour)
  { bass: 33, pad: [57, 62, 64, 69, 71], arp: [69, 74, 76, 81, 83, 88] },   // A6sus
  { bass: 38, pad: [62, 66, 69, 73, 78], arp: [74, 78, 81, 85, 90, 93] },   // Dmaj9 (lift)
  { bass: 30, pad: [57, 62, 66, 69, 73], arp: [69, 73, 78, 81, 85, 88] },   // F#m7 / D
  { bass: 31, pad: [59, 62, 67, 71, 74], arp: [71, 74, 79, 83, 86, 91] },   // Gmaj9
  { bass: 33, pad: [57, 61, 64, 69, 76], arp: [69, 73, 76, 81, 85, 88] },   // A
];
const CHORD_SEC = 8;

class Music {
  constructor() { this.ctx = null; this.on = false; this.volume = 0.6; this.enabled = true; }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.6;
    this.master.connect(comp); comp.connect(ctx.destination);
    // hall reverb from a generated impulse response (stereo, 5 s exponential tail)
    const len = Math.floor(ctx.sampleRate * 5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 800 ? i / 800 : 1); } }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55; this.verb.connect(wet); wet.connect(this.master);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.55; this.dry.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 1; this.send.connect(this.verb);
    // shared pad filter with a slow breathing sweep
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.6;
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain(); lfo.frequency.value = 0.045; lfoGain.gain.value = 420;
    lfo.connect(lfoGain); lfoGain.connect(this.padFilter.frequency); lfo.start();
    this.padBus = ctx.createGain(); this.padBus.gain.value = 0.16;
    this.padFilter.connect(this.padBus); this.padBus.connect(this.dry); this.padBus.connect(this.send);
    this.keyBus = ctx.createGain(); this.keyBus.gain.value = 0.11; this.keyBus.connect(this.dry); this.keyBus.connect(this.send);
    this.bassBus = ctx.createGain(); this.bassBus.gain.value = 0.22; this.bassBus.connect(this.dry);
    this.step = 0; this.nextChordT = 0; this.nextNoteT = 0;
    return true;
  }

  // ------------------------------------------------------------ voices
  pad(midi, t, dur) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 3.2); g.gain.setValueAtTime(1, t + dur - 0.5); g.gain.linearRampToValueAtTime(0, t + dur + 3.5);
    g.connect(this.padFilter);
    for (const det of [-7, 0, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = det + (Math.random() - 0.5) * 3;
      const og = ctx.createGain(); og.gain.value = 0.33; o.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 4);
    }
  }
  bass(midi, t, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 2.5); g.gain.setValueAtTime(1, t + dur - 0.5); g.gain.linearRampToValueAtTime(0, t + dur + 2);
    o.connect(g); g.connect(this.bassBus); o.start(t); o.stop(t + dur + 2.2);
  }
  key(midi, t, vel = 1) {
    // soft felt-piano / celesta tone: fundamental + quiet harmonics with a long gentle decay
    const ctx = this.ctx, g = ctx.createGain(), f = mtof(midi);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * vel, t + 0.012); g.gain.exponentialRampToValueAtTime(0.25 * vel, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0008, t + 4.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.3;
    g.connect(lp); lp.connect(this.keyBus);
    for (const [mul, amp, type] of [[1, 1, 'triangle'], [2, 0.22, 'sine'], [3, 0.07, 'sine'], [4.01, 0.04, 'sine']]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.value = amp; o.connect(og); og.connect(g); o.start(t); o.stop(t + 4.4);
    }
  }

  // ------------------------------------------------------------ sequencing (look-ahead scheduler)
  tick(now = this.ctx.currentTime) {
    if (!this.on) return;
    const ahead = now + 0.6;
    while (this.nextChordT < ahead) {
      const c = PROGRESSION[this.step % PROGRESSION.length], t = this.nextChordT;
      for (const n of c.pad) this.pad(n, t, CHORD_SEC);
      this.bass(c.bass, t, CHORD_SEC);
      this.curChord = c; this.chordStart = t;
      this.step++; this.nextChordT += CHORD_SEC;
    }
    while (this.nextNoteT < ahead) {
      const t = this.nextNoteT, c = this.curChord;
      const intoChord = t - (this.chordStart || 0);
      // arpeggio gets busier in the middle of each chord, rests at the changes
      const p = intoChord < 0.8 ? 0.25 : intoChord > CHORD_SEC - 1 ? 0.15 : this.step > 2 ? 0.7 : 0.4;
      if (c && Math.random() < p) {
        const pool = c.arp, n = pool[Math.floor(Math.random() * pool.length)];
        this.key(n, t + (Math.random() - 0.5) * 0.03, 0.55 + Math.random() * 0.45);
        if (Math.random() < 0.12) this.key(n + 12, t + 0.36, 0.35); // occasional echo an octave up
      }
      this.nextNoteT += [0.5, 0.75, 0.5, 1.0][Math.floor(Math.random() * 4)];
    }
  }

  // ------------------------------------------------------------ public API
  play() {
    if (!this.enabled || !this.init()) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    if (this.on) return;
    this.on = true;
    const now = ctx.currentTime;
    this.nextChordT = now + 0.1; this.nextNoteT = now + 1.6;
    this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.volume * 1.6, now + 3);
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 200); this.tick();
  }
  stop(fade = 2.5) {
    if (!this.ctx || !this.on) return;
    this.on = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + fade);
    clearInterval(this.timer); this.timer = null;
  }
  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.on) { const now = this.ctx.currentTime; this.master.gain.cancelScheduledValues(now); this.master.gain.linearRampToValueAtTime(v * 1.6, now + 0.4); }
  }
}

export const music = new Music();
