// Builds (and caches) a GLB for an aircraft type + livery.
import { buildAircraft } from './builder.js';
import { paintLivery } from './painter.js';
import { writeGLB, patchDetailedGLB } from './glb.js';
import { getAircraft } from '../data/aircraft.js';
import { getLivery } from '../data/liveries.js';
import { addFlames } from './afterburner.js';

const geoCache = new Map();
const glbCache = new Map();

export function getGeometry(acId) {
  if (!geoCache.has(acId)) geoCache.set(acId, buildAircraft(getAircraft(acId)));
  return geoCache.get(acId);
}

const rawCache = new Map();
export const modelPrefs = { detailed: true };
async function loadDetailed(ac) {
  if (!rawCache.has(ac.id)) {
    rawCache.set(ac.id, (async () => {
      const base = new URL('../../', import.meta.url);
      const [g, m] = await Promise.all([fetch(new URL(ac.detailed.glb, base)), fetch(new URL(ac.detailed.meta, base))]);
      if (!g.ok || !m.ok) throw new Error('detailed model missing');
      return { glb: new Uint8Array(await g.arrayBuffer()), meta: await m.json() };
    })());
  }
  return rawCache.get(ac.id);
}
// physics tuned to the detailed model's real wheel positions
function detailedPhysics(phys, meta) {
  const c = meta.contacts; if (!c || !c.gearN || !c.gearL) return { ...phys, detailed: true, procGear: true };
  const p = JSON.parse(JSON.stringify(phys));
  const gz = Math.min(c.gearN[2], c.gearL[2], (c.gearR || c.gearL)[2]);
  const mx = (c.gearL[0] + (c.gearR || c.gearL)[0]) / 2, my = (Math.abs(c.gearL[1]) + Math.abs((c.gearR || c.gearL)[1])) / 2;
  p.gear = [
    { ...p.gear[0], x: c.gearN[0], y: 0, z: gz }, { ...p.gear[1], x: mx, y: my, z: gz }, { ...p.gear[2], x: mx, y: -my, z: gz },
  ];
  p.groundZ = gz;
  const tail = p.strikes.find((s) => s.kind === 'tail');
  if (tail && p.tailAngle) tail.z = gz + Math.tan(p.tailAngle * Math.PI / 180) * (mx - tail.x);
  p.anim = { surfaces: [], gear: ['gearN', 'gearL', 'gearR'].filter((k) => c[k]).map((k) => ({ node: k, kind: 'hide', pivot: c[k] })) };
  p.detailed = true;
  return p;
}

export async function getAircraftGLB(acId, liveryId) {
  const ac0 = getAircraft(acId);
  const useDetailed = !!(ac0.detailed && modelPrefs.detailed);
  const key = acId + '|' + liveryId + (useDetailed ? '|d' : '');
  if (glbCache.has(key)) return glbCache.get(key);
  const geo = getGeometry(acId);
  const livery = getLivery(liveryId);
  let out;
  if (useDetailed) {
    try {
      const raw = await loadDetailed(ac0);
      const { bytes } = await paintLivery(geo.layout, livery, { detailed: true });
      const physics = detailedPhysics(geo.physics, raw.meta);
      const gearNodes = physics.procGear ? geo.nodes.filter((n) => /^gear/.test(n.name)) : [];
      const glb = patchDetailedGLB(raw.glb, bytes, { engine: livery.engine || '#d9dce0', wing: livery.wing || '#c3c8cf' }, gearNodes);
      out = { glb, layout: geo.layout, physics, detailed: true, credit: ac0.detailed.credit };
    } catch (e) { console.warn('Detailed model unavailable, using procedural model:', e); }
  }
  if (!out) {
    const { bytes } = await paintLivery(geo.layout, livery);
    const glb = writeGLB(geo.nodes, bytes, { metallic: livery.metallic ?? 0.12, roughness: livery.roughness ?? 0.38 });
    out = { glb, layout: geo.layout, physics: geo.physics };
  }
  if (ac0.afterburner) out.glb = addFlames(out.glb, ac0.afterburner.nozzles);
  glbCache.set(key, out);
  if (glbCache.size > 12) glbCache.delete(glbCache.keys().next().value);
  return out;
}
