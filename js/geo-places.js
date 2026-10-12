// Lieux du GeoGuessr Dofus.
// x / y = position de la bonne réponse sur la carte (en % de la largeur / hauteur de img/world.svg).
// img  = capture d'écran du lieu (ex. "img/geo/astrub-cimetiere.jpg"). Sans image, l'indice "clue" est affiché à la place.
// Pour utiliser la vraie carte du monde de Dofus : remplace img/world.svg (garde le format 4/3) et ajuste x / y.
export const PLACES = [
  { id: "g01", name: "Cimetière d'Astrub",     x: 57, y: 36, img: null, clue: "Un cimetière peuplé de Chafers et de Squelettes, tout près d'une grande ville de départ." },
  { id: "g02", name: "Forêt d'Amakna",          x: 36, y: 44, img: null, clue: "De grands arbres, des Bouftous et des Pious à perte de vue." },
  { id: "g03", name: "Village d'Amakna",        x: 33, y: 52, img: null, clue: "Le village central du monde des Douze, avec sa place et son château voisin." },
  { id: "g04", name: "Plaine des Porkass",      x: 40, y: 58, img: null, clue: "Une vaste prairie où les Porkass et les Tofus sont rois." },
  { id: "g05", name: "Temple d'Incarnam",       x: 18, y: 22, img: null, clue: "L'île où l'on débute son aventure, loin du continent." },
  { id: "g06", name: "Cité de Bonta",           x: 66, y: 57, img: null, clue: "Une grande cité bleue, patrie des défenseurs de la lumière." },
  { id: "g07", name: "Cité de Brâkmar",         x: 75, y: 73, img: null, clue: "Une cité sombre, fière de ses assassins et de sa haine de Bonta." },
  { id: "g08", name: "Village de Frigost",      x: 80, y: 20, img: null, clue: "Un village gelé, base des aventuriers qui affrontent Père Fouettard." },
  { id: "g09", name: "Île de Pandala",          x: 15, y: 70, img: null, clue: "Une île luxuriante peuplée de pandawas et de bambous." },
  { id: "g10", name: "Port de Sufokia",         x: 41, y: 82, img: null, clue: "Une cité sous-marine du sud, célèbre pour ses sufokiens." },
  { id: "g11", name: "Île de Moon",             x: 90, y: 50, img: null, clue: "Une île isolée à l'est, couverte de jungle et de plages." },
  { id: "g12", name: "Mont Cania",              x: 30, y: 16, img: null, clue: "Un plateau rocheux et sauvage, repaire de Craqueleurs." }
];
