#!/usr/bin/env python3
"""Génère la catégorie « Succès » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/succes_donjons_dofus.py
Écrit : js/questions/succes-donjons.js

Pour chaque donjon, une question à 3 champs : « Quels sont les 2 succès du donjon X, ainsi que son succès spécial ? »
  - Les donjons sont rangés par tranche de niveau (catégories 11, 12, 13, 14, 59) + les îles événementielles
    (Nowel, Pwâk, Halouine). Chaque boss a des succès nommés « Boss (Challenge) » :
    un succès de taille de groupe (Duo, Trio, Quatuor) et Chrono (îles) communs à tous les donjons, donc ignorés,
    deux succès propres au donjon, et « Spécial ». Un donjon sans succès spécial est ignoré.
  - Les succès « 1re / 2e / 3e fois » et « Vaincre le boss » ne sont pas utilisés.
  - La description d'un succès cite son challenge par un numéro ([challenge,52]) : on va chercher le nom
    du challenge, car « Spécial » seul ne dit rien (ex. « Un Mulou dans la Bergerie »).
    La réponse du succès spécial ajoute la description du challenge : elle dit ce qu'il faut faire.
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
# Catégories de succès : donjons par tranche de niveau, puis îles événementielles (Nowel, Pwâk, Halouine).
CATEGORIES_DONJONS = [11, 12, 13, 14, 59, 23, 89, 68]
GENERIQUES = {"Duo", "Trio", "Quatuor", "Chrono"}   # présents dans (presque) tous les donjons : pas des succès « propres »
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


def donjons_de_la_categorie(categorie):
    """Renvoie { boss : (nom du donjon, { challenge : numéro }) } pour une catégorie de succès."""
    succes = get_all("achievements", {"categoryId": categorie, "$select[]": ["id", "name", "description"]})

    # « Boss (Challenge) » -> boss : { challenge : numéro du challenge }
    par_boss = defaultdict(dict)
    for a in succes:
        m = re.match(r"(.*) \(([^)]*)\)$", fr(a))
        num = re.search(r"\[challenge,(\d+)\]", a["description"]["fr"])
        if m and num:
            par_boss[m.group(1)][m.group(2)] = int(num.group(1))

    # Nom du donjon : le succès sans suffixe dont la description est « Vaincre <boss> dans son (ou leur) donjon. »
    noms = {}
    for a in succes:
        d = sans_accent(" ".join(a["description"]["fr"].split()))
        if re.search(r"\(.*\)$", fr(a)):
            continue
        for boss in par_boss:
            if re.search(r"(^|[ '’])" + re.escape(sans_accent(boss)) + r" (ensemble )?dans (son|leur) donjon\.$", d):
                noms.setdefault(boss, fr(a))
    return {boss: (noms.get(boss), ch) for boss, ch in par_boss.items()}


def main():
    donjons = {}
    for categorie in CATEGORIES_DONJONS:
        donjons.update(donjons_de_la_categorie(categorie))
    par_boss = {boss: ch for boss, (_, ch) in donjons.items()}

    ids = {n for ch in par_boss.values() for n in ch.values()}
    challenges, ids, cibles = {}, sorted(ids), {}
    for i in range(0, len(ids), PAGE):  # par lots : l'API limite la taille d'une page
        for c in get("challenges", {"id[$in][]": ids[i:i + PAGE], "$limit": PAGE,
                                    "$select[]": ["id", "name", "description", "targetMonsterId"]})["data"]:
            challenges[c["id"]] = (fr(c), " ".join(c["description"]["fr"].split()))
            if c.get("targetMonsterId"):
                cibles[c["id"]] = c["targetMonsterId"]

    # Certains challenges visent un monstre précis : « Tuer {0} en dernier. » -> on remplace {0} par son nom.
    ids_monstres = sorted(set(cibles.values()))
    monstres = {}
    for i in range(0, len(ids_monstres), PAGE):
        for m in get("monsters", {"id[$in][]": ids_monstres[i:i + PAGE], "$limit": PAGE, "$select[]": ["id", "name"]})["data"]:
            monstres[m["id"]] = fr(m)
    for cid, mid in cibles.items():
        nom_challenge, description = challenges[cid]
        challenges[cid] = (nom_challenge, description.replace("{0}", monstres.get(mid, "{0}")))

    items = []
    for boss, ch in par_boss.items():
        propres = [k for k in ch if k not in GENERIQUES and k != "Spécial"]
        if not donjons[boss][0] or "Spécial" not in ch or len(propres) != 2:
            print("ignoré (structure inattendue):", boss, list(ch), file=sys.stderr)
            continue
        items.append({
            "q": f"Quels sont les 2 succès du donjon « {donjons[boss][0]} », ainsi que son succès spécial ?",
            "champs": [["Succès 1", challenges[ch[propres[0]]][0]], ["Succès 2", challenges[ch[propres[1]]][0]],
                       ["Succès spécial", "{} : {}".format(*challenges[ch["Spécial"]])]],
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
