# import a Sketchfab glTF and tag it like an assembled FlightGear model (x aft, z up, metres) for bl_fg_exterior / bl_fg_cockpit
import bpy, sys
from mathutils import Matrix
a = sys.argv[sys.argv.index('--') + 1:]
src, out, scale, tag = a[0], a[1], float(a[2]), a[3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.context.view_layer.update()
for o in list(bpy.data.objects):
    if o.type != 'MESH': continue
    mw = o.matrix_world.copy()
    if o.data.users > 1: o.data = o.data.copy()
    o.parent = None
    o.data.transform(Matrix.Scale(scale, 4) @ mw); o.matrix_world = Matrix.Identity(4)
    o['src'] = tag; o['path'] = ''
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
try: bpy.ops.file.pack_all()
except Exception as e: print('pack', e)
bpy.ops.wm.save_as_mainfile(filepath=out)
