#!/usr/bin/env python3
"""Génère des questions « À quel Dofus est reliée cette quête ? » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/quetes_dofus.py
Écrit : js/questions/quetes-dofus.js  (catégorie « Quêtes », une question par quête de chaque Dofus)

Principe : chaque Dofus est la récompense d'un succès « de tête ». On descend dans ses sous-succès
(« Obtenir les succès suivants ») et on récolte les quêtes listées dans need.quests. Un sous-succès qui est
lui-même le succès de tête d'un autre Dofus est ignoré (ex. : le Nébuleux demande le succès des Veilleurs).
Une quête présente chez deux Dofus, ou deux quêtes de même nom chez deux Dofus, est écartée (réponse ambiguë).
Chaque question porte son Dofus comme « groupe » : le tirage donne autant de chances à chaque Dofus (js/tirage.js).
Relancer le script après une mise à jour du jeu. Les nouveaux Dofus se placent à la fin : l'ordre existant ne change pas.
"""
import json, subprocess, sys, urllib.parse
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PTS, TEMPS = 2, 20
# Dofus -> succès de tête (celui dont le Dofus est la récompense, ou qui regroupe ses séries de quêtes).
# Non gérés : « Introduction des Dofus » et « Dofus Élémentaires » (pas un seul Dofus).
DOFUS = {
    'Dofus Émeraude': [1048], 'Dofus Pourpre': [1101], 'Dofus Turquoise': [1385], 'Dofus Ocre': [5220],
    'Dofus Ivoire': [1622], 'Dofus Ébène': [1704],
    'Dofus Vulbis': [2198],                  # « Rêves de dragons »
    'Dofus du Cauchemar': [5162],            # « Eliocalypse : Réminiscence »
    'Dofus des Veilleurs': [1187],           # « Odyssée en trois dimensions »
    'Dofus Nébuleux': [1188],                # « Je rêvais d'un autre monde » (+ 1 quête, hors succès des Veilleurs)
    'Dofus Argenté': [1679],                 # « D'Incarnam à Astrub »
    'Dofus Abyssal': [1498],                 # « Abysses »
    'Dofus des Glaces': [922],               # « Œuf à la neige »
    'Dofus Forgelave': [1656],               # « Entre le marteau et l'enclume »
    'Dofus Tacheté': [3082],                 # « Un rêve en clair-obscur »
}
# Dofus sans succès : chaîne de quêtes {Dofus: [identifiants de quêtes]}. Vide pour l'instant
# (le Dofus Argenté Scintillant a été retiré à la demande).
QUETES_DIRECTES = {}

def get(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe='[]$')
    return json.loads(subprocess.run(['curl', '-gsS', '-m', '120', f'https://api.dofusdb.fr/{path}?{q}'],
                                     capture_output=True, text=True, check=True).stdout)

def fetch_by_id(path, ids, select):
    """L'API renvoie au plus 50 résultats par requête : on interroge par lots."""
    out, ids = {}, sorted(set(ids))
    for i in range(0, len(ids), 25):
        for x in get(path, {'id[$in][]': ids[i:i + 25], '$limit': 50, '$select[]': select})['data']: out[x['id']] = x
    assert set(ids) <= set(out), set(ids) - set(out)
    return out

def main():
    tops = {a for l in DOFUS.values() for a in l}
    achievements, todo = {}, set(tops)
    while todo:                                           # on charge tout l'arbre de succès
        achievements.update(fetch_by_id('achievements', todo, ['id', 'name', 'need']))
        todo = {s for a in achievements.values() for s in a['need']['achievements']} - set(achievements)

    def collect(aid, own_top, out):
        if aid != own_top and aid in tops: return         # succès de tête d'un autre Dofus
        a = achievements[aid]
        out += [q for q in a['need']['quests'] if q not in out]
        for s in a['need']['achievements']: collect(s, own_top, out)

    quests_of = {}
    for dofus, heads in DOFUS.items():
        qs = []
        for h in heads: collect(h, h, qs)
        quests_of[dofus] = qs
    quests_of.update(QUETES_DIRECTES)
    names = {q: d['name']['fr'] for q, d in fetch_by_id('quests', [q for qs in quests_of.values() for q in qs], ['id', 'name']).items()}

    owners = defaultdict(set)
    for dofus, qs in quests_of.items():
        for q in qs: owners[q].add(dofus)
    pairs, by_name = [], defaultdict(set)
    for dofus, qs in quests_of.items():
        for q in qs:
            if len(owners[q]) > 1: print('quête ignorée (chez plusieurs Dofus):', names[q], file=sys.stderr); continue
            by_name[names[q]].add(dofus)
            if (names[q], dofus) not in pairs: pairs.append((names[q], dofus))
    ambigus = {n for n, d in by_name.items() if len(d) > 1}
    pairs = [(n, d) for n, d in pairs if n not in ambigus]
    out = ["    " + json.dumps([f"À quel Dofus est reliée la quête « {n} » ?", d, PTS, TEMPS, d], ensure_ascii=False) + "," for n, d in pairs]
    (ROOT / 'js/questions/quetes-dofus.js').write_text(
        "// Fichier généré par tools/quetes_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une question par quête de chaque Dofus. Données : DofusDB.\n"
        'export default {\n  cat: "Quêtes",\n  items: [\n' + "\n".join(out) + "\n  ],\n};\n", encoding='utf-8')
    print(len(out), 'questions écrites ;', len(ambigus), 'noms ambigus écartés', file=sys.stderr)
    for d in list(DOFUS) + list(QUETES_DIRECTES): print(f'  {d}: {sum(1 for _, x in pairs if x == d)}', file=sys.stderr)

if __name__ == '__main__': main()
