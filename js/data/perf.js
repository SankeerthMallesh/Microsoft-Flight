// Performance tuning + published reference data for the flight model.
//
// AERO: lift / speed-schedule tuning per type (falls back by family, then by category). The lift
// increments are calibrated so that 1-g stall speeds, and hence Vr / V2 / Vref, match published
// FCOM / FPPM / POH figures at representative weights:
//   clmaxClean   clean-wing CLmax (1-g stall)
//   dclFlaps     CLmax increment at full trailing-edge flap
//   dclSlats     CLmax increment with slats / Krueger flaps fully out
//   vrK, v2K     Vr and V2 as multiples of the take-off-configuration Vs1g
//   vrefK        Vref (Boeing) / VLS (Airbus) as a multiple of the landing-config Vs1g
//   landFlap     landing flap index counted back from the last detent (0 = full, 1 = one short)
//   law          'airbus' hard alpha / attitude protection; 'boeing-fbw' soft envelope; 'conv' direct
//   ab           autobrake deceleration targets (m/s²) for LO / MED / MAX; RTO = maximum braking
//   spool        engine acceleration time scale (s): idle -> 95 % thrust
//   revK         reverse thrust as a fraction of forward rated thrust at full reverse
//   cd0, e       zero-lift drag and Oswald factor (cruise burn calibration)
//   sfc          thrust-specific fuel consumption scale (1 = default turbofan model)
//
// PERF_REF: published numbers used by tools/fdm-harness.mjs (ranges = typical spread across
// sources / conditions). Sources: Boeing 737/777 FPPM and Airport Planning documents, Airbus
// A320/A380 FCOM & Airport Planning (AC) manuals, ATR 72-600 FCOM/brochure, Cessna 172S POH.

const AB_BOEING = { LO: 1.5, MED: 2.2, MAX: 4.0 }; // ~ autobrake 2 / 3 / MAX (5, 7.2, 13 ft/s²)
const AB_AIRBUS = { LO: 1.7, MED: 3.0, MAX: 4.6 };

const FAMILY = {
  // F-35A: F135 idle -> MIL ~4.5 s; CLmax ~1.6 (alpha limit ~50 deg in the real FCS, lift peaks well before)
  'F-35': { clmaxClean: 1.6, dclFlaps: 0.3, dclSlats: 0.25, law: 'boeing-fbw', ab: null, spool: 4.5, revK: 0, vrK: 1.1, v2K: 1.2, vrefK: 1.25, cd0: 0.022, e: 0.78, sfc: 1.45 },
  // F-22A: F119 spool-up idle -> MIL ~4 s; chined LERX-less blended body, CLmax ~1.7 at ~28 deg alpha (FCS limited)
  'F-22': { clmaxClean: 1.7, dclFlaps: 0.3, dclSlats: 0.25, ab: null, spool: 4, revK: 0, vrK: 1.1, v2K: 1.2, vrefK: 1.25, cd0: 0.019, e: 0.8, sfc: 1.5 },
  // Airbus narrow-bodies: double-slotted / Fowler flaps, full-span slats -> low VLS
  A320: { clmaxClean: 1.5, dclFlaps: 0.88, dclSlats: 0.45, law: 'airbus', ab: AB_AIRBUS, landFlap: 0 },
  A220: { clmaxClean: 1.48, dclFlaps: 0.8, dclSlats: 0.42, law: 'airbus', ab: AB_AIRBUS },
  C919: { clmaxClean: 1.45, dclFlaps: 0.8, dclSlats: 0.42, law: 'airbus', ab: AB_AIRBUS },
  A330: { clmaxClean: 1.45, dclFlaps: 0.65, dclSlats: 0.4, law: 'airbus', ab: AB_AIRBUS, spool: 7.5 },
  A340: { clmaxClean: 1.45, dclFlaps: 0.6, dclSlats: 0.4, law: 'airbus', ab: AB_AIRBUS, spool: 7.5 },
  A350: { clmaxClean: 1.45, dclFlaps: 0.6, dclSlats: 0.4, law: 'airbus', ab: AB_AIRBUS, spool: 7.5 },
  A380: { clmaxClean: 1.45, dclFlaps: 0.53, dclSlats: 0.35, law: 'airbus', ab: AB_AIRBUS, spool: 8, vrK: 1.06, v2K: 1.13, revK: 0.3, revInboardOnly: true, cd0: 0.0148, e: 0.92 },
  A300: { clmaxClean: 1.42, dclFlaps: 0.6, dclSlats: 0.4, law: 'conv', ab: AB_AIRBUS, spool: 7.5 },
  SSJ: { clmaxClean: 1.42, dclFlaps: 0.75, dclSlats: 0.4, law: 'airbus', ab: AB_AIRBUS },
  // Boeing: higher wing loading -> higher Vref
  '737 NG': { clmaxClean: 1.4, dclFlaps: 0.59, dclSlats: 0.4, landFlap: 1, ab: AB_BOEING, spool: 6.5 },
  '737 MAX': { clmaxClean: 1.4, dclFlaps: 0.59, dclSlats: 0.4, landFlap: 1, ab: AB_BOEING, spool: 6.5 },
  757: { clmaxClean: 1.42, dclFlaps: 0.68, dclSlats: 0.42, landFlap: 0, ab: AB_BOEING, spool: 7 },
  717: { clmaxClean: 1.4, dclFlaps: 0.7, dclSlats: 0.4, ab: AB_BOEING },
  767: { clmaxClean: 1.42, dclFlaps: 0.62, dclSlats: 0.4, landFlap: 0, ab: AB_BOEING, spool: 7.5 },
  747: { clmaxClean: 1.42, dclFlaps: 0.55, dclSlats: 0.4, landFlap: 0, ab: AB_BOEING, spool: 8 },
  777: { machLapse: 1.02, clmaxClean: 1.4, dclFlaps: 0.56, dclSlats: 0.4, landFlap: 0, law: 'boeing-fbw', ab: AB_BOEING, spool: 8, vrK: 1.08, v2K: 1.16, revK: 0.22, cd0: 0.0172, e: 0.9 },
  '777X': { clmaxClean: 1.42, dclFlaps: 0.56, dclSlats: 0.4, landFlap: 0, law: 'boeing-fbw', ab: AB_BOEING, spool: 8, vrK: 1.08, v2K: 1.16 },
  787: { clmaxClean: 1.42, dclFlaps: 0.56, dclSlats: 0.4, landFlap: 0, law: 'boeing-fbw', ab: AB_BOEING, spool: 7.5 },
  'MD-11': { clmaxClean: 1.4, dclFlaps: 0.6, dclSlats: 0.4, ab: AB_BOEING, spool: 7.5 },
  // regional jets
  'E-Jet': { clmaxClean: 1.4, dclFlaps: 0.78, dclSlats: 0.4, ab: AB_BOEING },
  'E-Jet E2': { clmaxClean: 1.42, dclFlaps: 0.78, dclSlats: 0.4, ab: AB_BOEING, law: 'boeing-fbw' },
  CRJ: { clmaxClean: 1.4, dclFlaps: 0.48, dclSlats: 0.3, ab: null },
  // turboprops: big Fowler flaps, no slats, no autobrake, beta-range reverse
  ATR: { clmaxClean: 1.65, dclFlaps: 1.07, flapLin: 0.9, flapExp: 0.5, dclSlats: 0, ab: null, spool: 3, revK: 0.32, vrefK: 1.23 },
  'Dash 8': { clmaxClean: 1.6, dclFlaps: 1.2, flapLin: 0.9, dclSlats: 0, ab: null, spool: 3, revK: 0.32 },
  'King Air': { clmaxClean: 1.5, dclFlaps: 0.55, dclSlats: 0, ab: null, spool: 2.5, revK: 0.3, vrefK: 1.3 },
  'PC-12': { clmaxClean: 1.6, dclFlaps: 0.6, dclSlats: 0, ab: null, spool: 2.5, revK: 0.3, vrefK: 1.3 },
  // business jets
  Gulfstream: { clmaxClean: 1.3, dclFlaps: 0.44, dclSlats: 0, ab: null },
  Global: { clmaxClean: 1.35, dclFlaps: 0.5, dclSlats: 0.3, ab: null },
  Citation: { clmaxClean: 1.35, dclFlaps: 0.5, dclSlats: 0, ab: null, spool: 5 },
  // light aircraft (POH numbers)
  'Cessna 172': { clmaxClean: 1.6, dclFlaps: 0.6, dclSlats: 0, ab: null, vrK: 1.06, v2K: 1.42, vrefK: 1.3, spool: 1, cd0: 0.031, e: 0.74 },
  SR22: { clmaxClean: 1.55, dclFlaps: 0.48, dclSlats: 0, ab: null, vrK: 1.08, v2K: 1.4, vrefK: 1.3, spool: 1 },
  Cherokee: { clmaxClean: 1.6, dclFlaps: 0.6, dclSlats: 0, ab: null, vrK: 1.06, v2K: 1.4, vrefK: 1.3, spool: 1 },
};
const CATEGORY = {
  // fighters: low-aspect-ratio wings with leading-edge flaps reach a high CLmax at high alpha; no reversers
  Military: { clmaxClean: 1.6, dclFlaps: 0.3, dclSlats: 0.25, law: 'boeing-fbw', ab: null, spool: 4, revK: 0, vrK: 1.1, v2K: 1.2, vrefK: 1.25, cd0: 0.021, e: 0.78, sfc: 1.5 },
  Supersonic: { clmaxClean: 1.3, dclFlaps: 0, dclSlats: 0, law: 'conv', ab: AB_AIRBUS, spool: 6, revK: 0.2, vrK: 1.1, v2K: 1.18, vrefK: 1.25, cd0: 0.012, e: 0.7, sfc: 1.4 },
  'Narrow-body': { clmaxClean: 1.42, dclFlaps: 0.7, dclSlats: 0.42, ab: AB_BOEING },
  'Wide-body': { clmaxClean: 1.42, dclFlaps: 0.58, dclSlats: 0.4, ab: AB_BOEING, spool: 7.5 },
  Cargo: { clmaxClean: 1.42, dclFlaps: 0.58, dclSlats: 0.4, ab: AB_BOEING, spool: 7.5 },
  'Regional jet': { clmaxClean: 1.4, dclFlaps: 0.7, dclSlats: 0.4, ab: AB_BOEING },
  'Business jet': { clmaxClean: 1.32, dclFlaps: 0.48, dclSlats: 0, ab: null },
  Turboprop: { clmaxClean: 1.6, dclFlaps: 0.95, dclSlats: 0, ab: null, spool: 3, revK: 0.3 },
  // afterburning fighters: thin low-aspect wings (low CL slope, high stall alpha), no reversers, quick spool
  Military: { clmaxClean: 1.3, dclFlaps: 0.3, dclSlats: 0.2, cl0: 0.08, cd0: 0.021, e: 0.8, mcrit: 0.88, cdw: 0.026, ab: null, spool: 4, revK: 0, vrK: 1.12, v2K: 1.22, vrefK: 1.25 },
  'General aviation': { clmaxClean: 1.58, dclFlaps: 0.56, dclSlats: 0, ab: null, vrK: 1.06, v2K: 1.4, vrefK: 1.3, spool: 1 },
};
const BY_ID = {
  'a320neo': { cd0: 0.0205, e: 0.84, sfc: 0.86, spool: 6.5 },
  'a319neo': { sfc: 0.86 }, 'a321neo': { sfc: 0.86, dclFlaps: 0.95 },
  'b737-800': { cd0: 0.0212, e: 0.83, sfc: 1.0 },
  'b737-max8': { sfc: 0.86 }, 'b737-max9': { sfc: 0.86 }, 'b737-max7': { sfc: 0.86 }, 'b737-max10': { sfc: 0.86 },
  'b777-300er': { cd0: 0.0172, e: 0.9, sfc: 0.9 },
  'a380-800': { sfc: 0.86 },
  'atr72-600': { cd0: 0.027, e: 0.82 },
  f15c: { cd0: 0.02, cdw: 0.02 },
  // F-22: very low supersonic wave drag (supercruise ~M1.5 on dry thrust)
  f22a: { cdw: 0.014, mcrit: 0.92 },
};
const DEFAULTS = { vrK: 1.06, v2K: 1.13, vrefK: 1.23, landFlap: 0, law: 'conv', ab: null, spool: 7, revK: 0.35, sfc: 1 };

export function aeroTune(ac) {
  const fam = FAMILY[ac.family] || {};
  const cat = CATEGORY[ac.category] || {};
  const t = { ...DEFAULTS, ...cat, ...fam, ...(BY_ID[ac.id] || {}) };
  if (ac.fbw && t.law === 'conv') t.law = 'airbus';
  return t;
}

// Published / typical figures (SL, ISA, dry runway, no wind) for the harness.
export const PERF_REF = {
  'b737-800': {
    toMass: 70000, toFlap: 3, toPitch: 15, vr: 147, v2: 153, vlof: [150, 158], toRoll: [1400, 1750], to35: [1650, 2050], climb: [2600, 3800],
    ldgMass: 62000, ldgFlapFromFull: 1, vref: 142, ldgRoll: [550, 850], ldgDist: [950, 1200], ab: { LO: [1300, 1700], MED: [900, 1200], MAX: [600, 850] },
    crzMass: 65000, crzAlt: 35000, burn: [2300, 2650], crzN1: [86, 90], spool: [5.5, 8], idleN1: [19, 22], vs1: [140, 155],
  },
  'a320neo': {
    toMass: 70000, toFlap: 2, toPitch: 15, vr: 143, v2: 147, vlof: [146, 154], toRoll: [1250, 1600], to35: [1450, 1850], climb: [2600, 3800],
    ldgMass: 62000, ldgFlapFromFull: 0, vref: 128, ldgRoll: [480, 750], ldgDist: [850, 1120], ab: { LO: [1100, 1450], MED: [700, 950], MAX: [500, 750] },
    crzMass: 64000, crzAlt: 35000, burn: [1950, 2300], crzN1: [84, 89], spool: [5.5, 8], idleN1: [19, 22], vs1: [135, 150],
  },
  'b777-300er': {
    toMass: 300000, toFlap: 3, toPitch: 13, vr: [152, 165], v2: [160, 172], vlof: [158, 172], toRoll: [1650, 2150], to35: [1950, 2500], climb: [2000, 3200],
    ldgMass: 240000, ldgFlapFromFull: 0, vref: 146, ldgRoll: [700, 1000], ldgDist: [1150, 1450], ab: { LO: [1500, 1950], MED: [1050, 1400], MAX: [750, 1050] },
    crzMass: 280000, crzAlt: 35000, burn: [6800, 8200], crzN1: [88, 93], spool: [6, 9], idleN1: [19, 23], vs1: [145, 160],
  },
  'a380-800': {
    toMass: 500000, toFlap: 3, toPitch: 13, vr: [143, 158], v2: [150, 165], vlof: [148, 165], toRoll: [1650, 2200], to35: [1900, 2500], climb: [1800, 2900],
    ldgMass: 380000, ldgFlapFromFull: 0, vref: 133, ldgRoll: [750, 1100], ldgDist: [1100, 1450], ab: { LO: [1250, 1650], MED: [800, 1100], MAX: [650, 950] },
    crzMass: 450000, crzAlt: 35000, burn: [11000, 13500], crzN1: [86, 92], spool: [6, 9], idleN1: [19, 23], vs1: [130, 150],
  },
  'atr72-600': {
    toMass: 22000, toFlap: 1, toPitch: 10, vr: 107, v2: 113, vlof: [108, 116], toRoll: [700, 950], to35: [850, 1150], climb: [1200, 1900],
    ldgMass: 20000, ldgFlapFromFull: 0, vref: [100, 110], ldgRoll: [280, 450], ldgDist: [480, 680],
    crzMass: 21000, crzAlt: 17000, burn: [650, 850], crzN1: null, spool: [2, 5], idleN1: null, vs1: [102, 115],
  },
  c172: {
    toMass: 1157, toFlap: 0, toPitch: 11, vr: 55, v2: [70, 76], vlof: [54, 60], toRoll: [260, 330], to35: [400, 500], climb: [650, 800],
    ldgMass: 1100, ldgFlapFromFull: 0, vref: [56, 65], ldgRoll: [150, 200], ldgDist: [360, 450],
    crzMass: 1100, crzAlt: 8000, burn: [21, 26], crzN1: null, spool: [0.3, 2], idleN1: null, vs1: [48, 54],
  },
};
