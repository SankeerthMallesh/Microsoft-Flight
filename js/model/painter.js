// Paints a livery onto the aircraft texture atlas (see builder.js for atlas layout).
import { ATLAS_W, ATLAS_H, SW, swatchRect } from './builder.js';

const FUSE_H = 512; // rows per fuselage side
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const FONTS = {
  sans: '"Montserrat", "Helvetica Neue", Arial, sans-serif',
  wide: '"Archivo Black", "Arial Black", "Helvetica Neue", Arial, sans-serif',
  serif: '"Playfair Display", Georgia, "Times New Roman", serif',
  cond: '"Oswald", "Arial Narrow", Arial, sans-serif',
  script: '"Kaushan Script", "Brush Script MT", cursive',
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// ---------------------------------------------------------------- fuselage painter
class FuselagePainter {
  constructor(ctx, layout, side) {
    this.ctx = ctx; this.layout = layout; this.side = side;
    this.L = layout.L; this.H0 = layout.H0; this.R = layout.R;
    this.W = ATLAS_W; this.y0 = side === 'R' ? 0 : FUSE_H;
    this.kx = this.W / this.L; // px per metre horizontally
    this.kv = FUSE_H / (Math.PI * this.H0); // px per metre vertically at the side
    this.ex = layout.g.boxy ? 2.6 : layout.g.dh && layout.g.dh / layout.g.d > 1.15 && !layout.g.deck2 ? 2.25 : 2;
  }
  X(xn) { return this.side === 'L' ? xn * this.kx : this.W - xn * this.kx; }
  // zn: local normalised height in section (-1 bottom .. 1 top)
  Yn(zn) {
    zn = clamp(zn, -1, 1);
    const c = Math.sign(zn) * Math.pow(Math.abs(zn), this.ex / 2);
    return this.y0 + (Math.acos(c) / Math.PI) * FUSE_H;
  }
  // h: absolute height in units of H0 above fuselage centreline
  Y(xn, h) {
    const pr = this.layout.profile(clamp(xn, 0.001, this.L - 0.001));
    return this.Yn((h * this.H0 - pr.cz) / pr.ht);
  }
  clip(fn) { const c = this.ctx; c.save(); c.beginPath(); c.rect(0, this.y0, this.W, FUSE_H); c.clip(); fn(c); c.restore(); }
  fillAll(color) { this.ctx.fillStyle = color; this.ctx.fillRect(0, this.y0, this.W, FUSE_H); }
  _f(v, x) { return typeof v === 'function' ? v(x) : v; }
  // Band between two absolute heights (numbers or functions of xn), optionally local (zn) coords
  band(top, bot, color, o = {}) {
    const x0 = o.x0 ?? 0, x1 = o.x1 ?? this.L, n = 160;
    const Yf = o.local ? (x, h) => this.Yn(h) : (x, h) => this.Y(x, h);
    this.clip((c) => {
      c.beginPath();
      for (let k = 0; k <= n; k++) { const x = lerp(x0, x1, k / n); const p = [this.X(x), Yf(x, this._f(top, x))]; k ? c.lineTo(...p) : c.moveTo(...p); }
      for (let k = n; k >= 0; k--) { const x = lerp(x0, x1, k / n); c.lineTo(this.X(x), Yf(x, this._f(bot, x))); }
      c.closePath(); c.fillStyle = color; c.fill();
    });
  }
  poly(pts, color, o = {}) {
    const Yf = o.local ? (x, h) => this.Yn(h) : (x, h) => this.Y(x, h);
    this.clip((c) => {
      c.beginPath();
      pts.forEach(([x, h], k) => { const p = [this.X(x), Yf(x, h)]; k ? c.lineTo(...p) : c.moveTo(...p); });
      c.closePath(); c.fillStyle = color; c.fill();
      if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lineWidth || 2; c.stroke(); }
    });
  }
  // Text: size = cap height in metres, centred on (xn, h)
  text(str, xn, h, size, color, o = {}) {
    this.clip((c) => {
      const px = size * this.kv * 1.35;
      c.save();
      c.translate(this.X(xn), this.Y(xn, h));
      c.scale(this.kx / this.kv, 1);
      if (o.skew) c.transform(1, 0, -o.skew, 1, 0, 0);
      c.font = `${o.italic ? 'italic ' : ''}${o.weight || 800} ${px}px ${o.font || FONTS.sans}`;
      if ('letterSpacing' in c && o.spacing) c.letterSpacing = `${o.spacing * px}px`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (o.maxW) { const m = c.measureText(str).width; const max = (o.maxW * this.kv); if (m > max) c.scale(max / m, 1); }
      if (o.stroke) { c.lineWidth = px * 0.08; c.strokeStyle = o.stroke; c.strokeText(str, 0, 0); }
      c.fillStyle = color; c.fillText(str, 0, 0);
      c.restore();
    });
  }
  // Custom drawing in a local metric frame centred at (xn,h); +x toward tail, +y up (metres)
  draw(xn, h, fn) {
    this.clip((c) => {
      c.save();
      c.translate(this.X(xn), this.Y(xn, h));
      c.scale(this.side === 'L' ? this.kx : -this.kx, -this.kv);
      fn(c);
      c.restore();
    });
  }
}

// ---------------------------------------------------------------- fin painter
class FinPainter {
  constructor(ctx, layout, side) {
    this.ctx = ctx; this.layout = layout; this.side = side; this.fin = layout.fin;
    this.FW = 2048; this.FH = 512; this.y0 = side === 'L' ? 1024 : 1536;
    this.kx = this.FW / (this.fin.xMax - this.fin.xMin); this.ky = this.FH / this.fin.h;
  }
  Xn(xn) { const u = (xn - this.fin.xMin) / (this.fin.xMax - this.fin.xMin); return this.side === 'L' ? u * this.FW : (1 - u) * this.FW; }
  Yh(hf) { return this.y0 + (1 - hf) * this.FH; }
  // a: 0 LE .. 1 TE along chord at height hf (0 root .. 1 tip)
  P(a, hf) {
    const f = this.fin;
    const le = lerp(f.rootLE, f.tipLE, clamp(hf, 0, 1)) + (hf < 0 ? hf * 0 : 0), te = lerp(f.rootTE, f.tipTE, clamp(hf, 0, 1));
    return [this.Xn(lerp(le, te, a)), this.Yh(hf)];
  }
  clip(fn) { const c = this.ctx; c.save(); c.beginPath(); c.rect(0, this.y0, this.FW, this.FH); c.clip(); fn(c); c.restore(); }
  fill(color) { this.ctx.fillStyle = color; this.ctx.fillRect(0, this.y0, this.FW, this.FH); }
  poly(pts, color) {
    this.clip((c) => {
      c.beginPath();
      pts.forEach(([a, h], k) => { const p = this.P(a, h); k ? c.lineTo(...p) : c.moveTo(...p); });
      c.closePath(); c.fillStyle = color; c.fill();
    });
  }
  // metric local frame at (a,hf): +x toward TE (aft), +y up, units metres
  draw(a, hf, fn) {
    this.clip((c) => {
      c.save(); const [px, py] = this.P(a, hf);
      c.translate(px, py); c.scale(this.side === 'L' ? this.kx : -this.kx, -this.ky);
      fn(c); c.restore();
    });
  }
  text(str, a, hf, size, color, o = {}) {
    this.clip((c) => {
      const [px, py] = this.P(a, hf);
      const fpx = size * this.ky * 1.35;
      c.save(); c.translate(px, py); c.scale(this.kx / this.ky, 1);
      if (o.rotate) c.rotate(-o.rotate);
      c.font = `${o.italic ? 'italic ' : ''}${o.weight || 800} ${fpx}px ${o.font || FONTS.sans}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (o.maxW) { const m = c.measureText(str).width; const max = o.maxW * this.ky; if (m > max) c.scale(max / m, 1); }
      c.fillStyle = color; c.fillText(str, 0, 0); c.restore();
    });
  }
  // size reference: chord at mid height in metres
  get midChord() { const f = this.fin; return ((f.rootTE - f.rootLE) + (f.tipTE - f.tipLE)) / 2; }
  get h() { return this.fin.h; }
}

// ---------------------------------------------------------------- helpers
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function drawWindows(p, lv) {
  const { layout } = p; const ac = layout.ac; const g = layout.g;
  if (ac.category === 'General aviation') {
    // big cabin windows
    p.poly([[layout.Ln * 0.95, 0.72], [layout.Ln + 1.9, 0.72], [layout.Ln + 2.2, 0.2], [layout.Ln + 0.9, 0.12], [layout.Ln * 0.95, 0.25]], '#1b2530', { local: true });
    return;
  }
  const wide = ac.category === 'Wide-body' || ac.category === 'Cargo';
  const is787 = g.nose === '787';
  const pitch = is787 ? 0.6 : g.nose === 'a350' ? 0.6 : ac.category === 'Turboprop' ? 0.62 : 0.533;
  const ww = is787 ? 0.28 : 0.23, wh = is787 ? 0.47 : g.ovalWindows ? 0.36 : 0.32;
  const rows = [];
  if (g.nose === 'a380') { rows.push({ h: -0.2, x0: layout.Ln * 1.05, x1: layout.tailStart + 1 }); rows.push({ h: 0.5, x0: layout.Ln * 1.25, x1: layout.tailStart - 1 }); }
  else rows.push({ h: wide ? 0.2 : 0.17, x0: layout.Ln * 1.08, x1: layout.tailStart + (wide ? 1.5 : 0.8) });
  if (layout.deck2) rows.push({ h: 1.15, x0: layout.Ln * 1.6, x1: layout.deck2 - 1.5, upper: true });
  if (ac.cargo) return; // freighters: no cabin windows
  const doors = layout.doors.filter((d) => d.kind === 'main');
  const col = lv.windowColor || '#1d2631';
  for (const r of rows) {
    for (let x = r.x0; x < r.x1; x += pitch) {
      if (doors.some((d) => Math.abs(d.x - x) < d.w / 2 + 0.25)) continue;
      const cx = p.X(x), cy = p.Y(x, r.h);
      const w = ww * p.kx, h = wh * p.kv;
      p.clip((c) => {
        c.fillStyle = col; roundRect(c, cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.45); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(c, cx - w / 2 + w * 0.15, cy - h / 2 + h * 0.12, w * 0.35, h * 0.3, w * 0.12); c.fill();
      });
    }
  }
}

function drawDoors(p, lv) {
  const { layout } = p;
  const g = layout.g;
  for (const d of layout.doors) {
    const floor = d.kind === 'overwing' ? 0.17 - 0.42 * 0.5 / p.H0 * 2 : -0.25 - (p.H0 > 2.5 ? 0.12 : 0);
    const hb = d.kind === 'overwing' ? 0.17 * p.H0 - d.h / 2 : floor * p.H0;
    const top = hb + d.h;
    const x0 = d.x - d.w / 2, x1 = d.x + d.w / 2;
    p.clip((c) => {
      c.strokeStyle = lv.doorColor || 'rgba(70,78,90,0.75)'; c.lineWidth = 3;
      const X0 = p.X(x0), X1 = p.X(x1), Y0 = p.Y(d.x, top / p.H0), Y1 = p.Y(d.x, hb / p.H0);
      roundRect(c, Math.min(X0, X1), Y0, Math.abs(X1 - X0), Y1 - Y0, 8); c.stroke();
    });
  }
  if (layout.ac.cargo) {
    // main deck cargo door outline
    const x = layout.tailStart - 6;
    p.clip((c) => {
      c.strokeStyle = 'rgba(70,78,90,0.65)'; c.lineWidth = 3;
      const X0 = p.X(x - 2), X1 = p.X(x + 2), Y0 = p.Y(x, 0.55), Y1 = p.Y(x, -0.3);
      c.strokeRect(Math.min(X0, X1), Y0, Math.abs(X1 - X0), Y1 - Y0);
    });
  }
}

function drawCockpit(p, lv) {
  const { layout } = p; const Ln = layout.Ln; const g = layout.g;
  const col = '#141a22';
  if (layout.ac.category === 'General aviation') return;
  let x0 = Ln * 0.52, x1 = Ln * 0.8, x2 = Ln * 0.98, z0 = 0.3, z1 = 0.72;
  if (layout.deck2) { x0 = Ln * 0.95; x1 = Ln * 1.2; x2 = Ln * 1.4; z0 = 0.55; z1 = 0.86; }
  if (g.nose === 'a380') { z0 = 0.05; z1 = 0.38; x0 = Ln * 0.45; x1 = Ln * 0.62; x2 = Ln * 0.78; }
  if (g.nose === 'a350' && !lv.noMask) {
    // A350 "mask" around the cockpit windows
    p.poly([[x0 - 0.4, z0 - 0.08], [x0 + 0.2, z1 + 0.08], [x2 + 0.35, z1 - 0.02], [x2 + 0.4, z0 - 0.1]], '#101317', { local: true });
  }
  p.poly([[x0, z0], [x0 + (x1 - x0) * 0.55, z1], [x1, z1 - 0.04], [x1, z0 - 0.02]], col, { local: true });
  p.poly([[x1 + 0.08, z1 - 0.06], [x2, z1 - 0.12], [x2, z0], [x1 + 0.08, z0 - 0.02]], col, { local: true });
}

// ---------------------------------------------------------------- main paint
export async function paintLivery(layout, livery) {
  const canvas = makeCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext('2d');
  const lv = livery;
  const col = (k, d) => lv[k] || d;
  ctx.fillStyle = col('base', '#ffffff'); ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);

  // swatches
  const sw = {
    [SW.wingTop]: col('wing', '#c3c8cf'), [SW.wingUnder]: col('wingUnder', '#aab1ba'), [SW.metal]: '#b9bec4', [SW.dark]: '#15181c',
    [SW.glass]: '#121820', [SW.tire]: '#1a1a1a', [SW.gear]: '#d5d8dc', [SW.stab]: col('stab', col('wing', '#c3c8cf')),
    [SW.wingletOut]: col('wingletOut', col('finBase', col('base', '#fff'))), [SW.wingletIn]: col('wingletIn', col('wingletOut', col('base', '#fff'))),
    [SW.pylon]: col('pylon', col('base', '#ffffff')), [SW.blade]: '#22252a', [SW.bladeTip]: '#f2c230', [SW.spinner]: col('spinner', '#cfd3d8'),
    [SW.intake]: '#2a2e33', [SW.exhaust]: '#55585c', [SW.belly]: col('belly', col('base', '#fff')), [SW.base]: col('base', '#fff'),
    [SW.finBase]: col('finBase', col('base', '#fff')), [SW.red]: '#ff2a2a', [SW.green]: '#22ff55', [SW.white]: '#f4f4f4', [SW.fan]: '#3a3f46',
    [SW.stabUnder]: col('stabUnder', col('stab', col('wing', '#c3c8cf'))),
  };
  for (const [i, c] of Object.entries(sw)) { const [x, y, w, h] = swatchRect(+i); ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  // wing region (3072..4096 x 1024..1536): u around section, v along span
  {
    const x0 = 3072, y0 = 1024, w = 1024, h = 512;
    ctx.fillStyle = col('wing', '#c3c8cf'); ctx.fillRect(x0, y0, w / 2, h);
    ctx.fillStyle = col('wingUnder', '#aab1ba'); ctx.fillRect(x0 + w / 2, y0, w / 2, h);
    ctx.fillStyle = col('wingLE', '#d9dde2'); ctx.fillRect(x0 + w * 0.44, y0, w * 0.12, h);
    // subtle panel lines
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 2;
    for (let k = 1; k < 10; k++) { ctx.beginPath(); ctx.moveTo(x0, y0 + (k * h) / 10); ctx.lineTo(x0 + w, y0 + (k * h) / 10); ctx.stroke(); }
    if (lv.wingTips) { ctx.fillStyle = lv.wingTips; ctx.fillRect(x0, y0 + h * 0.96, w, h * 0.04); }
  }
  // nacelle region (2048..3072 x 1024..1536): u around, v along length
  {
    const x0 = 2048, y0 = 1024, w = 1024, h = 512;
    ctx.fillStyle = col('engine', '#d9dce0'); ctx.fillRect(x0, y0, w, h);
    if (lv.engine2) { ctx.fillStyle = lv.engine2; ctx.fillRect(x0, y0 + h * 0.55, w, h * 0.45); }
    ctx.fillStyle = col('engineLip', '#c8ccd2'); ctx.fillRect(x0, y0, w, h * 0.07);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x0, y0 + h * 0.62, w, 3); ctx.fillRect(x0, y0 + h * 0.3, w, 2);
    if (lv.engineText) {
      ctx.save(); ctx.fillStyle = lv.engineText.color; ctx.font = `800 70px ${lv.engineText.font || FONTS.sans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const u of [0.1, 0.6]) { ctx.save(); ctx.translate(x0 + w * u, y0 + h * 0.4); ctx.rotate(Math.PI / 2); ctx.scale(1, 1); ctx.fillText(lv.engineText.text, 0, 0); ctx.restore(); }
      ctx.restore();
    }
  }

  // fuselage sides
  for (const side of ['L', 'R']) {
    const p = new FuselagePainter(ctx, layout, side);
    p.fillAll(col('base', '#ffffff'));
    if (lv.belly) p.band(-0.62, -1.5, lv.belly);
    if (lv.fuselage) lv.fuselage(p, layout);
    drawDoors(p, lv);
    drawWindows(p, lv);
    drawCockpit(p, lv);
    if (lv.after) lv.after(p, layout);
    if (lv.reg !== false) p.text(lv.reg || 'N' + (100 + Math.floor(Math.random() * 899)) + 'OS', layout.tailStart + layout.Lt * 0.25, -0.15, Math.min(0.42, layout.H0 * 0.12), lv.regColor || 'rgba(40,40,50,0.85)', { weight: 600 });
  }
  // fin
  for (const side of ['L', 'R']) {
    const f = new FinPainter(ctx, layout, side);
    f.fill(col('finBase', col('base', '#fff')));
    if (lv.fin) lv.fin(f, layout);
  }

  let bytes;
  if (canvas.convertToBlob) bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  else bytes = await new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
  return { bytes, canvas };
}
