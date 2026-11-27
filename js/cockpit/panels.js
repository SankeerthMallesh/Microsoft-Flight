// Type-specific 2D panels: Airbus PFD + ECAM E/WD, and a classic general-aviation six-pack with an engine strip.
// All functions take (canvas, s) like the glass displays in instruments.js; `s` comes from instrumentState() in main.js.
import { D2R, R2D, clamp, wrap180 } from '../sim/math.js';
import { FONT, setup, txt, box } from './instruments.js';

// ------------------------------------------------------------------ style selection
// 'airbus' | 'ga' | 'boeing' (Boeing-style glass, also used for other jets and turboprops)
export function panelStyleFor(ac) {
  if (!ac) return 'boeing';
  if (ac.engines?.type === 'piston' || ac.category === 'General aviation') return 'ga';
  if (ac.maker === 'Airbus') return 'airbus';
  return 'boeing';
}

const AB = { sky: '#1a86dc', ground: '#8a5226', tape: '#4b5058', yellow: '#ffe600', green: '#22f25a', cyan: '#2ee6ff', magenta: '#ff4cf5', amber: '#ff9d00', red: '#ff3030', white: '#ffffff' };

// ================================================================== Airbus PFD
// FMA mode changes get a white box for 10 s, as on the real thing
const fmaMem = new Map();
function fmaBoxed(key, val, now) {
  const m = fmaMem.get(key);
  if (!m || m.v !== val) { fmaMem.set(key, { v: val, t: now }); return !!val; }
  return !!val && now - m.t < 10000;
}
function airbusFMA(s) {
  const ap = s.ap, o = s.out, fm = s.fm;
  const f = { thr: '', thrCol: AB.green, vert: '', vertArm: '', lat: '', latArm: '', cat: '', cat2: '', ap1: '', fd: '', athr: '' };
  if (!ap) return f;
  const climbing = ap.alt > o.alt + 50, descending = ap.alt < o.alt - 50;
  if (ap.at) f.thr = ap.retard ? 'IDLE' : ap.engaged && ap.vert === 'FLCH' ? (climbing ? 'THR CLB' : 'THR IDLE') : ap.engaged && ap.vert === 'VNAV' && climbing ? 'THR CLB' : 'SPEED';
  else if (fm && fm.ctl.throttle > 0.97) { f.thr = 'MAN TOGA'; f.thrCol = AB.white; }
  if (ap.engaged) {
    f.vert = { ALT: 'ALT', VS: 'V/S ' + (ap.vs >= 0 ? '+' : '') + ap.vs, FLCH: climbing ? 'OP CLB' : 'OP DES', VNAV: climbing ? 'CLB' : descending ? 'DES' : 'ALT CRZ', GS: ap.flare ? 'FLARE' : 'G/S' }[ap.vert] || '';
    f.lat = { HDG: 'HDG', NAV: 'NAV', LOC: 'LOC' }[ap.lat] || 'HDG';
    if (ap.vert !== 'ALT' && ap.vert !== 'GS') f.vertArm = 'ALT';
    f.ap1 = 'AP1'; f.fd = '1 FD 2';
  }
  if (ap.appArmed && ap.vert !== 'GS') f.vertArm = 'G/S';
  if (ap.appArmed && ap.lat !== 'LOC') f.latArm = 'LOC';
  if (ap.appArmed || ap.lat === 'LOC') { f.cat = 'CAT 3'; f.cat2 = ap.engaged ? 'DUAL' : 'SINGLE'; }
  if (ap.at) f.athr = 'A/THR';
  return f;
}
function fmtAltTarget(a) { return a >= 10000 ? 'FL' + Math.round(a / 100) : String(a); }

export function drawAirbusPFD(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const o = s.out, ap = s.ap, fm = s.fm;
  const now = performance.now();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const fmaH = h * 0.14, H = h - fmaH;
  const cx = w * 0.45, cy = fmaH + H * 0.47;
  const R = Math.min(w * 0.22, H * 0.33);
  const ppd = R / 18; // px per degree of pitch
  const fs = clamp(R * 0.14, 9, 15);

  // ---- attitude sphere (rounded top and bottom, straight sides)
  const adiPath = () => {
    ctx.beginPath(); ctx.moveTo(cx - R, cy - R * 0.8); ctx.quadraticCurveTo(cx, cy - R * 1.3, cx + R, cy - R * 0.8);
    ctx.lineTo(cx + R, cy + R * 0.8); ctx.quadraticCurveTo(cx, cy + R * 1.3, cx - R, cy + R * 0.8); ctx.closePath();
  };
  ctx.save(); adiPath(); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-o.roll * D2R);
  const pOff = o.pitch * ppd;
  ctx.fillStyle = AB.sky; ctx.fillRect(-R * 3, -R * 4 + pOff, R * 6, R * 4);
  ctx.fillStyle = AB.ground; ctx.fillRect(-R * 3, pOff, R * 6, R * 4);
  ctx.strokeStyle = AB.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-R * 3, pOff); ctx.lineTo(R * 3, pOff); ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let p = -80; p <= 80; p += 2.5) {
    if (!p) continue;
    const y = pOff - p * ppd;
    if (Math.abs(y) > R * 0.95) continue;
    const major = p % 10 === 0, mid = p % 5 === 0;
    const lw = major ? R * 0.3 : mid ? R * 0.15 : R * 0.07;
    ctx.beginPath(); ctx.moveTo(-lw, y); ctx.lineTo(lw, y); ctx.stroke();
    if (major) { txt(ctx, Math.abs(p), -lw - fs, y, fs * 0.85, AB.white); txt(ctx, Math.abs(p), lw + fs, y, fs * 0.85, AB.white); }
  }
  ctx.restore();
  // ---- roll scale (fixed, white) and roll/slip index (moving, yellow)
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = AB.white; ctx.lineWidth = 1.6;
  const rr = R * 1.08;
  ctx.beginPath(); ctx.arc(0, 0, rr, (-90 - 45) * D2R, (-90 + 45) * D2R); ctx.stroke();
  for (const a of [-45, -30, -20, -10, 10, 20, 30, 45]) {
    const t = (a - 90) * D2R, r2 = rr + (Math.abs(a) >= 30 ? R * 0.1 : R * 0.06);
    ctx.beginPath(); ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr); ctx.lineTo(Math.cos(t) * r2, Math.sin(t) * r2); ctx.stroke();
  }
  ctx.fillStyle = AB.yellow; ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(-6, -rr - 9); ctx.lineTo(6, -rr - 9); ctx.closePath(); ctx.fill();
  ctx.rotate(-o.roll * D2R);
  const bankWarn = Math.abs(o.roll) > 45;
  ctx.strokeStyle = bankWarn ? AB.amber : AB.yellow; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -rr + 1); ctx.lineTo(-6, -rr + 10); ctx.lineTo(6, -rr + 10); ctx.closePath(); ctx.stroke();
  const slip = clamp(o.beta * 3, -14, 14);
  ctx.beginPath(); ctx.moveTo(slip - 7, -rr + 13); ctx.lineTo(slip + 7, -rr + 13); ctx.lineTo(slip + 9, -rr + 17); ctx.lineTo(slip - 9, -rr + 17); ctx.closePath();
  if (Math.abs(o.beta) > 3) { ctx.fillStyle = AB.yellow; ctx.fill(); } else ctx.stroke();
  ctx.restore();
  // ---- flight director (green on Airbus)
  if (ap && ap.engaged) {
    ctx.strokeStyle = AB.green; ctx.lineWidth = 2.5;
    const fdx = clamp((ap.cmd.roll * R2D - o.roll) * 2.5, -R * 0.6, R * 0.6), fdy = clamp(-(ap.cmd.pitch * R2D - o.pitch) * ppd, -R * 0.6, R * 0.6);
    ctx.beginPath(); ctx.moveTo(cx + fdx, cy - R * 0.55); ctx.lineTo(cx + fdx, cy + R * 0.55); ctx.moveTo(cx - R * 0.55, cy + fdy); ctx.lineTo(cx + R * 0.55, cy + fdy); ctx.stroke();
  }
  // ---- aircraft symbol: black L-shaped wings outlined yellow + centre square
  ctx.fillStyle = '#000'; ctx.strokeStyle = AB.yellow; ctx.lineWidth = 2;
  for (const sg of [-1, 1]) {
    const x0 = cx + sg * R * 0.78, x1 = cx + sg * R * 0.3;
    ctx.beginPath(); ctx.moveTo(x0, cy - 3); ctx.lineTo(x1 + sg * 3, cy - 3); ctx.lineTo(x1 + sg * 3, cy + 12); ctx.lineTo(x1 - sg * 3, cy + 12); ctx.lineTo(x1 - sg * 3, cy + 3); ctx.lineTo(x0, cy + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillRect(cx - 4, cy - 4, 8, 8); ctx.strokeRect(cx - 4, cy - 4, 8, 8);
  // ---- radio altitude (green, amber below 400 ft)
  if (o.agl < 2500 && !fm?.onGround) txt(ctx, String(o.agl < 50 ? Math.round(o.agl) : Math.round(o.agl / 10) * 10), cx, cy + R * 0.98, fs * 1.25, o.agl < 400 ? AB.amber : AB.green, 'center', 700);
  // ---- ILS deviation (magenta diamonds on white dot scales)
  if (s.ils) {
    const loc = clamp(-s.ils.xtk / Math.max(60, Math.abs(s.ils.along) * 0.0436), -2.2, 2.2);
    const gs = clamp(s.ils.gsDev / Math.max(8, Math.abs(s.ils.aimDist) * 0.0122), -2.2, 2.2);
    ctx.strokeStyle = AB.white; ctx.lineWidth = 1.2;
    for (let k = -2; k <= 2; k++) { if (!k) continue; ctx.beginPath(); ctx.arc(cx + k * R * 0.3, cy + R * 1.17, 3, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + R * 1.1, cy + k * R * 0.3, 3, 0, 7); ctx.stroke(); }
    ctx.fillStyle = AB.magenta;
    const dm = (x, y) => { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); };
    dm(cx + loc * R * 0.3, cy + R * 1.17); dm(cx + R * 1.1, cy + gs * R * 0.3);
    txt(ctx, 'ILS', w * 0.02, h - 10, fs * 0.9, AB.magenta, 'left', 700);
  }

  // ---- speed tape (left)
  const ty = cy - R * 1.05, th = R * 2.1;
  const tx = Math.max(2, cx - R - w * 0.2), tw = cx - R - w * 0.035 - tx;
  const ias = Math.max(30, o.ias), kPx = th / 84;
  const vy = (v) => cy - (v - ias) * kPx;
  ctx.save(); ctx.fillStyle = AB.tape; ctx.fillRect(tx, ty, tw, th); ctx.beginPath(); ctx.rect(tx, ty, tw + 12, th); ctx.clip();
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.5;
  for (let v = Math.floor((ias - 45) / 10) * 10; v <= ias + 45; v += 10) {
    if (v < 30) continue;
    const y = vy(v);
    ctx.beginPath(); ctx.moveTo(tx + tw - 8, y); ctx.lineTo(tx + tw, y); ctx.stroke();
    if (v % 20 === 0) txt(ctx, String(v).padStart(3, '0'), tx + tw - 12, y, fs, AB.white, 'right');
  }
  const vs = s.vspeeds;
  if (vs) {
    // VMAX: red/black barber pole
    const vmax = Math.min(vs.vmo, o.mach > 0.01 ? (o.ias * vs.mmo) / Math.max(o.mach, 0.01) : vs.vmo);
    const yv = vy(vmax);
    for (let y = yv, k = 0; y > ty - 8; y -= 7, k++) { ctx.fillStyle = k % 2 ? '#000' : AB.red; ctx.fillRect(tx + tw - 1, y - 7, 7, 7); }
    // low-speed protection: VLS amber, alpha prot amber/black, alpha max red (hidden on the ground)
    if (s.stallSpeed && fm && !fm.onGround) {
      const vls = s.stallSpeed * 1.23, aprot = s.stallSpeed * 1.1, amax = s.stallSpeed * 1.03;
      ctx.fillStyle = AB.amber; ctx.fillRect(tx + tw - 1, vy(vls), 3, Math.max(0, vy(aprot) - vy(vls)));
      for (let y = vy(aprot), k = 0; y < vy(amax); y += 6, k++) { ctx.fillStyle = k % 2 ? '#000' : AB.amber; ctx.fillRect(tx + tw - 1, y, 7, Math.min(6, vy(amax) - y)); }
      ctx.fillStyle = AB.red; ctx.fillRect(tx + tw - 1, vy(amax), 7, th);
    }
    if (s.phase === 'takeoff' && fm && fm.onGround) { const y = vy(vs.vr); ctx.strokeStyle = AB.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx + tw + 5, y, 4, 0, 7); ctx.stroke(); }
  }
  // speed target: cyan (selected) or magenta (managed) triangle
  if (ap) {
    const col = ap.engaged && ap.vert === 'VNAV' ? AB.magenta : AB.cyan, y = vy(ap.spd);
    if (y > ty && y < ty + th) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx + tw, y); ctx.lineTo(tx + tw + 9, y - 6); ctx.lineTo(tx + tw + 9, y + 6); ctx.closePath(); ctx.stroke(); }
  }
  ctx.restore();
  if (ap) {
    const y = vy(ap.spd), col = ap.engaged && ap.vert === 'VNAV' ? AB.magenta : AB.cyan;
    if (y <= ty) txt(ctx, Math.round(ap.spd), tx + tw / 2, ty - fs * 0.7, fs, col, 'center', 700);
    else if (y >= ty + th) txt(ctx, Math.round(ap.spd), tx + tw / 2, ty + th + fs * 0.7, fs, col, 'center', 700);
  }
  // speed reference line + trend arrow (yellow)
  ctx.strokeStyle = AB.yellow; ctx.fillStyle = AB.yellow; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(tx - 2, cy); ctx.lineTo(tx + tw + 2, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx + tw - 2, cy); ctx.lineTo(tx + tw + 12, cy - 7); ctx.lineTo(tx + tw + 12, cy + 7); ctx.closePath(); ctx.fill();
  if (s.trend && Math.abs(s.trend * 10) > 2) {
    const y2 = clamp(cy - s.trend * 10 * kPx, ty, ty + th), d = Math.sign(cy - y2);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx + tw * 0.55, cy); ctx.lineTo(tx + tw * 0.55, y2); ctx.moveTo(tx + tw * 0.55 - 5, y2 + d * 7); ctx.lineTo(tx + tw * 0.55, y2); ctx.lineTo(tx + tw * 0.55 + 5, y2 + d * 7); ctx.stroke();
  }
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.5; ctx.strokeRect(tx, ty, tw, th);
  if (o.mach >= 0.5) txt(ctx, '.' + Math.round(o.mach * 1000).toString().padStart(3, '0').slice(0, 2), tx + tw / 2, ty + th + fs * 1.9, fs * 1.15, AB.green, 'center', 700);

  // ---- altitude tape (right)
  const ax = cx + R + w * 0.075, aw = w * 0.1, aPx = th / 1100;
  const ay = (a) => cy - (a - o.alt) * aPx;
  ctx.save(); ctx.fillStyle = AB.tape; ctx.fillRect(ax, ty, aw, th); ctx.beginPath(); ctx.rect(ax - 12, ty, aw + 12, th); ctx.clip();
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.5;
  for (let a = Math.floor((o.alt - 600) / 100) * 100; a <= o.alt + 600; a += 100) {
    const y = ay(a);
    ctx.beginPath(); ctx.moveTo(ax + aw - 7, y); ctx.lineTo(ax + aw, y); ctx.stroke();
    if (a % 500 === 0) txt(ctx, String(Math.round(a / 100)).padStart(3, '0'), ax + aw * 0.42, y, fs, AB.white);
  }
  // ground: red ribbon
  const gy = ay(o.alt - o.agl);
  if (gy < ty + th) { ctx.fillStyle = AB.red; ctx.fillRect(ax + aw - 6, gy, 6, th); }
  // selected altitude: cyan bracket on the tape
  if (ap) { const y = ay(ap.alt); if (y > ty && y < ty + th) { ctx.strokeStyle = AB.cyan; ctx.lineWidth = 2; ctx.strokeRect(ax - 10, y - 9, aw * 0.75, 18); txt(ctx, fmtAltTarget(ap.alt), ax + aw * 0.28, y, fs * 0.8, AB.cyan, 'center', 700); } }
  ctx.restore();
  if (ap) { const y = ay(ap.alt); if (y <= ty) txt(ctx, fmtAltTarget(ap.alt), ax + aw / 2, ty - fs * 0.7, fs, AB.cyan, 'center', 700); else if (y >= ty + th) txt(ctx, fmtAltTarget(ap.alt), ax + aw / 2, ty + th + fs * 0.7, fs, AB.cyan, 'center', 700); }
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.5; ctx.strokeRect(ax, ty, aw, th);
  // altitude window: yellow frame, green hundreds + 20-ft drum
  const alt = Math.round(o.alt), neg = alt < 0, aa = Math.abs(alt);
  const winW = aw + w * 0.035, winH = fs * 2.2;
  box(ctx, ax - 2, cy - winH / 2, winW, winH, AB.yellow, '#000', 2);
  txt(ctx, (neg ? '-' : '') + String(Math.floor(aa / 100)).padStart(3, '0'), ax + winW * 0.58, cy, fs * 1.35, AB.green, 'right', 700);
  const drum = Math.round((aa % 100) / 20) * 20 % 100;
  txt(ctx, String((drum + 20) % 100).padStart(2, '0'), ax + winW * 0.62, cy - fs * 0.95, fs * 0.8, 'rgba(34,242,90,0.5)', 'left', 700);
  txt(ctx, String(drum).padStart(2, '0'), ax + winW * 0.62, cy, fs * 1.05, AB.green, 'left', 700);
  txt(ctx, String((drum + 80) % 100).padStart(2, '0'), ax + winW * 0.62, cy + fs * 0.95, fs * 0.8, 'rgba(34,242,90,0.5)', 'left', 700);
  // baro reference
  if (o.alt > 18000) { box(ctx, ax + aw / 2 - fs * 1.6, ty + th + fs * 0.6, fs * 3.2, fs * 1.4, AB.yellow, '#000', 1.2); txt(ctx, 'STD', ax + aw / 2, ty + th + fs * 1.3, fs, AB.cyan, 'center', 700); }
  else { txt(ctx, 'QNH', ax, ty + th + fs * 1.3, fs * 0.85, AB.white, 'left'); txt(ctx, '1013', ax + aw + 4, ty + th + fs * 1.3, fs, AB.cyan, 'right', 700); }

  // ---- vertical speed (grey scale, green needle pivoting off the right edge)
  const vx = ax + aw + w * 0.04, vw = Math.min(w - vx - 2, w * 0.06), vh = R * 0.95;
  ctx.fillStyle = AB.tape; ctx.beginPath(); ctx.moveTo(vx, cy - vh * 0.7); ctx.lineTo(vx + vw * 0.5, cy - vh); ctx.lineTo(vx + vw, cy - vh); ctx.lineTo(vx + vw, cy + vh); ctx.lineTo(vx + vw * 0.5, cy + vh); ctx.lineTo(vx, cy + vh * 0.7); ctx.closePath(); ctx.fill();
  const vsY = (v) => cy - Math.sign(v) * (Math.abs(v) <= 2000 ? Math.abs(v) / 2000 * 0.75 : 0.75 + (Math.min(Math.abs(v), 6000) - 2000) / 4000 * 0.2) * vh;
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.2;
  for (const v of [-6000, -2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000, 6000]) {
    const y = vsY(v), big = v % 1000 === 0;
    ctx.beginPath(); ctx.moveTo(vx + 2, y); ctx.lineTo(vx + (big ? 8 : 5), y); ctx.stroke();
    if (v && big) txt(ctx, Math.abs(v / 1000), vx + 13, y, fs * 0.75, AB.white);
  }
  const vsCol = Math.abs(o.vs) > 6000 || (o.vs < -2000 && o.agl < 2500 && !fm?.onGround) ? AB.amber : AB.green;
  const ny = vsY(o.vs);
  ctx.strokeStyle = vsCol; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(vx + vw, cy + (ny - cy) * 0.3); ctx.lineTo(vx + 3, ny); ctx.stroke();
  if (Math.abs(o.vs) >= 200) { const yb = clamp(ny + (o.vs > 0 ? -fs : fs), cy - vh, cy + vh); box(ctx, vx + vw * 0.2, yb - fs * 0.6, vw * 0.8, fs * 1.2, '#000', '#000', 0.5); txt(ctx, String(Math.round(Math.abs(o.vs) / 100)).padStart(2, '0'), vx + vw * 0.6, yb, fs * 0.95, vsCol, 'center', 700); }

  // ---- heading tape (bottom)
  const hy = cy + R * 1.3, hH = Math.max(12, Math.min(h - hy - 2, R * 0.3)), hx = cx - R, hw = R * 2, hpd = hw / 50;
  ctx.save(); ctx.fillStyle = AB.tape; ctx.fillRect(hx, hy, hw, hH); ctx.beginPath(); ctx.rect(hx, hy - 12, hw, hH + 12); ctx.clip();
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.4;
  for (let d = Math.floor((o.hdg - 30) / 5) * 5; d <= o.hdg + 30; d += 5) {
    const x = cx + wrap180(d - o.hdg) * hpd, dd = ((d % 360) + 360) % 360;
    ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy + (dd % 10 === 0 ? 8 : 4)); ctx.stroke();
    if (dd % 10 === 0) txt(ctx, String(dd / 10), x, hy + hH * 0.66, (dd % 30 === 0 ? 1 : 0.8) * fs, AB.white);
  }
  if (ap) { const x = cx + wrap180(ap.hdg - o.hdg) * hpd; ctx.fillStyle = AB.cyan; ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x - 6, hy - 10); ctx.lineTo(x + 6, hy - 10); ctx.closePath(); ctx.fill(); }
  if (o.gs > 30) { const x = cx + wrap180(o.track - o.hdg) * hpd; ctx.strokeStyle = AB.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, hy + 1); ctx.lineTo(x + 4, hy + 6); ctx.lineTo(x, hy + 11); ctx.lineTo(x - 4, hy + 6); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = AB.yellow; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, hy - 6); ctx.lineTo(cx, hy + hH * 0.45); ctx.stroke();
  if (ap) { const dh = wrap180(ap.hdg - o.hdg); if (Math.abs(dh) > 25) txt(ctx, String(Math.round(ap.hdg) % 360).padStart(3, '0'), dh > 0 ? hx + hw - 4 : hx + 4, hy - fs * 0.6, fs, AB.cyan, dh > 0 ? 'right' : 'left', 700); }

  // ---- FMA: five columns
  const f = airbusFMA(s), cw = w / 5, ffs = clamp(fmaH * 0.3, 8, 13);
  ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(cw * i, 3); ctx.lineTo(cw * i, fmaH - 3); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, fmaH); ctx.lineTo(w, fmaH); ctx.stroke();
  const r1 = fmaH * 0.24, r2 = fmaH * 0.53, r3 = fmaH * 0.8;
  const cell = (key, val, col, x, y) => {
    if (!val) { fmaBoxed(key, '', now); return; }
    txt(ctx, val, x, y, ffs, col, 'center', 700);
    if (fmaBoxed(key, val, now)) { ctx.font = `700 ${ffs}px ${FONT}`; const tw2 = ctx.measureText(val).width + 8; ctx.strokeStyle = AB.white; ctx.lineWidth = 1.2; ctx.strokeRect(x - tw2 / 2, y - ffs * 0.7, tw2, ffs * 1.4); }
  };
  cell('thr', f.thr, f.thrCol, cw * 0.5, r1);
  cell('vert', f.vert, AB.green, cw * 1.5, r1); cell('vertArm', f.vertArm, AB.cyan, cw * 1.5, r2);
  cell('lat', f.lat, AB.green, cw * 2.5, r1); cell('latArm', f.latArm, AB.cyan, cw * 2.5, r2);
  if (f.cat) { txt(ctx, f.cat, cw * 3.5, r1, ffs, AB.white, 'center', 700); txt(ctx, f.cat2, cw * 3.5, r2, ffs, AB.white, 'center', 700); }
  cell('ap', f.ap1, AB.white, cw * 4.5, r1); if (f.fd) txt(ctx, f.fd, cw * 4.5, r2, ffs, AB.white, 'center', 700);
  if (f.athr) txt(ctx, f.athr, cw * 4.5, r3, ffs, AB.white, 'center', 700);
  if (ap && ap.retard && o.agl < 40) txt(ctx, 'RETARD', cx, cy + R * 0.55, fs * 1.4, AB.white, 'center', 800);
  if (o.stall) txt(ctx, 'STALL', cx, cy - R * 0.45, fs * 1.6, AB.red, 'center', 800);
  if (s.warn) txt(ctx, s.warn, cx, cy + R * 0.55, fs * 1.3, AB.red, 'center', 800);
}

// ================================================================== Airbus ECAM engine/warning display (E/WD)
function ecamArc(ctx, x, y, r, frac, opts) {
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.05, span = a1 - a0;
  ctx.lineWidth = 2; ctx.strokeStyle = AB.white;
  ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + span * opts.redAt); ctx.stroke();
  ctx.strokeStyle = AB.red; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y, r, a0 + span * opts.redAt, a1); ctx.stroke();
  // scale ticks
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.5;
  for (const t of opts.ticks) { const a = a0 + span * t; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r * 0.84, y + Math.sin(a) * r * 0.84); ctx.stroke(); }
  if (opts.labels) for (const [t, l] of opts.labels) { const a = a0 + span * t; txt(ctx, l, x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, Math.max(8, r * 0.26), AB.white); }
  // commanded thrust (thrust lever) marker: small cyan circle on the arc
  if (opts.cmd != null) { const a = a0 + span * clamp(opts.cmd, 0, 1); ctx.strokeStyle = AB.cyan; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5), 3.5, 0, 7); ctx.stroke(); }
  const a = a0 + span * clamp(frac, 0, 1.03);
  const col = frac > opts.redAt ? AB.red : frac > (opts.amberAt ?? 2) ? AB.amber : AB.green;
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2); ctx.lineTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3)); ctx.stroke();
  return col;
}

export function drawECAM(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const fm = s.fm, n = fm.engines.length, o = s.out;
  const engH = h * 0.62, top = 20;
  const half = Math.ceil(n / 2);
  // engines split either side of a centre label column
  const xs = fm.engines.map((_, i) => i < half ? w * (0.06 + 0.37 * (i + 0.5) / half) : w * (0.57 + 0.37 * (i - half + 0.5) / (n - half)));
  if (n === 1) xs[0] = w * 0.3;
  const r = Math.max(10, Math.min(w * 0.37 / half * 0.42, (engH - top - 18) / 4.3));
  const fs = clamp(r * 0.36, 9, 14);
  const y1 = top + r * 1.05, y2 = y1 + r * 2.05, yff = y2 + r * 1.0;
  const lx = n === 1 ? w * 0.62 : w * 0.5;
  txt(ctx, 'N1', lx, y1 - fs * 0.5, fs, AB.white, 'center', 700); txt(ctx, '%', lx, y1 + fs * 0.7, fs * 0.9, AB.cyan);
  txt(ctx, 'EGT', lx, y2 - fs * 0.5, fs, AB.white, 'center', 700); txt(ctx, '°C', lx, y2 + fs * 0.7, fs * 0.9, AB.cyan);
  txt(ctx, 'FF', lx, yff, fs * 0.95, AB.white, 'center', 700); txt(ctx, 'KG/H', lx, yff + fs * 1.05, fs * 0.8, AB.cyan);
  const thr = clamp(fm.ctl.throttle, 0, 1);
  fm.engines.forEach((e, i) => {
    const x = xs[i];
    const cmd = (e.idle + thr * (100 - e.idle)) / 110;
    const c1 = ecamArc(ctx, x, y1, r, e.n1 / 110, { redAt: 101 / 110, ticks: [0, 50 / 110, 100 / 110], labels: [[50 / 110, '5'], [100 / 110, '10']], cmd: e.reverse > 0.1 ? null : cmd });
    box(ctx, x - r * 0.05, y1 + r * 0.12, r * 1.15, fs * 1.4, '#7d8590', '#000', 1);
    txt(ctx, e.n1.toFixed(1), x + r * 1.05, y1 + r * 0.12 + fs * 0.7, fs * 1.15, c1, 'right', 700);
    if (e.reverse > 0.05) { box(ctx, x - r * 0.45, y1 - r * 0.55, r * 0.9, fs * 1.3, AB.white, '#000', 1); txt(ctx, 'REV', x, y1 - r * 0.55 + fs * 0.65, fs, e.reverse > 0.95 ? AB.green : AB.amber, 'center', 700); }
    const r2 = r * 0.72;
    const c2 = ecamArc(ctx, x, y2, r2, e.egt / 1100, { redAt: 1000 / 1100, amberAt: 950 / 1100, ticks: [0, 0.5, 1000 / 1100] });
    txt(ctx, Math.round(e.egt), x + r2 * 0.9, y2 + r2 * 0.35, fs * 1.05, c2, 'right', 700);
    txt(ctx, String(Math.round(e.ff * 3600 / 20) * 20), x, yff + fs * 0.5, fs * 1.05, e.running ? AB.green : AB.amber, 'center', 700);
  });
  // fuel on board
  const yb = engH + fs * 1.0;
  txt(ctx, 'FOB :', w * 0.03, yb, fs, AB.white, 'left', 700);
  const fob = String(Math.round(fm.fuel / 10) * 10);
  txt(ctx, fob, w * 0.03 + fs * 3.6, yb, fs * 1.15, fm.fuel < fm.ac.fuel * 0.08 ? AB.amber : AB.green, 'left', 700);
  txt(ctx, 'KG', w * 0.03 + fs * 3.6 + ctx.measureText(fob).width + 5, yb, fs * 0.85, AB.cyan, 'left');
  // slats / flaps indicator
  const seg = Math.min(w * 0.045, fs * 1.8), fx = w * 0.97 - seg * 4.8, fyy = engH + fs * 0.2;
  txt(ctx, 'S', fx - seg * 2.9, fyy, fs * 0.9, AB.white, 'center', 700); txt(ctx, 'F', fx + seg * 4.3, fyy, fs * 0.9, AB.white, 'center', 700);
  ctx.fillStyle = AB.white; ctx.fillRect(fx - seg * 0.2, fyy - 4, seg * 1.4, 7);
  for (let k = 1; k <= 3; k++) { ctx.fillStyle = AB.white; ctx.fillRect(fx - seg * 0.75 * k - 1, fyy + k * seg * 0.2 - 1, 2.5, 2.5); ctx.fillRect(fx + seg * 1.2 + seg * 0.75 * k - 1, fyy + k * seg * 0.2 - 1, 2.5, 2.5); }
  const moving = Math.abs(fm.flap - fm.flapLevels[fm.flapIndex].flap) > 0.02 || Math.abs(fm.slat - fm.flapLevels[fm.flapIndex].slat) > 0.02;
  const pcol = moving ? AB.cyan : AB.green;
  ctx.fillStyle = pcol;
  const sx = fx - seg * 0.75 * 3 * fm.slat, sy = fyy + 3 * seg * 0.2 * fm.slat;
  ctx.beginPath(); ctx.moveTo(fx - seg * 0.2, fyy - 3); ctx.lineTo(sx - seg * 0.5, sy + 2); ctx.lineTo(sx, sy + 6); ctx.lineTo(fx - seg * 0.2, fyy + 3); ctx.closePath(); ctx.fill();
  const flx = fx + seg * 1.2 + seg * 0.75 * 3 * fm.flap, fly = fyy + 3 * seg * 0.2 * fm.flap;
  ctx.beginPath(); ctx.moveTo(fx + seg * 1.2, fyy - 3); ctx.lineTo(flx + seg * 0.5, fly + 2); ctx.lineTo(flx, fly + 6); ctx.lineTo(fx + seg * 1.2, fyy + 3); ctx.closePath(); ctx.fill();
  if (fm.flapIndex > 0 || fm.flap > 0.01 || fm.slat > 0.01) txt(ctx, fm.flapLabel, fx + seg * 0.5, fyy + seg * 0.7 + fs * 0.5, fs * 1.05, pcol, 'center', 700);
  // memo area
  const my = engH + fs * 2.4;
  ctx.strokeStyle = AB.white; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(w * 0.02, my); ctx.lineTo(w * 0.98, my); ctx.moveTo(w * 0.62, my); ctx.lineTo(w * 0.62, h - 4); ctx.stroke();
  const left = [], right = [];
  if (o.stall) left.push(['STALL', AB.red]);
  if (s.warn) left.push([s.warn, AB.red]);
  if (!fm.onGround && fm.gearPos < 0.98 && o.agl < 800 && fm.ctl.throttle < 0.3 && o.vs < 0) left.push(['L/G GEAR NOT DOWN', AB.red]);
  if (fm.fuel < fm.ac.fuel * 0.08) left.push(['FUEL LO LVL', AB.amber]);
  if (fm.parkingBrake) left.push(['PARK BRK', AB.green]);
  if (fm.spoiler > 0.05) left.push([fm.onGround ? 'GND SPLRS' : 'SPEED BRK', fm.onGround || fm.ctl.throttle < 0.5 ? AB.green : AB.amber]);
  else if (fm.spoilersArmed) left.push(['GND SPLRS ARMED', AB.green]);
  if (s.ap && s.ap.appArmed) right.push(['ILS APPR', AB.green]);
  if (s.ap && s.ap.at) right.push(['A/THR', AB.green]);
  const gtxt = fm.gearPos > 0.98 ? 'LDG GEAR DN' : fm.gearPos > 0.02 ? 'L/G TRANSIT' : '';
  if (gtxt) right.push([gtxt, fm.gearPos > 0.98 ? AB.green : AB.amber]);
  const lh = fs * 1.25;
  left.slice(0, Math.max(1, Math.floor((h - my - 4) / lh))).forEach(([m, c], i) => txt(ctx, m, w * 0.04, my + lh * (i + 0.65), fs * 0.95, c, 'left', 700));
  right.slice(0, Math.max(1, Math.floor((h - my - 4) / lh))).forEach(([m, c], i) => txt(ctx, m, w * 0.65, my + lh * (i + 0.65), fs * 0.95, c, 'left', 700));
  // status line: TAT / GW
  txt(ctx, `TAT ${o.oat >= 0 ? '+' : ''}${Math.round(o.oat)}°C`, w * 0.04, 10, fs * 0.8, AB.green, 'left');
  txt(ctx, `GW ${Math.round(fm.mass / 100) * 100} KG`, w * 0.97, 10, fs * 0.8, AB.green, 'right');
}

// ================================================================== GA six-pack
const GA = { face: '#0b0b0c', panel: '#26282c', plate: '#17181a', white: '#f1f1ee', orange: '#ff8c1a', sky: '#3d8fd6', ground: '#86562c', green: '#29c14a', yellow: '#f0d21e', red: '#e8312b' };
const sixCache = new WeakMap();

function plate(ctx, x, y, r) {
  ctx.fillStyle = GA.plate; const p = r * 1.12;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - p, y - p, p * 2, p * 2, r * 0.18) : ctx.rect(x - p, y - p, p * 2, p * 2); ctx.fill();
  ctx.fillStyle = '#3a3c40';
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.arc(x + dx * p * 0.84, y + dy * p * 0.84, Math.max(1.5, r * 0.045), 0, 7); ctx.fill(); }
  ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(x, y, r * 1.03, 0, 7); ctx.fill();
  ctx.fillStyle = GA.face; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
function ticks(ctx, x, y, r, a0, a1, n, len, lw, every = 1, longLen = len) {
  ctx.strokeStyle = GA.white;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n), L = i % every === 0 ? longLen : len;
    ctx.lineWidth = i % every === 0 ? lw * 1.5 : lw;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * (r - L), y + Math.sin(a) * (r - L)); ctx.stroke();
  }
}
function needle(ctx, x, y, a, len, wid, col = GA.white, tail = 0.18) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-len * tail, -wid); ctx.lineTo(len * 0.86, -wid * 0.6); ctx.lineTo(len, 0); ctx.lineTo(len * 0.86, wid * 0.6); ctx.lineTo(-len * tail, wid); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, wid * 1.3), 0, 7); ctx.fill();
}
// ASI scale: 0 at 12 o'clock, clockwise; returns angle
const asiMax = (ac) => Math.ceil((ac.perf.vmo * 1.25) / 20) * 20;
const asiA = (v, max) => -Math.PI / 2 + clamp(v / max, 0, 1) * Math.PI * 1.85;
const vsiA = (v) => Math.PI + clamp(v / 2000, -1, 1) * Math.PI * 0.92;

// static faces (everything that does not move) are rendered once per size into an offscreen canvas
function sixPackLayout(w, h) {
  const cw = w / 3, ch = h / 2, r = Math.min(cw * 0.42, ch * 0.44);
  const c = (i, j) => [cw * (i + 0.5), ch * (j + 0.5)];
  return { r, asi: c(0, 0), ai: c(1, 0), alt: c(2, 0), tc: c(0, 1), hi: c(1, 1), vsi: c(2, 1) };
}
function sixPackStatic(canvas, w, h, ac) {
  const dpr = canvas.width / Math.max(1, w);
  const key = `${canvas.width}x${canvas.height}:${ac.id}`;
  const hit = sixCache.get(canvas);
  if (hit && hit.key === key) return hit.layer;
  const layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
  const ctx = layer.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = sixPackLayout(w, h), r = L.r, fs = Math.max(7, r * 0.17);
  ctx.fillStyle = GA.panel; ctx.fillRect(0, 0, w, h);
  for (const k of ['asi', 'ai', 'alt', 'tc', 'hi', 'vsi']) plate(ctx, L[k][0], L[k][1], r);
  // airspeed
  { const [x, y] = L.asi, max = asiMax(ac);
    ticks(ctx, x, y, r * 0.95, asiA(0, max), asiA(max, max), max / 5, r * 0.08, 1, 2, r * 0.15);
    for (let v = 40; v <= max; v += 20) { const a = asiA(v, max); txt(ctx, v, x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, fs, GA.white, 'center', 700); }
    txt(ctx, 'AIRSPEED', x, y - r * 0.3, fs * 0.6, GA.white); txt(ctx, 'KNOTS', x, y + r * 0.3, fs * 0.65, GA.white); }
  // altimeter
  { const [x, y] = L.alt;
    ticks(ctx, x, y, r * 0.95, -Math.PI / 2, Math.PI * 1.5, 50, r * 0.08, 1, 5, r * 0.16);
    for (let d = 0; d < 10; d++) { const a = -Math.PI / 2 + d / 10 * Math.PI * 2; txt(ctx, d, x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, fs * 1.15, GA.white, 'center', 700); }
    txt(ctx, 'ALT', x, y - r * 0.3, fs * 0.7, GA.white); txt(ctx, '100 FEET', x, y + r * 0.42, fs * 0.55, GA.white);
    box(ctx, x + r * 0.12, y - fs * 0.5, r * 0.4, fs, '#555', '#000', 1); txt(ctx, '29.92', x + r * 0.32, y, fs * 0.5, GA.white); }
  // vertical speed
  { const [x, y] = L.vsi;
    ticks(ctx, x, y, r * 0.95, vsiA(-2000), vsiA(2000), 40, r * 0.07, 1, 5, r * 0.15);
    for (const v of [5, 10, 15, 20]) for (const sg of v === 20 ? [1] : [1, -1]) { const a = vsiA(sg * v * 100) + (v === 20 ? Math.PI * 0.04 : 0); txt(ctx, v, x + Math.cos(a) * r * 0.67, y + Math.sin(a) * r * 0.67, fs, GA.white, 'center', 700); }
    txt(ctx, '0', x - r * 0.66, y, fs, GA.white, 'center', 700);
    txt(ctx, 'UP', x - r * 0.42, y - r * 0.2, fs * 0.6, GA.white); txt(ctx, 'DN', x - r * 0.42, y + r * 0.2, fs * 0.6, GA.white);
    txt(ctx, 'VERTICAL SPEED', x + r * 0.12, y - r * 0.2, fs * 0.45, GA.white); txt(ctx, '100 FT/MIN', x + r * 0.12, y + r * 0.2, fs * 0.45, GA.white); }
  // turn coordinator face
  { const [x, y] = L.tc;
    ctx.strokeStyle = GA.white; ctx.lineWidth = Math.max(2, r * 0.05);
    for (const a of [0, Math.PI, 20 * D2R, Math.PI - 20 * D2R]) { ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); ctx.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); ctx.stroke(); }
    txt(ctx, 'L', x - r * 0.72, y + r * 0.45, fs, GA.white, 'center', 700); txt(ctx, 'R', x + r * 0.72, y + r * 0.45, fs, GA.white, 'center', 700);
    txt(ctx, 'TURN COORDINATOR', x, y - r * 0.55, fs * 0.5, GA.white); txt(ctx, '2 MIN', x, y + r * 0.82, fs * 0.55, GA.white);
    txt(ctx, 'NO PITCH INFORMATION', x, y + r * 0.28, fs * 0.38, '#9a9a9a'); }
  // heading indicator case marks
  { const [x, y] = L.hi;
    ctx.fillStyle = GA.white;
    for (let k = 1; k < 8; k++) { if (k === 4) continue; const a = -Math.PI / 2 + k * Math.PI / 4; ctx.save(); ctx.translate(x + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98); ctx.rotate(a + Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-3, -6); ctx.lineTo(3, -6); ctx.closePath(); ctx.fill(); ctx.restore(); } }
  sixCache.set(canvas, { key, layer });
  return layer;
}

export function drawSixPack(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const o = s.out, fm = s.fm, ac = fm.ac, ap = s.ap;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(sixPackStatic(canvas, w, h, ac), 0, 0); ctx.restore();
  const L = sixPackLayout(w, h), r = L.r, fs = Math.max(7, r * 0.17);
  // ---- airspeed: colour arcs (weight dependent) + needle
  { const [x, y] = L.asi, max = asiMax(ac), vs = s.vspeeds;
    if (vs) {
      const vne = ac.perf.vmo, vno = vne * 0.79, vfe = vs.vs0 * 1.75;
      const arc = (v0, v1, col, rr, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, rr, asiA(v0, max), asiA(v1, max)); ctx.stroke(); };
      arc(vs.vs0, vfe, GA.white, r * 0.8, r * 0.05);
      arc(vs.vs1, vno, GA.green, r * 0.88, r * 0.07);
      arc(vno, vne, GA.yellow, r * 0.88, r * 0.07);
      const a = asiA(vne, max); ctx.strokeStyle = GA.red; ctx.lineWidth = r * 0.04; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); ctx.lineTo(x + Math.cos(a) * r * 0.96, y + Math.sin(a) * r * 0.96); ctx.stroke();
    }
    needle(ctx, x, y, asiA(o.ias, max), r * 0.85, r * 0.045); }
  // ---- attitude indicator
  { const [x, y] = L.ai, ri = r * 0.8, ppd = ri / 25;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, 7); ctx.clip();
    ctx.translate(x, y); ctx.rotate(-o.roll * D2R);
    // outer bank ring rotates with the card (sky/ground halves)
    ctx.fillStyle = GA.sky; ctx.fillRect(-r, -r, 2 * r, r); ctx.fillStyle = GA.ground; ctx.fillRect(-r, 0, 2 * r, r);
    ctx.strokeStyle = GA.white; ctx.lineWidth = 1.5;
    for (const a of [-60, -30, -20, -10, 10, 20, 30, 60]) { const t = (a - 90) * D2R; ctx.beginPath(); ctx.moveTo(Math.cos(t) * r * 0.82, Math.sin(t) * r * 0.82); ctx.lineTo(Math.cos(t) * r * (Math.abs(a) % 30 ? 0.92 : 0.97), Math.sin(t) * r * (Math.abs(a) % 30 ? 0.92 : 0.97)); ctx.stroke(); }
    ctx.fillStyle = GA.white; ctx.beginPath(); ctx.moveTo(0, -r * 0.82); ctx.lineTo(-r * 0.06, -r * 0.95); ctx.lineTo(r * 0.06, -r * 0.95); ctx.closePath(); ctx.fill();
    // inner pitch card
    ctx.beginPath(); ctx.arc(0, 0, ri, 0, 7); ctx.clip();
    const pOff = clamp(o.pitch, -40, 40) * ppd;
    ctx.fillStyle = GA.sky; ctx.fillRect(-r, -r * 2 + pOff, 2 * r, r * 2); ctx.fillStyle = GA.ground; ctx.fillRect(-r, pOff, 2 * r, r * 2);
    ctx.strokeStyle = GA.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r, pOff); ctx.lineTo(r, pOff); ctx.stroke();
    ctx.lineWidth = 1.3;
    for (const p of [-20, -10, -5, 5, 10, 20]) { const yy = pOff - p * ppd, lw = Math.abs(p) === 5 ? ri * 0.15 : ri * 0.3; ctx.beginPath(); ctx.moveTo(-lw, yy); ctx.lineTo(lw, yy); ctx.stroke(); if (Math.abs(p) >= 10) { txt(ctx, Math.abs(p), -lw - fs * 0.6, yy, fs * 0.6, GA.white); txt(ctx, Math.abs(p), lw + fs * 0.6, yy, fs * 0.6, GA.white); } }
    ctx.restore();
    // fixed bank index + orange aircraft symbol
    ctx.fillStyle = GA.orange; ctx.beginPath(); ctx.moveTo(x, y - r * 0.8); ctx.lineTo(x - r * 0.06, y - r * 0.68); ctx.lineTo(x + r * 0.06, y - r * 0.68); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = GA.orange; ctx.lineWidth = Math.max(2.5, r * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - r * 0.55, y); ctx.lineTo(x - r * 0.2, y); ctx.lineTo(x - r * 0.1, y + r * 0.08); ctx.moveTo(x + r * 0.55, y); ctx.lineTo(x + r * 0.2, y); ctx.lineTo(x + r * 0.1, y + r * 0.08); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.fillStyle = GA.orange; ctx.beginPath(); ctx.arc(x, y, r * 0.045, 0, 7); ctx.fill(); }
  // ---- altimeter needles
  { const [x, y] = L.alt, a = Math.max(0, o.alt);
    needle(ctx, x, y, -Math.PI / 2 + (a % 100000) / 100000 * Math.PI * 2, r * 0.9, r * 0.015, GA.white, 0);
    needle(ctx, x, y, -Math.PI / 2 + (a % 10000) / 10000 * Math.PI * 2, r * 0.52, r * 0.07);
    needle(ctx, x, y, -Math.PI / 2 + (a % 1000) / 1000 * Math.PI * 2, r * 0.85, r * 0.04); }
  // ---- turn coordinator
  { const [x, y] = L.tc;
    const yawRate = fm.w ? fm.w[2] * R2D : (o.tas > 30 ? 1091 * Math.tan(o.roll * D2R) / o.tas : 0);
    const tilt = clamp(yawRate / 3, -1.6, 1.6) * 20 * D2R;
    ctx.save(); ctx.translate(x, y - r * 0.05); ctx.rotate(tilt);
    ctx.strokeStyle = GA.white; ctx.fillStyle = GA.white; ctx.lineWidth = Math.max(2.5, r * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.62, 0); ctx.lineTo(r * 0.62, 0); ctx.moveTo(0, -r * 0.16); ctx.lineTo(0, -r * 0.02); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.09, 0, 7); ctx.fill(); ctx.lineCap = 'butt';
    ctx.restore();
    // inclinometer (ball)
    const tc = [x, y - r * 0.45], tr = r * 1.0, half = 0.3;
    ctx.strokeStyle = '#e8e4d0'; ctx.lineWidth = r * 0.16; ctx.beginPath(); ctx.arc(tc[0], tc[1], tr, Math.PI / 2 - half, Math.PI / 2 + half); ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    for (const sg of [-1, 1]) { const a = Math.PI / 2 + sg * 0.07; ctx.beginPath(); ctx.moveTo(tc[0] + Math.cos(a) * (tr - r * 0.09), tc[1] + Math.sin(a) * (tr - r * 0.09)); ctx.lineTo(tc[0] + Math.cos(a) * (tr + r * 0.09), tc[1] + Math.sin(a) * (tr + r * 0.09)); ctx.stroke(); }
    const ba = Math.PI / 2 - clamp(o.beta * 0.05, -half * 0.85, half * 0.85);
    ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.arc(tc[0] + Math.cos(ba) * tr, tc[1] + Math.sin(ba) * tr, r * 0.065, 0, 7); ctx.fill(); }
  // ---- heading indicator: rotating card
  { const [x, y] = L.hi, rc = r * 0.9;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-o.hdg * D2R);
    ctx.strokeStyle = GA.white;
    for (let d = 0; d < 360; d += 5) { const a = (d - 90) * D2R, L2 = d % 10 === 0 ? r * 0.13 : r * 0.07; ctx.lineWidth = d % 10 === 0 ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(Math.cos(a) * rc, Math.sin(a) * rc); ctx.lineTo(Math.cos(a) * (rc - L2), Math.sin(a) * (rc - L2)); ctx.stroke(); }
    for (let d = 0; d < 360; d += 30) { const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10); ctx.save(); ctx.rotate(d * D2R); txt(ctx, lab, 0, -rc + r * 0.27, fs * (lab.length === 1 && isNaN(+lab) ? 1.2 : 0.95), GA.white, 'center', 700); ctx.restore(); }
    if (ap) { ctx.save(); ctx.rotate(ap.hdg * D2R); ctx.fillStyle = GA.orange; ctx.fillRect(-r * 0.07, -rc - 1, r * 0.14, r * 0.09); ctx.restore(); }
    ctx.restore();
    ctx.fillStyle = GA.orange; ctx.beginPath(); ctx.moveTo(x, y - rc + r * 0.02); ctx.lineTo(x - r * 0.05, y - rc - r * 0.09); ctx.lineTo(x + r * 0.05, y - rc - r * 0.09); ctx.closePath(); ctx.fill();
    // aircraft silhouette
    ctx.strokeStyle = GA.orange; ctx.lineWidth = Math.max(2, r * 0.045); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(x, y - r * 0.32); ctx.lineTo(x, y + r * 0.3); ctx.moveTo(x - r * 0.28, y - r * 0.06); ctx.lineTo(x + r * 0.28, y - r * 0.06); ctx.moveTo(x - r * 0.11, y + r * 0.26); ctx.lineTo(x + r * 0.11, y + r * 0.26); ctx.stroke(); ctx.lineCap = 'butt'; }
  // ---- vertical speed needle
  { const [x, y] = L.vsi; needle(ctx, x, y, vsiA(o.vs), r * 0.85, r * 0.045); }
  if (o.stall) txt(ctx, 'STALL', L.ai[0], L.ai[1] + r * 0.5, fs * 1.3, GA.red, 'center', 800);
}

// ================================================================== GA engine strip (tachometer + bar gauges)
const KG_PER_GAL = 2.72; // avgas
function bar(ctx, x, y, w, hh, label, val, min, max, bands, valTxt, fs) {
  txt(ctx, label, x, y - hh * 0.95, fs * 0.8, '#cfd3d8', 'left', 700);
  txt(ctx, valTxt, x + w, y - hh * 0.95, fs * 0.9, GA.white, 'right', 700);
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, hh);
  for (const [a, b, col] of bands) { const x0 = x + w * clamp((a - min) / (max - min), 0, 1), x1 = x + w * clamp((b - min) / (max - min), 0, 1); ctx.fillStyle = col; ctx.fillRect(x0, y + hh * 0.6, x1 - x0, hh * 0.4); }
  const px = x + w * clamp((val - min) / (max - min), 0, 1);
  ctx.fillStyle = GA.white; ctx.beginPath(); ctx.moveTo(px, y + hh * 0.62); ctx.lineTo(px - 5, y - 1); ctx.lineTo(px + 5, y - 1); ctx.closePath(); ctx.fill();
}
export function drawEngineStrip(canvas, s) {
  const { ctx, w, h } = setup(canvas);
  if (w < 10) return;
  const fm = s.fm, ac = fm.ac, e = fm.engines[0];
  ctx.fillStyle = GA.panel; ctx.fillRect(0, 0, w, h);
  const maxRpm = ac.id === 'sr22' ? 2500 : 2700;
  const pf = e.running ? clamp((e.n1 - e.idle) / (100 - e.idle), 0, 1) : 0;
  const rpm = e.running ? (e.n1 / 100) * maxRpm : 0;
  // ---- tachometer
  const r = Math.min(w * 0.2, h * 0.36), x = r * 1.2 + 4, y = h * 0.42;
  plate(ctx, x, y, r);
  const fs = Math.max(8, r * 0.19);
  const ta = (v) => Math.PI * 0.75 + clamp(v / 3500, 0, 1) * Math.PI * 1.5;
  ticks(ctx, x, y, r * 0.95, ta(0), ta(3500), 35, r * 0.07, 1, 5, r * 0.15);
  for (let v = 0; v <= 35; v += 5) { const a = ta(v * 100); txt(ctx, v, x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, fs, GA.white, 'center', 700); }
  ctx.strokeStyle = GA.green; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.arc(x, y, r * 0.86, ta(maxRpm - 600), ta(maxRpm)); ctx.stroke();
  const ra = ta(maxRpm); ctx.strokeStyle = GA.red; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.moveTo(x + Math.cos(ra) * r * 0.78, y + Math.sin(ra) * r * 0.78); ctx.lineTo(x + Math.cos(ra) * r * 0.97, y + Math.sin(ra) * r * 0.97); ctx.stroke();
  txt(ctx, 'RPM', x, y - r * 0.3, fs * 0.7, GA.white); txt(ctx, 'x100', x, y + r * 0.32, fs * 0.55, GA.white);
  box(ctx, x - r * 0.38, y + r * 0.5, r * 0.76, fs * 1.1, '#555', '#000', 1); txt(ctx, String(Math.round(rpm / 10) * 10), x, y + r * 0.5 + fs * 0.55, fs * 0.8, GA.white, 'center', 700);
  needle(ctx, x, y, ta(rpm), r * 0.85, r * 0.045);
  // ---- bar gauges. The flight model doesn't simulate oil, so oil temperature/pressure follow engine power.
  const bx = x + r * 1.3, bw = w - bx - 8, rows = 5, rowH = (h - 16) / rows, bh = Math.max(5, rowH * 0.22), bfs = clamp(rowH * 0.3, 8, 13);
  const capGal = ac.fuel / 2 / KG_PER_GAL, tankGal = fm.fuel / 2 / KG_PER_GAL;
  const ffGph = e.ff * 3600 / KG_PER_GAL;
  const oilT = e.running ? 140 + 70 * pf : 70, oilP = e.running ? 52 + 30 * pf : 0, egtF = e.egt * 9 / 5 + 32;
  const yr = (i) => 8 + rowH * (i + 0.62);
  bar(ctx, bx, yr(0), bw * 0.47, bh, 'FUEL L', tankGal, 0, capGal, [[0, capGal * 0.12, GA.red], [capGal * 0.12, capGal * 0.25, GA.yellow], [capGal * 0.25, capGal, GA.green]], tankGal.toFixed(0) + ' gal', bfs);
  bar(ctx, bx + bw * 0.53, yr(0), bw * 0.47, bh, 'FUEL R', tankGal, 0, capGal, [[0, capGal * 0.12, GA.red], [capGal * 0.12, capGal * 0.25, GA.yellow], [capGal * 0.25, capGal, GA.green]], tankGal.toFixed(0) + ' gal', bfs);
  bar(ctx, bx, yr(1), bw, bh, 'FUEL FLOW', ffGph, 0, ac.id === 'sr22' ? 30 : 16, [[0, ac.id === 'sr22' ? 30 : 16, GA.green]], ffGph.toFixed(1) + ' GPH', bfs);
  bar(ctx, bx, yr(2), bw, bh, 'OIL TEMP', oilT, 50, 260, [[100, 245, GA.green], [245, 260, GA.red]], Math.round(oilT) + ' °F', bfs);
  bar(ctx, bx, yr(3), bw, bh, 'OIL PRESS', oilP, 0, 115, [[0, 20, GA.red], [20, 50, GA.yellow], [50, 90, GA.green], [90, 115, GA.red]], Math.round(oilP) + ' PSI', bfs);
  bar(ctx, bx, yr(4), bw * 0.6, bh, 'EGT', egtF, 1000, 1700, [[1000, 1700, '#5a6068']], Math.round(egtF) + ' °F', bfs);
  // flaps / trim
  const fl = Math.abs(fm.flap - fm.flapLevels[fm.flapIndex].flap) > 0.02;
  txt(ctx, 'FLAPS ' + fm.flapLabel, bx + bw, yr(4) - bh * 0.2, bfs, fl ? GA.yellow : GA.white, 'right', 700);
  txt(ctx, 'TRIM ' + (fm.trim * 10).toFixed(1), bx + bw, yr(4) + bh * 1.6, bfs * 0.85, '#cfd3d8', 'right', 700);
  // annunciators
  const ann = [];
  if (fm.fuel < ac.fuel * 0.08) ann.push(['LOW FUEL', GA.yellow]);
  if (!e.running) ann.push(['ENGINE OUT', GA.red]);
  if (fm.parkingBrake) ann.push(['PARK BRAKE', GA.yellow]);
  if (s.out.stall) ann.push(['STALL', GA.red]);
  ann.slice(0, 2).forEach(([m, c], i) => { const ax = 4 + i * (r * 1.2 + 2), aw2 = r * 1.15, ay = h - fs * 1.3 - 4; box(ctx, ax, ay, aw2, fs * 1.3, c, '#000', 1.2); txt(ctx, m, ax + aw2 / 2, ay + fs * 0.65, fs * 0.6, c, 'center', 700); });
}
