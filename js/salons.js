// Liste des salons ouverts sur l'écran d'accueil : un salon créé « visible » est inscrit dans publicRooms/code.
// Le chef l'inscrit à la création (et au retour dans la salle d'attente) et le retire dès que la partie commence ou qu'il part.
import { db, ref, set, remove, onValue, onDisconnect, serverNow, serverTimestamp } from "./firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const MAX_AGE_MS = 6 * 3600 * 1000;   // une inscription plus vieille est ignorée (chef parti sans la retirer)

// --- côté chef ---
export async function publish(code, hostName) {
  const r = ref(db, `publicRooms/${code}`);
  await set(r, { host: String(hostName).slice(0, 20), at: serverTimestamp() });
  onDisconnect(r).remove();   // le chef ferme son onglet dans la salle d'attente : le salon disparaît de la liste
}
export async function unpublish(code) {
  const r = ref(db, `publicRooms/${code}`);
  try { onDisconnect(r).cancel(); await remove(r); } catch (e) { console.warn(e); }
}

// --- côté joueurs : liste affichée à l'accueil ---
let entries = {}, details = {}, offs = {};   // details[code] = { meta, players }
function render() {
  const rows = Object.entries(entries).map(([code, e]) => ({ code, e, d: details[code] }))
    .filter(({ e, d }) => d && d.meta && d.meta.phase === 'lobby' && Object.keys(d.players || {}).length < d.max && (serverNow() - (e.at || 0)) < MAX_AGE_MS)
    .sort((a, b) => b.e.at - a.e.at);
  $('open-rooms').hidden = !rows.length;
  $('open-list').innerHTML = rows.map(({ code, e, d }) =>
    `<li><span>🎮 <b>${esc(e.host)}</b> <small>${Object.keys(d.players || {}).length} / ${d.max} joueur${Object.keys(d.players || {}).length > 1 ? 's' : ''}</small></span><button class="btn join-open" data-code="${esc(code)}">Rejoindre</button></li>`).join('');
}
// onJoin(code) : appelé quand on clique sur « Rejoindre » ; max : nombre maximal de joueurs d'un salon.
export function startList(onJoin, max) {
  $('open-list').addEventListener('click', e => { const b = e.target.closest('.join-open'); if (b) onJoin(b.dataset.code); });
  onValue(ref(db, 'publicRooms'), s => {
    entries = s.val() || {};
    Object.keys(offs).forEach(c => { if (!entries[c]) { offs[c].forEach(u => u()); delete offs[c]; delete details[c]; } });
    Object.keys(entries).forEach(c => {
      if (offs[c]) return;
      details[c] = { meta: null, players: {}, max };
      offs[c] = [
        onValue(ref(db, `rooms/${c}/meta`), m => { if (!details[c]) return; details[c].meta = m.val(); render(); }),
        onValue(ref(db, `rooms/${c}/players`), p => { if (!details[c]) return; details[c].players = p.val() || {}; render(); }),
      ];
    });
    render();
  });
  setInterval(render, 30000);   // les inscriptions trop vieilles disparaissent
}
