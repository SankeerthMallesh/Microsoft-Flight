# Third-party 3D models

These detailed aircraft models come from Sketchfab under Creative Commons licenses.
OpenSkies modified them: rescaled them to real-world dimensions, re-aligned them to the
flight-model axes, remapped the fuselage and tail UVs for the livery painter, regrouped
the landing gear and simplified some parts.

| File | Original model | Author | License |
| --- | --- | --- | --- |
| `b737-800.glb` | [B737-800 Model](https://sketchfab.com/3d-models/b737-800-model-6cbe380405794ea69d6b0a3d144dd1af) | [hakai315](https://sketchfab.com/hakai315) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `b737-max8.glb` | [Boeing 737 MAX 8](https://sketchfab.com/3d-models/boeing-737-max-8-380d0315b8774117a3b1820f4857e00e) | [Dlourine](https://sketchfab.com/fDlruosne) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `a320neo.glb` | [Airbus A320-200 V2](https://sketchfab.com/3d-models/airbus-a320-200-v2-c078f9af15884a6b820c7e778831b110) (shown as A320neo; landing gear added) | [Dlourine](https://sketchfab.com/fDlruosne) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

## 3D cockpit (FlightGear, GPL)

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `b737-800-cockpit.glb` | Boeing 737-800 for [FlightGear](https://www.flightgear.org/) (flight deck, panels, pedestal, overhead and instruments), from the official FlightGear aircraft download mirror | Innis Cunningham (3D and panel), Syd Adams (glass instruments), David Culp, Michael Soitanen and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) or later |

OpenSkies converted the cockpit from AC3D to glTF, aligned it with the sim's model axes,
darkened untextured placeholder faces, baked ambient-occlusion contact shadows (Blender Cycles), switched cut-out textures to alpha masks and
compressed it with meshoptimizer. The live PFD, ND and EICAS are drawn by OpenSkies
and projected onto the model's display screens. The 737 MAX 8 reuses this flight deck,
repositioned to the MAX fuselage and with larger display units.
