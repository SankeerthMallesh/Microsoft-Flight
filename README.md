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
- **Sound:** synthesized engine and wind sound, plus voice callouts ("V one", "Rotate", "One hundred… fifty… ten", "Retard", "Sink rate").
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
2. Copy your **Default token** from <https://ion.cesium.com/tokens>.
3. In the game, open **Settings**, paste the token and choose **Photorealistic 3D** scenery.

The token is only stored in your own browser (localStorage). It is never put into the repository.

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
js/model/builder.js   procedural aircraft geometry from real dimensions
js/model/painter.js   livery texture painter
js/data/aircraft.js   aircraft specifications
js/data/liveries.js   airline liveries
js/cockpit/instruments.js  PFD / ND / EICAS
```

## Credits and legal

- [CesiumJS](https://cesium.com) (Apache 2.0) and [three.js](https://threejs.org) (MIT) load from the jsDelivr CDN.
- Airport and runway data comes from [OurAirports](https://ourairports.com/data/) (public domain).
- Aircraft specifications are taken from manufacturers' public data.
- This is an independent hobby project. It isn't affiliated with Microsoft, any aircraft manufacturer or any airline. Airline names, logos and liveries are trademarks of their owners. They're recreated here only for personal, non-commercial simulation.
