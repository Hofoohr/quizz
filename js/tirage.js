// Tirage des questions d'une partie.
// Chaque question pèse 1, sauf celles qui ont un « groupe » (ex. : le Dofus d'une question de quêtes) :
// dans une même catégorie, tous les groupes ont autant de chances d'être tirés, quelle que soit leur taille.
// La masse totale de la catégorie ne change pas : elle est seulement répartie à parts égales entre les groupes.
// Retourne les questions dans un ordre aléatoire pondéré : on prend les n premières.
export function melange(questions) {
  const stats = {};   // catégorie -> { total, tailles: { groupe: nombre de questions } }
  for (const q of questions) {
    if (!q.groupe) continue;
    const s = stats[q.cat] ??= { total: 0, tailles: {} };
    s.total++;
    s.tailles[q.groupe] = (s.tailles[q.groupe] || 0) + 1;
  }
  const poids = q => {
    if (!q.groupe) return 1;
    const s = stats[q.cat];
    return s.total / (Object.keys(s.tailles).length * s.tailles[q.groupe]);
  };
  // Tirage pondéré sans remise (Efraimidis–Spirakis) : on trie par u^(1/poids) décroissant.
  return questions
    .map(q => ({ q, k: Math.random() ** (1 / poids(q)) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.q);
}

// Répartition des questions entre les catégories pour une partie de 180 questions (la somme des poids).
// Pour une partie de n questions, la catégorie c reçoit n × poids(c) / somme des poids questions : à 180 on retrouve exactement ces nombres,
// à 20 on a par exemple 20 × 5 / 180 = 0,6 question d'« Items ». Les décimales sont arrondies AU HASARD : une catégorie à 0,7
// a 70 % de chances d'avoir 1 question, sinon 0 (la partie compte toujours n questions au total).
// Une catégorie absente de cette liste prend le poids POIDS_PAR_DEFAUT.
export const POIDS = {
  'Sort de classe': 5, 'Panoplie': 20, 'Items': 5, 'Légendaire': 10, 'Succès': 20,
  'Quêtes': 20, 'Donjons': 20, 'Métiers': 20, 'Cartes': 20, 'GeoGuessr (no move)': 20, 'Confusion horaire': 10, 'Monstre pixelisé': 10,
};
export const POIDS_PAR_DEFAUT = 10;

// Nombre de questions par catégorie. « cats » : [{ nom, poids, dispo }] (dispo = questions disponibles dans la catégorie).
// Si une catégorie n'a pas assez de questions pour sa part, elle donne tout ce qu'elle a et le reste est redistribué aux autres.
export function repartition(n, cats) {
  const res = {};
  let reste = n, actifs = cats.filter(c => c.dispo > 0);
  while (reste > 0 && actifs.length) {
    const total = actifs.reduce((s, c) => s + c.poids, 0);
    const quota = actifs.map(c => reste * c.poids / total);
    const pleines = actifs.filter((c, i) => quota[i] >= c.dispo);
    if (pleines.length) {   // catégorie trop petite : on la vide, puis on recalcule pour les autres
      pleines.forEach(c => { res[c.nom] = c.dispo; reste -= c.dispo; });
      actifs = actifs.filter(c => !pleines.includes(c));
      continue;
    }
    actifs.forEach((c, i) => { res[c.nom] = Math.floor(quota[i]); });
    // Les questions restantes sont attribuées au hasard : chaque catégorie en reçoit une avec une probabilité égale à la partie décimale
    // de son quota, et il y en a toujours exactement « extra » en tout (tirage systématique : un point au hasard, puis un point par unité).
    const extra = reste - actifs.reduce((s, c) => s + res[c.nom], 0);
    const cand = actifs.map((c, i) => ({ c, f: quota[i] - Math.floor(quota[i]) }));
    const somme = cand.reduce((s, x) => s + x.f, 0);
    if (extra > 0 && somme > 0) {
      cand.forEach(x => { x.f *= extra / somme; });   // corrige les erreurs d'arrondi : la somme vaut exactement « extra »
      for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
      const u = Math.random();
      let cumul = 0;
      for (const x of cand) {
        const avant = Math.floor(cumul - u); cumul += x.f;
        if (Math.floor(cumul - u) > avant) res[x.c.nom]++;
      }
    }
    reste = 0;
  }
  return res;
}

// Compose la partie : n questions réparties entre les catégories des questions données, dans un ordre aléatoire.
export function composer(questions, n, poids = POIDS) {
  const parCat = {};
  for (const q of questions) (parCat[q.cat] ??= []).push(q);
  const cats = Object.entries(parCat).map(([nom, l]) => ({ nom, poids: poids[nom] ?? POIDS_PAR_DEFAUT, dispo: l.length }));
  const nb = repartition(n, cats);
  const deck = Object.entries(nb).flatMap(([nom, k]) => melange(parCat[nom]).slice(0, k));   // tirage équilibré entre les groupes (ex. : les Dofus)
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
