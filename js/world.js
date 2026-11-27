// CesiumJS world: globe/scenery, aircraft model, lights, clouds, sky and cameras.
/* global Cesium */
import { D2R, R2D, clamp, lerp, qrot, quatToEuler, wrapPi } from './sim/math.js';

import { buildAirportRunways, runwayInfo, offsetLL } from './runways.js';
import { buildAirport3D, fetchAirportOSM } from './airport3d.js';
const C = () => window.Cesium;

export class World {
  constructor(containerId) {
    this.containerId = containerId;
    this.mode = null;
    this.model = null;
    this.cam = { mode: 'chase', lookYaw: 0, lookPitch: 0, orbitYaw: 200 * D2R, orbitPitch: -8 * D2R, orbitDist: null, chaseYaw: null, fov: 60, zoom: 1 };
    this.clouds = [];
    this.weather = 'scattered';
  }

  async init(settings) {
    const Cesium = C();
    if (settings.ionToken) Cesium.Ion.defaultAccessToken = settings.ionToken;
    this.settings = settings;
    const viewer = new Cesium.Viewer(this.containerId, {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, vrButton: false,
      baseLayer: false, shadows: false, msaaSamples: settings.quality === 'high' ? 4 : 1, requestRenderMode: false,
      useBrowserRecommendedResolution: false, // render at the display's real pixel density (sharp on Retina)
      contextOptions: { webgl: { powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserveBuffer } },
    });
    this.viewer = viewer;
    const scene = viewer.scene;
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.showGroundAtmosphere = true;
    scene.fog.enabled = true; scene.fog.density = 1.0e-4; scene.fog.minimumBrightness = 0.05; scene.fog.screenSpaceErrorFactor = 0.5;
    scene.skyAtmosphere.show = true;
    this.applyGraphics(settings.quality || 'medium');
    scene.screenSpaceCameraController.enableCollisionDetection = true;
    this.setRenderBudget(settings.quality || 'medium');
    scene.camera.frustum.near = 0.2;
    viewer.cesiumWidget.creditContainer.style.display = 'block';
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 1;
    // lights
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.rwyPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.cloudCollection = scene.primitives.add(new Cesium.CloudCollection({ noiseDetail: 20 }));
    return viewer;
  }

  // ------------------------------------------------------------------ graphics presets
  // Filmic HDR tone mapping, sun-lit atmosphere, bloom, ambient occlusion and shadows, scaled by quality.
  applyGraphics(q) {
    const Cesium = C(), viewer = this.viewer, scene = viewer.scene, pp = scene.postProcessStages;
    this.quality = q;
    // HDR tone mapping darkens Google's photoreal tiles and the sky, so keep the LDR pipeline (crisper colours)
    scene.highDynamicRange = false;
    pp.fxaa.enabled = true;
    scene.light = new Cesium.SunLight({ intensity: 2.0 });
    try { scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.OFF; } catch (e) { /* */ } // our own day/night tint handles darkness; sun-driven atmosphere turned tiles red
    // bloom: gentle glow on sun glare, bright paint and lights
    const bloom = pp.bloom;
    bloom.enabled = q === 'high'; // full-screen passes are expensive at Retina resolution
    bloom.uniforms.glowOnly = false; bloom.uniforms.contrast = 118; bloom.uniforms.brightness = -0.45; bloom.uniforms.delta = 1.0; bloom.uniforms.sigma = 2.6; bloom.uniforms.stepSize = 1.2;
    // ambient occlusion: contact shadows between parts and on buildings (high only, it is expensive)
    const ao = pp.ambientOcclusion;
    ao.enabled = false; // Cesium AO renders black together with photoreal 3D tiles
    ao.uniforms.intensity = 2.2; ao.uniforms.bias = 0.12; ao.uniforms.lengthCap = 0.12; ao.uniforms.directionCount = 8; ao.uniforms.stepCount = 24; ao.uniforms.stepSize = 1.2; ao.uniforms.blurStepSize = 0.86;
    // sun shadows (aircraft onto itself / runway / buildings)
    viewer.shadows = q === 'high' || !!this.settings.shadows;
    const sm = scene.shadowMap;
    if (sm) { sm.softShadows = true; sm.size = q === 'high' ? 4096 : 2048; sm.maximumDistance = 600; sm.darkness = 0.35; sm.fadingEnabled = true; }
    viewer.terrainShadows = Cesium.ShadowMode.RECEIVE_ONLY;
  }

  // ------------------------------------------------------------------ scenery
  async setScenery(mode, onStatus = () => {}) {
    const Cesium = C(), viewer = this.viewer, scene = viewer.scene;
    if (this.mode === mode) return this.mode;
    // clean previous
    if (this.tileset) { this.clearRunwaySurfaces(); this.removeOsmBuildings(); scene.primitives.remove(this.tileset); this.tileset = null; }
    if (this.buildings) { scene.primitives.remove(this.buildings); this.buildings = null; }
    viewer.imageryLayers.removeAll();
    scene.globe.show = true;
    const hasToken = !!this.settings.ionToken;
    try {
      if (mode === 'photoreal') {
        if (!hasToken) throw new Error('Photorealistic 3D needs a Cesium ion token');
        onStatus('Loading photorealistic 3D tiles…');
        scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
        viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
        const sse = { high: 7, medium: 12, low: 20 }[this.settings.quality] ?? 12;
        this.baseSSE = sse;
        const ts = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, {
          maximumScreenSpaceError: sse,
          cacheBytes: ({ high: 512, medium: 384, low: 256 }[this.settings.quality] ?? 384) * 1024 * 1024,
          maximumCacheOverflowBytes: ({ high: 256, medium: 192, low: 128 }[this.settings.quality] ?? 192) * 1024 * 1024,
          preloadFlightDestinations: true, foveatedScreenSpaceError: true,
          // lower detail toward the horizon (big saving at low altitude, barely visible)
          dynamicScreenSpaceError: true, dynamicScreenSpaceErrorDensity: 2.0e-4, dynamicScreenSpaceErrorFactor: 24, dynamicScreenSpaceErrorHeightFalloff: 0.25,
        });
        ts.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
        this.tileset = scene.primitives.add(ts);
        scene.globe.show = false;
      } else if (mode === 'terrain') {
        if (!hasToken) throw new Error('World terrain needs a Cesium ion token');
        onStatus('Loading Cesium World Terrain + Bing aerial imagery…');
        scene.setTerrain(Cesium.Terrain.fromWorldTerrain({ requestWaterMask: true }));
        viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
        try { this.buildings = scene.primitives.add(await Cesium.createOsmBuildingsAsync()); } catch (e) { console.warn('OSM buildings failed', e); }
      } else {
        throw new Error('lite');
      }
      this.mode = mode;
    } catch (err) {
      if (err.message !== 'lite') console.warn('Scenery fallback:', err);
      scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
      let layer;
      try {
        const prov = await Promise.race([
          Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', { enablePickFeatures: false }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
        ]);
        layer = new Cesium.ImageryLayer(prov);
      } catch (e) {
        const prov = await Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'));
        layer = new Cesium.ImageryLayer(prov);
      }
      viewer.imageryLayers.add(layer);
      this.mode = 'lite';
    }
    return this.mode;
  }

  groundHeight(latR, lonR) {
    const Cesium = C(), scene = this.viewer.scene;
    const carto = new Cesium.Cartographic(lonR, latR, 0);
    if (this.mode === 'lite') return 0;
    if (this.tileset && scene.sampleHeightSupported) {
      try {
        const ex = [this.points, this.rwyPoints, this.cloudCollection]; if (this.model) ex.push(this.model);
        const hgt = scene.sampleHeight(carto, ex, 1.5);
        if (hgt !== undefined) return hgt;
      } catch (e) { /* ignore */ }
    }
    const hg = scene.globe.getHeight(carto);
    return hg;
  }

  // ---------------------------------------------------------------- render budget + adaptive quality
  // Resolution is budgeted in "pixels per CSS pixel" (RPR) instead of the raw device pixel ratio: a Retina
  // MacBook would otherwise render 4x the pixels of a normal screen. Never drops below 1.0 (no blurry upscaling).
  setRenderBudget(q) {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.rprTarget = Math.min(dpr, { high: 2, medium: 1.35, low: 1 }[q] ?? 1.35);
    this.rprMin = Math.min(dpr, 1);
    this.rpr = this.rprTarget;
    this.viewer.resolutionScale = this.rpr / dpr;
  }
  // Keeps the frame rate smooth: first trims resolution toward 1.15x, then distant 3D-tile detail (mildly),
  // then resolution down to 1.0x; restores in reverse when there's headroom.
  adaptQuality(fps) {
    const v = this.viewer, ts = this.tileset, base = this.baseSSE || 10;
    if (!this.rpr) this.setRenderBudget(this.quality || 'medium');
    const setR = (r) => { this.rpr = Math.max(this.rprMin, Math.min(this.rprTarget, +r.toFixed(2))); v.resolutionScale = this.rpr / this.dpr; };
    const mid = Math.max(this.rprMin, Math.min(this.rprTarget, 1.15));
    if (fps < 28) {
      if (this.rpr > mid + 0.01) setR(this.rpr - 0.1);
      else if (ts && ts.maximumScreenSpaceError < base * 1.6) ts.maximumScreenSpaceError = Math.min(base * 1.6, ts.maximumScreenSpaceError + 2);
      else setR(this.rpr - 0.05);
    } else if (fps > 50) {
      if (this.rpr < mid - 0.01) setR(this.rpr + 0.05);
      else if (ts && ts.maximumScreenSpaceError > base) ts.maximumScreenSpaceError = Math.max(base, ts.maximumScreenSpaceError - 1);
      else if (this.rpr < this.rprTarget) setR(this.rpr + 0.05);
    }
  }

  // ---------------------------------------------------------------- fast ground height
  // Runways come from the airport database (exact, flat, free); elsewhere terrain is sampled
  // asynchronously. Expensive scene.sampleHeight is only used once per airport for calibration.
  setGroundAirports(aps) {
    this.gAirports = aps || [];
    this.aptGeoid = this.aptGeoid || {}; this._geoPending = this._geoPending || {};
    for (const a of this.gAirports) if (this.aptGeoid[a.i] === undefined && !this._geoPending[a.i]) this.measureGeoid(a);
  }
  async measureGeoid(a) {
    const Cesium = C();
    if (this.mode === 'lite') { this.aptGeoid[a.i] = -a.e * 0.3048; return; }
    const tp = this.viewer.scene.terrainProvider;
    if (!tp || tp instanceof Cesium.EllipsoidTerrainProvider) { this.aptGeoid[a.i] = -a.e * 0.3048; return; }
    this._geoPending[a.i] = true;
    try {
      const [p] = await Cesium.sampleTerrainMostDetailed(tp, [Cesium.Cartographic.fromDegrees(a.lo, a.la)]);
      if (isFinite(p.height) && this.aptGeoid[a.i] === undefined) this.aptGeoid[a.i] = p.height - a.e * 0.3048;
    } catch (e) { /* keep undefined */ }
    this._geoPending[a.i] = false;
  }
  // one-off calibration against the rendered 3D tiles: median of samples along every runway centreline,
  // so one bump or dip in lumpy photogrammetry can't put the runway too high or too low
  sampleTile(lat, lon) {
    const Cesium = C(), scene = this.viewer.scene;
    if (!this.tileset || !scene.sampleHeightSupported) return undefined;
    try {
      const ex = [this.points, this.rwyPoints, this.cloudCollection, ...(this.model ? [this.model] : []), ...(this.cockpit ? [this.cockpit] : []), ...this.runwayPrims()];
      return scene.sampleHeight(new Cesium.Cartographic(lon, lat), ex, 1);
    } catch (e) { return undefined; }
  }
  calibrateAirport(a) {
    if (!this.tileset || !this.viewer.scene.sampleHeightSupported || !a.r.length) return false;
    if (this.rwySurf?.has(a.i)) return true; // already flattened: tiles under the runway are clipped
    const offs = [];
    for (const r of a.r.slice(0, 4)) {
      const info = runwayInfo(r);
      for (let k = 1; k <= 7; k++) {
        const t = k / 8, [la, lo] = offsetLL(info.la1, info.lo1, info.hdg, info.L * t);
        const h = this.sampleTile(la, lo);
        if (h !== undefined && isFinite(h)) offs.push(h - (info.e1 + (info.e2 - info.e1) * t));
      }
    }
    if (offs.length < 3) return false;
    offs.sort((x, y) => x - y);
    const g = offs[Math.floor(offs.length / 2)];
    if (Math.abs(g) >= 130) return false;
    this.aptGeoid[a.i] = g;
    return true;
  }
  // replace the (often lumpy) photogrammetry under an airport's runways with flat textured strips
  runwayPrims() {
    const out = [];
    for (const v of (this.rwySurf || new Map()).values()) out.push(...v.prims);
    for (const v of (this.ap3d || new Map()).values()) out.push(...v.prims);
    return out;
  }
  flattenAirport(a) {
    if (!this.tileset || this.mode !== 'photoreal' || !a?.r?.length) return false;
    this.rwySurf = this.rwySurf || new Map(); this.ap3d = this.ap3d || new Map(); this.aptPlane = this.aptPlane || {};
    if (this.rwySurf.has(a.i)) { this.fetch3D(a); return true; }
    const g = this.aptGeoid?.[a.i]; if (g === undefined) return false;
    if (!this.buildRunways(a)) return false;
    // keep at most a few airports flattened (departure, destination, nearby)
    while (this.rwySurf.size > 3) this.dropAirport(this.rwySurf.keys().next().value);
    this.applyClipping();
    this.fetch3D(a);
    return true;
  }
  // taxiways, aprons and buildings from OpenStreetMap (async; retried while the airport stays nearby)
  fetch3D(a) {
    if (this.osmEnabled === false || this.ap3d.has(a.i) || this._fetching?.[a.i]) return;
    this._fetching = this._fetching || {}; this._fetching[a.i] = true;
    fetchAirportOSM(a).then((el) => { if (el && this.rwySurf.has(a.i) && !this.ap3d.has(a.i)) this.addAirport3D(a, el); })
      .catch(() => {}).finally(() => { this._fetching[a.i] = false; });
  }
  buildRunways(a) {
    let built;
    try { built = buildAirportRunways(a, this.aptGeoid[a.i], (la, lo) => this.sampleTile(la, lo), this.aptPlane[a.i]); } catch (e) { console.warn('runway build failed', e); return false; }
    const old = this.rwySurf.get(a.i);
    if (old) for (const p of old.prims) this.viewer.scene.primitives.remove(p);
    for (const p of built.prims) this.viewer.scene.primitives.add(p);
    this.rwySurf.set(a.i, built);
    this.applyNightTint();
    return true;
  }
  addAirport3D(a, elements) {
    let res;
    try {
      res = buildAirport3D(a, this.aptGeoid[a.i], elements, { sampleTile: (la, lo) => this.sampleTile(la, lo), buildings: this.buildingsEnabled !== false });
    } catch (e) { console.warn('airport 3D build failed', e); return; }
    this.aptPlane[a.i] = res.plane;
    this.buildRunways(a); // re-level the runways onto the shared airport plane
    for (const p of res.prims) this.viewer.scene.primitives.add(p);
    this.ap3d.set(a.i, res);
    this.applyNightTint();
    this.applyClipping();
    // Google has no real 3D buildings here: add OpenStreetMap 3D buildings for the surrounding city too
    if (!res.google3D && this.buildingsEnabled !== false) { this.ensureOsmBuildings(); this.alignOsmBuildings(a, res); }
    else if (res.google3D) this.removeOsmBuildings();
    this.onAirport3D?.(a, res);
  }
  dropAirport(id) {
    for (const m of [this.rwySurf, this.ap3d]) { const v = m?.get(id); if (v) { for (const p of v.prims) this.viewer.scene.primitives.remove(p); m.delete(id); } }
    if (this.aptPlane) delete this.aptPlane[id];
  }
  async ensureOsmBuildings() {
    const Cesium = C();
    if (this.osmBuildings || this._osmLoading || this.mode !== 'photoreal') return;
    this._osmLoading = true;
    try {
      const ts = await Cesium.createOsmBuildingsAsync({
        style: new Cesium.Cesium3DTileStyle({
          color: { conditions: [
            ["${feature['building']} === 'house' || ${feature['building']} === 'residential' || ${feature['building']} === 'apartments'", "color('#e2ddd2')"],
            ["${feature['building']} === 'commercial' || ${feature['building']} === 'office' || ${feature['building']} === 'retail'", "color('#c9ced3')"],
            ["${feature['building']} === 'industrial' || ${feature['building']} === 'warehouse'", "color('#cfcac0')"],
            ['true', "color('#d8d4cb')"],
          ] },
        }),
      });
      ts.maximumScreenSpaceError = 20;
      ts.shadows = Cesium.ShadowMode.ENABLED;
      if (this.osmMatrix) ts.modelMatrix = this.osmMatrix;
      this.osmBuildings = this.viewer.scene.primitives.add(ts);
      this.applyClipping(); this.applyNightTint();
    } catch (e) { console.warn('OSM buildings unavailable', e); }
    this._osmLoading = false;
  }
  // OSM buildings stand on Cesium World Terrain; lift/lower them onto Google's ground around this airport
  async alignOsmBuildings(a, res) {
    const Cesium = C();
    try {
      const lat = a.la * Math.PI / 180, lon = a.lo * Math.PI / 180;
      const [p] = await Cesium.sampleTerrainMostDetailed(this.viewer.scene.terrainProvider, [new Cesium.Cartographic(lon, lat)]);
      if (!isFinite(p.height)) return;
      const off = res.plane(lat, lon) - p.height;
      if (Math.abs(off) > 150) return;
      const n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(Cesium.Cartesian3.fromRadians(lon, lat, 0), new Cesium.Cartesian3());
      this.osmMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.multiplyByScalar(n, off, new Cesium.Cartesian3()));
      if (this.osmBuildings) this.osmBuildings.modelMatrix = this.osmMatrix;
    } catch (e) { /* keep default placement */ }
  }
  removeOsmBuildings() {
    if (this.osmBuildings) { this.viewer.scene.primitives.remove(this.osmBuildings); this.osmBuildings = null; }
  }
  airportSurfaceHeight(lat, lon) {
    for (const v of (this.ap3d || new Map()).values()) { const h = v.surfaceHeight(lat, lon); if (h !== undefined) return h; }
    return undefined;
  }
  // flat airport surfaces use unlit-looking image materials: scale them with daylight so paint doesn't glow at night
  // Google's photogrammetry has daylight baked in, so the whole scene (tiles, OSM buildings, our airport
  // surfaces) is scaled with the real sun elevation: bright by day, dusk tones, moonlit night.
  dayFactor() { const k = this.sunK ?? 1; return 0.1 + 0.9 * k; }
  nightShader() {
    const Cesium = C();
    if (!this._nightShader) {
      this._nightShader = new Cesium.CustomShader({
        uniforms: { u_day: { type: Cesium.UniformType.FLOAT, value: 1 } },
        fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          // cool, desaturated moonlight at night
          float d = u_day;
          vec3 c = material.diffuse;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 night = mix(vec3(l), c, 0.45) * vec3(0.82, 0.9, 1.15);
          material.diffuse = mix(night, c, smoothstep(0.1, 0.6, d)) * d;
          material.emissive *= d;
        }`,
      });
    }
    return this._nightShader;
  }
  applyNightTint() {
    const Cesium = C();
    const v = this.dayFactor();
    const sh = this.nightShader(); sh.setUniform('u_day', v);
    if (this.tileset && this.tileset.customShader !== sh) this.tileset.customShader = sh;
    if (this.osmBuildings && this.osmBuildings.customShader !== sh) this.osmBuildings.customShader = sh;
    for (const e of (this.ap3d || new Map()).values()) if (e.tint && e._tinted !== v) { if (e.tint(v)) e._tinted = v; }
    for (const m of [this.rwySurf, this.ap3d]) if (m) for (const e of m.values()) for (const mat of e.mats || []) {
      const b = mat._base || Cesium.Color.WHITE;
      mat.uniforms.color = new Cesium.Color(b.red * v, b.green * v * 0.98, b.blue * v * 0.96, b.alpha);
    }
  }
  clearRunwaySurfaces() {
    for (const id of [...(this.rwySurf || new Map()).keys(), ...(this.ap3d || new Map()).keys()]) this.dropAirport(id);
    this.rwySurf = new Map(); this.ap3d = new Map();
    this.applyClipping();
  }
  applyClipping() {
    const Cesium = C();
    if (!this.tileset) return;
    const polys = []; for (const m of [this.rwySurf, this.ap3d]) if (m) for (const v of m.values()) polys.push(...v.clips);
    this.tileset.clippingPolygons = polys.length ? new Cesium.ClippingPolygonCollection({ polygons: polys }) : undefined;
    if (this.osmBuildings) {
      const boxes = [];
      for (const v of (this.ap3d || new Map()).values()) if (v.bboxRing) boxes.push(new Cesium.ClippingPolygon({ positions: v.bboxRing }));
      this.osmBuildings.clippingPolygons = boxes.length ? new Cesium.ClippingPolygonCollection({ polygons: boxes }) : undefined;
    }
  }
  runwayHeight(lat, lon) {
    const R = 6371008.8, D = Math.PI / 180;
    for (const a of this.gAirports || []) {
      if (Math.abs(a.la * D - lat) > 0.08) continue;
      const gd = this.aptGeoid ? this.aptGeoid[a.i] : undefined; if (gd === undefined) continue;
      for (const r of a.r) {
        const la1 = r[1] * D, lo1 = r[2] * D, la2 = r[5] * D, lo2 = r[6] * D;
        const cl = Math.cos(la1);
        const ex = (lo2 - lo1) * cl * R, ey = (la2 - la1) * R, L = Math.hypot(ex, ey) || 1;
        const dx = (lon - lo1) * cl * R, dy = (lat - la1) * R;
        const along = (dx * ex + dy * ey) / L, cross = (dx * ey - dy * ex) / L;
        if (along > -60 && along < L + 60 && Math.abs(cross) < (r[9] * 0.3048) / 2 + 35) {
          const pl = this.aptPlane?.[a.i];
          if (pl) return pl(lat, lon);
          const t = Math.max(0, Math.min(1, along / L));
          return (r[3] + (r[7] - r[3]) * t) * 0.3048 + gd;
        }
      }
    }
    return undefined;
  }
  // nearest airport geoid offset (ellipsoid - MSL) for altitude display
  localGeoid(lat, lon) {
    let best, bd = 1e9; const D = Math.PI / 180;
    for (const a of this.gAirports || []) { const g = this.aptGeoid?.[a.i]; if (g === undefined) continue; const d = Math.hypot(a.la * D - lat, (a.lo * D - lon) * Math.cos(lat)); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  groundFast(lat, lon) {
    const rh = this.runwayHeight(lat, lon);
    if (rh !== undefined) return rh;
    const sh = this.airportSurfaceHeight(lat, lon);
    if (sh !== undefined) return sh;
    if (this.mode === 'lite') return 0;
    const Cesium = C();
    const now = performance.now();
    if (!this._terrBusy && (!this._terrT || now - this._terrT > 400)) {
      this._terrBusy = true; this._terrT = now;
      const tp = this.viewer.scene.terrainProvider;
      Cesium.sampleTerrainMostDetailed(tp, [new Cesium.Cartographic(lon, lat)]).then(([p]) => { if (isFinite(p.height)) this._terr = { lat, lon, h: p.height }; }).catch(() => {}).finally(() => { this._terrBusy = false; });
    }
    const t = this._terr;
    if (t && Math.hypot(t.lat - lat, (t.lon - lon) * Math.cos(lat)) * 6371000 < 3000) return t.h;
    return undefined;
  }

  async waitForScenery(maxMs = 25000, onProgress = () => {}) {
    const scene = this.viewer.scene;
    const t0 = performance.now();
    let stable = 0;
    return new Promise((resolve) => {
      const check = () => {
        const loaded = this.tileset ? this.tileset.tilesLoaded : scene.globe.tilesLoaded;
        stable = loaded ? stable + 1 : 0;
        const el = performance.now() - t0;
        onProgress(Math.min(0.99, el / maxMs));
        if (stable > 20 || el > maxMs) { scene.postRender.removeEventListener(check); resolve(); }
      };
      scene.postRender.addEventListener(check);
    });
  }

  // ------------------------------------------------------------------ time & weather
  setTimeOfDay(localHour, lonR) {
    const Cesium = C();
    const now = new Date();
    const utcHour = localHour - (lonR * R2D) / 15;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    d.setTime(d.getTime() + utcHour * 3600 * 1000);
    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
  }

  setWeather(preset) {
    this.weather = preset;
    const scene = this.viewer.scene;
    const fog = { clear: 0.6e-4, few: 0.8e-4, scattered: 1.0e-4, broken: 1.8e-4, overcast: 3.5e-4, storm: 6e-4 }[preset] || 1e-4;
    scene.fog.density = fog;
    this.cloudCfg = {
      clear: { n: 0 }, few: { n: 22, base: 1400, top: 2200, size: 1.3 }, scattered: { n: 45, base: 1500, top: 2600, size: 1.6 },
      broken: { n: 80, base: 1200, top: 2600, size: 2.0 }, overcast: { n: 120, base: 900, top: 1800, size: 2.4, dark: true }, storm: { n: 130, base: 700, top: 2400, size: 2.7, dark: true },
    }[preset] || { n: 0 };
    const cq = { high: 1, medium: 0.6, low: 0.35 }[this.quality] ?? 0.6;
    if (this.cloudCfg.n) this.cloudCfg.n = Math.max(8, Math.round(this.cloudCfg.n * cq));
    this.cloudCollection.removeAll();
    this.clouds = [];
    this.cloudsCenter = null;
  }

  updateClouds(latR, lonR, alt) {
    const Cesium = C();
    const cfg = this.cloudCfg; if (!cfg || !cfg.n) return;
    const k = this.sunK ?? 1;
    if (this.clouds.length && Math.abs((this._cloudK ?? -1) - k) > 0.02) {
      this._cloudK = k;
      for (const cl of this.clouds) cl.c.brightness = cl.b * (0.08 + 0.92 * k);
    }
    const R = 26000;
    const center = { lat: latR, lon: lonR };
    const toPos = (dx, dy, h) => Cesium.Cartesian3.fromRadians(lonR + dx / (6378137 * Math.cos(latR)), latR + dy / 6378137, h);
    if (!this.clouds.length) {
      for (let i = 0; i < cfg.n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        this.spawnCloud(cfg, latR + (Math.sin(a) * r) / 6378137, lonR + (Math.cos(a) * r) / (6378137 * Math.cos(latR)));
      }
      return;
    }
    // recycle far clouds to the opposite side
    for (const cl of this.clouds) {
      const dy = (cl.lat - latR) * 6378137, dx = (cl.lon - lonR) * 6378137 * Math.cos(latR);
      if (dx * dx + dy * dy > R * R * 1.1) {
        const a = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 1.2;
        const r = R * (0.85 + Math.random() * 0.15);
        cl.lat = latR + (Math.sin(a) * r) / 6378137; cl.lon = lonR + (Math.cos(a) * r) / (6378137 * Math.cos(latR));
        cl.c.position = Cesium.Cartesian3.fromRadians(cl.lon, cl.lat, cl.h);
      }
    }
  }

  spawnCloud(cfg, lat, lon) {
    const Cesium = C();
    const h = cfg.base + Math.random() * (cfg.top - cfg.base) * 0.4 + (this.cloudBaseOffset || 0);
    const s = (700 + Math.random() * 1100) * cfg.size;
    const c = this.cloudCollection.add({
      position: Cesium.Cartesian3.fromRadians(lon, lat, h),
      scale: new Cesium.Cartesian2(s, s * (0.3 + Math.random() * 0.2)),
      maximumSize: new Cesium.Cartesian3(50, 14 + Math.random() * 8, 12 + Math.random() * 6),
      slice: 0.3 + Math.random() * 0.25,
      brightness: cfg.dark ? 0.7 + Math.random() * 0.15 : 1.0,
    });
    this.clouds.push({ c, lat, lon, h, b: c.brightness });
    this._cloudK = -1;
  }

  // ------------------------------------------------------------------ aircraft
  async loadAircraft(glb, physics) {
    const Cesium = C();
    if (this.model) { this.viewer.scene.primitives.remove(this.model); this.model = null; }
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const model = await Cesium.Model.fromGltfAsync({
      url, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X, shadows: Cesium.ShadowMode.ENABLED,
      incrementallyLoadTextures: false, backFaceCulling: true,
    });
    this.viewer.scene.primitives.add(model);
    await new Promise((res) => { if (model.ready) res(); else { const r = model.readyEvent.addEventListener(() => { r(); res(); }); } });
    this.model = model; this._modelK = undefined; this._sunT = 0; // new model: re-apply lighting on the next frame
    this.physics = physics;
    this.nodes = { props: [] };
    const anim = physics.anim || { surfaces: [], gear: [] };
    this.surfaces = anim.surfaces.map((a) => ({ ...a, n: model.getNode(a.node) })).filter((a) => a.n);
    this.gearLegs = anim.gear.map((a) => ({ ...a, n: model.getNode(a.node) })).filter((a) => a.n);
    for (const e of physics.engines) {
      const n = model.getNode(e.node);
      if (n) this.nodes.props.push({ node: n, e, angle: Math.random() * 6 });
    }
    // nav lights
    this.points.removeAll();
    const mk = (color, size) => this.points.add({ position: Cesium.Cartesian3.ZERO, color, pixelSize: size, scaleByDistance: new Cesium.NearFarScalar(50, 1.6, 8000, 0.6), disableDepthTestDistance: 0 });
    this.lights = {
      navL: mk(Cesium.Color.RED, 5), navR: mk(Cesium.Color.LIME, 5), tail: mk(Cesium.Color.WHITE, 4),
      strobeL: mk(Cesium.Color.WHITE, 9), strobeR: mk(Cesium.Color.WHITE, 9), beaconT: mk(Cesium.Color.RED, 7), beaconB: mk(Cesium.Color.RED, 7),
    };
    URL.revokeObjectURL(url);
    return model;
  }
  // optional 3D cockpit interior (shown only in cockpit view)
  async loadCockpit(spec) {
    const Cesium = C();
    if (this.cockpit) { this.viewer.scene.primitives.remove(this.cockpit); this.cockpit = null; }
    this.ckMeta = null;
    if (!spec) return null;
    try {
      const base = new URL('../', import.meta.url);
      const meta = await (await fetch(new URL(spec.meta, base))).json();
      // per-aircraft placement of a shared flight deck (e.g. 737NG deck in the 737 MAX) and display size
      const off = spec.offset || [0, 0, 0], add = (p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
      meta.eye = add(meta.eye); if (spec.pitchDeg != null) meta.pitchDeg = spec.pitchDeg;
      const [sx, sy] = spec.screenScale || [1, 1];
      for (const k of Object.keys(meta.screens || {})) {
        const q = meta.screens[k].map(add);
        const c = [0, 1, 2].map((i) => (q[0][i] + q[1][i] + q[2][i] + q[3][i]) / 4);
        const top = [0, 1, 2].map((i) => (q[0][i] + q[1][i]) / 2 - c[i]), right = [0, 1, 2].map((i) => (q[1][i] + q[2][i]) / 2 - c[i]);
        meta.screens[k] = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => [0, 1, 2].map((i) => c[i] + a * right[i] * sx + b * top[i] * sy));
      }
      meta.offset = off;
      const model = await Cesium.Model.fromGltfAsync({
        url: new URL(spec.glb, base).href, upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X,
        shadows: Cesium.ShadowMode.DISABLED, backFaceCulling: false,
      });
      model.show = false;
      this.viewer.scene.primitives.add(model);
      await new Promise((res) => { if (model.ready) res(); else { const r = model.readyEvent.addEventListener(() => { r(); res(); }); } });
      this.cockpit = model; this.ckMeta = meta;
      return meta;
    } catch (e) { console.warn('3D cockpit unavailable', e); return null; }
  }
  // screen-space corners (TL, TR, BR, BL) of a 3D cockpit display, or null if off-screen/behind
  screenQuad(key) {
    const Cesium = C();
    const q = this.ckMeta?.screens?.[key]; const f = this.lastFrame;
    if (!q || !f) return null;
    const cam = this.viewer.camera, out = [];
    for (const p of q) {
      const w = this.modelPoint(f, p);
      const d = Cesium.Cartesian3.subtract(w, cam.positionWC, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.dot(d, cam.directionWC) < 0.02) return null;
      const c = this.viewer.scene.cartesianToCanvasCoordinates(w);
      if (!c) return null;
      out.push([c.x, c.y]);
    }
    return out;
  }

  // body (x fwd, y right, z down) -> ECEF helpers
  frame(fm) {
    const Cesium = C();
    const pos = Cesium.Cartesian3.fromRadians(fm.lon, fm.lat, fm.h);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    const E = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4()), N = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4()), U = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
    const nedToFixed = (v) => new Cesium.Cartesian3(N.x * v[0] + E.x * v[1] - U.x * v[2], N.y * v[0] + E.y * v[1] - U.y * v[2], N.z * v[0] + E.z * v[1] - U.z * v[2]);
    const bodyToFixed = (b) => nedToFixed(qrot(fm.q, b));
    return { pos, E, N, U, nedToFixed, bodyToFixed };
  }
  modelPoint(f, p) { // model coords (x fwd, y left, z up) -> ECEF
    const Cesium = C();
    const d = f.bodyToFixed([p[0], -p[1], -p[2]]);
    return Cesium.Cartesian3.add(f.pos, d, new Cesium.Cartesian3());
  }

  // rotate a node about a hinge line through p0 along axis, plus an optional translation (model coords)
  hingeMatrix(p0, axis, angle, t = [0, 0, 0]) {
    const Cesium = C();
    const R = Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.normalize(new Cesium.Cartesian3(...axis), new Cesium.Cartesian3()), angle));
    const p = new Cesium.Cartesian3(...p0);
    const rp = Cesium.Matrix3.multiplyByVector(R, p, new Cesium.Cartesian3());
    return Cesium.Matrix4.fromRotationTranslation(R, new Cesium.Cartesian3(p.x - rp.x + t[0], p.y - rp.y + t[1], p.z - rp.z + t[2]));
  }
  animateParts(fm) {
    const s = fm.surf || { de: 0, da: 0, dr: 0 };
    const D = Math.PI / 180;
    for (const a of this.surfaces) {
      const axis = [a.p1[0] - a.p0[0], a.p1[1] - a.p0[1], a.p1[2] - a.p0[2]];
      let teDown = 0, t = [0, 0, 0];
      if (a.type === 'aileron') teDown = (a.side > 0 ? 1 : -1) * s.da * 20 * D;
      else if (a.type === 'elevator') teDown = -s.de * 25 * D;
      else if (a.type === 'flap') { teDown = fm.flap * 35 * D; t = [-fm.flap * (a.chord || 1) * 0.6, 0, -fm.flap * (a.chord || 1) * 0.12]; }
      else if (a.type === 'spoiler') teDown = -(fm.spoiler * 45 + Math.max(0, (a.side > 0 ? -1 : 1) * s.da - 0.3) * 25) * D;
      if (a.type === 'rudder') { a.n.matrix = this.hingeMatrix(a.p0, axis, s.dr * 25 * D); continue; }
      a.n.matrix = this.hingeMatrix(a.p0, axis, a.side > 0 ? -teDown : teDown, t);
    }
    const k = 1 - fm.gearPos; // 0 = down, 1 = retracted
    for (const gl of this.gearLegs) {
      if (gl.kind === 'hide') { gl.n.show = fm.gearPos > 0.5; continue; }
      gl.n.show = fm.gearPos > 0.03;
      if (!gl.n.show) continue;
      const ang = k * 88 * D;
      if (gl.kind === 'nose') gl.n.matrix = this.hingeMatrix(gl.pivot, [0, 1, 0], -ang);
      else if (gl.kind === 'mainL') gl.n.matrix = this.hingeMatrix(gl.pivot, [1, 0, 0], -ang);
      else if (gl.kind === 'mainR') gl.n.matrix = this.hingeMatrix(gl.pivot, [1, 0, 0], ang);
      else gl.n.matrix = this.hingeMatrix(gl.pivot, [0, 1, 0], ang);
    }
  }

  updateAircraft(fm, dt, visible = true) {
    const Cesium = C();
    if (!this.model) return;
    const f = this.frame(fm);
    this.lastFrame = f;
    const X = f.bodyToFixed([1, 0, 0]), Y = f.bodyToFixed([0, -1, 0]), Z = f.bodyToFixed([0, 0, -1]);
    const m = new Cesium.Matrix4(X.x, Y.x, Z.x, f.pos.x, X.y, Y.y, Z.y, f.pos.y, X.z, Y.z, Z.z, f.pos.z, 0, 0, 0, 1);
    this.model.modelMatrix = m;
    // dim the aircraft at night: scale the model's light by the real sun elevation
    const nowMs = performance.now();
    if (!this._sunT || nowMs - this._sunT > 1000) {
      this._sunT = nowMs;
      const time = this.viewer.clock.currentTime;
      const sunI = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time);
      const mtx = Cesium.Transforms.computeIcrfToFixedMatrix(time) || Cesium.Transforms.computeTemeToPseudoFixedMatrix(time);
      const sunF = Cesium.Matrix3.multiplyByVector(mtx, sunI, new Cesium.Cartesian3());
      const toSun = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(sunF, f.pos, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const sinElev = Cesium.Cartesian3.dot(toSun, Cesium.Cartesian3.normalize(new Cesium.Cartesian3(f.U.x, f.U.y, f.U.z), new Cesium.Cartesian3()));
      const t = clamp((sinElev + 0.1) / 0.22, 0, 1);
      const k = 0.12 + 0.88 * t * t * (3 - 2 * t);
      this.sunK = k;
      this.applyNightTint();
      if (this._modelK === undefined || Math.abs(this._modelK - k) > 0.005) {
        this._modelK = k;
        this.model.lightColor = new Cesium.Cartesian3(k * 2.0, k * 1.95, k * 1.85);
        this.model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(k, k);
      }
    }
    this.model.show = visible;
    if (this.cockpit) {
      const o = this.ckMeta.offset;
      this.cockpit.modelMatrix = o && (o[0] || o[1] || o[2]) ? Cesium.Matrix4.multiplyByTranslation(m, new Cesium.Cartesian3(o[0], o[1], o[2]), new Cesium.Matrix4()) : m;
      this.cockpit.show = !visible;
      // under the glareshield a flight deck is lit mostly by sky light: keep direct sun soft so the
      // baked ambient occlusion (contact shadows in every recess) carries the shading
      if (this.sunK != null && this._ckK !== this.sunK) {
        this._ckK = this.sunK;
        const k = Math.max(0.3, this.sunK);
        this.cockpit.lightColor = new Cesium.Cartesian3(k * 0.75, k * 0.73, k * 0.7);
        this.cockpit.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(Math.max(0.45, k) * 1.0, Math.max(0.3, k) * 0.6);
      }
    }
    this.animateParts(fm);
    // spin fans / props
    fm.engines.forEach((e, i) => {
      const pn = this.nodes.props[i]; if (!pn) return;
      const rpm = pn.e.type === 'prop' ? (e.running ? 1000 + 200 * (e.n1 - e.idle) / (100 - e.idle) * 5 : 0) : e.n1 * 40;
      pn.angle = (pn.angle + (rpm / 60) * 2 * Math.PI * dt) % (Math.PI * 2);
      const vis = pn.e.type === 'prop' && rpm > 600 ? (pn.angle * 0.13) % (Math.PI * 2) : pn.angle; // reduce strobing
      const rot = Cesium.Matrix3.fromRotationX(vis);
      pn.node.matrix = Cesium.Matrix4.fromRotationTranslation(rot, new Cesium.Cartesian3(pn.e.x, pn.e.y, pn.e.z));
    });
    // lights
    const L = this.physics.lights, t = performance.now() / 1000;
    const set = (pt, p, on = true) => { pt.position = this.modelPoint(f, p); pt.show = on && visible !== 'nolights'; };
    set(this.lights.navL, L.navLeft); set(this.lights.navR, L.navRight); set(this.lights.tail, L.tail);
    const strobe = t % 1.2 < 0.07;
    set(this.lights.strobeL, L.navLeft, strobe && !fm.onGround); set(this.lights.strobeR, L.navRight, strobe && !fm.onGround);
    const beacon = t % 1.0 < 0.12;
    set(this.lights.beaconT, L.beaconTop, beacon); set(this.lights.beaconB, L.beaconBot, beacon);
  }

  // ------------------------------------------------------------------ runway lights / PAPI
  setRunwayLights(rwy, geoid) {
    const Cesium = C();
    this.rwyPoints.removeAll(); this.papi = null;
    if (!rwy) return;
    const pts = [];
    const brg = rwy.heading, perp = brg + Math.PI / 2;
    const off = (lat, lon, b, d) => {
      const dl = d / 6371008.8;
      const la2 = Math.asin(Math.sin(lat) * Math.cos(dl) + Math.cos(lat) * Math.sin(dl) * Math.cos(b));
      const lo2 = lon + Math.atan2(Math.sin(b) * Math.sin(dl) * Math.cos(lat), Math.cos(dl) - Math.sin(lat) * Math.sin(la2));
      return [la2, lo2];
    };
    const elev = (t) => lerp(rwy.elevM, rwy.endElevM, t) + geoid + 0.6;
    const add = (lat, lon, h, color, size = 4) => this.rwyPoints.add({ position: Cesium.Cartesian3.fromRadians(lon, lat, h), color, pixelSize: size, scaleByDistance: new Cesium.NearFarScalar(100, 1.5, 12000, 0.5) });
    const hw = rwy.width / 2 + 1.5;
    for (let d = 0; d <= rwy.length; d += 60) {
      const t = d / rwy.length;
      const [la, lo] = off(rwy.lat, rwy.lon, brg, d);
      const color = t > 0.9 ? Cesium.Color.ORANGE : Cesium.Color.fromCssColorString('#fff6d8');
      for (const s of [-1, 1]) { const [a, b] = off(la, lo, perp, s * hw); add(a, b, elev(t), color); }
    }
    // threshold & end bars
    for (let k = -6; k <= 6; k++) {
      const [a, b] = off(rwy.lat, rwy.lon, perp, (k / 6) * hw);
      add(a, b, elev(0), Cesium.Color.LIME, 5);
      const [ea, eb] = off(rwy.endLat, rwy.endLon, perp, (k / 6) * hw);
      add(ea, eb, elev(1), Cesium.Color.RED, 5);
    }
    // approach lighting (ALSF-style), 900 m
    for (let d = 30; d <= 900; d += 30) {
      const [la, lo] = off(rwy.lat, rwy.lon, brg + Math.PI, d);
      for (let k = -2; k <= 2; k++) { const [a, b] = off(la, lo, perp, k * 1.2); add(a, b, rwy.elevM + geoid + 1.5, Cesium.Color.fromCssColorString('#ffffff'), 4); }
    }
    // PAPI at aim point, left side
    const [pla, plo] = off(rwy.lat, rwy.lon, brg, rwy.aim);
    this.papi = [];
    for (let k = 0; k < 4; k++) {
      const [a, b] = off(pla, plo, perp, -(hw + 15 + k * 9));
      const h = elev(rwy.aim / rwy.length) + 0.4;
      this.papi.push({ pt: add(a, b, h, Cesium.Color.WHITE, 7), lat: a, lon: b, h, th: [3.5, 3.17, 2.83, 2.5][k] });
    }
    this.papiRwy = rwy;
  }
  updatePapi(fm) {
    if (!this.papi) return;
    const Cesium = C();
    for (const p of this.papi) {
      const dx = (fm.lat - p.lat) * 6371008.8, dy = (fm.lon - p.lon) * 6371008.8 * Math.cos(fm.lat);
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(fm.h - p.h, dist) * R2D;
      p.pt.color = ang > p.th ? Cesium.Color.WHITE : Cesium.Color.RED;
    }
  }

  // ------------------------------------------------------------------ cameras
  updateCamera(fm, dt) {
    const Cesium = C();
    const cam = this.viewer.camera;
    const f = this.lastFrame || this.frame(fm);
    const c = this.cam;
    const L = fm.ac.length;
    const fovH = clamp(c.fov / c.zoom, 8, 110) * D2R;
    const aspect = this.viewer.canvas.clientWidth / Math.max(1, this.viewer.canvas.clientHeight);
    cam.frustum.fov = aspect >= 1 ? fovH : 2 * Math.atan(Math.tan(fovH / 2) / aspect);
    if (c.mode === 'cockpit') {
      cam.frustum.near = 0.1;
      const eye = this.ckMeta ? this.ckMeta.eye : this.physics.eye;
      const pos = this.modelPoint(f, eye);
      const t = performance.now() / 1000, a = c.shakeAmp || 0;
      const shY = a * (Math.sin(t * 37) * 0.6 + Math.sin(t * 23.3) * 0.4), shP = a * (Math.sin(t * 41.7) * 0.6 + Math.sin(t * 17.1) * 0.4);
      const cy = Math.cos(c.lookYaw + shY), sy = Math.sin(c.lookYaw + shY), cp = Math.cos(c.lookPitch + shP), sp = Math.sin(c.lookPitch + shP);
      const dirB = [cp * cy, cp * sy, -sp];
      const dir = f.bodyToFixed(dirB), up = f.bodyToFixed([-sp * cy, -sp * sy, -cp]);
      cam.setView({ destination: pos, orientation: { direction: dir, up } });
      return;
    }
    cam.frustum.near = 0.5;
    const e = quatToEuler(fm.q);
    const enuDir = (yaw, pitch) => { // yaw from north clockwise, pitch up
      const n = Math.cos(pitch) * Math.cos(yaw), ea = Math.cos(pitch) * Math.sin(yaw), u = Math.sin(pitch);
      return new Cesium.Cartesian3(f.N.x * n + f.E.x * ea + f.U.x * u, f.N.y * n + f.E.y * ea + f.U.y * u, f.N.z * n + f.E.z * ea + f.U.z * u);
    };
    const target = Cesium.Cartesian3.clone(f.pos);
    let camPos;
    if (c.mode === 'chase') {
      if (c.chaseYaw == null) c.chaseYaw = e.yaw;
      c.chaseYaw += wrapPi(e.yaw - c.chaseYaw) * Math.min(1, dt * 2.5);
      c.chasePitch = lerp(c.chasePitch ?? e.pitch, e.pitch, Math.min(1, dt * 2));
      const dist = (L * 1.25 + 14) / c.zoom;
      const back = enuDir(c.chaseYaw + Math.PI + c.lookYaw, -c.chasePitch * 0.6 + 0.16 + c.lookPitch);
      camPos = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(back, dist, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const tt = performance.now() / 1000, sa = (c.shakeAmp || 0) * dist;
      const aim = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(f.U, L * 0.12 + sa * Math.sin(tt * 31), new Cesium.Cartesian3()), new Cesium.Cartesian3());
      Cesium.Cartesian3.add(aim, Cesium.Cartesian3.multiplyByScalar(f.E, sa * Math.sin(tt * 27.3) * 0.7, new Cesium.Cartesian3()), aim);
      this.lookAt(camPos, aim, f);
    } else if (c.mode === 'orbit') {
      if (c.orbitDist == null) c.orbitDist = L * 1.6 + 10;
      const dir = enuDir(e.yaw + c.orbitYaw, c.orbitPitch);
      camPos = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(dir, c.orbitDist / c.zoom, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      this.lookAt(camPos, target, f);
    } else if (c.mode === 'tower') {
      // fly-by camera: placed ahead of the aircraft, re-positioned when it passes
      const need = !c.towerPos || Cesium.Cartesian3.distance(c.towerPos, target) > Math.max(1500, L * 40);
      if (need) {
        const ahead = Math.max(250, (fm.out.gs * 0.514) * 8);
        const fwd = enuDir(e.yaw, 0), side = enuDir(e.yaw + Math.PI / 2, 0);
        const p = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(fwd, ahead, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        Cesium.Cartesian3.add(p, Cesium.Cartesian3.multiplyByScalar(side, L * 1.2 + 25, new Cesium.Cartesian3()), p);
        const carto = Cesium.Cartographic.fromCartesian(p);
        const gh = this.groundFast(carto.latitude, carto.longitude);
        carto.height = Math.max(carto.height - 8, (gh ?? fm.groundH) + 3);
        c.towerPos = Cesium.Cartographic.toCartesian(carto);
      }
      camPos = c.towerPos;
      const d = Cesium.Cartesian3.distance(camPos, target);
      cam.frustum.fov = clamp(2 * Math.atan((L * 1.8) / d) * (1 / c.zoom), 3 * D2R, 70 * D2R);
      this.lookAt(camPos, target, f);
    }
    // keep chase/orbit camera above ground
    if (c.mode !== 'tower' && camPos) {
      const carto = Cesium.Cartographic.fromCartesian(cam.position);
      const gh = fm.groundH + 1.5;
      if (carto.height < gh) { carto.height = gh; const p = Cesium.Cartographic.toCartesian(carto); this.lookAt(p, target, f); }
    }
  }
  lookAt(pos, target, f) {
    const Cesium = C();
    const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(target, pos, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(dir, f.U, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3());
    this.viewer.camera.setView({ destination: pos, orientation: { direction: dir, up } });
  }
  resetCamera() { this.cam.chaseYaw = null; this.cam.towerPos = null; this.cam.lookYaw = 0; this.cam.lookPitch = 0; this.cam.zoom = 1; }

  // Menu background: slow orbit over a location
  menuOrbit(latD, lonD) {
    const Cesium = C();
    const cam = this.viewer.camera;
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.setTimeOfDay(11, lonD * Math.PI / 180); this.sunK = 1; this.applyNightTint();
    let a = 0;
    if (this._menuCb) this.viewer.scene.preUpdate.removeEventListener(this._menuCb);
    this._menuCb = () => {
      a += 0.0006;
      const center = Cesium.Cartesian3.fromDegrees(lonD, latD, 0);
      cam.lookAt(center, new Cesium.HeadingPitchRange(a, -0.35, 9000));
    };
    this.viewer.scene.preUpdate.addEventListener(this._menuCb);
  }
  stopMenuOrbit() {
    const Cesium = C();
    if (this._menuCb) this.viewer.scene.preUpdate.removeEventListener(this._menuCb);
    this._menuCb = null;
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
}
