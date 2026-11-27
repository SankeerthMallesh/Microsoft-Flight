// Keyboard, mouse and gamepad / joystick input.
import { clamp } from './sim/math.js';

export const KEY_HELP = [
  ['Pitch', '↑ / ↓  (↓ = nose up, like pulling a yoke)'], ['Roll / taxi steering', '← / →'], ['Rudder / nosewheel', 'Q / E  or  A / D'],
  ['Throttle', 'W / S  ·  PgUp / PgDn  ·  F1 idle · F4 full'], ['Flaps', 'F extend · R retract'], ['Landing gear', 'G'],
  ['Brakes', 'B (hold) · N parking brake'], ['Pushback (at the gate)', 'J start / stop · A / D swing the tail'], ['Speedbrake', '/  toggle · Shift+/ arm'], ['Reverse thrust', 'T (on ground)'],
  ['Trim', '[ nose down · ] nose up  (Home / End)'], ['Autopilot', 'Z master · X autothrottle'], ['Camera', 'C cycle · 1 cockpit · 2 chase · 3 orbit · 4 fly-by'],
  ['Systems / overhead panel', 'O  (electrics, APU, engine start, fuel, lights, failures)'], ['Electronic checklist', 'I'],
  ['Engine auto-start / shutdown', 'Ctrl+E (or Shift+E)  ·  Ctrl+Shift+E shut down'], ['Lights', 'Shift+L landing · Ctrl+Shift+L all external lights'],
  ['Autobrake', 'Shift+B cycle OFF / LO / MED / MAX / RTO'], ['Alternate gear extension', 'Shift+G'], ['Master caution / warning', 'Shift+M (or click the light) to reset'],
  ['Mouse flying', 'Y toggles mouse-yoke mode (steer with the pointer)'], ['Look / orbit', 'Drag mouse · wheel zoom · V reset view'], ['Map / fly to airport', 'M map · click an airport → Fly here'], ['Autopilot route', 'LNAV + VNAV on the panel fly to your destination'], ['Cockpit panel', 'H show / hide'], ['Air traffic control', '` or L opens the ATC window · 1–9 pick a request while it is open'], ['Pause / menu', 'P or Esc'], ['Mute sound', 'U'],
];

export class Input {
  constructor() {
    this.keys = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.throttleDelta = 0;
    this.handlers = {};
    this.mouse = { dx: 0, dy: 0, wheel: 0, down: false };
    this.invertPitch = false;
    this.enabled = false;
    this.gpPrev = [];
    this.joyThrottle = null;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }
  on(action, fn) { this.handlers[action] = fn; }
  fire(action, arg) { if (this.handlers[action]) this.handlers[action](arg); }

  attachMouse(el) {
    el.addEventListener('pointerdown', (e) => { if (!this.enabled) return; this.mouse.down = true; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.yoke = { x: (e.clientX - r.left - r.width / 2) / (r.width * 0.28), y: (e.clientY - r.top - r.height / 2) / (r.height * 0.28) };
      if (!this.mouse.down) return;
      this.mouse.dx += e.clientX - this.mouse.lx; this.mouse.dy += e.clientY - this.mouse.ly; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
    });
    const up = () => { this.mouse.down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { if (!this.enabled) return; this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  takeMouse() { const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel }; this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0; return m; }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key;
    if (down) {
      if (k === 'Escape' || k === 'p' || k === 'P') { this.fire('pause'); e.preventDefault(); return; }
      if (!this.enabled) return;
      const flightKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'F1', 'F2', 'F3', 'F4', '/', ' '];
      if (flightKeys.includes(k)) e.preventDefault();
      if (!e.repeat) {
        const lower = k.length === 1 ? k.toLowerCase() : k;
        const map = {
          y: 'mouseYoke', o: 'systems', i: 'checklist', g: 'gear', f: 'flapsDown', r: 'flapsUp', n: 'parkingBrake', j: 'pushback', t: 'reversers', z: 'ap', x: 'at', c: 'camera', h: 'panel', m: 'map', u: 'mute', v: 'resetView',
          '1': 'cam1', '2': 'cam2', '3': 'cam3', '4': 'cam4', F1: 'idle', F4: 'full', '?': 'help', k: 'help',
        };
        // modifier combos for the systems (checked before the plain keys)
        const combo = (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + lower;
        const comboMap = { 'ctrl+e': 'autostart', 'shift+e': 'autostart', 'ctrl+shift+e': 'shutdown', 'shift+l': 'landingLights', 'ctrl+shift+l': 'allLights', 'shift+b': 'autobrake', 'shift+g': 'altGear', 'shift+m': 'masterAck' };
        if (comboMap[combo]) { this.fire(comboMap[combo]); e.preventDefault(); }
        else if (e.ctrlKey || e.metaKey) { /* leave browser shortcuts alone */ }
        else if (k === '/' ) { this.fire(e.shiftKey ? 'spoilerArm' : 'spoiler'); }
        else if (map[lower]) this.fire(map[lower]);
      }
    }
    if (down) this.keys.add(k.length === 1 ? k.toLowerCase() : k); else this.keys.delete(k.length === 1 ? k.toLowerCase() : k);
  }

  // Returns control state for this frame
  poll(dt, fm) {
    const k = this.keys;
    const a = this.axes;
    const target = (neg, pos) => (pos ? 1 : 0) - (neg ? 1 : 0);
    let tp = target(k.has('ArrowUp'), k.has('ArrowDown'));
    if (this.invertPitch) tp = -tp;
    const tr = target(k.has('ArrowLeft'), k.has('ArrowRight'));
    const ty = target(k.has('q') || k.has('a'), k.has('e') || k.has('d'));
    const ramp = (cur, tgt, up = 2.2, back = 4) => {
      const rate = tgt !== 0 ? up : back;
      if (tgt === 0) return Math.abs(cur) < rate * dt ? 0 : cur - Math.sign(cur) * rate * dt;
      return clamp(cur + clamp(tgt - cur, -rate * dt * (Math.sign(tgt) !== Math.sign(cur) && cur !== 0 ? 2 : 1), rate * dt), -1, 1);
    };
    a.pitch = ramp(a.pitch, tp * 0.85, 3.2, 5); a.roll = ramp(a.roll, tr, 4, 6); a.yaw = ramp(a.yaw, ty, 3, 4);
    let thr = 0;
    if (k.has('w') || k.has('PageUp') || k.has('F3') || k.has('+') || k.has('=')) thr += 0.7;
    if (k.has('s') || k.has('PageDown') || k.has('F2') || k.has('-')) thr -= 0.7;
    let trim = 0;
    if (k.has('[') || k.has('Home')) trim -= 0.25;
    if (k.has(']') || k.has('End')) trim += 0.25;
    let brake = k.has('b') ? 1 : 0;
    let out = { pitch: a.pitch, roll: a.roll, yaw: a.yaw, throttleRate: thr, throttleAbs: null, brake, trimRate: trim, look: null };
    // mouse yoke: pointer offset from screen centre acts as the control column
    if (this.mouseYoke && this.yoke && !this.mouse.down && !tp && !tr) {
      const dz = (v) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      out.pitch = dz(clamp(this.yoke.y, -1, 1)) * (this.invertPitch ? -1 : 1);
      out.roll = dz(clamp(this.yoke.x, -1, 1));
    }
    this.pollGamepad(out, dt);
    return out;
  }

  pollGamepad(out, dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v, d = 0.08) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      const btn = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const prev = this.gpPrev[gp.index] || [];
      const pressed = (i) => btn(i) && !prev[i];
      if (gp.mapping === 'standard') {
        const p = dz(gp.axes[1]), r = dz(gp.axes[0]), y = dz(gp.axes[2]);
        if (p) out.pitch = this.invertPitch ? -p : p;
        if (r) out.roll = r;
        if (y) out.yaw = y;
        const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
        if (rt > 0.05 || lt > 0.05) out.throttleRate += (rt - lt) * 0.5;
        if (btn(4)) out.brake = 1;
        if (btn(12)) out.trimRate -= 0.25; if (btn(13)) out.trimRate += 0.25;
        if (pressed(0)) this.fire('gear'); if (pressed(1)) this.fire('spoiler'); if (pressed(2)) this.fire('flapsDown'); if (pressed(3)) this.fire('flapsUp');
        if (pressed(5)) this.fire('ap'); if (pressed(8)) this.fire('camera'); if (pressed(9)) this.fire('pause'); if (pressed(10)) this.fire('reversers');
        const lx = dz(gp.axes[3] || 0, 0.15);
        if (lx) out.look = { pitch: -lx };
      } else {
        // generic joystick / HOTAS
        const p = dz(gp.axes[1] || 0, 0.04), r = dz(gp.axes[0] || 0, 0.04);
        if (p) out.pitch = this.invertPitch ? -p : p; if (r) out.roll = r;
        const twist = gp.axes[5] ?? gp.axes[3];
        if (twist !== undefined && Math.abs(twist) > 0.08) out.yaw = dz(twist, 0.08);
        if (gp.axes[2] !== undefined) {
          const t = (1 - gp.axes[2]) / 2;
          if (this.joyThrottle === null) this.joyThrottle = t;
          if (Math.abs(t - this.joyThrottle) > 0.02 || this.joyActive) { this.joyActive = true; out.throttleAbs = t; }
        }
        if (btn(0)) out.brake = 1;
        if (pressed(1)) this.fire('gear'); if (pressed(2)) this.fire('flapsDown'); if (pressed(3)) this.fire('flapsUp'); if (pressed(4)) this.fire('ap'); if (pressed(5)) this.fire('camera');
      }
      this.gpPrev[gp.index] = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    }
  }
}
