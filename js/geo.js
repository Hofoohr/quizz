import { db, ref, get, set, update, onValue, serverNow, clockReady } from "./firebase.js";
import { PLACES } from "./geo-places.js";

const COUNTDOWN_MS = 5000;   // compte à rebours avant la première manche
const REVEAL_MS = 10000;     // temps d'affichage de la solution après chaque manche
const GRACE_MS = 1500;       // délai avant la fin de partie (laisse arriver les dernières réponses)
const ASPECT = 4 / 3;        // largeur / hauteur de la carte
const MAX_POINTS = 1000;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const toList = v => !v ? [] : Array.isArray(v) ? v : Object.values(v);

// Distance en % de la hauteur de la carte ; 1000 pts sur la cible, ~370 pts à 20 % de distance.
const dist = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);
const score = (g, p) => g ? Math.round(MAX_POINTS * Math.exp(-dist(g, p) / 20)) : 0;

let running = false, ctx = null, places = [], time = 30, sched = [];
let players = {}, guesses = {}, offs = [], timer = null, finishing = false;
let state = { i: -1, mode: 'count' }, drawn = '', photoFor = -1;

const path = p => ref(db, `rooms/${ctx.code}/${p}`);

function view(name) {
  ['wait', 'live'].forEach(v => { $('g-' + v).hidden = v !== name; });
}

function myGuess(i) { return (guesses[i] || {})[ctx.uid] || null; }

function totals(upTo) {
  const t = {};
  Object.keys(players).forEach(id => { t[id] = 0; });
  for (let i = 0; i <= upTo && i < places.length; i++) {
    Object.keys(players).forEach(id => { t[id] += score((guesses[i] || {})[id], places[i]); });
  }
  return t;
}

function renderPhoto(i) {
  if (photoFor === i) return;
  photoFor = i;
  const p = places[i], box = $('g-photo');
  box.textContent = '';
  const clue = document.createElement('p');
  clue.className = 'clue';
  clue.textContent = p.clue || 'Où se trouve ce lieu ?';
  if (p.img) {
    const img = new Image();
    img.alt = '';
    img.onload = () => { box.textContent = ''; box.appendChild(img); };
    img.src = p.img;
  }
  box.appendChild(clue);
}

function renderMap(i, reveal) {
  const p = places[i], g = guesses[i] || {};
  const pin = (pt, cls, label) => `<div class="pin ${cls}" style="left:${pt.x}%;top:${pt.y}%" title="${esc(label)}"><span>${esc([...label].slice(0, 2).join(''))}</span></div>`;
  let pins = '', lines = '';
  if (reveal) {
    Object.keys(g).forEach(id => {
      if (!players[id]) return;
      lines += `<line x1="${g[id].x}" y1="${g[id].y}" x2="${p.x}" y2="${p.y}" class="${id === ctx.uid ? 'me' : ''}"/>`;
      pins += pin(g[id], id === ctx.uid ? 'me' : 'other', players[id].name);
    });
    pins += pin(p, 'target', '🎯');
  } else {
    const m = myGuess(i);
    if (m) pins = pin(m, 'me', '📍');
  }
  const key = i + '|' + reveal + '|' + pins + lines;
  if (key === drawn) return;
  drawn = key;
  $('g-lines').innerHTML = lines;
  $('g-pins').innerHTML = pins;
}

function renderReveal(i) {
  const p = places[i], g = guesses[i] || {};
  const now = totals(i);
  const rows = Object.keys(players).map(id => {
    const d = g[id] ? dist(g[id], p) : null;
    return { id, name: players[id].name, pts: score(g[id], p), d, total: now[id] };
  }).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  $('g-answer').textContent = p.name;
  $('g-rows').innerHTML = rows.map(r => `<li class="row-geo${r.id === ctx.uid ? ' me' : ''}">
    <span>${esc(r.name)}${r.id === ctx.uid ? ' <small>(toi)</small>' : ''}</span>
    <span>${r.d === null ? '<i>pas de réponse</i>' : '+' + r.pts + ' pts'}</span>
    <b>${r.total}</b></li>`).join('');
}

function render(now) {
  if (!running || !ctx || !places.length) return;
  if (ctx.phase === 'results') return renderResults();
  if (state.i < 0) return;
  const s = state;
  if (s.mode === 'count') {
    view('wait');
    $('g-wait-text').textContent = s.i === 0 ? 'La partie commence dans' : `Manche ${s.i + 1} / ${places.length} dans`;
    $('g-count').textContent = Math.ceil((sched[s.i].start - now) / 1000);
    return;
  }
  view('live');
  const reveal = s.mode === 'reveal';
  $('g-progress').textContent = `Manche ${s.i + 1} / ${places.length}`;
  $('g-timer').hidden = reveal;
  $('g-reveal').hidden = !reveal;
  $('g-hint').hidden = reveal;
  renderPhoto(s.i);
  if (reveal) {
    $('g-secs').textContent = s.i === places.length - 1 ? 'Fin de la partie…' : 'Manche suivante dans ' + Math.ceil((sched[s.i].end - now) / 1000) + ' s';
    renderReveal(s.i);
  } else {
    const left = (sched[s.i].guessEnd - now) / 1000;
    $('g-secs').textContent = Math.ceil(left) + ' s';
    $('g-fill').style.width = (left / time * 100) + '%';
    $('g-hint').textContent = myGuess(s.i) ? 'Tu peux déplacer ton repère jusqu\'à la fin du temps.' : 'Clique sur la carte pour placer ton repère.';
  }
  renderMap(s.i, reveal);
  $('g-map').classList.toggle('locked', reveal);
}

function renderResults() {
  const t = totals(places.length - 1);
  const rows = Object.keys(players).map(id => ({ id, name: players[id].name, score: t[id] }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const max = places.length * MAX_POINTS;
  $('gr-rank').innerHTML = rows.map(r => {
    const rank = 1 + rows.filter(x => x.score > r.score).length;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || rank + '.';
    return `<li><span>${medal} ${esc(r.name)}${r.id === ctx.uid ? ' <small>(toi)</small>' : ''}</span><b>${r.score} / ${max} pts</b></li>`;
  }).join('');
}

// Tous les navigateurs déduisent la manche en cours de l'heure du serveur.
function tick() {
  const now = serverNow();
  if (ctx.phase === 'results') { clearInterval(timer); timer = null; return render(now); }
  let i = sched.findIndex(s => now < s.end);
  if (i === -1) {
    i = sched.length - 1;
    if (ctx.isHost && !finishing && now >= sched[i].end + GRACE_MS) {
      finishing = true;
      update(path('meta'), { phase: 'results' }).catch(e => { console.error(e); finishing = false; });
    }
    state = { i, mode: 'reveal' };
  } else {
    const s = sched[i];
    state = { i, mode: now < s.start ? 'count' : now < s.guessEnd ? 'guess' : 'reveal' };
  }
  render(now);
}

// Un clic sur la carte place (ou déplace) le repère du joueur.
$('g-map').addEventListener('click', e => {
  if (!running || !ctx || state.mode !== 'guess') return;
  const r = $('g-map').getBoundingClientRect();
  const x = Math.min(100, Math.max(0, Math.round((e.clientX - r.left) / r.width * 1000) / 10));
  const y = Math.min(100, Math.max(0, Math.round((e.clientY - r.top) / r.height * 1000) / 10));
  const i = state.i;
  (guesses[i] = guesses[i] || {})[ctx.uid] = { x, y };   // affichage immédiat, avant l'écho de la base
  render(serverNow());
  set(path(`guesses/${i}/${ctx.uid}`), { x, y }).catch(console.error);
});

export async function enter(c) {
  const before = ctx && ctx.phase;
  ctx = c;
  if (running) { if (before !== c.phase) tick(); return; }
  running = true; finishing = false; drawn = ''; photoFor = -1; state = { i: -1, mode: 'count' };
  try {
    await clockReady;
    const snap = await get(path('geo'));
    const cfg = snap.val();
    if (!cfg) { running = false; return; }
    time = cfg.time || 30;
    places = toList(cfg.rounds).map(id => PLACES.find(p => p.id === id)).filter(Boolean);
    if (!places.length) { running = false; return; }
    let t = ctx.startAt + COUNTDOWN_MS;
    sched = places.map(() => {
      const s = { start: t, guessEnd: t + time * 1000, end: t + time * 1000 + REVEAL_MS };
      t = s.end; return s;
    });
    offs.push(onValue(path('players'), s => { players = s.val() || {}; if (running) render(serverNow()); }));
    offs.push(onValue(path('guesses'), s => { guesses = s.val() || {}; if (running) render(serverNow()); }));
    timer = setInterval(tick, 250);
    tick();
  } catch (e) { console.error(e); running = false; }
}

export function stop() {
  running = false;
  clearInterval(timer); timer = null;
  offs.forEach(u => u()); offs = [];
  places = []; players = {}; guesses = {}; sched = []; ctx = null; state = { i: -1, mode: 'count' }; drawn = ''; photoFor = -1;
}
