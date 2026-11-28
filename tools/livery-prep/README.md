# Detailed exterior models with OpenSkies liveries

`bl_prepare.py` turns a third-party airliner model (glTF; Sketchfab or FlightGear exported via
`tools/fg-cockpit/bl_fg.py` + Blender glTF export) into a `detailed:` model the game can repaint:

- converts to sim model space (x forward, y left, z up), scales to the real length/span from the config
- aligns the nose with the procedural builder's nose (`xcg`) so physics/gear/eye points match
- assigns fuselage + fin faces to a `LIVERY` material whose UVs follow the livery atlas layout used by
  `js/model/painter.js` (fuselage sides rows 0-1024, fin L/R, etc.); the game paints any airline onto it
- tags engine cowls / wings (`ENGINE_PAINT`, `WING_PAINT`) for livery colours, groups gear legs into hideable
  nodes, decimates, joins the body, writes `.meta.json` (bbox, gear contacts)

Usage: `bl/bin/python -I bl_prepare.py -- in.glb out.glb cfg.json` (configs: `b738.cfg.json`, `max8.cfg.json`,
`a320.cfg.json`), then compress: `npx gltfpack -i out.glb -o models/<id>.glb -cc -kn -km -vt 14 -vp 16`.
Register on the aircraft in `js/data/aircraft.js`: `detailed: { glb, meta, credit }` (see b737-800).
`bl_render.py` renders preview images; `bl_inspect.py` / `bl_parts.py` list parts/materials.
