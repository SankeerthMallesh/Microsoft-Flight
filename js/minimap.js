// Moving map (Leaflet): aircraft, trail, route to destination, clickable airports ("Fly here").
/* global L */
import { searchAirports } from './data/airports.js';

const R2D = 180 / Math.PI;

export class MiniMap {
  constructor(el, { airports, onSetDest }) {
    this.el = el; this.airports = airports; this.onSetDest = onSetDest;
    this.follow = true; this.expanded = false;
    if (!window.L) { el.innerHTML = '<div class="map-off">Map unavailable (offline)</div>'; return; }
    const map = L.map(el.querySelector('.map-canvas'), { zoomControl: false, attributionControl: true, worldCopyJump: true, preferCanvas: true }).setView([0, 0], 9);
    // free, no-key tile services (Esri satellite by default; street map and OpenStreetMap selectable)
    const street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri', updateInterval: 300, keepBuffer: 1 });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics', updateInterval: 300, keepBuffer: 1 });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors', updateInterval: 300, keepBuffer: 1 });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.9, updateInterval: 300, keepBuffer: 1 });
    sat.addTo(map); labels.addTo(map);
    L.control.layers({ Satellite: sat, Map: street, OpenStreetMap: osm }, { Labels: labels }, { position: 'bottomright', collapsed: true }).addTo(map);
    this.map = map;
    this.planeIcon = L.divIcon({ className: 'plane-icon', html: '<svg viewBox="0 0 40 40" width="34" height="34"><path d="M20 2 L23 15 L37 22 L37 25 L23 21 L22 31 L27 35 L27 37 L20 35 L13 37 L13 35 L18 31 L17 21 L3 25 L3 22 L17 15 Z" fill="#ffcc00" stroke="#222" stroke-width="1.4"/></svg>', iconSize: [34, 34], iconAnchor: [17, 17] });
    this.plane = L.marker([0, 0], { icon: this.planeIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    this.trail = L.polyline([], { color: '#ffcc00', weight: 2, opacity: 0.7 }).addTo(map);
    this.route = L.polyline([], { color: '#ff3df5', weight: 3, dashArray: '8 6' }).addTo(map);
    this.apLayer = L.layerGroup().addTo(map);
    map.on('dragstart', () => { this.follow = false; el.classList.add('free'); });
    map.on('zoomend', () => this.drawAirports());
    map.on('moveend', () => this.scheduleAirports());
    el.querySelector('.map-recenter').onclick = (e) => { e.stopPropagation(); this.follow = true; el.classList.remove('free'); };
    el.querySelector('.map-expand').onclick = (e) => { e.stopPropagation(); this.setExpanded(!this.expanded); };
    el.querySelector('.map-zin').onclick = (e) => { e.stopPropagation(); map.zoomIn(); };
    el.querySelector('.map-zout').onclick = (e) => { e.stopPropagation(); map.zoomOut(); };
    // "Direct to" search
    const inp = el.querySelector('.map-search input'), list = el.querySelector('.map-search ul');
    inp.addEventListener('input', () => {
      const res = searchAirports(inp.value, 8);
      list.innerHTML = res.map((a, i) => `<li data-i="${i}"><b>${a.i}</b> ${a.n} <small>${a.c}</small></li>`).join('');
      list.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', (ev) => { ev.preventDefault(); const a = res[+li.dataset.i]; inp.value = ''; list.innerHTML = ''; this.onSetDest(a); this.map.setView([a.la, a.lo], 10); this.follow = false; el.classList.add('free'); }));
    });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
  }
  setExpanded(on) {
    this.expanded = on; this.el.classList.toggle('expanded', on);
    setTimeout(() => this.map && this.map.invalidateSize(), 220);
  }
  // while the map follows the aircraft it pans constantly; rebuilding every marker on each pan is wasted main-thread work
  scheduleAirports() {
    if (this._apTimer) return;
    this._apTimer = setTimeout(() => { this._apTimer = null; this.drawAirports(); }, this.follow ? 1500 : 120);
  }
  drawAirports() {
    if (!this.map) return;
    const b = this.map.getBounds(), z = this.map.getZoom();
    this.apLayer.clearLayers();
    let n = 0;
    for (const a of this.airports()) {
      if (!a.L && z < 8) continue;
      if (!b.contains([a.la, a.lo])) continue;
      if (++n > 250) break;
      const isDest = this.dest && this.dest.i === a.i;
      const m = L.circleMarker([a.la, a.lo], { radius: a.L ? 6 : 4, color: isDest ? '#ff3df5' : a.L ? '#1d6fd1' : '#5b7083', weight: 2, fillColor: '#fff', fillOpacity: 0.9 });
      m.bindTooltip(`${a.i}${a.a ? ' / ' + a.a : ''}`, { direction: 'top', offset: [0, -6] });
      m.on('click', () => {
        const runways = a.r.flatMap((r) => [r[0], r[4]]);
        const html = `<div class="ap-pop"><b>${a.i}</b> ${a.n}<br><small>${a.c}, ${a.k} · elev ${a.e} ft</small>
          <div class="row"><select>${['auto', ...runways].map((r) => `<option value="${r}">${r === 'auto' ? 'Best runway for wind' : 'RWY ' + r}</option>`).join('')}</select>
          <button class="btn primary small">Fly here</button></div></div>`;
        const pop = L.popup().setLatLng([a.la, a.lo]).setContent(html).openOn(this.map);
        const elp = pop.getElement();
        elp.querySelector('button').onclick = () => { const v = elp.querySelector('select').value; this.onSetDest(a, v === 'auto' ? null : v); this.map.closePopup(); };
      });
      m.addTo(this.apLayer);
    }
  }
  update(fm, routePts) {
    if (!this.map) return;
    const lat = fm.lat * R2D, lon = fm.lon * R2D;
    this.plane.setLatLng([lat, lon]);
    const ic = this.plane.getElement(); if (ic) ic.firstChild.style.transform = `rotate(${fm.out.hdg}deg)`;
    const tr = this.trail.getLatLngs();
    const last = tr[tr.length - 1];
    if (!last || Math.abs(last.lat - lat) + Math.abs(last.lng - lon) > 0.004) { tr.push([lat, lon]); if (tr.length > 1500) tr.shift(); this.trail.setLatLngs(tr); }
    this.route.setLatLngs(routePts ? [[lat, lon], ...routePts] : []);
    if (this.follow) this.map.panTo([lat, lon], { animate: false });
  }
  reset(fm, zoom = 10) {
    if (!this.map) return;
    this.trail.setLatLngs([]); this.follow = true; this.el.classList.remove('free');
    this.map.setView([fm.lat * R2D, fm.lon * R2D], zoom);
    setTimeout(() => this.map.invalidateSize(), 100);
  }
  setDest(a) { this.dest = a; this.drawAirports(); }
  // live / AI traffic layer: small rotated aircraft symbols with callsign + altitude tooltips
  setTraffic(list) {
    if (!this.map) return;
    if (!this.trafficLayer) { this.trafficLayer = L.layerGroup().addTo(this.map); this.trafficM = new Map(); }
    const seen = new Set();
    for (const t of list || []) {
      seen.add(t.id);
      let m = this.trafficM.get(t.id);
      const ll = [t.lat * R2D, t.lon * R2D];
      if (!m) {
        const icon = L.divIcon({ className: 'traffic-icon', html: `<svg viewBox="0 0 40 40" width="20" height="20"><path d="M20 3 L22.5 15 L35 21 L35 24 L22.5 20.5 L21.6 30 L26 33.5 L26 35.5 L20 34 L14 35.5 L14 33.5 L18.4 30 L17.5 20.5 L5 24 L5 21 L17.5 15 Z" fill="${t.ai ? '#9fd4ff' : '#4dfcff'}" stroke="#08202a" stroke-width="1.6"/></svg>`, iconSize: [20, 20], iconAnchor: [10, 10] });
        m = L.marker(ll, { icon, interactive: true, keyboard: false, zIndexOffset: 500 }).addTo(this.trafficLayer);
        m.bindTooltip('', { direction: 'top', offset: [0, -8] });
        this.trafficM.set(t.id, m);
      } else m.setLatLng(ll);
      const el = m.getElement(); if (el && el.firstChild) el.firstChild.style.transform = `rotate(${Math.round(t.hdg)}deg)`;
      const tip = `${t.cs} · ${t.type}<br>${t.ground ? 'on ground' : Math.round(t.altFt / 100) * 100 + ' ft'} · ${Math.round(t.gsKt)} kt${t.ai ? ' · AI' : ''}`;
      if (m._tipTxt !== tip) { m._tipTxt = tip; m.setTooltipContent(tip); }
    }
    for (const [id, m] of this.trafficM) if (!seen.has(id)) { this.trafficLayer.removeLayer(m); this.trafficM.delete(id); }
  }
}

// great-circle intermediate points (degrees) for drawing long routes
export function gcPoints(lat1, lon1, lat2, lon2, n = 64) {
  const toR = Math.PI / 180;
  const p1 = [lat1 * toR, lon1 * toR], p2 = [lat2 * toR, lon2 * toR];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2[0] - p1[0]) / 2) ** 2 + Math.cos(p1[0]) * Math.cos(p2[0]) * Math.sin((p2[1] - p1[1]) / 2) ** 2));
  if (d < 1e-6) return [[lat2, lon2]];
  const out = [];
  for (let i = 1; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
    const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
    const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
    out.push([Math.atan2(z, Math.hypot(x, y)) * R2D, Math.atan2(y, x) * R2D]);
  }
  return out;
}
