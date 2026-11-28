# ray-cast image pixels (bl_eye camera: 960x540, 18 mm lens, 36 mm sensor) to FG-space points
import bpy, sys, math, json
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=a[0])
ex, ey, ez, pitch = map(float, a[1:5]); pix = json.loads(a[5])
eye = Vector((ex, ey, ez))
fwd = Vector((-math.cos(math.radians(pitch)), 0, math.sin(math.radians(pitch))))
q = fwd.to_track_quat('-Z', 'Y'); right = q @ Vector((1, 0, 0)); up = q @ Vector((0, 1, 0))
f = 480.0
dg = bpy.context.evaluated_depsgraph_get()
out = {}
for k, pts in pix.items():
    res = []
    for (px, py) in pts:
        d = (fwd * f + right * (px - 480) + up * (270 - py)).normalized()
        hit, loc, nrm, idx, ob, mtx = bpy.context.scene.ray_cast(dg, eye, d)
        res.append([round(loc.x, 4), round(loc.y, 4), round(loc.z, 4)] if hit else None)
        print(k, px, py, ob.name if hit else None, res[-1])
    out[k] = res
print('JSON', json.dumps(out))
