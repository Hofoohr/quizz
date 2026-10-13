import { db, signIn, ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp } from "./firebase.js";
import { QUESTIONS } from "./questions.js";
import * as Play from "./play.js";
import * as Corr from "./correction.js";
import { melange, composer } from "./tirage.js";
import * as Geo from "./geo.js";

const MIN_PLAYERS = 1;   // mets 3 quand tu auras fini de tester seul
const MAX_PLAYERS = 10;  // limite vérifiée par l'application (les règles de la base ne peuvent pas compter les joueurs)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

let uid = null, code = null, meta = null, players = {};
let playerRef = null, unsubs = [], started = false;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
}
function showError(msg) {
  const e = $('error');
  e.textContent = msg; e.hidden = false;
  setTimeout(() => { e.hidden = true; }, 4000);
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const store = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

function getName() {
  const n = $('pseudo').value.trim().slice(0, 20);
  if (!n) { showError('Choisis un pseudo.'); $('pseudo').focus(); return null; }
  store('pseudo', n);
  return n;
}

async function joinAsPlayer(name) {
  playerRef = ref(db, `rooms/${code}/players/${uid}`);
  await set(playerRef, { name });
  onDisconnect(playerRef).remove();   // dans la salle d'attente, fermer l'onglet = quitter
}

async function createRoom() {
  const name = getName(); if (!name) return;
  try {
    for (let i = 0; i < 5; i++) {
      const c = randomCode();
      try {
        await set(ref(db, `rooms/${c}/meta`), { hostUid: uid, phase: 'lobby' });
        code = c;
        await joinAsPlayer(name);
        return enterRoom();
      } catch (e) { if (i === 4) throw e; }   // code déjà pris : on en tire un autre
    }
  } catch (e) { console.error(e); showError('Impossible de créer le salon.'); }
}

async function joinRoom() {
  const name = getName(); if (!name) return;
  const c = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(c)) { showError('Le code du salon a 4 caractères.'); return; }
  try {
    const snap = await get(ref(db, `rooms/${c}/meta`));
    if (!snap.exists()) { showError('Salon introuvable.'); return; }
    if (snap.val().phase !== 'lobby') {
      // Partie en cours : seuls les joueurs déjà inscrits peuvent revenir.
      const me = await get(ref(db, `rooms/${c}/players/${uid}`));
      if (!me.exists()) { showError('La partie a déjà commencé.'); return; }
      code = c; playerRef = ref(db, `rooms/${c}/players/${uid}`);
      return enterRoom();
    }
    const pSnap = await get(ref(db, `rooms/${c}/players`));
    if (pSnap.exists() && Object.keys(pSnap.val()).length >= MAX_PLAYERS) { showError('Le salon est complet.'); return; }
    code = c;
    await joinAsPlayer(name);
    enterRoom();
  } catch (e) { console.error(e); showError('Impossible de rejoindre (salon complet ?).'); }
}

function enterRoom() {
  started = false;
  store('room', code);
  $('room-code').textContent = code;
  showScreen('lobby');
  unsubs.push(onValue(ref(db, `rooms/${code}/meta`), s => { meta = s.val(); render(); }));
  unsubs.push(onValue(ref(db, `rooms/${code}/players`), s => { players = s.val() || {}; render(); }));
}

// Après un rechargement de page, on revient dans la partie en cours.
async function tryResume() {
  const c = load('room');
  if (!c) return;
  try {
    const [m, me] = await Promise.all([get(ref(db, `rooms/${c}/meta`)), get(ref(db, `rooms/${c}/players/${uid}`))]);
    if (m.exists() && me.exists() && m.val().phase !== 'lobby') {
      code = c; playerRef = ref(db, `rooms/${c}/players/${uid}`);
      enterRoom();
    } else store('room', null);
  } catch (e) { console.error(e); }
}

function render() {
  if (!meta) return;
  const ids = Object.keys(players);
  if (meta.phase !== 'lobby') {
    if (!started) { started = true; onDisconnect(playerRef).cancel(); }   // en partie, quitter n'efface plus le joueur
    const host = meta.hostUid === uid, results = meta.phase === 'results';
    $('r-home').hidden = $('gr-home').hidden = !(results && host);
    $('r-wait').hidden = $('gr-wait').hidden = !(results && !host);
    if (meta.game === 'geo' || meta.phase === 'geo') {
      Play.stop(); Corr.stop();
      Geo.enter({ code, uid, hostUid: meta.hostUid, isHost: meta.hostUid === uid, phase: meta.phase, startAt: meta.startAt });
      return showScreen(meta.phase === 'results' ? 'georesults' : 'geo');
    }
    Geo.stop();
    if (meta.phase === 'questions') {
      Play.enter({ code, uid, isHost: meta.hostUid === uid, startAt: meta.startAt });
      return showScreen('play');
    }
    Play.stop();
    Corr.enter({ code, uid, hostUid: meta.hostUid, isHost: meta.hostUid === uid, phase: meta.phase });
    return showScreen(meta.phase === 'results' ? 'results' : 'correction');
  }
  if (started) {   // retour dans la salle d'attente après « Rejouer » : on arrête les jeux et on réarme le départ automatique
    started = false;
    Play.stop(); Corr.stop(); Geo.stop();
    try { onDisconnect(playerRef).remove(); } catch (e) {}
    showScreen('lobby');
  }
  const isHost = meta.hostUid === uid;
  $('players').innerHTML = ids.map(id =>
    `<li>${id === meta.hostUid ? '👑 ' : ''}${esc(players[id].name)}${id === uid ? ' <small>(toi)</small>' : ''}</li>`).join('');
  $('count').textContent = `${ids.length} / ${MAX_PLAYERS}`;
  $('host-box').hidden = !isHost;
  $('wait-msg').hidden = isHost;
  $('start').disabled = ids.length < MIN_PLAYERS;
}

const selectedGame = () => document.querySelector('input[name="game"]:checked').value;

async function startGeo() {
  const rounds = Geo.pickRounds(+$('geo-nb').value);
  try {
    await set(ref(db, `rooms/${code}/geo`), { max: +$('geo-max').value, grace: +$('geo-grace').value, nomove: $('geo-nomove').checked, rounds });
    await update(ref(db, `rooms/${code}/meta`), { phase: 'geo', game: 'geo', startAt: serverTimestamp() });
  } catch (e) { console.error(e); showError('Impossible de lancer la partie.'); }
}

async function startGame() {
  if (selectedGame() === 'geo') return startGeo();
  const chosen = [...document.querySelectorAll('#cats input:checked')].map(i => i.value);
  if (!chosen.length) { showError('Choisis au moins une catégorie.'); return; }
  const bank = QUESTIONS.filter(q => chosen.includes(q.cat));
  const n = +$('nb').value;
  const deck = composer(bank, n);   // répartition entre les catégories (poids dans js/tirage.js), puis tirage au hasard dans chacune
  // La première question est toujours une question à plusieurs champs, s'il y en a dans les catégories choisies.
  const m = deck.findIndex(q => q.champs);
  if (m > 0) deck.unshift(...deck.splice(m, 1));
  else if (m === -1) { const extra = melange(bank).find(q => q.champs && !deck.includes(q)); if (extra) { deck.unshift(extra); deck.splice(n); } }
  // On publie les questions SANS la réponse attendue.
  const qs = {};
  deck.forEach((q, i) => {
    qs[i] = { id: q.id, cat: q.cat, q: q.q, pts: q.pts, temps: q.temps };
    if (q.champs) qs[i].champs = q.champs;   // intitulés des champs, sans les réponses
  });
  try {
    await set(ref(db, `rooms/${code}/questions`), qs);
    await update(ref(db, `rooms/${code}/meta`), { phase: 'questions', startAt: serverTimestamp() });
  } catch (e) { console.error(e); showError('Impossible de lancer la partie.'); }
}

async function leaveRoom() {
  unsubs.forEach(u => u()); unsubs = [];
  try { onDisconnect(playerRef).cancel(); await remove(playerRef); } catch (e) {}
  store('room', null);
  code = null; meta = null; players = {}; playerRef = null; started = false;
  showScreen('home');
}

// Quitter une partie en cours (avec confirmation) pour pouvoir en lancer une nouvelle.
async function exitRoom(endGame) {
  const c = code;
  unsubs.forEach(u => u()); unsubs = [];
  Play.stop(); Corr.stop(); Geo.stop();
  if (endGame) {   // le chef qui part met fin à la partie : les résultats s'affichent chez les autres
    try { await update(ref(db, `rooms/${c}/meta`), { phase: 'results' }); } catch (e) { console.error(e); }
  }
  store('room', null);
  code = null; meta = null; players = {}; playerRef = null; started = false;
  showScreen('home');
}

async function leaveGame() {
  const isHost = !!meta && meta.hostUid === uid;
  const ok = confirm(isHost
    ? "Tu es le chef du salon : si tu quittes, la partie s'arrête pour tout le monde. Quitter ?"
    : "Quitter la partie ? Tu pourras la rejoindre à nouveau avec le code du salon.");
  if (ok) await exitRoom(isHost && meta.phase !== 'results');
}

// --- Démarrage ---
$('pseudo').value = load('pseudo') || '';
const cats = [...new Set(QUESTIONS.map(q => q.cat))];
$('cats').innerHTML = cats.map(c => `<label class="chk"><input type="checkbox" value="${c}" checked> ${c}</label>`).join('');
$('create').onclick = createRoom;
$('join').onclick = joinRoom;
$('start').onclick = startGame;
document.querySelectorAll('input[name="game"]').forEach(r => {
  r.onchange = () => {
    const geo = selectedGame() === 'geo';
    $('quizz-opts').hidden = geo; $('geo-opts').hidden = !geo;
  };
});
$('leave').onclick = leaveRoom;
document.querySelectorAll('.leave-game').forEach(b => { b.onclick = leaveGame; });
// Le chef relance une partie dans le même salon : on efface la partie précédente et tout le monde revient dans la salle d'attente.
async function replay() {
  try {
    await update(ref(db, `rooms/${code}`), {
      questions: null, answers: null, skips: null, expected: null, correction: null, verdicts: null, geo: null, guesses: null,
      'meta/phase': 'lobby', 'meta/game': null, 'meta/startAt': null
    });
  } catch (e) { console.error(e); showError('Impossible de relancer la partie.'); }
}
$('r-home').onclick = replay;
$('gr-home').onclick = replay;

signIn().then(user => {
  uid = user.uid;
  $('create').disabled = false;
  $('join').disabled = false;
  tryResume();
}).catch(e => {
  console.error(e);
  showError("Connexion à Firebase impossible : vérifie que l'authentification anonyme est activée.");
});
