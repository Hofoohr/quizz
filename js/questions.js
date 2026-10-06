// Banque de questions. Chaque catégorie a son fichier dans js/questions/ :
// pour ajouter des questions, ajoute une ligne à la fin de la liste « items » du fichier voulu.
// Pour ajouter une catégorie, crée un nouveau fichier et importe-le ci-dessous.
// Ne change pas l'ordre des lignes existantes : l'identifiant d'une question en dépend.
// Banque publique : les réponses sont visibles par tous les visiteurs du site.
import geographie from "./questions/geographie.js";
import histoire from "./questions/histoire.js";
import sciences from "./questions/sciences.js";
import sport from "./questions/sport.js";
import jeuxVideo from "./questions/jeux-video.js";
import artsLitterature from "./questions/arts-litterature.js";
import cinema from "./questions/cinema.js";
import musique from "./questions/musique.js";
import animaux from "./questions/animaux.js";
import gastronomie from "./questions/gastronomie.js";

const CATEGORIES = [geographie, histoire, sciences, sport, jeuxVideo, artsLitterature, cinema, musique, animaux, gastronomie];

export const QUESTIONS = CATEGORIES.flatMap((c, ci) =>
  c.items.map(([q, a, pts, temps], i) => ({ id: `c${ci}q${i}`, type: "simple", cat: c.cat, q, a, pts, temps })));
