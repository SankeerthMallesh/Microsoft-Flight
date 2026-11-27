import bpy, sys, re
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0])
pat = re.compile(argv[1])
for o in bpy.data.objects:
    if o.type == 'MESH' and pat.search(o.get('src', '')):
        ps = [o.matrix_world @ v.co for v in o.data.vertices]
        print(repr(o.name), o.get('src'), len(o.data.polygons), [round(sum(p[i] for p in ps) / len(ps), 3) for i in range(3)], [round(max(p[i] for p in ps) - min(p[i] for p in ps), 3) for i in range(3)])
