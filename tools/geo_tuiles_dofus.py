#!/usr/bin/env python3
"""Génère la carte du monde du GeoGuessr : une mosaïque de toutes les cartes, découpée en tuiles (zoom Leaflet).

Usage : python3 tools/geo_tuiles_dofus.py
Lit   : js/geo-maps.js        (généré par tools/geo_cartes_dofus.py)
Écrit : img/monde/{z}/{x}/{y}.webp   (z = 0..3 ; z = 3 : une carte = 32 px)
        et affiche les constantes (minX, minY, largeur, hauteur) attendues par js/geo.js.

Chaque carte est téléchargée sur DofusDB (api.dofusdb.fr/img/maps, échelle 0,25), son filigrane est rogné, puis elle est
réduite à 32 x 32 px et placée à sa coordonnée. Les miniatures sont mises en cache dans tools/.cache-tuiles (non versionné).
Les cartes appartiennent à Ankama ; DofusDB en est la source.
"""
import io
import json
import shutil
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache-tuiles"
OUT = ROOT / "img" / "monde"
PX = 32            # taille d'une carte au zoom maximal
TUILE = 256
ZMAX = 3
ROGNE = 0.075      # part basse rognée (filigrane « DofusDB »)
FOND = (14, 18, 32)


def charger_cartes():
    txt = (ROOT / "js" / "geo-maps.js").read_text(encoding="utf-8")
    return json.loads(txt[txt.index("[["):txt.rindex("]]") + 2])


def miniature(carte):
    x, y, mid, _ = carte
    f = CACHE / f"{mid}.png"
    if f.exists():
        return Image.open(f).convert("RGB")
    for n in range(5):
        try:
            with urllib.request.urlopen(f"https://api.dofusdb.fr/img/maps/0.25/{mid}.jpg", timeout=60) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGB")
            break
        except Exception:
            if n == 4:
                return None
            time.sleep(2 ** (n + 1))
    im = im.crop((0, 0, im.width, int(im.height * (1 - ROGNE)))).resize((PX, PX), Image.LANCZOS)
    im.save(f)
    return im


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    cartes = charger_cartes()
    min_x, min_y = min(c[0] for c in cartes), min(c[1] for c in cartes)
    w, h = max(c[0] for c in cartes) - min_x + 1, max(c[1] for c in cartes) - min_y + 1
    with ThreadPoolExecutor(16) as ex:
        thumbs = list(ex.map(miniature, cartes))
    manquantes = sum(t is None for t in thumbs)
    print(len(cartes), "cartes,", manquantes, "images manquantes ; grille", w, "x", h, "origine", min_x, min_y, file=sys.stderr)
    big = Image.new("RGB", (w * PX, h * PX), FOND)
    for c, t in zip(cartes, thumbs):
        if t:
            big.paste(t, ((c[0] - min_x) * PX, (c[1] - min_y) * PX))
    if OUT.exists():
        shutil.rmtree(OUT)
    for z in range(ZMAX, -1, -1):
        k = 2 ** (ZMAX - z)
        im = big if k == 1 else big.resize((max(1, big.width // k), max(1, big.height // k)), Image.LANCZOS)
        for ty in range((im.height + TUILE - 1) // TUILE):
            for tx in range((im.width + TUILE - 1) // TUILE):
                tuile = Image.new("RGB", (TUILE, TUILE), FOND)
                tuile.paste(im.crop((tx * TUILE, ty * TUILE, min(im.width, (tx + 1) * TUILE), min(im.height, (ty + 1) * TUILE))), (0, 0))   # rogne dans l'image (sinon le reste serait noir)
                d = OUT / str(z) / str(tx)
                d.mkdir(parents=True, exist_ok=True)
                tuile.save(d / f"{ty}.webp", quality=72, method=6)
    print(json.dumps({"minX": min_x, "minY": min_y, "w": w, "h": h, "px": PX, "zmax": ZMAX}))


if __name__ == "__main__":
    main()
