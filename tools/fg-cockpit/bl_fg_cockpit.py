# Export the FlightGear cockpit (interior only) into OpenSkies model space + screen/eye metadata.
import bpy, sys, re, json, math, mathutils, os
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
blend, out, cfgp = argv[0], argv[1], argv[2]
cfg = json.load(open(cfgp))
bpy.ops.wm.open_mainfile(filepath=blend)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
ext = [o for o in objs if o.get('src') == cfg['exterior'] and re.search(cfg.get('extNames', ''), o.name)]
W = lambda o: [o.matrix_world @ v.co for v in o.data.vertices]
xs = [p.x for o in ext for p in W(o)]
noseFG = min(xs); L = max(xs) - noseFG
zall = [p.z for o in ext for p in W(o)]
czFG = (min(zall) + max(zall)) / 2
# optional: put FlightGear's ground plane on the OpenSkies ground plane so the eye height above the wheels is real
if 'groundFG' in cfg and 'groundZ' in cfg: czFG = cfg['groundFG'] - cfg['groundZ']
print('FG nose', noseFG, 'len', L, 'centre z', czFG)
xcg = cfg['xcg']
# FG (x aft, y right, z up) -> sim (x fwd, y left, z up), nose aligned
A = Matrix(((-1, 0, 0, xcg + noseFG), (0, -1, 0, 0), (0, 0, 1, -czFG), (0, 0, 0, 1)))
keep = re.compile(cfg['keep']); drop = re.compile(cfg.get('dropNames', '^$'))
dropsn = re.compile(cfg.get('dropSrcNames', '^$'))  # matched against '<src.ac>:<object name>'
dropp = re.compile(cfg.get('dropPaths', '^$'))  # matched against '<src.ac>:<AC3D group path>/<object name>' (variant groups)
dropx = cfg.get('dropAftOf')  # {src regex: FG x}: drop objects of that source centred aft of x (e.g. a rear cockpit)
def aft(o):
    if not dropx: return False
    for rx, x0 in dropx.items():
        if re.search(rx, o.get('src', '')):
            vs = o.data.vertices
            if vs and sum((o.matrix_world @ v.co).x for v in vs) / len(vs) > x0: return True
    return False
for o in list(objs):
    kept = o.get('src') == 'added' or keep.search(o.get('src', '')) or (cfg.get('keepNames') and o.get('src') == cfg['exterior'] and re.search(cfg['keepNames'], o.name))
    if not kept or drop.search(o.name) or dropsn.search(o.get('src', '') + ':' + o.name) or dropp.search(o.get('src', '') + ':' + o.get('path', '') + '/' + o.name) or aft(o):
        bpy.data.objects.remove(o, do_unlink=True)
# optional: extra flat quads (FG coords, 4 corners) to cap holes, e.g. a display unit missing its screen face
for qn, qp in cfg.get('addQuads', {}).items():
    me = bpy.data.meshes.new(qn); me.from_pydata([Vector(p) for p in qp], [], [(0, 1, 2, 3)]); me.update()
    qo = bpy.data.objects.new(qn, me); qo['src'] = 'added'; bpy.context.scene.collection.objects.link(qo)
    mq = bpy.data.materials.new(qn); mq.use_nodes = True
    mq.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.012, 0.013, 0.015, 1); me.materials.append(mq)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
# optional: collapse-decimate over-dense small parts (knobs, screws, cords) to keep the web GLB small
dec = cfg.get('decimateOver')
if dec:
    nd = 0
    for o in objs:
        n = len(o.data.polygons)
        if n > dec and not any(o.name in v for v in cfg['screens'].values()):
            if o.data.users > 1: o.data = o.data.copy()
            md = o.modifiers.new('dec', 'DECIMATE'); md.ratio = max(cfg.get('decimateMin', 0.1), dec / n)
            bpy.context.view_layer.objects.active = o
            with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier='dec')
            nd += n - len(o.data.polygons)
    print('decimated faces', nd)
for o in objs:
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.data.transform(A); o.data.update()
    if A.determinant() < 0: o.data.flip_normals()
# screens: oriented rectangle corners TL, TR, BR, BL as seen from the pilot
# a screen is one object, or the union of several ("+" first: e.g. a display split into two halves);
# optional screenCrop {key: [u0, u1, v0, v1]} keeps a sub-rectangle (fractions, left->right, bottom->top)
screens = {}
byname = {o.name: o for o in objs}
for key, names in cfg['screens'].items():
    sel = [byname[n] for n in names[1:] if n in byname] if names[0] == '+' else [byname[n] for n in names if n in byname][:1]
    if not sel: print('screen missing', key, names); continue
    if True:
            pts = [v.co.copy() for o in sel for v in o.data.vertices]
            c = sum(pts, Vector()) / len(pts)
            n = sum((p.normal * p.area for o in sel for p in o.data.polygons), Vector()).normalized()
            if n.x < 0: n = -n  # face the pilot (aft = -x)
            u = Vector((0, 1, 0)); u = (u - n * u.dot(n)).normalized()  # 'left' in the screen plane
            v = n.cross(u).normalized()
            if v.z < 0: v = -v
            us = [(p - c).dot(u) for p in pts]; vs = [(p - c).dot(v) for p in pts]
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            cr = cfg.get('screenCrop', {}).get(key)
            if cr:  # u runs to the pilot's left, so 'left' fraction 0 is u1
                U0, U1 = u1 - (u1 - u0) * cr[1], u1 - (u1 - u0) * cr[0]
                v0, v1 = v0 + (v1 - v0) * cr[2], v0 + (v1 - v0) * cr[3]; u0, u1 = U0, U1
            corner = lambda a, b: list(c + u * a + v * b)
            screens[key] = [corner(u1, v1), corner(u0, v1), corner(u0, v0), corner(u1, v0)]  # TL TR BR BL
# explicit screen quads (FG coords, TL TR BR BL as seen by the pilot), e.g. a curved HUD combiner whose mesh gives no clean plane
for key, qp in cfg.get('screenQuadsFG', {}).items():
    screens[key] = [list(A @ Vector(p)) for p in qp]
# screen objects become plain dark glass (the live canvas covers them; cropped margins must not show FG page textures)
if cfg.get('darkScreens'):
    glass = bpy.data.materials.new('screenGlass'); glass.use_nodes = True
    gb = glass.node_tree.nodes['Principled BSDF']; gb.inputs['Base Color'].default_value = (0.012, 0.013, 0.015, 1); gb.inputs['Roughness'].default_value = 0.55
    for key, names in cfg['screens'].items():
        if key == 'hud': continue  # the HUD combiner stays clear glass
        for nm in names:
            if nm in byname: byname[nm].data.materials.clear(); byname[nm].data.materials.append(glass)
    if cfg.get('darkNames'):  # other blank display surfaces (e.g. MFDs with no live page)
        for o in objs:
            if re.search(cfg['darkNames'], o.name): o.data.materials.clear(); o.data.materials.append(glass)
# canopy / windscreen glass: one tinted transparent material, kept out of the AO bake
glassObjs = []
if cfg.get('glass'):
    gm = bpy.data.materials.new('GLASS'); gm.use_nodes = True
    gb2 = gm.node_tree.nodes['Principled BSDF']
    gb2.inputs['Base Color'].default_value = (*cfg.get('glassColor', [0.05, 0.06, 0.07]), 1); gb2.inputs['Alpha'].default_value = cfg.get('glassAlpha', 0.12)
    gb2.inputs['Roughness'].default_value = 0.05
    try: gm.surface_render_method = 'BLENDED'
    except Exception: pass
    for o in objs:
        if re.search(cfg['glass'], o.get('path', '') + '/' + o.name): o.data.materials.clear(); o.data.materials.append(gm); glassObjs.append(o)
eyeFG = Vector(cfg['eyeFG'])
eye = list(A @ eyeFG)
# untextured pure-white faces are placeholders for external FG instrument packs: make them dark glass/bezel
for m in bpy.data.materials:
    if not m.node_tree: continue
    b = m.node_tree.nodes.get('Principled BSDF')
    if b and m.name != 'GLASS' and not any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) and min(b.inputs['Base Color'].default_value[:3]) > 0.9:
        b.inputs['Base Color'].default_value = (0.035, 0.037, 0.04, 1); b.inputs['Roughness'].default_value = 0.35
for m in bpy.data.materials:
    b = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    if b: b.inputs['Emission Strength'].default_value = 0.0
# shrink big textures for the web
for im in bpy.data.images:
    if im.size[0] > 1024 or im.size[1] > 1024:
        f = 1024 / max(im.size); im.scale(max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f)))
meta = {'eye': eye, 'pitchDeg': cfg.get('pitchDeg', -8), 'screens': screens, 'faces': sum(len(o.data.polygons) for o in objs), 'objects': len(objs)}
json.dump(meta, open(out.replace('.glb', '.meta.json'), 'w'), indent=1)
print('META', json.dumps(meta)[:600])
if os.environ.get('AOBAKE'):
    import time; t0 = time.time()
    res = int(os.environ.get('AOBAKE'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o not in glassObjs]
    for o in bpy.data.objects: o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    me = ob.data
    base_uv = me.uv_layers[0].name if len(me.uv_layers) else None
    if base_uv is None: me.uv_layers.new(name='UVMap')
    for l in me.uv_layers: l.active_render = False
    me.uv_layers[0].active_render = True
    ao_uv = me.uv_layers.new(name='AOUV'); me.uv_layers.active = ao_uv
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0015, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    print('uv done', round(time.time() - t0, 1), 'faces', len(me.polygons))
    img = bpy.data.images.new('cockpitAO', res, res, alpha=False); img.colorspace_settings.name = 'Non-Color'
    grp = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if not any(getattr(i, 'name', '') == 'Occlusion' for i in grp.interface.items_tree):
        grp.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    for m in me.materials:
        if not m or not m.node_tree: continue
        nt = m.node_tree
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'AOUV'
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img; tn.interpolation = 'Linear'
        nt.links.new(uvn.outputs['UV'], tn.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(tn.outputs['Color'], sep.inputs['Color'])
        gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp
        nt.links.new(sep.outputs[0], gn.inputs['Occlusion'])
        for n in nt.nodes: n.select = False
        tn.select = True; nt.nodes.active = tn
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('AOSAMPLES', '48')); sc.cycles.device = 'CPU'
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = float(os.environ.get('AODIST', '0.3'))
    sc.render.bake.margin = 6
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    print('bake done', round(time.time() - t0, 1))
    # gentle curve so AO darkens crevices without crushing flat panels
    import numpy as np
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    v = px[:, 0]; v = np.clip(0.18 + 0.82 * np.power(v, 0.8), 0, 1)
    px[:, 0] = px[:, 1] = px[:, 2] = v; img.pixels = px.ravel().tolist()
    img.filepath_raw = os.path.abspath(out.replace('.glb', '-ao.png')); img.file_format = 'PNG'; img.save(); img.pack()
    me.uv_layers.active = me.uv_layers[0]
if os.environ.get('CKRENDER'):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.6, 0.3, 2.5); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 18; cam.data.clip_start = 0.02; cam.location = eye
    fwd = mathutils.Vector((math.cos(0.4), 0, -math.sin(0.4))); cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.render.resolution_x = 960; sc.render.resolution_y = 540
    sc.render.filepath = os.environ['CKRENDER']; bpy.ops.render.render(write_still=True); sys.exit(0)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=False, export_apply=True, export_image_format='AUTO')
