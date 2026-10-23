// Page « Statistiques » : taux de réussite de chaque question, d'après stats/<clé> (voir enregistrerStats dans js/correction.js).
import { db, ref, onValue, signIn } from "./firebase.js";
import { QUESTIONS } from "./questions.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const PAR_PAGE = 100;
let stats = {}, affiches = PAR_PAGE;

// Texte affiché pour une question de la banque.
function libelle(q) {
  if (q.type === 'pixel') return `Monstre pixelisé : ${q.nom}`;
  if (q.type === 'clic') return `Confusion horaire (vie ${q.scene.pv} %, ${q.scene.conf === 'rouge' ? '90°' : q.scene.conf === 'bleue' ? '180°' : '270°'}) : Comte en ${q.scene.c.join(', ')}`;
  if (q.champs && q.classement) return `GeoGuessr : carte en ${q.a[0]}`;
  if (q.champs && q.img) return `${q.q} → ${q.a[q.a.length - 1]}`;
  return q.q;
}
const lignes = QUESTIONS.map(q => ({ cat: q.cat, texte: libelle(q), cle: q.cle }));

$('s-cat').innerHTML += [...new Set(QUESTIONS.map(q => q.cat))].map(c => `<option>${esc(c)}</option>`).join('');
const pct = (ok, n) => n ? Math.round(ok / n * 100) : null;

function render() {
  const cat = $('s-cat').value, mot = $('s-q').value.trim().toLowerCase(), min = +$('s-min').value, tri = $('s-tri').value;
  // résumé par catégorie
  const parCat = {};
  lignes.forEach(l => { const s = stats[l.cle]; if (!s) return; const c = parCat[l.cat] = parCat[l.cat] || { n: 0, ok: 0, q: 0 }; c.n += s.n; c.ok += s.ok; c.q++; });
  $('s-cats').innerHTML = Object.keys(parCat).length
    ? `<div class="s-resume">${Object.entries(parCat).sort((a, b) => a[0].localeCompare(b[0])).map(([c, v]) =>
        `<div><b>${esc(c)}</b><span>${pct(v.ok, v.n)} %</span><small>${v.n} réponse${v.n > 1 ? 's' : ''} · ${v.q} question${v.q > 1 ? 's' : ''}</small></div>`).join('')}</div>` : '';
  let rows = lignes.map(l => ({ ...l, n: (stats[l.cle] || {}).n || 0, ok: (stats[l.cle] || {}).ok || 0 }))
    .filter(r => (!cat || r.cat === cat) && (!mot || r.texte.toLowerCase().includes(mot)) && r.n >= Math.max(min, 0) && (min > 0 ? r.n > 0 : true));
  rows.sort((a, b) => tri === 'nb' ? b.n - a.n : tri === 'facile' ? (pct(b.ok, b.n) ?? -1) - (pct(a.ok, a.n) ?? -1) || b.n - a.n : (pct(a.ok, a.n) ?? 101) - (pct(b.ok, b.n) ?? 101) || b.n - a.n);
  $('s-etat').textContent = rows.length ? `${rows.length} question${rows.length > 1 ? 's' : ''}` : (Object.keys(stats).length ? 'Aucune question ne correspond.' : "Pas encore de statistiques : elles apparaissent après la fin d'une partie.");
  $('s-table').querySelector('tbody').innerHTML = rows.slice(0, affiches).map(r => {
    const p = pct(r.ok, r.n);
    return `<tr><td>${esc(r.cat)}</td><td>${esc(r.texte)}</td><td>${r.n}</td><td>${p === null ? '–' : `<span class="barre"><i style="width:${p}%"></i></span> ${p} % <small>(${r.ok}/${r.n})</small>`}</td></tr>`;
  }).join('');
  $('s-plus').hidden = rows.length <= affiches;
}

['s-cat', 's-min', 's-tri'].forEach(id => { $(id).onchange = () => { affiches = PAR_PAGE; render(); }; });
$('s-q').oninput = () => { affiches = PAR_PAGE; render(); };
$('s-plus').onclick = () => { affiches += PAR_PAGE; render(); };

signIn().then(() => onValue(ref(db, 'stats'), s => { stats = s.val() || {}; render(); }, e => { console.error(e); $('s-etat').textContent = 'Impossible de lire les statistiques.'; }))
  .catch(e => { console.error(e); $('s-etat').textContent = 'Connexion à Firebase impossible.'; });
render();
