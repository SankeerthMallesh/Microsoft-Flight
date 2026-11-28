// Fighter head-up display: green stroke symbology drawn on a transparent canvas that the 3D cockpit
// projects onto the HUD combiner glass (cockpit meta screen key 'hud').
import { setup, FONT } from './instruments.js';
import { D2R, clamp } from '../sim/math.js';

const G = '#5dff8a';
function t(ctx, s, x, y, size, align = 'center') { ctx.font = `600 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }

export function drawHUD(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const o = s.out, fm = s.fm;
  const cx = w / 2, cy = h * 0.5, ppd = h / 20; // ~20 deg total field of view on the combiner
  ctx.strokeStyle = G; ctx.fillStyle = G; ctx.lineWidth = 1.4; ctx.shadowColor = G; ctx.shadowBlur = 3;
  // ---- pitch ladder (rotates with bank), centred on the boresight
  ctx.save(); ctx.beginPath(); ctx.rect(w * 0.16, h * 0.14, w * 0.68, h * 0.72); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-o.roll * D2R);
  for (let p = -90; p <= 90; p += 5) {
    const y = (o.pitch - p) * ppd; if (Math.abs(y) > h) continue;
    const L = p === 0 ? w * 0.36 : w * 0.11, gap = w * 0.06;
    ctx.setLineDash(p < 0 ? [5, 4] : []);
    ctx.beginPath(); ctx.moveTo(-gap - L, y); ctx.lineTo(-gap, y); ctx.moveTo(gap, y); ctx.lineTo(gap + L, y); ctx.stroke();
    if (p !== 0) {
      const tk = p > 0 ? 6 : -6;
      ctx.beginPath(); ctx.moveTo(-gap - L, y); ctx.lineTo(-gap - L, y + tk); ctx.moveTo(gap + L, y); ctx.lineTo(gap + L, y + tk); ctx.stroke();
      t(ctx, String(Math.abs(p)), -gap - L - 12, y, 10); t(ctx, String(Math.abs(p)), gap + L + 12, y, 10);
    }
  }
  ctx.setLineDash([]); ctx.restore();
  // ---- boresight (waterline) and flight path marker (velocity vector: offset by alpha / sideslip)
  ctx.beginPath(); ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 6, cy); ctx.lineTo(cx - 3, cy + 5); ctx.lineTo(cx, cy); ctx.lineTo(cx + 3, cy + 5); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx + 16, cy); ctx.stroke();
  if (!fm.onGround || o.ias > 30) {
    const fx = cx + clamp(-(o.beta || 0) * ppd, -w * 0.3, w * 0.3), fy = cy + clamp((o.alpha || 0) * ppd, -h * 0.3, h * 0.35);
    ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.moveTo(fx - 16, fy); ctx.lineTo(fx - 6, fy); ctx.moveTo(fx + 6, fy); ctx.lineTo(fx + 16, fy); ctx.moveTo(fx, fy - 6); ctx.lineTo(fx, fy - 13); ctx.stroke();
  }
  // ---- heading tape (top)
  const hy = h * 0.1, hdg = o.hdg;
  ctx.save(); ctx.beginPath(); ctx.rect(w * 0.25, 0, w * 0.5, h * 0.2); ctx.clip();
  for (let d = Math.floor(hdg / 5) * 5 - 30; d <= hdg + 30; d += 5) {
    const x = cx + (d - hdg) * w / 60; const big = d % 10 === 0;
    ctx.beginPath(); ctx.moveTo(x, hy + 10); ctx.lineTo(x, hy + (big ? 2 : 6)); ctx.stroke();
    if (big) t(ctx, String(((d % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, hy - 6, 10);
  }
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(cx, hy + 12); ctx.lineTo(cx - 5, hy + 19); ctx.lineTo(cx + 5, hy + 19); ctx.closePath(); ctx.stroke();
  // ---- airspeed (left) and altitude (right) boxes, Mach / G / alpha below
  const bw = w * 0.17, bh = 20;
  ctx.strokeRect(w * 0.06, cy - bh / 2, bw, bh); t(ctx, String(Math.round(o.ias)), w * 0.06 + bw / 2, cy, 13);
  ctx.strokeRect(w * 0.77, cy - bh / 2, bw, bh); t(ctx, Math.round(o.alt).toLocaleString('en-US'), w * 0.77 + bw / 2, cy, 13);
  t(ctx, 'M ' + o.mach.toFixed(2), w * 0.06, cy + 34, 11, 'left');
  t(ctx, 'G ' + (fm.nz || 1).toFixed(1), w * 0.06, cy + 50, 11, 'left');
  t(ctx, 'α ' + (o.alpha || 0).toFixed(1), w * 0.06, cy + 66, 11, 'left');
  const vs = Math.round(o.vs / 10) * 10; t(ctx, (vs > 0 ? '+' : '') + vs, w * 0.94, cy + 34, 11, 'right');
  if (o.agl < 5000 && !fm.onGround) t(ctx, 'R ' + Math.round(o.agl), w * 0.94, cy + 50, 11, 'right');
  // ---- thrust / reheat, gear
  const ab = fm.engines.reduce((a, e) => a + (e.ab || 0), 0) / fm.engines.length;
  t(ctx, ab > 0.05 ? 'AB ' + Math.round(fm.ctl.throttle * 100) + '%' : 'THR ' + Math.round(fm.ctl.throttle * 100) + '%', w * 0.06, h * 0.9, 11, 'left');
  if (fm.gearPos > 0.02) t(ctx, fm.gearPos > 0.98 ? 'GEAR' : 'GEAR ↕', w * 0.94, h * 0.9, 11, 'right');
  if (o.stall) t(ctx, 'AOA', cx, h * 0.78, 14);
}
