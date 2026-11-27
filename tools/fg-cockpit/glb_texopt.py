# Re-encode GLB textures for the web: opaque -> JPEG, real alpha -> palettised PNG; cap size.
import json, struct, sys, io
from PIL import Image
inp, out = sys.argv[1], sys.argv[2]
MAXD = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
b = open(inp, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); old = b[28 + jl:]
new = bytearray(); views = j['bufferViews']; imgviews = {im['bufferView'] for im in j['images']}
remap = {}
def put(data):
    while len(new) % 4: new.append(0)
    off = len(new); new.extend(data); return off
saved = 0
for i, v in enumerate(views):
    data = old[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    if i in imgviews:
        im_meta = next(im for im in j['images'] if im['bufferView'] == i)
        try:
            im = Image.open(io.BytesIO(data)); im.load()
            if max(im.size) > MAXD:
                f = MAXD / max(im.size); im = im.resize((max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f))), Image.LANCZOS)
            o = io.BytesIO()
            has_alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 250
            if has_alpha:
                im.convert('RGBA').quantize(256, method=Image.FASTOCTREE).save(o, 'PNG', optimize=True); im_meta['mimeType'] = 'image/png'
            else:
                im.convert('L' if im.mode == 'L' else 'RGB').save(o, 'JPEG', quality=86, optimize=True); im_meta['mimeType'] = 'image/jpeg'
            nd = o.getvalue()
            if len(nd) < len(data): saved += len(data) - len(nd); data = nd
            else: im_meta['mimeType'] = 'image/png' if data[:4] == b'\x89PNG' else 'image/jpeg'
        except Exception as e: print('skip', im_meta.get('name'), e)
    v['byteOffset'] = put(data); v['byteLength'] = len(data)
while len(new) % 4: new.append(0)
j['buffers'][0]['byteLength'] = len(new)
js = json.dumps(j).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(new)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(new), 0x004E4942) + new)
print('saved MB', round(saved / 1e6, 1))
