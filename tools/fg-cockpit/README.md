# FlightGear → OpenSkies 3D cockpit pipeline

How the 737-800 and A320neo flight decks in `models/*-cockpit.glb` were made. FlightGear aircraft are GPL v2;
credit the authors in `models/CREDITS.md` and the README for every cockpit you add.

## Setup

```bash
# Blender as a Python module (needs Python 3.11)
python3.11 -m venv bl && bl/bin/pip install bpy==5.0.1 numpy
npm i gltfpack@1.3.0          # mesh compression
pip install pillow             # texture re-encoding
```

Aircraft zips: `https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020/<Name>.zip`
(e.g. `777.zip`, `787-8.zip`, `747-8i.zip`, `A380.zip`, `CRJ700-family.zip`, `ATR-72-500.zip`). Unzip each into its own empty directory.

## Steps

1. **Assemble** the FlightGear model (AC3D + PropertyList XML includes/offsets) into a .blend. The 4th argument is a regex matched
   against the full path of each `.ac` file; keep the exterior fuselage (needed for alignment) and the flight-deck parts:
   ```bash
   bl/bin/python -I bl_fg.py -- <aircraft_dir> Models/<main>.xml out.blend '/Models/(Fuselage.*\.ac|Cockpit/|Instruments/|FlightDeck/)'
   ```
2. **Find the eye point** from the `*-set.xml` view 0 config: `x-offset-m` is right, `y-offset-m` is up and `z-offset-m` is back.
   In FlightGear coordinates (x aft, y right, z up) that gives `eyeFG = [z-offset, x-offset, y-offset]`. Render it to check:
   ```bash
   bl/bin/python -I bl_eye.py -- out.blend eye.png <x> <y> <z> <pitchDeg>
   ```
3. **Find the display screens** (`bl_src.py -- out.blend 'PFD|ND|EICAS|ECAM'` lists object names, centres and sizes).
4. **Write a config** like `ck320.json`: `exterior` is the fuselage .ac (relative path), `xcg` is the nose x of the OpenSkies exterior
   model (max x of its bbox; for procedural types it's the builder's nose, i.e. `geo` length − `layout` offset, so check `physics.eye`),
   `keep` matches the cockpit `.ac` files, `dropNames` matches lit/overlay objects to delete, `screens` maps
   pfd/nd/eicas/pfd2/nd2/eicas2/isis to object names, `eyeFG` and `pitchDeg`.
5. **Export + bake ambient occlusion** (2048 px, about 1–3 min on CPU):
   ```bash
   AOBAKE=2048 AOSAMPLES=48 AODIST=0.3 bl/bin/python -I bl_fg_cockpit.py -- out.blend ck.glb ck.json
   ```
   This writes `ck.glb`, `ck.meta.json` (eye, screens in OpenSkies model space) and `ck-ao.png`.
6. **Web-optimise** (BLEND→MASK, AO to JPEG, textures to JPEG/palette PNG ≤1024 px, then meshopt compression with float UVs,
   because quantised UVs break FlightGear's tiled texture coordinates):
   ```bash
   node glbmask.cjs ck.glb ck-m.glb
   python3 -I glb_aojpg.py ck-m.glb ck-j.glb
   python3 -I glb_texopt.py ck-j.glb ck-t.glb 1024
   npx gltfpack -i ck-t.glb -o models/<id>-cockpit.glb -cc -vp 16 -vtf
   ```
   Target: under about 7 MB per cockpit.
7. **Register** in `js/data/aircraft.js` on the type: `cockpit: { glb: 'models/<id>-cockpit.glb', meta: 'models/<id>-cockpit.meta.json', credit: '…' }`.
   Optional `offset: [dx, dy, dz]` and `screenScale: [sx, sy]` reuse a deck on a sibling type (see b737-max8).
   The game projects its live PFD/ND/EICAS canvases onto the `screens` quads (see `drawCockpit3D` in `js/main.js`).

## Notes
- Procedural exterior types: the cockpit appears only in cockpit view (the exterior is hidden), but the eye height above the
  wheels must look right, so compare `meta.eye[2]` with the procedural `physics.groundZ`.
- Untextured pure-white faces are placeholders for external FlightGear instrument packs. The exporter darkens them.
- Check the result in game (key `1`) with Playwright + SwiftShader screenshots before committing.
