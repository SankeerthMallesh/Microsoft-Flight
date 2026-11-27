# Replace the baked AO image inside a GLB with a compact greyscale JPEG.
import json, struct, sys, io
from PIL import Image
inp, out = sys.argv[1], sys.argv[2]
b = open(inp, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); bin_ = bytearray(b[28 + jl:])
for im in j['images']:
    if not (im.get('name') or '').lower().endswith('-ao') and 'cockpitao' not in (im.get('name') or '').lower(): continue
    bv = j['bufferViews'][im['bufferView']]
    src = Image.open(io.BytesIO(bytes(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))).convert('L')
    o = io.BytesIO(); src.save(o, 'JPEG', quality=88, optimize=True); data = o.getvalue()
    while len(bin_) % 4: bin_.append(0)
    bv['byteOffset'] = len(bin_); bv['byteLength'] = len(data); bin_ += data
    im['mimeType'] = 'image/jpeg'; print('AO jpeg', len(data))
while len(bin_) % 4: bin_.append(0)
j['buffers'][0]['byteLength'] = len(bin_)
js = json.dumps(j).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bin_)
