# Prepare a Sketchfab airliner for OpenSkies:
#  - convert to sim model space (x fwd, y left, z up), real-world proportions
#  - align centre of gravity / fuselage centre line with the procedural builder
#  - assign fuselage + fin faces to a LIVERY material with UVs in the livery atlas layout
#  - tag engine cowls / wings for livery colours, group gear into hideable nodes
# Usage: python bl_prepare.py -- in.glb out.glb config.json
import bpy, bmesh, sys, json, math, mathutils
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out, cfgp = argv[0], argv[1], argv[2]
cfg = json.load(open(cfgp))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene

# ---- bake transforms, drop non-mesh helpers
meshes = [o for o in sc.objects if o.type == 'MESH']
for o in list(sc.objects):
    if o.type != 'MESH': continue
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
for name in cfg.get('drop', []):
    for o in [o for o in sc.objects if o.name.startswith(name)]: bpy.data.objects.remove(o, do_unlink=True)

# ---- source axes -> sim axes.  cfg.fwd / cfg.up are source axis names like "-Y", "+Z"
def axis_vec(a):
    s = -1 if a[0] == '-' else 1
    return Vector({'X': (s, 0, 0), 'Y': (0, s, 0), 'Z': (0, 0, s)}[a[1]])
def auto_fwd():
    # long axis = horizontal axis along which the fin tip (highest point) sits far from the centre; nose is the other end
    vs = [v.co for o in sc.objects for v in o.data.vertices]
    mn = Vector(map(min, *vs)); mx = Vector(map(max, *vs)); c = (mn + mx) / 2
    top = max(vs, key=lambda v: v.z)
    dx, dy = (top.x - c.x) / max(1e-6, mx.x - mn.x), (top.y - c.y) / max(1e-6, mx.y - mn.y)
    if abs(dx) > abs(dy): return '-X' if dx > 0 else '+X'
    return '-Y' if dy > 0 else '+Y'
if cfg.get('fwd', 'auto') == 'auto': cfg['fwd'] = auto_fwd(); print('auto fwd', cfg['fwd'])
cfg.setdefault('up', '+Z')
F, U = axis_vec(cfg['fwd']), axis_vec(cfg['up'])
Lf = U.cross(F)  # left
M = mathutils.Matrix((F, Lf, U))  # rows: new x, y, z expressed in source coords
for o in sc.objects:
    o.data.transform(M.to_4x4())
    o.data.update()

def bbox(objs):
    mn = Vector((1e9,) * 3); mx = -mn
    for o in objs:
        for v in o.data.vertices:
            mn = Vector(map(min, mn, v.co)); mx = Vector(map(max, mx, v.co))
    return mn, mx

objs = list(sc.objects)
fus = [o for o in objs if any(o.name.startswith(n) for n in cfg.get('fuselage', []))]
fin = [o for o in objs if any(o.name.startswith(n) for n in cfg.get('fin', []))]
AUTO = not fus
if AUTO:
    # drop stray objects (stands, floating parts) far from the airframe defined by the long fuselage pieces
    xext = lambda o: (lambda b: b[1].x - b[0].x)(bbox([o]))
    Lall = (lambda b: b[1].x - b[0].x)(bbox(objs))
    longs = [o for o in objs if xext(o) > 0.5 * Lall]
    lmn, lmx = bbox(longs)
    keep = []
    for o in objs:
        mn, mx = bbox([o]); cz0 = (mn.z + mx.z) / 2; cx0 = (mn.x + mx.x) / 2
        cy0 = (mn.y + mx.y) / 2
        if lmn.z - 0.15 * Lall < cz0 < lmx.z + 0.15 * Lall and lmn.x - 0.1 * Lall < cx0 < lmx.x + 0.1 * Lall and lmn.y - 0.1 * Lall < cy0 < lmx.y + 0.1 * Lall: keep.append(o)
        else: print('drop stray', o.name); bpy.data.objects.remove(o, do_unlink=True)
    objs = keep
    longs = [o for o in objs if xext(o) > 0.5 * Lall]
wings = [o for o in objs if any(o.name.startswith(n) for n in cfg.get('wing', []))]
amn, amx = bbox(objs)
Lsrc = amx.x - amn.x
noseX = amx.x
if AUTO:
    # measure the fuselage on a mid-length slice near the centre line
    ycen = (lambda b: (b[0].y + b[1].y) / 2)(bbox(longs))
    # measure the fuselage: robust percentiles of points near the centre line over the mid fuselage
    zs = []
    for band, x0f, x1f in ((0.03, 0.35, 0.7), (0.05, 0.25, 0.75), (0.08, 0.2, 0.8)):
        pts = sorted(v.co.z for o in objs for v in o.data.vertices if amn.x + x0f * Lsrc < v.co.x < amn.x + x1f * Lsrc and abs(v.co.y - ycen) < band * Lsrc)
        if len(pts) >= 30: zs = [pts[int(len(pts) * 0.04)], pts[int(len(pts) * 0.96)]]; break
    fcz = max(zs) - (cfg.get('height', cfg['diameter']) / 2) / (cfg['length'] / Lsrc)  # centre line measured down from the crown
    fdia = max(zs) - min(zs)
    for o in objs:
        for v in o.data.vertices: v.co.y -= ycen
    print('auto fuselage dia', fdia, 'cz', fcz)
else:
    fmn, fmx = bbox(fus)
    fcz = (fmn.z + fmx.z) / 2  # fuselage centre height
    fdia = min(fmx.y - fmn.y, fmx.z - fmn.z)

# ---- scale to real proportions
sL = cfg['length'] / Lsrc
sC = cfg['diameter'] / fdia if not AUTO else sL  # artist models keep their own (realistic) proportions
R_in = cfg['diameter'] / 2 * 1.05
semi = cfg['span'] / 2
tipSrc = max(abs(amn.y), abs(amx.y))
kSpan = (semi - R_in) / (tipSrc * sC - R_in)
print('scale length', sL, 'cross', sC, 'span stretch', kSpan)
def stretch_y(y):
    a = abs(y)
    return y if a <= R_in else math.copysign(R_in + (a - R_in) * kSpan, y)
for o in objs:
    for v in o.data.vertices:
        v.co.x = (v.co.x - noseX) * sL  # nose at x = 0, aft negative
        v.co.y = v.co.y * sC
        v.co.z = (v.co.z - fcz) * sC     # fuselage centre line at z = 0
    o.data.update()
for o in objs:
    mn, mx = bbox([o])
    if o in wings or (mx.y - mn.y) > cfg['diameter'] * 2.2 and o not in fus:
        for v in o.data.vertices: v.co.y = stretch_y(v.co.y)  # wing-like: stretch per vertex
    else:
        cy = (mn.y + mx.y) / 2
        if abs(cy) > R_in:  # compact part on the wing (engine, flap fairing, gear): translate only
            dy = stretch_y(cy) - cy
            for v in o.data.vertices: v.co.y += dy
    o.data.update()

# move origin to the builder CG (x_cg measured from nose)
xcg = cfg['xcg']
for o in objs:
    for v in o.data.vertices: v.co.x += xcg
    o.data.update()

# ---- livery material + UVs (fuselage sides / fin in the atlas layout)
img = bpy.data.images.new('LIVERY_TEX', 4, 4)
liv = bpy.data.materials.new('LIVERY'); liv.use_nodes = True
bsdf = liv.node_tree.nodes['Principled BSDF']
texn = liv.node_tree.nodes.new('ShaderNodeTexImage'); texn.image = img
liv.node_tree.links.new(texn.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.32; bsdf.inputs['Metallic'].default_value = 0.05
prof = cfg['profile']  # list of [x_from_nose, cz, ht] from the builder
L = cfg['length']
def profile3(xn):
    if xn <= prof[0][0]: return prof[0][1:4]
    for a, b in zip(prof, prof[1:]):
        if xn <= b[0]:
            t = (xn - a[0]) / max(1e-6, b[0] - a[0])
            return [a[i] + (b[i] - a[i]) * t for i in (1, 2, 3)]
    return prof[-1][1:4]
def profile(xn):
    if xn <= prof[0][0]: return prof[0][1:]
    for a, b in zip(prof, prof[1:]):
        if xn <= b[0]:
            t = (xn - a[0]) / max(1e-6, b[0] - a[0])
            return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    return prof[-1][1:]
finb = cfg['finBox']  # xMin, xMax, zRoot, h  (x from nose)
def assign(objs_, kind):
    for o in objs_:
        o.data.materials.clear(); o.data.materials.append(liv)
        bm = bmesh.new(); bm.from_mesh(o.data)
        uvl = bm.loops.layers.uv.verify()
        for f in bm.faces:
            f.material_index = 0
            c = f.calc_center_median()
            side = 1 if c.y >= 0 else -1
            for lp in f.loops:
                p = lp.vert.co
                xn = xcg - p.x
                if kind == 'fus':
                    cz, ht = profile(xn)
                    zn = max(-1, min(1, (p.z - cz) / max(ht, 1e-3)))
                    th = math.acos(zn) / math.pi
                    u = xn / L if side > 0 else 1 - xn / L
                    v = (0.25 if side > 0 else 0) + th * 0.25
                else:
                    uf = (xn - finb[0]) / (finb[1] - finb[0])
                    vf = 1 - max(0, min(1, (p.z - finb[2]) / finb[3]))
                    u = 0.5 * uf if side > 0 else 0.5 * (1 - uf)
                    v = (0.5 if side > 0 else 0.75) + 0.25 * vf
                lp[uvl].uv = (max(0.001, min(0.999, u)), 1 - max(0.001, min(0.999, v)))  # Blender UV origin bottom-left
        bm.to_mesh(o.data); bm.free()
if not AUTO:
    assign(fus, 'fus'); assign(fin, 'fin')
else:
    paint = set(cfg.get('paintMats', []))
    Hh = cfg['diameter'] / 2
    nf = 0
    for o in objs:
        mats = list(o.data.materials)
        if not any(m and m.name in paint for m in mats): continue
        if liv.name not in [m.name for m in o.data.materials if m]: o.data.materials.append(liv)
        li = [m.name if m else None for m in o.data.materials].index(liv.name)
        bm = bmesh.new(); bm.from_mesh(o.data)
        uvl = bm.loops.layers.uv.verify()
        for f in bm.faces:
            m = o.data.materials[f.material_index] if f.material_index < len(o.data.materials) else None
            if not m or m.name not in paint: continue
            c = f.calc_center_median(); xn = xcg - c.x
            if xn < -0.2 or xn > L + 0.2: continue
            cz, ht, hw = profile3(xn)
            r = math.hypot(c.y / max(hw, 1e-3), (c.z - cz) / max(ht, 1e-3))
            onfin = finb[0] - 2.5 < xn < L + 0.5 and abs(c.y) < max(0.6, 0.12 * finb[3]) and c.z > cz + ht * 0.8 and c.z > 0.6 * ht
            tipzone = xn < cfg.get('noseLen', 0.12 * L) * 1.4 or xn > L - 0.12 * L
            rmax = 1.7 if tipzone else 1.22
            if not onfin and not (0.6 < r < rmax and abs(c.y) < hw * (1.5 if tipzone else 1.12)): continue
            f.material_index = li; nf += 1
            side = 1 if c.y >= 0 else -1
            for lp in f.loops:
                p = lp.vert.co; xv = xcg - p.x
                if onfin:
                    uf = (xv - finb[0]) / (finb[1] - finb[0]); vf = 1 - max(0, min(1, (p.z - finb[2]) / finb[3]))
                    u = 0.5 * uf if side > 0 else 0.5 * (1 - uf); v = (0.5 if side > 0 else 0.75) + 0.25 * vf
                else:
                    czv, htv, _ = profile3(xv)
                    zn = max(-1, min(1, (p.z - czv) / max(htv, 1e-3)))
                    u = xv / L if side > 0 else 1 - xv / L
                    v = (0.25 if side > 0 else 0) + (math.acos(zn) / math.pi) * 0.25
                lp[uvl].uv = (max(0.001, min(0.999, u)), 1 - max(0.001, min(0.999, v)))
        bm.to_mesh(o.data); bm.free()
    print('painted faces', nf)

# livery-tinted materials
def retag(prefixes, newname):
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m and any(m.name.startswith(p) for p in prefixes):
                m2 = bpy.data.materials.get(newname) or m.copy(); m2.name = newname
                o.data.materials[i] = m2
retag(cfg.get('engineMats', []), 'ENGINE_PAINT')
retag(cfg.get('wingMats', []), 'WING_PAINT')

# ---- gear grouping (hideable nodes)
fmn2, fmx2 = bbox(fus) if fus else (Vector((0, 0, -cfg['diameter'] / 2)), Vector((0, 0, cfg['diameter'] / 2)))
amn_all, _ = bbox(objs)
# split low objects that contain both left+right parts (merged gear / wheels) into loose pieces
gz0 = amn_all.z + 0.62 * (fmn2.z - amn_all.z)
for o in list(objs):
    if o in fus or o in fin or o in wings: continue
    mn, mx = bbox([o])
    if mn.y < -0.5 and mx.y > 0.5 and mn.z < gz0 and mx.z < fmn2.z + 1.6 and (mx.x - mn.x) < 4 and len(o.data.polygons) < 60000:
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
objs = [o for o in sc.objects if o.type == 'MESH']
gear = {'gearN': [], 'gearL': [], 'gearR': []}
for o in objs:
    if o in fus or o in fin or o in wings: continue
    mn, mx = bbox([o])
    cy0 = (mn.y + mx.y) / 2; cx0 = (mn.x + mx.x) / 2
    if cfg.get('debugGear') and mn.z < fmn2.z - 0.3 and abs(cy0) < 6: print('CAND', o.name, [round(v, 2) for v in mn], [round(v, 2) for v in mx])
    gearZone = amn_all.z + 0.62 * (fmn2.z - amn_all.z)   # lower part of the space under the belly
    if abs(cy0) < cfg.get('trackMax', 4.6) and (mx.x - mn.x) < 4 and mn.z < gearZone and mx.z < fmn2.z + 1.6 and not (abs(cy0) < 0.35 and cx0 < 4.0):
        if any(o.name.startswith(n) for n in cfg.get('notGear', [])): continue
        cx = (mn.x + mx.x) / 2; cy = (mn.y + mx.y) / 2
        key = 'gearN' if cx > 4.0 else ('gearL' if cy > 0 else 'gearR')
        gear[key].append(o)
        print('GEAR', key, o.name, [round(v,2) for v in mn], [round(v,2) for v in mx])
contacts = {}
for k, lst in gear.items():
    if not lst: continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in lst: o.select_set(True)
    bpy.context.view_layer.objects.active = lst[0]
    if len(lst) > 1: bpy.ops.object.join()
    g = bpy.context.view_layer.objects.active; g.name = k
    mn, mx = bbox([g])
    contacts[k] = [(mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z]

# ---- simplify very dense small parts, then export
def decimate(o, ratio):
    mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
gr = cfg.get('decimate', 1.0)
for o in list(sc.objects):
    n = len(o.data.polygons)
    mn, mx = bbox([o])
    if n > 8000 and (mx - mn).length < 1.5: decimate(o, 0.25)
    elif gr < 1 and n > 3000: decimate(o, gr)
# merge everything except the gear legs into one multi-material body (far fewer draw calls)
body = [o for o in sc.objects if o.type == 'MESH' and not o.name.startswith('gear')]
if len(body) > 1:
    with bpy.context.temp_override(active_object=body[0], selected_editable_objects=body, selected_objects=body):
        bpy.ops.object.join()
    body[0].name = 'body'
amn, amx = bbox(list(sc.objects))
meta = {'bbox': [list(amn), list(amx)], 'contacts': contacts, 'faces': sum(len(o.data.polygons) for o in sc.objects)}
for o in sc.objects:
    if o.type == 'MESH' and o.name.startswith('gear'): pass
json.dump(meta, open(out.replace('.glb', '.meta.json'), 'w'), indent=1)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=False, export_apply=True, export_image_format='AUTO', export_materials='EXPORT')
print('META', json.dumps(meta))
