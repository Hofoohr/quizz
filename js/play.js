import { db, ref, get, set, update, onValue, serverNow, serverTimestamp, clockReady } from "./firebase.js";

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
let skips = {}, offSkips = null;
let timer = null, saveTimer = null, cur = null, lockedFor = null, lastSaved = {}, finishing = false;

function view(name) {
  ['live', 'wait', 'end'].forEach(v => { $('p-' + v).hidden = v !== name; });
}

// Réponse saisie : un texte, ou un objet {numéro du champ: texte} pour une question à plusieurs champs (null si vide).
function readValue(i) {
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
  $('p-progress').textContent = `Question ${i + 1} / ${list.length}`;
  $('p-cat').textContent = q.cat;
  $('p-pts').textContent = q.pts + ' pt' + (q.pts > 1 ? 's' : '');
  $('p-text').textContent = q.q;
  const fields = fieldsOf(q);
  const input = $('p-answer');
  input.hidden = !!fields; $('p-fields').hidden = !fields;
  input.value = ''; input.disabled = false;
  if (fields) {
    $('p-fields').innerHTML = fields.map((label, k) =>
      `<label class="field">${esc(label)}<input data-k="${k}" maxlength="200" autocomplete="off"></label>`).join('');
  }
  (fields ? inputs()[0] : input).focus();
  // Reprise après un rechargement de page : on récupère la réponse déjà enregistrée.
  get(ref(db, `rooms/${ctx.code}/answers/${i}/${ctx.uid}`)).then(s => {
    if (!s.exists() || cur !== i) return;
    const v = s.val();
    if (fields) inputs().forEach((el, k) => { if (!el.value && typeof v === 'object' && v[k] != null) el.value = v[k]; });
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
$('p-skip').onclick = skipQuestion;
$('p-answer').addEventListener('input', onType);
$('p-fields').addEventListener('input', onType);

export async function enter(c) {
  if (running) return;
  running = true; ctx = c; cur = null; lockedFor = null; lastSaved = {}; finishing = false; skips = {};
  try {
    await clockReady;
    const snap = await get(ref(db, `rooms/${ctx.code}/questions`));
    const v = snap.val() || [];
    list = Array.isArray(v) ? v : Object.values(v);
    if (!list.length) { running = false; return; }
    offSkips = onValue(ref(db, `rooms/${ctx.code}/skips`), s => { skips = s.val() || {}; });
    buildSched();
    timer = setInterval(tick, 200);
    tick();
  } catch (e) { console.error(e); running = false; }
}

export function stop() {
  running = false;
  if (offSkips) { offSkips(); offSkips = null; }
  clearInterval(timer);
  clearTimeout(saveTimer);
}
