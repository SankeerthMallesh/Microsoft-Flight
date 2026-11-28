// Electronic checklist (toggle with J). Normal procedures per type family (Boeing / Airbus /
// light aircraft), modelled on the manufacturers' normal checklists. Items that the systems can
// sense turn green by themselves (like Boeing's ECL); the others are ticked by clicking them.

const on = (k) => ({ sys }) => sys.get(k);
const off = (k) => ({ sys }) => !sys.get(k);
const engRun = ({ sys }) => sys.allEnginesRunning;
const pbrk = ({ fm }) => fm.parkingBrake;
const flapsTO = ({ fm }) => fm.flapIndex > 0 && fm.flapIndex < fm.flapLevels.length - 1;
const flapsUp = ({ fm }) => fm.flapIndex === 0 && fm.flap < 0.01;
const flapsLand = ({ fm }) => fm.flapIndex >= fm.flapLevels.length - 2;
const gearDn = ({ fm }) => fm.gearDown && fm.gearPos > 0.98;
const gearUp = ({ fm }) => fm.ac.geo.fixedGear || (!fm.gearDown && fm.gearPos < 0.02);
const spdArm = ({ fm }) => fm.spoilersArmed;
const spdDn = ({ fm }) => !fm.spoilersArmed && fm.spoilerHandle === 0;
const abRto = ({ sys }) => !sys.abAvail || sys.autobrake === 'RTO';
const abLand = ({ sys }) => !sys.abAvail || ['LO', 'MED', 'MAX'].includes(sys.autobrake);
const apuOff = ({ sys }) => !sys.hasApu || !sys.apu.master;
const apuAvail = ({ sys }) => !sys.hasApu || sys.apu.avail;
const elecPwr = ({ sys }) => sys.elec.ac || sys.elec.extPower;
const fuelPumps = ({ sys }) => sys.fuelPumps;
const trimSet = ({ fm }) => Math.abs(fm.trim) < 0.6;
const atArmed = ({ ap }) => ap && ap.at;
const engOff = ({ fm }) => fm.engines.every((e) => !e.running);
const allLightsOff = ({ sys }) => !sys.lights.beacon && !sys.lights.strobe && !sys.lights.landing;

const BOEING = [
  { name: 'Preflight', items: [['Battery', 'ON', on('battery')], ['APU', 'START — AVAIL', apuAvail], ['APU bleed', 'ON', ({ sys }) => !sys.hasApu || sys.apu.bleed], ['Fuel pumps', 'ON', fuelPumps], ['Position / nav lights', 'ON', on('nav')], ['Parking brake', 'SET', pbrk]] },
  { name: 'Before start', items: [['Seat belt signs', 'ON', on('seatbelt')], ['Electrical power', 'ESTABLISHED', elecPwr], ['Beacon (anti-collision)', 'ON', on('beacon')], ['Hydraulic pumps', 'ON', on('hydPumps')], ['Doors', 'CLOSED']] },
  { name: 'Engine start', items: [['Engine 2 start', 'STARTER → FUEL at 25 % N2', ({ fm }) => fm.engines[fm.engines.length - 1].running], ['Engine 1 start', 'STARTER → FUEL at 25 % N2', ({ fm }) => fm.engines[0].running], ['All engines', 'STABLE at idle', engRun]] },
  { name: 'Before taxi', items: [['APU', 'OFF', apuOff], ['Flaps', 'SET for take-off', flapsTO], ['Autobrake', 'RTO', abRto], ['Stabilizer trim', 'SET', trimSet], ['Taxi light', 'ON', on('taxi')], ['Flight controls', 'CHECKED']] },
  { name: 'Before take-off', items: [['Landing lights', 'ON', on('landing')], ['Strobe lights', 'ON', on('strobe')], ['Autothrottle', 'ARM', atArmed], ['Parking brake', 'RELEASED', ({ fm }) => !fm.parkingBrake], ['Speedbrake', 'DOWN', ({ fm }) => fm.spoilerHandle === 0]] },
  { name: 'After take-off', items: [['Landing gear', 'UP and OFF', gearUp], ['Flaps', 'UP, no lights', flapsUp], ['Autobrake', 'OFF', ({ sys }) => sys.autobrake === 'OFF'], ['Altimeter', 'SET (STD above transition)']] },
  { name: 'Descent / approach', items: [['Autobrake', 'SET (2 / 3)', abLand], ['Landing data / Vref', 'SET'], ['Seat belt signs', 'ON', on('seatbelt')], ['Landing lights (below 10,000 ft)', 'ON', on('landing')]] },
  { name: 'Landing', items: [['Speedbrake', 'ARMED', spdArm], ['Landing gear', 'DOWN, 3 green', gearDn], ['Flaps', 'LANDING (30 / 40)', flapsLand]] },
  { name: 'After landing', items: [['Speedbrake', 'DOWN', spdDn], ['Strobe lights', 'OFF', off('strobe')], ['Landing lights', 'OFF', off('landing')], ['Flaps', 'UP', flapsUp], ['APU', 'START as required']] },
  { name: 'Shutdown', items: [['Parking brake', 'SET', pbrk], ['Engines', 'CUTOFF', engOff], ['Seat belt signs', 'OFF', off('seatbelt')], ['Beacon', 'OFF', off('beacon')], ['Fuel pumps', 'OFF', off('fuelPumps')]] },
];
const AIRBUS = [
  { name: 'Cockpit preparation', items: [['BAT 1 + 2', 'ON', on('battery')], ['EXT PWR or APU', 'ON / AVAIL', ({ sys }) => sys.elec.extPower || sys.apu.avail], ['APU BLEED', 'ON', ({ sys }) => !sys.hasApu || sys.apu.bleed], ['NAV & LOGO lights', 'ON', ({ sys }) => sys.lights.nav && sys.lights.logo], ['Fuel pumps', 'ON', fuelPumps], ['Parking brake', 'ON', pbrk]] },
  { name: 'Before start', items: [['Seat belts / no smoking', 'ON / AUTO', on('seatbelt')], ['Beacon', 'ON', on('beacon')], ['Thrust levers', 'IDLE', ({ fm }) => fm.ctl.throttle < 0.05], ['Windows / doors', 'CLOSED']] },
  { name: 'Engine start', items: [['ENG MODE selector', 'IGN / START'], ['ENG 2 master', 'ON — fuel at ~22 % N2', ({ fm }) => fm.engines[fm.engines.length - 1].running], ['ENG 1 master', 'ON', ({ fm }) => fm.engines[0].running], ['Engines', 'AVAIL, stable at idle', engRun]] },
  { name: 'After start', items: [['APU BLEED', 'OFF', ({ sys }) => !sys.apu.bleed], ['APU master', 'OFF', apuOff], ['Ground spoilers', 'ARM', spdArm], ['Flaps', 'SET for take-off', flapsTO], ['Pitch trim', 'SET', trimSet]] },
  { name: 'Before take-off', items: [['Auto brake', 'MAX (RTO)', abRto], ['T.O config', 'TEST — no CONFIG warning', ({ sys }) => !sys.alerts.some((a) => a.id.startsWith('cfg'))], ['Taxi & runway turn-off lights', 'ON', on('taxi')], ['Landing lights', 'ON', on('landing')], ['Strobe', 'ON', on('strobe')]] },
  { name: 'After take-off / climb', items: [['Landing gear', 'UP', gearUp], ['Flaps', 'RETRACT (on S speed)', flapsUp], ['Ground spoilers', 'DISARM', ({ fm }) => !fm.spoilersArmed], ['Baro ref', 'SET STD']] },
  { name: 'Approach', items: [['Briefing', 'CONFIRMED'], ['Auto brake', 'LO / MED', abLand], ['Seat belts', 'ON', on('seatbelt')], ['Landing lights', 'ON', on('landing')]] },
  { name: 'Landing', items: [['A/THR', 'SPEED / OFF', atArmed], ['Landing gear', 'DOWN', gearDn], ['Ground spoilers', 'ARM', spdArm], ['Flaps', 'FULL (or 3)', flapsLand], ['Cabin', 'READY']] },
  { name: 'After landing', items: [['Ground spoilers', 'DISARM', spdDn], ['Flaps', 'RETRACT', flapsUp], ['Strobe', 'OFF', off('strobe')], ['Landing lights', 'OFF', off('landing')], ['APU', 'START']] },
  { name: 'Parking', items: [['Parking brake', 'ON', pbrk], ['ENG masters', 'OFF', engOff], ['Beacon', 'OFF', off('beacon')], ['Seat belts', 'OFF', off('seatbelt')], ['Fuel pumps', 'OFF', off('fuelPumps')]] },
];
const GA = [
  { name: 'Before engine start', items: [['Preflight inspection', 'COMPLETE'], ['Seats / belts', 'ADJUSTED, LOCKED'], ['Fuel selector', 'BOTH', fuelPumps], ['Parking brake', 'SET', pbrk], ['Master switch', 'ON', on('battery')], ['Beacon', 'ON', on('beacon')]] },
  { name: 'Engine start', items: [['Mixture', 'RICH'], ['Throttle', 'OPEN ¼ inch', ({ fm }) => fm.ctl.throttle < 0.2], ['Propeller area', 'CLEAR'], ['Magnetos', 'START — release when engine starts', engRun], ['Oil pressure', 'CHECK (green within 30 s)', engRun], ['Nav lights', 'ON', on('nav')]] },
  { name: 'Before take-off (run-up)', items: [['Flight controls', 'FREE and CORRECT'], ['Elevator trim', 'TAKE-OFF', trimSet], ['Flaps', '0°–10°', ({ fm }) => fm.flapIndex <= 1], ['Throttle 1800 RPM', 'MAGS CHECKED (≤150 RPM drop)'], ['Strobes / landing light', 'ON', ({ sys }) => sys.lights.strobe && sys.lights.landing], ['Parking brake', 'RELEASE', ({ fm }) => !fm.parkingBrake]] },
  { name: 'Take-off / climb', items: [['Throttle', 'FULL', ({ fm }) => fm.ctl.throttle > 0.95], ['Rotate', '55 KIAS'], ['Climb', 'Vy 74 KIAS'], ['Flaps', 'UP after obstacles', flapsUp]] },
  { name: 'Cruise', items: [['Power', '2100–2700 RPM (≤75 %)'], ['Elevator trim', 'ADJUST'], ['Mixture', 'LEAN']] },
  { name: 'Before landing', items: [['Seats / belts', 'SECURE', on('seatbelt')], ['Fuel selector', 'BOTH', fuelPumps], ['Mixture', 'RICH'], ['Landing light', 'ON', on('landing')]] },
  { name: 'Landing', items: [['Airspeed', '65–75 KIAS (flaps up), 61 KIAS short field'], ['Flaps', 'AS DESIRED (full below 85 KIAS)', ({ fm }) => fm.flapIndex >= 2], ['Touchdown', 'MAIN WHEELS FIRST'], ['Braking', 'MINIMUM REQUIRED']] },
  { name: 'After landing / securing', items: [['Flaps', 'UP', flapsUp], ['Parking brake', 'SET', pbrk], ['Mixture', 'IDLE CUT-OFF', engOff], ['Magnetos / master', 'OFF', off('battery')], ['Lights', 'OFF', allLightsOff]] },
];

export function checklistsFor(sys) { return sys.brand === 'airbus' ? AIRBUS : sys.brand === 'ga' ? GA : BOEING; }

export class Checklist {
  constructor(root) {
    this.el = document.createElement('div'); this.el.id = 'checklist'; this.el.className = 'hidden';
    root.appendChild(this.el);
    this.open = false; this.idx = 0; this.done = new Set(); this.ctx = null; this.lastHtml = '';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const [a, v] = b.dataset.c.split(':');
      if (a === 'prev') this.idx = Math.max(0, this.idx - 1);
      else if (a === 'next') this.idx = Math.min(this.lists.length - 1, this.idx + 1);
      else if (a === 'sel') this.idx = +v;
      else if (a === 'item') { const k = `${this.idx}:${v}`; this.done.has(k) ? this.done.delete(k) : this.done.add(k); }
      else if (a === 'reset') this.done.clear();
      else if (a === 'close') { this.toggle(); return; }
      this.render(true);
    });
  }
  attach(ctx) {
    this.ctx = ctx; this.lists = checklistsFor(ctx.sys); this.done.clear();
    // start at the phase matching the start state
    const st = ctx.sys.state;
    this.idx = st === 'cold' ? 0 : st === 'taxi' ? this.lists.findIndex((l) => /before (taxi|take)|after start|run-up/i.test(l.name)) : st === 'runway' ? this.lists.findIndex((l) => /before take/i.test(l.name)) : this.lists.findIndex((l) => /approach|before landing/i.test(l.name));
    if (this.idx < 0) this.idx = 0;
    this.render(true);
  }
  toggle() { this.open = !this.open; this.el.classList.toggle('hidden', !this.open); this.render(true); }
  itemState(li, i) {
    const it = this.lists[li].items[i];
    if (it[2]) { try { return it[2](this.ctx) ? 'sensed' : 'open'; } catch (e) { return 'open'; } }
    return this.done.has(`${li}:${i}`) ? 'done' : 'open';
  }
  update() { if (this.open) this.render(); }
  render(force) {
    if (!this.ctx || (!this.open && !force)) return;
    const L = this.lists[this.idx];
    const states = L.items.map((_, i) => this.itemState(this.idx, i));
    const complete = states.every((s) => s !== 'open');
    const html = `<div class="ckhead"><button data-c="prev" ${this.idx === 0 ? 'disabled' : ''}>◀</button>
      <select aria-label="Checklist">${this.lists.map((l, i) => `<option value="${i}" ${i === this.idx ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
      <button data-c="next" ${this.idx === this.lists.length - 1 ? 'disabled' : ''}>▶</button><button data-c="close" title="Close (J)">✕</button></div>
      <ol>${L.items.map((it, i) => `<li data-c="item:${i}" class="${states[i]}"><span>${it[0]}</span><b>${it[1]}</b></li>`).join('')}</ol>
      <div class="ckfoot ${complete ? 'ok' : ''}">${complete ? `${L.name.toUpperCase()} CHECKLIST COMPLETE` : `${states.filter((s) => s === 'open').length} item(s) open · green = sensed, click to tick`}<button data-c="reset">Reset</button></div>`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html; this.lastHtml = html;
      this.el.querySelector('select').addEventListener('change', (e) => { this.idx = +e.target.value; this.render(true); });
    }
  }
}
