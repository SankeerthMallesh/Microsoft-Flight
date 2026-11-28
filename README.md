# OpenSkies Flight Simulator

A free flight simulator that runs in your web browser. You fly real airliners over the real world.

- **Whole-planet scenery** comes from [CesiumJS](https://cesium.com/platform/cesiumjs/). There are three modes:
  - photorealistic 3D cities (Google Photorealistic 3D Tiles via Cesium ion)
  - world terrain with aerial imagery and 3D buildings
  - a "Lite" mode that needs no account.
- **2,853 real airports** with real runway coordinates, headings, lengths and elevations, from [OurAirports](https://ourairports.com/) (public domain).
- **53 real aircraft types**, built from published dimensions, weights, engine thrust and performance:
  - Airbus A220, A300-600F, A320neo family, A330-200/-300/-900, A340-600, A350-900/-1000, A380
  - Boeing 717, 737 NG/MAX 7–10, 747-400/-8/-8F, 757, 767-300ER/-400ER, 777/777F/777X, 787-8/-9/-10
  - MD-11F, Embraer E175/E190/E2, CRJ700/900, ATR 42/72, Dash 8-400, C919, Superjet 100
  - Gulfstream G650, Global 7500, Citation CJ4, King Air 350, Pilatus PC-12, Cessna 172, Cirrus SR22, Piper Archer
- **30+ airline liveries**, each listed for the aircraft types that airline actually flies. They include Southwest, Delta, Emirates, United, American, British Airways, Lufthansa, Air France, KLM, Qatar, Singapore, Ryanair, easyJet, Air Canada, Qantas, ANA, JAL, Turkish, Alaska, JetBlue, Cathay, Etihad, FedEx, UPS, Virgin Atlantic, China Eastern, Aeroflot and house colors.
- **3D hangar** with studio lighting, a turntable and a spec sheet for every aircraft.
- **Flight model with six degrees of freedom:**
  - ISA atmosphere and Mach drag rise
  - stall and post-stall behavior, ground effect
  - flaps, slats, spoilers and gear drag
  - spooling turbofan, turboprop and piston engines with fuel burn
  - landing gear contact with brakes, nosewheel steering and reversers
  - wind and turbulence
- **Fly-by-wire "assisted" mode** with attitude hold and stall/bank/pitch protections, or **realistic** direct control with manual trim.
- **Glass cockpit:**
  - PFD: speed and altitude tapes, flight director, ILS deviation
  - navigation display showing real nearby runways
  - EICAS engine and systems display
  - Boeing-style autopilot panel (MCP) with A/T, FLCH, HDG SEL, ALT HLD, V/S, APP (ILS) and CMD
- **Autopilot** with localizer and glideslope capture and an autoland flare. Runway edge lights, approach lights and a working PAPI on your runway.
- **Weather and time of day:** cloud layers, wind, turbulence, sun position and night lighting.
- **Air traffic control:** clearance delivery, ground, tower, departure, centre, approach and back to ground, with ICAO/FAA phraseology and airline callsigns ("Southwest 1234", "Speedbird 412 heavy"). ATC follows what you and the autopilot are doing, the controller and your pilot (readbacks) speak in different voices over a radio squelch, and the ATC window (`` ` `` or **L**) has a log and a request menu like MSFS.
- **Sound, all synthesized live:** turbofan fan tone, buzz-saw, core whine and jet roar that track N1, separate from the cockpit and outside; distance, directivity and Doppler in the fly-by view; turboprop and piston engines, APU, wind, gear and flap motors, runway rumble and wheel thumps, touchdown squeal, spoilers, reverse thrust, avionics fans, stick shaker, overspeed clacker, master caution chime and the autopilot-disconnect warning (cavalry charge on Airbus). Also GPWS and radio-altimeter callouts ("Five hundred", "Minimums", "Fifty, forty, thirty, twenty, ten", "Retard", "Sink rate", "Too low, gear", "Bank angle", "Glideslope").
- **Controls:** keyboard, mouse, gamepad and joystick/HOTAS.

Everything is free. There is no build step and nothing to buy.

## Play it

### Option 1: run it on your computer

You need any static web server. With Python installed:

```bash
git clone https://github.com/SankeerthMallesh/Microsoft-Flight.git
```

```bash
cd Microsoft-Flight
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome, Edge or Firefox.

Opening `index.html` directly as a file won't work, because browsers block ES modules on `file://` pages.

### Option 2: GitHub Pages

In the repository, go to **Settings → Pages**. Choose **Deploy from a branch**, then **main** and **/ (root)**, and save. After a minute the game is live at `https://<your-username>.github.io/Microsoft-Flight/`.

## Get the best scenery (free)

1. Create a free account at <https://ion.cesium.com/signup>.
2. Copy a browser-appropriate token from <https://ion.cesium.com/tokens>. Restrict the token to the domains where you host the game when possible.
3. In the game, open **Settings → 3D scenery**, paste the token, select **Photorealistic 3D cities**, and choose **Save & reload**.
4. The Settings screen shows whether a token is saved locally. A saved token is not necessarily valid; Cesium checks its permissions when the 3D scenery loads.

The token is saved in this browser's local storage. It is not written into the source files or repository. Because browser-based Cesium must send the token with asset requests, treat it as a browser token and restrict its allowed origins in Cesium ion.

## Controls

| Action | Keys |
| --- | --- |
| Pitch / roll | ↑ ↓ ← → (↓ = nose up) |
| Rudder / nosewheel | Q / E or A / D |
| Throttle | W / S, PgUp / PgDn, F1 idle, F4 full |
| Flaps | F extend, R retract |
| Gear | G |
| Brakes / parking brake | B (hold) / N |
| Speedbrake | `/` toggle, Shift + `/` arm ground spoilers |
| Reverse thrust | T (on the ground) |
| Trim | `[` / `]` or Home / End |
| Autopilot / autothrottle | Z / X (or click the MCP in the cockpit) |
| Cameras | C cycles. 1 cockpit, 2 chase, 3 orbit, 4 fly-by. Drag the mouse to look, scroll to zoom |
| Cockpit panel | H |
| Air traffic control | `` ` `` or L opens the ATC window; 1–9 pick a request while it is open |
| Pause | P / Esc |

**Your first takeoff:** press **N** to release the parking brake, then hold **W** for full thrust. At the "Rotate" call, hold **↓** for about a second to lift the nose. Then press **G** to raise the gear and **Z** + **X** to engage the autopilot and autothrottle.

## Project layout

```
index.html            UI shell (menus, hangar, cockpit overlay)
css/style.css         styling
data/airports.json    airports + runways (OurAirports)
js/main.js            app controller, flight setup, main loop
js/world.js           CesiumJS scenery, aircraft placement, lights, clouds, cameras
js/hangar.js          three.js hangar
js/sim/flightmodel.js 6-DOF flight dynamics, engines, gear, fly-by-wire
js/sim/autopilot.js   autopilot / autothrottle / ILS
js/atc.js             air traffic control (phases, phraseology, voices, ATC window)
js/audio.js           procedural Web Audio sound, GPWS callouts, speech/radio manager
js/model/builder.js   procedural aircraft geometry from real dimensions
js/model/painter.js   livery texture painter
js/data/aircraft.js   aircraft specifications
js/data/liveries.js   airline liveries
js/cockpit/instruments.js  PFD / ND / EICAS
```

## Credits and legal

- All sound is generated at run time with the Web Audio API, and voices use the browser's built-in speech synthesis (Web Speech API). The project ships no recorded sound files, so it has no third-party audio licences.
- The detailed Boeing 737-800 model is "B737-800 Model" by hakai315 on Sketchfab, licensed CC BY 4.0 and modified for this sim. See [models/CREDITS.md](models/CREDITS.md).
- The 3D A320neo flight deck comes from the [FlightGear](https://www.flightgear.org/) A320-family (Josh Davidson, Jonathan Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran), GPL v2.
- The 3D 737-800 flight deck comes from the [FlightGear](https://www.flightgear.org/) Boeing 737-800 (Innis Cunningham, Syd Adams, David Culp, Michael Soitanen and contributors), licensed GNU GPL v2 or later and converted for this sim.
- The 3D Boeing 777 flight deck (777-300ER, also used on the 777-200ER, 777F and 777-9) comes from the [FlightGear](https://www.flightgear.org/) Boeing 777 Series (Syd Adams, Justin Smithies, Karla, Thorsten Brehm, Joshua Davidson, Isaak Dieleman, Sidi Liang, Yongfan Li, Valkmjolnir, Lars Van Hattum and contributors), GPL v2.
- The 3D Boeing 787 flight deck (787-9, also used on the 787-8 and 787-10) comes from the [FlightGear](https://www.flightgear.org/) Boeing 787-8 Dreamliner (Omega95, Joshua W, Redneck, Jentron, Hooray, Thomas Albrecht and contributors), GPL v2.
- The 3D Airbus A380 flight deck comes from the [FlightGear](https://www.flightgear.org/) Airbus A380 (K. Ampere, I. Cunningham, F. Dalvi, S. Hamilton and contributors), GPL v2.
- The 3D Boeing 747 flight deck (747-8i, also used on the 747-8F and 747-400) comes from the [FlightGear](https://www.flightgear.org/) 747-8i (John Williams; original cockpit by Gijs de Rooy with Ivan Ngeow, Jentron, Syd Adams, Torsten Dreyer, Markus Bulik; Grupo FGBr), GPL v2.
- The 3D CRJ700/CRJ900 flight deck comes from the [FlightGear](https://www.flightgear.org/) CRJ700 family (Ryan "Skyop" Miller, Henning S., D-JSB, Daniel M. and contributors), GPL v2.
- The 3D ATR 72/42 flight deck comes from the [FlightGear](https://www.flightgear.org/) ATR 72-500 (Ryan Miller and contributors), GPL v2.
- The F-15C Eagle (exterior and 3D cockpit) comes from the [FlightGear](https://www.flightgear.org/) F-15 (3D model by Enrique Laso; systems, cockpit and FDM by Richard Harrison and contributors), GPL v2.
- The F-16C Fighting Falcon (exterior and 3D cockpit) comes from the [FlightGear](https://www.flightgear.org/) F-16 (Erik Hofman; Martin "Pegasus" Schmitt and Prohm "Rama" Snitwong cockpit; Nikolai V. Chr. "Leto"; J Maverick 16; Pensacola liveries and contributors), GPL v2.
- The F-14D Tomcat (exterior and 3D pilot cockpit) comes from the [FlightGear](https://www.flightgear.org/) F-14B (Richard Harrison, Enrique Laso, xiii and contributors; VF-2 "Bounty Hunters" livery from its livery pack), GPL v2.

### License

Because it includes GPL-licensed FlightGear content, OpenSkies is distributed under the **GNU General Public License, version 2 or (at your option) any later version**. See [LICENSE](LICENSE). The Sketchfab models in `models/` keep their own CC BY 4.0 licenses (see [models/CREDITS.md](models/CREDITS.md)).

- [CesiumJS](https://cesium.com) (Apache 2.0) and [three.js](https://threejs.org) (MIT) load from the jsDelivr CDN.
- Taxiways, aprons and airport/city buildings come from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL), fetched via the Overpass API; global 3D buildings use Cesium OSM Buildings.
- Runway, taxiway and apron surface photos are CC0 textures from [ambientCG](https://ambientcg.com) (Asphalt031, Asphalt026C, Concrete034, Concrete044B); the hangar sky lighting is the CC0 HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" from [Poly Haven](https://polyhaven.com).
- Airport and runway data comes from [OurAirports](https://ourairports.com/data/) (public domain).
- Aircraft specifications are taken from manufacturers' public data.
- This is an independent hobby project. It isn't affiliated with Microsoft, any aircraft manufacturer or any airline. Airline names, logos and liveries are trademarks of their owners. They're recreated here only for personal, non-commercial simulation.
