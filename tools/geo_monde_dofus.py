#!/usr/bin/env python3
"""Génère la carte du monde illustrée du GeoGuessr (celle de l'outil carte de DofusDB), découpée en tuiles pour Leaflet.

Usage : python3 tools/geo_monde_dofus.py
Écrit : img/monde/{z}/{x}/{y}.webp   (z = 0..4 ; z = 4 : taille d'origine 10000 x 8000 px ; chaque niveau divise par 2)

DofusDB (dofusdb.fr/fr/tools/map) découpe la carte du « Monde des Douze » en tuiles de 250 px : api.dofusdb.fr/img/worlds/1/{échelle}/{n}.jpg.
On n'utilise que l'échelle 1 (la carte illustrée) : les échelles « customN » (fort zoom) sont les images en jeu des cartes, qu'on ne veut pas.
Le zoom au-delà de l'échelle 1 est un simple agrandissement par le navigateur : la carte garde le même aspect.
Repère (échelle 1) : la carte de coordonnées (x, y) occupe [ORIGINE_X + x * LARGEUR, ORIGINE_Y + y * HAUTEUR] (voir js/geo.js).
Les cartes appartiennent à Ankama ; DofusDB en est la source.
"""
import io
import math
import shutil
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "monde"
W, H, SRC = 10000, 8000, 250      # taille de la carte du monde (échelle 1) et des tuiles sources
TUILE, ZMAX = 256, 4
FOND = (169, 207, 150)            # vert de l'océan, pour le bord des tuiles


def tuile_source(args):
    col, row, cols = args
    url = f"https://api.dofusdb.fr/img/worlds/1/1/{row * cols + col + 1}.jpg"
    for n in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            time.sleep(2 ** n)
    raise SystemExit("tuile introuvable : " + url)


def main():
    cols, rows = math.ceil(W / SRC), math.ceil(H / SRC)
    with ThreadPoolExecutor(16) as ex:
        tuiles = list(ex.map(tuile_source, [(c, r, cols) for r in range(rows) for c in range(cols)]))
    big = Image.new("RGB", (W, H), FOND)
    for i, t in enumerate(tuiles):
        big.paste(t, ((i % cols) * SRC, (i // cols) * SRC))
    if OUT.exists():
        shutil.rmtree(OUT)
    for z in range(ZMAX, -1, -1):
        k = 2 ** (ZMAX - z)
        im = big if k == 1 else big.resize((math.ceil(W / k), math.ceil(H / k)), Image.LANCZOS)
        for ty in range(math.ceil(im.height / TUILE)):
            for tx in range(math.ceil(im.width / TUILE)):
                t = Image.new("RGB", (TUILE, TUILE), FOND)
                t.paste(im.crop((tx * TUILE, ty * TUILE, min(im.width, (tx + 1) * TUILE), min(im.height, (ty + 1) * TUILE))), (0, 0))
                d = OUT / str(z) / str(tx)
                d.mkdir(parents=True, exist_ok=True)
                t.save(d / f"{ty}.webp", quality=80, method=6)
    print("ok")


if __name__ == "__main__":
    main()
