// GeoGuessr Dofus : on atterrit sur une carte, on explore les cartes voisines, puis on devine les coordonnées de la carte de DÉPART.
// Le premier guess lance un compte à rebours pour les autres joueurs. Tout est déduit de l'heure du serveur et des guess enregistrés :
// aucun joueur n'a besoin d'écrire l'avancement de la partie (seuls les guess et la fin de partie sont écrits).
import { db, ref, get, set, update, onValue, serverNow, serverTimestamp, clockReady } from "./firebase.js";
import { MAPS } from "./geo-maps.js";

const COUNTDOWN_MS = 5000;   // compte à rebours avant la première manche
const REVEAL_MS = 15000;     // temps d'affichage de la solution après chaque manche
const END_GRACE_MS = 1500;   // délai avant la fin de partie (laisse arriver les dernières écritures)
const MAX_POINTS = 1000;
const POINTS_SCALE = 15;     // 1000 pts sur la bonne carte, ~370 pts à 15 cartes de distance
const WATERMARK = 0.075;     // part basse de l'image rognée (filigrane « DofusDB »)
const IMG_RATIO = 955 / 485;
const img = id => `https://api.dofusdb.fr/img/maps/0.5/${id}.jpg`;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const toList = v => !v ? [] : Array.isArray(v) ? v : Object.values(v);
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',');

// --- Cartes du monde : une carte par coordonnée ---
const BY = new Map(MAPS.map(m => [m[0] + ',' + m[1], { x: m[0], y: m[1], id: m[2], sub: m[3] }]));
const minX = Math.min(...MAPS.map(m => m[0])), maxX = Math.max(...MAPS.map(m => m[0]));
const minY = Math.min(...MAPS.map(m => m[1])), maxY = Math.max(...MAPS.map(m => m[1]));
const W = maxX - minX + 1, H = maxY - minY + 1;
const at_ = (x, y) => BY.get(x + ',' + y);
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };   // x vers l'est, y vers le sud (comme dans Dofus)

// Tire les cartes de départ (au moins 2 voisines, pour pouvoir explorer) : liste de « x,y ».
export function pickRounds(n) {
  const ok = MAPS.filter(m => Object.values(DIRS).filter(([dx, dy]) => at_(m[0] + dx, m[1] + dy)).length >= 2);
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
  return ok.slice(0, n).map(m => m[0] + ',' + m[1]);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const score = (g, t) => g ? Math.round(MAX_POINTS * Math.exp(-dist(g, t) / POINTS_SCALE)) : 0;

// --- État ---
let running = false, ctx = null, cfg = null, players = {}, guesses = {};
let ready = { p: false, g: false }, offs = [], timer = null, finishing = false;
let st = { i: -1, mode: 'count' };
let nav = { i: -1, x: 0, y: 0, tab: 'explore', pin: null, autoFor: -1, revealFor: -1, revealImg: -1, fit: true, drawn: '' };

const path = p => ref(db, `rooms/${ctx.code}/${p}`);
const target = i => cfg.rounds[i];
const myGuess = i => (guesses[i] || {})[ctx && ctx.uid] || null;

function view(name) { ['wait', 'live'].forEach(v => { $('g-' + v).hidden = v !== name; }); }

// --- Calendrier déduit des guess ---
// Une manche dure jusqu'à : (1er guess + délai), ou la durée max, ou le moment où tout le monde a deviné.
function compute(now) {
  const ids = Object.keys(players);
  let t = ctx.startAt + COUNTDOWN_MS, last = null;
  for (let i = 0; i < cfg.rounds.length; i++) {
    const g = guesses[i] || {};
    const ats = Object.values(g).map(v => v.at).filter(Number.isFinite);
    const first = ats.length ? Math.min(...ats) : null;
    const start = t;
    let end = start + cfg.max * 1000;
    if (first !== null) end = Math.min(end, first + cfg.grace * 1000);
    if (ids.length && ats.length && ids.every(id => g[id])) end = Math.min(end, Math.max(...ats));
    end = Math.max(end, start);
    last = { i, start, end, first, revealEnd: end + REVEAL_MS };
    if (now < start) return { ...last, mode: 'count' };
    if (now < end) return { ...last, mode: 'guess' };
    if (now < last.revealEnd) return { ...last, mode: 'reveal' };
    t = last.revealEnd;
  }
  return { ...last, mode: 'over' };
}

function totals(upTo) {
  const t = {};
  Object.keys(players).forEach(id => { t[id] = 0; });
  for (let i = 0; i <= upTo && i < cfg.rounds.length; i++) {
    Object.keys(players).forEach(id => { t[id] += score((guesses[i] || {})[id], target(i)); });
  }
  return t;
}

// --- Carte du monde (Leaflet + tuiles générées par tools/geo_tuiles_dofus.py) ---
const PXMAP = 64, ZMAX = 4;   // une carte = 64 px au zoom maximal des tuiles
let map = null, layer = null, bounds = null;
const toLL = (x, y) => map.unproject([(x - minX + .5) * PXMAP, (y - minY + .5) * PXMAP], ZMAX);
const toCell = ll => { const p = map.project(ll, ZMAX); return { x: Math.floor(p.x / PXMAP) + minX, y: Math.floor(p.y / PXMAP) + minY }; };

function ensureMap() {
  if (map) { map.invalidateSize(); if (nav.fit) { nav.fit = false; map.fitBounds(bounds); } return; }
  const L = window.L;
  map = L.map('g-map', { crs: L.CRS.Simple, minZoom: -1.5, maxZoom: 5, zoomSnap: 0.25, attributionControl: false });
  bounds = L.latLngBounds(map.unproject([0, 0], ZMAX), map.unproject([W * PXMAP, H * PXMAP], ZMAX));
  L.tileLayer('img/monde/{z}/{x}/{y}.webp', { minZoom: -3, minNativeZoom: 0, maxNativeZoom: ZMAX, tileSize: 256, noWrap: true, bounds }).addTo(map);
  map.setMaxBounds(bounds.pad(0.15));
  map.fitBounds(bounds);
  nav.fit = false;
  // Quadrillage : contour de chaque carte (dès qu'on zoome un peu) avec ses coordonnées (quand elle est assez grande).
  const Grid = L.GridLayer.extend({
    createTile(coords) {
      const dpr = window.devicePixelRatio || 1, size = this.getTileSize().x, c = document.createElement('canvas');
      c.width = c.height = size * dpr;
      const g = c.getContext('2d'), cell = PXMAP * Math.pow(2, coords.z - ZMAX);   // taille d'une carte, en px d'écran
      if (cell < 10) return c;
      g.scale(dpr, dpr);
      g.lineWidth = 1; g.font = '11px system-ui,sans-serif'; g.textBaseline = 'top';
      const ox = coords.x * size, oy = coords.y * size;
      for (let i = Math.floor(ox / cell); i * cell < ox + size; i++) {
        for (let j = Math.floor(oy / cell); j * cell < oy + size; j++) {
          const x = i + minX, y = j + minY;
          if (!BY.has(x + ',' + y)) continue;
          const px = i * cell - ox, py = j * cell - oy;
          const major = x % 10 === 0 || y % 10 === 0;
          g.strokeStyle = major ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)';
          g.strokeRect(px + .5, py + .5, cell, cell);
          if (cell >= 56) {
            g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 3;
            g.fillText(x + ',' + y, px + 4, py + 4); g.shadowBlur = 0;
          }
        }
      }
      return c;
    }
  });
  new Grid({ tileSize: 256, minZoom: 1.5, maxZoom: 5, bounds, zIndex: 5 }).addTo(map);
  // Repères tous les 10 : visibles même en vue d'ensemble.
  const grid = L.layerGroup().addTo(map), style = { color: '#fff', weight: 1, opacity: .25, interactive: false };
  for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) grid.addLayer(L.polyline([toLL(x, minY - .5), toLL(x, maxY + .5)], x === 0 ? { ...style, opacity: .6 } : style));
  for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) grid.addLayer(L.polyline([toLL(minX - .5, y), toLL(maxX + .5, y)], y === 0 ? { ...style, opacity: .6 } : style));
    layer = L.layerGroup().addTo(map);
  map.on('click', e => {
    if (!running || st.mode !== 'guess' || myGuess(st.i)) return;
    const c = toCell(e.latlng);
    setPin(c.x, c.y);
  });
  map.on('mousemove', e => { const c = toCell(e.latlng); $('g-hover').textContent = `x ${c.x}, y ${c.y}`; });
}

function pin(x, y, cls, label) {
  const L = window.L;
  return L.marker(toLL(x, y), { interactive: false, keyboard: false, icon: L.divIcon({
    className: 'pinwrap', iconSize: [0, 0],
    html: `<div class="pin ${cls}" title="${esc(label)}"><span>${esc([...label].slice(0, 2).join(''))}</span></div>` }) });
}

function renderWorld(reveal) {
  if (!map) return;
  const L = window.L, t = target(st.i);
  const g = guesses[st.i] || {};
  const m = myGuess(st.i) || nav.pin;
  const key = st.i + '|' + reveal + '|' + (reveal ? JSON.stringify(g) + Object.keys(players) : JSON.stringify(m));
  if (key === nav.drawn) return;
  nav.drawn = key;
  layer.clearLayers();
  if (reveal) {
    Object.keys(g).forEach(id => {
      if (!players[id]) return;
      layer.addLayer(L.polyline([toLL(g[id].x, g[id].y), toLL(t.x, t.y)], { color: id === ctx.uid ? '#7c5cff' : '#fff', weight: 2, dashArray: '6 5', opacity: .9, interactive: false }));
      layer.addLayer(pin(g[id].x, g[id].y, id === ctx.uid ? 'me' : 'other', players[id].name));
    });
    layer.addLayer(pin(t.x, t.y, 'target', '🎯'));
  } else if (m) layer.addLayer(pin(m.x, m.y, 'me', '📍'));
}

// En fin de manche : on cadre la solution et les guess.
function focusReveal() {
  if (!map || nav.revealFor === st.i) return;
  nav.revealFor = st.i;
  map.invalidateSize();
  const pts = [target(st.i), ...Object.values(guesses[st.i] || {})].map(p => toLL(p.x, p.y));
  map.fitBounds(window.L.latLngBounds(pts), { padding: [50, 50], maxZoom: 3.5 });
}

// --- Exploration ---
function showImage() {
  const m = at_(nav.x, nav.y), im = $('g-img');
  $('g-noimg').hidden = true; im.hidden = false;
  im.src = img(m.id);
  Object.entries(DIRS).forEach(([d, [dx, dy]]) => {   // précharge les cartes voisines
    const n = at_(nav.x + dx, nav.y + dy);
    $('g-nav-' + d).disabled = !n;
    if (n) new Image().src = img(n.id);
  });
  const dx = nav.x - target(st.i).x, dy = nav.y - target(st.i).y;
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx)} ${dx > 0 ? '→ vers l\'est' : '← vers l\'ouest'}`);
  if (dy) parts.push(`${Math.abs(dy)} ${dy > 0 ? '↓ vers le sud' : '↑ vers le nord'}`);
  $('g-offset').textContent = parts.length ? 'Depuis le départ : ' + parts.join(', ') : 'Tu es sur la carte de départ';
  $('g-home').disabled = !parts.length;
}
$('g-img').onerror = () => { $('g-img').hidden = true; $('g-noimg').hidden = false; };

function move(dx, dy) {
  if (!running || st.mode !== 'guess' || nav.tab !== 'explore') return;
  if (!at_(nav.x + dx, nav.y + dy)) return;
  nav.x += dx; nav.y += dy;
  showImage();
}
Object.keys(DIRS).forEach(d => { $('g-nav-' + d).onclick = () => move(...DIRS[d]); });
$('g-home').onclick = () => { if (st.mode !== 'guess') return; nav.x = target(st.i).x; nav.y = target(st.i).y; showImage(); };
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const d = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e' }[e.key];
  if (d) { e.preventDefault(); move(...DIRS[d]); }
});

function setTab(tab) { nav.tab = tab; nav.drawn = ''; layout(); }
$('g-tab-explore').onclick = () => setTab('explore');
$('g-tab-guess').onclick = () => setTab('guess');

// --- Guess ---
function setPin(x, y) {
  x = Math.max(minX, Math.min(maxX, Math.round(x))); y = Math.max(minY, Math.min(maxY, Math.round(y)));
  nav.pin = { x, y };
  $('g-x').value = x; $('g-y').value = y;
  $('g-submit').disabled = false;
  renderWorld(false);
}
['g-x', 'g-y'].forEach(id => {
  $(id).oninput = () => {
    const x = parseInt($('g-x').value, 10), y = parseInt($('g-y').value, 10);
    if (Number.isFinite(x) && Number.isFinite(y)) { setPin(x, y); if (map) map.panTo(toLL(nav.pin.x, nav.pin.y)); }
  };
});

function submit() {
  const i = st.i;
  if (!nav.pin || myGuess(i) || st.mode !== 'guess') return;
  const g = { x: nav.pin.x, y: nav.pin.y };
  (guesses[i] = guesses[i] || {})[ctx.uid] = { ...g, at: serverNow() };   // affichage immédiat, avant l'écho de la base
  set(path(`guesses/${i}/${ctx.uid}`), { ...g, at: serverTimestamp() }).catch(e => {
    console.error(e);
    if (guesses[i]) delete guesses[i][ctx.uid];
    $('g-alert').textContent = "Impossible d'enregistrer ton guess.";
  });
  render(serverNow());
}
$('g-submit').onclick = submit;

// --- Affichage ---
function layout() {
  const guessing = st.mode === 'guess', reveal = st.mode === 'reveal' || st.mode === 'over';
  $('g-tabs').hidden = !guessing;
  $('g-tab-explore').classList.toggle('on', nav.tab === 'explore');
  $('g-tab-guess').classList.toggle('on', nav.tab === 'guess');
  $('g-explore').hidden = !(reveal || (guessing && nav.tab === 'explore'));
  $('g-shot').classList.toggle('reveal', reveal);
  $('g-navpad').hidden = reveal;
  const showMap = reveal || (guessing && nav.tab === 'guess');
  $('g-guessbox').hidden = !showMap;
  if (showMap) ensureMap();
  $('g-form').hidden = !guessing;
  $('g-reveal').hidden = !reveal;
  $('g-hint').hidden = reveal;
  $('g-maphint').hidden = reveal;
}

function render(now) {
  if (!running || !ctx || !cfg || !ready.p || !ready.g) return;
  if (ctx.phase === 'results') return renderResults();
  if (st.i < 0) return;
  if (st.mode === 'count') {
    view('wait');
    $('g-wait-text').textContent = 'La partie commence dans';
    $('g-count').textContent = Math.max(0, Math.ceil((st.start - now) / 1000));
    return;
  }
  view('live');
  const guessing = st.mode === 'guess', reveal = !guessing;
  $('g-progress').textContent = `Manche ${st.i + 1} / ${cfg.rounds.length}`;
  const mine = myGuess(st.i);
  let alert = '';
  if (guessing) {
    let left, total;
    if (st.first !== null) {
      left = (st.first + cfg.grace * 1000 - now) / 1000; total = cfg.grace;
      const firstId = Object.keys(guesses[st.i] || {}).find(id => guesses[st.i][id].at === st.first);
      const who = firstId === ctx.uid ? 'Tu as deviné' : `${esc(players[firstId] ? players[firstId].name : 'Un joueur')} a deviné`;
      alert = mine ? `${who} en premier ! Les autres ont encore ${Math.max(0, Math.ceil(left))} s.`
                   : `⏱️ ${who} ! Plus que ${Math.max(0, Math.ceil(left))} s pour valider ton guess.`;
    } else {
      left = (st.start + cfg.max * 1000 - now) / 1000; total = cfg.max;
    }
    left = Math.max(0, left);
    $('g-secs').textContent = left >= 90 ? Math.floor(left / 60) + ' min ' + String(Math.ceil(left % 60) % 60).padStart(2, '0') + ' s' : Math.ceil(left) + ' s';
    $('g-fill').style.width = (left / total * 100) + '%';
    $('g-fill').classList.toggle('urgent', st.first !== null);
    $('g-submit').disabled = !nav.pin || !!mine;
    $('g-submit').textContent = mine ? 'Guess validé ✅' : 'Valider mon guess';
    $('g-x').disabled = $('g-y').disabled = !!mine;
    if (mine && !nav.pin) nav.pin = { x: mine.x, y: mine.y };
  } else {
    const left = Math.max(0, Math.ceil((st.revealEnd - now) / 1000));
    $('g-secs').textContent = st.i === cfg.rounds.length - 1 ? 'Résultats dans ' + left + ' s' : 'Manche suivante dans ' + left + ' s';
    $('g-fill').style.width = '0%';
    renderReveal();
  }
  $('g-alert').hidden = !alert; if (alert) $('g-alert').innerHTML = alert;
  layout();
  renderWorld(reveal);
  if (reveal) focusReveal();
}

function renderReveal() {
  const t = target(st.i), g = guesses[st.i] || {}, now = totals(st.i);
  $('g-answer').textContent = `[${t.x}, ${t.y}]`;
  const rows = Object.keys(players).map(id => ({
    id, name: players[id].name, pts: score(g[id], t), d: g[id] ? dist(g[id], t) : null, total: now[id], pos: g[id]
  })).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  $('g-rows').innerHTML = rows.map(r => `<li class="row-geo${r.id === ctx.uid ? ' me' : ''}">
    <span>${esc(r.name)}${r.id === ctx.uid ? ' <small>(toi)</small>' : ''}${r.pos ? ` <small>[${r.pos.x}, ${r.pos.y}]</small>` : ''}</span>
    <span>${r.d === null ? '<i>pas de guess</i>' : (r.d === 0 ? 'exact !' : fmt(r.d) + ' carte' + (r.d >= 2 ? 's' : '')) + ' · +' + r.pts}</span>
    <b>${r.total}</b></li>`).join('');
}

function renderResults() {
  const t = totals(cfg.rounds.length - 1);
  const rows = Object.keys(players).map(id => ({ id, name: players[id].name, score: t[id] }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const max = cfg.rounds.length * MAX_POINTS;
  $('gr-rank').innerHTML = rows.map(r => {
    const rank = 1 + rows.filter(x => x.score > r.score).length;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || rank + '.';
    return `<li><span>${medal} ${esc(r.name)}${r.id === ctx.uid ? ' <small>(toi)</small>' : ''}</span><b>${r.score} / ${max} pts</b></li>`;
  }).join('');
}

// Tous les navigateurs recalculent la manche en cours à partir de l'heure du serveur et des guess.
function tick() {
  if (!ready.p || !ready.g) return;
  const now = serverNow();
  if (ctx.phase === 'results') { clearInterval(timer); timer = null; return render(now); }
  const s = compute(now);
  if (s.i !== nav.i) {   // nouvelle manche : on repart de la carte de départ
    const t = target(s.i);
    nav = { ...nav, i: s.i, x: t.x, y: t.y, tab: 'explore', pin: null, drawn: '', fit: true };
    st = s; $('g-x').value = ''; $('g-y').value = ''; showImage();
    if (map) layer.clearLayers();
  }
  st = s;
  if (s.mode === 'reveal' || s.mode === 'over') {
    if (nav.revealImg !== s.i) { nav.revealImg = s.i; nav.x = target(s.i).x; nav.y = target(s.i).y; showImage(); }   // on revoit la carte de départ
    // Un repère placé mais pas validé est enregistré à la fin du temps.
    if (nav.pin && !myGuess(s.i) && nav.autoFor !== s.i) { nav.autoFor = s.i; st = { ...s, mode: 'guess' }; submit(); st = s; }
    if (s.mode === 'over' && ctx.isHost && !finishing && now >= s.revealEnd + END_GRACE_MS) {
      finishing = true;
      update(path('meta'), { phase: 'results' }).catch(e => { console.error(e); finishing = false; });
    }
  }
  render(now);
}

export async function enter(c) {
  const before = ctx && ctx.phase;
  ctx = c;
  if (running) { if (before !== c.phase) tick(); return; }
  running = true; finishing = false; ready = { p: false, g: false };
  st = { i: -1, mode: 'count' };
  nav = { i: -1, x: 0, y: 0, tab: 'explore', pin: null, autoFor: -1, revealFor: -1, revealImg: -1, fit: true, drawn: '' };
  try {
    await clockReady;
    const cfgVal = (await get(path('geo'))).val();
    if (!cfgVal) { running = false; return; }
    cfg = {
      max: cfgVal.max || 300, grace: cfgVal.grace || 30,
      rounds: toList(cfgVal.rounds).map(s => { const [x, y] = String(s).split(',').map(Number); return { x, y }; }).filter(r => at_(r.x, r.y))
    };
    if (!cfg.rounds.length) { running = false; return; }
    offs.push(onValue(path('players'), s => { players = s.val() || {}; ready.p = true; if (running) render(serverNow()); }));
    offs.push(onValue(path('guesses'), s => { guesses = s.val() || {}; ready.g = true; if (running) render(serverNow()); }));
    timer = setInterval(tick, 250);
  } catch (e) { console.error(e); running = false; }
}

export function stop() {
  running = false;
  clearInterval(timer); timer = null;
  offs.forEach(u => u()); offs = [];
  cfg = null; players = {}; guesses = {}; ctx = null; ready = { p: false, g: false };
  st = { i: -1, mode: 'count' };
}
