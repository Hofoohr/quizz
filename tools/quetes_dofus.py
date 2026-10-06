#!/usr/bin/env python3
"""Génère des questions « À quel Dofus est reliée cette quête ? » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/quetes_dofus.py
Écrit : js/questions/quetes-dofus.js  (catégorie « Quêtes », une question par quête de chaque série de Dofus)
Source : les succès de série de quêtes de chaque Dofus (liste des quêtes dans need.quests).
Relancer le script après une mise à jour du jeu.
"""
import json, subprocess, sys, urllib.parse
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PTS, TEMPS = 2, 20
# Succès listant les quêtes d'un Dofus -> Dofus. Les nouvelles séries se placent à la fin : l'identifiant des questions existantes ne change pas.
# (« Introduction des Dofus » et « Dofus Élémentaires » ne désignent pas un seul Dofus : ignorées.)
SERIES = {1048: 'Dofus Émeraude', 1101: 'Dofus Pourpre', 1385: 'Dofus Turquoise',
          5220: 'Dofus Ocre', 1622: 'Dofus Ivoire', 1704: 'Dofus Ébène',
          2198: 'Dofus Vulbis',            # succès « Rêves de dragons » (récompense : Dofus Vulbis)
          5162: 'Dofus du Cauchemar',      # succès « Eliocalypse : Réminiscence » (récompense : Dofus du Cauchemar)
          # Dofus des Veilleurs : récompense du succès « Odyssée en trois dimensions », qui regroupe ces 4 succès de quêtes.
          1072: 'Dofus des Veilleurs', 1102: 'Dofus des Veilleurs', 1142: 'Dofus des Veilleurs', 1186: 'Dofus des Veilleurs'}

def get(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe='[]$')
    return json.loads(subprocess.run(['curl', '-gsS', '-m', '120', f'https://api.dofusdb.fr/{path}?{q}'],
                                     capture_output=True, text=True, check=True).stdout)

def main():
    achievements = {a['id']: a for a in get('achievements', {'id[$in][]': list(SERIES), '$limit': 50,
                                                             '$select[]': ['id', 'name', 'need']})['data']}
    quest_ids = sorted({q for a in achievements.values() for q in a['need']['quests']})
    names = {}
    for i in range(0, len(quest_ids), 25):             # l'API renvoie au plus 50 résultats par requête
        for q in get('quests', {'id[$in][]': quest_ids[i:i + 25], '$limit': 50, '$select[]': ['id', 'name']})['data']:
            names[q['id']] = q['name']['fr']
    assert set(quest_ids) <= set(names), set(quest_ids) - set(names)
    owners = defaultdict(set)
    for aid, dofus in SERIES.items():
        for q in achievements[aid]['need']['quests']: owners[q].add(dofus)
    lines, seen = [], defaultdict(set)
    for aid, dofus in SERIES.items():              # ordre des séries, puis ordre des quêtes dans la série
        for q in achievements[aid]['need']['quests']:
            if len(owners[q]) > 1: print('quête ignorée (dans plusieurs séries):', names[q], file=sys.stderr); continue
            seen[names[q]].add(dofus)
            lines.append((names[q], dofus))
    ambiguous = {n for n, d in seen.items() if len(d) > 1}          # même nom de quête dans deux séries
    lines = [(n, d) for n, d in lines if n not in ambiguous]
    out = ["    " + json.dumps([f"À quel Dofus est reliée la quête « {n} » ?", d, PTS, TEMPS], ensure_ascii=False) + "," for n, d in lines]
    (ROOT / 'js/questions/quetes-dofus.js').write_text(
        "// Fichier généré par tools/quetes_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une question par quête des séries de quêtes des Dofus. Données : DofusDB.\n"
        'export default {\n  cat: "Quêtes",\n  items: [\n' + "\n".join(out) + "\n  ],\n};\n", encoding='utf-8')
    print(len(out), 'questions écrites ;', len(ambiguous), 'noms ambigus ignorés', file=sys.stderr)

if __name__ == '__main__': main()
