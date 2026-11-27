// 3D airport surroundings from OpenStreetMap: flat taxiways and aprons (replacing lumpy photogrammetry)
// plus extruded terminals, hangars, the control tower and other buildings where Google's tiles are flat.
const C = () => window.Cesium;
const RE = 6371008.8, FT = 0.3048, D2R = Math.PI / 180;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const osmCache = new Map();

export function airportBBox(ap, margin = 0.014) {
  let s = ap.la, n = ap.la, w = ap.lo, e = ap.lo;
  for (const r of ap.r) for (const [la, lo] of [[r[1], r[2]], [r[5], r[6]]]) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const mLo = margin / Math.max(0.2, Math.cos(ap.la * D2R));
  return [s - margin, w - mLo, n + margin, e + mLo];
}

const KEEP_TAGS = ['aeroway', 'building', 'height', 'building:levels', 'width', 'tower:type', 'name'];
function slim(elements) {
  const g = (geom) => geom.map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }));
  const tags = (t = {}) => { const o = {}; for (const k of KEEP_TAGS) if (t[k] != null) o[k] = t[k]; return o; };
  return elements.map((e) => e.type === 'relation'
    ? { type: 'relation', tags: tags(e.tags), members: (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => ({ role: 'outer', geometry: g(m.geometry) })) }
    : { type: e.type, tags: tags(e.tags), geometry: e.geometry ? g(e.geometry) : undefined });
}
function cacheGet(id) {
  try { const v = localStorage.getItem('openskies.osm.' + id); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function cachePut(id, elements) {
  try {
    const idx = JSON.parse(localStorage.getItem('openskies.osm.index') || '[]').filter((x) => x !== id);
    idx.push(id);
    while (idx.length > 8) { localStorage.removeItem('openskies.osm.' + idx.shift()); }
    localStorage.setItem('openskies.osm.' + id, JSON.stringify(elements));
    localStorage.setItem('openskies.osm.index', JSON.stringify(idx));
  } catch (e) { /* storage full: skip caching */ }
}
const lastFail = new Map();
export function fetchAirportOSM(ap) {
  if (osmCache.has(ap.i)) return osmCache.get(ap.i);
  const cached = cacheGet(ap.i);
  if (cached) { const p = Promise.resolve(cached); osmCache.set(ap.i, p); return p; }
  if (Date.now() - (lastFail.get(ap.i) || 0) < 30000) return Promise.resolve(null);
  const [s, w, n, e] = airportBBox(ap).map((v) => v.toFixed(5));
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:25];(way["aeroway"~"^(taxiway|taxilane|apron|terminal|hangar|tower)$"]${bb};relation["aeroway"="apron"]${bb};way["building"]${bb};);out tags geom;`;
  const p = (async () => {
    for (let round = 0; round < 2; round++) {
      for (const url of ENDPOINTS) {
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
          const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
          clearTimeout(t);
          if (!res.ok) continue;
          const j = await res.json();
          if (j && Array.isArray(j.elements)) { const el = slim(j.elements); cachePut(ap.i, el); return el; }
        } catch (err) { /* try next mirror */ }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return null;
  })();
  osmCache.set(ap.i, p);
  p.then((v) => { if (!v) { osmCache.delete(ap.i); lastFail.set(ap.i, Date.now()); } });
  return p;
}

// ---------------------------------------------------------------- local frame + airport plane
function makeFrame(ap, geoid) {
  const lat0 = ap.la * D2R, lon0 = ap.lo * D2R, cl = Math.cos(lat0);
  const toXY = (lat, lon) => [(lon - lon0) * cl * RE, (lat - lat0) * RE];
  // least-squares plane through runway end elevations (ridge-regularised for single runways)
  const pts = [];
  for (const r of ap.r) { pts.push([...toXY(r[1] * D2R, r[2] * D2R), r[3] * FT]); pts.push([...toXY(r[5] * D2R, r[6] * D2R), r[7] * FT]); }
  if (!pts.length) pts.push([0, 0, (ap.e || 0) * FT]);
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n, mz = pts.reduce((a, p) => a + p[2], 0) / n;
  let sxx = 1e3, syy = 1e3, sxy = 0, sxz = 0, syz = 0;
  for (const [x, y, z] of pts) { const dx = x - mx, dy = y - my, dz = z - mz; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz; }
  const det = sxx * syy - sxy * sxy;
  let b = (sxz * syy - syz * sxy) / det, c = (syz * sxx - sxz * sxy) / det;
  const g = Math.hypot(b, c); if (g > 0.02) { b *= 0.02 / g; c *= 0.02 / g; } // airports are nearly level
  const planeXY = (x, y) => mz + b * (x - mx) + c * (y - my) + geoid;
  return { toXY, planeXY, plane: (lat, lon) => { const [x, y] = toXY(lat, lon); return planeXY(x, y); } };
}

// ---------------------------------------------------------------- textures
function noise(g, W, H, n, a = 0.05) {
  for (let i = 0; i < n; i++) {
    const s = 1 + Math.random() * 5;
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * a})`;
    g.fillRect(Math.random() * W, Math.random() * H, s, s * (0.5 + Math.random() * 2));
  }
}
let texCache = null;
function textures() {
  if (texCache) return texCache;
  // taxiway: asphalt with continuous yellow centreline and light edge markings (128 px = full width, 512 px = 40 m)
  const t = document.createElement('canvas'); t.width = 128; t.height = 512;
  let g = t.getContext('2d');
  g.fillStyle = '#3e3f41'; g.fillRect(0, 0, 128, 512); noise(g, 128, 512, 900);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, 10, 512); g.fillRect(118, 0, 10, 512);
  g.fillStyle = '#d6a21e'; g.fillRect(62, 0, 4, 512);
  g.fillStyle = 'rgba(214,162,30,0.85)'; g.fillRect(9, 0, 2, 512); g.fillRect(13, 0, 2, 512); g.fillRect(113, 0, 2, 512); g.fillRect(117, 0, 2, 512);
  // apron: concrete slabs (256 px = 30 m)
  const a = document.createElement('canvas'); a.width = 256; a.height = 256;
  g = a.getContext('2d');
  g.fillStyle = '#8b8a85'; g.fillRect(0, 0, 256, 256); noise(g, 256, 256, 1600, 0.06);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(i * 64, j * 64, 64, 64); }
  g.fillStyle = 'rgba(40,40,40,0.45)'; for (let k = 0; k < 4; k++) { g.fillRect(k * 64, 0, 1, 256); g.fillRect(0, k * 64, 256, 1); }
  for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(30,30,30,${0.05 + Math.random() * 0.1})`; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 14, 3 + Math.random() * 8, Math.random() * 3, 0, 7); g.fill(); }
  texCache = { taxi: t, apron: a };
  return texCache;
}

// ---------------------------------------------------------------- geometry helpers
function ribbon(pts, halfW) {
  // pts: [[x,y]...] -> left/right offset polylines with mitred joins; ends extended to fill junctions
  const n = pts.length, L = [], R = [];
  const dir = (i) => { const a = pts[i], b = pts[i + 1]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  for (let i = 0; i < n; i++) {
    let t;
    if (i === 0) t = dir(0); else if (i === n - 1) t = dir(n - 2);
    else { const d0 = dir(i - 1), d1 = dir(i); t = [d0[0] + d1[0], d0[1] + d1[1]]; const l = Math.hypot(...t) || 1; t = [t[0] / l, t[1] / l]; }
    let k = 1;
    if (i > 0 && i < n - 1) { const d0 = dir(i - 1); k = 1 / Math.max(0.5, d0[0] * t[0] + d0[1] * t[1]); }
    const nx = -t[1] * halfW * k, ny = t[0] * halfW * k;
    let p = pts[i];
    if (i === 0) p = [p[0] - t[0] * halfW * 0.9, p[1] - t[1] * halfW * 0.9];
    if (i === n - 1) p = [p[0] + t[0] * halfW * 0.9, p[1] + t[1] * halfW * 0.9];
    L.push([p[0] + nx, p[1] + ny]); R.push([p[0] - nx, p[1] - ny]);
  }
  return { L, R };
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2));
  return Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy);
}
function scaleRing(r, d) {
  const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cy = r.reduce((a, p) => a + p[1], 0) / r.length;
  return r.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; const k = Math.max(0.2, (l + d) / l); return [cx + (x - cx) * k, cy + (y - cy) * k]; });
}
const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };

// ---------------------------------------------------------------- main builder
// opts.sampleTile(lat, lon) -> Google tile height; used to decide whether Google already has 3D buildings here
export function buildAirport3D(ap, geoid, elements, opts = {}) {
  const Cesium = C();
  const F = makeFrame(ap, geoid);
  const lat0 = ap.la * D2R, lon0 = ap.lo * D2R, cl = Math.cos(lat0);
  const fromXY = (x, y) => [lat0 + y / RE, lon0 + x / (RE * cl)];
  const cart = (x, y, dh = 0) => { const [la, lo] = fromXY(x, y); return Cesium.Cartesian3.fromRadians(lo, la, F.planeXY(x, y) + dh); };
  const up = (p) => Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new Cesium.Cartesian3());
  const tex = textures();
  const prims = [], clips = [], surfaces = { segs: [], rings: [] };
  // dark ground underlay just below the edges of clipped areas: where lumpy tiles sit above the flat
  // surfaces you would otherwise see through the cut edge
  const under = [];
  const underColor = Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#5f5a4f'));
  const addUnder = (ring, dh) => {
    try {
      under.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(ring.map(([x, y]) => cart(x, y, dh))), perPositionHeight: true, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
        attributes: { color: underColor },
      }));
    } catch (e) { /* ignore */ }
  };
  const ways = elements.filter((e) => e.type === 'way' && e.geometry && e.geometry.length >= 2);
  const xyOf = (geom) => geom.map((g) => F.toXY(g.lat * D2R, g.lon * D2R));
  const ringOk = (r) => r.length >= 4 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1;

  // ---- aprons (ways + multipolygon outer rings)
  const apronRings = [];
  for (const w of ways) if (w.tags?.aeroway === 'apron') { const r = xyOf(w.geometry); if (ringOk(r)) apronRings.push(r); }
  for (const rel of elements) if (rel.type === 'relation' && rel.tags?.aeroway === 'apron') for (const m of rel.members || []) if (m.role === 'outer' && m.geometry) { const r = xyOf(m.geometry); if (ringOk(r)) apronRings.push(r); }
  for (const r0 of apronRings) {
    const r = r0.slice(0, -1); if (r.length < 3 || ringArea(r) < 200) continue;
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    const ext = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    try {
      const geometry = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(r.map(([x, y]) => cart(x, y, -0.09))),
        perPositionHeight: true, vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
      });
      prims.push(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry }),
        appearance: new Cesium.MaterialAppearance({ material: Cesium.Material.fromType('Image', { image: tex.apron, repeat: new Cesium.Cartesian2(Math.max(1, ext[0] / 30), Math.max(1, ext[1] / 30)) }), faceForward: true }),
        asynchronous: true, shadows: Cesium.ShadowMode.RECEIVE_ONLY,
      }));
      clips.push(new Cesium.ClippingPolygon({ positions: scaleRing(r, -2.5).map(([x, y]) => cart(x, y)) }));
      addUnder(scaleRing(r, 7), -0.6);
      surfaces.rings.push(r);
    } catch (e) { /* bad ring */ }
  }

  // ---- taxiways / taxilanes (ribbons)
  let k = 0;
  for (const w of ways) {
    const a = w.tags?.aeroway; if (a !== 'taxiway' && a !== 'taxilane') continue;
    const pts = xyOf(w.geometry);
    let width = parseFloat(w.tags.width); if (!(width > 5 && width < 80)) width = a === 'taxilane' ? 15 : 23;
    const hw = width / 2;
    const { L, R } = ribbon(pts, hw + 1);
    const dh = -0.05 - (k++ % 8) * 0.004; // tiny per-way offsets avoid coplanar flicker where taxiways overlap
    const pos = [], nrm = [], st = [], idx = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (const [p, s] of [[L[i], 0], [R[i], 1]]) {
        const c = cart(p[0], p[1], dh); pos.push(c.x, c.y, c.z);
        const n = up(c); nrm.push(n.x, n.y, n.z); st.push(s, dist / 40);
      }
      if (i > 0) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); surfaces.segs.push([pts[i - 1], pts[i], hw + 2]); }
    }
    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nrm) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      },
      indices: new Uint32Array(idx), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(pos),
    });
    prims.push(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.MaterialAppearance({ material: Cesium.Material.fromType('Image', { image: tex.taxi }), faceForward: true }),
      asynchronous: false, shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    }));
    // clip slightly inside the drawn edge so no lumpy tile shows between
    const { L: cL, R: cR } = ribbon(pts, Math.max(2, hw - 2.5));
    clips.push(new Cesium.ClippingPolygon({ positions: [...cL, ...cR.slice().reverse()].map(([x, y]) => cart(x, y)) }));
    const { L: uL, R: uR } = ribbon(pts, hw + 7);
    addUnder([...uL, ...uR.slice().reverse()], -0.6);
  }

  if (under.length) prims.push(new Cesium.Primitive({ geometryInstances: under, appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true, shadows: Cesium.ShadowMode.RECEIVE_ONLY }));

  // ---- 3D buildings (only where Google's tiles have no real buildings)
  const blds = ways.filter((w) => (w.tags?.building || /^(terminal|hangar|tower)$/.test(w.tags?.aeroway || '')) && ringOk(xyOf(w.geometry)));
  let google3D = false;
  if (opts.sampleTile && blds.length) {
    const big = blds.map((w) => { const r = xyOf(w.geometry); const c = r.slice(0, -1).reduce((a, p) => [a[0] + p[0] / (r.length - 1), a[1] + p[1] / (r.length - 1)], [0, 0]); return { r, c, A: ringArea(r) }; })
      .filter((b) => b.A > 150 && pointInRing(b.c[0], b.c[1], b.r)).sort((x, y) => y.A - x.A).slice(0, 24);
    let tall = 0, n = 0;
    for (const b of big) {
      const [la, lo] = fromXY(b.c[0], b.c[1]); const t = opts.sampleTile(la, lo);
      if (t === undefined || !isFinite(t)) continue;
      n++; if (t - F.planeXY(b.c[0], b.c[1]) > 4.5) tall++;
    }
    google3D = n >= 4 && tall / n > 0.35;
  }
  const instances = [];
  let nb = 0;
  if (!google3D && opts.buildings !== false) {
    const pal = ['#d9d6cf', '#cfcac0', '#e3e0d8', '#bfbab0', '#d2cdc4', '#c8c9cb', '#e8e4da', '#b9b4aa'];
    for (const w of blds) {
      const r = xyOf(w.geometry).slice(0, -1); if (r.length < 3) continue;
      const A = ringArea(r); if (A < 12) continue;
      const t = w.tags, aw = t.aeroway, b = t.building;
      let h = parseFloat(t.height);
      if (!(h > 1)) {
        const lv = parseFloat(t['building:levels']);
        h = lv > 0 ? lv * 3.3 + 1 : aw === 'terminal' || b === 'terminal' ? 18 : aw === 'hangar' || b === 'hangar' ? 20 : aw === 'tower' ? 45 : b === 'warehouse' || b === 'industrial' ? 11 : b === 'house' || b === 'garage' || b === 'shed' ? 5 : b === 'residential' || b === 'apartments' ? 12 : b === 'commercial' || b === 'office' ? 14 : b === 'roof' ? 6 : Math.min(14, 5 + Math.sqrt(A) * 0.15);
      }
      h = Math.min(h, 120);
      const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
      const base = F.planeXY(cx, cy) - 1.5;
      const isTerm = aw === 'terminal' || b === 'terminal', isHang = aw === 'hangar' || b === 'hangar', isTower = aw === 'tower' || t['tower:type'] === 'airport_control';
      const color = isTerm ? '#b7c3cc' : isHang ? '#c3c6cb' : isTower ? '#d8d8d4' : pal[(nb * 7) % pal.length];
      const ring = (sc = 1, dz = 0) => r.map(([x, y]) => { const [la, lo] = fromXY(cx + (x - cx) * sc, cy + (y - cy) * sc); return Cesium.Cartesian3.fromRadians(lo, la, base + dz); });
      const add = (positions, hb, ht, col) => {
        try {
          instances.push(new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(positions), height: hb, extrudedHeight: ht, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(col)) },
          }));
        } catch (e) { /* skip bad polygon */ }
      };
      if (isTower && A < 900) {
        add(ring(), base, base + h - 9, color);                       // shaft
        add(ring(1.9), base + h - 9, base + h - 8.2, '#9da3a8');      // cab floor
        add(ring(1.75), base + h - 8.2, base + h - 2.6, '#263845');   // glass cab
        add(ring(2.0), base + h - 2.6, base + h - 1.8, '#a9aeb2');    // roof
        add(ring(0.25), base + h - 1.8, base + h + 4, '#c33');        // antenna mast
      } else {
        add(ring(), base, base + h, color);
        if (isTerm && h > 8) add(ring(1.0), base + h * 0.35, base + h * 0.8, '#5d7484'); // glazing band (slightly proud)
      }
      nb++;
    }
    if (instances.length) prims.push(new Cesium.Primitive({
      geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: true, shadows: Cesium.ShadowMode.ENABLED,
    }));
  }

  // ---- physics lookup: plane height on taxiways and aprons
  const surfaceHeight = (lat, lon) => {
    const [x, y] = F.toXY(lat, lon);
    for (const r of surfaces.rings) if (pointInRing(x, y, r)) return F.planeXY(x, y) - 0.09;
    for (const [a, b, hw] of surfaces.segs) if (segDist(x, y, a, b) < hw) return F.planeXY(x, y) - 0.05;
    return undefined;
  };
  const [bs, bw, bn, be] = airportBBox(ap);
  const bboxRing = [[bs, bw], [bs, be], [bn, be], [bn, bw]].map(([la, lo]) => Cesium.Cartesian3.fromDegrees(lo, la, F.plane(la * D2R, lo * D2R)));
  return { prims, clips, surfaceHeight, google3D, bboxRing, buildings: nb, taxiways: k, aprons: surfaces.rings.length, plane: F.plane };
}
