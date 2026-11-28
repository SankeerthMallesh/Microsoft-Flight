// Afterburner flames for reheat-equipped (military) types.
// Aircraft data: `afterburner: { nozzles: [[x, y, z, r], ...] }` in model space (x fwd, y left, z up; r = nozzle exit radius, m).
// addFlames() appends one flame node per nozzle ('ab0', 'ab1', ...) to a GLB; updateFlames() scales them each frame from
// the engine reheat level (Engine.ab, 0..1) so the plume grows, brightens and flickers with the throttle.
import { parseGLB, buildGLB } from './glb.js';

const pad4 = (n) => (n + 3) & ~3;
const SEG = 24;

// flame along -x from the nozzle: unit length, unit exit radius; layers from a hot white core to a pale blue-orange sheath
function cone(len, r0, r1, rings = 6) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, x = -len * t;
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8) + 0.12 * r0 * Math.sin(t * Math.PI * 3) * (1 - t); // faint shock-diamond waist
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      pos.push(x, Math.cos(a) * r, Math.sin(a) * r); nrm.push(0, Math.cos(a), Math.sin(a));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < SEG; j++) {
    const a = i * (SEG + 1) + j, b = a + SEG + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}
const LAYERS = [
  { len: 1.0, r0: 0.95, r1: 0.25, color: [1.0, 0.45, 0.12, 0.28] }, // orange sheath
  { len: 0.72, r0: 0.8, r1: 0.18, color: [1.0, 0.75, 0.4, 0.42] }, // yellow body
  { len: 0.42, r0: 0.6, r1: 0.12, color: [0.75, 0.85, 1.0, 0.6] }, // blue-white core
];

export function addFlames(bytes, nozzles) {
  if (!nozzles || !nozzles.length) return bytes;
  const { json, bin } = parseGLB(bytes);
  const parts = []; let off = pad4(bin.length);
  const meshes = LAYERS.map((L) => cone(L.len, L.r0, L.r1));
  for (const m of meshes) for (const [arr, target] of [[m.pos, 34962], [m.nrm, 34962], [m.idx, 34963]]) {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); parts.push({ b, off, target, arr }); off = pad4(off + b.length);
  }
  const nb = new Uint8Array(off); nb.set(bin); for (const p of parts) nb.set(p.b, p.off);
  json.buffers[0].byteLength = nb.length;
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_materials_unlit'])];
  json.materials = json.materials || []; json.meshes = json.meshes || [];
  const prims = [];
  meshes.forEach((m, li) => {
    const acc = [];
    for (let k = 0; k < 3; k++) {
      const p = parts[li * 3 + k];
      json.bufferViews.push({ buffer: 0, byteOffset: p.off, byteLength: p.b.length, target: p.target });
      const a = { bufferView: json.bufferViews.length - 1, componentType: k === 2 ? 5123 : 5126, count: k === 2 ? p.arr.length : p.arr.length / 3, type: k === 2 ? 'SCALAR' : 'VEC3' };
      if (k === 0) { a.min = [-1, -1.2, -1.2]; a.max = [0, 1.2, 1.2]; }
      json.accessors.push(a); acc.push(json.accessors.length - 1);
    }
    json.materials.push({ name: 'AB_FLAME_' + li, alphaMode: 'BLEND', doubleSided: true, emissiveFactor: LAYERS[li].color.slice(0, 3),
      pbrMetallicRoughness: { baseColorFactor: LAYERS[li].color, metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } });
    prims.push({ attributes: { POSITION: acc[0], NORMAL: acc[1] }, indices: acc[2], material: json.materials.length - 1 });
  });
  json.meshes.push({ name: 'abFlame', primitives: prims });
  const mesh = json.meshes.length - 1;
  nozzles.forEach((nz, i) => {
    // hidden (zero length) until the reheat lights
    json.nodes.push({ name: 'ab' + i, mesh, translation: [nz[0], nz[1], nz[2]], scale: [0.001, 0.001, 0.001] });
    json.scenes[json.scene || 0].nodes.push(json.nodes.length - 1);
  });
  return buildGLB(json, nb);
}

// called every frame by the world (Cesium model nodes)
export function updateFlames(world, fm) {
  const nz = fm.ac.afterburner?.nozzles; const model = world.model;
  if (!nz || !model) return;
  const Cesium = window.Cesium;
  if (world._abNodes === undefined || world._abModel !== model) { world._abModel = model; world._abNodes = nz.map((_, i) => model.getNode('ab' + i)); }
  const t = performance.now() / 1000;
  nz.forEach((p, i) => {
    const node = world._abNodes[i]; if (!node) return;
    const e = fm.engines[i % fm.engines.length];
    const ab = e && e.running ? e.ab || 0 : 0;
    const r = p[3];
    if (ab < 0.02) { node.matrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(0, 0, 0)); return; }
    const flick = 1 + 0.06 * Math.sin(t * 37 + i * 2.1) + 0.04 * Math.sin(t * 61 + i);
    // plume length ~ 3-8 nozzle diameters, shorter (and tighter) at high speed
    const len = r * (3 + 7 * ab) * flick * (1 - 0.25 * Math.min(1, (fm.out?.mach || 0) / 2));
    const rad = r * (0.75 + 0.2 * ab);
    node.matrix = Cesium.Matrix4.fromTranslationRotationScale(new Cesium.TranslationRotationScale(
      new Cesium.Cartesian3(p[0], p[1], p[2]), Cesium.Quaternion.IDENTITY, new Cesium.Cartesian3(len, rad, rad)));
  });
}
