// Minimal binary glTF 2.0 (GLB) writer for the procedural aircraft.

function pad4(n) { return (n + 3) & ~3; }

export function writeGLB(nodes, pngBytes, opts = {}) {
  const bufferViews = [], accessors = [], meshes = [], gltfNodes = [];
  const chunks = [];
  let offset = 0;
  function addView(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const len = bytes.byteLength;
    chunks.push({ bytes, offset });
    const view = { buffer: 0, byteOffset: offset, byteLength: len };
    if (target) view.target = target;
    bufferViews.push(view);
    offset = pad4(offset + len);
    return bufferViews.length - 1;
  }
  function minmax(arr) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); }
    return [mn, mx];
  }
  const children = [];
  for (const n of nodes) {
    if (!n.indices.length) continue;
    const [mn, mx] = minmax(n.positions);
    const pv = addView(n.positions, 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count: n.positions.length / 3, type: 'VEC3', min: mn, max: mx });
    const pa = accessors.length - 1;
    const nv = addView(n.normals, 34962);
    accessors.push({ bufferView: nv, componentType: 5126, count: n.normals.length / 3, type: 'VEC3' });
    const na = accessors.length - 1;
    const uvv = addView(n.uvs, 34962);
    accessors.push({ bufferView: uvv, componentType: 5126, count: n.uvs.length / 2, type: 'VEC2' });
    const ua = accessors.length - 1;
    const iv = addView(n.indices, 34963);
    accessors.push({ bufferView: iv, componentType: 5125, count: n.indices.length, type: 'SCALAR' });
    const ia = accessors.length - 1;
    meshes.push({ name: n.name, primitives: [{ attributes: { POSITION: pa, NORMAL: na, TEXCOORD_0: ua }, indices: ia, material: 0 }] });
    const node = { name: n.name, mesh: meshes.length - 1 };
    if (n.translation && n.translation.some((v) => v !== 0)) {
      // geometry of animated nodes is relative to their pivot
      node.translation = n.translation;
    }
    gltfNodes.push(node);
    children.push(gltfNodes.length - 1);
  }
  const imgView = addView(pngBytes);
  const gltf = {
    asset: { version: '2.0', generator: 'OpenSkies procedural aircraft' },
    scene: 0,
    scenes: [{ nodes: [gltfNodes.length] }],
    nodes: [...gltfNodes, { name: 'aircraft', children }],
    meshes,
    materials: [{
      name: 'livery',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: opts.metallic ?? 0.15, roughnessFactor: opts.roughness ?? 0.42 },
      doubleSided: true,
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imgView, mimeType: 'image/png' }],
    accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const bin = new Uint8Array(offset);
  for (const c of chunks) bin.set(c.bytes, c.offset);
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = pad4(json.length);
  const jsonBytes = new Uint8Array(jsonLen).fill(0x20);
  jsonBytes.set(json);
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, jsonLen).set(jsonBytes);
  dv.setUint32(20 + jsonLen, bin.length, true); dv.setUint32(24 + jsonLen, 0x004e4942, true);
  new Uint8Array(out, 28 + jsonLen).set(bin);
  return new Uint8Array(out);
}
