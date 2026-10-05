import { db, ref, get, set, update, onValue } from "./firebase.js";
import { QUESTIONS } from "./questions.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

let running = false, initing = false, ctx = null;
let list = [], players = {}, index = null, answers = {}, expected = null, verdicts = {};
let offs = [], offQ = [];

const path = p => ref(db, `rooms/${ctx.code}/${p}`);

// Le chef publie la réponse attendue au moment où la correction atteint la question.
async function publishExpected(i) {
  const q = QUESTIONS.find(x => x.id === list[i].id);
  await set(path(`expected/${i}`), q ? q.a : '?');
}

async function initCorrection() {
  if (initing) return;
  initing = true;
  try { await publishExpected(0); await set(path('correction/index'), 0); }
  catch (e) { console.error(e); initing = false; }
}

// On écoute les réponses et la réponse attendue de la question en cours de correction.
function subscribeQuestion(i) {
  offQ.forEach(u => u()); offQ = [];
  answers = {}; expected = null;
  if (i === null) return;
  offQ.push(onValue(path(`answers/${i}`), s => { answers = s.val() || {}; render(); }));
  offQ.push(onValue(path(`expected/${i}`), s => { expected = s.val(); render(); }));
}

const order = () => Object.keys(players).sort((a, b) =>
  a === ctx.hostUid ? -1 : b === ctx.hostUid ? 1 : players[a].name.localeCompare(players[b].name));

function renderCorrection() {
  const q = index === null ? null : list[index];
  $('c-progress').textContent = q ? `Correction ${index + 1} / ${list.length}` : 'Correction';
  $('c-body').hidden = !q;
  $('c-prep').hidden = !!q;
  if (!q) return;
  $('c-pts').textContent = q.pts + ' pt' + (q.pts > 1 ? 's' : '');
  $('c-cat').textContent = q.cat;
  $('c-text').textContent = q.q;
  $('c-expected').textContent = expected ?? '…';
  const v = verdicts[index] || {};
  $('c-list').innerHTML = order().map(id => {
    const val = v[id];
    const verdict = ctx.isHost
      ? `<button class="v${val === true ? ' on' : ''}" data-id="${id}" data-val="1">✅</button><button class="v${val === false ? ' on' : ''}" data-id="${id}" data-val="0">❌</button>`
      : `<span class="badge">${val === true ? '✅' : val === false ? '❌' : '…'}</span>`;
    const a = answers[id];
    return `<li class="row ${val === true ? 'ok' : val === false ? 'ko' : ''}">
      <div class="who"><b>${esc(players[id].name)}</b>${id === ctx.uid ? ' <small>(toi)</small>' : ''}</div>
      <div class="ans">${a ? esc(a) : '<i>(pas de réponse)</i>'}</div>
      <div class="verdict">${verdict}</div></li>`;
  }).join('');
  $('c-host').hidden = !ctx.isHost;
  $('c-wait').hidden = ctx.isHost;
  $('c-prev').disabled = index === 0;
  $('c-next').textContent = index === list.length - 1 ? 'Voir les résultats' : 'Question suivante →';
}

function renderResults() {
  const max = list.reduce((s, q) => s + q.pts, 0);
  const rows = Object.keys(players).map(id => {
    let score = 0;
    list.forEach((q, j) => { if ((verdicts[j] || {})[id] === true) score += q.pts; });
    return { id, name: players[id].name, score };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  $('r-rank').innerHTML = rows.map(r => {
    const rank = 1 + rows.filter(x => x.score > r.score).length;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || rank + '.';
    return `<li><span>${medal} ${esc(r.name)}${r.id === ctx.uid ? ' <small>(toi)</small>' : ''}</span><b>${r.score} / ${max} pts</b></li>`;
  }).join('');
}

function render() {
  if (!running || !ctx || !list.length) return;
  if (ctx.phase === 'results') renderResults(); else renderCorrection();
}

// Le chef valide ou refuse une réponse ; un second clic sur le même bouton annule la décision.
$('c-list').addEventListener('click', e => {
  const b = e.target.closest('.v');
  if (!b || !ctx || !ctx.isHost) return;
  const id = b.dataset.id, val = b.dataset.val === '1';
  const cur = (verdicts[index] || {})[id];
  set(path(`verdicts/${index}/${id}`), cur === val ? null : val).catch(console.error);
});

$('c-prev').onclick = () => {
  if (index > 0) set(path('correction/index'), index - 1).catch(console.error);
};

$('c-next').onclick = async () => {
  const j = verdicts[index] || {};
  const pending = Object.keys(players).filter(id => j[id] === undefined || j[id] === null).length;
  if (pending && !confirm(`${pending} réponse(s) pas encore corrigée(s) : elles compteront comme fausses. Continuer ?`)) return;
  try {
    if (index === list.length - 1) await update(path('meta'), { phase: 'results' });
    else { await publishExpected(index + 1); await set(path('correction/index'), index + 1); }
  } catch (e) { console.error(e); }
};

export async function enter(c) {
  const before = ctx && ctx.phase;
  ctx = c;
  if (running) { if (before !== c.phase) render(); return; }
  running = true;
  try {
    const snap = await get(path('questions'));
    const v = snap.val() || [];
    list = Array.isArray(v) ? v : Object.values(v);
    offs.push(onValue(path('players'), s => { players = s.val() || {}; render(); }));
    offs.push(onValue(path('verdicts'), s => { verdicts = s.val() || {}; render(); }));
    offs.push(onValue(path('correction/index'), s => {
      index = s.val();
      if (index === null && ctx && ctx.isHost && ctx.phase === 'correction') initCorrection();
      subscribeQuestion(index);
      render();
    }));
  } catch (e) { console.error(e); running = false; }
}

export function stop() {
  running = false; initing = false;
  offs.forEach(u => u()); offQ.forEach(u => u());
  offs = []; offQ = [];
  list = []; players = {}; verdicts = {}; answers = {}; expected = null; index = null; ctx = null;
}
