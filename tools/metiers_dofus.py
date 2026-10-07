#!/usr/bin/env python3
"""Génère la catégorie « Métiers » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/metiers_dofus.py
Écrit : js/questions/metiers.js

Pour chaque métier de récolte (bûcheron, mineur, alchimiste, paysan), deux familles de questions :
  - « Quelle ressource le bûcheron débloque-t-il au niveau 20 ? »          -> la ou les ressources de ce niveau
  - « À quel niveau de bûcheron peut-on récolter la ressource « X » ? »    -> le niveau
Chaque ressource est récoltée par une « compétence » (skill) du métier, qui porte le niveau minimum du métier.
Le pêcheur et le chasseur ne sont pas utilisés.
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

    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/metiers.js").write_text(
        "// Fichier généré par tools/metiers_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Ressources des métiers de récolte : la ressource débloquée à un niveau, et le niveau d'une ressource.\n"
        'export default {\n  cat: "Métiers",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(len(items), "questions écrites", file=sys.stderr)


if __name__ == "__main__":
    main()
