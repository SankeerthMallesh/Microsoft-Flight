import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
import mathutils
mn = mathutils.Vector((1e9,)*3); mx = -mn
tot = 0
mats = {}
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    tot += len(o.data.polygons)
    for v in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(v)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
    for m in o.data.materials:
        if m: mats[m.name] = mats.get(m.name, 0) + len(o.data.polygons)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('meshes', len(objs), 'faces', tot)
print('bbox min', [round(x, 2) for x in mn], 'max', [round(x, 2) for x in mx], 'size', [round(b - a, 2) for a, b in zip(mn, mx)])
for o in sorted(objs, key=lambda o: -len(o.data.polygons))[:40]:
    d = o.dimensions
    print(f"  {o.name[:40]:40s} faces={len(o.data.polygons):7d} dim=({d.x:.2f},{d.y:.2f},{d.z:.2f}) mats={[m.name for m in o.data.materials if m][:4]}")
print('materials:')
for k, v in sorted(mats.items(), key=lambda kv: -kv[1]): print('  ', k, v)
imgs = [(i.name, i.size[:]) for i in bpy.data.images]
print('images', imgs[:30])
