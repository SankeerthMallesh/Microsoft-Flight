// Airline liveries recreated procedurally for personal / non-commercial simulation use.
// Airline names, colours and logos are trademarks of their respective owners.
// `fleet` lists the aircraft types each airline actually operates (or has operated).
import { FONTS } from '../model/painter.js';

const titleSize = (l, k = 0.34) => Math.max(0.4, Math.min(2.4, l.H0 * k * 1.35));
const titleX = (l, f = 0.3) => l.L * f;
const TH = 0.6; // title height (above window line)

// ---------------------------------------------------------------- logo shapes
function heart(c, s) {
  c.beginPath(); c.moveTo(0, -s * 0.9);
  c.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.9, s * 0.95, 0, s * 0.45);
  c.bezierCurveTo(s * 0.9, s * 0.95, s * 1.3, -s * 0.1, 0, -s * 0.9); c.closePath();
}
function mapleLeaf(c, s) {
  const pts = [[0, 1], [0.12, 0.72], [0.28, 0.82], [0.22, 0.42], [0.48, 0.62], [0.5, 0.5], [0.72, 0.56], [0.62, 0.3], [0.82, 0.22], [0.5, -0.02], [0.56, -0.18], [0.06, -0.12], [0.06, -0.5], [-0.06, -0.5], [-0.06, -0.12], [-0.56, -0.18], [-0.5, -0.02], [-0.82, 0.22], [-0.62, 0.3], [-0.72, 0.56], [-0.5, 0.5], [-0.48, 0.62], [-0.22, 0.42], [-0.28, 0.82], [-0.12, 0.72]];
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s))); c.closePath();
}
function kangaroo(c, s) {
  const pts = [[0.55, 0.55], [0.7, 0.62], [0.62, 0.42], [0.48, 0.35], [0.35, 0.2], [0.2, 0.1], [0.05, 0.05], [-0.15, -0.05], [-0.3, -0.2], [-0.25, -0.4], [-0.05, -0.38], [0.05, -0.45], [-0.2, -0.55], [-0.5, -0.5], [-0.75, -0.62], [-0.95, -0.6], [-0.55, -0.35], [-0.5, -0.05], [-0.35, 0.18], [-0.1, 0.32], [0.2, 0.42], [0.4, 0.55]];
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s))); c.closePath();
}
function bird(c, s) {
  // generic stylised bird/crane in flight
  c.beginPath(); c.moveTo(-s, s * 0.1); c.quadraticCurveTo(-s * 0.3, s * 0.55, 0, s * 0.05); c.quadraticCurveTo(s * 0.35, s * 0.6, s * 1.0, s * 0.35);
  c.quadraticCurveTo(s * 0.4, s * 0.15, s * 0.1, -s * 0.15); c.quadraticCurveTo(-s * 0.4, -s * 0.05, -s, s * 0.1); c.closePath();
}
function star(c, s, n = 5) {
  c.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? s * 0.42 : s; const a = Math.PI / 2 + (i * Math.PI) / n; i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath();
}
function circle(c, r) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); }

// width of a title in metres (as drawn by FuselagePainter.text)
function textW(p, str, size, o = {}) {
  const c = p.ctx, px = size * p.kv * 1.35;
  c.save(); c.font = `${o.italic ? 'italic ' : ''}${o.weight || 800} ${px}px ${o.font || FONTS.sans}`;
  if ('letterSpacing' in c) c.letterSpacing = o.spacing ? `${o.spacing * px}px` : '0px';
  const w = c.measureText(str).width / p.kv; c.restore();
  return o.maxW ? Math.min(w, o.maxW) : w;
}
// lay out a multi-part title (text and/or drawn marks) in reading order, centred on cx.
// The order is mirrored on the right side (nose points right there), so the title reads correctly on both sides.
// parts: { t, size, color, o, h } or { w, draw, h }, gap: metres between parts
function titleRow(p, cx, h, parts, gap = 0.5) {
  const ws = parts.map((q) => q.w ?? textW(p, q.t, q.size, q.o));
  const tot = ws.reduce((s, w) => s + w, 0) + gap * (parts.length - 1);
  let off = -tot / 2;
  parts.forEach((q, i) => {
    const c = off + ws[i] / 2, x = cx + (p.side === 'L' ? c : -c), y = q.h ?? h;
    if (q.t) p.text(q.t, x, y, q.size, q.color, q.o);
    if (q.draw) p.draw(x, y, q.draw);
    off += ws[i] + gap;
  });
}
// rear-fuselage sweep line: height at x for a line rising/falling linearly from (x0,h0) to (x1,h1)
const ramp = (x0, h0, x1, h1) => (x) => h0 + (h1 - h0) * Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
function taegeuk(c, r) {
  circle(c, r); c.fillStyle = '#C60C30'; c.fill();
  // draw frame is y-up: arc(π..2π) is the lower half
  c.beginPath(); c.arc(0, 0, r, Math.PI, Math.PI * 2); c.closePath(); c.fillStyle = '#003478'; c.fill();
  c.beginPath(); c.arc(-r / 2, 0, r / 2, Math.PI, Math.PI * 2); c.fillStyle = '#C60C30'; c.fill();
  c.beginPath(); c.arc(r / 2, 0, r / 2, 0, Math.PI); c.fillStyle = '#003478'; c.fill();
}
function koru(c, s, color) {
  c.strokeStyle = color; c.lineCap = 'round'; c.lineWidth = s * 0.16;
  c.beginPath();
  for (let k = 0; k <= 60; k++) { const t = k / 60, a = t * Math.PI * 2.6, r = s * (0.08 + 0.55 * t); const x = Math.cos(a) * r, y = Math.sin(a) * r; k ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.quadraticCurveTo(-s * 0.2, -s * 1.1, s * 0.5, -s * 1.5); c.stroke();
}

// waving flag stripes helper on fin: bands = [[color, h0, h1]], hf coords along chord-normal
function finStripes(f, bands, a0 = 0, a1 = 1, wave = 0.05) {
  for (const [color, h0, h1] of bands) {
    const pts = [];
    for (let k = 0; k <= 20; k++) { const a = a0 + (a1 - a0) * (k / 20); pts.push([a, h1 + Math.sin(a * 5) * wave]); }
    for (let k = 20; k >= 0; k--) { const a = a0 + (a1 - a0) * (k / 20); pts.push([a, h0 + Math.sin(a * 5) * wave]); }
    f.poly(pts, color);
  }
}

// ======================================================================= LIVERIES
export const LIVERIES = [
  {
    // military types: the detailed models keep their own (FlightGear) paint; this drives the procedural fallback
    id: 'military-grey', name: 'Air Superiority Grey', subtitle: 'Standard military paint', country: '—', fleet: ['f15c', 'f16c', 'fa18ef', 'f14d', 'f22a'],
    base: '#8a9199', engine: '#5d636a', finBase: '#8a9199', wing: '#848b93', wingUnder: '#9aa1a8', stab: '#848b93', belly: '#9aa1a8', reg: false, metallic: 0.05, roughness: 0.6,
  },
  {
    id: 'southwest', name: 'Southwest Airlines', subtitle: 'Heart (2014)', country: 'US',
    fleet: ['b737-700', 'b737-800', 'b737-max8', 'b737-max7'],
    base: '#304CB2', wing: '#c4c8ce', engine: '#304CB2', engineLip: '#c9cdd3', pylon: '#304CB2', stab: '#304CB2', finBase: '#304CB2',
    wingletOut: '#304CB2', wingletIn: '#304CB2', belly: null, regColor: '#ffffff', doorColor: 'rgba(10,20,60,0.6)', windowColor: '#121a3a',
    fuselage(p, l) {
      const L = l.L;
      // belly: red/yellow/blue stripes sweeping up to the tail
      const rise = (x) => (x > L * 0.55 ? Math.pow((x - L * 0.55) / (L * 0.45), 1.6) * 1.35 : 0);
      p.band((x) => -0.35 + rise(x), (x) => -0.5 + rise(x), '#FFBF27', { x0: L * 0.15 });
      p.band((x) => -0.5 + rise(x), (x) => -0.72 + rise(x), '#E3172D', { x0: L * 0.12 });
      p.band((x) => -0.72 + rise(x), -1.6, '#304CB2', { x0: L * 0.1 });
      p.text('Southwest', titleX(l, 0.42), TH, titleSize(l, 0.42), '#ffffff', { font: FONTS.wide, weight: 900, maxW: L * 0.5 * 0.9 * (p.kx / p.kv) });
      p.draw(l.Ln * 1.15, -0.32, (c) => { heart(c, 0.55); c.fillStyle = '#E3172D'; c.fill(); c.lineWidth = 0.08; c.strokeStyle = '#FFBF27'; c.stroke(); });
    },
    fin(f) {
      f.fill('#304CB2');
      f.poly([[0.55, -0.1], [1.1, -0.1], [1.1, 0.42], [0.85, 0.42]], '#E3172D');
      f.poly([[0.4, -0.1], [0.55, -0.1], [0.85, 0.42], [0.7, 0.42]], '#FFBF27');
      f.draw(0.4, 0.68, (c) => { heart(c, f.midChord * 0.12); c.fillStyle = '#fff'; c.fill(); });
    },
  },
  {
    id: 'delta', name: 'Delta Air Lines', subtitle: 'Upward (2007)', country: 'US',
    fleet: ['a220-300', 'a319neo', 'a321neo', 'a330-300', 'a330-900', 'a350-900', 'b737-800', 'b737-max9', 'b757-200', 'b767-300er', 'e175', 'crj900', 'b717-200', 'b737-900er', 'a330-200', 'b767-400er', 'crj700'],
    base: '#ffffff', engine: '#0B2D6B', pylon: '#ffffff', stab: '#c9ced6', finBase: '#C01933', wingletOut: '#0B2D6B', wingletIn: '#C01933',
    fuselage(p, l) {
      p.band(-0.38, -1.6, '#0B2D6B');
      p.band((x) => (x > l.tailStart ? 0.6 + 2.4 * ((x - l.tailStart) / l.Lt) : 2), -2, '#C01933', { x0: l.tailStart + l.Lt * 0.1 });
      const x = titleX(l, 0.22);
      p.text('DELTA', x + l.H0 * 0.55, TH, titleSize(l, 0.33), '#0B2D6B', { font: FONTS.wide, weight: 900, spacing: 0.05 });
      p.draw(x - l.H0 * 0.75, TH, (c) => {
        const s = titleSize(l, 0.33) * 0.75;
        c.beginPath(); c.moveTo(0, s); c.lineTo(-s * 1.1, -s); c.lineTo(s * 1.1, -s); c.closePath(); c.fillStyle = '#C01933'; c.fill();
        c.beginPath(); c.moveTo(0, s); c.lineTo(0, -s); c.lineTo(s * 1.1, -s); c.closePath(); c.fillStyle = '#8A1538'; c.fill();
      });
    },
    fin(f) {
      f.fill('#C01933');
      f.poly([[-0.2, -0.1], [1.2, -0.1], [1.2, 0.05], [-0.2, 0.62]], '#8A1538');
    },
  },
  {
    id: 'emirates', name: 'Emirates', subtitle: '2023 livery', country: 'AE',
    fleet: ['b777-300er', 'b777-200er', 'a380-800', 'a350-900', 'b777-9', 'b777f'],
    base: '#ffffff', engine: '#f2f2f2', engineLip: '#c9cdd2', finBase: '#ffffff', wingletOut: '#ffffff', wingletIn: '#ffffff', stab: '#e9ebee',
    engineText: { text: 'Emirates', color: '#D71921', font: FONTS.serif },
    fuselage(p, l) {
      const L = l.L;
      p.text('Emirates', L * 0.47, TH + 0.04, titleSize(l, 0.5), '#D71921', { font: FONTS.serif, weight: 700 });
      p.text('طيران الإمارات', L * 0.18, TH, titleSize(l, 0.28), '#D71921', { font: FONTS.serif, weight: 700 });
      // UAE flag sweep onto rear fuselage
      const x0 = l.tailStart - L * 0.04;
      const wave = (x, h) => h + 0.12 * Math.sin((x - x0) * 0.6);
      p.band((x) => wave(x, 1.05), (x) => wave(x, 0.78), '#00843D', { x0, x1: L });
      p.band((x) => wave(x, 0.5), (x) => wave(x, 0.22), '#000000', { x0, x1: L });
      p.band(1.3, 0.22, '#D71921', { x0, x1: x0 + L * 0.035 });
    },
    fin(f) {
      f.fill('#ffffff');
      finStripes(f, [['#00843D', 0.66, 1.2], ['#ffffff', 0.33, 0.66], ['#000000', -0.2, 0.33]], 0.25, 1.2, 0.04);
      const pts = []; for (let k = 0; k <= 20; k++) { const h = -0.2 + 1.4 * (k / 20); pts.push([0.28 + Math.sin(h * 6) * 0.03, h]); }
      f.poly([[-0.2, -0.2], ...pts, [-0.2, 1.2]], '#D71921');
    },
  },
  {
    id: 'united', name: 'United Airlines', subtitle: 'Evolution (2019)', country: 'US',
    fleet: ['b737-800', 'b737-max8', 'b737-max9', 'b757-200', 'b767-300er', 'b777-200er', 'b777-300er', 'b787-8', 'b787-9', 'b787-10', 'a319neo', 'a321neo', 'e175', 'crj900', 'b737-900er', 'b767-400er', 'b737-max10', 'crj700', 'e190'],
    base: '#ffffff', engine: '#0E2A5C', engine2: '#0E2A5C', pylon: '#ffffff', finBase: '#0E2A5C', wingletOut: '#0E2A5C', wingletIn: '#0E2A5C',
    fuselage(p, l) {
      p.band(-0.3, -1.6, '#0E2A5C');
      p.band(-0.27, -0.33, '#1A75CF');
      p.text('UNITED', titleX(l, 0.34), TH, titleSize(l, 0.36), '#0E2A5C', { font: FONTS.sans, weight: 800, spacing: 0.08 });
      p.band(3, (x) => 0.75 - 1.5 * ((x - l.tailStart) / l.Lt), '#0E2A5C', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#0E2A5C');
      f.draw(0.45, 0.48, (c) => {
        const r = Math.min(f.h, f.midChord) * 0.3;
        circle(c, r); c.fillStyle = '#ffffff'; c.fill();
        c.strokeStyle = '#0E2A5C'; c.lineWidth = r * 0.07;
        for (let k = -2; k <= 2; k++) { c.beginPath(); c.ellipse(0, 0, Math.abs(k) * r * 0.32 + 0.01, r, 0, 0, Math.PI * 2); c.stroke(); }
        for (let k = -2; k <= 2; k++) { c.beginPath(); const y = k * r * 0.38; const w = Math.sqrt(Math.max(0, r * r - y * y)); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); }
      });
    },
  },
  {
    id: 'american', name: 'American Airlines', subtitle: '2013 livery', country: 'US',
    fleet: ['a319neo', 'a321neo', 'b737-800', 'b737-max8', 'b777-200er', 'b777-300er', 'b787-8', 'b787-9', 'e175', 'crj900', 'crj700', 'b737-max10'],
    base: '#C9CED5', wing: '#bfc4cb', engine: '#b5bcc5', pylon: '#C9CED5', stab: '#C9CED5', finBase: '#C9CED5', wingletOut: '#0078D2', wingletIn: '#C30019',
    fuselage(p, l) {
      p.text('American', titleX(l, 0.4), TH, titleSize(l, 0.4), '#36495A', { font: FONTS.sans, weight: 600, spacing: 0.02 });
      p.draw(l.Ln * 1.05, 0.5, (c) => {
        const s = l.H0 * 0.32;
        c.beginPath(); c.moveTo(-s, -s * 0.2); c.lineTo(0, s); c.lineTo(s * 0.2, -s * 0.1); c.closePath(); c.fillStyle = '#0078D2'; c.fill();
        c.beginPath(); c.moveTo(s * 0.2, -s * 0.1); c.lineTo(0, -s); c.lineTo(-s * 0.6, -s * 0.2); c.closePath(); c.fillStyle = '#C30019'; c.fill();
      });
    },
    fin(f) {
      f.fill('#C9CED5');
      const stripes = [];
      for (let k = 0; k < 7; k++) stripes.push([k % 2 ? '#ffffff' : '#C30019', k * 0.09, k * 0.09 + 0.09]);
      finStripes(f, stripes, 0.0, 1.2, 0);
      f.poly([[-0.2, 0.55], [1.3, 0.55], [1.3, 1.2], [-0.2, 1.2]], '#0078D2');
      f.poly([[-0.2, 0.55], [0.15, 0.55], [-0.2, 0.85]], '#0D2A59');
    },
  },
  {
    id: 'british', name: 'British Airways', subtitle: 'Chatham Dockyard', country: 'GB',
    fleet: ['a319neo', 'a320neo', 'a321neo', 'a350-1000', 'a380-800', 'b777-200er', 'b777-300er', 'b787-8', 'b787-9', 'b787-10', 'b747-400', 'e190-e2', 'e190'],
    base: '#f7f8fa', engine: '#0E1C3C', engineLip: '#c8ccd2', pylon: '#f7f8fa', stab: '#c9ced6', finBase: '#012169', wingletOut: '#0E1C3C', wingletIn: '#0E1C3C',
    fuselage(p, l) {
      p.band(-0.32, -1.6, '#0E1C3C');
      p.band((x) => -0.2 + 0.08 * Math.sin(x * 0.18), (x) => -0.32 + 0.02 * Math.sin(x * 0.18), '#C8102E', { x0: l.L * 0.15, x1: l.L * 0.55 });
      p.band((x) => -0.27 + 0.05 * Math.sin(x * 0.18), -0.33, '#1F4E9A', { x0: l.L * 0.15, x1: l.L * 0.55 });
      p.text('BRITISH AIRWAYS', titleX(l, 0.33), TH, titleSize(l, 0.28), '#0E1C3C', { font: FONTS.serif, weight: 700, spacing: 0.06 });
    },
    fin(f) {
      f.fill('#012169');
      f.draw(0.5, 0.5, (c) => {
        const w = f.midChord * 0.9, h = f.h * 0.9;
        c.lineCap = 'butt';
        c.strokeStyle = '#ffffff'; c.lineWidth = h * 0.18; c.beginPath(); c.moveTo(-w, -h); c.lineTo(w, h); c.moveTo(-w, h); c.lineTo(w, -h); c.stroke();
        c.strokeStyle = '#C8102E'; c.lineWidth = h * 0.07; c.beginPath(); c.moveTo(-w, -h); c.lineTo(w, h); c.moveTo(-w, h); c.lineTo(w, -h); c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = h * 0.3; c.beginPath(); c.moveTo(-w, 0); c.lineTo(w, 0); c.moveTo(0, -h); c.lineTo(0, h); c.stroke();
        c.strokeStyle = '#C8102E'; c.lineWidth = h * 0.18; c.beginPath(); c.moveTo(-w, 0); c.lineTo(w, 0); c.moveTo(0, -h); c.lineTo(0, h); c.stroke();
      });
    },
  },
  {
    id: 'lufthansa', name: 'Lufthansa', subtitle: '2018 livery', country: 'DE',
    fleet: ['a319neo', 'a320neo', 'a321neo', 'a330-300', 'a340-600', 'a350-900', 'a380-800', 'b747-400', 'b747-8i', 'b787-9', 'crj900', 'b747-8f'],
    base: '#ffffff', engine: '#05164D', pylon: '#ffffff', finBase: '#05164D', wingletOut: '#05164D', wingletIn: '#05164D',
    fuselage(p, l) {
      p.band(3, (x) => 0.82 - 1.3 * Math.pow((x - (l.tailStart - l.L * 0.05)) / (l.Lt + l.L * 0.05), 0.9), '#05164D', { x0: l.tailStart - l.L * 0.05 });
      p.text('Lufthansa', titleX(l, 0.38), TH, titleSize(l, 0.4), '#05164D', { font: FONTS.serif, weight: 600, spacing: 0.02 });
    },
    fin(f) {
      f.fill('#05164D');
      f.draw(0.48, 0.5, (c) => {
        const r = Math.min(f.h, f.midChord) * 0.34;
        circle(c, r); c.lineWidth = r * 0.1; c.strokeStyle = '#ffffff'; c.stroke();
        c.lineWidth = r * 0.09; c.lineJoin = 'round'; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-r * 0.75, r * 0.05); c.lineTo(r * 0.55, -r * 0.45); c.moveTo(-r * 0.3, -r * 0.1); c.lineTo(-r * 0.2, r * 0.62); c.lineTo(r * 0.15, r * 0.2);
        c.moveTo(-r * 0.3, -r * 0.1); c.lineTo(r * 0.45, r * 0.45); c.moveTo(-r * 0.75, r * 0.05); c.lineTo(-r * 0.62, r * 0.25); c.stroke();
      });
    },
  },
  {
    id: 'airfrance', name: 'Air France', subtitle: '2009 livery', country: 'FR',
    fleet: ['a220-300', 'a320neo', 'a321neo', 'a330-300', 'a350-900', 'b777-200er', 'b777-300er', 'b787-9'],
    base: '#ffffff', engine: '#ffffff', engine2: '#002157', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#002157', wingletIn: '#ED1C24',
    fuselage(p, l) {
      p.text('AIRFRANCE', titleX(l, 0.3), TH, titleSize(l, 0.33), '#002157', { font: FONTS.sans, weight: 800, italic: true, spacing: 0.04 });
      p.band(-0.6, -0.68, '#002157', { x0: l.L * 0.05, x1: l.L * 0.92 });
    },
    fin(f) {
      f.fill('#ffffff');
      const s = (a0, w, color) => f.poly([[a0, -0.2], [a0 + w, -0.2], [a0 + w - 0.9, 1.3], [a0 - 0.9, 1.3]], color);
      s(0.6, 0.18, '#002157'); s(0.86, 0.1, '#ED1C24'); s(1.02, 0.05, '#002157'); s(1.12, 0.04, '#ED1C24'); s(1.2, 0.03, '#002157');
    },
  },
  {
    id: 'klm', name: 'KLM Royal Dutch Airlines', subtitle: '2014 livery', country: 'NL',
    fleet: ['b737-800', 'b777-200er', 'b777-300er', 'b787-9', 'b787-10', 'a321neo', 'a330-300', 'e175', 'e195-e2', 'e190'],
    base: '#00A1DE', belly: '#ffffff', engine: '#00A1DE', pylon: '#00A1DE', stab: '#00A1DE', finBase: '#00A1DE', wingletOut: '#00A1DE', wingletIn: '#00A1DE',
    windowColor: '#07344a', regColor: '#003082',
    fuselage(p, l) {
      p.band(-0.18, -1.6, '#ffffff');
      p.band(-0.18, -0.25, '#003082');
      const kf = p.side === 'L' ? [0.28, 0.5] : [0.5, 0.28]; // keep "KLM Royal Dutch Airlines" order on both sides
      p.text('KLM', titleX(l, kf[0]), TH + 0.03, titleSize(l, 0.42), '#ffffff', { font: FONTS.sans, weight: 800, spacing: 0.05 });
      p.text('Royal Dutch Airlines', titleX(l, kf[1]), TH, titleSize(l, 0.16), '#ffffff', { font: FONTS.sans, weight: 600 });
      p.draw(titleX(l, 0.28), TH + 0.62, (c) => { const s = l.H0 * 0.12; for (let k = -2; k <= 2; k++) { c.beginPath(); c.arc(k * s * 0.8, Math.abs(k) === 2 ? 0 : s * 0.4 * (k === 0 ? 1.4 : 1), s * 0.25, 0, 7); c.fillStyle = '#ffffff'; c.fill(); } });
    },
    fin(f) {
      f.fill('#00A1DE');
      f.text('KLM', 0.45, 0.45, f.h * 0.25, '#ffffff', { weight: 800 });
    },
  },
  {
    id: 'qatar', name: 'Qatar Airways', subtitle: 'Oryx', country: 'QA',
    fleet: ['a320neo', 'a321neo', 'a350-900', 'a350-1000', 'a380-800', 'b777-200er', 'b777-300er', 'b777-9', 'b777f', 'b787-8', 'b787-9', 'b737-max8', 'a330-200', 'b747-8f'],
    base: '#ffffff', engine: '#e8e8ea', pylon: '#ffffff', finBase: '#5C0632', wingletOut: '#5C0632', wingletIn: '#5C0632', stab: '#d0d3d8',
    fuselage(p, l) {
      const x0 = l.tailStart - l.L * 0.1;
      const pts = [];
      for (let k = 0; k <= 8; k++) { const x = x0 + (k / 8) * (l.L - x0); pts.push([x + (k % 2 ? 0.8 : 0), 0.55 - 1.3 * Math.pow(k / 8, 1.3)]); }
      p.poly([[x0, 3], [l.L + 1, 3], [l.L + 1, -0.75], ...pts.reverse()], '#5C0632');
      p.text('QATAR', titleX(l, 0.26), TH + 0.12, titleSize(l, 0.27), '#5C0632', { font: FONTS.sans, weight: 700, spacing: 0.12 });
      p.text('AIRWAYS', titleX(l, 0.26), TH - 0.22, titleSize(l, 0.17), '#5C0632', { font: FONTS.sans, weight: 600, spacing: 0.3 });
      p.text('القطرية', titleX(l, 0.42), TH, titleSize(l, 0.33), '#5C0632', { font: FONTS.serif, weight: 700 });
    },
    fin(f) {
      f.fill('#5C0632');
      f.draw(0.48, 0.5, (c) => {
        const s = f.h * 0.28; c.fillStyle = '#ffffff';
        c.beginPath(); c.moveTo(-s * 0.9, -s * 0.2); c.quadraticCurveTo(-s * 0.2, s * 0.25, s * 0.5, -s * 0.05); c.lineTo(s * 0.7, s * 0.25); c.lineTo(s * 0.55, s * 0.3);
        c.lineTo(s * 0.9, s * 1.2); c.lineTo(s * 0.6, s * 0.45); c.lineTo(s * 0.8, s * 1.25); c.lineTo(s * 0.4, s * 0.35); c.quadraticCurveTo(-s * 0.2, s * 0.5, -s * 0.9, -s * 0.05); c.closePath(); c.fill();
        c.lineWidth = s * 0.06; c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(-s * 0.6, -s * 0.1); c.lineTo(-s * 0.7, -s * 0.8); c.moveTo(-s * 0.3, 0); c.lineTo(-s * 0.2, -s * 0.8); c.moveTo(s * 0.3, -s * 0.02); c.lineTo(s * 0.2, -s * 0.8); c.stroke();
      });
    },
  },
  {
    id: 'singapore', name: 'Singapore Airlines', subtitle: 'Kris', country: 'SG',
    fleet: ['a350-900', 'a380-800', 'b777-300er', 'b787-10', 'b737-max8', 'b747-400'],
    base: '#ffffff', engine: '#1D3C78', engineLip: '#F99F1C', pylon: '#ffffff', finBase: '#1D3C78', wingletOut: '#1D3C78', wingletIn: '#1D3C78',
    fuselage(p, l) {
      p.text('SINGAPORE AIRLINES', titleX(l, 0.36), TH, titleSize(l, 0.24), '#1D3C78', { font: FONTS.serif, weight: 700, spacing: 0.05 });
      p.band(-0.42, -0.5, '#F99F1C', { x0: l.L * 0.04, x1: l.L * 0.9 });
      p.band(-0.5, -0.6, '#1D3C78', { x0: l.L * 0.04, x1: l.L * 0.9 });
    },
    fin(f) {
      f.fill('#1D3C78');
      f.draw(0.45, 0.5, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.3; c.fillStyle = '#F99F1C';
        c.beginPath(); c.moveTo(-s, -s * 0.3); c.bezierCurveTo(-s * 0.2, s * 1.2, s * 0.6, s * 0.4, s, s * 1.1); c.bezierCurveTo(s * 0.5, -s * 0.1, -s * 0.2, s * 0.2, -s * 0.4, -s * 0.9); c.closePath(); c.fill();
      });
    },
  },
  {
    id: 'ryanair', name: 'Ryanair', subtitle: '2014 livery', country: 'IE',
    fleet: ['b737-800', 'b737-max8', 'b737-max10'],
    base: '#ffffff', engine: '#073590', pylon: '#ffffff', finBase: '#073590', wingletOut: '#073590', wingletIn: '#F1C933',
    fuselage(p, l) {
      p.band(-0.3, -1.6, '#073590');
      p.text('RYANAIR', titleX(l, 0.38), TH, titleSize(l, 0.36), '#073590', { font: FONTS.sans, weight: 900, spacing: 0.06 });
      p.band(3, (x) => 0.7 - 1.4 * ((x - l.tailStart) / l.Lt), '#073590', { x0: l.tailStart + l.Lt * 0.15 });
    },
    fin(f) {
      f.fill('#073590');
      f.draw(0.45, 0.48, (c) => {
        const s = f.h * 0.33; c.strokeStyle = '#F1C933'; c.lineWidth = s * 0.12; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-s * 0.5, -s); c.quadraticCurveTo(-s * 0.9, s * 0.6, s * 0.4, s); c.quadraticCurveTo(s * 0.5, 0, s * 0.6, -s * 0.8); c.lineTo(-s * 0.5, -s); c.stroke();
        c.lineWidth = s * 0.04; for (let k = 1; k < 6; k++) { const x = -s * 0.5 + k * s * 0.18; c.beginPath(); c.moveTo(x, -s * 0.9); c.lineTo(x, s * (0.1 + k * 0.12)); c.stroke(); }
      });
    },
  },
  {
    id: 'easyjet', name: 'easyJet', subtitle: '2015 livery', country: 'GB',
    fleet: ['a319neo', 'a320neo', 'a321neo'],
    base: '#ffffff', engine: '#FF6600', pylon: '#ffffff', finBase: '#FF6600', wingletOut: '#FF6600', wingletIn: '#FF6600',
    fuselage(p, l) {
      p.text('easyJet', titleX(l, 0.42), 0.4, titleSize(l, 0.62), '#FF6600', { font: FONTS.sans, weight: 800, maxW: l.L * 0.55 * (p.kx / p.kv) });
      p.band(3, (x) => 0.7 - 1.4 * ((x - l.tailStart) / l.Lt), '#FF6600', { x0: l.tailStart + l.Lt * 0.2 });
    },
    fin(f) { f.fill('#FF6600'); f.text('easyJet', 0.5, 0.45, f.h * 0.2, '#ffffff', { weight: 800, maxW: f.midChord * 1.4 }); },
  },
  {
    id: 'aircanada', name: 'Air Canada', subtitle: '2017 livery', country: 'CA',
    fleet: ['a220-300', 'a321neo', 'a330-300', 'b737-max8', 'b777-300er', 'b787-8', 'b787-9', 'crj900', 'dash8-400', 'e175', 'crj700', 'b737-max10'],
    base: '#ffffff', engine: '#111111', pylon: '#ffffff', finBase: '#111111', wingletOut: '#111111', wingletIn: '#111111',
    fuselage(p, l) {
      p.band(-0.42, -1.6, '#111111');
      p.text('AIR CANADA', titleX(l, 0.32), TH, titleSize(l, 0.3), '#111111', { font: FONTS.sans, weight: 700, spacing: 0.12 });
      p.band(3, (x) => 0.75 - 1.5 * ((x - l.tailStart) / l.Lt), '#111111', { x0: l.tailStart + l.Lt * 0.05 });
    },
    fin(f) {
      f.fill('#111111');
      f.draw(0.45, 0.5, (c) => { mapleLeaf(c, Math.min(f.h, f.midChord) * 0.42); c.fillStyle = '#D22630'; c.fill(); });
    },
  },
  {
    id: 'qantas', name: 'Qantas', subtitle: 'Flying Kangaroo (2016)', country: 'AU',
    fleet: ['b737-800', 'a330-300', 'a380-800', 'b787-9', 'a220-300', 'a321neo', 'dash8-400', 'b747-400', 'a350-1000', 'a330-200', 'b717-200'],
    base: '#ffffff', engine: '#d6d9de', pylon: '#ffffff', finBase: '#E40000', wingletOut: '#E40000', wingletIn: '#E40000', stab: '#cfd2d6',
    fuselage(p, l) {
      p.text('QANTAS', titleX(l, 0.3), TH, titleSize(l, 0.33), '#1e1e1e', { font: FONTS.sans, weight: 800, spacing: 0.1 });
      p.band(3, (x) => 0.7 - 1.6 * ((x - (l.tailStart - 1)) / (l.Lt + 1)), '#E40000', { x0: l.tailStart - 1 });
      p.band((x) => 0.7 - 1.6 * ((x - (l.tailStart - 1)) / (l.Lt + 1)), (x) => 0.62 - 1.6 * ((x - (l.tailStart - 1)) / (l.Lt + 1)), '#8C8C8C', { x0: l.tailStart - 1 });
    },
    fin(f) {
      f.fill('#E40000');
      f.draw(0.55, 0.45, (c) => { kangaroo(c, Math.min(f.h, f.midChord) * 0.45); c.fillStyle = '#ffffff'; c.fill(); });
    },
  },
  {
    id: 'ana', name: 'All Nippon Airways', subtitle: 'Triton blue', country: 'JP',
    fleet: ['b737-800', 'a320neo', 'a321neo', 'b767-300er', 'b777-300er', 'b777-9', 'b787-8', 'b787-9', 'b787-10', 'a380-800', 'dash8-400'],
    base: '#ffffff', engine: '#ffffff', engine2: '#13448F', pylon: '#ffffff', finBase: '#13448F', wingletOut: '#13448F', wingletIn: '#00AEEF',
    fuselage(p, l) {
      p.band(-0.34, -0.44, '#13448F', { x0: l.L * 0.08, x1: l.L * 0.85 });
      p.band(-0.47, -0.55, '#00AEEF', { x0: l.L * 0.12, x1: l.L * 0.85 });
      p.text('ANA', titleX(l, 0.27), TH, titleSize(l, 0.4), '#13448F', { font: FONTS.sans, weight: 800, spacing: 0.08 });
    },
    fin(f) { f.fill('#13448F'); f.text('ANA', 0.48, 0.45, f.h * 0.22, '#ffffff', { weight: 800 }); f.poly([[-0.2, 0.05], [1.2, 0.05], [1.2, 0.1], [-0.2, 0.1]], '#00AEEF'); },
  },
  {
    id: 'jal', name: 'Japan Airlines', subtitle: 'Tsurumaru', country: 'JP',
    fleet: ['b737-800', 'a350-900', 'a350-1000', 'b767-300er', 'b787-8', 'b787-9', 'b777-300er', 'e190-e2', 'e175', 'e190'],
    base: '#ffffff', engine: '#e1e3e6', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#ffffff', wingletIn: '#ffffff', stab: '#e1e3e6',
    fuselage(p, l) { p.text('JAPAN AIRLINES', titleX(l, 0.33), TH, titleSize(l, 0.26), '#1a1a1a', { font: FONTS.sans, weight: 700, spacing: 0.1 }); },
    fin(f) {
      f.fill('#ffffff');
      f.draw(0.48, 0.52, (c) => {
        const r = Math.min(f.h, f.midChord) * 0.36;
        circle(c, r); c.fillStyle = '#CC0000'; c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.moveTo(0, r * 0.75); c.quadraticCurveTo(-r * 0.9, r * 0.6, -r * 0.82, -r * 0.4); c.quadraticCurveTo(-r * 0.4, r * 0.25, 0, r * 0.15); c.quadraticCurveTo(r * 0.4, r * 0.25, r * 0.82, -r * 0.4); c.quadraticCurveTo(r * 0.9, r * 0.6, 0, r * 0.75); c.fill();
        c.beginPath(); c.arc(0, r * 0.4, r * 0.12, 0, 7); c.fill();
      });
    },
  },
  {
    id: 'turkish', name: 'Turkish Airlines', subtitle: '2010 livery', country: 'TR',
    fleet: ['a321neo', 'a330-300', 'a350-900', 'b737-800', 'b737-max8', 'b737-max9', 'b777-300er', 'b787-9', 'b777f', 'a330-200'],
    base: '#ffffff', engine: '#e0e2e5', pylon: '#ffffff', finBase: '#C70A0C', wingletOut: '#C70A0C', wingletIn: '#C70A0C', stab: '#d4d7db',
    fuselage(p, l) {
      p.text('TURKISH AIRLINES', titleX(l, 0.33), TH, titleSize(l, 0.27), '#232B38', { font: FONTS.sans, weight: 800, spacing: 0.06 });
      p.band(3, (x) => 0.85 - 1.5 * ((x - l.tailStart) / l.Lt), '#C70A0C', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#C70A0C');
      f.draw(0.48, 0.5, (c) => { const r = Math.min(f.h, f.midChord) * 0.33; circle(c, r); c.fillStyle = '#fff'; c.fill(); c.save(); c.rotate(0.4); bird(c, r * 0.75); c.fillStyle = '#C70A0C'; c.fill(); c.restore(); });
    },
  },
  {
    id: 'alaska', name: 'Alaska Airlines', subtitle: '2016 livery', country: 'US',
    fleet: ['b737-800', 'b737-max8', 'b737-max9', 'e175', 'b787-9', 'b737-900er'],
    base: '#ffffff', engine: '#01426A', pylon: '#ffffff', finBase: '#01426A', wingletOut: '#01426A', wingletIn: '#48A9C5',
    fuselage(p, l) {
      p.text('Alaska', titleX(l, 0.33), TH, titleSize(l, 0.45), '#01426A', { font: FONTS.script, weight: 400 });
      const x0 = l.tailStart - l.L * 0.12;
      p.band((x) => -0.2 + 0.25 * Math.sin((x - x0) * 0.35) + 0.9 * ((x - x0) / (l.L - x0)), (x) => -0.55 + 0.9 * ((x - x0) / (l.L - x0)), '#48A9C5', { x0 });
      p.band((x) => -0.55 + 0.9 * ((x - x0) / (l.L - x0)), (x) => -0.75 + 0.9 * ((x - x0) / (l.L - x0)), '#53B390', { x0 });
      p.band(3, (x) => 0.8 - 1.4 * ((x - l.tailStart) / l.Lt), '#01426A', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#01426A');
      f.draw(0.45, 0.5, (c) => {
        const r = Math.min(f.h, f.midChord) * 0.36;
        c.beginPath(); c.ellipse(0, 0, r * 0.85, r, 0, 0, 7); c.fillStyle = '#e9e4da'; c.fill();
        c.beginPath(); c.ellipse(0, -r * 0.05, r * 0.55, r * 0.7, 0, 0, 7); c.fillStyle = '#d8a27a'; c.fill();
        c.fillStyle = '#01426A'; c.beginPath(); c.arc(-r * 0.2, r * 0.1, r * 0.07, 0, 7); c.arc(r * 0.2, r * 0.1, r * 0.07, 0, 7); c.fill();
        c.lineWidth = r * 0.05; c.strokeStyle = '#01426A'; c.beginPath(); c.arc(0, -r * 0.2, r * 0.22, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      });
    },
  },
  {
    id: 'jetblue', name: 'JetBlue', subtitle: 'Bluemanity', country: 'US',
    fleet: ['a220-300', 'a320neo', 'a321neo', 'e190-e2', 'e190'],
    base: '#ffffff', engine: '#003876', pylon: '#ffffff', finBase: '#003876', wingletOut: '#003876', wingletIn: '#0033A0',
    fuselage(p, l) {
      p.band(-0.32, -1.6, '#003876');
      p.text('jetBlue', titleX(l, 0.4), TH - 0.05, titleSize(l, 0.5), '#003876', { font: FONTS.sans, weight: 800, maxW: l.L * 0.45 * (p.kx / p.kv) });
      p.band(3, (x) => 0.8 - 1.5 * ((x - l.tailStart) / l.Lt), '#003876', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#003876');
      const blues = ['#0033A0', '#1A57B5', '#4A86D6', '#7FB1EA', '#00205B', '#0A4DA2'];
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        if ((i * 7 + j * 3) % 4 === 0) continue;
        const a = i / 8, h = j / 8;
        f.poly([[a - 0.06, h - 0.06], [a + 0.05, h - 0.06], [a + 0.05, h + 0.05], [a - 0.06, h + 0.05]], blues[(i * 3 + j * 5) % blues.length]);
      }
    },
  },
  {
    id: 'cathay', name: 'Cathay Pacific', subtitle: 'Brushwing (2015)', country: 'HK',
    fleet: ['a321neo', 'a330-300', 'a350-900', 'a350-1000', 'b777-300er', 'b777-9', 'b747-8i', 'b777f', 'b747-8f'],
    base: '#ffffff', belly: '#9aa3a6', engine: '#d9dcdf', pylon: '#ffffff', finBase: '#005D63', wingletOut: '#005D63', wingletIn: '#005D63', stab: '#cfd3d6',
    fuselage(p, l) {
      p.text('CATHAY PACIFIC', titleX(l, 0.33), TH, titleSize(l, 0.27), '#006564', { font: FONTS.sans, weight: 700, spacing: 0.08 });
      p.draw(titleX(l, 0.14), TH, (c) => { const s = l.H0 * 0.25; c.strokeStyle = '#006564'; c.lineWidth = s * 0.25; c.lineCap = 'round'; c.beginPath(); c.moveTo(-s, -s * 0.2); c.quadraticCurveTo(0, s * 0.6, s, s * 0.4); c.stroke(); });
    },
    fin(f) {
      f.fill('#005D63');
      f.draw(0.45, 0.48, (c) => { const s = Math.min(f.h, f.midChord) * 0.35; c.strokeStyle = '#ffffff'; c.lineWidth = s * 0.22; c.lineCap = 'round'; c.beginPath(); c.moveTo(-s, -s * 0.4); c.quadraticCurveTo(0, s * 0.8, s, s * 0.5); c.stroke(); });
    },
  },
  {
    id: 'etihad', name: 'Etihad Airways', subtitle: 'Facets of Abu Dhabi', country: 'AE',
    fleet: ['a350-1000', 'a380-800', 'b787-9', 'b787-10', 'b777-300er', 'a321neo', 'a320neo', 'a330-200'],
    base: '#f6f1ea', engine: '#BD8B13', engine2: '#8a6d3b', pylon: '#f6f1ea', finBase: '#BD8B13', wingletOut: '#BD8B13', wingletIn: '#8a6d3b', stab: '#d8cfc2',
    fuselage(p, l) {
      p.text('ETIHAD', titleX(l, 0.3), TH, titleSize(l, 0.36), '#45302A', { font: FONTS.sans, weight: 700, spacing: 0.2 });
      p.text('الاتحاد', titleX(l, 0.5), TH, titleSize(l, 0.3), '#45302A', { font: FONTS.serif, weight: 700 });
    },
    fin(f) {
      f.fill('#d8c6a0');
      const cols = ['#BD8B13', '#8a6d3b', '#e7d6b0', '#a5824a', '#5a4632', '#cfb27a'];
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const a = i / 6 - 0.05, h = j / 6 - 0.05;
        f.poly([[a, h], [a + 0.18, h], [a + (j % 2 ? 0 : 0.18), h + 0.18]], cols[(i * 5 + j * 3) % cols.length]);
      }
    },
  },
  {
    id: 'fedex', name: 'FedEx Express', subtitle: 'Cargo', country: 'US',
    fleet: ['b777f', 'b767-300er', 'md-11f', 'b757-200', 'atr72-600', 'a300-600f'],
    base: '#ffffff', belly: '#8f949a', engine: '#d3d6da', pylon: '#ffffff', finBase: '#4D148C', wingletOut: '#4D148C', wingletIn: '#4D148C', stab: '#cfd2d6',
    fuselage(p, l) {
      const x = titleX(l, 0.38), sz = titleSize(l, 0.62);
      p.band(3, 0.62, '#4D148C', { x0: 0, x1: l.L });
      const sd = p.side === 'L' ? 1 : -1; // keep the word order reading "FedEx" on both sides
      p.text('Fed', x - sd * sz * 1.35, 0.15, sz, '#4D148C', { font: FONTS.sans, weight: 900 });
      p.text('Ex', x + sd * sz * 1.0, 0.15, sz, '#FF6600', { font: FONTS.sans, weight: 900 });
      p.text('Express', x + sd * sz * 2.55, -0.25, sz * 0.35, '#FF6600', { font: FONTS.sans, weight: 700 });
    },
    fin(f) { f.fill('#4D148C'); f.text('FedEx', 0.5, 0.45, f.h * 0.2, '#ffffff', { weight: 900, maxW: f.midChord * 1.3 }); },
  },
  {
    id: 'ups', name: 'UPS Airlines', subtitle: 'Worldwide Services', country: 'US',
    fleet: ['b747-8i', 'b747-400', 'b767-300er', 'b757-200', 'md-11f', 'a300-600f', 'b747-8f'],
    base: '#ffffff', belly: '#4a2c1e', engine: '#351C15', pylon: '#ffffff', finBase: '#351C15', wingletOut: '#351C15', wingletIn: '#FFB500', stab: '#351C15',
    fuselage(p, l) {
      p.band(-0.25, -0.62, '#351C15');
      const uf = p.side === 'L' ? [0.3, 0.58] : [0.58, 0.3];
      p.text('UPS', titleX(l, uf[0]), TH - 0.08, titleSize(l, 0.45), '#351C15', { font: FONTS.sans, weight: 900, spacing: 0.04 });
      p.text('Worldwide Services', titleX(l, uf[1]), TH - 0.08, titleSize(l, 0.2), '#351C15', { font: FONTS.sans, weight: 700 });
      p.band(3, (x) => 0.75 - 1.5 * ((x - l.tailStart) / l.Lt), '#351C15', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#351C15');
      f.draw(0.45, 0.5, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.33; c.fillStyle = '#FFB500';
        c.beginPath(); c.moveTo(-s * 0.8, s); c.quadraticCurveTo(0, s * 1.25, s * 0.8, s); c.lineTo(s * 0.8, -s * 0.1); c.quadraticCurveTo(s * 0.7, -s * 0.8, 0, -s * 1.1); c.quadraticCurveTo(-s * 0.7, -s * 0.8, -s * 0.8, -s * 0.1); c.closePath(); c.fill();
      });
      // text via f.text so it is not mirrored on the right side
      const s = Math.min(f.h, f.midChord) * 0.33;
      f.text('ups', 0.45, 0.5 + (s * 0.02) / f.h, s * 0.42, '#351C15', { weight: 900, maxW: s * 1.4 });
    },
  },
  {
    id: 'virgin', name: 'Virgin Atlantic', subtitle: '2019 livery', country: 'GB',
    fleet: ['a350-1000', 'a330-900', 'a330-300', 'b787-9', 'b747-400'],
    base: '#e7e8ec', engine: '#DA0530', pylon: '#e7e8ec', finBase: '#DA0530', wingletOut: '#DA0530', wingletIn: '#5b1f69', stab: '#d4d6da',
    fuselage(p, l) {
      p.text('virgin atlantic', titleX(l, 0.4), TH, titleSize(l, 0.4), '#DA0530', { font: FONTS.script, weight: 400 });
      p.band(3, (x) => 0.8 - 1.5 * ((x - l.tailStart) / l.Lt), '#DA0530', { x0: l.tailStart + l.Lt * 0.1 });
      p.band(-0.7, -1.6, '#5b1f69', { x0: l.L * 0.08, x1: l.L * 0.85 });
    },
    fin(f) { f.fill('#DA0530'); f.text('virgin', 0.48, 0.45, f.h * 0.18, '#ffffff', { font: FONTS.script, weight: 400, maxW: f.midChord * 1.3 }); },
  },
  {
    id: 'chinaeastern', name: 'China Eastern', subtitle: '2014 livery', country: 'CN',
    fleet: ['c919', 'a320neo', 'a321neo', 'a330-300', 'a350-900', 'b737-800', 'b777-300er', 'b787-9', 'a330-200'],
    base: '#ffffff', engine: '#e2e4e8', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#1A3A8A', wingletIn: '#C8102E', stab: '#d2d5da',
    fuselage(p, l) {
      p.text('中国东方航空', titleX(l, 0.25), TH, titleSize(l, 0.3), '#1A3A8A', { font: FONTS.sans, weight: 700 });
      p.text('CHINA EASTERN', titleX(l, 0.5), TH, titleSize(l, 0.25), '#1A3A8A', { font: FONTS.sans, weight: 700, spacing: 0.06 });
      p.band(-0.55, -1.6, '#1A3A8A', { x0: l.L * 0.04, x1: l.L * 0.88 });
    },
    fin(f) {
      f.fill('#ffffff');
      f.draw(0.48, 0.5, (c) => {
        const r = Math.min(f.h, f.midChord) * 0.35;
        c.beginPath(); c.arc(0, 0, r, 0.2, Math.PI - 0.2); c.quadraticCurveTo(0, r * 0.1, Math.cos(0.2) * r, Math.sin(0.2) * r); c.fillStyle = '#C8102E'; c.fill();
        c.beginPath(); c.arc(0, 0, r, Math.PI + 0.2, -0.2); c.quadraticCurveTo(0, -r * 0.1, -Math.cos(0.2) * r, -Math.sin(0.2) * r); c.fillStyle = '#1A3A8A'; c.fill();
      });
    },
  },
  {
    id: 'aeroflot', name: 'Aeroflot', subtitle: '2003 livery', country: 'RU',
    fleet: ['ssj100', 'a320neo', 'a321neo', 'a330-300', 'a350-900', 'b737-800', 'b777-300er'],
    base: '#eef0f3', engine: '#02458D', pylon: '#eef0f3', finBase: '#c9ced4', wingletOut: '#02458D', wingletIn: '#D52B1E', stab: '#c9ced4',
    fuselage(p, l) {
      p.text('AEROFLOT', titleX(l, 0.33), TH, titleSize(l, 0.33), '#02458D', { font: FONTS.sans, weight: 800, spacing: 0.08 });
      p.text('АЭРОФЛОТ', titleX(l, 0.33), TH - 0.42, titleSize(l, 0.16), '#02458D', { font: FONTS.sans, weight: 700 });
      p.band(-0.3, -0.38, '#02458D', { x0: l.L * 0.05, x1: l.L * 0.88 });
    },
    fin(f) {
      f.fill('#c9ced4');
      f.poly([[-0.2, 0.62], [1.3, 0.62], [1.3, 1.2], [-0.2, 1.2]], '#ffffff');
      f.poly([[-0.2, 0.44], [1.3, 0.44], [1.3, 0.62], [-0.2, 0.62]], '#0039A6');
      f.poly([[-0.2, 0.26], [1.3, 0.26], [1.3, 0.44], [-0.2, 0.44]], '#D52B1E');
    },
  },
  // ------------------------------------------------------------ more airlines
  {
    id: 'southwest-canyon', name: 'Southwest Airlines', subtitle: 'Canyon Blue (2001, retro)', country: 'US',
    fleet: ['b737-700', 'b737-800'],
    base: '#3D5BA9', wing: '#c4c8ce', engine: '#3D5BA9', engineLip: '#c9cdd3', pylon: '#3D5BA9', stab: '#3D5BA9', finBase: '#3D5BA9',
    wingletOut: '#3D5BA9', wingletIn: '#3D5BA9', regColor: '#ffffff', doorColor: 'rgba(10,20,60,0.6)', windowColor: '#121a3a',
    fuselage(p, l) {
      const L = l.L;
      // red and gold cheat-sweep: gold belly, red band, both rising into the tail
      const rise = (x) => (x > L * 0.6 ? Math.pow((x - L * 0.6) / (L * 0.4), 1.5) * 1.6 : 0);
      p.band((x) => -0.18 + rise(x), (x) => -0.4 + rise(x), '#C8102E', { x0: L * 0.02 });
      p.band((x) => -0.4 + rise(x), -1.6, '#E9A71C', { x0: 0 });
      p.text('SOUTHWEST', titleX(l, 0.4), TH, titleSize(l, 0.36), '#ffffff', { font: FONTS.sans, weight: 800, spacing: 0.08, maxW: L * 0.48 * (p.kx / p.kv) });
    },
    fin(f) {
      f.fill('#3D5BA9');
      f.poly([[0.62, -0.2], [1.3, -0.2], [1.3, 0.35], [0.95, 0.35]], '#C8102E');
      f.poly([[0.85, -0.2], [1.3, -0.2], [1.3, 0.12], [1.05, 0.12]], '#E9A71C');
    },
  },
  {
    id: 'spirit', name: 'Spirit Airlines', subtitle: 'Bare Fare yellow', country: 'US',
    fleet: ['a319neo', 'a320neo', 'a321neo'],
    base: '#FFE500', belly: '#FFE500', wing: '#c3c8cf', engine: '#FFE500', engineLip: '#bfc3c8', pylon: '#FFE500', stab: '#FFE500', finBase: '#FFE500',
    wingletOut: '#FFE500', wingletIn: '#FFE500', regColor: '#111111', windowColor: '#111111', doorColor: 'rgba(60,55,0,0.55)',
    engineText: { text: 'spirit', color: '#111111', font: FONTS.wide },
    fuselage(p, l) {
      p.text('spirit', titleX(l, 0.4), 0.42, titleSize(l, 0.66), '#111111', { font: FONTS.wide, weight: 900, spacing: -0.02, maxW: l.L * 0.45 * (p.kx / p.kv) });
      p.text('spirit.com', l.tailStart - l.L * 0.02, 0.6, titleSize(l, 0.13), '#111111', { font: FONTS.sans, weight: 700 });
    },
    fin(f) { f.fill('#FFE500'); },
  },
  {
    id: 'frontier', name: 'Frontier Airlines', subtitle: 'Animal tails · "Flo" the fox', country: 'US',
    fleet: ['a320neo', 'a321neo'],
    base: '#ffffff', engine: '#00764C', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#3f86c9', wingletOut: '#00764C', wingletIn: '#00764C', stab: '#d3d6da',
    fuselage(p, l) {
      p.text('FRONTIER', titleX(l, 0.38), TH - 0.02, titleSize(l, 0.44), '#00764C', { font: FONTS.wide, weight: 900, spacing: 0.02, maxW: l.L * 0.5 * (p.kx / p.kv) });
      p.band(-0.62, -1.6, '#00764C', { x0: l.L * 0.12, x1: l.L * 0.74 });
      p.band(3, ramp(l.tailStart, 0.7, l.L, -0.6), '#3f86c9', { x0: l.tailStart + l.Lt * 0.12 });
      p.text('FlyFrontier.com', l.tailStart - l.L * 0.04, 0.62, titleSize(l, 0.12), '#00764C', { font: FONTS.sans, weight: 700 });
    },
    fin(f) {
      // sky-to-forest photo background
      const g = [['#9cc9ef', 0.75, 1.3], ['#6fa9de', 0.5, 0.75], ['#3f86c9', 0.25, 0.5], ['#2f6a3e', -0.2, 0.25]];
      for (const [col, h0, h1] of g) f.poly([[-0.3, h0], [1.3, h0], [1.3, h1], [-0.3, h1]], col);
      f.draw(0.5, 0.5, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.42; // fox head facing forward (-x)
        c.fillStyle = '#E36F1E';
        c.beginPath(); c.moveTo(-s * 1.0, -s * 0.05); c.quadraticCurveTo(-s * 0.6, s * 0.35, -s * 0.15, s * 0.45); c.lineTo(-s * 0.05, s * 1.0); c.lineTo(s * 0.25, s * 0.55);
        c.lineTo(s * 0.55, s * 0.95); c.lineTo(s * 0.62, s * 0.35); c.quadraticCurveTo(s * 0.8, -s * 0.3, s * 0.4, -s * 0.75); c.quadraticCurveTo(-s * 0.2, -s * 0.6, -s * 1.0, -s * 0.05); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.moveTo(-s * 1.0, -s * 0.05); c.quadraticCurveTo(-s * 0.4, -s * 0.05, -s * 0.05, -s * 0.25); c.quadraticCurveTo(s * 0.15, -s * 0.6, s * 0.4, -s * 0.75); c.quadraticCurveTo(-s * 0.2, -s * 0.6, -s * 1.0, -s * 0.05); c.fill();
        c.beginPath(); c.moveTo(-s * 0.02, s * 0.85); c.lineTo(s * 0.18, s * 0.55); c.lineTo(-s * 0.08, s * 0.5); c.fillStyle = '#3a1d0c'; c.fill();
        c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(-s * 0.98, -s * 0.03, s * 0.08, 0, 7); c.fill();
        c.beginPath(); c.ellipse(-s * 0.32, s * 0.2, s * 0.09, s * 0.05, -0.3, 0, 7); c.fill();
      });
    },
  },
  {
    id: 'hawaiian', name: 'Hawaiian Airlines', subtitle: 'Pualani (2017)', country: 'US',
    fleet: ['a321neo', 'a330-200', 'b787-9', 'b717-200'],
    base: '#ffffff', engine: '#e4e1ea', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#413691', wingletOut: '#413691', wingletIn: '#CE0C88', stab: '#d6d4dc',
    fuselage(p, l) {
      p.text('HAWAIIAN', titleX(l, 0.36), TH, titleSize(l, 0.34), '#413691', { font: FONTS.sans, weight: 700, spacing: 0.14, maxW: l.L * 0.42 * (p.kx / p.kv) });
      // lauhala weave band flowing from the tail
      const x0 = l.tailStart - l.L * 0.08;
      p.band(3, ramp(x0, 1.2, l.L, -0.5), '#413691', { x0 });
      for (let k = 0; k < 26; k++) {
        const x = x0 + (k / 26) * (l.L - x0), top = ramp(x0, 1.2, l.L, -0.5)(x);
        for (let j = 0; j < 4; j++) p.poly([[x, top + 0.25 + j * 0.28], [x + 0.25, top + 0.38 + j * 0.28], [x, top + 0.5 + j * 0.28], [x - 0.25, top + 0.38 + j * 0.28]], (k + j) % 2 ? '#5a4aa8' : '#6c2f9a');
      }
    },
    fin(f) {
      const g = [['#413691', 0.55, 1.3], ['#6a2b97', 0.3, 0.55], ['#9c1b90', 0.1, 0.3], ['#CE0C88', -0.2, 0.1]];
      for (const [col, h0, h1] of g) f.poly([[-0.3, h0], [1.3, h0], [1.3, h1], [-0.3, h1]], col);
      f.draw(0.5, 0.5, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.5; // Pualani: profile facing forward with a hibiscus in her hair
        c.fillStyle = '#2a1b5c';
        c.beginPath(); c.moveTo(-s * 0.25, s * 0.75); c.quadraticCurveTo(s * 0.6, s * 0.95, s * 0.9, s * 0.3); c.quadraticCurveTo(s * 1.1, -s * 0.4, s * 0.7, -s * 0.95); c.lineTo(0, -s * 0.95); c.quadraticCurveTo(s * 0.2, 0, -s * 0.25, s * 0.75); c.fill();
        c.fillStyle = '#f3e6ef';
        c.beginPath(); c.moveTo(-s * 0.25, s * 0.72); c.quadraticCurveTo(-s * 0.32, s * 0.45, -s * 0.48, s * 0.22); c.lineTo(-s * 0.34, s * 0.14); c.lineTo(-s * 0.4, s * 0.02);
        c.lineTo(-s * 0.33, -s * 0.06); c.lineTo(-s * 0.36, -s * 0.14); c.quadraticCurveTo(-s * 0.3, -s * 0.32, -s * 0.1, -s * 0.32); c.lineTo(-s * 0.02, -s * 0.95); c.lineTo(s * 0.25, -s * 0.95);
        c.quadraticCurveTo(s * 0.15, -s * 0.2, s * 0.2, s * 0.25); c.quadraticCurveTo(s * 0.1, s * 0.6, -s * 0.25, s * 0.72); c.fill();
        // hibiscus
        c.save(); c.translate(s * 0.42, s * 0.42); c.fillStyle = '#ffffff';
        for (let k = 0; k < 5; k++) { c.rotate((Math.PI * 2) / 5); c.beginPath(); c.ellipse(s * 0.13, 0, s * 0.14, s * 0.09, 0, 0, 7); c.fill(); }
        c.fillStyle = '#CE0C88'; c.beginPath(); c.arc(0, 0, s * 0.06, 0, 7); c.fill(); c.restore();
      });
    },
  },
  {
    id: 'swiss', name: 'SWISS', subtitle: '2011 livery', country: 'CH',
    fleet: ['a220-300', 'a320neo', 'a321neo', 'a330-300', 'a350-900', 'b777-300er'],
    base: '#ffffff', engine: '#e4e6e9', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#E2001A', wingletOut: '#E2001A', wingletIn: '#E2001A', stab: '#d4d7db',
    fuselage(p, l) {
      const sz = titleSize(l, 0.36);
      const flag = (c) => { const s = sz * 0.62; c.fillStyle = '#E2001A'; c.fillRect(-s, -s, 2 * s, 2 * s); c.fillStyle = '#fff'; c.fillRect(-s * 0.19, -s * 0.62, s * 0.38, s * 1.24); c.fillRect(-s * 0.62, -s * 0.19, s * 1.24, s * 0.38); };
      titleRow(p, titleX(l, 0.3), TH, [{ w: sz * 1.24, draw: flag }, { t: 'SWISS', size: sz, color: '#1a1a1a', o: { font: FONTS.sans, weight: 800, spacing: 0.04 } }], sz * 0.5);
      p.text('swiss.com', l.tailStart - l.L * 0.03, 0.62, titleSize(l, 0.12), '#1a1a1a', { font: FONTS.sans, weight: 600 });
    },
    fin(f) {
      f.fill('#E2001A');
      f.draw(0.5, 0.5, (c) => { const s = Math.min(f.h, f.midChord) * 0.32; c.fillStyle = '#ffffff'; c.fillRect(-s * 0.2, -s * 0.65, s * 0.4, s * 1.3); c.fillRect(-s * 0.65, -s * 0.2, s * 1.3, s * 0.4); });
    },
  },
  {
    id: 'airindia', name: 'Air India', subtitle: 'The Vista (2023)', country: 'IN',
    fleet: ['a320neo', 'a321neo', 'a350-900', 'a350-1000', 'b777-200er', 'b777-300er', 'b787-8', 'b787-9'],
    base: '#ffffff', engine: '#4B1E46', engineLip: '#C9A15B', pylon: '#ffffff', finBase: '#D9152B', wingletOut: '#D9152B', wingletIn: '#4B1E46', stab: '#d6d3d8',
    fuselage(p, l) {
      const sz = titleSize(l, 0.33);
      const vista = (c) => { // gold "window" arch
        const s = sz * 0.75; c.strokeStyle = '#C9A15B'; c.lineWidth = s * 0.14; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(-s * 0.55, -s); c.lineTo(-s * 0.55, s * 0.2); c.quadraticCurveTo(-s * 0.5, s * 0.75, 0, s * 1.05); c.quadraticCurveTo(s * 0.5, s * 0.75, s * 0.55, s * 0.2); c.lineTo(s * 0.55, -s); c.stroke();
      };
      titleRow(p, titleX(l, 0.33), TH, [{ w: sz * 0.9, draw: vista }, { t: 'AIR INDIA', size: sz, color: '#D9152B', o: { font: FONTS.sans, weight: 700, spacing: 0.1 } }], sz * 0.5);
      // aubergine and red sweep from the tail onto the rear fuselage
      const x0 = l.tailStart - l.L * 0.02;
      p.band(3, ramp(x0, 1.1, l.L, -0.7), '#4B1E46', { x0 });
      p.band(3, ramp(x0 + l.Lt * 0.25, 1.1, l.L, 0.1), '#D9152B', { x0: x0 + l.Lt * 0.25 });
      p.band(ramp(x0, 1.1, l.L, -0.7), ramp(x0, 1.0, l.L, -0.8), '#C9A15B', { x0 });
    },
    fin(f) {
      f.fill('#D9152B');
      f.poly([[-0.3, -0.2], [1.3, -0.2], [1.3, 0.05], [-0.3, 0.32]], '#4B1E46');
      f.poly([[-0.3, 0.32], [1.3, 0.05], [1.3, 0.09], [-0.3, 0.36]], '#C9A15B');
      f.draw(0.5, 0.62, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.34; c.strokeStyle = '#C9A15B'; c.lineWidth = s * 0.09; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(-s * 0.6, -s * 0.9); c.lineTo(-s * 0.6, s * 0.15); c.quadraticCurveTo(-s * 0.55, s * 0.75, 0, s * 1.05); c.quadraticCurveTo(s * 0.55, s * 0.75, s * 0.6, s * 0.15); c.lineTo(s * 0.6, -s * 0.9); c.stroke();
        c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(-s * 0.35, -s * 0.9); c.lineTo(-s * 0.35, s * 0.1); c.quadraticCurveTo(-s * 0.3, s * 0.55, 0, s * 0.75); c.quadraticCurveTo(s * 0.3, s * 0.55, s * 0.35, s * 0.1); c.lineTo(s * 0.35, -s * 0.9); c.stroke();
      });
    },
  },
  {
    id: 'indigo', name: 'IndiGo', subtitle: '6E', country: 'IN',
    fleet: ['a320neo', 'a321neo', 'atr72-600'],
    base: '#ffffff', engine: '#1B2A80', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#1B2A80', wingletOut: '#1B2A80', wingletIn: '#1B2A80', stab: '#d3d6db',
    fuselage(p, l) {
      p.text('IndiGo', titleX(l, 0.4), TH, titleSize(l, 0.44), '#1B2A80', { font: FONTS.sans, weight: 700, maxW: l.L * 0.4 * (p.kx / p.kv) });
      p.band(3, ramp(l.tailStart, 0.85, l.L, -0.55), '#1B2A80', { x0: l.tailStart + l.Lt * 0.08 });
      // trailing dots streaming forward from the tail along the lower fuselage
      const x0 = l.L * 0.45;
      for (let i = 0; i < 26; i++) for (let j = 0; j < 4; j++) {
        const x = x0 + i * (l.tailStart - x0) / 26, t = i / 26, r = 0.04 + 0.16 * t * (1 - j * 0.15);
        if ((i + j) % 2) continue;
        p.draw(x, -0.48 - j * 0.16 + 0.35 * t * t, (c) => { c.beginPath(); c.arc(0, 0, r, 0, 7); c.fillStyle = '#1B2A80'; c.fill(); });
      }
    },
    fin(f) {
      f.fill('#1B2A80');
      // dotted aircraft symbol
      f.draw(0.5, 0.48, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.06; c.fillStyle = '#ffffff';
        const pts = [[-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [0.5, 2], [1, 3], [0, -1], [0.5, -2], [1, -3], [3, 1], [3, -1], [4, 1.5]];
        for (const [x, y] of pts) { c.beginPath(); c.arc(x * s * 1.3, y * s * 1.3, s * 0.45, 0, 7); c.fill(); }
      });
    },
  },
  {
    id: 'ethiopian', name: 'Ethiopian Airlines', subtitle: 'Star Alliance member', country: 'ET',
    fleet: ['b737-800', 'b737-max8', 'b767-300er', 'b777-200er', 'b777-300er', 'b777f', 'b787-8', 'b787-9', 'a350-900', 'a350-1000', 'dash8-400'],
    base: '#ffffff', engine: '#e6e8eb', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#078930', wingletIn: '#FCDD09', stab: '#d4d7db',
    fuselage(p, l) {
      const sz = titleSize(l, 0.38);
      titleRow(p, titleX(l, 0.36), TH, [
        { t: 'ethiopian', size: sz, color: '#078930', o: { font: FONTS.sans, weight: 700 } },
        { t: 'ኢትዮጵያ', size: sz * 0.62, color: '#078930', o: { font: FONTS.sans, weight: 700 } },
      ], sz * 0.6);
      // tricolour ribbons along the tail cone
      const x0 = l.tailStart - l.L * 0.02;
      const rib = (h0, col) => p.band(ramp(x0, h0, l.L, h0 + 1.0), ramp(x0, h0 - 0.12, l.L, h0 + 0.82), col, { x0 });
      rib(-0.3, '#078930'); rib(-0.45, '#FCDD09'); rib(-0.6, '#DA121A');
    },
    fin(f) {
      f.fill('#ffffff');
      // three sweeping feathers: green, yellow, red
      const feather = (a0, h0, col) => {
        const pts = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push([a0 + 0.9 * t, h0 + 0.95 * t * t + 0.18]); }
        for (let k = 16; k >= 0; k--) { const t = k / 16; pts.push([a0 + 0.9 * t + 0.08, h0 + 0.95 * t * t]); }
        f.poly(pts, col);
      };
      feather(0.05, -0.05, '#DA121A'); feather(0.15, 0.12, '#FCDD09'); feather(0.25, 0.29, '#078930');
    },
  },
  {
    id: 'egyptair', name: 'EGYPTAIR', subtitle: 'Horus', country: 'EG',
    fleet: ['a220-300', 'a320neo', 'a321neo', 'a330-200', 'a330-300', 'a350-900', 'b737-800', 'b777-300er', 'b787-9'],
    base: '#ffffff', engine: '#e3e5e8', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#0B2F6B', wingletOut: '#0B2F6B', wingletIn: '#0B2F6B', stab: '#d2d5da',
    fuselage(p, l) {
      const sz = titleSize(l, 0.33);
      titleRow(p, titleX(l, 0.36), TH, [
        { t: 'EGYPTAIR', size: sz, color: '#0B2F6B', o: { font: FONTS.sans, weight: 800, spacing: 0.06 } },
        { t: 'مصر للطيران', size: sz * 0.9, color: '#0B2F6B', o: { font: FONTS.serif, weight: 700 } },
      ], sz * 0.8);
      p.band(3, ramp(l.tailStart, 0.8, l.L, -0.5), '#0B2F6B', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#0B2F6B');
      f.draw(0.5, 0.52, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.36; c.fillStyle = '#C9A23A'; // Horus head facing forward
        c.beginPath(); c.moveTo(s * 0.7, -s * 0.9); c.quadraticCurveTo(s * 0.9, s * 0.4, s * 0.3, s * 0.85); c.quadraticCurveTo(-s * 0.35, s * 1.0, -s * 0.6, s * 0.45);
        c.quadraticCurveTo(-s * 0.95, s * 0.35, -s * 0.9, s * 0.05); c.quadraticCurveTo(-s * 0.75, s * 0.1, -s * 0.6, s * 0.12); c.quadraticCurveTo(-s * 0.45, -s * 0.2, -s * 0.15, -s * 0.3);
        c.quadraticCurveTo(-s * 0.05, -s * 0.7, -s * 0.2, -s * 0.9); c.closePath(); c.fill();
        c.fillStyle = '#0B2F6B';
        c.beginPath(); c.ellipse(-s * 0.2, s * 0.42, s * 0.14, s * 0.09, 0, 0, 7); c.fill();
        c.lineWidth = s * 0.07; c.strokeStyle = '#0B2F6B'; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-s * 0.05, s * 0.42); c.lineTo(s * 0.45, s * 0.42); c.moveTo(-s * 0.18, s * 0.3); c.quadraticCurveTo(-s * 0.1, -s * 0.1, -s * 0.05, -s * 0.2);
        c.moveTo(s * 0.1, s * 0.25); c.quadraticCurveTo(s * 0.35, -s * 0.2, s * 0.15, -s * 0.45); c.stroke();
      });
    },
  },
  {
    id: 'latam', name: 'LATAM Airlines', subtitle: '2016 livery', country: 'CL',
    fleet: ['a319neo', 'a320neo', 'a321neo', 'b767-300er', 'b787-8', 'b787-9', 'b777-300er'],
    base: '#ffffff', engine: '#1B0088', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#1B0088', wingletOut: '#1B0088', wingletIn: '#E8114B', stab: '#d2d4dc',
    regColor: '#ffffff',
    fuselage(p, l) {
      // indigo belly with a coral pinstripe, rising into the tail
      const rise = (x) => (x > l.L * 0.58 ? Math.pow((x - l.L * 0.58) / (l.L * 0.42), 1.5) * 1.6 : 0);
      p.band((x) => -0.28 + rise(x), (x) => -0.34 + rise(x), '#E8114B', { x0: l.L * 0.06 });
      p.band((x) => -0.36 + rise(x), -1.6, '#1B0088', { x0: l.L * 0.04 });
      p.text('LATAM', titleX(l, 0.32), TH, titleSize(l, 0.42), '#1B0088', { font: FONTS.sans, weight: 800, spacing: 0.08 });
    },
    fin(f) {
      f.fill('#1B0088');
      f.draw(0.5, 0.52, (c) => { // coral crescent swoosh
        const s = Math.min(f.h, f.midChord) * 0.38; c.fillStyle = '#E8114B';
        c.beginPath(); c.moveTo(-s * 0.9, -s * 0.35); c.bezierCurveTo(-s * 0.2, s * 0.15, s * 0.4, s * 0.55, s * 0.85, s * 0.95);
        c.bezierCurveTo(s * 0.55, s * 0.25, -s * 0.1, -s * 0.35, -s * 0.9, -s * 0.35); c.fill();
        c.beginPath(); c.moveTo(-s * 0.6, -s * 0.75); c.bezierCurveTo(0, -s * 0.5, s * 0.5, 0, s * 0.85, s * 0.6);
        c.bezierCurveTo(s * 0.4, -s * 0.15, -s * 0.05, -s * 0.6, -s * 0.6, -s * 0.75); c.fill();
      });
    },
  },
  {
    id: 'aeromexico', name: 'Aeroméxico', subtitle: 'Caballero Águila (2014)', country: 'MX',
    fleet: ['b737-800', 'b737-max8', 'b737-max9', 'b787-8', 'b787-9', 'e190'],
    base: '#ffffff', engine: '#0B2343', engineLip: '#b9bec5', pylon: '#ffffff', finBase: '#0B2343', wingletOut: '#0B2343', wingletIn: '#0B2343', stab: '#d0d4da',
    fuselage(p, l) {
      p.band(-0.5, -1.6, '#0B2343', { x0: l.L * 0.05 });
      p.band(-0.42, -0.5, '#9aa4b1', { x0: l.L * 0.08 });
      p.text('AEROMEXICO', titleX(l, 0.35), TH, titleSize(l, 0.32), '#0B2343', { font: FONTS.sans, weight: 700, spacing: 0.1 });
      p.band(3, ramp(l.tailStart, 0.8, l.L, -0.6), '#0B2343', { x0: l.tailStart + l.Lt * 0.08 });
    },
    fin(f) {
      f.fill('#0B2343');
      f.draw(0.52, 0.5, (c) => { // eagle-knight head facing forward, in silver
        const s = Math.min(f.h, f.midChord) * 0.4;
        c.fillStyle = '#c9cfd8';
        c.beginPath(); c.moveTo(s * 0.8, -s * 0.9); c.quadraticCurveTo(s * 0.9, s * 0.6, s * 0.1, s * 0.9); c.quadraticCurveTo(-s * 0.5, s * 0.95, -s * 0.7, s * 0.5);
        c.lineTo(-s * 1.0, s * 0.3); c.quadraticCurveTo(-s * 0.95, s * 0.05, -s * 0.7, -s * 0.05); c.lineTo(-s * 0.6, s * 0.1); c.quadraticCurveTo(-s * 0.3, -s * 0.2, -s * 0.2, -s * 0.9); c.closePath(); c.fill();
        c.fillStyle = '#0B2343';
        c.beginPath(); c.moveTo(-s * 0.45, s * 0.42); c.quadraticCurveTo(-s * 0.2, s * 0.55, s * 0.05, s * 0.4); c.quadraticCurveTo(-s * 0.2, s * 0.32, -s * 0.45, s * 0.42); c.fill();
        // feather plumes of the helmet
        c.strokeStyle = '#0B2343'; c.lineWidth = s * 0.06;
        for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(s * (0.05 + k * 0.17), s * 0.7); c.quadraticCurveTo(s * (0.2 + k * 0.17), s * 0.1, s * (0.05 + k * 0.17), -s * 0.7); c.stroke(); }
      });
    },
  },
  {
    id: 'westjet', name: 'WestJet', subtitle: '2018 livery', country: 'CA',
    fleet: ['b737-700', 'b737-800', 'b737-max8', 'b737-max7', 'b787-9', 'dash8-400'],
    base: '#ffffff', engine: '#00505A', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#00505A', wingletOut: '#00505A', wingletIn: '#00A7A5', stab: '#d0d5d8',
    fuselage(p, l) {
      const sz = titleSize(l, 0.34);
      const leaf = (c) => { mapleLeaf(c, sz * 1.05); c.fillStyle = '#00A7A5'; c.fill(); };
      titleRow(p, titleX(l, 0.33), TH, [{ w: sz * 1.7, draw: leaf }, { t: 'WESTJET', size: sz, color: '#00505A', o: { font: FONTS.sans, weight: 800, spacing: 0.08 } }], sz * 0.45);
      const x0 = l.L * 0.55;
      p.band(ramp(x0, -0.75, l.L, 1.1), -1.6, '#00505A', { x0: l.L * 0.4 });
      p.band(ramp(x0, -0.62, l.L, 1.3), ramp(x0, -0.75, l.L, 1.1), '#00A7A5', { x0: l.L * 0.45 });
      p.band(3, ramp(l.tailStart, 0.85, l.L, -0.5), '#00505A', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#00505A');
      f.draw(0.48, 0.48, (c) => { const s = Math.min(f.h, f.midChord) * 0.42; mapleLeaf(c, s); c.fillStyle = '#00A7A5'; c.fill(); c.lineWidth = s * 0.05; c.strokeStyle = '#ffffff'; c.stroke(); });
    },
  },
  {
    id: 'iberia', name: 'Iberia', subtitle: '2013 livery', country: 'ES',
    fleet: ['a320neo', 'a321neo', 'a330-200', 'a330-300', 'a350-900'],
    base: '#ffffff', engine: '#e4e6e9', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#D7192D', wingletIn: '#D7192D', stab: '#d3d6da',
    fuselage(p, l) {
      p.text('IBERIA', titleX(l, 0.33), TH, titleSize(l, 0.4), '#D7192D', { font: FONTS.sans, weight: 800, spacing: 0.12 });
      p.band(3, ramp(l.tailStart, 1.0, l.L, -0.2), '#D7192D', { x0: l.tailStart + l.Lt * 0.2 });
    },
    fin(f) {
      f.fill('#ffffff');
      // red top sweeping down to the trailing edge, then the orange and yellow crown strokes
      const curve = (h0, dh) => Array.from({ length: 17 }, (_, k) => { const a = -0.3 + 1.6 * k / 16; return [a, h0 - dh * Math.pow((a + 0.3) / 1.6, 1.3)]; });
      const band = (h0, h1, dh, col) => f.poly([...curve(h0, dh), ...curve(h1, dh).reverse()], col);
      band(1.3, 0.62, 0.55, '#D7192D');
      band(0.56, 0.44, 0.55, '#F39200');
      band(0.38, 0.28, 0.55, '#FFCC00');
    },
  },
  {
    id: 'austrian', name: 'Austrian Airlines', subtitle: '2018 livery', country: 'AT',
    fleet: ['a320neo', 'b767-300er', 'b777-200er', 'b777-300er', 'b787-9'],
    base: '#ffffff', engine: '#e3e5e8', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#E30613', wingletOut: '#E30613', wingletIn: '#E30613', stab: '#d3d6da',
    fuselage(p, l) {
      p.text('Austrian', titleX(l, 0.34), TH, titleSize(l, 0.42), '#E30613', { font: FONTS.sans, weight: 700 });
      p.band(3, ramp(l.tailStart, 0.85, l.L, -0.5), '#E30613', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#E30613');
      // red-white-red: white band with the forward-pointing chevron
      f.poly([[-0.3, 0.4], [1.3, 0.4], [1.3, 0.6], [-0.3, 0.6]], '#ffffff');
      f.draw(0.38, 0.5, (c) => {
        const s = Math.min(f.h, f.midChord) * 0.3; c.fillStyle = '#E30613';
        c.beginPath(); c.moveTo(-s * 0.9, 0); c.lineTo(s * 0.1, s * 0.55); c.lineTo(s * 0.1, s * 0.28); c.lineTo(-s * 0.35, 0); c.lineTo(s * 0.1, -s * 0.28); c.lineTo(s * 0.1, -s * 0.55); c.closePath(); c.fill();
      });
    },
  },
  {
    id: 'finnair', name: 'Finnair', subtitle: '2010 livery', country: 'FI',
    fleet: ['a330-300', 'a350-900', 'atr72-600', 'e190'],
    base: '#ffffff', engine: '#e6e8eb', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#ffffff', wingletIn: '#ffffff', stab: '#d6d9dd',
    fuselage(p, l) {
      p.text('FINNAIR', titleX(l, 0.34), TH, titleSize(l, 0.4), '#0B1560', { font: FONTS.sans, weight: 800, spacing: 0.08 });
    },
    fin(f) {
      f.fill('#ffffff');
      f.text('FINNAIR', 0.5, 0.42, f.h * 0.11, '#0B1560', { weight: 800, maxW: f.midChord * 0.72 });
    },
  },
  {
    id: 'koreanair', name: 'Korean Air', subtitle: 'Sky blue (classic)', country: 'KR',
    fleet: ['a220-300', 'a321neo', 'a330-300', 'a380-800', 'b737-800', 'b737-900er', 'b737-max8', 'b747-8i', 'b747-8f', 'b777-200er', 'b777-300er', 'b777f', 'b787-9', 'b787-10', 'a330-200'],
    base: '#8FC9EC', belly: '#c4c9cf', engine: '#8FC9EC', engineLip: '#c8ccd2', pylon: '#8FC9EC', finBase: '#8FC9EC', wingletOut: '#8FC9EC', wingletIn: '#8FC9EC', stab: '#8FC9EC',
    windowColor: '#14283a', regColor: '#0B2265',
    fuselage(p, l) {
      p.band(-0.3, -1.6, '#c4c9cf');
      p.band(-0.25, -0.3, '#ffffff');
      p.band(-0.3, -0.34, '#0B2265', { x0: l.L * 0.04, x1: l.L * 0.9 });
      const sz = titleSize(l, 0.32);
      titleRow(p, titleX(l, 0.37), TH, [
        { t: 'KOREAN AIR', size: sz, color: '#0B2265', o: { font: FONTS.sans, weight: 700, spacing: 0.08 } },
        { t: '대한항공', size: sz * 0.8, color: '#0B2265', o: { font: FONTS.sans, weight: 700 } },
      ], sz * 0.9);
    },
    fin(f) {
      f.fill('#8FC9EC');
      f.draw(0.48, 0.5, (c) => { const r = Math.min(f.h, f.midChord) * 0.3; circle(c, r * 1.1); c.fillStyle = '#ffffff'; c.fill(); taegeuk(c, r); });
    },
  },
  {
    id: 'eva', name: 'EVA Air', subtitle: '2015 livery', country: 'TW',
    fleet: ['a321neo', 'a330-300', 'a350-1000', 'b777-300er', 'b777f', 'b787-9', 'b787-10'],
    base: '#ffffff', engine: '#00563F', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#00563F', wingletOut: '#00563F', wingletIn: '#00563F', stab: '#cfd4d2',
    regColor: '#ffffff',
    fuselage(p, l) {
      p.band(-0.22, -1.6, '#00563F');
      p.band(-0.17, -0.22, '#F08300');
      p.text('EVA AIR', titleX(l, 0.3), TH, titleSize(l, 0.38), '#00563F', { font: FONTS.sans, weight: 800, spacing: 0.12 });
      p.band(3, ramp(l.tailStart, 0.8, l.L, -0.4), '#00563F', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#00563F');
      f.draw(0.48, 0.5, (c) => { // globe with orange ring
        const r = Math.min(f.h, f.midChord) * 0.3;
        circle(c, r * 1.12); c.fillStyle = '#F08300'; c.fill();
        circle(c, r); c.fillStyle = '#ffffff'; c.fill();
        c.strokeStyle = '#00563F'; c.lineWidth = r * 0.08;
        for (const k of [0.35, 0.7]) { c.beginPath(); c.ellipse(0, 0, r * k, r, 0, 0, 7); c.stroke(); }
        for (const y of [-0.5, 0, 0.5]) { const w = Math.sqrt(1 - y * y) * r; c.beginPath(); c.moveTo(-w, y * r); c.lineTo(w, y * r); c.stroke(); }
      });
    },
  },
  {
    id: 'thai', name: 'Thai Airways', subtitle: 'Royal Orchid', country: 'TH',
    fleet: ['a321neo', 'a330-300', 'a350-900', 'b777-300er', 'b787-8', 'b787-9'],
    base: '#ffffff', engine: '#e4e2e8', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#4E1A74', wingletOut: '#4E1A74', wingletIn: '#4E1A74', stab: '#d4d2da',
    fuselage(p, l) {
      const sz = titleSize(l, 0.36);
      titleRow(p, titleX(l, 0.33), TH, [
        { t: 'THAI', size: sz, color: '#4E1A74', o: { font: FONTS.sans, weight: 800, spacing: 0.12 } },
        { t: 'การบินไทย', size: sz * 0.7, color: '#4E1A74', o: { font: FONTS.sans, weight: 700 } },
      ], sz * 0.8);
      // purple, gold and magenta sweep under the tail
      const x0 = l.tailStart - l.L * 0.06;
      p.band(3, ramp(x0, 1.1, l.L, -0.55), '#4E1A74', { x0 });
      p.band(ramp(x0, 1.1, l.L, -0.55), ramp(x0, 0.98, l.L, -0.7), '#D4A017', { x0 });
      p.band(ramp(x0, 0.98, l.L, -0.7), ramp(x0, 0.82, l.L, -0.9), '#C3228B', { x0 });
    },
    fin(f) {
      f.fill('#4E1A74');
      f.draw(0.5, 0.5, (c) => { // stylised orchid
        const s = Math.min(f.h, f.midChord) * 0.36;
        const petal = (rot, len, wid, col) => { c.save(); c.rotate(rot); c.beginPath(); c.ellipse(0, len * 0.5, wid, len * 0.55, 0, 0, 7); c.fillStyle = col; c.fill(); c.restore(); };
        petal(0.0, s * 1.1, s * 0.32, '#D4A017');
        petal(1.25, s * 1.0, s * 0.3, '#C3228B'); petal(-1.25, s * 1.0, s * 0.3, '#C3228B');
        petal(2.45, s * 0.85, s * 0.28, '#D4A017'); petal(-2.45, s * 0.85, s * 0.28, '#D4A017');
        circle(c, s * 0.22); c.fillStyle = '#ffffff'; c.fill();
      });
    },
  },
  {
    id: 'airnz', name: 'Air New Zealand', subtitle: 'Koru (2012)', country: 'NZ',
    fleet: ['a320neo', 'a321neo', 'atr72-600', 'b777-200er', 'b777-300er', 'b787-9'],
    base: '#ffffff', engine: '#111111', engineLip: '#b9bec5', pylon: '#ffffff', finBase: '#111111', wingletOut: '#111111', wingletIn: '#111111', stab: '#d0d3d6',
    fuselage(p, l) {
      p.text('AIR NEW ZEALAND', titleX(l, 0.35), TH, titleSize(l, 0.28), '#111111', { font: FONTS.sans, weight: 700, spacing: 0.1 });
      p.band(3, ramp(l.tailStart - l.L * 0.03, 1.0, l.L, -0.65), '#111111', { x0: l.tailStart - l.L * 0.03 });
    },
    fin(f) {
      f.fill('#111111');
      f.draw(0.5, 0.55, (c) => koru(c, Math.min(f.h, f.midChord) * 0.4, '#ffffff'));
    },
  },
  {
    id: 'vietnam', name: 'Vietnam Airlines', subtitle: 'Golden Lotus', country: 'VN',
    fleet: ['a321neo', 'a350-900', 'b787-9', 'b787-10', 'atr72-600'],
    base: '#ffffff', engine: '#005C8F', engineLip: '#C9A14A', pylon: '#ffffff', finBase: '#005C8F', wingletOut: '#005C8F', wingletIn: '#005C8F', stab: '#d2d6da',
    fuselage(p, l) {
      p.text('VIETNAM AIRLINES', titleX(l, 0.35), TH, titleSize(l, 0.28), '#005C8F', { font: FONTS.sans, weight: 700, spacing: 0.08 });
      p.band(3, ramp(l.tailStart, 0.8, l.L, -0.5), '#005C8F', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) {
      f.fill('#005C8F');
      f.draw(0.5, 0.48, (c) => { // golden lotus
        const s = Math.min(f.h, f.midChord) * 0.34; c.fillStyle = '#C9A14A';
        const petal = (rot, len, wid) => { c.save(); c.rotate(rot); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-wid, len * 0.55, 0, len); c.quadraticCurveTo(wid, len * 0.55, 0, 0); c.fill(); c.restore(); };
        petal(0, s * 1.15, s * 0.42); petal(0.6, s, s * 0.38); petal(-0.6, s, s * 0.38); petal(1.15, s * 0.8, s * 0.32); petal(-1.15, s * 0.8, s * 0.32);
        c.beginPath(); c.ellipse(0, -s * 0.12, s * 0.75, s * 0.1, 0, 0, 7); c.fill();
      });
    },
  },
  {
    id: 'saudia', name: 'Saudia', subtitle: '2016 livery', country: 'SA',
    fleet: ['a320neo', 'a321neo', 'a330-300', 'b777-300er', 'b787-9', 'b787-10'],
    base: '#ffffff', belly: '#CDB78A', engine: '#e4e6e9', engineLip: '#c8ccd2', pylon: '#ffffff', finBase: '#0B5DA7', wingletOut: '#0B5DA7', wingletIn: '#CDB78A', stab: '#d3d5d6',
    fuselage(p, l) {
      p.band(-0.5, -1.6, '#CDB78A', { x0: l.L * 0.03 });
      p.band(-0.44, -0.5, '#0B5DA7', { x0: l.L * 0.05, x1: l.L * 0.92 });
      const sz = titleSize(l, 0.34);
      titleRow(p, titleX(l, 0.35), TH, [
        { t: 'SAUDIA', size: sz, color: '#1F3D7A', o: { font: FONTS.sans, weight: 700, spacing: 0.14 } },
        { t: 'السعودية', size: sz * 1.0, color: '#1F3D7A', o: { font: FONTS.serif, weight: 700 } },
      ], sz * 0.9);
    },
    fin(f) {
      const g = [['#0B5DA7', 0.55, 1.3], ['#1475BE', 0.4, 0.55], ['#1F8FD0', 0.28, 0.4]];
      for (const [col, h0, h1] of g) f.poly([[-0.3, h0], [1.3, h0], [1.3, h1], [-0.3, h1]], col);
      f.poly([[-0.3, -0.2], [1.3, -0.2], [1.3, 0.12], [-0.3, 0.32]], '#CDB78A');
      f.draw(0.5, 0.64, (c) => { // palm and crossed swords
        const s = Math.min(f.h, f.midChord) * 0.3; c.strokeStyle = '#E3CE9B'; c.fillStyle = '#E3CE9B'; c.lineCap = 'round';
        c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(-s * 0.75, -s * 0.55); c.quadraticCurveTo(0, -s * 0.95, s * 0.75, -s * 0.2); c.moveTo(s * 0.75, -s * 0.55); c.quadraticCurveTo(0, -s * 0.95, -s * 0.75, -s * 0.2); c.stroke();
        c.lineWidth = s * 0.1; c.beginPath(); c.moveTo(0, -s * 0.8); c.lineTo(0, s * 0.35); c.stroke();
        for (let k = 0; k < 7; k++) { const a = Math.PI * (0.1 + 0.8 * k / 6); c.save(); c.translate(0, s * 0.38); c.rotate(a - Math.PI / 2); c.beginPath(); c.ellipse(0, s * 0.32, s * 0.08, s * 0.34, 0, 0, 7); c.fill(); c.restore(); }
      });
    },
  },
  // ------------------------------------------------------------ house & generic
  {
    id: 'airbus-house', name: 'Airbus House', subtitle: 'Manufacturer demonstrator', country: 'EU',
    fleet: ['a220-300', 'a319neo', 'a320neo', 'a321neo', 'a330-300', 'a330-900', 'a340-600', 'a350-900', 'a350-1000', 'a380-800', 'a330-200', 'a300-600f'],
    base: '#ffffff', engine: '#ffffff', engine2: '#00205B', pylon: '#ffffff', finBase: '#ffffff', wingletOut: '#00205B', wingletIn: '#0085CA',
    fuselage(p, l) {
      p.text('AIRBUS', titleX(l, 0.3), TH, titleSize(l, 0.36), '#00205B', { font: FONTS.sans, weight: 800, spacing: 0.16 });
      p.text(l.ac.name, titleX(l, 0.62), TH, titleSize(l, 0.22), '#0085CA', { font: FONTS.sans, weight: 700 });
    },
    fin(f) {
      f.fill('#ffffff');
      const sw = (h0, h1, col) => { const pts = []; for (let k = 0; k <= 20; k++) { const a = -0.2 + 1.4 * k / 20; pts.push([a, h0 + 0.35 * a * a]); } for (let k = 20; k >= 0; k--) { const a = -0.2 + 1.4 * k / 20; pts.push([a, h1 + 0.35 * a * a]); } f.poly(pts, col); };
      sw(0.0, 0.25, '#00205B'); sw(0.3, 0.42, '#0085CA'); sw(0.47, 0.53, '#7FC8F8');
    },
  },
  {
    id: 'boeing-house', name: 'Boeing House', subtitle: 'Manufacturer demonstrator', country: 'US',
    fleet: ['b737-700', 'b737-800', 'b737-max8', 'b737-max9', 'b747-400', 'b747-8i', 'b757-200', 'b767-300er', 'b777-200er', 'b777-300er', 'b777f', 'b777-9', 'b787-8', 'b787-9', 'b787-10', 'b737-max7', 'b737-900er', 'b737-max10', 'b767-400er', 'b747-8f', 'b717-200'],
    base: '#ffffff', engine: '#0039A6', pylon: '#ffffff', finBase: '#0039A6', wingletOut: '#0039A6', wingletIn: '#0039A6',
    fuselage(p, l) {
      p.band((x) => -0.15 - 0.4 * (x / l.L), -1.6, '#0039A6');
      p.band((x) => -0.05 - 0.4 * (x / l.L), (x) => -0.15 - 0.4 * (x / l.L), '#5DA9E9');
      p.text('Boeing', titleX(l, 0.34), TH, titleSize(l, 0.4), '#0039A6', { font: FONTS.sans, weight: 700 });
      p.band(3, (x) => 0.8 - 1.5 * ((x - l.tailStart) / l.Lt), '#0039A6', { x0: l.tailStart + l.Lt * 0.1 });
    },
    fin(f) { f.fill('#0039A6'); f.text(f.layout.ac.family, 0.5, 0.5, f.h * 0.2, '#ffffff', { weight: 800, maxW: f.midChord * 1.2 }); },
  },
  {
    id: 'embraer-house', name: 'Embraer House', subtitle: 'Profit Hunter style', country: 'BR',
    fleet: ['e175', 'e190-e2', 'e195-e2', 'e190'],
    base: '#ffffff', engine: '#1b2a3f', pylon: '#ffffff', finBase: '#1b2a3f', wingletOut: '#1b2a3f', wingletIn: '#00a3e0',
    fuselage(p, l) {
      p.band(-0.45, -1.6, '#1b2a3f');
      p.text('EMBRAER', titleX(l, 0.33), TH, titleSize(l, 0.32), '#1b2a3f', { font: FONTS.sans, weight: 800, spacing: 0.15 });
    },
    fin(f) { f.fill('#1b2a3f'); f.poly([[0.1, 0.1], [0.9, 0.2], [0.3, 0.85]], '#00a3e0'); },
  },
  {
    id: 'regional-house', name: 'Regional Express', subtitle: 'Generic regional', country: '—',
    fleet: ['crj900', 'atr72-600', 'dash8-400', 'e175', 'ssj100', 'c919', 'crj700', 'atr42-600'],
    base: '#ffffff', engine: '#ffffff', pylon: '#ffffff', finBase: '#0a6c74', wingletOut: '#0a6c74', wingletIn: '#e3a72f', stab: '#d0d4d8',
    fuselage(p, l) {
      p.band(-0.4, -0.5, '#0a6c74'); p.band(-0.52, -0.58, '#e3a72f');
      p.text('REGIONAL EXPRESS', titleX(l, 0.35), TH, titleSize(l, 0.26), '#0a6c74', { font: FONTS.sans, weight: 800, spacing: 0.06 });
    },
    fin(f) { f.fill('#0a6c74'); f.poly([[-0.2, 0.2], [1.3, 0.55], [1.3, 0.7], [-0.2, 0.35]], '#e3a72f'); },
  },
  {
    id: 'plain-white', name: 'Plain White', subtitle: 'Unpainted test aircraft', country: '—', fleet: '*',
    base: '#f5f6f8', engine: '#d7dade', finBase: '#f5f6f8', reg: false,
  },
  {
    id: 'ga-classic', name: 'Classic Stripe', subtitle: 'Private owner', country: '—',
    fleet: ['c172', 'kingair350', 'sr22', 'pa28', 'pc12'],
    base: '#ffffff', engine: '#ffffff', finBase: '#ffffff', wing: '#f2f2f2', wingUnder: '#e8e8e8', stab: '#f2f2f2', wingletOut: '#ffffff', spinner: '#a81d24',
    fuselage(p, l) {
      p.band(-0.05, -0.2, '#a81d24', { x0: 0, x1: l.L });
      p.band(-0.24, -0.32, '#1b2f5b', { x0: 0, x1: l.L });
    },
    fin(f) { f.poly([[-0.2, 0.55], [1.3, 0.75], [1.3, 0.85], [-0.2, 0.65]], '#a81d24'); f.poly([[-0.2, 0.45], [1.3, 0.65], [1.3, 0.7], [-0.2, 0.5]], '#1b2f5b'); },
  },
  {
    id: 'exec-gold', name: 'Executive Gold', subtitle: 'Corporate', country: '—',
    fleet: ['kingair350', 'g650', 'c172', 'pc12', 'cj4', 'global7500', 'sr22'],
    base: '#ffffff', engine: '#ffffff', finBase: '#ffffff', wingletOut: '#7a5c1e', stab: '#f0f0f0', spinner: '#d9d9d9',
    fuselage(p, l) {
      p.band((x) => -0.05 + 0.3 * (x / l.L), (x) => -0.12 + 0.3 * (x / l.L), '#b08d3c', { x0: l.L * 0.1 });
      p.band((x) => -0.15 + 0.3 * (x / l.L), (x) => -0.35 + 0.3 * (x / l.L), '#3a2a12', { x0: l.L * 0.1 });
    },
    fin(f) { f.poly([[-0.2, 0.1], [1.3, 0.4], [1.3, 0.9], [-0.2, 0.25]], '#3a2a12'); f.poly([[-0.2, 0.28], [1.3, 0.95], [1.3, 1.05], [-0.2, 0.33]], '#b08d3c'); },
  },
  {
    id: 'sky-charter', name: 'SkyCharter Navy', subtitle: 'Private', country: '—',
    fleet: ['g650', 'kingair350', 'cj4', 'global7500', 'pc12'],
    base: '#ffffff', belly: '#14213d', engine: '#14213d', finBase: '#14213d', wingletOut: '#14213d', stab: '#f0f0f0',
    fuselage(p, l) { p.band(-0.3, -0.38, '#fca311', { x0: l.L * 0.05, x1: l.L * 0.92 }); },
    fin(f) { f.fill('#14213d'); f.poly([[-0.2, 0.3], [1.3, 0.6], [1.3, 0.66], [-0.2, 0.36]], '#fca311'); },
  },
];

export function liveriesFor(acId) {
  return LIVERIES.filter((l) => l.fleet === '*' || l.fleet.includes(acId));
}
export function getLivery(id) { return LIVERIES.find((l) => l.id === id) || LIVERIES.find((l) => l.id === 'plain-white'); }
