#!/usr/bin/env python3
"""Génère js/geo-maps.js : toutes les cartes du monde principal de Dofus (pour le GeoGuessr).

Usage : python3 tools/geo_cartes_dofus.py
Écrit : js/geo-maps.js   (liste de [x, y, idCarte, idSousZone])

Une seule carte par coordonnée (celle de la carte du monde) ; les coordonnées ambiguës sont ignorées.
Les images ne sont pas stockées : le jeu les charge depuis DofusDB (api.dofusdb.fr/img/maps), qui en est la source.
Les cartes appartiennent à Ankama.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cartes_dofus as c   # réutilise l'accès à l'API DofusDB

ROOT = Path(__file__).resolve().parent.parent


def main():
    rows = c.get_all("map-positions", {"worldMap": c.MONDE_PRINCIPAL,
                                       "$select[]": ["id", "posX", "posY", "subAreaId", "outdoor", "hasPriorityOnWorldmap"]})
    par_coord = defaultdict(list)
    for m in rows:
        par_coord[(m["posX"], m["posY"])].append(m)
    cartes = []
    for (x, y), v in sorted(par_coord.items()):
        prio = [m for m in v if m.get("hasPriorityOnWorldmap")]
        ext = [m for m in v if m.get("outdoor")]
        pick = v[0] if len(v) == 1 else prio[0] if len(prio) == 1 else ext[0] if len(ext) == 1 else None
        if pick:
            cartes.append([x, y, pick["id"], pick["subAreaId"]])
    out = ("// Fichier généré par tools/geo_cartes_dofus.py : ne pas modifier à la main (relancer le script).\n"
           "// [x, y, id de la carte, id de la sous-zone] ; les images viennent de DofusDB.\n"
           "export const MAPS = " + json.dumps(cartes, separators=(",", ":")) + ";\n")
    (ROOT / "js" / "geo-maps.js").write_text(out, encoding="utf-8")
    print(len(cartes), "cartes")


if __name__ == "__main__":
    main()
