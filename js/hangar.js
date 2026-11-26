// three.js hangar: shows the selected aircraft + livery on a turntable.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getAircraftGLB } from './model/factory.js';

export class Hangar {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1e24');
    scene.fog = new THREE.Fog('#1a1e24', 120, 320);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.6;
    // lights
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#2a2520', 0.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(60, 120, 40); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); const sc = key.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 400; key.shadow.bias = -0.0005;
    scene.add(key); this.key = key;
    const fill = new THREE.DirectionalLight('#9ec5ff', 0.7); fill.position.set(-80, 40, -60); scene.add(fill);
    // floor
    const floorMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.35, metalness: 0.2 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const lines = new THREE.GridHelper(400, 40, '#c9a227', '#2f343b'); lines.position.y = 0.01; lines.material.opacity = 0.35; lines.material.transparent = true; scene.add(lines);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 96), new THREE.MeshStandardMaterial({ color: '#23272d', roughness: 0.25, metalness: 0.6 }));
    disc.position.y = 0.06; disc.receiveShadow = true; scene.add(disc); this.disc = disc;
    // hangar shell
    const shell = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: '#2a2f36', roughness: 0.8, side: THREE.BackSide });
    const hall = new THREE.Mesh(new THREE.CylinderGeometry(180, 180, 90, 48, 1, true, 0, Math.PI * 2), wallMat); hall.position.y = 45; shell.add(hall);
    const lightMat = new THREE.MeshBasicMaterial({ color: '#fff7e0' });
    for (let i = -4; i <= 4; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(300, 0.6, 1.4), lightMat); bar.position.set(0, 70, i * 22); shell.add(bar); }
    scene.add(shell);
    this.loader = new GLTFLoader();
    this.current = null; this.spinners = [];
    this.running = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  async show(acId, liveryId, ac) {
    const token = (this.token = {});
    const { glb } = await getAircraftGLB(acId, liveryId);
    if (token !== this.token) return;
    const gltf = await new Promise((res, rej) => this.loader.parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res, rej));
    if (token !== this.token) return;
    if (this.current) { this.scene.remove(this.current); this.current.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); }
    const root = gltf.scene;
    root.rotation.x = -Math.PI / 2; // model is Z-up
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 8; } });
    const holder = new THREE.Group(); holder.add(root);
    // sit on the floor
    const box = new THREE.Box3().setFromObject(holder);
    holder.position.y = -box.min.y + 0.12;
    this.scene.add(holder); this.current = holder;
    this.spinners = [];
    root.traverse((o) => { if (/^(fan|prop)\d/.test(o.name)) this.spinners.push(o); });
    const size = box.getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.z) * 0.5;
    this.disc.scale.set(R * 1.15, 1, R * 1.15);
    if (!this.framedFor || this.framedFor !== acId) {
      this.framedFor = acId;
      const d = R * 2.3 + 6;
      this.camera.position.set(d * 0.8, size.y * 0.9 + R * 0.35, d * 0.75);
      this.controls.target.set(0, size.y * 0.35, 0);
      this.controls.minDistance = R * 0.6; this.controls.maxDistance = R * 6 + 40;
    }
    this.key.shadow.camera.left = -R * 1.3; this.key.shadow.camera.right = R * 1.3; this.key.shadow.camera.top = R * 1.3; this.key.shadow.camera.bottom = -R * 1.3; this.key.shadow.camera.updateProjectionMatrix();
  }
  start() {
    if (this.running) return; this.running = true;
    let last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      this.resize();
      for (const s of this.spinners) s.rotation.x += dt * (s.name.startsWith('prop') ? 2 : 4);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
}
