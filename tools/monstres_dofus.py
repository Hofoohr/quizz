#!/usr/bin/env python3
"""Génère la catégorie « Monstres » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/monstres_dofus.py
Écrit : js/questions/monstres.js

Pourquoi « scraper » une API plutôt qu'une page HTML ?
  Le site dofusdb.fr est une application JavaScript : le HTML reçu est quasi vide, les données
  arrivent ensuite via des appels JSON vers api.dofusdb.fr. Plutôt que de parser du HTML fragile,
  on appelle directement cette API (ouverte, sans clé) : c'est plus rapide et plus stable.
  (Astuce : onglet « Réseau » des outils de développement du navigateur pour trouver ces appels.)

Les 4 étapes d'un scraper, que l'on retrouve ci-dessous :
  1. récupérer  (get / get_all : requêtes HTTP + pagination)
  2. nettoyer   (garder les seuls champs utiles, écarter les données ambiguës)
  3. transformer (fabriquer des questions à partir des données)
  4. écrire     (un fichier JS que le quizz importe)

Questions produites, pour chaque boss / mini-boss :
  - « Dans quelle sous-zone trouve-t-on X ? »        -> le nom de la sous-zone
  - « À quelle famille de monstres appartient X ? »  -> le nom de la famille
  - « Quelles sont les caractéristiques de X ? »     -> niveau, PV, PA, PM (question à plusieurs champs)
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.dofusdb.fr"
PAGE = 50            # l'API limite la taille d'une page : on pagine avec $skip
PAUSE = 0.2          # politesse : on espace les requêtes pour ne pas surcharger le serveur
RACE_INCONNUE = -1   # « Monstres divers » : pas une vraie famille, on n'en fait pas de question

# (points, secondes) par type de question
ZONE = (2, 30)
FAMILLE = (2, 30)
STATS = (3, 45)


# --------------------------------------------------------------------------- 1. récupérer
def get(path, params, essais=4):
    """GET JSON avec quelques essais (réseau instable = cas normal en scraping)."""
    # safe='[]$' : l'API utilise une syntaxe type « $select[]=id » qu'il ne faut pas encoder.
    url = f"{API}/{path}?{urllib.parse.urlencode(params, doseq=True, safe='[]$')}"
    for n in range(essais):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(PAUSE)
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            if n == essais - 1:
                raise
            attente = 2 ** (n + 1)  # 2 s, 4 s, 8 s : on attend de plus en plus longtemps
            print(f"  erreur ({e}), nouvel essai dans {attente}s", file=sys.stderr)
            time.sleep(attente)


def get_all(path, params):
    """Parcourt toutes les pages d'une ressource et renvoie la liste complète."""
    out, skip = [], 0
    while True:
        r = get(path, {**params, "$limit": PAGE, "$skip": skip})
        out += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            return out


def get_by_ids(path, ids, select):
    """Récupère des ressources à partir d'une liste d'identifiants, par lots (filtre $in)."""
    ids, out = sorted(ids), {}
    for i in range(0, len(ids), PAGE):
        r = get(path, {"id[$in][]": ids[i:i + PAGE], "$limit": PAGE, "$select[]": select})
        out.update({x["id"]: x for x in r["data"]})
    return out


# --------------------------------------------------------------------------- 2. nettoyer
def charger():
    champs = ["id", "name", "race", "subareas", "grades.level", "grades.lifePoints",
              "grades.actionPoints", "grades.movementPoints"]
    monstres = {}
    for drapeau in ("isBoss", "isMiniBoss"):  # deux requêtes : l'API n'a pas de « OU » simple
        for m in get_all("monsters", {drapeau: "true", "$select[]": champs}):
            monstres[m["id"]] = m
    monstres = sorted(monstres.values(), key=lambda m: m["id"])

    races = get_by_ids("monster-races", {m["race"] for m in monstres}, ["id", "name"])
    zones = get_by_ids("subareas", {s for m in monstres for s in m["subareas"]}, ["id", "name"])
    return monstres, races, zones


def nom(ressource):
    return " ".join(ressource["name"]["fr"].split())  # « fr » + espaces normalisés


def retenir(monstres):
    """Écarte tout ce qui rendrait une question ambiguë ou injuste.

    Une bonne question n'a qu'UNE réponse possible : on exclut donc les noms portés par
    plusieurs monstres (on ne saurait pas de qui on parle) et les monstres sans grade.
    """
    noms = Counter(nom(m) for m in monstres)
    gardes = [m for m in monstres if noms[nom(m)] == 1 and m["grades"] and nom(m)]
    print(f"{len(gardes)} monstres retenus sur {len(monstres)}", file=sys.stderr)
    return gardes


# --------------------------------------------------------------------------- 3. transformer
def fabriquer(monstres, races, zones):
    questions = []
    for m in monstres:
        n = nom(m)

        # Sous-zone : seulement si le monstre n'en a qu'une (sinon plusieurs réponses valides).
        if len(m["subareas"]) == 1 and m["subareas"][0] in zones:
            zone = nom(zones[m["subareas"][0]])
            # 5e élément = « groupe » : le tirage équilibre les sous-zones (voir js/tirage.js),
            # pour ne pas tomber toujours sur la même région, très peuplée en boss.
            questions.append([f"Dans quelle sous-zone trouve-t-on « {n} » ?", zone, *ZONE, zone])

        # Famille : on ignore la famille « divers ».
        if m["race"] != RACE_INCONNUE and m["race"] in races:
            questions.append([f"À quelle famille de monstres appartient « {n} » ?", nom(races[m["race"]]), *FAMILLE])

        # Caractéristiques du premier rang (grade 1) : question à plusieurs champs.
        g = m["grades"][0]
        questions.append({
            "q": f"Quelles sont les caractéristiques de « {n} » (rang 1) ?",
            "champs": [["Niveau", str(g["level"])], ["Points de vie", str(g["lifePoints"])],
                       ["PA", str(g["actionPoints"])], ["PM", str(g["movementPoints"])]],
            "pts": STATS[0], "temps": STATS[1],
        })
    return questions


# --------------------------------------------------------------------------- 4. écrire
def ecrire(questions):
    lignes = ["    " + json.dumps(q, ensure_ascii=False) + "," for q in questions]
    contenu = (
        "// Fichier généré par tools/monstres_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Boss et mini-boss : sous-zone, famille et caractéristiques.\n"
        'export default {\n  cat: "Monstres",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n"
    )
    (ROOT / "js/questions/monstres.js").write_text(contenu, encoding="utf-8")


def main():
    monstres, races, zones = charger()
    questions = fabriquer(retenir(monstres), races, zones)
    ecrire(questions)
    print(f"{len(questions)} questions écrites dans js/questions/monstres.js", file=sys.stderr)


if __name__ == "__main__":
    main()
