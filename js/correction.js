import { db, ref, get, set, update, onValue, runTransaction } from "./firebase.js";
import { QUESTIONS } from "./questions.js";
import { texteDistance, classement, lireCoord } from "./carte.js";
import { creerMonde } from "./monde.js";
import { classerParTemps } from "./devine.js";
import { creerScene, caseAViser, lireCase, classementRapide, infosScene, lireScene, PLAGE_VIE, COULEURS } from "./confusion.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

let running = false, initing = false, ctx = null;
let list = [], players = {}, index = null, answers = {}, expected = null, verdicts = {};
let offs = [], offQ = [];
let monde = null, mondeCle = '', sceneCle = '';
let allAnswers = {};   // réponses des questions « classement » (corrigées automatiquement), par numéro de question

// Question « classement » (GeoGuessr) : la bonne réponse vient de la banque locale, les points de la distance.
const bankOf = q => QUESTIONS.find(x => x.id === q.id) || {};
const isRank = q => !!(q && bankOf(q).classement);
const sceneOf = q => lireScene(q.scene, bankOf(q).scene);
const isClic = q => !!(q && sceneOf(q));
const isPixel = q => !!(q && bankOf(q).sprite);
const isAuto = q => isRank(q) || isClic(q) || isPixel(q);   // corrigées automatiquement, sans le chef
const rapideOf = j => classementRapide(allAnswers[j], sceneOf(list[j]), Object.keys(players), list[j].pts);
const pixelOf = j => classerParTemps(allAnswers[j], Object.keys(players), list[j].pts);
const pointsOf = (j, id) => isClic(list[j]) ? rapideOf(j)[id].points : isPixel(list[j]) ? pixelOf(j)[id].points : rankOf(j)[id].points;
const rankOf = j => { const q = list[j]; return classement(allAnswers[j], bankOf(q).a[bankOf(q).coord], Object.keys(players), q.pts); };

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
  const bank = QUESTIONS.find(x => x.id === q.id) || {};   // image et champ « coordonnées » d'une question « carte »
  $('c-img').hidden = !bank.img;
  if (bank.img) $('c-img').src = bank.img; else $('c-img').removeAttribute('src');
  const fields = fieldsOf(q);
  if (fields) {
    $('c-expected').innerHTML = fields.map((l, k) =>
      `<span class="exp-line">${esc(l)} : <b>${esc(expected && expected[k] != null ? expected[k] : '…')}</b></span>`).join('');
  } else $('c-expected').textContent = expected ?? '…';
  $('c-sprite').hidden = !isPixel(q);
  if (isPixel(q)) {
    const bk = bankOf(q), res = pixelOf(index);
    $('c-sprite').src = bk.sprite;
    $('c-scenebox').hidden = true; $('c-mapbox').hidden = true;
    document.body.classList.remove('large');
    $('c-expected').innerHTML = `<b>${esc(bk.nom)}</b>`;
    const ids = order().sort((a, b) => (res[a].rang ?? 1e9) - (res[b].rang ?? 1e9) || players[a].name.localeCompare(players[b].name));
    $('c-list').innerHTML = ids.map(id => {
      const r = res[id], medal = r.rang === null ? '❌' : ['🥇', '🥈', '🥉'][r.rang - 1] || r.rang + '.';
      const ess = r.essais === null ? '' : r.essais <= 1 ? ' du premier coup' : ` en ${r.essais} essais`;
      const t = r.ms === null ? (r.essais ? `n'a pas trouvé après ${r.essais} essai${r.essais > 1 ? 's' : ''}` : "n'a pas trouvé (aucun essai)") : `trouvé en ${String(Math.round(r.ms / 100) / 10).replace('.', ',')} s${ess}`;
      return `<li class="row rank ${r.trouve ? 'ok' : 'ko'}"><div class="who"><b>${medal} ${esc(players[id].name)}${id === ctx.uid ? ' <small>(toi)</small>' : ''}</b><span>+${String(r.points).replace('.', ',')} pt${r.points >= 2 ? 's' : ''}</span></div>
        <div class="ans">${r.trouve ? '⚡ ' : ''}${t}</div></li>`;
    }).join('');
    $('c-host').hidden = !ctx.isHost; $('c-wait').hidden = ctx.isHost;
    $('c-prev').disabled = index === 0;
    $('c-next').textContent = index === list.length - 1 ? 'Voir les résultats' : 'Question suivante →';
    return;
  }
  $('c-scenebox').hidden = !isClic(q);
  document.body.classList.toggle('large', isClic(q));
  if (isClic(q)) {
    const sc = sceneOf(q), res = rapideOf(index), v = caseAViser(sc), cl = COULEURS[sc.conf];
    $('c-mapbox').hidden = true;
    $('c-conf').innerHTML = infosScene(sc);
    $('c-expected').innerHTML = `<span class="exp-line">Vie ${sc.pv} % (${PLAGE_VIE[sc.conf]}) → rotation de ${esc(cl.angle)} autour de l'Enutrof</span>`;
    $('c-scenetxt').textContent = 'La case verte est la bonne case à cliquer : le sort y est dévié sur le Comte Harebourg (traits pointillés). Question de rapidité : le plus rapide gagne le plus de points.';
    const ids = order().sort((a, b) => (res[a].rang ?? 1e9) - (res[b].rang ?? 1e9) || players[a].name.localeCompare(players[b].name));
    const marques = [], vus = {};
    ids.forEach(id => {
      const c = lireCase(answers[id]);
      if (!c) return;
      const cle = c.join(','); const dec = (vus[cle] = (vus[cle] || 0) + 1) - 1;
      marques.push({ p: c, label: [...players[id].name][0].toUpperCase(), moi: id === ctx.uid, dec: dec * 14 });
    });
    const cle = index + JSON.stringify(marques);
    if (cle !== sceneCle) { sceneCle = cle; creerScene($('c-scene'), sc).dessiner({ solution: v, marques }); }
    $('c-list').innerHTML = ids.map(id => {
      const r = res[id], a = answers[id], c = lireCase(a);
      const medal = r.rang === null ? '❌' : ['🥇', '🥈', '🥉'][r.rang - 1] || r.rang + '.';
      const temps = r.ms === null ? '' : ` ⚡ ${String(Math.round(r.ms / 100) / 10).replace('.', ',')} s`;
      return `<li class="row rank ${r.juste ? 'ok' : 'ko'}"><div class="who"><b>${medal} ${esc(players[id].name)}${id === ctx.uid ? ' <small>(toi)</small>' : ''}</b><span>+${String(r.points).replace('.', ',')} pt${r.points >= 2 ? 's' : ''}</span></div>
        <div class="ans">${c ? `${r.juste ? 'Touché' : 'Raté'} : case ${c.join(', ')}${temps}` : '<i>(pas de réponse)</i>'}</div></li>`;
    }).join('');
    $('c-host').hidden = !ctx.isHost; $('c-wait').hidden = ctx.isHost;
    $('c-prev').disabled = index === 0;
    $('c-next').textContent = index === list.length - 1 ? 'Voir les résultats' : 'Question suivante →';
    return;
  }
  if (isRank(q)) {
    const bk = bankOf(q), res = rankOf(index), ids = Object.keys(res).sort((a, b) =>
      (res[a].rang ?? 1e9) - (res[b].rang ?? 1e9) || players[a].name.localeCompare(players[b].name));
    $('c-expected').innerHTML = `<span class="exp-line">${esc(fields[0])} : <b>${esc(bk.a[bk.coord])}</b></span>`;
    $('c-list').innerHTML = ids.map(id => {
      const r = res[id], a = (answers[id] && typeof answers[id] === 'object') ? answers[id][bk.coord] : answers[id];
      const pile = r.d === 0;
      const medal = r.rang === null ? '–' : ['🥇', '🥈', '🥉'][r.rang - 1] || r.rang + '.';
      return `<li class="row rank ${r.points > 0 ? 'ok' : 'ko'}${pile ? ' pile' : ''}"><div class="who"><b>${medal} ${esc(players[id].name)}${id === ctx.uid ? ' <small>(toi)</small>' : ''}</b><span>+${String(r.points).replace('.', ',')} pt${r.points >= 2 ? 's' : ''}</span></div>
        <div class="ans">${a ? esc(a) : '<i>(pas de réponse)</i>'}<small class="dist">${pile ? '🎯 Perfect !' : esc(texteDistance(a, bk.a[bk.coord]) || '')}</small></div></li>`;
    }).join('');
    $('c-mapbox').hidden = false;
    const piles = ids.filter(id => res[id].d === 0).map(id => players[id].name);
    $('c-pile').hidden = !piles.length;
    $('c-pile').textContent = '🎯 Perfect : ' + piles.join(', ');
    if (!monde) monde = creerMonde($('c-map'));
    const cible = lireCoord(bk.a[bk.coord]);
    const pins = ids.map(id => { const c = lireCoord(answers[id] && typeof answers[id] === 'object' ? answers[id][bk.coord] : answers[id]);
      return c && { x: c[0], y: c[1], cls: id === ctx.uid ? 'me' : 'other', label: players[id].name }; }).filter(Boolean);
    const cle = index + JSON.stringify(pins);
    if (cle !== mondeCle) {   // on ne redessine (et ne recadre) que si quelque chose a changé
      mondeCle = cle;
      const t = { x: cible[0], y: cible[1] };
      monde.invalider(); monde.afficher([...pins, { ...t, cls: 'target', label: '🎯' }], t); monde.cadrer([t, ...pins]);
    }
    $('c-host').hidden = !ctx.isHost; $('c-wait').hidden = ctx.isHost;
    $('c-prev').disabled = index === 0;
    $('c-next').textContent = index === list.length - 1 ? 'Voir les résultats' : 'Question suivante →';
    return;
  }
  $('c-mapbox').hidden = true;
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
        let t = a && typeof a === 'object' && a[k] != null ? esc(a[k]) : '<i>(pas de réponse)</i>';
        if (k === bank.coord && expected) {   // champ « coordonnées » : distance à la bonne carte
          const d = texteDistance(a && typeof a === 'object' ? a[k] : null, expected[k]);
          if (d) t += `<small class="dist">${esc(d)}</small>`;
        }
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

// Statistiques de réussite : à la fin de la partie, le chef ajoute pour chaque question « nombre de joueurs » et « nombre de réussites »
// dans stats/<clé de la question> (aucune donnée personnelle). Un joueur réussit quand tous les champs sont justes (voir stats.html).
let statsEnvoyees = false;
async function enregistrerStats() {
  if (statsEnvoyees || !ctx || !ctx.isHost || !list.length) return;
  statsEnvoyees = true;
  try {
    const verr = (await get(path('verdicts'))).val() || {};
    const ids = Object.keys(players);
    const lignes = await Promise.all(list.map(async (q, j) => {
      const bk = bankOf(q);
      if (!bk.cle) return null;
      let n = 0, ok = 0;
      if (isAuto(q)) {
        allAnswers[j] = (await get(path(`answers/${j}`))).val() || {};
        if (isRank(q)) { const r = rankOf(j); ids.forEach(id => { n++; ok += r[id].d === 0 ? 1 : 0; }); }   // GeoGuessr : réussi = pile sur la bonne carte
        else if (isClic(q)) { const r = rapideOf(j); ids.forEach(id => { n++; ok += r[id].juste ? 1 : 0; }); }
        else { const r = pixelOf(j); ids.forEach(id => { n++; ok += r[id].trouve ? 1 : 0; }); }
      } else {
        const nb = fieldsOf(q) ? fieldsOf(q).length : 1;
        ids.forEach(id => { const r = result(q, (verr[j] || {})[id]); if (r === null) return; n++; ok += r === nb ? 1 : 0; });   // pas de verdict du chef : non compté
      }
      return n ? { cle: bk.cle, n, ok } : null;
    }));
    // un seul enregistrement par partie (rooms/<code>/statsDone) : si le chef recharge la page, on ne compte pas deux fois
    const marque = await runTransaction(path('statsDone'), cur => (cur ? undefined : true));
    if (!marque.committed) return;
    await Promise.all(lignes.filter(Boolean).map(l => runTransaction(ref(db, `stats/${l.cle}`),
      cur => ({ n: ((cur && cur.n) || 0) + l.n, ok: ((cur && cur.ok) || 0) + l.ok }))));
  } catch (e) { console.warn('Statistiques non enregistrées :', e); }
}

function renderResults() {
  document.body.classList.remove('large');
  enregistrerStats();
  const max = list.reduce((s, q) => s + q.pts, 0);
  const rows = Object.keys(players).map(id => {
    let score = 0;
    list.forEach((q, j) => {
      if (isAuto(q)) { score += pointsOf(j, id); return; }
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
  const pending = isAuto(list[index]) ? 0 : Object.keys(players).filter(id => result(list[index], j[id]) === null).length;
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
    list.forEach((q, j) => { if (isAuto(q)) offs.push(onValue(path(`answers/${j}`), s => { allAnswers[j] = s.val() || {}; render(); })); });
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
  running = false; statsEnvoyees = false;
  document.body.classList.remove('large'); initing = false;
  offs.forEach(u => u()); offQ.forEach(u => u());
  offs = []; offQ = [];
  list = []; players = {}; verdicts = {}; allAnswers = {}; answers = {}; expected = null; index = null; ctx = null;
}
