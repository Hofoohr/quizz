// Catégorie « Monstre pixelisé » : un monstre dont l'image, très pixelisée au début, se précise avec le temps.
// Le joueur tape le nom exact (autant d'essais qu'il veut) ; le plus rapide à trouver gagne le plus de points.

// Nom comparé sans majuscules, accents, espaces ni ponctuation : « Bwork Archer » = « bwork  archer ! ».
export const normaliser = s => String(s ?? '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
export const estBonNom = (nom, saisie) => { const n = normaliser(saisie); return n !== '' && n === normaliser(nom); };

// Réponse enregistrée : « ok@ms:essais » quand le monstre est trouvé (ms = temps écoulé depuis le début de la question), « no:essais » sinon.
export const lireTrouve = t => { const m = /^ok@(\d+)(?::\d+)?$/.exec(String(t ?? '')); return m ? +m[1] : null; };
// Nombre d'essais (sert seulement à s'amuser dans la correction) ; null si inconnu.
export const lireEssais = t => { const m = /^(?:ok@\d+:|no:)(\d+)$/.exec(String(t ?? '')); return m ? +m[1] : null; };

// Points : parmi ceux qui ont trouvé, le plus rapide gagne le plus. pts × (n − rang + 1) / n, n = nombre de joueurs ; ex æquo : même rang.
// Retourne { idJoueur: { trouve, ms, rang, points, essais } }.
export function classerParTemps(reponses, joueurs, pts) {
  const n = joueurs.length, rep = reponses || {}, out = {};
  joueurs.forEach(id => {
    const ms = lireTrouve(rep[id]);
    const essais = lireEssais(rep[id]);
    if (ms === null) { out[id] = { trouve: false, ms: null, rang: null, points: 0, essais }; return; }
    const rang = 1 + joueurs.filter(o => { const t = lireTrouve(rep[o]); return t !== null && t < ms; }).length;
    out[id] = { trouve: true, ms, rang, points: Math.round(pts * (n - rang + 1) / n * 10) / 10, essais };
  });
  return out;
}

// Définition de l'image (en blocs par côté) selon le temps écoulé : 4 au début, l'image entière (128) à 90 % de la durée de la question.
export const TAILLE_MAX = 128, TAILLE_MIN = 4;
export function blocs(ms, dureeMs) {
  return Math.min(TAILLE_MAX, Math.round(TAILLE_MIN * Math.pow(TAILLE_MAX / TAILLE_MIN, Math.max(0, ms) / (0.9 * dureeMs))));
}

// Dessine le sprite avec « g » blocs par côté (g >= 128 : image nette).
const mini = document.createElement('canvas');
export function dessinerPixel(canvas, img, g) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e2cc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!img.complete || !img.naturalWidth) return;
  if (g >= TAILLE_MAX) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return; }
  mini.width = mini.height = g;
  const m = mini.getContext('2d');
  m.clearRect(0, 0, g, g); m.imageSmoothingEnabled = true; m.drawImage(img, 0, 0, g, g);   // réduction : chaque bloc est la moyenne de sa zone
  ctx.imageSmoothingEnabled = false;                                                         // agrandissement sans lissage : de gros pixels carrés
  ctx.drawImage(mini, 0, 0, canvas.width, canvas.height);
}
