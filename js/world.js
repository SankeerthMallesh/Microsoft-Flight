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
      baseLayer: false, shadows: false, msaaSamples: settings.quality === 'low' ? 1 : 4, requestRenderMode: false,
      contextOptions: { webgl: { powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserveBuffer } },
    });
    this.viewer = viewer;
    const scene = viewer.scene;
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.showGroundAtmosphere = true;
    scene.fog.enabled = true; scene.fog.density = 2.0e-4; scene.fog.minimumBrightness = 0.05;
    scene.skyAtmosphere.show = true;
    scene.highDynamicRange = settings.quality !== 'low';
    scene.postProcessStages.fxaa.enabled = true;
    scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.resolutionScale = settings.resolutionScale || Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.5 : 1);
    scene.camera.frustum.near = 0.2;
    viewer.cesiumWidget.creditContainer.style.display = 'block';
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 1;
    // lights
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.rwyPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.cloudCollection = scene.primitives.add(new Cesium.CloudCollection({ noiseDetail: 16 }));
    return viewer;
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
        const ts = await Cesium.createGooglePhotorealistic3DTileset(undefined, { maximumScreenSpaceError: this.settings.quality === 'high' ? 8 : 16, preloadFlightDestinations: true });
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
    const fog = { clear: 1.2e-4, few: 1.8e-4, scattered: 2.2e-4, broken: 3.5e-4, overcast: 6e-4, storm: 9e-4 }[preset] || 2e-4;
    scene.fog.density = fog;
    this.cloudCfg = {
      clear: { n: 0 }, few: { n: 40, base: 1400, top: 2200, size: 1.0 }, scattered: { n: 90, base: 1500, top: 2600, size: 1.2 },
      broken: { n: 160, base: 1200, top: 2600, size: 1.5 }, overcast: { n: 240, base: 900, top: 1800, size: 1.8, dark: true }, storm: { n: 260, base: 700, top: 2400, size: 2.1, dark: true },
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
      brightness: cfg.dark ? 0.55 + Math.random() * 0.2 : 0.9 + Math.random() * 0.1,
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
    this.nodes = { gear: model.getNode('gear'), props: [] };
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
    if (this.nodes.gear) this.nodes.gear.show = fm.gearPos > 0.25;
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
      const cy = Math.cos(c.lookYaw), sy = Math.sin(c.lookYaw), cp = Math.cos(c.lookPitch), sp = Math.sin(c.lookPitch);
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
      const aim = Cesium.Cartesian3.add(target, Cesium.Cartesian3.multiplyByScalar(f.U, L * 0.12, new Cesium.Cartesian3()), new Cesium.Cartesian3());
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
        const gh = this.groundHeight(carto.latitude, carto.longitude);
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
