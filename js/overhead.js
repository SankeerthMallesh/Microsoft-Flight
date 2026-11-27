// Systems UI: overhead / systems panel (O), failures menu, master caution / warning annunciators
// with an EICAS-style alert list, and the cockpit chimes. Builds its own DOM inside #flightUI.
import { AUTOBRAKE_LEVELS, LIGHTS } from './sim/systems.js';

const LIGHT_NAMES = { nav: 'NAV', beacon: 'BEACON', strobe: 'STROBE', landing: 'LANDING', taxi: 'TAXI', logo: 'LOGO', wing: 'WING' };
const PHASE = { off: 'OFF', crank: 'START', lightoff: 'IGN', accel: 'START', run: 'RUN' };

// ---------------------------------------------------------------- chimes (Web Audio)
class Chimes {
  constructor(audio) { this.audio = audio; this.ctx = null; this.loop = null; }
  ac() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  vol() { return this.audio && this.audio.muted ? 0 : (this.audio?.volume ?? 0.7) * 0.5; }
  tone(f, t0, dur, type = 'sine', g = 0.5) {
    const c = this.ac(); if (!c || !this.vol()) return;
    const o = c.createOscillator(), a = c.createGain();
    o.type = type; o.frequency.value = f;
    a.gain.setValueAtTime(0, c.currentTime + t0); a.gain.linearRampToValueAtTime(g * this.vol(), c.currentTime + t0 + 0.01);
    a.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + t0 + dur);
    o.connect(a); a.connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  play(kind) {
    if (kind === 'pax') { this.tone(1046, 0, 1.4, 'sine', 0.35); this.tone(784, 0.55, 1.6, 'sine', 0.35); return; } // "bing-bong"
    if (kind === 'caution') { this.tone(880, 0, 0.9, 'sine', 0.45); this.tone(1760, 0, 0.6, 'sine', 0.12); return; } // single chime
    if (kind === 'warning') { for (let i = 0; i < 3; i++) this.tone(1400, i * 0.28, 0.24, 'triangle', 0.35); return; } // repetitive chime
    if (kind === 'fire') { for (let i = 0; i < 8; i++) this.tone(i % 2 ? 620 : 760, i * 0.09, 0.09, 'square', 0.12); return; } // fire bell
    if (kind === 'click') this.tone(2400, 0, 0.03, 'square', 0.08);
  }
}

export class SystemsUI {
  constructor(root, { toast, audio } = {}) {
    this.root = root; this.toast = toast || (() => {}); this.chimes = new Chimes(audio);
    this.sys = null; this.tab = 'sys'; this.open = false; this.lastRender = 0; this.warnLoop = 0;
    // annunciators
    this.ann = document.createElement('div'); this.ann.id = 'sysAnn';
    this.ann.innerHTML = '<button id="mWarn" class="mw" title="Master WARNING — click to reset">MASTER<br>WARNING</button><button id="mCaut" class="mc" title="Master CAUTION — click to reset">MASTER<br>CAUTION</button><div id="sysAlerts"></div>';
    root.appendChild(this.ann);
    this.ann.addEventListener('click', (e) => { if (e.target.closest('#mWarn,#mCaut')) this.sys?.acknowledge(); });
    // panel
    this.el = document.createElement('div'); this.el.id = 'sysPanel'; this.el.className = 'hidden';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  attach(sys) {
    this.sys = sys;
    sys.onEvent = (ev) => {
      if (ev.type === 'chime') this.chimes.play(ev.kind);
      else if (ev.type === 'msg') this.toast(ev.text, ev.kind || '');
    };
    this.render(true);
  }
  toggle(tab) {
    if (tab && this.open && this.tab !== tab) { this.tab = tab; this.render(true); return; }
    this.open = !this.open; if (tab) this.tab = tab;
    this.el.classList.toggle('hidden', !this.open); this.render(true);
  }

  onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || !this.sys) return;
    const S = this.sys, [a, arg] = b.dataset.a.split(':');
    const i = arg !== undefined ? +arg : undefined;
    this.chimes.play('click');
    switch (a) {
      case 'tab': this.tab = arg; break;
      case 'close': this.toggle(); return;
      case 'sw': S.set(arg); break;
      case 'start': S.startEngine(i); break;
      case 'cut': S.shutdownEngine(i); break;
      case 'fire': S.fireHandle(i); break;
      case 'auto': S.autoStart(); break;
      case 'shut': S.autoShutdown(); break;
      case 'ab': S.setAutobrake(arg); break;
      case 'altgear': S.altGearExtension(); break;
      case 'f-eng': S.fail('engine', i); break;
      case 'f-fire': S.fail('engineFire', i); break;
      case 'f-seize': S.fail('engineSeize', i); break;
      case 'f-hyd': S.fail('hydraulic', arg); break;
      case 'f-gear': S.fail('gear'); break;
      case 'f-elec': S.fail('elec'); break;
      case 'f-rand': S.scheduleRandom(20); break;
      case 'repair': S.repairAll(); break;
      default: break;
    }
    this.render(true);
  }

  update() {
    const S = this.sys; if (!S) return;
    const now = performance.now();
    // annunciators flash while unacknowledged; the repetitive warning chime repeats
    const blink = Math.floor(now / 450) % 2 === 0;
    this.ann.querySelector('#mWarn').classList.toggle('on', S.masterWarn && blink);
    this.ann.querySelector('#mCaut').classList.toggle('on', S.masterCaution && blink);
    if (!S.masterWarn) this.warnLoop = now;
    else if (now - this.warnLoop > 2400) { this.warnLoop = now; this.chimes.play(S.alerts.some((a) => a.id.startsWith('fire') && !S.ackd.has(a.id)) ? 'fire' : 'warning'); }
    if (now - this.lastRender > 250) { this.lastRender = now; this.renderAlerts(); if (this.open) this.render(); }
  }
  renderAlerts() {
    const S = this.sys, box = this.ann.querySelector('#sysAlerts');
    const list = S.elec.dc ? S.alerts.slice().sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1)).slice(0, 6) : [];
    const html = list.map((a) => `<div class="al ${a.level}">${a.text}</div>`).join('');
    if (box.innerHTML !== html) box.innerHTML = html;
    this.ann.classList.toggle('idle', !list.length && !S.masterWarn && !S.masterCaution);
  }

  render(force) {
    const S = this.sys; if (!S || (!this.open && !force)) return;
    const fm = S.fm;
    const sw = (key, label, on = S.get(key), extra = '') => `<button class="sw ${on ? 'on' : ''}" data-a="sw:${key}">${label}<i>${extra || (on ? 'ON' : 'OFF')}</i></button>`;
    const tabs = `<div class="tabs"><button data-a="tab:sys" class="${this.tab === 'sys' ? 'act' : ''}">Systems</button><button data-a="tab:eng" class="${this.tab === 'eng' ? 'act' : ''}">Engines &amp; fuel</button><button data-a="tab:fail" class="${this.tab === 'fail' ? 'act' : ''}">Failures</button><button class="x" data-a="close" title="Close (O)">✕</button></div>`;
    let body = '';
    if (this.tab === 'sys') {
      const A = S.apu;
      const apuStat = !S.hasApu ? '' : A.avail ? 'AVAIL' : A.state === 'starting' ? `${Math.round(A.n)}%` : A.state === 'cooldown' ? 'COOL' : '';
      body += `<h5>Electrical</h5><div class="row">${sw('battery', 'BATTERY')}${S.kind !== 'ga' ? sw('extPower', 'GRD PWR', S.elec.extPower, S.elec.extPower ? 'ON' : 'AVAIL') : ''}
        ${S.hasApu ? sw('apu', 'APU', A.master, apuStat || 'OFF') + sw('apuBleed', 'APU BLEED') : ''}</div>
        <div class="stat">AC ${S.elec.ac ? '<b class="g">POWERED</b>' : '<b class="a">OFF</b>'} · DC ${S.elec.dc ? '<b class="g">ON</b>' : '<b class="a">OFF</b>'} · BAT ${Math.round(S.elec.charge * 100)}%${S.hasApu ? ` · APU N ${Math.round(A.n)}% EGT ${Math.round(A.egt)}°C` : ''}</div>`;
      body += `<h5>External lights</h5><div class="row">${LIGHTS.map((k) => sw(k, LIGHT_NAMES[k])).join('')}</div>`;
      body += `<h5>Cabin signs</h5><div class="row">${sw('seatbelt', 'SEAT BELTS')}${sw('noSmoking', 'NO SMOKING')}</div>`;
      if (S.abAvail) body += `<h5>Autobrake</h5><div class="row">${AUTOBRAKE_LEVELS.map((lv) => `<button class="sw ${S.autobrake === lv ? 'on' : ''}" data-a="ab:${lv}">${S.abLabel(lv)}<i>${S.autobrake === lv ? (S.abActive || S.rtoActive ? 'BRAKING' : 'ARMED') : ''}</i></button>`).join('')}</div>`;
      if (S.hyd.length) body += `<h5>Hydraulics</h5><div class="row">${S.hyd.map((h) => `<span class="gauge ${h.press > 1500 ? 'g' : 'a'}">${h.name}<b>${Math.round(h.press / 10) * 10} psi</b></span>`).join('')}${sw('hydPumps', 'ELEC PUMPS')}</div>`;
      if (!fm.ac.geo.fixedGear) body += `<div class="row"><button class="sw" data-a="altgear">ALTN GEAR<i>${fm.gearAltExt ? 'EXTENDED' : 'GRAVITY'}</i></button></div>`;
    } else if (this.tab === 'eng') {
      body += `<div class="row"><button class="sw big" data-a="auto">AUTO START<i>Ctrl+E</i></button><button class="sw big" data-a="shut">SHUT DOWN<i>Ctrl+Shift+E</i></button></div>`;
      body += `<table class="eng"><tr><th></th>${fm.engines.map((_, i) => `<th>ENG ${i + 1}</th>`).join('')}</tr>
        <tr><td>${fm.isJet ? 'N1' : fm.isGA ? 'RPM' : 'NP'}</td>${fm.engines.map((e) => `<td>${e.n1.toFixed(1)}</td>`).join('')}</tr>
        ${fm.isGA ? '' : `<tr><td>${fm.isJet ? 'N2' : 'NH'}</td>${fm.engines.map((e) => `<td>${e.n2.toFixed(1)}</td>`).join('')}</tr>`}
        <tr><td>${fm.isJet ? 'EGT' : fm.isGA ? 'EGT' : 'ITT'}</td>${fm.engines.map((e) => `<td>${Math.round(e.egt)}°</td>`).join('')}</tr>
        <tr><td>FF kg/h</td>${fm.engines.map((e) => `<td>${Math.round(e.ff * 3600)}</td>`).join('')}</tr>
        <tr><td>State</td>${fm.engines.map((e, i) => { const st = S.eng[i]; return `<td class="${st.fire ? 'r' : e.running ? 'g' : ''}">${st.fire ? 'FIRE' : PHASE[st.phase] || st.phase}${st.starter ? ' · STARTER' : ''}${st.phase === 'lightoff' ? ' · FUEL' : ''}</td>`; }).join('')}</tr>
        <tr><td></td>${fm.engines.map((e, i) => `<td><button data-a="start:${i}" ${e.running ? 'disabled' : ''}>START</button><button data-a="cut:${i}">CUTOFF</button></td>`).join('')}</tr>
        <tr><td>Fire</td>${fm.engines.map((e, i) => `<td><button class="fireh ${S.eng[i].fire ? 'lit' : ''}" data-a="fire:${i}">${S.eng[i].handle ? (S.eng[i].bottle ? 'DISCH' : 'PULLED') : 'PULL'}</button></td>`).join('')}</tr></table>`;
      body += `<h5>Fuel <span class="muted">${Math.round(fm.fuel).toLocaleString()} kg total</span></h5><div class="row">${S.tanks.map((t) => `<span class="gauge ${t.q > 1 ? 'g' : 'a'}">${t.name}<b>${Math.round(t.q).toLocaleString()} kg</b><u style="width:${Math.round((t.q / t.cap) * 100)}%"></u></span>`).join('')}</div>
        <div class="row">${sw('fuelPumps', 'FUEL PUMPS')}${fm.engines.length > 1 ? sw('crossfeed', 'X-FEED') : ''}</div>`;
    } else {
      body += `<p class="muted">Failures happen immediately (or at a random moment). Use the checklist (J) and the alerts to manage them. “Repair all” resets.</p>`;
      body += `<h5>Engines</h5><div class="row">${fm.engines.map((_, i) => `<button class="fb" data-a="f-eng:${i}">ENG ${i + 1} FAIL</button><button class="fb" data-a="f-fire:${i}">ENG ${i + 1} FIRE</button>`).join('')}${fm.engines.map((_, i) => `<button class="fb" data-a="f-seize:${i}">ENG ${i + 1} SEIZE</button>`).join('')}</div>`;
      if (S.hyd.length) body += `<h5>Hydraulics</h5><div class="row">${S.hyd.map((h) => `<button class="fb" data-a="f-hyd:${h.id}">${h.name}</button>`).join('')}<button class="fb" data-a="f-hyd:all">ALL SYSTEMS</button></div>`;
      body += `<h5>Other</h5><div class="row">${fm.ac.geo.fixedGear ? '' : '<button class="fb" data-a="f-gear">GEAR JAMMED</button>'}<button class="fb" data-a="f-elec">GENERATORS</button><button class="fb" data-a="f-rand">RANDOM (≤20 min)</button><button class="sw" data-a="repair">REPAIR ALL</button></div>`;
    }
    this.el.innerHTML = `${tabs}<div class="body">${body}</div>`;
  }
}
