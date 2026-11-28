# Export a FlightGear aircraft exterior into OpenSkies model space as a `detailed:` GLB + meta (bbox, gear contacts).
# Usage: python bl_fg_exterior.py -- in.blend out.glb ext.json
# Uses the same alignment as bl_fg_cockpit.py (exterior / extNames / xcg / groundFG+groundZ keys), so the exterior and
# the 3D cockpit exported from the same .blend line up exactly.
import bpy, sys, re, json, os
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
blend, out, cfgp = argv[0], argv[1], argv[2]
cfg = json.load(open(cfgp))
bpy.ops.wm.open_mainfile(filepath=blend)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
full = lambda o: o.get('src', '') + ':' + o.get('path', '') + '/' + o.name
ext = [o for o in objs if o.get('src') == cfg['exterior'] and re.search(cfg.get('extNames', ''), o.name)]
W = lambda o: [o.matrix_world @ v.co for v in o.data.vertices]
xs = [p.x for o in ext for p in W(o)]
noseFG = cfg.get('noseFG', min(xs))
zall = [p.z for o in ext for p in W(o)]
czFG = (min(zall) + max(zall)) / 2
if 'groundFG' in cfg and 'groundZ' in cfg: czFG = cfg['groundFG'] - cfg['groundZ']
xcg = cfg['xcg']
A = Matrix(((-1, 0, 0, xcg + noseFG), (0, -1, 0, 0), (0, 0, 1, -czFG), (0, 0, 0, 1)))
print('FG nose', noseFG, 'centre z', czFG)
keep = re.compile(cfg['keep']); drop = re.compile(cfg.get('drop', '^$'))
for o in list(objs):
    if not keep.search(o.get('src', '')) or drop.search(full(o)): bpy.data.objects.remove(o, do_unlink=True)
objs = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.polygons)]
for o in [o for o in bpy.data.objects if o.type == 'MESH' and not len(o.data.polygons)]: bpy.data.objects.remove(o, do_unlink=True)
# per-part decimation {regex on src:path/name: ratio}
for rx, ratio in cfg.get('decimate', {}).items():
    r = re.compile(rx); nd = 0
    for o in objs:
        if not r.search(full(o)): continue
        n = len(o.data.polygons)
        if o.data.users > 1: o.data = o.data.copy()
        md = o.modifiers.new('dec', 'DECIMATE'); md.ratio = ratio
        with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier='dec')
        nd += n - len(o.data.polygons)
    print('decimated', rx, nd)
for o in objs:
    if o.data.users > 1: o.data = o.data.copy()
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.data.transform(A); o.data.update()
# glass: plain tinted transparent material (BLEND, untextured so the web step keeps it blended)
if cfg.get('glass'):
    g = bpy.data.materials.new('GLASS'); g.use_nodes = True
    b = g.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*cfg.get('glassColor', [0.06, 0.07, 0.08]), 1)
    b.inputs['Alpha'].default_value = cfg.get('glassAlpha', 0.28); b.inputs['Roughness'].default_value = 0.05; b.inputs['Metallic'].default_value = 0.0
    g.blend_method = 'BLEND' if hasattr(g, 'blend_method') else None
    try: g.surface_render_method = 'BLENDED'
    except Exception: pass
    gr = re.compile(cfg['glass'])
    for o in objs:
        if gr.search(full(o)): o.data.materials.clear(); o.data.materials.append(g)
# untextured pure-white placeholder faces -> neutral grey
for m in bpy.data.materials:
    bn = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    if not bn: continue
    bn.inputs['Emission Strength'].default_value = 0.0
    if not any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) and m.name != 'GLASS' and min(bn.inputs['Base Color'].default_value[:3]) > 0.95:
        bn.inputs['Base Color'].default_value = (0.5, 0.52, 0.55, 1)
    bn.inputs['Metallic'].default_value = cfg.get('metallic', 0.15)
# gear groups + wheel contact points (model space)
contacts = {}
groups = {}
for key, rx in cfg.get('gear', {}).items():
    r = re.compile(rx); groups[key] = [o for o in objs if r.search(full(o))]
    tr = re.compile(cfg.get('tires', {}).get(key, rx))
    pts = [v.co for o in groups[key] if tr.search(full(o)) for v in o.data.vertices]
    if not pts: print('no gear for', key); continue
    zmin = min(p.z for p in pts); low = [p for p in pts if p.z < zmin + 0.03]
    contacts[key] = [sum(p.x for p in low) / len(low), sum(p.y for p in low) / len(low), zmin]
# put every wheel on the same contact plane (FlightGear models often sit the nose leg slightly higher)
if contacts and cfg.get('levelGear', True):
    zl = min(c[2] for c in contacts.values())
    for key, c in contacts.items():
        dz = zl - c[2]
        if abs(dz) > 1e-4:
            for o in groups[key]: o.data.transform(Matrix.Translation((0, 0, dz)))
            c[2] = zl
def join(lst, name):
    if not lst: return None
    for o in bpy.data.objects: o.select_set(o in lst)
    bpy.context.view_layer.objects.active = lst[0]
    if len(lst) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    return ob
ingear = {o.name for l in groups.values() for o in l}
body = [o for o in objs if o.name not in ingear]
for key, l in groups.items(): join(l, key)
join(body, 'body')
# texture budget
mx = cfg.get('maxTex', 2048)
for im in bpy.data.images:
    if im.size[0] > mx or im.size[1] > mx:
        f = mx / max(im.size); im.scale(max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f)))
allp = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices]
bbox = [[min(p[k] for p in allp) for k in range(3)], [max(p[k] for p in allp) for k in range(3)]]
meta = {'bbox': bbox, 'contacts': contacts, 'faces': sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')}
json.dump(meta, open(out.replace('.glb', '.meta.json'), 'w'), indent=1)
print('META', json.dumps(meta))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=False, export_apply=True, export_image_format='AUTO')
