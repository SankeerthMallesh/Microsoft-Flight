// Builds (and caches) a GLB for an aircraft type + livery.
import { buildAircraft } from './builder.js';
import { paintLivery } from './painter.js';
import { writeGLB } from './glb.js';
import { getAircraft } from '../data/aircraft.js';
import { getLivery } from '../data/liveries.js';

const geoCache = new Map();
const glbCache = new Map();

export function getGeometry(acId) {
  if (!geoCache.has(acId)) geoCache.set(acId, buildAircraft(getAircraft(acId)));
  return geoCache.get(acId);
}

export async function getAircraftGLB(acId, liveryId) {
  const key = acId + '|' + liveryId;
  if (glbCache.has(key)) return glbCache.get(key);
  const geo = getGeometry(acId);
  const livery = getLivery(liveryId);
  const { bytes } = await paintLivery(geo.layout, livery);
  const glb = writeGLB(geo.nodes, bytes, { metallic: livery.metallic ?? 0.12, roughness: livery.roughness ?? 0.38 });
  const out = { glb, layout: geo.layout, physics: geo.physics };
  glbCache.set(key, out);
  if (glbCache.size > 12) glbCache.delete(glbCache.keys().next().value);
  return out;
}
