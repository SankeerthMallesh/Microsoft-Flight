# Render the view from a given eye point inside a .blend (FG coordinates: x aft, y right, z up)
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
blend, out, ex, ey, ez, pitch = argv[0], argv[1], *map(float, argv[2:6])
yaw = float(argv[6]) if len(argv) > 6 else 0
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.75, 0.95, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 1.5
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.6, 0.3, 2.5); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 18; cam.data.clip_start = 0.02
cam.location = (ex, ey, ez)
# camera looks down its -Z; we want to look toward -X (forward in FG) with pitch
fwd = mathutils.Vector((-math.cos(math.radians(pitch)) * math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), math.sin(math.radians(pitch))))
cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.render.resolution_x = 960; sc.render.resolution_y = 540
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
