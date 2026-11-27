// Canvas-drawn glass cockpit displays: PFD, ND and EICAS.
import { D2R, R2D, clamp, wrap180, wrap360, distance, bearing } from '../sim/math.js';

const COL = { sky: '#1f78d1', ground: '#7a4a1e', white: '#f2f2f2', green: '#3cf26b', magenta: '#ff4cf5', cyan: '#3ce8ff', amber: '#ffb000', red: '#ff3b3b', grey: '#7d8590', bg: '#05070a' };
const FONT = '"Roboto Mono", "DejaVu Sans Mono", Consolas, monospace';

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, canvas.dataset.dpr ? +canvas.dataset.dpr : 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function txt(ctx, s, x, y, size, color, align = 'center', weight = 600) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}
function box(ctx, x, y, w, h, stroke, fill = '#000', lw = 1.5) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); }

// ================================================================== PFD
export function drawPFD(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const o = s.out;
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
  const cx = w * 0.47, cy = h * 0.46, R = Math.min(w * 0.3, h * 0.33);
  const pxPerDeg = R / 22;
  // ---- attitude
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - R * 1.05, cy - R * 1.08, R * 2.1, R * 2.16); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-o.roll * D2R);
  const pOff = o.pitch * pxPerDeg;
  ctx.fillStyle = COL.sky; ctx.fillRect(-R * 3, -R * 3 + pOff, R * 6, R * 3);
  ctx.fillStyle = COL.ground; ctx.fillRect(-R * 3, pOff, R * 6, R * 3);
  ctx.strokeStyle = COL.white; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-R * 3, pOff); ctx.lineTo(R * 3, pOff); ctx.stroke();
  // pitch ladder
  for (let p = -90; p <= 90; p += 2.5) {
    if (p === 0) continue;
    const y = pOff - p * pxPerDeg;
    if (Math.abs(y) > R * 1.1) continue;
    const major = p % 10 === 0, mid = p % 5 === 0;
    const lw = major ? R * 0.32 : mid ? R * 0.17 : R * 0.08;
    ctx.beginPath(); ctx.moveTo(-lw, y); ctx.lineTo(lw, y); ctx.stroke();
    if (major) { txt(ctx, Math.abs(p), -lw - 12, y, 11, COL.white); txt(ctx, Math.abs(p), lw + 12, y, 11, COL.white); }
  }
  ctx.restore();
  // mask to rounded ADI
  ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(cx - R * 1.05, cy - R * 1.08, R * 2.1, R * 2.16); ctx.restore();
  // bank scale
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = COL.white; ctx.lineWidth = 1.5;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r1 = R * 0.98, r2 = R * (Math.abs(a) % 30 === 0 ? 1.1 : 1.04);
    const t = (a - 90) * D2R; ctx.beginPath(); ctx.moveTo(Math.cos(t) * r1, Math.sin(t) * r1); ctx.lineTo(Math.cos(t) * r2, Math.sin(t) * r2); ctx.stroke();
  }
  ctx.rotate(-o.roll * D2R);
  ctx.fillStyle = Math.abs(o.roll) > 35 ? COL.amber : COL.white;
  ctx.beginPath(); ctx.moveTo(0, -R * 0.97); ctx.lineTo(-7, -R * 0.88); ctx.lineTo(7, -R * 0.88); ctx.closePath(); ctx.fill();
  // slip indicator
  const slip = clamp(o.beta * 3, -14, 14);
  ctx.fillRect(-7 + slip, -R * 0.86, 14, 4);
  ctx.restore();
  // flight director
  if (s.ap && s.ap.engaged) {
    ctx.strokeStyle = COL.magenta; ctx.lineWidth = 2.5;
    const fdx = clamp((s.ap.cmd.roll * R2D - o.roll) * 2.5, -R * 0.6, R * 0.6), fdy = clamp(-(s.ap.cmd.pitch * R2D - o.pitch) * pxPerDeg, -R * 0.6, R * 0.6);
    ctx.beginPath(); ctx.moveTo(cx + fdx, cy - R * 0.55); ctx.lineTo(cx + fdx, cy + R * 0.55); ctx.moveTo(cx - R * 0.55, cy + fdy); ctx.lineTo(cx + R * 0.55, cy + fdy); ctx.stroke();
  }
  // aircraft symbol
  ctx.fillStyle = '#000'; ctx.strokeStyle = COL.white; ctx.lineWidth = 2;
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.rect(cx + sgn * R * 0.62 - (sgn > 0 ? 0 : R * 0.32), cy - 3, R * 0.32, 6); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.rect(cx - 4, cy - 4, 8, 8); ctx.fill(); ctx.stroke();
  // flight path vector
  const fpvY = cy - (o.pitch - o.alpha) * pxPerDeg * 0 + (o.alpha) * pxPerDeg * 0;
  if (o.gs > 40) {
    const gamma = Math.atan2(o.vs * 0.00508, o.gs * 0.5144) * R2D;
    const fy = cy - (gamma - o.pitch) * pxPerDeg, fx = cx + clamp(wrap180(o.track - o.hdg) * pxPerDeg, -R * 0.8, R * 0.8);
    ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fx, fy, 6, 0, 7); ctx.moveTo(fx - 16, fy); ctx.lineTo(fx - 6, fy); ctx.moveTo(fx + 6, fy); ctx.lineTo(fx + 16, fy); ctx.moveTo(fx, fy - 6); ctx.lineTo(fx, fy - 13); ctx.stroke();
  }
  // radio altitude
  if (o.agl < 2500) txt(ctx, Math.round(o.agl < 10 ? o.agl : o.agl / 10 * 1) * (o.agl < 10 ? 1 : 10) + '', cx, cy + R * 0.85, 15, o.agl < 1000 ? COL.amber : COL.white, 'center', 700);
  // ILS deviation
  if (s.ils) {
    const loc = clamp(-s.ils.xtk / Math.max(60, Math.abs(s.ils.along) * 0.0436), -2.2, 2.2); // ±2 dots ~ 2.5°
    const gs = clamp(s.ils.gsDev / Math.max(8, Math.abs(s.ils.aimDist) * 0.0122), -2.2, 2.2);
    ctx.strokeStyle = COL.white; ctx.lineWidth = 1.2;
    for (let k = -2; k <= 2; k++) { if (!k) continue; ctx.beginPath(); ctx.arc(cx + k * R * 0.3, cy + R * 1.0, 3.5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + R * 1.0, cy + k * R * 0.3, 3.5, 0, 7); ctx.stroke(); }
    ctx.fillStyle = COL.magenta;
    const dm = (x, y) => { ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); };
    dm(cx + loc * R * 0.3, cy + R * 1.0); dm(cx + R * 1.0, cy + gs * R * 0.3);
  }
  // ---- speed tape
  const tx = w * 0.03, tw = w * 0.13, ty = cy - R * 1.05, th = R * 2.1;
  ctx.save(); ctx.fillStyle = '#2b3036'; ctx.fillRect(tx, ty, tw, th); ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip();
  const kPx = th / 80;
  ctx.strokeStyle = COL.white; ctx.lineWidth = 1.4;
  const ias = Math.max(30, o.ias);
  for (let v = Math.floor((ias - 45) / 10) * 10; v <= ias + 45; v += 10) {
    if (v < 30) continue;
    const y = cy - (v - ias) * kPx;
    ctx.beginPath(); ctx.moveTo(tx + tw - 10, y); ctx.lineTo(tx + tw, y); ctx.stroke();
    if (v % 20 === 0) txt(ctx, v, tx + tw - 16, y, 12, COL.white, 'right');
  }
  // bands: overspeed & stall
  const vs = s.vspeeds;
  if (vs) {
    const vmax = Math.min(vs.vmo, o.mach > 0.01 ? (o.ias * vs.mmo) / Math.max(o.mach, 0.01) : vs.vmo);
    const yv = cy - (vmax - ias) * kPx; ctx.fillStyle = COL.red; for (let y = yv; y > ty - 10; y -= 10) ctx.fillRect(tx + tw - 6, y - 5, 6, 5);
    const vstall = s.stallSpeed; if (vstall) { const ys = cy - (vstall - ias) * kPx; ctx.fillStyle = COL.amber; ctx.fillRect(tx + tw - 6, ys, 6, th); }
    const bug = (v, label, col = COL.green) => { const y = cy - (v - ias) * kPx; if (y < ty || y > ty + th) return; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(tx + tw, y); ctx.lineTo(tx + tw + 8, y); ctx.stroke(); txt(ctx, label, tx + tw - 2, y - 7, 9, col, 'right'); };
    if (s.phase === 'takeoff') { bug(vs.vr, 'R'); bug(vs.v2, 'V2'); } else bug(vs.vref, 'REF');
  }
  if (s.ap && (s.ap.at || s.ap.engaged)) { const y = cy - (s.ap.spd - ias) * kPx; ctx.fillStyle = COL.magenta; ctx.beginPath(); ctx.moveTo(tx + tw, y); ctx.lineTo(tx + tw + 8, y - 7); ctx.lineTo(tx + tw + 8, y + 7); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  // trend vector
  if (s.trend) { const y2 = cy - s.trend * 10 * kPx; ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx + tw - 4, cy); ctx.lineTo(tx + tw - 4, y2); ctx.stroke(); }
  box(ctx, tx + 2, cy - 15, tw - 4, 30, COL.white, '#000', 2);
  txt(ctx, Math.round(o.ias), tx + tw - 8, cy, 19, o.stall ? COL.red : COL.white, 'right', 700);
  txt(ctx, s.ap && (s.ap.at || s.ap.engaged) ? Math.round(s.ap.spd) : '---', tx + tw / 2, ty - 12, 14, COL.magenta);
  txt(ctx, o.mach >= 0.4 ? '.' + Math.round(o.mach * 1000).toString().padStart(3, '0') : 'GS ' + Math.round(o.gs), tx + tw / 2, ty + th + 14, 13, COL.white);
  // ---- altitude tape
  const ax = w * 0.79, aw = w * 0.13;
  ctx.save(); ctx.fillStyle = '#2b3036'; ctx.fillRect(ax, ty, aw, th); ctx.beginPath(); ctx.rect(ax, ty, aw, th); ctx.clip();
  const aPx = th / 800;
  ctx.strokeStyle = COL.white; ctx.lineWidth = 1.4;
  for (let a = Math.floor((o.alt - 450) / 100) * 100; a <= o.alt + 450; a += 100) {
    const y = cy - (a - o.alt) * aPx;
    ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(ax + 9, y); ctx.stroke();
    if (a % 200 === 0) txt(ctx, a, ax + 14, y, 12, COL.white, 'left');
  }
  if (s.ap) { const y = cy - (s.ap.alt - o.alt) * aPx; ctx.fillStyle = COL.magenta; ctx.fillRect(ax, clamp(y, ty, ty + th) - 8, 6, 16); }
  // ground
  const gy = cy - (o.alt - o.agl - o.alt) * aPx; ctx.fillStyle = '#8a5a2b'; ctx.fillRect(ax, gy, aw, th);
  ctx.restore();
  box(ctx, ax + 2, cy - 15, aw - 2, 30, COL.white, '#000', 2);
  txt(ctx, Math.round(o.alt), ax + aw - 6, cy, 17, COL.white, 'right', 700);
  txt(ctx, s.ap ? s.ap.alt : '', ax + aw / 2, ty - 12, 14, COL.magenta);
  txt(ctx, 'STD', ax + aw / 2, ty + th + 14, 12, COL.green);
  // ---- vertical speed
  const vx = w * 0.935, vw = w * 0.055;
  ctx.fillStyle = '#2b3036'; ctx.fillRect(vx, cy - R * 0.85, vw, R * 1.7);
  const vsY = (v) => cy - Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * R * 0.8;
  ctx.strokeStyle = COL.white; ctx.lineWidth = 1;
  for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) { const y = vsY(v); ctx.beginPath(); ctx.moveTo(vx, y); ctx.lineTo(vx + 6, y); ctx.stroke(); if (v) txt(ctx, Math.abs(v / 1000), vx + 13, y, 10, COL.white); }
  ctx.strokeStyle = COL.white; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(vx + vw, cy); ctx.lineTo(vx + 4, vsY(o.vs)); ctx.stroke();
  if (Math.abs(o.vs) > 400) txt(ctx, Math.round(o.vs / 50) * 50, vx + vw / 2, o.vs > 0 ? cy - R * 0.95 : cy + R * 0.95, 11, COL.white);
  // ---- heading
  const hy = h * 0.9, hr = w * 0.33;
  ctx.save(); ctx.beginPath(); ctx.rect(0, cy + R * 1.12, w, h); ctx.clip();
  ctx.fillStyle = '#2b3036'; ctx.beginPath(); ctx.arc(cx, hy + hr * 0.62, hr, 0, 7); ctx.fill();
  ctx.translate(cx, hy + hr * 0.62); ctx.strokeStyle = COL.white; ctx.lineWidth = 1.4;
  for (let d = 0; d < 360; d += 5) {
    const a = (d - o.hdg - 90) * D2R; const r2 = hr - (d % 10 === 0 ? 10 : 5);
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * hr, Math.sin(a) * hr); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke();
    if (d % 30 === 0) { ctx.save(); ctx.rotate(a + Math.PI / 2); txt(ctx, d / 10, 0, -hr + 20, 12, COL.white); ctx.restore(); }
  }
  if (s.ap) { const a = (s.ap.hdg - o.hdg - 90) * D2R; ctx.fillStyle = COL.magenta; ctx.save(); ctx.rotate(a + Math.PI / 2); ctx.fillRect(-7, -hr, 14, 6); ctx.restore(); }
  ctx.restore();
  box(ctx, cx - 24, hy - hr * 0.38 - 2, 48, 22, COL.white, '#000', 1.5);
  txt(ctx, String(Math.round(o.hdg) % 360).padStart(3, '0'), cx, hy - hr * 0.38 + 9, 15, COL.white, 'center', 700);
  // ---- FMA
  ctx.fillStyle = '#000'; ctx.fillRect(w * 0.18, 0, w * 0.6, h * 0.075);
  const fma = s.fma || ['', '', ''];
  ctx.strokeStyle = COL.grey; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) { txt(ctx, fma[i], w * 0.18 + w * 0.2 * (i + 0.5), h * 0.037, 13, COL.green, 'center', 700); if (i) { ctx.beginPath(); ctx.moveTo(w * 0.18 + w * 0.2 * i, 4); ctx.lineTo(w * 0.18 + w * 0.2 * i, h * 0.07); ctx.stroke(); } }
  if (s.ap && s.ap.engaged) txt(ctx, 'CMD', cx, h * 0.1, 13, COL.green, 'center', 700);
  if (o.stall) txt(ctx, 'STALL', cx, cy - R * 0.5, 22, COL.red, 'center', 800);
  if (s.warn) txt(ctx, s.warn, cx, cy + R * 0.55, 18, COL.red, 'center', 800);
}

// ================================================================== ND
export function drawND(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const o = s.out;
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.82, R = Math.min(w * 0.46, h * 0.72);
  const range = s.ndRange || 20; // nm
  const pxPerM = R / (range * 1852);
  const hdg = o.hdg;
  // range arcs
  ctx.strokeStyle = COL.white; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, (-90 - 60) * D2R, (-90 + 60) * D2R); ctx.stroke();
  ctx.setLineDash([4, 6]); ctx.strokeStyle = '#7d8590'; ctx.beginPath(); ctx.arc(cx, cy, R / 2, (-90 - 60) * D2R, (-90 + 60) * D2R); ctx.stroke(); ctx.setLineDash([]);
  txt(ctx, range / 2, cx - R / 2 * Math.sin(55 * D2R) - 12, cy - R / 2 * Math.cos(55 * D2R), 11, COL.white);
  // compass ticks
  for (let d = 0; d < 360; d += 5) {
    const rel = wrap180(d - hdg); if (Math.abs(rel) > 62) continue;
    const a = (rel - 90) * D2R; const r2 = R + (d % 10 === 0 ? 12 : 6);
    ctx.strokeStyle = COL.white; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    if (d % 30 === 0) txt(ctx, d / 10, cx + Math.cos(a) * (R + 24), cy + Math.sin(a) * (R + 24), 12, COL.white);
  }
  // clip to map area
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.rect(0, 0, w, h * 0); ctx.clip();
  const proj = (latR, lonR) => {
    const d = distance(s.lat, s.lon, latR, lonR), b = bearing(s.lat, s.lon, latR, lonR) * R2D;
    const rel = (b - hdg) * D2R;
    return [cx + Math.sin(rel) * d * pxPerM, cy - Math.cos(rel) * d * pxPerM];
  };
  // airports & runways
  for (const ap of s.nearby || []) {
    for (const r of ap.r) {
      const p1 = proj(r[1] * D2R, r[2] * D2R), p2 = proj(r[5] * D2R, r[6] * D2R);
      ctx.strokeStyle = COL.white; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.stroke();
    }
    const p = proj(ap.la * D2R, ap.lo * D2R);
    ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 7); ctx.stroke();
    txt(ctx, ap.i, p[0] + 10, p[1] - 9, 11, COL.cyan, 'left');
  }
  // active route (magenta)
  if (s.routePts && s.routePts.length) {
    ctx.strokeStyle = COL.magenta; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy);
    for (const p of s.routePts) ctx.lineTo(...proj(p.lat, p.lon));
    ctx.stroke();
    for (const p of s.routePts) { const q = proj(p.lat, p.lon); ctx.strokeStyle = COL.white; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q[0], q[1] - 6); ctx.lineTo(q[0] + 6, q[1]); ctx.lineTo(q[0], q[1] + 6); ctx.lineTo(q[0] - 6, q[1]); ctx.closePath(); ctx.stroke(); if (p.name) txt(ctx, p.name, q[0] + 9, q[1] - 9, 11, COL.magenta, 'left'); }
  }
  // selected runway extended centreline
  if (s.runway) {
    const r = s.runway; const p1 = proj(r.lat, r.lon);
    const far = [r.lat - Math.cos(r.heading) * (15 * 1852) / 6371000, r.lon - Math.sin(r.heading) * (15 * 1852) / (6371000 * Math.cos(r.lat))];
    const p2 = proj(far[0], far[1]);
    ctx.strokeStyle = COL.magenta; ctx.setLineDash([8, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.stroke(); ctx.setLineDash([]);
    txt(ctx, `${r.airport} ${r.ident}`, p1[0] + 12, p1[1] + 10, 11, COL.magenta, 'left');
  }
  ctx.restore();
  // heading bug
  if (s.ap) { const rel = wrap180(s.ap.hdg - hdg); if (Math.abs(rel) < 62) { const a = (rel - 90) * D2R; ctx.save(); ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.rotate(a + Math.PI / 2); ctx.strokeStyle = COL.magenta; ctx.lineWidth = 2; ctx.strokeRect(-7, -7, 14, 7); ctx.restore(); } }
  // track line
  const trel = wrap180(o.track - hdg) * D2R;
  if (o.gs > 20) { ctx.strokeStyle = COL.white; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(trel) * R, cy - Math.cos(trel) * R); ctx.stroke(); }
  // aircraft symbol
  ctx.strokeStyle = COL.white; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.moveTo(cx - 12, cy - 2); ctx.lineTo(cx + 12, cy - 2); ctx.moveTo(cx - 5, cy + 12); ctx.lineTo(cx + 5, cy + 12); ctx.stroke();
  // header
  box(ctx, cx - 26, 6, 52, 24, COL.white, '#000');
  txt(ctx, String(Math.round(hdg) % 360).padStart(3, '0'), cx, 18, 16, COL.white, 'center', 700);
  txt(ctx, 'TRK', cx - 50, 18, 12, COL.green); txt(ctx, 'MAG', cx + 52, 18, 12, COL.green);
  txt(ctx, `GS ${Math.round(o.gs)}  TAS ${Math.round(o.tas)}`, 8, 14, 12, COL.white, 'left');
  if (o.windSpd > 1) {
    txt(ctx, `${String(Math.round(o.windDir)).padStart(3, '0')}°/${Math.round(o.windSpd)}`, 8, 32, 12, COL.white, 'left');
    const a = (o.windDir + 180 - hdg) * D2R; ctx.save(); ctx.translate(26, 58); ctx.rotate(a); ctx.strokeStyle = COL.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 12); ctx.moveTo(-5, 6); ctx.lineTo(0, 12); ctx.lineTo(5, 6); ctx.stroke(); ctx.restore();
  }
  txt(ctx, `RNG ${range}`, w - 8, 14, 12, COL.cyan, 'right');
  if (s.runway && s.dist != null) txt(ctx, `${s.runway.airport}/${s.runway.ident}  ${(s.dist / 1852).toFixed(1)} NM`, w - 8, 32, 12, COL.magenta, 'right');
}

// ================================================================== EICAS
export function drawEICAS(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
  const fm = s.fm;
  const n = fm.engines.length;
  const prop = fm.engines[0].type !== 'turbofan';
  const dialR = Math.max(10, Math.min(w / (n * 2.5), h * 0.12, (h * 0.74 - 62 - h * 0.17) / 4.4));
  const dial = (x, y, v, max, label, red, val, rev) => {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.0;
    ctx.strokeStyle = COL.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, dialR, a0, a1); ctx.stroke();
    ctx.strokeStyle = COL.red; ctx.beginPath(); ctx.arc(x, y, dialR, a0 + (a1 - a0) * red, a1); ctx.stroke();
    const a = a0 + (a1 - a0) * clamp(v / max, 0, 1.05);
    ctx.fillStyle = 'rgba(200,200,200,0.25)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, dialR, a0, a); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = COL.white; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * dialR, y + Math.sin(a) * dialR); ctx.stroke();
    box(ctx, x + 2, y - dialR * 0.55, dialR * 1.05, 20, COL.white, '#000', 1.2);
    txt(ctx, val, x + 2 + dialR * 1.0, y - dialR * 0.55 + 10, 13, COL.white, 'right', 700);
    if (rev) txt(ctx, 'REV', x, y - dialR - 10, 12, COL.green, 'center', 700);
  };
  const top = h * 0.17;
  fm.engines.forEach((e, i) => {
    const x = (w / (n + 1)) * (i + 1) - dialR * 0.3;
    if (prop) dial(x, top, e.n1, 105, '', 0.95, Math.round(clamp((e.n1 - e.idle) / (100 - e.idle), 0, 1.05) * 100) + '', e.reverse > 0.5);
    else dial(x, top, e.n1, 110, '', 0.93, e.n1.toFixed(1), e.reverse > 0.5);
    dial(x, top + dialR * 2.6, e.egt, 1100, '', 0.86, Math.round(e.egt) + '');
    txt(ctx, (e.ff * 3600).toFixed(0), x, top + dialR * 4.25, 12, COL.white);
  });
  txt(ctx, prop ? 'TQ %' : 'N1', w / 2, top - dialR - 4, 12, COL.cyan);
  txt(ctx, 'EGT', w / 2, top + dialR * 2.6 - dialR - 4, 12, COL.cyan);
  txt(ctx, 'FF KG/H', w * 0.04, top + dialR * 4.25, 10, COL.cyan, 'left');
  // lower: fuel, gear, flaps
  const ly = h * 0.74;
  txt(ctx, 'FUEL', w * 0.12, ly - 26, 12, COL.cyan);
  txt(ctx, Math.round(fm.fuel) + ' KG', w * 0.12, ly - 8, 15, fm.fuel < fm.ac.fuel * 0.08 ? COL.amber : COL.white, 'center', 700);
  txt(ctx, 'GW ' + (fm.mass / 1000).toFixed(1) + ' T', w * 0.12, ly + 12, 12, COL.white);
  // gear
  const gp = fm.gearPos;
  const gtxt = fm.ac.geo.fixedGear ? 'FIXED' : gp > 0.98 ? 'DOWN' : gp < 0.02 ? 'UP' : '';
  const gcol = gp > 0.98 ? COL.green : gp < 0.02 ? COL.white : COL.amber;
  txt(ctx, 'GEAR', w * 0.4, ly - 26, 12, COL.cyan);
  for (const [dx, dy] of [[0, -6], [-22, 14], [22, 14]]) { if (gtxt === 'UP') continue; box(ctx, w * 0.4 + dx - 18, ly + dy - 9, 36, 18, gcol, '#000', 1.5); txt(ctx, gtxt || '▒▒', w * 0.4 + dx, ly + dy, 10, gcol, 'center', 700); }
  if (gtxt === 'UP') txt(ctx, 'UP', w * 0.4, ly, 15, COL.white, 'center', 700);
  // flaps
  txt(ctx, 'FLAPS', w * 0.68, ly - 26, 12, COL.cyan);
  const fx = w * 0.6, fwid = w * 0.16;
  ctx.strokeStyle = COL.white; ctx.strokeRect(fx, ly - 14, fwid, 10);
  ctx.fillStyle = COL.green; ctx.fillRect(fx, ly - 14, fwid * fm.flap, 10);
  txt(ctx, fm.flapLabel, fx + fwid / 2, ly + 8, 15, Math.abs(fm.flap - fm.flapLevels[fm.flapIndex].flap) > 0.02 ? COL.amber : COL.green, 'center', 700);
  // trim / spoilers / brakes
  txt(ctx, 'TRIM', w * 0.9, ly - 26, 12, COL.cyan);
  txt(ctx, (fm.trim * 10).toFixed(1), w * 0.9, ly - 8, 14, COL.white);
  const msgs = [];
  if (fm.parkingBrake) msgs.push(['PARK BRAKE SET', COL.amber]);
  if (fm.spoiler > 0.05) msgs.push(['SPEEDBRAKE ' + (fm.onGround ? 'DEPLOYED' : 'EXTENDED'), COL.amber]);
  else if (fm.spoilersArmed) msgs.push(['SPEEDBRAKE ARMED', COL.green]);
  if (fm.reversers) msgs.push(['REVERSERS', COL.green]);
  if (s.ap && s.ap.at) msgs.push(['A/T ' + (s.ap.retard ? 'RETARD' : 'SPD'), COL.green]);
  if (fm.fuel < fm.ac.fuel * 0.08) msgs.push(['LOW FUEL', COL.amber]);
  if (s.out.stall) msgs.push(['STALL', COL.red]);
  if (!fm.onGround && fm.gearPos < 0.98 && s.out.agl < 800 && fm.ctl.throttle < 0.3 && s.out.vs < 0) msgs.push(['GEAR NOT DOWN', COL.red]);
  msgs.slice(0, 5).forEach(([m, c], i) => txt(ctx, m, w * 0.04, h * 0.9 + i * 16 - (msgs.length > 2 ? 16 : 0), 12, c, 'left', 700));
  txt(ctx, `TAT ${Math.round(s.out.oat)}°C`, w * 0.96, h * 0.92, 12, COL.white, 'right');
}
