#!/usr/bin/env python3
"""Génère des questions « Quels items composent cette panoplie ? » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/panoplies_dofus.py
Écrit : js/questions/panoplies.js  (catégorie « Items », une question par panoplie)
Les panoplies cosmétiques (apparence) sont ignorées. Relancer le script après une mise à jour du jeu.
"""
import json, subprocess, sys, urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PTS, TEMPS = 4, 50
INCLURE_COSMETIQUES = False
# Ordre d'affichage des emplacements ; les armes sont regroupées sous « Arme ».
ORDRE = ['Chapeau', 'Cape', 'Amulette', 'Anneau', 'Ceinture', 'Bottes', 'Arme', 'Bouclier', 'Familier']

def get(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe='[]$')
    return json.loads(subprocess.run(['curl', '-gsS', '-m', '120', f'https://api.dofusdb.fr/{path}?{q}'],
                                     capture_output=True, text=True, check=True).stdout)

def get_all(path, params, page=100):
    out, skip = [], 0
    while True:
        r = get(path, {**params, '$limit': page, '$skip': skip})
        out += r['data']; skip += len(r['data'])
        if not r['data'] or skip >= r['total']: return out

def main():
    sets = get_all('item-sets', {'$select[]': ['id', 'name', 'isCosmetic', 'level']})
    items = get_all('items', {'itemSetId[$gt]': 0, '$select[]': ['id', 'name', 'typeId', 'itemSetId', 'level']})
    types = {t['id']: t for t in get_all('item-types', {'$select[]': ['id', 'name', 'superTypeId']})}
    supers = {s['id']: s['name']['fr'] for s in get_all('item-super-types', {'$select[]': ['id', 'name']})}
    by_set = defaultdict(list)
    for i in items: by_set[i['itemSetId']].append(i)

    def slot(item):
        t = types[item['typeId']]
        sup = supers.get(t['superTypeId'], t['name']['fr'])
        # Arme -> « Arme (Épée) » pour préciser le type d'arme ; sinon le nom du type (Anneau, Bottes…).
        return ('Arme', t['name']['fr']) if sup == 'Arme' else (t['name']['fr'], None)

    sets = sorted((s for s in sets if (INCLURE_COSMETIQUES or not s.get('isCosmetic')) and len(by_set[s['id']]) >= 2),
                  key=lambda s: s['id'])
    names = Counter(s['name']['fr'] for s in sets)
    lines = []
    for s in sets:
        slots = [slot(i) for i in by_set[s['id']]]
        cnt = Counter(k for k, _ in slots)
        parts = []
        for k in sorted(cnt, key=lambda k: ORDRE.index(k) if k in ORDRE else len(ORDRE)):
            label = k + (f" ({', '.join(w for kk, w in slots if kk == k)})" if k == 'Arme' else '')
            parts.append(label + (f" ×{cnt[k]}" if cnt[k] > 1 and k != 'Arme' else ''))
        nom = s['name']['fr']
        q = f"Quels items composent la « {nom} » ?" + (f" (niveau {s['level']})" if names[nom] > 1 else '')
        # Niveau pour équiper la panoplie complète = niveau de son item le plus élevé (vérifié : égal au champ « level » du set).
        niveau = max(i['level'] for i in by_set[s['id']])
        champs = [["Nombre d'items", str(len(slots))], ["Types d'items (Chapeau, Cape, Anneau…)", ", ".join(parts)],
                  ["Niveau requis pour équiper toute la panoplie", str(niveau)]]
        lines.append("    " + json.dumps({'q': q, 'champs': champs, 'pts': PTS, 'temps': TEMPS}, ensure_ascii=False) + ",")
    (ROOT / 'js/questions/panoplies.js').write_text(
        "// Fichier généré par tools/panoplies_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une question par panoplie (hors cosmétiques) : nombre d'items, types d'items et niveau requis. Données : DofusDB.\n"
        'export default {\n  cat: "Items",\n  items: [\n' + "\n".join(lines) + "\n  ],\n};\n", encoding='utf-8')
    print(len(lines), 'questions écrites', file=sys.stderr)

if __name__ == '__main__': main()
