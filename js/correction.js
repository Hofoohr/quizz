import { db, ref, get, set, update, onValue } from "./firebase.js";
import { QUESTIONS } from "./questions.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

let running = false, initing = false, ctx = null;
let list = [], players = {}, index = null, answers = {}, expected = null, verdicts = {};
let offs = [], offQ = [];

// Intitulés des champs d'une question à plusieurs champs (null pour une question simple).
const fieldsOf = q => (q && q.champs ? Object.values(q.champs) : null);
// Verdict d'un joueur : vrai/faux, ou un verdict par champ. Retourne le nombre de champs justes, ou null s'il reste du travail.
const result = (q, v) => {
  const f = fieldsOf(q);
  if (!f) return v === true ? 1 : v === false ? 0 : null;
  const o = v && typeof v === 'object' ? v : {};
  return f.every((_, k) => o[k] === true || o[k] === false) ? f.filter((_, k) => o[k] === true).length : null;
};

const path = p => ref(db, `rooms/${ctx.code}/${p}`);

// Le chef publie la réponse attendue au moment où la correction atteint la question.
async function publishExpected(i) {
  const q = QUESTIONS.find(x => x.id === list[i].id);
  await set(path(`expected/${i}`), q ? q.a : '?');   // texte, ou un tableau de textes pour plusieurs champs
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
  const fields = fieldsOf(q);
  if (fields) {
    $('c-expected').innerHTML = fields.map((l, k) =>
      `<span class="exp-line">${esc(l)} : <b>${esc(expected && expected[k] != null ? expected[k] : '…')}</b></span>`).join('');
  } else $('c-expected').textContent = expected ?? '…';
  const v = verdicts[index] || {};
  $('c-list').innerHTML = order().map(id => {
    const a = answers[id];
    if (fields) {
      const mine = v[id] && typeof v[id] === 'object' ? v[id] : {};
      const got = result(q, v[id]);
      const subs = fields.map((label, k) => {
        const val = mine[k];
        const verdict = ctx.isHost
          ? `<button class="v${val === true ? ' on' : ''}" data-id="${id}" data-k="${k}" data-val="1">✅</button><button class="v${val === false ? ' on' : ''}" data-id="${id}" data-k="${k}" data-val="0">❌</button>`
          : `<span class="badge">${val === true ? '✅' : val === false ? '❌' : '…'}</span>`;
        const t = a && typeof a === 'object' && a[k] != null ? esc(a[k]) : '<i>(pas de réponse)</i>';
        return `<div class="sub ${val === true ? 'ok' : val === false ? 'ko' : ''}"><span class="lbl">${esc(label)}</span><span class="ans">${t}</span><span class="verdict">${verdict}</span></div>`;
      }).join('');
      return `<li class="row multi"><div class="who"><b>${esc(players[id].name)}</b>${id === ctx.uid ? ' <small>(toi)</small>' : ''}${got === null ? '' : `<span>${got} / ${fields.length}</span>`}</div>${subs}</li>`;
    }
    const val = v[id];
    const verdict = ctx.isHost
      ? `<button class="v${val === true ? ' on' : ''}" data-id="${id}" data-val="1">✅</button><button class="v${val === false ? ' on' : ''}" data-id="${id}" data-val="0">❌</button>`
      : `<span class="badge">${val === true ? '✅' : val === false ? '❌' : '…'}</span>`;
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
    list.forEach((q, j) => {
      const n = fieldsOf(q) ? fieldsOf(q).length : 1;
      score += q.pts * (result(q, (verdicts[j] || {})[id]) || 0) / n;   // plusieurs champs : points au prorata des champs justes
    });
    return { id, name: players[id].name, score: Math.round(score * 10) / 10 };
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
  const id = b.dataset.id, val = b.dataset.val === '1', k = b.dataset.k;
  const mine = (verdicts[index] || {})[id];
  const cur = k === undefined ? mine : (mine && typeof mine === 'object' ? mine[k] : undefined);
  const where = k === undefined ? `verdicts/${index}/${id}` : `verdicts/${index}/${id}/${k}`;
  set(path(where), cur === val ? null : val).catch(console.error);
});

$('c-prev').onclick = () => {
  if (index > 0) set(path('correction/index'), index - 1).catch(console.error);
};

$('c-next').onclick = async () => {
  const j = verdicts[index] || {};
  const pending = Object.keys(players).filter(id => result(list[index], j[id]) === null).length;
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
