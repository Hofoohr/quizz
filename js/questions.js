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

const CATEGORIES = [quetes, quetesDofus, sorts, panoplies, dofus, legendaires, succesDonjons, donjons, metiers, cartes, geoguessr];

export const QUESTIONS = CATEGORIES.flatMap((c, ci) =>
  c.items.map((it, i) => {
    const id = `c${ci}q${i}`;
    if (Array.isArray(it)) { const [q, a, pts, temps, groupe] = it; return { id, type: "simple", cat: c.cat, q, a, pts, temps, groupe }; }
    return { id, type: "multi", cat: c.cat, q: it.q, champs: it.champs.map(f => f[0]), a: it.champs.map(f => f[1]), pts: it.pts, temps: it.temps, img: it.img, coord: it.coord, classement: it.classement };
  }));
