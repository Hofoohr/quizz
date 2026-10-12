// Carte du monde de Dofus (Leaflet + tuiles de img/monde) pour les questions « classement » : le joueur y place son repère,
// la correction y montre les repères de tous les joueurs et la bonne carte. Même repère que js/geo.js (le jeu GeoGuessr).
import { MAPS } from "./geo-maps.js";

const ORIG_X = 6480, ORIG_Y = 4944, MW = 69.5, MH = 49.7, IMG_W = 10000, IMG_H = 8000, ZN = 4;
const minX = Math.min(...MAPS.map(m => m[0])), maxX = Math.max(...MAPS.map(m => m[0]));
const minY = Math.min(...MAPS.map(m => m[1])), maxY = Math.max(...MAPS.map(m => m[1]));
const EXISTE = new Set(MAPS.map(m => m[0] + ',' + m[1]));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Crée la carte dans l'élément « el ». surClic(x, y) est appelé quand le joueur clique ; surSurvol(x, y) quand la souris bouge.
export function creerMonde(el, { surClic, surSurvol } = {}) {
  const L = window.L;
  const map = L.map(el, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 2, zoomSnap: 0.25, attributionControl: false });
  const toLL = (x, y) => map.unproject([ORIG_X + (x + .5) * MW, ORIG_Y + (y + .5) * MH], 0);
  const toCell = ll => { const p = map.project(ll, 0); return { x: Math.floor((p.x - ORIG_X) / MW), y: Math.floor((p.y - ORIG_Y) / MH) }; };
  const full = L.latLngBounds(map.unproject([0, 0], 0), map.unproject([IMG_W, IMG_H], 0));
  const jouable = L.latLngBounds(toLL(minX - 1, minY - 1), toLL(maxX + 1, maxY + 1));
  L.tileLayer('img/monde/{z}/{x}/{y}.webp', { minZoom: -5, minNativeZoom: -ZN, maxNativeZoom: 0, zoomOffset: ZN, tileSize: 256, noWrap: true, bounds: full }).addTo(map);
  map.setMaxBounds(full.pad(0.05));
  map.fitBounds(jouable);
  // Repères tous les 10 cartes, pour s'orienter.
  const grille = L.layerGroup().addTo(map), style = { color: '#142', weight: 1, opacity: .35, interactive: false };
  for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) grille.addLayer(L.polyline([toLL(x - .5, minY - .5), toLL(x - .5, maxY + .5)], x === 0 ? { ...style, opacity: .8 } : style));
  for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) grille.addLayer(L.polyline([toLL(minX - .5, y - .5), toLL(maxX + .5, y - .5)], y === 0 ? { ...style, opacity: .8 } : style));
  const calque = L.layerGroup().addTo(map);
  const borne = (v, a, b) => Math.max(a, Math.min(b, v));
  map.on('click', e => { const c = toCell(e.latlng); if (surClic) surClic(borne(c.x, minX, maxX), borne(c.y, minY, maxY)); });
  map.on('mousemove', e => { const c = toCell(e.latlng); if (surSurvol) surSurvol(c.x, c.y); });
  const pin = (x, y, cls, label) => L.marker(toLL(x, y), { interactive: false, keyboard: false, icon: L.divIcon({
    className: 'pinwrap', iconSize: [0, 0],
    html: `<div class="pin ${cls}" title="${esc(label)}"><span>${esc([...label].slice(0, 2).join(''))}</span></div>` }) });
  return {
    // pins : [{x, y, cls ('me' | 'other' | 'target'), label}] ; cible : {x, y} relié par un trait pointillé à chaque pin « me » / « other ».
    afficher(pins, cible) {
      calque.clearLayers();
      if (cible) pins.forEach(p => { if (p.cls !== 'target') calque.addLayer(L.polyline([toLL(p.x, p.y), toLL(cible.x, cible.y)],
        { color: p.cls === 'me' ? '#7c5cff' : '#fff', weight: 2, dashArray: '6 5', opacity: .9, interactive: false })); });
      pins.forEach(p => calque.addLayer(pin(p.x, p.y, p.cls, p.label)));
    },
    cadrer(points) {
      map.invalidateSize();
      if (!points.length) return map.fitBounds(jouable);
      map.fitBounds(L.latLngBounds(points.map(p => toLL(p.x, p.y))), { padding: [50, 50], maxZoom: 1 });
    },
    centrer(x, y) { map.panTo(toLL(x, y)); },
    invalider() { map.invalidateSize(); },
  };
}
export const carteExiste = (x, y) => EXISTE.has(x + ',' + y);
