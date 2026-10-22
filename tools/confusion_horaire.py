#!/usr/bin/env python3
"""Génère la catégorie « Confusion horaire » (mini-jeu) : js/questions/confusion.js + les deux personnages dans img/confusion/.

Usage : python3 tools/confusion_horaire.py
Chaque question est une scène sur une grille isométrique de 11 × 11 cases : une Enutrof, le Comte Harebourg et une couleur de confusion.
La confusion tourne la case visée autour du lanceur (rouge 90° horaire, bleue 180°, verte 270° horaire : voir js/confusion.js).
Le joueur doit cliquer la case qui, une fois tournée, tombe sur le Comte. La bonne case est recalculée par le site (js/confusion.js).
Images : le Comte Harebourg vient de DofusDB (api.dofusdb.fr/img/monsters/993.png). L'Enutrof est rendu par le moteur d'images d'Ankama
(static.ankama.com/dofus/renderer) à partir de son « look » DofusDB (breeds/3 : peau 30, tête 2044, couleurs de la classe).
Les illustrations appartiennent à Ankama.
"""
import json
import random
import io
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
N = 11                        # côté de la grille
PAR_COULEUR = 20              # scènes par couleur de confusion
PTS, TEMPS = 3, 30
COULEURS_ENUTROF = [13732958, 15851694, 3093806, 14325820, 7814953, 9995877]   # maleColors de la classe 3 (DofusDB)
LOOK_ENUTROF = "{1|30,2044|%s|120}" % ",".join(f"{i + 1}={v}" for i, v in enumerate(COULEURS_ENUTROF))
SOURCES = {"comte.png": "https://api.dofusdb.fr/img/monsters/993.png",
           "enutrof.png": f"https://static.ankama.com/dofus/renderer/look/{LOOK_ENUTROF.encode().hex()}/full/1/300_300-0.png"}
HAUTEUR = 200   # hauteur finale des personnages (px), après découpe des marges transparentes
ROT = {"rouge": 1, "bleue": 2, "verte": 3}


def tourner(d, k):
    dx, dy = d
    for _ in range(k % 4):
        dx, dy = -dy, dx
    return dx, dy


NB_ECRITURES = {"rouge": 5, "bleue": 4, "verte": 5}   # nombre d'écritures de chaque confusion dans js/confusion.js (AFFICHAGE) : une seule est affichée
PV = {"rouge": (76, 100), "bleue": (26, 74), "verte": (1, 24)}   # % de vie de l'Enutrof : rouge de 100 à 75 %, bleue de 75 à 25 %, verte de 25 à 0 %


def scene(rng, conf):
    while True:
        e = (rng.randrange(N), rng.randrange(N))
        c = (rng.randrange(N), rng.randrange(N))
        t = (c[0] - e[0], c[1] - e[1])
        if t == (0, 0) or max(abs(t[0]), abs(t[1])) > 6 or abs(t[0]) + abs(t[1]) < 2:
            continue
        dx, dy = tourner(t, 4 - ROT[conf])
        v = (e[0] + dx, e[1] + dy)
        if 0 <= v[0] < N and 0 <= v[1] < N and v not in (e, c):
            return {"n": N, "e": list(e), "c": list(c), "conf": conf, "pv": rng.randint(*PV[conf]), "aff": rng.randrange(NB_ECRITURES[conf])}


def main():
    (ROOT / "img" / "confusion").mkdir(parents=True, exist_ok=True)
    for nom, url in SOURCES.items():
        with urllib.request.urlopen(url, timeout=60) as r:
            im = Image.open(io.BytesIO(r.read())).convert("RGBA")
        im = im.crop(im.getbbox())                       # on enlève les marges transparentes
        im = im.resize((round(im.width * HAUTEUR / im.height), HAUTEUR), Image.LANCZOS)
        im.save(ROOT / "img" / "confusion" / nom, optimize=True)
    rng = random.Random(2026)
    vues, scenes = set(), []
    for conf in ROT:
        n = 0
        while n < PAR_COULEUR:
            s = scene(rng, conf)
            cle = (tuple(s["e"]), tuple(s["c"]), conf)
            if cle not in vues:
                vues.add(cle); scenes.append(s); n += 1
    rng.shuffle(scenes)   # les couleurs sont mélangées
    items = [{"q": "Confusion horaire : clique sur la case à viser pour toucher le Comte Harebourg !",
              "scene": s, "pts": PTS, "temps": TEMPS} for s in scenes]
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/confusion.js").write_text(
        "// Fichier généré par tools/confusion_horaire.py : ne pas modifier à la main (relancer le script).\n"
        "// Mini-jeu : le joueur clique la case à viser pour toucher le Comte Harebourg malgré sa confusion horaire (voir js/confusion.js).\n"
        'export default {\n  cat: "Confusion horaire",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "scènes écrites")


if __name__ == "__main__":
    main()
