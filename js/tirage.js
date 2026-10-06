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
