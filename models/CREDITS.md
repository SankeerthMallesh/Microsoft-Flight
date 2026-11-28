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

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `a320neo-cockpit.glb` | Airbus A320-family for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, pedestal, MCDUs, radios and display units), from the official FlightGear aircraft download mirror | Josh Davidson (Octal450), Jonathan Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran (3D and textures) | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way as the 737 flight deck (glTF, aligned to the A320neo model, baked ambient occlusion,
web-optimised textures). OpenSkies draws the live PFD, ND, ECAM and standby displays onto its screens.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `b777-300er-cockpit.glb` | Boeing 777 Series for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, glareshield, pedestal, CDUs, radios, standby instruments), from the official FlightGear aircraft download mirror | Syd Adams (3D models), Justin Smithies, Karla, Thorsten Brehm, Joshua Davidson, Isaak Dieleman, Sidi Liang, Yongfan Li, Valkmjolnir, Lars Van Hattum and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way (glTF, aligned to the 777 model with FlightGear's real eye height above the wheels, over-dense knobs and screws
decimated, baked ambient occlusion, web-optimised). The 777-200ER, 777F and 777-9 reuse this flight deck, repositioned to their noses.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `b787-9-cockpit.glb` | Boeing 787-8 Dreamliner for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, glareshield, pedestal), from the official FlightGear aircraft download mirror | Omega95 (cockpit), Joshua W (original model), Redneck, Jentron, Hooray, Thomas Albrecht (radi) and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way; the FlightGear display pages were removed and the display units turned into dark glass for OpenSkies' live
PFD, ND, EICAS and standby displays. The 787-8 and 787-10 reuse this flight deck, repositioned to their noses.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `a380-800-cockpit.glb` | Airbus A380 for [FlightGear](https://www.flightgear.org/) (flight deck, front panel, glareshield, overhead, pedestal), from the official FlightGear aircraft download mirror | K. Ampere, I. Cunningham, F. Dalvi, S. Hamilton and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way; FlightGear's own PFD/EWD needle objects were removed so OpenSkies' live displays sit on the portrait
display units, and a missing lower-display face was capped.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `b747-8i-cockpit.glb` | Boeing 747-8i for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, glareshield, pedestal, cockpit shell), from the official FlightGear aircraft download mirror | John Williams; original cockpit by Gijs de Rooy (with Ivan Ngeow, Jentron, Syd Adams, Torsten Dreyer, Markus Bulik); Grupo FGBr (Aurino das Neves, Isaias Prestes, Rick Britto, Wagner Silva) | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way. The 747-8F and 747-400 reuse this flight deck, repositioned to their noses.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `crj700-cockpit.glb` | CRJ700 family for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, glareshield, pedestal, CDUs, standby), from the official FlightGear aircraft download mirror | Ryan "Skyop" Miller, Henning S., D-JSB, Daniel M. and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way; OpenSkies draws its live PFD, ND, EICAS and standby onto the six display units. The CRJ900 reuses it.

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `atr72-600-cockpit.glb` | ATR 72-500 for [FlightGear](https://www.flightgear.org/) (flight deck, overhead, glareshield, pedestal, standby gauges), from the official FlightGear aircraft download mirror | Ryan Miller (3D and FDM) and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

Converted the same way. The -500's analog engine gauges were replaced by a centre display unit (as on the -600) carrying OpenSkies'
live engine display; the live PFD and ND sit on the EADI/EHSI tubes. The ATR 42-600 reuses this flight deck.

## Military jets

| File | Original model | Author | License |
| --- | --- | --- | --- |
| `fa18ef.glb`, `fa18ef-cockpit.glb` | [Boeing F/A-18E "Super Hornet"](https://sketchfab.com/3d-models/boeing-fa-18e-super-hornet-9e852037bf2141dcb3fda17013958131) | [ioai25312](https://sketchfab.com/ioai25312) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

OpenSkies rescaled the Super Hornet to real dimensions (18.3 m), re-aligned it to the flight-model axes, grouped the landing gear
for retraction, made the canopy clear glass, split out the cockpit (baked ambient occlusion) and added display/HUD quads so its
DDIs, UFCD, MPCD and HUD show OpenSkies' live displays.

### FlightGear (GPL)

| File | Original | Authors | License |
| --- | --- | --- | --- |
| `f15c.glb`, `f15c-cockpit.glb` | F-15 Eagle for [FlightGear](https://www.flightgear.org/) (exterior, canopy, landing gear, nozzles; front cockpit with HUD, VSD, MPCD and TEWS), from the official FlightGear aircraft download mirror | Enrique Laso "Flying toaster" (3D model), Richard Harrison (zaretto; systems, cockpit, FDM) and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |
| `f16c.glb`, `f16c-cockpit.glb` | F-16 Fighting Falcon for [FlightGear](https://www.flightgear.org/) (exterior, gold-tinted canopy, gear, P&W nozzle; MLU cockpit with HUD, MFDs, ICP, consoles), from the official FlightGear aircraft download mirror | Erik Hofman (main author), Martin "Pegasus" Schmitt and Prohm "Rama" Snitwong (cockpit textures and layout), Nikolai V. Chr. "Leto"/"Necolatis", J Maverick 16, Pensacola (liveries) and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |
| `f14d.glb`, `f14d-cockpit.glb` | F-14B Tomcat for [FlightGear](https://www.flightgear.org/) (exterior, gear, variable nozzles; pilot cockpit with VDI, HSD and HUD combiner), shown in the pack's VF-2 "Bounty Hunters" (F-14D squadron) livery, from the official FlightGear aircraft download mirror | Richard Harrison (zaretto; model, cockpit, FDM), Enrique Laso, xiii (liveries) and other FlightGear contributors | [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |

OpenSkies assembled the AC3D parts with `tools/fg-cockpit/bl_fg_exterior.py` (F-15C variant only: D-model canopy, stores, tanks
and conformal tanks removed, canopy fasteners decimated, landing gear grouped for retraction, wheels levelled on one contact plane),
converted the cockpit like the airliner flight decks (baked ambient occlusion, web-optimised) and projects its live HUD symbology
onto the HUD combiner and live displays onto the VSD, MPCD and TEWS. The afterburner plumes are drawn by OpenSkies.
