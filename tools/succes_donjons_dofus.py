#!/usr/bin/env python3
"""Génère la catégorie « Succès » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/succes_donjons_dofus.py
Écrit : js/questions/succes-donjons.js

Pour chaque donjon, une question à 3 champs : « Quels sont les 2 succès du donjon X, ainsi que son succès spécial ? »
  - Dans la catégorie 11 (« Donjons ») chaque boss a des succès nommés « Boss (Challenge) » :
    Duo (commun à tous les donjons, donc ignoré), deux succès propres au donjon, et « Spécial ».
  - Les succès « 1re / 2e / 3e fois » et « Vaincre le boss » ne sont pas utilisés.
  - La description d'un succès cite son challenge par un numéro ([challenge,52]) : on va chercher le nom
    du challenge, car « Spécial » seul ne dit rien (ex. « Un Mulou dans la Bergerie »).
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.dofusdb.fr"
PAGE = 50
CATEGORIE_DONJONS = 11
PTS, TEMPS = 3, 45


def get(path, params):
    url = f"{API}/{path}?{urllib.parse.urlencode(params, doseq=True, safe='[]$')}"
    for n in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(0.2)  # politesse envers le serveur
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


def sans_accent(t):
    """« Éponge » et « Eponge » doivent être reconnus comme le même mot."""
    return "".join(c for c in unicodedata.normalize("NFD", t) if not unicodedata.combining(c)).lower()


def fr(x):
    return " ".join(x["name"]["fr"].split())


def main():
    succes = get_all("achievements", {"categoryId": CATEGORIE_DONJONS, "$select[]": ["id", "name", "description"]})

    # « Boss (Challenge) » -> boss : { challenge : numéro du challenge }
    par_boss = defaultdict(dict)
    for a in succes:
        m = re.match(r"(.*) \(([^)]*)\)$", fr(a))
        num = re.search(r"\[challenge,(\d+)\]", a["description"]["fr"])
        if m and num:
            par_boss[m.group(1)][m.group(2)] = int(num.group(1))

    # Nom du donjon : le succès sans suffixe dont la description est « Vaincre <boss> dans son donjon. »
    donjons = {}
    for a in succes:
        d = a["description"]["fr"]
        for boss in par_boss:
            if sans_accent(d).endswith(sans_accent(f"{boss} dans son donjon.")) and not re.search(r"\(.*\)$", fr(a)):
                donjons[boss] = fr(a)

    ids = {n for ch in par_boss.values() for n in ch.values()}
    challenges, ids = {}, sorted(ids)
    for i in range(0, len(ids), PAGE):  # par lots : l'API limite la taille d'une page
        for c in get("challenges", {"id[$in][]": ids[i:i + PAGE], "$limit": PAGE, "$select[]": ["id", "name"]})["data"]:
            challenges[c["id"]] = fr(c)

    items = []
    for boss, ch in par_boss.items():
        propres = [k for k in ch if k not in ("Duo", "Spécial")]
        if boss not in donjons or "Spécial" not in ch or len(propres) != 2:
            print("ignoré (structure inattendue):", boss, list(ch), file=sys.stderr)
            continue
        items.append({
            "q": f"Quels sont les 2 succès du donjon « {donjons[boss]} », ainsi que son succès spécial ?",
            "champs": [["Succès 1", challenges[ch[propres[0]]]], ["Succès 2", challenges[ch[propres[1]]]],
                       ["Succès spécial", challenges[ch["Spécial"]]]],
            "pts": PTS, "temps": TEMPS,
        })

    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/succes-donjons.js").write_text(
        "// Fichier généré par tools/succes_donjons_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Pour chaque donjon : ses 2 succès de challenge (hors Duo) et son succès spécial.\n"
        'export default {\n  cat: "Succès",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "questions écrites", file=sys.stderr)


if __name__ == "__main__":
    main()
