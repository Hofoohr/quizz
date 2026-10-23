#!/usr/bin/env python3
"""Génère la catégorie « Monstre pixelisé » : un monstre tiré au hasard, à nommer le plus vite possible sur une image qui se précise.

Usage : python3 tools/monstres_pixel.py
Écrit : js/questions/monstres-pixel.js   et   img/monstres/*.png

Les monstres viennent de DofusDB (api.dofusdb.fr) : on garde ceux qui ont un nom, sans « ? », une image non vide, et qui ne sont pas des créatures de quêtes (isQuestMonster).
La liste = tous les boss + deux monstres de chaque famille (race), sans archimonstres, mélangée avec une graine fixe. Le nom du fichier image est un code (empreinte), pour ne pas révéler le nom.
Les illustrations appartiennent à Ankama ; DofusDB en est la source.
"""
import hashlib
import io
import json
import random
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img" / "monstres"
API = "https://api.dofusdb.fr"
PTS, TEMPS = 6, 30   # 30 s ; le plus rapide à trouver gagne le plus de points (6 pour le 1er)
PAGE = 50
PAR_FAMILLE = 2     # monstres gardés par famille (hors boss)
EXCLUS = {"Psychopathe"}   # monstres retirés à la demande (ils sont sautés : le suivant du tirage les remplace)


def get(path, params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params, doseq=True, safe='[]$')}"
    for n in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(0.15)
                return json.load(r)
        except OSError:
            if n == 3:
                raise
            time.sleep(2 ** (n + 1))


def tous_les_monstres():
    out, skip = [], 0
    while True:
        r = get("monsters", {"$limit": PAGE, "$skip": skip, "$select[]": ["id", "name", "img", "gfxId", "race", "grades.level", "isQuestMonster", "isBoss", "isMiniBoss"]})
        out += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            return out


def nom_fichier(mid):
    return hashlib.sha1(f"monstre-{mid}".encode()).hexdigest()[:10] + ".png"


def telecharger(m):
    """Renvoie l'image (RGBA, 128 px) ou None si elle est absente ou presque vide."""
    try:
        with urllib.request.urlopen(m["img"], timeout=60) as r:
            im = Image.open(io.BytesIO(r.read())).convert("RGBA")
    except OSError:
        return None
    time.sleep(0.1)
    alpha = im.getchannel("A")
    if sum(1 for p in alpha.tobytes() if p > 40) < 0.06 * im.width * im.height:   # presque rien de visible
        return None
    return im


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    monstres = tous_les_monstres()
    # candidats : nom non vide et sans « ? », image, jamais une créature de quête (isQuestMonster) ni un archimonstre (isMiniBoss)
    valides = []
    for m in monstres:
        nom = " ".join(((m.get("name") or {}).get("fr") or "").split())
        if nom and "?" not in nom and m.get("img") and m.get("grades") and not m.get("isQuestMonster") and not m.get("isMiniBoss") and nom not in EXCLUS:
            valides.append((nom, m))
    valides.sort(key=lambda t: t[1]["id"])   # à nom égal, on garde le plus ancien
    items, vus, noms = [], {}, set()

    def accepter(nom, m):
        """Télécharge l'image et garde le monstre, sauf nom déjà pris, image absente ou identique à celle d'un autre monstre."""
        if nom in noms:
            return False
        fichier = IMG_DIR / nom_fichier(m["id"])
        if not fichier.exists():
            im = telecharger(m)
            if im is None:
                return False
            im.save(fichier, optimize=True)
        # Image identique à celle d'un autre monstre (variante qui réutilise le dessin du monstre de base) : question ambiguë, on la saute.
        empreinte = hashlib.md5(fichier.read_bytes()).hexdigest()
        if empreinte in vus:
            print(f"  image identique : « {nom} » = « {vus[empreinte]} », ignoré", file=sys.stderr)
            fichier.unlink()
            return False
        vus[empreinte] = nom; noms.add(nom)
        items.append({"q": "Quel est ce monstre ? Tape son nom exact : l'image devient plus nette avec le temps, le plus rapide gagne le plus de points !",
                      "nom": nom, "sprite": f"img/monstres/{fichier.name}", "pts": PTS, "temps": TEMPS})
        return True

    for nom, m in valides:                    # 1) tous les boss (du plus ancien au plus récent)
        if m.get("isBoss"):
            accepter(nom, m)
    nb_boss = len(items)
    familles = {}
    for nom, m in valides:                    # 2) les PAR_FAMILLE plus anciens monstres (qui ne sont pas des boss) de chaque famille (race)
        if not m.get("isBoss") and (m.get("race") or 0) > 0:
            familles.setdefault(m["race"], []).append((nom, m))
    for race in sorted(familles):
        pris = 0
        for nom, m in familles[race]:
            if pris >= PAR_FAMILLE:
                break
            pris += accepter(nom, m)
    print(f"{len(monstres)} monstres, {len(valides)} valides, {nb_boss} boss, {len(familles)} familles", file=sys.stderr)
    random.Random(2026).shuffle(items)
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/monstres-pixel.js").write_text(
        "// Fichier généré par tools/monstres_pixel.py : ne pas modifier à la main (relancer le script).\n"
        "// Un monstre au hasard : image très pixelisée qui se précise ; il faut taper son nom exact, le plus vite possible (voir js/devine.js).\n"
        'export default {\n  cat: "Monstre pixelisé",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(f"{len(items)} monstres écrits", file=sys.stderr)


if __name__ == "__main__":
    main()
