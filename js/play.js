import { db, ref, get, set, update, onValue, serverNow, serverTimestamp, clockReady } from "./firebase.js";
import { QUESTIONS } from "./questions.js";
import { creerMonde } from "./monde.js";
import { lireCoord } from "./carte.js";
import { creerScene, infosScene, lireCase, lireTemps, lireScene } from "./confusion.js";

const COUNTDOWN_MS = 0;      // compte à rebours avant la première question (0 = la partie démarre aussitôt)
const PAUSE_MS = 0;          // pause entre deux questions (0 = on enchaîne directement)
const GRACE_MS = 2000;       // délai avant la correction (laisse arriver les dernières réponses)
const SAVE_DELAY_MS = 300;   // délai d'enregistrement pendant la frappe

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Intitulés des champs d'une question à plusieurs champs (null pour une question simple).
const fieldsOf = q => (q && q.champs ? Object.values(q.champs) : null);
const inputs = () => [...document.querySelectorAll('#p-fields input')];
let running = false, ctx = null, list = [], sched = [];
let skipSent = null, skips = {}, offSkips = null, ready = {}, offReady = null, offPlayers = null, players = {};
let timer = null, saveTimer = null, cur = null, lockedFor = null, lastSaved = {}, finishing = false;

// Image d'une question « carte » : elle est dans la banque locale (l'id publié suffit à la retrouver), pas dans la base.
const bankOf = q => QUESTIONS.find(x => x.id === q.id) || {};
const isRank = q => !!bankOf(q).classement;
// Question « classement » : on répond en plaçant un repère sur la carte du monde (enregistré comme « x, y » dans le champ 0).
let monde = null, pin = null;
function setPin(x, y) {
  if (cur === null || lockedFor === cur || !isRank(list[cur])) return;
  pin = { x, y };
  drawPin();
  onType();
}
function drawPin() {
  if (monde) monde.afficher(pin ? [{ ...pin, cls: 'me', label: '📍' }] : []);
  $('p-pos').textContent = pin ? `Ton repère : ${pin.x}, ${pin.y}` : 'Pas encore de repère : clique sur la carte.';
}
const sceneOf = q => lireScene(q.scene, bankOf(q).scene);   // la scène publiée avec la question, sinon celle de la banque locale
const isClic = q => !!sceneOf(q);
const RUSH_MS = 3000;   // question de rapidité : 3 s d'annonce avant d'afficher la confusion
let sceneJeu = null, choix = null, choixMs = null, revealAt = 0, centre = false;
function setChoix(x, y) {
  if (cur === null || lockedFor === cur || !isClic(list[cur])) return;
  if (serverNow() < revealAt) return;   // la confusion n'est pas encore affichée
  choix = [x, y]; choixMs = Math.max(0, Math.round(serverNow() - revealAt));
  sceneJeu.dessiner({ choix });
  onType();
}
const imageOf = q => (QUESTIONS.find(x => x.id === q.id) || {}).img || null;

function view(name) {
  ['live', 'wait', 'end'].forEach(v => { $('p-' + v).hidden = v !== name; });
}

// Réponse saisie : un texte, ou un objet {numéro du champ: texte} pour une question à plusieurs champs (null si vide).
function readValue(i) {
  if (isClic(list[i])) return choix ? choix.join(',') + '@' + (choixMs ?? 0) : null;
  if (isRank(list[i])) return pin ? { 0: `${pin.x}, ${pin.y}` } : null;
  if (!fieldsOf(list[i])) return $('p-answer').value.slice(0, 200) || null;
  const o = {};
  inputs().forEach((el, k) => { const v = el.value.slice(0, 200); if (v.trim()) o[k] = v; });
  return Object.keys(o).length ? o : null;
}

// Enregistre la réponse en cours de saisie dans la base.
function saveNow(i) {
  clearTimeout(saveTimer);
  const v = readValue(i), key = JSON.stringify(v);
  if (key === (lastSaved[i] ?? 'null')) return;
  lastSaved[i] = key;
  set(ref(db, `rooms/${ctx.code}/answers/${i}/${ctx.uid}`), v).catch(console.error);
}

// Fin du temps : on bloque la saisie et on envoie ce qui est écrit.
function lockQuestion() {
  if (cur === null || lockedFor === cur) return;
  lockedFor = cur;
  $('p-answer').disabled = true;
  inputs().forEach(el => { el.disabled = true; });
  saveNow(cur);
}

function openQuestion(i) {
  lockQuestion();   // au cas où l'onglet aurait été ralenti : on enregistre la question précédente
  cur = i; lockedFor = null;
  const q = list[i];
  renderReady();
  $('p-progress').textContent = `Question ${i + 1} / ${list.length}`;
  $('p-cat').textContent = q.cat;
  $('p-pts').textContent = q.pts + ' pt' + (q.pts > 1 ? 's' : '');
  $('p-text').textContent = q.q;
  const src = imageOf(q), img = $('p-img');
  img.hidden = !src;
  if (src) img.src = src; else img.removeAttribute('src');
  const fields = fieldsOf(q), rank = isRank(q);
  const input = $('p-answer');
  input.hidden = !!fields; $('p-fields').hidden = !fields || rank;
  $('p-mapbox').hidden = !rank;
  const clic = isClic(q);
  $('p-scenebox').hidden = true;   // affichée par tick() une fois l'annonce terminée
  $('p-rush').hidden = !clic;
  document.body.classList.toggle('large', clic);   // la grille est plus large que les autres écrans
  centre = false; choix = null; choixMs = null; revealAt = clic ? sched[i].start + RUSH_MS : 0;
  if (clic) $('p-conf').innerHTML = infosScene(sceneOf(q));
  if (clic) sceneJeu = creerScene($('p-scene'), sceneOf(q), { surClic: setChoix });
  pin = null;
  if (rank) {
    if (!monde) monde = creerMonde($('p-map'), { surClic: setPin, surSurvol: (x, y) => { $('p-hover').textContent = `x ${x}, y ${y}`; } });
    monde.invalider(); monde.cadrer([]); drawPin();
  }
  input.value = ''; input.disabled = false;
  if (fields) {
    $('p-fields').innerHTML = fields.map((label, k) =>
      `<label class="field">${esc(label)}<input data-k="${k}" maxlength="200" autocomplete="off"></label>`).join('');
  }
  if (clic) input.hidden = true;
  if (!rank && !clic) (fields ? inputs()[0] : input).focus();
  // Reprise après un rechargement de page : on récupère la réponse déjà enregistrée.
  get(ref(db, `rooms/${ctx.code}/answers/${i}/${ctx.uid}`)).then(s => {
    if (!s.exists() || cur !== i) return;
    const v = s.val();
    if (clic) { const c = lireCase(v); if (c && !choix) { choix = c; choixMs = lireTemps(v) ?? 0; sceneJeu.dessiner({ choix }); } }
    else if (rank) { const c = v && typeof v === 'object' ? lireCoord(v[0]) : null; if (c && !pin) { pin = { x: c[0], y: c[1] }; drawPin(); } }
    else if (fields) inputs().forEach((el, k) => { if (!el.value && typeof v === 'object' && v[k] != null) el.value = v[k]; });
    else if (!input.value && typeof v === 'string') input.value = v;
    lastSaved[i] = JSON.stringify(readValue(i));
  }).catch(() => {});
}

function finish(now) {
  lockQuestion();
  view('end');
  const endAll = sched[sched.length - 1].end;
  // Le chef fait passer la partie en correction une fois toutes les réponses arrivées.
  if (ctx.isHost && !finishing && now >= endAll + GRACE_MS) {
    finishing = true;
    update(ref(db, `rooms/${ctx.code}/meta`), { phase: 'correction' })
      .catch(e => { console.error(e); finishing = false; });
  }
}

// Calendrier des questions. Quand le chef passe une question, elle se termine à l'heure enregistrée dans « skips ».
function buildSched() {
  let t = ctx.startAt + COUNTDOWN_MS;
  sched = list.map((q, i) => {
    const start = t;
    let end = start + q.temps * 1000;
    if (skips[i] != null) end = Math.max(start, Math.min(end, skips[i]));
    t = end + PAUSE_MS;
    return { start, end };
  });
}

// « Prêt » : un participant prévient le chef qu'il a fini ; le chef voit qui est prêt et le bouton « Passer » s'allume quand tous le sont.
function renderReady() {
  if (cur === null || !ctx) return;
  const mine = !!(ready[cur] && ready[cur][ctx.uid]);
  const ids = Object.keys(players);   // le chef aussi peut se mettre prêt
  const done = ids.filter(id => ready[cur] && ready[cur][id]);
  const all = ids.length > 0 && done.length === ids.length;
  $('p-ready').hidden = false;
  $('p-ready').classList.toggle('on', mine);
  $('p-ready').textContent = mine ? "✅ Prêt à passer à la question suivante (annuler)" : "✋ Prêt à passer à la question suivante";
  $('p-readyinfo').hidden = !ids.length;
  $('p-readyinfo').textContent = `✋ Prêts : ${done.length} / ${ids.length}` + (all ? ' — tout le monde est prêt, on passe !' : '');
  if (all && ctx.isHost && skips[cur] == null && skipSent !== cur && sched[cur] && serverNow() < sched[cur].end) { skipSent = cur; skipQuestion(); }   // tout le monde est prêt : le chef (qui a le droit d'écrire) passe la question
}
$('p-ready').onclick = () => {
  if (cur === null || !ctx) return;
  const on = !(ready[cur] && ready[cur][ctx.uid]);
  set(ref(db, `rooms/${ctx.code}/ready/${cur}/${ctx.uid}`), on ? true : null).catch(console.error);
};

// Le chef passe la question en cours : elle se termine maintenant pour tout le monde.
function skipQuestion() {
  if (!ctx || !ctx.isHost || cur === null || skips[cur] != null) return;
  $('p-skip').disabled = true;
  set(ref(db, `rooms/${ctx.code}/skips/${cur}`), serverTimestamp()).catch(e => { console.error(e); $('p-skip').disabled = false; });
}

// Tous les navigateurs déduisent la question en cours de l'heure du serveur.
function tick() {
  buildSched();
  const now = serverNow();
  const i = sched.findIndex(s => now < s.end);
  if (i === -1) return finish(now);
  const s = sched[i];
  if (now < s.start) {   // compte à rebours initial ou pause entre deux questions
    lockQuestion();
    $('p-wait-text').textContent = i === 0 ? 'La partie commence dans' : `Question ${i + 1} / ${list.length} dans`;
    $('p-count').textContent = Math.ceil((s.start - now) / 1000);
    return view('wait');
  }
  view('live');
  if (cur !== i) openQuestion(i);
  if (revealAt) {   // question de rapidité : annonce de 3 s, puis la scène apparaît
    const att = revealAt - now;
    $('p-rush').hidden = att <= 0; $('p-scenebox').hidden = att > 0;
    $('p-rushcount').textContent = Math.max(1, Math.ceil(att / 1000));
    if (att <= 0 && !centre) { centre = true; const w = $('p-scene').parentElement; w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2; }   // petit écran : on centre la grille
  }
  $('p-skip').hidden = !ctx.isHost;
  $('p-skip').disabled = skips[i] != null;
  const left = (s.end - now) / 1000;
  $('p-secs').textContent = Math.ceil(left) + ' s';
  $('p-fill').style.width = (left / ((s.end - s.start) / 1000) * 100) + '%';
}

function onType() {
  if (cur === null || lockedFor === cur) return;
  clearTimeout(saveTimer);
  const i = cur;
  saveTimer = setTimeout(() => saveNow(i), SAVE_DELAY_MS);
}
$('p-skip').onclick = () => { if (confirm('Passer la question pour tout le monde ?')) skipQuestion(); };   // le passage automatique (tout le monde prêt) ne demande rien
$('p-answer').addEventListener('input', onType);
$('p-fields').addEventListener('input', onType);

export async function enter(c) {
  if (running) return;
  running = true; ctx = c; cur = null; lockedFor = null; lastSaved = {}; finishing = false; skips = {}; skipSent = null;
  try {
    await clockReady;
    const snap = await get(ref(db, `rooms/${ctx.code}/questions`));
    const v = snap.val() || [];
    list = Array.isArray(v) ? v : Object.values(v);
    if (!list.length) { running = false; return; }
    list.forEach(q => { const src = imageOf(q); if (src) new Image().src = src; });   // on charge les cartes à l'avance
    offSkips = onValue(ref(db, `rooms/${ctx.code}/skips`), s => { skips = s.val() || {}; });
    offReady = onValue(ref(db, `rooms/${ctx.code}/ready`), s => { ready = s.val() || {}; renderReady(); });
    offPlayers = onValue(ref(db, `rooms/${ctx.code}/players`), s => { players = s.val() || {}; renderReady(); });
    buildSched();
    timer = setInterval(tick, 200);
    tick();
  } catch (e) { console.error(e); running = false; }
}

export function stop() {
  running = false;
  document.body.classList.remove('large');
  if (offSkips) { offSkips(); offSkips = null; }
  if (offReady) { offReady(); offReady = null; }
  if (offPlayers) { offPlayers(); offPlayers = null; }
  ready = {}; players = {};
  clearInterval(timer);
  clearTimeout(saveTimer);
}
