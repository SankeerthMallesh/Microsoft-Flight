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

// ---------------------------------------------------------------- patching existing GLBs
export function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off < bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}
export function buildGLB(json, bin) {
  const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad4(jsonBytesRaw.length), bl = pad4(bin.length);
  const total = 12 + 8 + jl + 8 + bl;
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl); out.set(jsonBytesRaw, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexLinear(hex) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1];
}
// Swap the LIVERY material's texture for a freshly painted PNG and tint ENGINE/WING paint.
export function patchDetailedGLB(bytes, png, colors, extraNodes = []) {
  const { json, bin } = parseGLB(bytes);
  // optional extra meshes (e.g. procedural landing gear for models built without gear), textured by the livery atlas
  const extra = [];
  let off = pad4(bin.length + 0);
  const parts = [];
  for (const n of extraNodes) {
    for (const [arr, target] of [[n.positions, 34962], [n.normals, 34962], [n.uvs, 34962], [n.indices, 34963]]) {
      const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      parts.push({ b, off, target }); off = pad4(off + b.length);
    }
  }
  const start = off;
  const nb = new Uint8Array(pad4(start + png.length));
  nb.set(bin); for (const p of parts) nb.set(p.b, p.off); nb.set(png, start);
  if (extraNodes.length) {
    const livIdx = (json.materials || []).findIndex((m) => m.name === 'LIVERY');
    let pi = 0;
    for (const n of extraNodes) {
      const acc = [];
      for (const [arr, type, comp] of [[n.positions, 'VEC3', 5126], [n.normals, 'VEC3', 5126], [n.uvs, 'VEC2', 5126], [n.indices, 'SCALAR', 5125]]) {
        const p = parts[pi++];
        json.bufferViews.push({ buffer: 0, byteOffset: p.off, byteLength: p.b.length, target: p.target });
        const a = { bufferView: json.bufferViews.length - 1, componentType: comp, count: arr.length / (type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1), type };
        if (type === 'VEC3' && acc.length === 0) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); } a.min = mn; a.max = mx; }
        json.accessors.push(a); acc.push(json.accessors.length - 1);
      }
      json.meshes.push({ name: n.name, primitives: [{ attributes: { POSITION: acc[0], NORMAL: acc[1], TEXCOORD_0: acc[2] }, indices: acc[3], material: livIdx }] });
      json.nodes.push({ name: n.name, mesh: json.meshes.length - 1, ...(n.translation && n.translation.some((v) => v) ? { translation: n.translation } : {}) });
      json.scenes[json.scene || 0].nodes.push(json.nodes.length - 1);
    }
  }
  json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: png.length });
  const view = json.bufferViews.length - 1;
  json.buffers[0].byteLength = nb.length;
  for (const m of json.materials || []) {
    const pbr = (m.pbrMetallicRoughness = m.pbrMetallicRoughness || {});
    if (m.name === 'LIVERY' && pbr.baseColorTexture) {
      const tex = json.textures[pbr.baseColorTexture.index];
      json.images[tex.source] = { bufferView: view, mimeType: 'image/png', name: 'livery' };
      json.samplers = json.samplers || []; json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 });
      tex.sampler = json.samplers.length - 1;
      pbr.baseColorFactor = [1, 1, 1, 1]; pbr.metallicFactor = 0.08; pbr.roughnessFactor = 0.3;
    } else if (m.name.startsWith('ENGINE_PAINT') && colors.engine) { pbr.baseColorFactor = hexLinear(colors.engine); delete pbr.baseColorTexture; pbr.roughnessFactor = 0.35; }
    else if (m.name.startsWith('WING_PAINT') && colors.wing) { pbr.baseColorFactor = hexLinear(colors.wing); delete pbr.baseColorTexture; pbr.roughnessFactor = 0.45; }
  }
  return buildGLB(json, nb);
}

// Merge procedural aircraft nodes into one mesh for static / distant instances (parked aircraft, AI traffic):
// ~25 draw calls per aircraft become 1 (+ the nodes matching `keep`, e.g. landing gear that must toggle).
export function mergeNodes(nodes, keep = null) {
  const kept = [], parts = [];
  for (const n of nodes) { if (!n.indices.length) continue; (keep && keep.test(n.name) ? kept : parts).push(n); }
  if (parts.length < 2) return nodes;
  let nv = 0, ni = 0;
  for (const n of parts) { nv += n.positions.length / 3; ni += n.indices.length; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const n of parts) {
    const t = n.translation || [0, 0, 0], cnt = n.positions.length / 3;
    for (let i = 0; i < cnt; i++) {
      positions[(vo + i) * 3] = n.positions[i * 3] + t[0]; positions[(vo + i) * 3 + 1] = n.positions[i * 3 + 1] + t[1]; positions[(vo + i) * 3 + 2] = n.positions[i * 3 + 2] + t[2];
    }
    normals.set(n.normals, vo * 3); uvs.set(n.uvs, vo * 2);
    for (let i = 0; i < n.indices.length; i++) indices[io + i] = n.indices[i] + vo;
    vo += cnt; io += n.indices.length;
  }
  return [{ name: 'body', positions, normals, uvs, indices }, ...kept];
}
