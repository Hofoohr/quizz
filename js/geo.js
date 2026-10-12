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
let nav = { i: -1, x: 0, y: 0, tab: 'explore', pin: null, autoFor: -1, revealFor: -1, revealImg: -1, zoom: 1, drawn: '' };

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

// --- Carte du monde (canvas dessiné une fois) ---
let worldDrawn = false;
function drawWorld() {
  if (worldDrawn) return;
  worldDrawn = true;
  const px = 8, c = $('g-canvas');
  c.width = W * px; c.height = H * px;
  const g = c.getContext('2d');
  g.fillStyle = '#0e1220'; g.fillRect(0, 0, c.width, c.height);
  BY.forEach(m => {
    g.fillStyle = `hsl(${(m.sub * 47) % 360},50%,42%)`;
    g.fillRect((m.x - minX) * px, (m.y - minY) * px, px, px);
  });
  g.font = `${px * 2.6}px system-ui,sans-serif`;
  for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) {
    const X = (x - minX + .5) * px;
    g.strokeStyle = x === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.2)'; g.lineWidth = x === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(X, 0); g.lineTo(X, c.height); g.stroke();
    g.fillStyle = '#fff'; g.fillText(x, X + 3, px * 3);
  }
  for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) {
    const Y = (y - minY + .5) * px;
    g.strokeStyle = y === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.2)'; g.lineWidth = y === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(0, Y); g.lineTo(c.width, Y); g.stroke();
    g.fillStyle = '#fff'; g.fillText(y, 3, Y - 3);
  }
  $('g-lines').setAttribute('viewBox', `0 0 ${W} ${H}`);
}
const pct = (x, y) => ({ l: (x - minX + .5) / W * 100, t: (y - minY + .5) / H * 100 });

function pin(x, y, cls, label) {
  const p = pct(x, y);
  return `<div class="pin ${cls}" style="left:${p.l}%;top:${p.t}%" title="${esc(label)}"><span>${esc([...label].slice(0, 2).join(''))}</span></div>`;
}

function applyZoom() { $('g-world').style.width = nav.zoom * 100 + '%'; }

function renderWorld(reveal) {
  let pins = '', lines = '';
  const t = target(st.i);
  if (reveal) {
    const g = guesses[st.i] || {};
    Object.keys(g).forEach(id => {
      if (!players[id]) return;
      const a = pct(g[id].x, g[id].y), b = pct(t.x, t.y);
      lines += `<line x1="${a.l / 100 * W}" y1="${a.t / 100 * H}" x2="${b.l / 100 * W}" y2="${b.t / 100 * H}" class="${id === ctx.uid ? 'me' : ''}"/>`;
      pins += pin(g[id].x, g[id].y, id === ctx.uid ? 'me' : 'other', players[id].name);
    });
    pins += pin(t.x, t.y, 'target', '🎯');
  } else {
    const m = myGuess(st.i) || nav.pin;
    if (m) pins = pin(m.x, m.y, 'me', '📍');
  }
  const key = st.i + '|' + reveal + '|' + pins;
  if (key === nav.drawn) return;
  nav.drawn = key;
  $('g-lines').innerHTML = lines;
  $('g-pins').innerHTML = pins;
}

// En fin de manche : on zoome sur la zone qui contient la solution et les guess.
function focusReveal() {
  if (nav.revealFor === st.i) return;
  nav.revealFor = st.i;
  const t = target(st.i), pts = [t, ...Object.values(guesses[st.i] || {})];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const bw = Math.max(...xs) - Math.min(...xs) + 12, bh = Math.max(...ys) - Math.min(...ys) + 12;
  nav.zoom = Math.max(1, Math.min(6, Math.floor(Math.min(W / bw, H / bh) * 2) / 2));
  applyZoom();
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, sc = $('g-scroll');
  requestAnimationFrame(() => {
    sc.scrollLeft = (cx - minX + .5) / W * sc.scrollWidth - sc.clientWidth / 2;
    sc.scrollTop = (cy - minY + .5) / H * sc.scrollHeight - sc.clientHeight / 2;
  });
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
$('g-world').addEventListener('click', e => {
  if (!running || st.mode !== 'guess' || myGuess(st.i)) return;
  const r = $('g-world').getBoundingClientRect();
  setPin(Math.floor((e.clientX - r.left) / r.width * W) + minX, Math.floor((e.clientY - r.top) / r.height * H) + minY);
});
['g-x', 'g-y'].forEach(id => {
  $(id).oninput = () => {
    const x = parseInt($('g-x').value, 10), y = parseInt($('g-y').value, 10);
    if (Number.isFinite(x) && Number.isFinite(y)) setPin(x, y);
  };
});
$('g-zin').onclick = () => { nav.zoom = Math.min(8, nav.zoom + 1); applyZoom(); };
$('g-zout').onclick = () => { nav.zoom = Math.max(1, nav.zoom - 1); applyZoom(); };

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
  $('g-guessbox').hidden = !(reveal || (guessing && nav.tab === 'guess'));
  $('g-form').hidden = !guessing;
  $('g-reveal').hidden = !reveal;
  $('g-hint').hidden = reveal;
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
    nav = { ...nav, i: s.i, x: t.x, y: t.y, tab: 'explore', pin: null, drawn: '', zoom: 1 };
    st = s; applyZoom(); $('g-x').value = ''; $('g-y').value = ''; showImage();
    $('g-scroll').scrollTo(0, 0);
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
  nav = { i: -1, x: 0, y: 0, tab: 'explore', pin: null, autoFor: -1, revealFor: -1, revealImg: -1, zoom: 1, drawn: '' };
  try {
    await clockReady;
    const cfgVal = (await get(path('geo'))).val();
    if (!cfgVal) { running = false; return; }
    cfg = {
      max: cfgVal.max || 300, grace: cfgVal.grace || 30,
      rounds: toList(cfgVal.rounds).map(s => { const [x, y] = String(s).split(',').map(Number); return { x, y }; }).filter(r => at_(r.x, r.y))
    };
    if (!cfg.rounds.length) { running = false; return; }
    drawWorld();
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
