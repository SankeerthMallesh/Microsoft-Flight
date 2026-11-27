// Flat, textured runway surfaces. Photogrammetry (Google 3D tiles) is often lumpy on flat
// ground, so the tiles are clipped out under each runway and replaced by a flat strip at the
// exact height the flight model uses (database elevation + measured geoid offset).
const C = () => window.Cesium;
const RE = 6371008.8, FT = 0.3048;

export function offsetLL(lat, lon, b, d) {
  const dl = d / RE;
  const la2 = Math.asin(Math.sin(lat) * Math.cos(dl) + Math.cos(lat) * Math.sin(dl) * Math.cos(b));
  const lo2 = lon + Math.atan2(Math.sin(b) * Math.sin(dl) * Math.cos(lat), Math.cos(dl) - Math.sin(lat) * Math.sin(la2));
  return [la2, lo2];
}
function bearing(la1, lo1, la2, lo2) {
  return Math.atan2(Math.sin(lo2 - lo1) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1));
}
function dist(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(a)));
}

const PAD = 45;       // paved overrun / blast pad beyond each end (m)
const SHOULDER = 7.5; // paved shoulder each side (m)
const CLIP_SIDE = 6;  // tiles are clipped this far outside the runway edge
const CLIP_END = 38;

// geometry of one runway from an airport record row
export function runwayInfo(r) {
  const D = Math.PI / 180;
  const la1 = r[1] * D, lo1 = r[2] * D, la2 = r[5] * D, lo2 = r[6] * D;
  const L = dist(la1, lo1, la2, lo2);
  return { la1, lo1, la2, lo2, L, hdg: bearing(la1, lo1, la2, lo2), w: Math.max(18, (r[9] || 150) * FT), e1: r[3] * FT, e2: r[7] * FT, id1: r[0], id2: r[4] };
}

function paintRunway(info) {
  const W = 512, H = 4096;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const total = info.L + 2 * PAD, across = info.w + 2 * SHOULDER;
  const pxA = H / total, pxX = W / across;            // px per metre along / across
  const X = (m) => (m + across / 2) * pxX;             // metres from centreline -> x
  const Y = (m) => H - (m + PAD) * pxA;                // metres from low-end threshold -> y (low end at bottom)
  // shoulders + asphalt
  g.fillStyle = '#56534c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3a3b3d'; g.fillRect(X(-info.w / 2), 0, info.w * pxX, H);
  // texture noise: patches, cracks, tyre marks in the touchdown zones
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W, y = Math.random() * H, s = 2 + Math.random() * 14;
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + Math.random() * 0.04})`;
    g.fillRect(x, y, s, s * (0.5 + Math.random() * 3));
  }
  g.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < 40; i++) { const x = Math.random() * W; g.fillRect(x, 0, 1 + Math.random() * 2, H); }
  for (const end of [0, 1]) {
    for (let i = 0; i < 90; i++) {
      const along = 150 + Math.random() * 700, side = (Math.random() - 0.5) * 12;
      const y = Y(end ? info.L - along : along);
      g.fillStyle = `rgba(10,10,10,${0.12 + Math.random() * 0.2})`;
      g.fillRect(X(side) - 3, y - 60 * Math.random() * pxA, 4 + Math.random() * 5, (20 + Math.random() * 80) * pxA);
    }
  }
  // overrun chevrons (yellow)
  g.strokeStyle = 'rgba(201,162,39,0.7)'; g.lineWidth = Math.max(1.5, 0.9 * pxX);
  for (const end of [0, 1]) for (let k = 0; k < 3; k++) {
    const yA = end ? Y(info.L + 8 + k * 12) : Y(-8 - k * 12), dy = (end ? -1 : 1) * 10 * pxA;
    g.beginPath(); g.moveTo(X(-info.w / 2 + 2), yA + dy); g.lineTo(X(0), yA); g.lineTo(X(info.w / 2 - 2), yA + dy); g.stroke();
  }
  const white = 'rgba(236,236,230,0.92)';
  g.fillStyle = white;
  const rectM = (x0, y0, wm, lm) => { const a = Y(y0), b = Y(y0 + lm); g.fillRect(X(x0), Math.min(a, b), wm * pxX, Math.max(2, Math.abs(a - b))); };
  // edge stripes and end bars
  rectM(-info.w / 2 + 0.5, 0, 0.9, info.L); rectM(info.w / 2 - 1.4, 0, 0.9, info.L);
  rectM(-info.w / 2, 0, info.w, 1.8); rectM(-info.w / 2, info.L - 1.8, info.w, 1.8);
  // threshold piano keys + numbers + aiming point + touchdown zone, for both ends
  const half = info.w >= 58 ? 8 : info.w >= 43 ? 6 : info.w >= 28 ? 4 : 3, keyW = 1.8;
  const keyGap = Math.max(0.6, (info.w / 2 - 3 - 1.5 - half * keyW) / Math.max(1, half - 1));
  for (const end of [0, 1]) {
    const A = (d, l) => (end ? info.L - d - l : d);    // metres from this end -> along coordinate
    for (const sgn of [-1, 1]) for (let k = 0; k < half; k++) {
      const x = sgn > 0 ? 1.5 + k * (keyW + keyGap) : -1.5 - keyW - k * (keyW + keyGap);
      rectM(x, A(6, 30), keyW, 30);
    }
    // aiming point (400 m) and touchdown-zone bars
    if (info.L > 1500) {
      for (const s of [-1, 1]) rectM(s > 0 ? 4 : -4 - 9, A(400, 45), 9, 45);
      for (const [d, n] of [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]]) {
        if (d + 25 > info.L / 2) continue;
        for (const s of [-1, 1]) for (let i = 0; i < n; i++) rectM(s > 0 ? 4 + i * 3 : -4 - 1.8 - i * 3, A(d, 22.5), 1.8, 22.5);
      }
    }
    // runway designator (reads correctly from the approach end)
    const id = (end ? info.id2 : info.id1) || '';
    const yC = Y(end ? info.L - 62 : 62);
    g.save(); g.translate(X(0), yC); if (end) g.rotate(Math.PI);
    g.scale(pxX, pxA);
    const m = /^(\d+)([LRC]?)$/.exec(id.trim()) || [null, id.trim(), ''];
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = white;
    g.font = 'bold 9px "Roboto Mono", monospace';
    g.save(); g.scale(1.15, 1.9);
    g.fillText(m[1].padStart(2, '0'), 0, m[2] ? -3.6 : 0);
    if (m[2]) g.fillText(m[2], 0, 4.2); // L/R/C sits nearer the threshold
    g.restore(); g.restore();
  }
  // centreline dashes (36 m dash / 24 m gap), between the designators
  for (let d = 105; d < info.L - 105; d += 60) rectM(-0.45, d, 0.9, Math.min(36, info.L - 105 - d));
  return c;
}

// Build the flat runway strips for one airport. sampleTile(lat, lon) gives the 3D-tile height
// (or undefined) and is used to blend the shoulders into the surrounding scenery.
export function buildAirportRunways(ap, geoid, sampleTile, plane = null) {
  const Cesium = C();
  const prims = [], clips = [];
  for (const r of ap.r) {
    const info = runwayInfo(r);
    if (!(info.L > 100)) continue;
    const perp = info.hdg + Math.PI / 2;
    // height along the centreline: database slope, or the airport plane shared with taxiways/aprons
    const hAt = plane
      ? (along) => { const [la, lo] = offsetLL(info.la1, info.lo1, info.hdg, along); return plane(la, lo) + 0.03; }
      : (along) => info.e1 + (info.e2 - info.e1) * Math.max(0, Math.min(1, along / info.L)) + geoid + 0.03;
    const SK = 6; // skirt that slopes from the shoulder down/up into the surrounding tiles (hides clip edges)
    const cols = [-(info.w / 2 + SHOULDER + SK), -(info.w / 2 + SHOULDER), -info.w / 2, 0, info.w / 2, info.w / 2 + SHOULDER, info.w / 2 + SHOULDER + SK];
    const across = info.w + 2 * SHOULDER, total = info.L + 2 * PAD;
    // rows: blend row at each pad end, a flat row just inside the clip edge, then <=150 m spacing along the runway
    const n = Math.max(2, Math.ceil(info.L / 150));
    const rows = [-PAD, -CLIP_END + 2, ...Array.from({ length: n + 1 }, (_, k) => (info.L * k) / n), info.L + CLIP_END - 2, info.L + PAD];
    const nSeg = rows.length - 1;
    const pos = [], nrm = [], st = [], idx = [];
    for (let i = 0; i <= nSeg; i++) {
      const along = rows[i];
      const [cla, clo] = offsetLL(info.la1, info.lo1, info.hdg, along);
      const hc = hAt(along);
      const endRow = i === 0 || i === nSeg;
      // one tile sample per side (at the skirt) per row; end rows are sampled across the full width
      const ll = cols.map((cx) => offsetLL(cla, clo, perp, cx));
      const tile = (j) => { if (!sampleTile) return undefined; const t = sampleTile(ll[j][0], ll[j][1]); return t !== undefined && isFinite(t) ? t : undefined; };
      const side = [tile(0), tile(cols.length - 1)];
      for (let j = 0; j < cols.length; j++) {
        const [la, lo] = ll[j];
        let h = hc;
        const skirt = j === 0 || j === cols.length - 1, sh = j === 1 || j === cols.length - 2;
        const t = endRow && !skirt && !sh ? tile(j) : (skirt || sh) ? side[j < cols.length / 2 ? 0 : 1] : undefined;
        if (t !== undefined) {
          const lim = skirt || endRow ? 15 : 2;
          h = Math.max(hc - lim, Math.min(hc + lim, t - (skirt ? 0.4 : 0.05)));
        }
        const p = Cesium.Cartesian3.fromRadians(lo, la, h);
        pos.push(p.x, p.y, p.z);
        const n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new Cesium.Cartesian3());
        nrm.push(n.x, n.y, n.z);
        st.push(Math.max(0.002, Math.min(0.998, (cols[j] + across / 2) / across)), (along + PAD) / total);
      }
    }
    const nc = cols.length;
    for (let i = 0; i < nSeg; i++) for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nrm) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      },
      indices: new Uint32Array(idx), primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(pos),
    });
    const material = Cesium.Material.fromType('Image', { image: paintRunway(info) });
    prims.push(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.MaterialAppearance({ material, faceForward: true, closed: false, translucent: false }),
      asynchronous: false, shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    }));
    // clip the 3D tiles under the strip
    const ring = [[-CLIP_END, -1], [info.L + CLIP_END, -1], [info.L + CLIP_END, 1], [-CLIP_END, 1]].map(([along, s]) => {
      const [cla, clo] = offsetLL(info.la1, info.lo1, info.hdg, along);
      const [la, lo] = offsetLL(cla, clo, perp, s * (info.w / 2 + CLIP_SIDE));
      return Cesium.Cartesian3.fromRadians(lo, la, hAt(along));
    });
    clips.push(new Cesium.ClippingPolygon({ positions: ring }));
  }
  return { prims, clips };
}
