import bpy, sys, mathutils
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
rows = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    mn = mathutils.Vector(map(min, *ws)) if len(ws) > 1 else ws[0]; mx = mathutils.Vector(map(max, *ws)) if len(ws) > 1 else ws[0]
    m = o.data.materials[0] if o.data.materials else None
    col = None; tex = False
    if m and m.use_nodes:
        b = m.node_tree.nodes.get('Principled BSDF')
        if b: col = tuple(round(c, 2) for c in b.inputs['Base Color'].default_value[:3]); tex = bool(b.inputs['Base Color'].links)
    rows.append((mx.y - mn.y, o.name, len(o.data.polygons), [round(v, 2) for v in mn], [round(v, 2) for v in mx], m.name if m else None, col, tex, m.blend_method if m else None))
rows.sort(key=lambda r: -r[0])
for r in rows[:45]: print(f"{r[0]:6.2f} {r[1][:34]:34s} f={r[2]:6d} min={r[3]} max={r[4]} {r[5]} col={r[6]} tex={r[7]}")
