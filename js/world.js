// CesiumJS world: globe/scenery, aircraft model, lights, clouds, sky and cameras.
/* global Cesium */
import { D2R, R2D, clamp, lerp, qrot, quatToEuler, wrapPi } from './sim/math.js';

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
    viewer.resolutionScale = settings.resolutionScale || ({ high: 1, medium: 0.85, low: 0.6 }[settings.quality] ?? 0.85);
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
    try { scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT; } catch (e) { /* */ }
    // bloom: gentle glow on sun glare, bright paint and lights
    const bloom = pp.bloom;
    bloom.enabled = q !== 'low';
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
    if (this.tileset) { scene.primitives.remove(this.tileset); this.tileset = null; }
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
        const sse = { high: 6, medium: 10, low: 18 }[this.settings.quality] ?? 10;
        this.baseSSE = sse;
        const ts = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: sse, cacheBytes: 1536 * 1024 * 1024, maximumCacheOverflowBytes: 1024 * 1024 * 1024, preloadFlightDestinations: true, foveatedScreenSpaceError: true });
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

  // ---------------------------------------------------------------- adaptive quality
  // Keeps the frame rate smooth: first trims 3D-tile detail, then render resolution; restores when there's headroom.
  adaptQuality(fps) {
    const v = this.viewer; const target = this.targetScale ?? v.resolutionScale;
    this.targetScale = target;
    if (fps < 30) {
      if (this.tileset && this.tileset.maximumScreenSpaceError < (this.baseSSE || 10) * 2.4) this.tileset.maximumScreenSpaceError += 2;
      else v.resolutionScale = Math.max(0.5, +(v.resolutionScale - 0.1).toFixed(2));
    } else if (fps > 52) {
      if (v.resolutionScale < target) v.resolutionScale = Math.min(target, +(v.resolutionScale + 0.05).toFixed(2));
      else if (this.tileset && this.tileset.maximumScreenSpaceError > (this.baseSSE || 10)) this.tileset.maximumScreenSpaceError -= 1;
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
  // one-off calibration against the rendered 3D tiles (so wheels sit exactly on the photoreal runway)
  calibrateAirport(a) {
    const Cesium = C(), scene = this.viewer.scene;
    if (!this.tileset || !scene.sampleHeightSupported || !a.r.length) return false;
    const r = a.r[0];
    try {
      const h = scene.sampleHeight(Cesium.Cartographic.fromDegrees((r[2] + r[6]) / 2, (r[1] + r[5]) / 2), [this.points, this.rwyPoints, this.cloudCollection, ...(this.model ? [this.model] : [])], 2);
      const g = h - ((r[3] + r[7]) / 2) * 0.3048;
      if (h !== undefined && isFinite(h) && Math.abs(g) < 130) { this.aptGeoid[a.i] = g; return true; }
    } catch (e) { /* ignore */ }
    return false;
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
    this.model = model;
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
      this.model.lightColor = new Cesium.Cartesian3(k * 2.0, k * 1.95, k * 1.85);
      this.model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(k, k);
    }
    this.model.show = visible;
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
      const eye = this.physics.eye;
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
