# Quick Cycles preview renders of a model from a few angles (CPU, low samples).
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=src)
else: bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
mn = mathutils.Vector((1e9,) * 3); mx = -mn
for o in sc.objects:
    if o.type != 'MESH': continue
    for v in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(v); mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
c = (mn + mx) / 2; R = (mx - mn).length / 2
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (0.7, 0.2, 0.8); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 35
sc.render.engine = 'CYCLES'; sc.cycles.samples = 12; sc.cycles.device = 'CPU'; sc.render.resolution_x = 640; sc.render.resolution_y = 360
try: sc.cycles.use_denoising = False
except Exception: pass
views = [(1, 0.35, 0.5), (-1, 0.35, 0.5), (0.0, 0.2, 1.0), (0.0, 1, 0.05)]
for i, (dx, dy, dz) in enumerate(views):
    d = mathutils.Vector((dx, dz, dy)).normalized() if False else mathutils.Vector((dx, dy, dz)).normalized()
    cam.location = c + d * R * 2.2
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}_{i}.png'
    bpy.ops.render.render(write_still=True)
print('bbox', [round(x, 2) for x in mn], [round(x, 2) for x in mx])
