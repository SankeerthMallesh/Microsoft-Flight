// Cloudflare Pages Function: same-origin relay for the open ADS-B feeds used by live air traffic
// (their APIs don't send CORS headers, so browsers can't call them directly).
// Only these hosts are allowed, so this can't be used as a general open proxy.
const ALLOWED = new Set(['api.adsb.lol', 'opendata.adsb.fi', 'api.airplanes.live', 'opensky-network.org']);

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  let u;
  try { u = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
  if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname)) return new Response('host not allowed', { status: 403 });
  const cache = caches.default;
  const key = new Request(u.toString(), { method: 'GET' });
  let res = await cache.match(key);
  if (!res) {
    let up;
    try { up = await fetch(u.toString(), { headers: { 'User-Agent': 'OpenSkies-FlightSim/1.0 (live traffic relay)', Accept: 'application/json' }, cf: { cacheTtl: 8 } }); }
    catch (e) { return new Response('upstream unavailable', { status: 502 }); }
    res = new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=8' } });
    if (up.ok) await cache.put(key, res.clone());
  }
  return res;
}
