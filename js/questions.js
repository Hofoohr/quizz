// Banque de questions. Chaque catégorie a son fichier dans js/questions/ :
// pour ajouter des questions, ajoute une ligne à la fin de la liste « items » du fichier voulu.
// Pour ajouter une catégorie, crée un nouveau fichier et importe-le ci-dessous.
// Question simple :  ["Question ?", "Réponse", points, secondes]
// Un 5e élément facultatif, « groupe », équilibre le tirage : tous les groupes d'une catégorie ont autant de chances (voir js/tirage.js).
// Question à plusieurs champs :
//   { q: "Question ?", champs: [["Intitulé du champ 1", "Réponse 1"], ["Intitulé du champ 2", "Réponse 2"]], pts: 3, temps: 40 }
// Question « carte » : un champ « img » (chemin de l'image, affichée au joueur) et « coord » (numéro du champ qui contient les coordonnées :
//   la correction affiche alors la distance entre la réponse de chaque joueur et les vraies coordonnées).
// « classement: true » : pas de correction par le chef ; les joueurs sont classés selon la distance de leur réponse (champ « coord »), voir js/carte.js.
// « scene » : mini-jeu « Confusion horaire » (js/confusion.js) : le joueur clique une case de la grille, corrigée automatiquement.
// « sprite » + « nom » : « Monstre pixelisé » (js/devine.js) : image qui se précise, le joueur tape le nom exact, corrigé automatiquement.
// Ne change pas l'ordre des lignes existantes : l'identifiant d'une question en dépend.
// Banque publique : les réponses sont visibles par tous les visiteurs du site.
import quetes from "./questions/quetes.js";
import quetesDofus from "./questions/quetes-dofus.js";
import sorts from "./questions/sorts.js";
import panoplies from "./questions/panoplies.js";
import dofus from "./questions/dofus.js";
import legendaires from "./questions/legendaires.js";
import succesDonjons from "./questions/succes-donjons.js";
import donjons from "./questions/donjons.js";
import metiers from "./questions/metiers.js";
import cartes from "./questions/cartes.js";
import geoguessr from "./questions/geoguessr.js";
import confusion from "./questions/confusion.js";
import monstresPixel from "./questions/monstres-pixel.js";
import { caseAViser } from "./confusion.js";

const CATEGORIES = [quetes, quetesDofus, sorts, panoplies, dofus, legendaires, succesDonjons, donjons, metiers, cartes, geoguessr, confusion, monstresPixel];

// Clé stable d'une question pour les statistiques (ne dépend pas de la place de la question dans la banque) : empreinte de son contenu.
const empreinte = s => {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
};

export const QUESTIONS = CATEGORIES.flatMap((c, ci) =>
  c.items.map((it, i) => {
    const id = `c${ci}q${i}`;
    let o;
    if (Array.isArray(it)) { const [q, a, pts, temps, groupe] = it; o = { id, type: "simple", cat: c.cat, q, a, pts, temps, groupe }; }
    else if (it.sprite) o = { id, type: "pixel", cat: c.cat, q: it.q, a: it.nom, nom: it.nom, sprite: it.sprite, pts: it.pts, temps: it.temps };
    else if (it.scene) o = { id, type: "clic", cat: c.cat, q: it.q, a: caseAViser(it.scene).join(","), pts: it.pts, temps: it.temps, scene: it.scene };
    else o = { id, type: "multi", cat: c.cat, q: it.q, champs: it.champs.map(f => f[0]), a: it.champs.map(f => f[1]), pts: it.pts, temps: it.temps, img: it.img, coord: it.coord, classement: it.classement };
    o.cle = empreinte([c.cat, o.q, [].concat(o.a).join('|'), o.img || o.sprite || (o.scene ? JSON.stringify(o.scene) : '')].join('#'));   // identifiant stable pour les statistiques
    return o;
  }));
