#!/usr/bin/env python3
"""Génère la catégorie « Confusion horaire » (mini-jeu) : js/questions/confusion.js + les deux personnages dans img/confusion/.

Usage : python3 tools/confusion_horaire.py
Chaque question est une scène sur une grille isométrique de 11 × 11 cases : une Enutrof, le Comte Harebourg et une couleur de confusion.
La confusion tourne la case visée autour du lanceur (rouge 90° horaire, bleue 180°, verte 270° horaire : voir js/confusion.js).
Le joueur doit cliquer la case qui, une fois tournée, tombe sur le Comte. La bonne case est recalculée par le site (js/confusion.js).
Images : le Comte Harebourg vient de DofusDB (api.dofusdb.fr/img/monsters/993.png), l'Enutrof est le symbole de la classe (breeds/symbol_3.png).
Les illustrations appartiennent à Ankama.
"""
import json
import random
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
N = 11                        # côté de la grille
PAR_COULEUR = 20              # scènes par couleur de confusion
PTS, TEMPS = 3, 30
SOURCES = {"comte.png": "https://api.dofusdb.fr/img/monsters/993.png", "enutrof.png": "https://api.dofusdb.fr/img/breeds/symbol_3.png"}
ROT = {"rouge": 1, "bleue": 2, "verte": 3}


def tourner(d, k):
    dx, dy = d
    for _ in range(k % 4):
        dx, dy = -dy, dx
    return dx, dy


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
            return {"n": N, "e": list(e), "c": list(c), "conf": conf}


def main():
    (ROOT / "img" / "confusion").mkdir(parents=True, exist_ok=True)
    for nom, url in SOURCES.items():
        with urllib.request.urlopen(url, timeout=60) as r:
            (ROOT / "img" / "confusion" / nom).write_bytes(r.read())
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
    items = [{"q": f"Confusion horaire {s['conf']} : clique sur la case à viser pour toucher le Comte Harebourg !",
              "scene": s, "pts": PTS, "temps": TEMPS} for s in scenes]
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/confusion.js").write_text(
        "// Fichier généré par tools/confusion_horaire.py : ne pas modifier à la main (relancer le script).\n"
        "// Mini-jeu : le joueur clique la case à viser pour toucher le Comte Harebourg malgré sa confusion horaire (voir js/confusion.js).\n"
        'export default {\n  cat: "Confusion horaire",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "scènes écrites")


if __name__ == "__main__":
    main()
