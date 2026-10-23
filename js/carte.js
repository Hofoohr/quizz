// Questions « carte » : lecture des coordonnées saisies par les joueurs et calcul de la distance à la bonne carte.

// Lit des coordonnées écrites librement : « -35 -55 », « -35,-55 », « (-35 ; -55) », « [−35, −55] », « -35-55 »…
// Retourne [x, y], ou null si on ne trouve pas deux nombres.
export function lireCoord(texte) {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/[−–—]/g, '-')       // vrais signes moins typographiques -> « - »
                 .replace(/-\s+(?=\d)/g, '-');   // « 35 - 55 » est lu comme 35 et -55
  const m = t.match(/(-?\d+)[^\d-]*(-?\d+)/);
  return m ? [+m[1], +m[2]] : null;
}

// Distance en nombre de cartes à vol d'oiseau (distance euclidienne entre deux coordonnées), ou null si une lecture échoue.
export function distance(a, b) {
  const p = lireCoord(a), q = lireCoord(b);
  return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : null;
}

// Texte affiché sous la réponse d'un joueur dans la correction.
export function texteDistance(reponse, attendu) {
  if (reponse == null || reponse === '') return '';
  const d = distance(reponse, attendu);
  if (d === null) return 'Coordonnées illisibles';
  if (d === 0) return 'Coordonnées exactes';
  const n = Math.round(d * 10) / 10;
  return `Distance : ${String(n).replace('.', ',')} carte${n >= 2 ? 's' : ''}`;
}

// Questions « classement » (GeoGuessr) : les joueurs sont classés selon leur distance, du plus proche au plus loin.
// reponses = { idJoueur: réponse }, joueurs = liste des identifiants. Rang ex æquo = meilleur rang du groupe.
// Points = pts × (n − rang + 1) / n, n = nombre de joueurs ; pas de réponse lisible = 0 point.
// Retourne { idJoueur: { d (distance ou null), rang (ou null), points } }.
export function classement(reponses, attendu, joueurs, pts, champ = 0) {
  const n = joueurs.length;
  const dist = {};
  joueurs.forEach(id => {
    const r = reponses && reponses[id];
    dist[id] = distance(r && typeof r === 'object' ? r[champ] : r, attendu);
  });
  const out = {};
  joueurs.forEach(id => {
    if (dist[id] === null) { out[id] = { d: null, rang: null, points: 0 }; return; }
    const rang = 1 + joueurs.filter(o => dist[o] !== null && dist[o] < dist[id] - 1e-9).length;
    out[id] = { d: dist[id], rang, points: Math.round(pts * (n - rang + 1) / n * 10) / 10 };
  });
  return out;
}
