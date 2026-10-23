#!/usr/bin/env python3
"""Génère la catégorie « Confusion horaire » (mini-jeu) : js/questions/confusion.js + les deux personnages dans img/confusion/.

Usage : python3 tools/confusion_horaire.py
Chaque question est une scène sur une grille isométrique de 15 × 15 cases : une Enutrof, le Comte Harebourg (sans limite de distance) et un % de vie.
Le % de vie donne la confusion, qui tourne la case visée autour du lanceur (100 à 75 % : 90° horaire, 75 à 25 % : 180°, 25 à 0 % : 270° horaire : voir js/confusion.js).
L'Enutrof est dans le carré central de 9 × 9 cases de la grille ; la case du Comte et la vie sont tirées au hasard ; la confusion doit rester possible (la case à cliquer est dans la grille).
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
N = 15                        # côté de la grille
NB_SCENES = 200
CENTRE_MIN, CENTRE_MAX = (N - 9) // 2, (N - 9) // 2 + 8   # carré central de 9 × 9 : cases 3 à 11
PTS, TEMPS = 6, 11   # question de rapidité : 3 s d'annonce + 8 s pour répondre ; le plus rapide gagne le plus de points (6 pour le 1er)
COULEURS_ENUTROF = [13732958, 15851694, 3093806, 14325820, 7814953, 9995877]   # maleColors de la classe 3 (DofusDB)
LOOK_ENUTROF = "{1|30,2044|%s|120}" % ",".join(f"{i + 1}={v}" for i, v in enumerate(COULEURS_ENUTROF))
SOURCES = {"comte.png": "https://api.dofusdb.fr/img/monsters/993.png",
           "enutrof.png": f"https://static.ankama.com/dofus/renderer/look/{LOOK_ENUTROF.encode().hex()}/full/1/300_300-0.png"}
HAUTEUR = 200   # hauteur finale des personnages (px), après découpe des marges transparentes
ROT = {"rouge": 1, "bleue": 2, "verte": 3}   # noms internes des 3 rotations (aucune couleur n'est affichée aux joueurs)


def tourner(d, k):
    dx, dy = d
    for _ in range(k % 4):
        dx, dy = -dy, dx
    return dx, dy


NB_ECRITURES = {"rouge": 5, "bleue": 4, "verte": 5}   # nombre d'écritures de chaque confusion dans js/confusion.js (AFFICHAGE) : une seule est affichée
def conf_pour(pv):   # 100 à 75 % de vie : 90° ; 75 à 25 % : 180° ; 25 à 0 % : 270°
    return "rouge" if pv > 75 else "bleue" if pv > 25 else "verte"


def scene(rng):
    while True:
        pv = rng.randint(1, 100)
        if pv in (25, 75):          # les limites des tranches sont ambiguës : on les évite
            continue
        conf = conf_pour(pv)
        e = (rng.randint(CENTRE_MIN, CENTRE_MAX), rng.randint(CENTRE_MIN, CENTRE_MAX))   # l'Enutrof est dans le carré central de 9 × 9 cases
        c = (rng.randrange(N), rng.randrange(N))
        t = (c[0] - e[0], c[1] - e[1])
        if t == (0, 0):
            continue
        dx, dy = tourner(t, 4 - ROT[conf])
        v = (e[0] + dx, e[1] + dy)
        if 0 <= v[0] < N and 0 <= v[1] < N:     # la confusion doit être possible : la case à cliquer est dans la grille
            return {"n": N, "e": list(e), "c": list(c), "conf": conf, "pv": pv, "aff": rng.randrange(NB_ECRITURES[conf])}


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
    while len(scenes) < NB_SCENES:
        s = scene(rng)
        cle = (tuple(s["e"]), tuple(s["c"]), s["pv"])
        if cle not in vues:
            vues.add(cle); scenes.append(s)
    items = [{"q": "Prends en compte la confusion horaire pour toucher le Comte Harebourg",
              "scene": s, "pts": PTS, "temps": TEMPS} for s in scenes]
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/confusion.js").write_text(
        "// Fichier généré par tools/confusion_horaire.py : ne pas modifier à la main (relancer le script).\n"
        "// Mini-jeu : le joueur clique la case à viser pour toucher le Comte Harebourg malgré sa confusion horaire (voir js/confusion.js).\n"
        'export default {\n  cat: "Confusion horaire",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "scènes écrites")


if __name__ == "__main__":
    main()
