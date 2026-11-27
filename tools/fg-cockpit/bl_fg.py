# Assemble a FlightGear aircraft model (AC3D files + XML includes/offsets) in Blender.
# Usage: python bl_fg.py -- <aircraft_dir> <model.xml relative to aircraft dir> <out.blend> [keep-regex]
import bpy, bmesh, sys, os, re, math, mathutils
import xml.etree.ElementTree as ET
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ACDIR, ROOTXML, OUT = argv[0], argv[1], argv[2]
KEEP = re.compile(argv[3]) if len(argv) > 3 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
coll = bpy.context.scene.collection
mat_cache, img_cache = {}, {}

def resolve(path, base):
    p = path.strip()
    if p.startswith('Aircraft/'):
        parts = p.split('/', 2)
        return os.path.join(os.path.dirname(ACDIR.rstrip('/')), parts[1], parts[2]) if len(parts) > 2 else None
    q = os.path.normpath(os.path.join(base, p))
    if not os.path.exists(q):
        alt = os.path.normpath(os.path.join(ACDIR, p))
        if os.path.exists(alt): return alt
    return q

def get_image(path):
    if path in img_cache: return img_cache[path]
    im = None
    for cand in (path, os.path.splitext(path)[0] + '.png', os.path.splitext(path)[0] + '.rgb'):
        if os.path.exists(cand):
            try: im = bpy.data.images.load(cand); break
            except Exception: pass
    img_cache[path] = im
    return im

def get_mat(m, tex):
    key = (m['name'], tuple(m['rgb']), m['trans'], tex)
    if key in mat_cache: return mat_cache[key]
    mat = bpy.data.materials.new(m['name'] + ('_tex' if tex else ''))
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*m['rgb'], 1)
    b.inputs['Roughness'].default_value = max(0.15, 1 - min(1, m['shi'] / 128))
    if any(m['emis']): b.inputs['Emission Color'].default_value = (*m['emis'], 1); b.inputs['Emission Strength'].default_value = 1.0
    if tex:
        im = get_image(tex)
        if im:
            t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = im
            mat.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
            if m['trans'] > 0.01 or tex.lower().endswith('.png'):
                mat.node_tree.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    if m['trans'] > 0.01:
        b.inputs['Alpha'].default_value = 1 - m['trans']
    mat_cache[key] = mat
    return mat

AC2FG = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # AC3D (y up) -> FlightGear (z up)
def load_ac(path, M, tag):
    M = M @ AC2FG
    """Parse an AC3D file and create mesh objects transformed by M (FG coords)."""
    if not os.path.exists(path): print('missing', path); return
    lines = open(path, encoding='latin-1').read().split('\n')
    i = 0; mats = []; base = os.path.dirname(path)
    def nxt():
        nonlocal i
        while i < len(lines) and not lines[i].strip(): i += 1
        l = lines[i] if i < len(lines) else ''; i += 1; return l
    def tok(l): return l.strip().split()
    # header
    nxt()
    while i < len(lines) and lines[i].startswith('MATERIAL'):
        l = lines[i]; i += 1
        name = re.search(r'"([^"]*)"', l); name = name.group(1) if name else 'm'
        t = l.split('"')[-1].split()
        def get(key, n):
            k = t.index(key); return [float(x) for x in t[k + 1:k + 1 + n]]
        mats.append({'name': name, 'rgb': get('rgb', 3), 'emis': get('emis', 3), 'shi': get('shi', 1)[0], 'trans': get('trans', 1)[0]})
    def read_object(parentM):
        l = nxt()
        assert l.startswith('OBJECT'), l
        kind = l.split()[1]
        name = ''; tex = None; texrep = (1, 1); texoff = (0, 0); rot = Matrix.Identity(3); loc = Vector((0, 0, 0))
        verts = []; surfs = []; kids = 0
        while True:
            l = nxt(); t = tok(l)
            if not t: break
            k = t[0]
            if k == 'name': name = l.split('"')[1] if '"' in l else t[1]
            elif k == 'data':
                n = int(t[1]); data = ''
                while len(data) < n: data += lines[i] + '\n'; i_inc()
            elif k == 'texture': tex = os.path.join(base, l.split('"')[1])
            elif k == 'texrep': texrep = (float(t[1]), float(t[2]))
            elif k == 'texoff': texoff = (float(t[1]), float(t[2]))
            elif k == 'rot': r = [float(x) for x in t[1:10]]; rot = Matrix((r[0:3], r[3:6], r[6:9])).transposed()
            elif k == 'loc': loc = Vector([float(x) for x in t[1:4]])
            elif k == 'numvert':
                for _ in range(int(t[1])): verts.append(Vector([float(x) for x in tok(nxt())[:3]]))
            elif k == 'numsurf':
                for _ in range(int(t[1])):
                    flags = int(tok(nxt())[1], 16); mi = 0; refs = []
                    while True:
                        tt = tok(nxt())
                        if tt[0] == 'mat': mi = int(tt[1])
                        elif tt[0] == 'refs':
                            for _ in range(int(tt[1])):
                                rr = tok(nxt()); refs.append((int(rr[0]), float(rr[1]) if len(rr) > 1 else 0, float(rr[2]) if len(rr) > 2 else 0))
                            break
                    surfs.append((flags, mi, refs))
            elif k == 'kids': kids = int(t[1]); break
        # AC3D: child vertices are in parent space offset by loc (rot applies to verts)
        localM = Matrix.Translation(loc) @ rot.to_4x4()
        Mw = parentM @ localM
        if kind == 'poly' and verts and surfs:
            me = bpy.data.meshes.new(name or 'poly'); bm = bmesh.new()
            bv = [bm.verts.new(Mw @ v) for v in verts]
            uvl = bm.loops.layers.uv.new()
            used = {}
            for flags, mi, refs in surfs:
                if (flags & 0xF) != 0 or len(refs) < 3: continue  # lines / closed lines
                try: f = bm.faces.new([bv[r[0]] for r in refs])
                except ValueError: continue
                m = mats[mi] if mi < len(mats) else mats[0]
                mat = get_mat(m, tex)
                if mat.name not in used: used[mat.name] = len(used); me.materials.append(mat)
                f.material_index = used[mat.name]
                f.smooth = bool(flags & 0x10)
                for lp, r in zip(f.loops, refs): lp[uvl].uv = (r[1] * texrep[0] + texoff[0], r[2] * texrep[1] + texoff[1])
            bm.to_mesh(me); bm.free()
            ob = bpy.data.objects.new(name or 'poly', me); ob['src'] = tag; coll.objects.link(ob)
        for _ in range(kids): read_object(Mw)
    def i_inc():
        nonlocal i; i += 1
    try:
        read_object(M)
    except Exception as e:
        print('AC parse error', path, e)

def offsets_matrix(el):
    o = el.find('offsets')
    if o is None: return Matrix.Identity(4)
    def g(k):  # tolerate stray characters in hand-written XML (e.g. '0.0001s')
        m = re.match(r'\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)', o.findtext(k) or '')
        return float(m.group(1)) if m else 0.0
    T = Matrix.Translation((g('x-m'), g('y-m'), g('z-m')))
    R = (Matrix.Rotation(math.radians(g('heading-deg')), 4, 'Z') @ Matrix.Rotation(math.radians(g('pitch-deg')), 4, 'Y') @ Matrix.Rotation(math.radians(g('roll-deg')), 4, 'X'))
    return T @ R

def merge(a, b):
    # FlightGear PropertyList include semantics: b overrides a, children matched by tag + n index
    def idx(parent):
        cnt = {}; out = {}
        for x in list(parent):
            k = cnt.get(x.tag, 0); out[id(x)] = x.get('n', str(k)); cnt[x.tag] = k + 1
        return out
    ia, ib = idx(a), idx(b)
    for c in list(b):
        n = ib[id(c)]
        same = [x for x in a if x.tag == c.tag and ia.get(id(x)) == n]
        if same and len(c):
            merge(same[0], c)
        elif same:
            same[0].text = c.text
        else:
            a.append(c)
    return a

def parse_prop(path):
    root = ET.parse(path).getroot()
    inc = root.get('include')
    if inc:
        ip = resolve(inc, os.path.dirname(path))
        if ip and os.path.exists(ip): root = merge(parse_prop(ip), root)
    return root

def load_xml(path, M, depth=0):
    if depth > 8 or not os.path.exists(path): print('missing xml', path); return
    try: root = parse_prop(path)
    except Exception as e: print('xml error', path, e); return
    base = os.path.dirname(path)
    Mr = M @ offsets_matrix(root)
    p = root.findtext('path')
    if p:
        f = resolve(p, base)
        if f and f.endswith('.ac') and (KEEP is None or KEEP.search(f)): load_ac(f, Mr, os.path.relpath(f, ACDIR))
        elif f and f.endswith('.xml'): load_xml(f, Mr, depth + 1)
    for m in root.findall('model'):
        mp = m.findtext('path')
        if not mp: continue
        f = resolve(mp, base)
        Mm = Mr @ offsets_matrix(m)
        if f and f.endswith('.xml'): load_xml(f, Mm, depth + 1)
        elif f and f.endswith('.ac') and (KEEP is None or KEEP.search(f)): load_ac(f, Mm, os.path.relpath(f, ACDIR))

ACDIR = os.path.abspath(ACDIR)
load_xml(os.path.join(ACDIR, ROOTXML), Matrix.Identity(4))
objs = [o for o in coll.objects]
print('objects', len(objs), 'faces', sum(len(o.data.polygons) for o in objs))
srcs = {}
for o in objs: srcs[o['src']] = srcs.get(o['src'], 0) + len(o.data.polygons)
for k, v in sorted(srcs.items(), key=lambda kv: -kv[1])[:40]: print('  ', v, k)
try: bpy.ops.file.pack_all()
except Exception as e: print('pack failed', e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT))
