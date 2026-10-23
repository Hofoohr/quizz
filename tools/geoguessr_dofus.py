#!/usr/bin/env python3
"""Génère la catégorie « GeoGuessr (no move) » : une carte tirée au hasard, le joueur devine ses coordonnées.

Usage : python3 tools/geoguessr_dofus.py            (reprend là où il s'est arrêté ; plusieurs lancements possibles)
Écrit : js/questions/geoguessr.js  et  img/geo/*.jpg

Les cartes sont tirées au hasard (graine fixe : le tirage est reproductible) parmi toutes les cartes du monde principal,
sauf celles déjà posées dans la catégorie « Cartes ». On écarte les images inexploitables : trop sombres, uniformes
(océan, vide) ou avec trop de noir. Même traitement d'image que « Cartes » (voir tools/cartes_dofus.py) : filigrane rogné, 640 px.
Un lancement est limité à BUDGET secondes (téléchargements lents) ; on relance jusqu'à obtenir NOMBRE cartes.
"""
import json
import os
import random
import sys
import time
from pathlib import Path

from PIL import Image, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cartes_dofus as c

ROOT = c.ROOT
DOSSIER = ROOT / "img" / "geo"
REJETS = ROOT / "tools" / "cartes" / "geo-rejets.json"   # cartes écartées par le filtre qualité (pour ne pas les retélécharger)
NOMBRE = 250           # cartes à garder
GRAINE = 2026          # graine du tirage au hasard
BUDGET = float(os.environ.get("BUDGET", 540))   # secondes par lancement
PTS, TEMPS = 5, 45     # 45 secondes ; 5 points pour le 1er du classement (voir js/carte.js)
SEL = "geo"


def exploitable(im):
    """Écarte les cartes trop sombres, trop uniformes (océan, vide) ou avec trop de noir."""
    gris = im.convert("L")
    st = ImageStat.Stat(gris)
    noirs = sum(1 for p in gris.get_flattened_data() if p < 22) / (gris.width * gris.height)
    return st.mean[0] >= 70 and st.stddev[0] >= 32 and noirs <= 0.05


def candidates():
    """Une carte par coordonnée (celle de la carte du monde), hors cartes déjà dans « Cartes », dans un ordre aléatoire fixe."""
    par_coord = c.cartes_du_monde()
    out = []
    for (x, y), v in sorted(par_coord.items()):
        m = c.choisir(v)
        if m and not (c.IMG_DIR / c.nom_image(m["id"])).exists():
            out.append((x, y, m["id"]))
    random.Random(GRAINE).shuffle(out)
    return out


def main():
    t0 = time.time()
    DOSSIER.mkdir(parents=True, exist_ok=True)
    rejets = set(json.loads(REJETS.read_text())) if REJETS.exists() else set()
    cands = candidates()
    gardees = [x for x in cands if (DOSSIER / c.nom_image(x[2], SEL)).exists()]
    for x, y, mid in cands:
        if len(gardees) >= NOMBRE or time.time() - t0 > BUDGET:
            break
        if mid in rejets or (DOSSIER / c.nom_image(mid, SEL)).exists():
            continue
        im = c.telecharger_carte(mid)
        if exploitable(im):
            c.enregistrer(im, DOSSIER / c.nom_image(mid, SEL))
            gardees.append((x, y, mid))
        else:
            rejets.add(mid)
    REJETS.write_text(json.dumps(sorted(rejets)))
    gardees = [x for x in cands if (DOSSIER / c.nom_image(x[2], SEL)).exists()][:NOMBRE]   # ordre du tirage, stable
    items = [{"q": "GeoGuessr : où se trouve cette carte ? (le plus proche gagne les points)", "champs": [["Coordonnées (x, y)", f"{x}, {y}"]],
              "pts": PTS, "temps": TEMPS, "img": f"img/geo/{c.nom_image(mid, SEL)}", "coord": 0, "classement": True}
             for x, y, mid in gardees]
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/geoguessr.js").write_text(
        "// Fichier généré par tools/geoguessr_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une carte au hasard : les joueurs ont 45 s pour deviner ses coordonnées, puis on les classe par distance (voir js/carte.js).\n"
        'export default {\n  cat: "GeoGuessr (no move)",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(f"{len(items)} / {NOMBRE} cartes gardées, {len(rejets)} écartées par le filtre ({round(time.time() - t0)} s)", file=sys.stderr)


if __name__ == "__main__":
    main()
