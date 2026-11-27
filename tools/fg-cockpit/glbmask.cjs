const fs = require('fs'); const [inp, out] = process.argv.slice(2);
const b = fs.readFileSync(inp); const l = b.readUInt32LE(12); const j = JSON.parse(b.slice(20, 20 + l)); const bin = b.slice(20 + l);
let n = 0; for (const m of j.materials) if (m.alphaMode === 'BLEND' && m.pbrMetallicRoughness?.baseColorTexture) { m.alphaMode = 'MASK'; m.alphaCutoff = 0.5; n++; }
let js = Buffer.from(JSON.stringify(j)); const pad = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const hdr = Buffer.alloc(20); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(20 + js.length + bin.length, 8); hdr.writeUInt32LE(js.length, 12); hdr.writeUInt32LE(0x4e4f534a, 16);
fs.writeFileSync(out, Buffer.concat([hdr, js, bin])); console.log('masked', n, 'remaining blend', j.materials.filter((m) => m.alphaMode === 'BLEND').length);
