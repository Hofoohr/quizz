#!/usr/bin/env python3
"""Génère la catégorie « Métiers » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/metiers_dofus.py
Écrit : js/questions/metiers.js

Pour chaque métier de récolte (bûcheron, mineur, alchimiste, paysan), deux familles de questions :
  - « Quelle ressource le bûcheron débloque-t-il au niveau 20 ? »          -> la ou les ressources de ce niveau
  - « À quel niveau de bûcheron peut-on récolter la ressource « X » ? »    -> le niveau
Chaque ressource est récoltée par une « compétence » (skill) du métier, qui porte le niveau minimum du métier.
Le pêcheur et le chasseur ne sont pas utilisés.
Trois familles de fabrication complètent la catégorie, avec le niveau de métier de la recette :
pains (paysan, compétence « Cuire »), planches (bûcheron, « Scier ») et alliages (mineur, « Fondre »).
  - « Quel pain le paysan débloque-t-il au niveau 50 ? »  /  « À quel niveau de paysan peut-on fabriquer le pain « X » ? »
Seuls les pains « ordinaires » sont gardés (voir pain_ordinaire).
Un même niveau peut débloquer plusieurs ressources (ex. Bois d'Oliviolet et Bois de Pin au niveau 90) :
la réponse les liste alors toutes. Des compétences en double (ex. deux arbres « Frêne » de niveau 1) sont fusionnées.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.dofusdb.fr"
PAGE = 50
# identifiant du métier dans DofusDB -> (« le bûcheron », « de bûcheron ») pour accorder correctement les phrases
METIERS = {2: ("le bûcheron", "de bûcheron"), 24: ("le mineur", "de mineur"),
           26: ("l'alchimiste", "d'alchimiste"), 28: ("le paysan", "de paysan")}
PTS, TEMPS = 2, 25          # une seule ressource à trouver
PTS_MULTI, TEMPS_MULTI = 3, 35   # plusieurs ressources à trouver
# Familles fabriquées : (compétence DofusDB, type d'objet, nom, « quel/quelle … », sujet, complément, article)
FABRICATIONS = [
    (27, 33, "pain", "Quel pain", "le paysan", "de paysan", "le pain"),
    (101, 95, "planche", "Quelle planche", "le bûcheron", "de bûcheron", "la planche"),
    (32, 40, "alliage", "Quel alliage", "le mineur", "de mineur", "l'alliage"),
]
# Le type « Pain » contient aussi des plats qui n'en sont pas : on les écarte par leur nom.
PAS_DES_PAINS = {"Gaufre", "Tortilla", "Blopisier empoisonné"}


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


def ressources_du_metier(job_id):
    """Renvoie { niveau : [noms des ressources] } pour un métier."""
    skills, skip = [], 0
    while True:
        r = get("skills", {"parentJobId": job_id, "$limit": PAGE, "$skip": skip,
                           "$select[]": ["id", "levelMin", "gatheredRessourceItem", "item.name"]})
        skills += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            break
    par_niveau = defaultdict(dict)   # niveau -> { id de la ressource : nom } (le dict fusionne les doublons)
    for s in sorted(skills, key=lambda s: s["id"]):
        # gatheredRessourceItem vaut -1 pour une compétence qui ne récolte rien (ex. « Scier »)
        if s["gatheredRessourceItem"] > 0 and s.get("item"):
            par_niveau[s["levelMin"]][s["gatheredRessourceItem"]] = " ".join(s["item"]["name"]["fr"].split())
    return {niv: list(noms.values()) for niv, noms in sorted(par_niveau.items())}


def recettes(skill_id, type_id):
    """Les recettes d'une famille d'objets fabriquées avec une compétence, avec l'objet résultat."""
    recettes, skip = [], 0
    while True:
        r = get("recipes", {"skillId": skill_id, "resultTypeId": type_id, "$limit": PAGE, "$skip": skip,
                            "$select[]": ["resultId", "resultLevel", "resultName", "ingredientIds"]})
        recettes += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            break
    return recettes


def objets(ids, champs):
    ids, out = sorted(set(ids)), {}
    for i in range(0, len(ids), PAGE):
        for o in get("items", {"id[$in][]": ids[i:i + PAGE], "$limit": PAGE, "$select[]": champs})["data"]:
            out[o["id"]] = o
    return out


def ids_cereales():
    """Identifiants des ressources que le paysan récolte : elles servent à reconnaître un pain « de base »."""
    r = get("skills", {"parentJobId": 28, "$limit": PAGE, "$select[]": ["gatheredRessourceItem"]})
    return {s["gatheredRessourceItem"] for s in r["data"] if s["gatheredRessourceItem"] > 0}


def pain_ordinaire(recette, objet, cereales):
    """Un pain « ordinaire » : un pain de la gamme normale du paysan, pas une variante ni un plat spécial.
      - aucune condition sur le personnage (les variantes « Doré », « Aurifère », « Résistant »… ont une condition « cv<N »,
        les pains de quête comme le Chapain en ont une autre) ;
      - prix 0 (les quelques plats à part, comme le Pain Phecte, valent 1) ;
      - sa recette part d'une céréale récoltée par le paysan et reste simple (3 ingrédients au plus) ;
      - ce n'est pas un plat qui n'est pas un pain (Gaufre, Tortilla…)."""
    return (not objet.get("criterions") and objet.get("price", 0) == 0
            and recette["ingredientIds"][0] in cereales and len(recette["ingredientIds"]) <= 3
            and " ".join(recette["resultName"]["fr"].split()) not in PAS_DES_PAINS)


def fabrications():
    """Questions des pains, planches et alliages."""
    items, cereales = [], ids_cereales()
    for skill_id, type_id, famille, quel, sujet, complement, article in FABRICATIONS:
        rs = recettes(skill_id, type_id)
        objs = objets([r["resultId"] for r in rs], ["id", "price", "criterions"])
        if famille == "pain":
            rs = [r for r in rs if pain_ordinaire(r, objs[r["resultId"]], cereales)]
        par_niveau = defaultdict(list)
        for r in sorted(rs, key=lambda r: r["resultId"]):
            nom = " ".join(r["resultName"]["fr"].split())
            if nom not in par_niveau[r["resultLevel"]]:
                par_niveau[r["resultLevel"]].append(nom)
        for niveau, noms in sorted(par_niveau.items()):
            multi = len(noms) > 1
            items.append([f"{quel} {sujet} débloque-t-il au niveau {niveau} ?", ", ".join(noms),
                          PTS_MULTI if multi else PTS, TEMPS_MULTI if multi else TEMPS])
        for niveau, noms in sorted(par_niveau.items()):
            for nom in noms:
                items.append([f"À quel niveau {complement} peut-on fabriquer {article} « {nom} » ?", str(niveau), PTS, TEMPS])
    return items


def main():
    items = []
    for job_id, (sujet, complement) in METIERS.items():
        par_niveau = ressources_du_metier(job_id)
        for niveau, noms in par_niveau.items():
            multi = len(noms) > 1
            items.append([f"Quelle ressource {sujet} débloque-t-il au niveau {niveau} ?", ", ".join(noms),
                          PTS_MULTI if multi else PTS, TEMPS_MULTI if multi else TEMPS])
        for niveau, noms in par_niveau.items():
            for nom in noms:
                items.append([f"À quel niveau {complement} peut-on récolter la ressource « {nom} » ?", str(niveau), PTS, TEMPS])

    items += fabrications()   # après la récolte : les identifiants des questions déjà publiées ne bougent pas

    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/metiers.js").write_text(
        "// Fichier généré par tools/metiers_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Métiers de récolte (ressource débloquée à un niveau, niveau d'une ressource) puis pains, planches et alliages.\n"
        'export default {\n  cat: "Métiers",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "questions écrites", file=sys.stderr)


if __name__ == "__main__":
    main()
