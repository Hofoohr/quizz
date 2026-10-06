// Banque de questions. Chaque catégorie a son fichier dans js/questions/ :
// pour ajouter des questions, ajoute une ligne à la fin de la liste « items » du fichier voulu.
// Pour ajouter une catégorie, crée un nouveau fichier et importe-le ci-dessous.
// Ne change pas l'ordre des lignes existantes : l'identifiant d'une question en dépend.
// Banque publique : les réponses sont visibles par tous les visiteurs du site.
import items from "./questions/items.js";
import forgemagie from "./questions/forgemagie.js";
import monstres from "./questions/monstres.js";
import classes from "./questions/classes.js";
import lore from "./questions/lore.js";
import quetes from "./questions/quetes.js";
import carte from "./questions/carte.js";
import histoireDuJeu from "./questions/histoire-du-jeu.js";

const CATEGORIES = [items, forgemagie, monstres, classes, lore, quetes, carte, histoireDuJeu];

export const QUESTIONS = CATEGORIES.flatMap((c, ci) =>
  c.items.map(([q, a, pts, temps], i) => ({ id: `c${ci}q${i}`, type: "simple", cat: c.cat, q, a, pts, temps })));
