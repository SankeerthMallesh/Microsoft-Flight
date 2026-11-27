// Real-world aircraft database.
// Dimensions in metres, masses in kg, thrust in kN (per engine), power in kW (per engine).
// Figures come from manufacturer published specifications (rounded). Geometry hints
// (geo) drive the procedural 3D model builder; perf drives the flight model.

const KT = 0.514444;

// Shared presets -----------------------------------------------------------
const AIRBUS_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '1', flap: 0.0, slat: 0.6 },
  { label: '1+F', flap: 0.25, slat: 0.6 },
  { label: '2', flap: 0.45, slat: 0.8 },
  { label: '3', flap: 0.7, slat: 1 },
  { label: 'FULL', flap: 1, slat: 1 },
];
const BOEING_737_FLAPS = [
  { label: 'UP', flap: 0, slat: 0 },
  { label: '1', flap: 0.05, slat: 0.5 },
  { label: '2', flap: 0.1, slat: 0.5 },
  { label: '5', flap: 0.2, slat: 0.7 },
  { label: '10', flap: 0.3, slat: 1 },
  { label: '15', flap: 0.42, slat: 1 },
  { label: '25', flap: 0.6, slat: 1 },
  { label: '30', flap: 0.78, slat: 1 },
  { label: '40', flap: 1, slat: 1 },
];
const BOEING_WIDE_FLAPS = [
  { label: 'UP', flap: 0, slat: 0 },
  { label: '1', flap: 0.05, slat: 0.6 },
  { label: '5', flap: 0.2, slat: 0.8 },
  { label: '15', flap: 0.42, slat: 1 },
  { label: '20', flap: 0.55, slat: 1 },
  { label: '25', flap: 0.75, slat: 1 },
  { label: '30', flap: 1, slat: 1 },
];
const EMB_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '1', flap: 0.1, slat: 0.6 },
  { label: '2', flap: 0.25, slat: 0.8 },
  { label: '3', flap: 0.4, slat: 1 },
  { label: '4', flap: 0.55, slat: 1 },
  { label: '5', flap: 0.75, slat: 1 },
  { label: 'FULL', flap: 1, slat: 1 },
];
const CRJ_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '1', flap: 0.05, slat: 0.6 },
  { label: '8', flap: 0.2, slat: 1 },
  { label: '20', flap: 0.45, slat: 1 },
  { label: '30', flap: 0.7, slat: 1 },
  { label: '45', flap: 1, slat: 1 },
];
const ATR_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '15', flap: 0.45, slat: 0 },
  { label: '30', flap: 1, slat: 0 },
];
const Q400_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '5', flap: 0.15, slat: 0 },
  { label: '10', flap: 0.3, slat: 0 },
  { label: '15', flap: 0.5, slat: 0 },
  { label: '35', flap: 1, slat: 0 },
];
const GA_FLAPS = [
  { label: '0°', flap: 0, slat: 0 },
  { label: '10°', flap: 0.33, slat: 0 },
  { label: '20°', flap: 0.66, slat: 0 },
  { label: '30°', flap: 1, slat: 0 },
];
const KINGAIR_FLAPS = [
  { label: 'UP', flap: 0, slat: 0 },
  { label: 'APPR', flap: 0.45, slat: 0 },
  { label: 'DOWN', flap: 1, slat: 0 },
];
const BIZJET_FLAPS = [
  { label: '0', flap: 0, slat: 0 },
  { label: '10', flap: 0.3, slat: 0 },
  { label: '20', flap: 0.6, slat: 0 },
  { label: '39', flap: 1, slat: 0 },
];
const MD11_FLAPS = [
  { label: 'UP', flap: 0, slat: 0 },
  { label: '15', flap: 0.35, slat: 1 },
  { label: '25', flap: 0.55, slat: 1 },
  { label: '35', flap: 0.8, slat: 1 },
  { label: '50', flap: 1, slat: 1 },
];

// Helper to describe wing engine positions as fraction of semi-span.
const twinWing = (y = 0.34) => [{ mount: 'wing', y }];
const quadWing = (y1, y2) => [{ mount: 'wing', y: y1 }, { mount: 'wing', y: y2 }];

export const AIRCRAFT = [
  // ---------------------------------------------------------------- AIRBUS
  {
    id: 'a220-300', maker: 'Airbus', name: 'A220-300', family: 'A220', category: 'Narrow-body',
    length: 38.7, span: 35.1, height: 11.5, wingArea: 112.3, mtow: 70900, oew: 37080, fuel: 17250,
    engines: { count: 2, type: 'turbofan', thrust: 103.6, name: 'P&W PW1500G' },
    perf: { mmo: 0.82, vmo: 330, cruiseMach: 0.78, ceiling: 41000, range: 6700, seats: '130–160' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.7, nose: 'airbus', wingX: 0.36, sweep: 27, dihedral: 5, taper: 0.28, tip: 'raked', gc: 0.8,
      eng: twinWing(0.33), nacD: 2.15, vt: { h: 6.2 }, mainWheels: 2 },
  },
  {
    id: 'a319neo', maker: 'Airbus', name: 'A319neo', family: 'A320', category: 'Narrow-body',
    length: 33.84, span: 35.8, height: 11.76, wingArea: 122.6, mtow: 75500, oew: 44500, fuel: 21400,
    engines: { count: 2, type: 'turbofan', thrust: 120.6, name: 'CFM LEAP-1A / PW1100G' },
    perf: { mmo: 0.82, vmo: 350, cruiseMach: 0.78, ceiling: 39800, range: 6850, seats: '120–160' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.95, nose: 'airbus', wingX: 0.33, sweep: 25, dihedral: 5.1, taper: 0.24, tip: 'sharklet', gc: 1.0,
      eng: twinWing(0.34), nacD: 2.4, vt: { h: 6.3 }, mainWheels: 2 },
  },
  {
    id: 'a320neo', maker: 'Airbus', name: 'A320neo', family: 'A320', category: 'Narrow-body',
    detailed: { glb: 'models/a320neo.glb', meta: 'models/a320neo.meta.json', credit: '"Airbus A320-200 V2" by Dlourine (Sketchfab), CC BY 4.0 — modified' },
    cockpit: { glb: 'models/a320neo-cockpit.glb', meta: 'models/a320neo-cockpit.meta.json', credit: 'FlightGear A320-family flight deck (GPL v2)' },
    length: 37.57, span: 35.8, height: 11.76, wingArea: 122.6, mtow: 79000, oew: 44300, fuel: 21400,
    engines: { count: 2, type: 'turbofan', thrust: 120.6, name: 'CFM LEAP-1A / PW1100G' },
    perf: { mmo: 0.82, vmo: 350, cruiseMach: 0.78, ceiling: 39800, range: 6300, seats: '150–194' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.95, nose: 'airbus', wingX: 0.35, sweep: 25, dihedral: 5.1, taper: 0.24, tip: 'sharklet', gc: 1.0,
      eng: twinWing(0.34), nacD: 2.4, vt: { h: 6.3 }, mainWheels: 2 },
  },
  {
    id: 'a321neo', maker: 'Airbus', name: 'A321neo', family: 'A320', category: 'Narrow-body',
    length: 44.51, span: 35.8, height: 11.76, wingArea: 122.6, mtow: 97000, oew: 50100, fuel: 26300,
    engines: { count: 2, type: 'turbofan', thrust: 147, name: 'CFM LEAP-1A / PW1100G' },
    perf: { mmo: 0.82, vmo: 350, cruiseMach: 0.78, ceiling: 39800, range: 7400, seats: '180–244' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.95, nose: 'airbus', wingX: 0.37, sweep: 25, dihedral: 5.1, taper: 0.24, tip: 'sharklet', gc: 1.0,
      eng: twinWing(0.34), nacD: 2.4, vt: { h: 6.3 }, mainWheels: 2 },
  },
  {
    id: 'a330-300', maker: 'Airbus', name: 'A330-300', family: 'A330', category: 'Wide-body',
    length: 63.67, span: 60.3, height: 16.79, wingArea: 361.6, mtow: 242000, oew: 129400, fuel: 109200,
    engines: { count: 2, type: 'turbofan', thrust: 316, name: 'RR Trent 700 / GE CF6-80E' },
    perf: { mmo: 0.86, vmo: 330, cruiseMach: 0.82, ceiling: 41450, range: 11750, seats: '277–300' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.64, nose: 'airbus', wingX: 0.36, sweep: 30, dihedral: 5.5, taper: 0.25, tip: 'blended', tipH: 2.7, gc: 1.5,
      eng: twinWing(0.33), nacD: 3.0, vt: { h: 8.9 }, mainWheels: 4 },
  },
  {
    id: 'a330-900', maker: 'Airbus', name: 'A330-900neo', family: 'A330', category: 'Wide-body',
    length: 63.66, span: 64.0, height: 16.79, wingArea: 465, mtow: 251000, oew: 135000, fuel: 109200,
    engines: { count: 2, type: 'turbofan', thrust: 324, name: 'RR Trent 7000' },
    perf: { mmo: 0.86, vmo: 330, cruiseMach: 0.82, ceiling: 41450, range: 13334, seats: '260–300' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.64, nose: 'airbus', wingX: 0.36, sweep: 30, dihedral: 5.5, taper: 0.24, tip: 'sharklet', tipH: 3.7, gc: 1.5,
      eng: twinWing(0.33), nacD: 3.35, vt: { h: 8.9 }, mainWheels: 4 },
  },
  {
    id: 'a340-600', maker: 'Airbus', name: 'A340-600', family: 'A340', category: 'Wide-body',
    length: 75.36, span: 63.45, height: 17.22, wingArea: 439.4, mtow: 380000, oew: 177000, fuel: 155000,
    engines: { count: 4, type: 'turbofan', thrust: 249, name: 'RR Trent 556' },
    perf: { mmo: 0.86, vmo: 330, cruiseMach: 0.83, ceiling: 41450, range: 14450, seats: '326–380' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.64, nose: 'airbus', wingX: 0.37, sweep: 31.1, dihedral: 5.5, taper: 0.22, tip: 'blended', tipH: 2.9, gc: 1.6,
      eng: quadWing(0.28, 0.55), nacD: 2.9, vt: { h: 9.2 }, mainWheels: 4, centerGear: true },
  },
  {
    id: 'a350-900', maker: 'Airbus', name: 'A350-900', family: 'A350', category: 'Wide-body',
    length: 66.8, span: 64.75, height: 17.05, wingArea: 442, mtow: 283000, oew: 142400, fuel: 110500,
    engines: { count: 2, type: 'turbofan', thrust: 374, name: 'RR Trent XWB-84' },
    perf: { mmo: 0.89, vmo: 340, cruiseMach: 0.85, ceiling: 43100, range: 15372, seats: '300–350' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.96, nose: 'a350', wingX: 0.36, sweep: 31.9, dihedral: 6, taper: 0.2, tip: 'curved', tipH: 4.2, gc: 1.6,
      eng: twinWing(0.33), nacD: 3.6, vt: { h: 9.1 }, mainWheels: 4 },
  },
  {
    id: 'a350-1000', maker: 'Airbus', name: 'A350-1000', family: 'A350', category: 'Wide-body',
    length: 73.79, span: 64.75, height: 17.08, wingArea: 464.3, mtow: 319000, oew: 155000, fuel: 124700,
    engines: { count: 2, type: 'turbofan', thrust: 431, name: 'RR Trent XWB-97' },
    perf: { mmo: 0.89, vmo: 340, cruiseMach: 0.85, ceiling: 41450, range: 16100, seats: '350–410' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.96, nose: 'a350', wingX: 0.37, sweep: 31.9, dihedral: 6, taper: 0.2, tip: 'curved', tipH: 4.2, gc: 1.6,
      eng: twinWing(0.33), nacD: 3.7, vt: { h: 9.1 }, mainWheels: 6 },
  },
  {
    id: 'a380-800', maker: 'Airbus', name: 'A380-800', family: 'A380', category: 'Wide-body',
    length: 72.72, span: 79.75, height: 24.09, wingArea: 845, mtow: 575000, oew: 277000, fuel: 254000,
    engines: { count: 4, type: 'turbofan', thrust: 334, name: 'RR Trent 900 / EA GP7200' },
    perf: { mmo: 0.89, vmo: 340, cruiseMach: 0.85, ceiling: 43000, range: 14800, seats: '525–853' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 7.14, dh: 8.41, nose: 'a380', wingX: 0.33, sweep: 33.5, dihedral: 5.6, taper: 0.22, tip: 'fence', tipH: 2.4, gc: 1.9,
      eng: quadWing(0.31, 0.58), nacD: 3.4, vt: { h: 13.0 }, mainWheels: 4, bodyGear: 6, noseLen: 1.6, tailLen: 2.7 },
  },
  // ---------------------------------------------------------------- BOEING
  {
    id: 'b737-700', maker: 'Boeing', name: '737-700', family: '737 NG', category: 'Narrow-body',
    length: 33.6, span: 35.8, height: 12.5, wingArea: 124.6, mtow: 70080, oew: 38150, fuel: 20900,
    engines: { count: 2, type: 'turbofan', thrust: 116.5, name: 'CFM56-7B' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.785, ceiling: 41000, range: 6370, seats: '126–149' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.34, sweep: 25, dihedral: 6, taper: 0.28, tip: 'blended', tipH: 2.5, gc: 0.55,
      eng: twinWing(0.31), nacD: 2.0, flatNacelle: true, vt: { h: 6.9 }, mainWheels: 2 },
  },
  {
    id: 'b737-800', maker: 'Boeing', name: '737-800', family: '737 NG', category: 'Narrow-body',
    detailed: { glb: 'models/b737-800.glb', meta: 'models/b737-800.meta.json', credit: '"B737-800 Model" by hakai315 (Sketchfab), CC BY 4.0 — modified' },
    cockpit: { glb: 'models/b737-800-cockpit.glb', meta: 'models/b737-800-cockpit.meta.json', credit: 'FlightGear 737-800 flight deck (GPL v2)' },
    length: 39.5, span: 35.8, height: 12.5, wingArea: 124.6, mtow: 79010, oew: 41413, fuel: 20900,
    engines: { count: 2, type: 'turbofan', thrust: 121.4, name: 'CFM56-7B27' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.785, ceiling: 41000, range: 5436, seats: '162–189' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.36, sweep: 25, dihedral: 6, taper: 0.28, tip: 'blended', tipH: 2.5, gc: 0.55,
      eng: twinWing(0.31), nacD: 2.0, flatNacelle: true, vt: { h: 6.9 }, mainWheels: 2 },
  },
  {
    id: 'b737-max8', maker: 'Boeing', name: '737 MAX 8', family: '737 MAX', category: 'Narrow-body',
    detailed: { glb: 'models/b737-max8.glb', meta: 'models/b737-max8.meta.json', credit: '"Boeing 737 MAX 8" by Dlourine (Sketchfab), CC BY 4.0 — modified' },
    // 737NG flight deck from FlightGear, aligned to the MAX fuselage; larger MAX display units
    cockpit: { glb: 'models/b737-800-cockpit.glb', meta: 'models/b737-800-cockpit.meta.json', offset: [0.03, 0, -0.3], screenScale: [1.12, 1.04], credit: 'FlightGear 737-800 flight deck (GPL v2), adapted for the 737 MAX' },
    length: 39.52, span: 35.9, height: 12.3, wingArea: 127, mtow: 82190, oew: 45070, fuel: 20700,
    engines: { count: 2, type: 'turbofan', thrust: 130.4, name: 'CFM LEAP-1B' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.79, ceiling: 41000, range: 6570, seats: '162–210' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.36, sweep: 25, dihedral: 6, taper: 0.28, tip: 'split', tipH: 2.9, gc: 0.6,
      eng: twinWing(0.31), nacD: 2.15, chevrons: true, vt: { h: 6.9 }, mainWheels: 2, tailCone: 'max' },
  },
  {
    id: 'b737-max9', maker: 'Boeing', name: '737 MAX 9', family: '737 MAX', category: 'Narrow-body',
    length: 42.16, span: 35.9, height: 12.3, wingArea: 127, mtow: 88310, oew: 50300, fuel: 20700,
    engines: { count: 2, type: 'turbofan', thrust: 130.4, name: 'CFM LEAP-1B' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.79, ceiling: 41000, range: 6570, seats: '178–220' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.37, sweep: 25, dihedral: 6, taper: 0.28, tip: 'split', tipH: 2.9, gc: 0.6,
      eng: twinWing(0.31), nacD: 2.15, chevrons: true, vt: { h: 6.9 }, mainWheels: 2, tailCone: 'max' },
  },
  {
    id: 'b747-400', maker: 'Boeing', name: '747-400', family: '747', category: 'Wide-body',
    length: 70.6, span: 64.4, height: 19.4, wingArea: 525, mtow: 396900, oew: 178756, fuel: 174000,
    engines: { count: 4, type: 'turbofan', thrust: 252, name: 'P&W PW4056 / GE CF6-80C2 / RB211' },
    perf: { mmo: 0.92, vmo: 365, cruiseMach: 0.85, ceiling: 45100, range: 13450, seats: '416–524' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 6.5, dh: 7.8, nose: 'b747', wingX: 0.32, sweep: 37.5, dihedral: 7, taper: 0.24, tip: 'canted', tipH: 1.8, gc: 1.8,
      eng: quadWing(0.4, 0.69), nacD: 2.9, vt: { h: 10.8 }, mainWheels: 4, bodyGear: 4, deck2: 0.3, noseLen: 1.4 },
  },
  {
    id: 'b747-8i', maker: 'Boeing', name: '747-8 Intercontinental', family: '747', category: 'Wide-body',
    length: 76.3, span: 68.4, height: 19.4, wingArea: 554, mtow: 447700, oew: 220128, fuel: 194000,
    engines: { count: 4, type: 'turbofan', thrust: 296, name: 'GE GEnx-2B67' },
    perf: { mmo: 0.92, vmo: 365, cruiseMach: 0.855, ceiling: 43100, range: 14320, seats: '410–467' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 6.5, dh: 7.8, nose: 'b747', wingX: 0.33, sweep: 37.5, dihedral: 7, taper: 0.22, tip: 'raked', gc: 1.8,
      eng: quadWing(0.4, 0.69), nacD: 3.1, chevrons: true, vt: { h: 10.8 }, mainWheels: 4, bodyGear: 4, deck2: 0.37, noseLen: 1.4 },
  },
  {
    id: 'b757-200', maker: 'Boeing', name: '757-200', family: '757', category: 'Narrow-body',
    length: 47.3, span: 38.05, height: 13.6, wingArea: 185.25, mtow: 115680, oew: 58390, fuel: 34900,
    engines: { count: 2, type: 'turbofan', thrust: 191.7, name: 'RR RB211-535 / PW2000' },
    perf: { mmo: 0.86, vmo: 350, cruiseMach: 0.8, ceiling: 42000, range: 7250, seats: '200–239' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: '757', wingX: 0.36, sweep: 25, dihedral: 6, taper: 0.24, tip: 'blended', tipH: 3.1, gc: 1.3,
      eng: twinWing(0.33), nacD: 2.5, vt: { h: 7.4 }, mainWheels: 4 },
  },
  {
    id: 'b767-300er', maker: 'Boeing', name: '767-300ER', family: '767', category: 'Wide-body',
    length: 54.9, span: 47.6, height: 15.8, wingArea: 283.3, mtow: 186880, oew: 90010, fuel: 73400,
    engines: { count: 2, type: 'turbofan', thrust: 282, name: 'GE CF6-80C2 / PW4060' },
    perf: { mmo: 0.86, vmo: 360, cruiseMach: 0.8, ceiling: 43100, range: 11070, seats: '218–269' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 5.03, nose: '767', wingX: 0.36, sweep: 31.5, dihedral: 6, taper: 0.24, tip: 'none', gc: 1.4,
      eng: twinWing(0.32), nacD: 2.9, vt: { h: 8.6 }, mainWheels: 4 },
  },
  {
    id: 'b777-200er', maker: 'Boeing', name: '777-200ER', family: '777', category: 'Wide-body',
    cockpit: { glb: 'models/b777-300er-cockpit.glb', meta: 'models/b777-300er-cockpit.meta.json', offset: [-4.384, 0, 0.23], credit: 'FlightGear Boeing 777 flight deck (GPL v2), adapted for the 777-200ER' },
    length: 63.7, span: 60.9, height: 18.5, wingArea: 427.8, mtow: 297550, oew: 138100, fuel: 137000,
    engines: { count: 2, type: 'turbofan', thrust: 417, name: 'GE90-94B / Trent 895 / PW4090' },
    perf: { mmo: 0.89, vmo: 330, cruiseMach: 0.84, ceiling: 43100, range: 13080, seats: '301–400' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 6.19, nose: '777', wingX: 0.36, sweep: 31.6, dihedral: 6, taper: 0.2, tip: 'none', gc: 1.9,
      eng: twinWing(0.32), nacD: 3.9, vt: { h: 10.0 }, mainWheels: 6, tailCone: '777' },
  },
  {
    id: 'b777-300er', maker: 'Boeing', name: '777-300ER', family: '777', category: 'Wide-body',
    cockpit: { glb: 'models/b777-300er-cockpit.glb', meta: 'models/b777-300er-cockpit.meta.json', credit: 'FlightGear Boeing 777 flight deck (GPL v2)' },
    length: 73.9, span: 64.8, height: 18.5, wingArea: 436.8, mtow: 351500, oew: 167800, fuel: 145500,
    engines: { count: 2, type: 'turbofan', thrust: 513, name: 'GE90-115B' },
    perf: { mmo: 0.89, vmo: 330, cruiseMach: 0.84, ceiling: 43100, range: 13650, seats: '350–396' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 6.19, nose: '777', wingX: 0.37, sweep: 31.6, dihedral: 6, taper: 0.2, tip: 'raked', gc: 1.9,
      eng: twinWing(0.32), nacD: 4.2, vt: { h: 10.0 }, mainWheels: 6, tailCone: '777' },
  },
  {
    id: 'b777f', maker: 'Boeing', name: '777 Freighter', family: '777', category: 'Cargo',
    cockpit: { glb: 'models/b777-300er-cockpit.glb', meta: 'models/b777-300er-cockpit.meta.json', offset: [-4.411, 0, 0], credit: 'FlightGear Boeing 777 flight deck (GPL v2), adapted for the 777F' },
    length: 63.7, span: 64.8, height: 18.6, wingArea: 436.8, mtow: 347800, oew: 144400, fuel: 145500,
    engines: { count: 2, type: 'turbofan', thrust: 493, name: 'GE90-110B1' },
    perf: { mmo: 0.89, vmo: 330, cruiseMach: 0.84, ceiling: 43100, range: 9070, seats: 'Cargo 102 t' },
    flaps: BOEING_WIDE_FLAPS, cargo: true,
    geo: { d: 6.19, nose: '777', wingX: 0.36, sweep: 31.6, dihedral: 6, taper: 0.2, tip: 'raked', gc: 1.9,
      eng: twinWing(0.32), nacD: 4.2, vt: { h: 10.0 }, mainWheels: 6, tailCone: '777' },
  },
  {
    id: 'b777-9', maker: 'Boeing', name: '777-9', family: '777X', category: 'Wide-body',
    cockpit: { glb: 'models/b777-300er-cockpit.glb', meta: 'models/b777-300er-cockpit.meta.json', offset: [0.531, 0, -0.128], credit: 'FlightGear Boeing 777 flight deck (GPL v2), adapted for the 777-9' },
    length: 76.7, span: 71.8, height: 19.7, wingArea: 516.7, mtow: 351500, oew: 181400, fuel: 158900,
    engines: { count: 2, type: 'turbofan', thrust: 470, name: 'GE GE9X' },
    perf: { mmo: 0.89, vmo: 330, cruiseMach: 0.84, ceiling: 43100, range: 13500, seats: '426' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 6.19, nose: '787', wingX: 0.36, sweep: 29.5, dihedral: 6, taper: 0.18, tip: 'raked', gc: 1.9,
      eng: twinWing(0.31), nacD: 4.4, chevrons: false, vt: { h: 10.4 }, mainWheels: 6, tailCone: '777' },
  },
  {
    id: 'b787-8', maker: 'Boeing', name: '787-8 Dreamliner', family: '787', category: 'Wide-body',
    length: 56.72, span: 60.12, height: 16.92, wingArea: 377, mtow: 227930, oew: 119950, fuel: 101000,
    engines: { count: 2, type: 'turbofan', thrust: 280, name: 'GEnx-1B / Trent 1000' },
    perf: { mmo: 0.9, vmo: 360, cruiseMach: 0.85, ceiling: 43100, range: 13530, seats: '248' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 5.77, nose: '787', wingX: 0.35, sweep: 32.2, dihedral: 6, taper: 0.18, tip: 'raked', gc: 1.5, wingFlex: 1.2,
      eng: twinWing(0.32), nacD: 3.4, chevrons: true, vt: { h: 9.0 }, mainWheels: 4 },
  },
  {
    id: 'b787-9', maker: 'Boeing', name: '787-9 Dreamliner', family: '787', category: 'Wide-body',
    length: 62.81, span: 60.12, height: 17.02, wingArea: 377, mtow: 254011, oew: 128850, fuel: 101500,
    engines: { count: 2, type: 'turbofan', thrust: 320, name: 'GEnx-1B / Trent 1000' },
    perf: { mmo: 0.9, vmo: 360, cruiseMach: 0.85, ceiling: 43100, range: 14010, seats: '296' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 5.77, nose: '787', wingX: 0.36, sweep: 32.2, dihedral: 6, taper: 0.18, tip: 'raked', gc: 1.5, wingFlex: 1.2,
      eng: twinWing(0.32), nacD: 3.4, chevrons: true, vt: { h: 9.0 }, mainWheels: 4 },
  },
  {
    id: 'b787-10', maker: 'Boeing', name: '787-10 Dreamliner', family: '787', category: 'Wide-body',
    length: 68.28, span: 60.12, height: 17.02, wingArea: 377, mtow: 254011, oew: 135500, fuel: 101500,
    engines: { count: 2, type: 'turbofan', thrust: 340, name: 'GEnx-1B / Trent 1000' },
    perf: { mmo: 0.9, vmo: 360, cruiseMach: 0.85, ceiling: 41100, range: 11910, seats: '336' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 5.77, nose: '787', wingX: 0.37, sweep: 32.2, dihedral: 6, taper: 0.18, tip: 'raked', gc: 1.5, wingFlex: 1.2,
      eng: twinWing(0.32), nacD: 3.4, chevrons: true, vt: { h: 9.0 }, mainWheels: 4 },
  },
  // ------------------------------------------------------------- McDONNELL
  {
    id: 'md-11f', maker: 'McDonnell Douglas', name: 'MD-11F', family: 'MD-11', category: 'Cargo',
    length: 61.6, span: 51.97, height: 17.6, wingArea: 338.9, mtow: 286000, oew: 128000, fuel: 117000,
    engines: { count: 3, type: 'turbofan', thrust: 274, name: 'GE CF6-80C2 / PW4462' },
    perf: { mmo: 0.87, vmo: 365, cruiseMach: 0.83, ceiling: 42000, range: 6725, seats: 'Cargo 91 t' },
    flaps: MD11_FLAPS, cargo: true,
    geo: { d: 6.02, nose: 'dc10', wingX: 0.33, sweep: 35, dihedral: 5.5, taper: 0.24, tip: 'md11', tipH: 2.5, gc: 1.6,
      eng: [{ mount: 'wing', y: 0.33 }, { mount: 'tail3' }], nacD: 2.9, vt: { h: 9.2, x: 0.84 }, mainWheels: 4, centerGear: true },
  },
  // -------------------------------------------------------------- EMBRAER
  {
    id: 'e175', maker: 'Embraer', name: 'E175', family: 'E-Jet', category: 'Regional jet',
    length: 31.68, span: 26.0, height: 9.86, wingArea: 72.72, mtow: 38790, oew: 21890, fuel: 9430,
    engines: { count: 2, type: 'turbofan', thrust: 63.2, name: 'GE CF34-8E' },
    perf: { mmo: 0.82, vmo: 320, cruiseMach: 0.78, ceiling: 41000, range: 3700, seats: '76–88' },
    flaps: EMB_FLAPS,
    geo: { d: 3.01, dh: 3.35, nose: 'embraer', wingX: 0.36, sweep: 23.5, dihedral: 5, taper: 0.3, tip: 'blended', tipH: 1.3, gc: 0.8,
      eng: twinWing(0.33), nacD: 1.45, vt: { h: 4.9 }, mainWheels: 2 },
  },
  {
    id: 'e190-e2', maker: 'Embraer', name: 'E190-E2', family: 'E-Jet E2', category: 'Regional jet',
    length: 36.25, span: 33.72, height: 10.95, wingArea: 103, mtow: 56400, oew: 33000, fuel: 13690,
    engines: { count: 2, type: 'turbofan', thrust: 100.1, name: 'P&W PW1900G' },
    perf: { mmo: 0.82, vmo: 320, cruiseMach: 0.78, ceiling: 41000, range: 5300, seats: '97–114' },
    flaps: EMB_FLAPS,
    geo: { d: 3.01, dh: 3.35, nose: 'embraer', wingX: 0.36, sweep: 25, dihedral: 5, taper: 0.26, tip: 'raked', gc: 0.9,
      eng: twinWing(0.32), nacD: 2.0, vt: { h: 5.6 }, mainWheels: 2 },
  },
  {
    id: 'e195-e2', maker: 'Embraer', name: 'E195-E2', family: 'E-Jet E2', category: 'Regional jet',
    length: 41.5, span: 35.12, height: 10.9, wingArea: 110, mtow: 62500, oew: 35700, fuel: 13690,
    engines: { count: 2, type: 'turbofan', thrust: 100.1, name: 'P&W PW1900G' },
    perf: { mmo: 0.82, vmo: 320, cruiseMach: 0.78, ceiling: 41000, range: 4800, seats: '120–146' },
    flaps: EMB_FLAPS,
    geo: { d: 3.01, dh: 3.35, nose: 'embraer', wingX: 0.38, sweep: 25, dihedral: 5, taper: 0.26, tip: 'raked', gc: 0.9,
      eng: twinWing(0.32), nacD: 2.0, vt: { h: 5.6 }, mainWheels: 2 },
  },
  // ---------------------------------------------------- BOMBARDIER / MHI
  {
    id: 'crj900', maker: 'Bombardier', name: 'CRJ900', family: 'CRJ', category: 'Regional jet',
    length: 36.2, span: 24.9, height: 7.5, wingArea: 70.6, mtow: 38330, oew: 21845, fuel: 8820,
    engines: { count: 2, type: 'turbofan', thrust: 64.5, name: 'GE CF34-8C5' },
    perf: { mmo: 0.85, vmo: 335, cruiseMach: 0.78, ceiling: 41000, range: 2956, seats: '76–90' },
    flaps: CRJ_FLAPS,
    geo: { d: 2.69, nose: 'crj', wingX: 0.44, sweep: 26.9, dihedral: 4, taper: 0.3, tip: 'blended', tipH: 1.2, gc: 0.6,
      eng: [{ mount: 'tail' }], nacD: 1.45, tTail: true, vt: { h: 4.2, x: 0.8 }, mainWheels: 2, tailLen: 2.4 },
  },
  {
    id: 'dash8-400', maker: 'De Havilland Canada', name: 'Dash 8-400', family: 'Dash 8', category: 'Turboprop',
    length: 32.81, span: 28.42, height: 8.34, wingArea: 63.08, mtow: 29574, oew: 17185, fuel: 5320,
    engines: { count: 2, type: 'turboprop', power: 3781, name: 'P&W Canada PW150A', propD: 4.11, blades: 6 },
    perf: { mmo: 0.6, vmo: 286, cruiseKtas: 360, ceiling: 27000, range: 2040, seats: '78–90' },
    flaps: Q400_FLAPS,
    geo: { d: 2.69, nose: 'q400', wingX: 0.4, wingZ: 'high', sweep: 2, dihedral: 2.5, taper: 0.5, tip: 'none', gc: 1.0,
      eng: [{ mount: 'highwing', y: 0.29 }], nacD: 1.25, tTail: true, vt: { h: 4.9, x: 0.79 }, mainWheels: 2, tailLen: 2.6 },
  },
  {
    id: 'atr72-600', maker: 'ATR', name: 'ATR 72-600', family: 'ATR', category: 'Turboprop',
    length: 27.17, span: 27.05, height: 7.65, wingArea: 61, mtow: 23000, oew: 13311, fuel: 5000,
    engines: { count: 2, type: 'turboprop', power: 2051, name: 'P&W Canada PW127M', propD: 3.93, blades: 6 },
    perf: { mmo: 0.55, vmo: 250, cruiseKtas: 275, ceiling: 25000, range: 1528, seats: '70–78' },
    flaps: ATR_FLAPS,
    geo: { d: 2.77, nose: 'atr', wingX: 0.42, wingZ: 'high', sweep: 3, dihedral: 2.5, taper: 0.55, tip: 'none', gc: 0.75,
      eng: [{ mount: 'highwing', y: 0.31 }], nacD: 1.15, tTail: true, vt: { h: 4.0, x: 0.8 }, mainWheels: 2, tailLen: 2.7, sponson: true },
  },
  // ----------------------------------------------------------- OTHER JETS
  {
    id: 'c919', maker: 'COMAC', name: 'C919', family: 'C919', category: 'Narrow-body',
    length: 38.9, span: 35.8, height: 11.95, wingArea: 129.15, mtow: 72500, oew: 42100, fuel: 19500,
    engines: { count: 2, type: 'turbofan', thrust: 129.7, name: 'CFM LEAP-1C' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.785, ceiling: 39800, range: 5555, seats: '158–192' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.96, nose: 'airbus', wingX: 0.35, sweep: 25, dihedral: 5, taper: 0.24, tip: 'sharklet', gc: 1.0,
      eng: twinWing(0.33), nacD: 2.3, vt: { h: 6.4 }, mainWheels: 2 },
  },
  {
    id: 'ssj100', maker: 'Sukhoi', name: 'Superjet 100', family: 'SSJ', category: 'Regional jet',
    length: 29.94, span: 27.8, height: 10.28, wingArea: 83.8, mtow: 45880, oew: 24250, fuel: 12690,
    engines: { count: 2, type: 'turbofan', thrust: 77.8, name: 'PowerJet SaM146' },
    perf: { mmo: 0.81, vmo: 320, cruiseMach: 0.78, ceiling: 40000, range: 3048, seats: '87–108' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 3.24, nose: 'airbus', wingX: 0.35, sweep: 24, dihedral: 5, taper: 0.28, tip: 'sharklet', tipH: 1.4, gc: 0.9,
      eng: twinWing(0.33), nacD: 1.75, vt: { h: 5.0 }, mainWheels: 2 },
  },
  // ------------------------------------------------------ BUSINESS / GA
  {
    id: 'g650', maker: 'Gulfstream', name: 'G650ER', family: 'Gulfstream', category: 'Business jet',
    length: 30.41, span: 30.36, height: 7.72, wingArea: 119.2, mtow: 47630, oew: 24500, fuel: 21900,
    engines: { count: 2, type: 'turbofan', thrust: 75.2, name: 'RR BR725' },
    perf: { mmo: 0.925, vmo: 340, cruiseMach: 0.9, ceiling: 51000, range: 13890, seats: '11–19' },
    flaps: BIZJET_FLAPS,
    geo: { d: 2.5, dh: 2.6, nose: 'bizjet', wingX: 0.39, sweep: 36, dihedral: 3, taper: 0.3, tip: 'blended', tipH: 1.5, gc: 0.6,
      eng: [{ mount: 'tail' }], nacD: 1.45, tTail: true, vt: { h: 3.7, x: 0.79 }, mainWheels: 2, ovalWindows: true },
  },
  {
    id: 'kingair350', maker: 'Beechcraft', name: 'King Air 350i', family: 'King Air', category: 'Turboprop',
    length: 14.22, span: 17.65, height: 4.37, wingArea: 28.8, mtow: 6804, oew: 4150, fuel: 1640,
    engines: { count: 2, type: 'turboprop', power: 783, name: 'P&W Canada PT6A-60A', propD: 2.67, blades: 4 },
    perf: { mmo: 0.58, vmo: 263, cruiseKtas: 312, ceiling: 35000, range: 3345, seats: '8–11' },
    flaps: KINGAIR_FLAPS,
    geo: { d: 1.4, dh: 1.6, nose: 'kingair', wingX: 0.36, sweep: 2, dihedral: 6, taper: 0.5, tip: 'winglet-small', tipH: 0.6, gc: 0.45,
      eng: [{ mount: 'lowwing', y: 0.3 }], nacD: 0.75, tTail: true, vt: { h: 2.0, x: 0.78 }, mainWheels: 2, noseLen: 2.2, tailLen: 3.2 },
  },
  {
    id: 'c172', maker: 'Cessna', name: '172S Skyhawk', family: 'Cessna 172', category: 'General aviation',
    length: 8.28, span: 11.0, height: 2.72, wingArea: 16.2, mtow: 1157, oew: 767, fuel: 145,
    engines: { count: 1, type: 'piston', power: 134, name: 'Lycoming IO-360-L2A (180 hp)', propD: 1.93, blades: 2 },
    perf: { mmo: 0.3, vmo: 163, cruiseKtas: 124, ceiling: 14000, range: 1185, seats: '4' },
    flaps: GA_FLAPS,
    geo: { d: 1.12, dh: 1.45, nose: 'c172', wingX: 0.27, wingZ: 'high', sweep: 0, dihedral: 1.7, taper: 0.7, tip: 'none', gc: 0.35,
      eng: [{ mount: 'nose' }], fixedGear: true, strut: true, vt: { h: 1.25, x: 0.8 }, mainWheels: 1, noseLen: 1.4, tailLen: 3.6, boxy: true },
  },
  // ======================================================= additional types
  {
    id: 'a330-200', maker: 'Airbus', name: 'A330-200', family: 'A330', category: 'Wide-body',
    length: 58.82, span: 60.3, height: 17.39, wingArea: 361.6, mtow: 242000, oew: 120600, fuel: 111300,
    engines: { count: 2, type: 'turbofan', thrust: 316, name: 'RR Trent 700 / GE CF6-80E / PW4000' },
    perf: { mmo: 0.86, vmo: 330, cruiseMach: 0.82, ceiling: 41450, range: 13450, seats: '210–250' },
    flaps: AIRBUS_FLAPS, fbw: true,
    geo: { d: 5.64, nose: 'airbus', wingX: 0.35, sweep: 30, dihedral: 5.5, taper: 0.25, tip: 'blended', tipH: 2.7, gc: 1.5,
      eng: twinWing(0.33), nacD: 3.0, vt: { h: 9.4 }, mainWheels: 4 },
  },
  {
    id: 'a300-600f', maker: 'Airbus', name: 'A300-600F', family: 'A300', category: 'Cargo',
    length: 54.08, span: 44.84, height: 16.62, wingArea: 260, mtow: 170500, oew: 89000, fuel: 55000,
    engines: { count: 2, type: 'turbofan', thrust: 262, name: 'GE CF6-80C2' },
    perf: { mmo: 0.82, vmo: 335, cruiseMach: 0.78, ceiling: 40000, range: 4850, seats: 'Cargo 48 t' },
    flaps: [{ label: '0', flap: 0, slat: 0 }, { label: '15/0', flap: 0, slat: 0.8 }, { label: '15/15', flap: 0.35, slat: 1 }, { label: '15/20', flap: 0.55, slat: 1 }, { label: '30/40', flap: 1, slat: 1 }], cargo: true,
    geo: { d: 5.64, nose: 'airbus', wingX: 0.35, sweep: 28, dihedral: 5.5, taper: 0.3, tip: 'fence', tipH: 1.4, gc: 1.4,
      eng: twinWing(0.34), nacD: 2.9, vt: { h: 8.6 }, mainWheels: 4 },
  },
  {
    id: 'b737-max7', maker: 'Boeing', name: '737 MAX 7', family: '737 MAX', category: 'Narrow-body',
    length: 35.56, span: 35.9, height: 12.3, wingArea: 127, mtow: 80286, oew: 42240, fuel: 20700,
    engines: { count: 2, type: 'turbofan', thrust: 130.4, name: 'CFM LEAP-1B' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.79, ceiling: 41000, range: 7130, seats: '138–172' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.35, sweep: 25, dihedral: 6, taper: 0.28, tip: 'split', tipH: 2.9, gc: 0.6,
      eng: twinWing(0.31), nacD: 2.15, vt: { h: 6.9 }, mainWheels: 2, tailCone: 'max' },
  },
  {
    id: 'b737-900er', maker: 'Boeing', name: '737-900ER', family: '737 NG', category: 'Narrow-body',
    length: 42.11, span: 35.8, height: 12.5, wingArea: 124.6, mtow: 85139, oew: 44676, fuel: 22800,
    engines: { count: 2, type: 'turbofan', thrust: 121.4, name: 'CFM56-7B27' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.785, ceiling: 41000, range: 5460, seats: '178–220' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.37, sweep: 25, dihedral: 6, taper: 0.28, tip: 'blended', tipH: 2.5, gc: 0.55,
      eng: twinWing(0.31), nacD: 2.0, flatNacelle: true, vt: { h: 6.9 }, mainWheels: 2 },
  },
  {
    id: 'b737-max10', maker: 'Boeing', name: '737 MAX 10', family: '737 MAX', category: 'Narrow-body',
    length: 43.8, span: 35.9, height: 12.5, wingArea: 127, mtow: 89765, oew: 51800, fuel: 20700,
    engines: { count: 2, type: 'turbofan', thrust: 130.4, name: 'CFM LEAP-1B' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.79, ceiling: 41000, range: 6110, seats: '188–230' },
    flaps: BOEING_737_FLAPS,
    geo: { d: 3.76, dh: 4.01, nose: 'boeing', wingX: 0.37, sweep: 25, dihedral: 6, taper: 0.28, tip: 'split', tipH: 2.9, gc: 0.7,
      eng: twinWing(0.31), nacD: 2.15, vt: { h: 6.9 }, mainWheels: 2, tailCone: 'max' },
  },
  {
    id: 'b767-400er', maker: 'Boeing', name: '767-400ER', family: '767', category: 'Wide-body',
    length: 61.37, span: 51.92, height: 16.87, wingArea: 290.7, mtow: 204120, oew: 103872, fuel: 73400,
    engines: { count: 2, type: 'turbofan', thrust: 282, name: 'GE CF6-80C2 / PW4062' },
    perf: { mmo: 0.86, vmo: 360, cruiseMach: 0.8, ceiling: 43100, range: 10415, seats: '245–304' },
    flaps: BOEING_WIDE_FLAPS,
    geo: { d: 5.03, nose: '767', wingX: 0.37, sweep: 31.5, dihedral: 6, taper: 0.22, tip: 'raked', gc: 1.4,
      eng: twinWing(0.31), nacD: 2.9, vt: { h: 8.6 }, mainWheels: 4 },
  },
  {
    id: 'b747-8f', maker: 'Boeing', name: '747-8 Freighter', family: '747', category: 'Cargo',
    length: 76.25, span: 68.4, height: 19.35, wingArea: 554, mtow: 447700, oew: 197131, fuel: 181600,
    engines: { count: 4, type: 'turbofan', thrust: 296, name: 'GE GEnx-2B67' },
    perf: { mmo: 0.92, vmo: 365, cruiseMach: 0.845, ceiling: 43100, range: 8130, seats: 'Cargo 137.7 t' },
    flaps: BOEING_WIDE_FLAPS, cargo: true,
    geo: { d: 6.5, dh: 6.8, nose: 'b747', wingX: 0.33, sweep: 37.5, dihedral: 7, taper: 0.22, tip: 'raked', gc: 1.8,
      eng: quadWing(0.4, 0.69), nacD: 3.1, chevrons: true, vt: { h: 10.8 }, mainWheels: 4, bodyGear: 4, deck2: 0.2, noseLen: 1.4 },
  },
  {
    id: 'b717-200', maker: 'Boeing', name: '717-200', family: '717', category: 'Narrow-body',
    length: 37.81, span: 28.47, height: 8.92, wingArea: 92.97, mtow: 54885, oew: 31071, fuel: 11200,
    engines: { count: 2, type: 'turbofan', thrust: 82.3, name: 'RR BR715' },
    perf: { mmo: 0.82, vmo: 340, cruiseMach: 0.77, ceiling: 37000, range: 3820, seats: '106–134' },
    flaps: [{ label: 'UP', flap: 0, slat: 0 }, { label: '5', flap: 0.15, slat: 1 }, { label: '13', flap: 0.3, slat: 1 }, { label: '18', flap: 0.4, slat: 1 }, { label: '25', flap: 0.55, slat: 1 }, { label: '40', flap: 1, slat: 1 }],
    geo: { d: 3.34, nose: 'dc10', wingX: 0.42, sweep: 24.5, dihedral: 3, taper: 0.25, tip: 'none', gc: 0.8,
      eng: [{ mount: 'tail' }], nacD: 1.6, tTail: true, vt: { h: 4.2, x: 0.8 }, mainWheels: 2, tailLen: 2.5 },
  },
  {
    id: 'e190', maker: 'Embraer', name: 'E190', family: 'E-Jet', category: 'Regional jet',
    length: 36.24, span: 28.72, height: 10.57, wingArea: 92.5, mtow: 51800, oew: 28080, fuel: 12970,
    engines: { count: 2, type: 'turbofan', thrust: 82.3, name: 'GE CF34-10E' },
    perf: { mmo: 0.82, vmo: 320, cruiseMach: 0.78, ceiling: 41000, range: 4537, seats: '96–114' },
    flaps: EMB_FLAPS,
    geo: { d: 3.01, dh: 3.35, nose: 'embraer', wingX: 0.37, sweep: 23.5, dihedral: 5, taper: 0.3, tip: 'blended', tipH: 1.4, gc: 0.85,
      eng: twinWing(0.33), nacD: 1.7, vt: { h: 5.4 }, mainWheels: 2 },
  },
  {
    id: 'crj700', maker: 'Bombardier', name: 'CRJ700', family: 'CRJ', category: 'Regional jet',
    length: 32.51, span: 23.24, height: 7.57, wingArea: 70.6, mtow: 34019, oew: 19731, fuel: 8820,
    engines: { count: 2, type: 'turbofan', thrust: 61.3, name: 'GE CF34-8C5B1' },
    perf: { mmo: 0.85, vmo: 335, cruiseMach: 0.78, ceiling: 41000, range: 2593, seats: '66–78' },
    flaps: CRJ_FLAPS,
    geo: { d: 2.69, nose: 'crj', wingX: 0.43, sweep: 26.9, dihedral: 4, taper: 0.3, tip: 'blended', tipH: 1.1, gc: 0.6,
      eng: [{ mount: 'tail' }], nacD: 1.42, tTail: true, vt: { h: 4.2, x: 0.79 }, mainWheels: 2, tailLen: 2.4 },
  },
  {
    id: 'atr42-600', maker: 'ATR', name: 'ATR 42-600', family: 'ATR', category: 'Turboprop',
    length: 22.67, span: 24.57, height: 7.59, wingArea: 54.5, mtow: 18600, oew: 11550, fuel: 4500,
    engines: { count: 2, type: 'turboprop', power: 1611, name: 'P&W Canada PW127M', propD: 3.93, blades: 6 },
    perf: { mmo: 0.55, vmo: 250, cruiseKtas: 300, ceiling: 25000, range: 1326, seats: '48–50' },
    flaps: ATR_FLAPS,
    geo: { d: 2.77, nose: 'atr', wingX: 0.41, wingZ: 'high', sweep: 3, dihedral: 2.5, taper: 0.55, tip: 'none', gc: 0.75,
      eng: [{ mount: 'highwing', y: 0.33 }], nacD: 1.15, tTail: true, vt: { h: 4.0, x: 0.78 }, mainWheels: 2, tailLen: 2.7, sponson: true },
  },
  {
    id: 'global7500', maker: 'Bombardier', name: 'Global 7500', family: 'Global', category: 'Business jet',
    length: 33.8, span: 31.7, height: 8.2, wingArea: 87.5, mtow: 52163, oew: 28100, fuel: 25400,
    engines: { count: 2, type: 'turbofan', thrust: 82.3, name: 'GE Passport' },
    perf: { mmo: 0.925, vmo: 340, cruiseMach: 0.9, ceiling: 51000, range: 14260, seats: '14–19' },
    flaps: BIZJET_FLAPS,
    geo: { d: 2.69, dh: 2.8, nose: 'bizjet', wingX: 0.4, sweep: 34, dihedral: 3, taper: 0.3, tip: 'blended', tipH: 1.6, gc: 0.6,
      eng: [{ mount: 'tail' }], nacD: 1.6, tTail: true, vt: { h: 3.9, x: 0.79 }, mainWheels: 2, ovalWindows: true },
  },
  {
    id: 'cj4', maker: 'Cessna', name: 'Citation CJ4 Gen2', family: 'Citation', category: 'Business jet',
    length: 16.26, span: 15.49, height: 4.67, wingArea: 30.7, mtow: 7761, oew: 4880, fuel: 2650,
    engines: { count: 2, type: 'turbofan', thrust: 16, name: 'Williams FJ44-4A' },
    perf: { mmo: 0.77, vmo: 305, cruiseMach: 0.73, ceiling: 45000, range: 4010, seats: '9–10' },
    flaps: BIZJET_FLAPS,
    geo: { d: 1.68, dh: 1.75, nose: 'bizjet', wingX: 0.4, sweep: 12.5, dihedral: 4, taper: 0.4, tip: 'none', gc: 0.45,
      eng: [{ mount: 'tail' }], nacD: 0.82, tTail: true, vt: { h: 2.1, x: 0.78 }, mainWheels: 1, ovalWindows: true, noseLen: 2.6 },
  },
  {
    id: 'pc12', maker: 'Pilatus', name: 'PC-12 NGX', family: 'PC-12', category: 'Turboprop',
    length: 14.4, span: 16.28, height: 4.26, wingArea: 25.8, mtow: 4740, oew: 2961, fuel: 1220,
    engines: { count: 1, type: 'turboprop', power: 1007, name: 'P&W Canada PT6E-67XP', propD: 2.67, blades: 5 },
    perf: { mmo: 0.48, vmo: 236, cruiseKtas: 290, ceiling: 30000, range: 3417, seats: '6–10' },
    flaps: [{ label: '0°', flap: 0, slat: 0 }, { label: '15°', flap: 0.37, slat: 0 }, { label: '30°', flap: 0.75, slat: 0 }, { label: '40°', flap: 1, slat: 0 }],
    geo: { d: 1.52, dh: 1.75, nose: 'c172', wingX: 0.33, sweep: 1, dihedral: 4, taper: 0.55, tip: 'winglet-small', tipH: 0.5, gc: 0.5,
      eng: [{ mount: 'nose' }], tTail: true, vt: { h: 2.0, x: 0.78 }, mainWheels: 1, noseLen: 2.0, tailLen: 3.0, boxy: true },
  },
  {
    id: 'sr22', maker: 'Cirrus', name: 'SR22T G7', family: 'SR22', category: 'General aviation',
    length: 7.92, span: 11.68, height: 2.71, wingArea: 13.5, mtow: 1633, oew: 1070, fuel: 240,
    engines: { count: 1, type: 'piston', power: 235, name: 'Continental TSIO-550-K (315 hp)', propD: 1.98, blades: 3 },
    perf: { mmo: 0.32, vmo: 205, cruiseKtas: 213, ceiling: 25000, range: 1880, seats: '4–5' },
    flaps: [{ label: 'UP', flap: 0, slat: 0 }, { label: '50%', flap: 0.5, slat: 0 }, { label: '100%', flap: 1, slat: 0 }],
    geo: { d: 1.24, dh: 1.4, nose: 'c172', wingX: 0.32, wingZ: 'low', sweep: 0, dihedral: 4.5, taper: 0.6, tip: 'none', gc: 0.35,
      eng: [{ mount: 'nose' }], fixedGear: true, vt: { h: 1.2, x: 0.8 }, mainWheels: 1, noseLen: 1.5, tailLen: 3.4, boxy: true },
  },
  {
    id: 'pa28', maker: 'Piper', name: 'PA-28-181 Archer', family: 'Cherokee', category: 'General aviation',
    length: 7.25, span: 10.67, height: 2.22, wingArea: 15.8, mtow: 1157, oew: 690, fuel: 140,
    engines: { count: 1, type: 'piston', power: 134, name: 'Lycoming O-360-A4M (180 hp)', propD: 1.93, blades: 2 },
    perf: { mmo: 0.25, vmo: 154, cruiseKtas: 128, ceiling: 13240, range: 1185, seats: '4' },
    flaps: [{ label: '0°', flap: 0, slat: 0 }, { label: '10°', flap: 0.25, slat: 0 }, { label: '25°', flap: 0.62, slat: 0 }, { label: '40°', flap: 1, slat: 0 }],
    geo: { d: 1.12, dh: 1.3, nose: 'c172', wingX: 0.3, wingZ: 'low', sweep: 0, dihedral: 7, taper: 0.75, tip: 'none', gc: 0.3,
      eng: [{ mount: 'nose' }], fixedGear: true, vt: { h: 1.1, x: 0.8 }, mainWheels: 1, noseLen: 1.4, tailLen: 3.3, boxy: true },
  },
];

export const MAKERS = [...new Set(AIRCRAFT.map((a) => a.maker))];

export function getAircraft(id) {
  return AIRCRAFT.find((a) => a.id === id) || AIRCRAFT.find((a) => a.id === 'b737-800');
}

// Derived aerodynamic / handling data used by the flight model.
export function deriveAero(ac) {
  const b = ac.span, S = ac.wingArea;
  const AR = (b * b) / S;
  const mac = S / b;
  const g = ac.geo;
  const isJet = ac.engines.type === 'turbofan';
  const isGA = ac.category === 'General aviation';
  const clmaxClean = isGA ? 1.55 : isJet ? 1.45 : 1.6;
  const dclFlaps = isGA ? 0.55 : ac.engines.type === 'turboprop' ? 0.95 : 1.15;
  const dclSlats = isJet ? 0.35 : 0;
  const cd0 = isGA ? 0.032 : ac.engines.type === 'turboprop' ? 0.028 : ac.category === 'Business jet' ? 0.021 : ac.category === 'Wide-body' || ac.category === 'Cargo' ? 0.0195 : 0.023;
  const e = isGA ? 0.75 : ac.category === 'Wide-body' || ac.category === 'Cargo' ? 0.88 : 0.82;
  const L = ac.length;
  // Inertia from empirical radii of gyration (Roskam).
  const kx = 0.13 * b, ky = 0.19 * L, kz = 0.22 * Math.max(L, b * 0.9);
  const sweepRad = (g.sweep * Math.PI) / 180;
  const mcrit = isJet ? Math.min(0.9, 0.67 + 0.35 * Math.sin(sweepRad) + (ac.perf.mmo - 0.82) * 0.6) : 0.6;
  return {
    AR, mac, e, cd0, clmaxClean, dclFlaps, dclSlats, mcrit,
    clAlpha: (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR * (1 + Math.tan(sweepRad) ** 2))) * 1.05,
    cl0: isGA ? 0.3 : 0.22,
    kx, ky, kz,
  };
}

export const UNITS = { KT };
