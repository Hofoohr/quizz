#!/usr/bin/env python3
"""Génère la catégorie « Cartes » : pour chaque carte, une image à identifier (sous-zone, point d'intérêt, coordonnées).

Usage : python3 tools/cartes_dofus.py
Lit   : tools/cartes/liste.txt   (une coordonnée par ligne : « -35 -55 », « -32-53 », « -1;2 »…)
        tools/cartes/poi.json    (« x,y » -> nom du point d'intérêt, pour les cartes de la liste ; sinon « Inconnu »)
Écrit : js/questions/cartes.js   et   img/cartes/*.jpg

Les cartes viennent de trois ensembles, tous dans le monde principal (celui de la carte du monde) :
  1. la liste ci-dessus (ateliers, hôtels de vente, etc.) ;
  2. toutes les cartes de zaap (DofusDB : chaque sous-zone désigne la carte de son zaap) ;
  3. toutes les entrées de donjon (DofusDB : « entranceMapId » de chaque donjon). L'entrée est souvent une carte intérieure :
     on prend alors la carte extérieure aux mêmes coordonnées (la « porte » du donjon, sur la carte du monde).
     Une carte de la liste qui est aussi l'entrée d'un donjon prend le point d'intérêt « Entrée du donjon … ».

Les images viennent de DofusDB (api.dofusdb.fr/img/maps), à l'échelle 0,5. Elles portent un filigrane « DofusDB » en bas à droite :
on rogne la bande du bas (7,5 % de la hauteur), puis on réduit à 640 px de large et on compresse (≈ 40 Ko par carte).
Le nom du fichier est un code (empreinte de l'identifiant de carte) pour ne pas révéler les coordonnées aux joueurs.
Les cartes appartiennent à Ankama ; DofusDB (dofusdb.fr) en est la source.
"""
import hashlib
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "tools" / "cartes"
IMG_DIR = ROOT / "img" / "cartes"
API = "https://api.dofusdb.fr"
MONDE_PRINCIPAL = 1
PAGE = 50
LARGEUR, QUALITE, ROGNE = 640, 70, 0.075    # taille finale, compression JPEG, part rognée en bas (filigrane)
PTS, TEMPS = 6, 60                          # 3 champs : 2 points par champ juste
INCONNU = "Inconnu"


def get(path, params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params, doseq=True, safe='[]$')}"
    for n in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(0.15)  # politesse envers le serveur
                return json.load(r)
        except OSError:
            if n == 3:
                raise
            time.sleep(2 ** (n + 1))


def get_all(path, params):
    out, skip = [], 0
    while True:
        r = get(path, {**params, "$limit": PAGE, "$skip": skip})
        out += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            return out


def par_lots(path, ids, select):
    ids, out = sorted(set(ids)), {}
    for i in range(0, len(ids), PAGE):
        for o in get(path, {"id[$in][]": ids[i:i + PAGE], "$limit": PAGE, "$select[]": select})["data"]:
            out[o["id"]] = o
    return out


# --------------------------------------------------------------------------- 1. les trois ensembles de cartes
def lire_liste():
    """Les coordonnées de la liste, dans l'ordre, sans doublon. Formats acceptés : « -35 -55 », « -32-53 », « -1;2 »."""
    vus, out = set(), []
    for ligne in (DATA / "liste.txt").read_text(encoding="utf-8").splitlines():
        if not ligne.strip():
            continue
        m = re.fullmatch(r"\s*(-?\d+)\s*[;, ]?\s*(-?\d+)\s*", ligne)
        if not m:
            sys.exit(f"ligne illisible dans liste.txt : {ligne!r}")
        c = (int(m.group(1)), int(m.group(2)))
        if c not in vus:
            vus.add(c)
            out.append(c)
    return out


def cartes_du_monde():
    """Toutes les cartes du monde principal, regroupées par coordonnées."""
    rows = get_all("map-positions", {"worldMap": MONDE_PRINCIPAL,
                                     "$select[]": ["id", "posX", "posY", "subAreaId", "hasPriorityOnWorldmap"]})
    par_coord = defaultdict(list)
    for m in rows:
        par_coord[(m["posX"], m["posY"])].append(m)
    return par_coord


def choisir(candidates):
    """Une même coordonnée peut avoir plusieurs cartes (intérieurs, etc.) : on prend celle de la carte du monde."""
    prio = [m for m in candidates if m["hasPriorityOnWorldmap"]]
    return (prio or candidates)[0] if len(prio or candidates) == 1 else None


def entrees_donjons(par_coord):
    """{coordonnées: {"carte": carte extérieure, "noms": {donjons}}} pour les entrées de donjon du monde principal."""
    donjons = get_all("dungeons", {"$select[]": ["id", "name", "entranceMapId"]})
    noms_par_carte = defaultdict(set)
    for d in donjons:
        if d.get("entranceMapId", 0) > 0:
            noms_par_carte[d["entranceMapId"]].add(" ".join(d["name"]["fr"].split()))
    entrees = {}
    for m in par_lots("map-positions", noms_par_carte, ["id", "posX", "posY", "subAreaId", "worldMap"]).values():
        if m["worldMap"] == MONDE_PRINCIPAL:
            cible = {"id": m["id"], "posX": m["posX"], "posY": m["posY"], "subAreaId": m["subAreaId"]}
        elif m["worldMap"] == -1:   # intérieur : la porte est la carte extérieure aux mêmes coordonnées
            cible = choisir(par_coord.get((m["posX"], m["posY"]), []))
        else:                       # autres mondes (dimensions, îles annexes…) : coordonnées propres à ce monde, ignorées
            cible = None
        if cible:
            e = entrees.setdefault((cible["posX"], cible["posY"]), {"carte": cible, "noms": set()})
            e["noms"] |= noms_par_carte[m["id"]]
    return entrees


def poi_entree(noms):
    noms = sorted(noms)
    return "Entrée du donjon « %s »" % noms[0] if len(noms) == 1 else "Entrée des donjons " + " et ".join(f"« {n} »" for n in noms)


def ensemble_cartes():
    """Renvoie la liste des cartes à poser : dict(id, x, y, sous_zone, genre, poi)."""
    par_coord = cartes_du_monde()
    entrees = entrees_donjons(par_coord)
    cartes, vues = [], set()

    def ajouter(m, genre, poi):
        if m["id"] in vues:
            return
        vues.add(m["id"])
        cartes.append({"id": m["id"], "x": m["posX"], "y": m["posY"], "sous_zone": m["subAreaId"], "genre": genre, "poi": poi})

    for c in lire_liste():
        m = choisir(par_coord.get(c, []))
        if m is None:
            print(f"  ! coordonnée {c} : carte absente ou ambiguë, ignorée", file=sys.stderr)
            continue
        if c in entrees:   # une carte de la liste est aussi la porte d'un donjon
            ajouter(m, "donjon", poi_entree(entrees[c]["noms"]))
        else:
            ajouter(m, "liste", None)

    # zaaps : « associatedZaapMapId » de chaque sous-zone
    sous_zones = get_all("subareas", {"$select[]": ["id", "associatedZaapMapId"]})
    ids_zaap = {s["associatedZaapMapId"] for s in sous_zones if s.get("associatedZaapMapId", 0) > 0}
    for m in par_lots("map-positions", ids_zaap, ["id", "posX", "posY", "subAreaId", "worldMap"]).values():
        if m["worldMap"] == MONDE_PRINCIPAL:
            ajouter(m, "zaap", "Zaap")

    for e in entrees.values():
        ajouter(e["carte"], "donjon", poi_entree(e["noms"]))
    return cartes


# --------------------------------------------------------------------------- 2. les images
def nom_image(map_id, sel="carte"):
    """Nom de fichier opaque (empreinte de l'identifiant). « sel » sépare les jeux d'images : « carte » ne doit pas changer."""
    return hashlib.sha1(f"{sel}-{map_id}".encode()).hexdigest()[:10] + ".jpg"


def telecharger_carte(map_id):
    """Télécharge la carte, rogne le filigrane et réduit : renvoie l'image (PIL)."""
    with urllib.request.urlopen(f"{API}/img/maps/0.5/{map_id}.jpg", timeout=60) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    im = im.crop((0, 0, im.width, im.height - round(im.height * ROGNE)))
    time.sleep(0.15)
    return im.resize((LARGEUR, round(im.height * LARGEUR / im.width)), Image.LANCZOS)


def enregistrer(im, fichier):
    im.save(fichier, "JPEG", quality=QUALITE, optimize=True, progressive=True)


def preparer_image(map_id, dossier=IMG_DIR, sel="carte"):
    """Télécharge et enregistre une carte. Idempotent : ne refait pas une image déjà là."""
    fichier = dossier / nom_image(map_id, sel)
    if not fichier.exists():
        enregistrer(telecharger_carte(map_id), fichier)
    return fichier


# --------------------------------------------------------------------------- 3. les questions
def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    poi_liste = json.loads((DATA / "poi.json").read_text(encoding="utf-8")) if (DATA / "poi.json").exists() else {}
    cartes = ensemble_cartes()
    zones = par_lots("subareas", [c["sous_zone"] for c in cartes], ["id", "name"])
    items, inconnus = [], []
    for c in cartes:
        poi = c["poi"] or poi_liste.get(f"{c['x']},{c['y']}")
        if not poi:
            poi = INCONNU
            inconnus.append((c["x"], c["y"]))
        preparer_image(c["id"])
        zone = " ".join(zones[c["sous_zone"]]["name"]["fr"].split()) if c["sous_zone"] in zones else INCONNU
        items.append({
            "q": "Où se trouve cette carte ?",
            "champs": [["Sous-zone", zone], ["Point d'intérêt (ex : atelier chasseur, bateau vers X, banque…)", poi], ["Coordonnées (x, y) — le plus proche gagne les points", f"{c['x']}, {c['y']}"]],
            "pts": PTS, "temps": TEMPS, "img": f"img/cartes/{nom_image(c['id'])}", "coord": 2,
        })
    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/cartes.js").write_text(
        "// Fichier généré par tools/cartes_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une image de carte : le joueur donne la sous-zone, le point d'intérêt et les coordonnées (la correction affiche la distance).\n"
        'export default {\n  cat: "Cartes",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    genres = defaultdict(int)
    for c in cartes:
        genres[c["genre"]] += 1
    print(f"{len(items)} questions écrites {dict(genres)} ; point d'intérêt inconnu pour {len(inconnus)} cartes de la liste", file=sys.stderr)


if __name__ == "__main__":
    main()
