#!/usr/bin/env python3
"""Génère la catégorie « Sort de classe » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/sorts_dofus.py
Écrit : js/questions/sorts.js  (une question à 10 champs par sort de classe, au rang maximal)
        data/sorts-dofus.json  (les valeurs brutes utilisées, pour relecture)
Relancer le script après une mise à jour du jeu pour rafraîchir les questions.
"""
import json, subprocess, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PTS, TEMPS = 5, 90

def get(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe='[]$')
    out = subprocess.run(['curl', '-gsS', '-m', '120', f'https://api.dofusdb.fr/{path}?{q}'],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def chunks(l, n):
    for i in range(0, len(l), n): yield l[i:i + n]

# Formes de zone (code ASCII de DofusDB) -> nom français.
SHAPES = {'C': 'Cercle', 'X': 'Croix', 'L': 'Ligne', 'T': 'Ligne perpendiculaire', 'G': 'Carré',
          '+': 'Croix diagonale', 'V': 'Cône', 'O': 'Anneau', 'U': 'Demi-cercle', '*': 'Étoile',
          'F': 'Fourchette', 'Q': 'Croix avec un trou', 'R': 'Rectangle', 'D': 'Damier'}
DAMAGE_OR_HEAL = {91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 108}   # vols de vie, dommages, soin
POINT, ALL_A, ALL_a = ord('P'), ord('A'), ord('a')

def zone_text(e):
    shape, size, hole = chr(e['zone']), e['p1'], e['p2']
    if shape == 'l': return "Zone : ligne jusqu'à la cible"
    if shape not in SHAPES: return f"Zone : forme inconnue (code « {shape} », à vérifier)"
    name = SHAPES[shape]
    cases = lambda n: f"{n} case" + ("s" if n > 1 else "")
    txt = f"Zone : {name} de {cases(size)}" if size != 63 else f"Zone : {name} illimitée"
    return txt + (f" avec un trou de {cases(hole)}" if hole else "")

def main_zone(effects):
    """Zone la plus grande parmi les effets de dommages/soin (à défaut, parmi tous les effets zonés)."""
    zoned = lambda es: [e for e in es if e['zone'] not in (POINT, ALL_A, ALL_a)]
    pool = zoned([e for e in effects if e['effectId'] in DAMAGE_OR_HEAL]) or zoned(effects)
    return max(pool, key=lambda e: 99 if e['p1'] == 63 else e['p1']) if pool else None

def count(v, zero): return zero if v == 0 else str(v)

def build(l):
    z = main_zone(l['effects'])
    return [
        ["Portée min / max", f"{l['minRange']} / {l['range']}"],
        ["Portée modifiable ?", "Oui" if l['rangeCanBeBoosted'] else "Non"],
        ["Ligne de vue ?", "Oui" if l['castTestLos'] else "Non"],
        ["Monocible ou zone ? (précisez la zone)", zone_text(z) if z else "Monocible"],
        ["Nécessite une cible ?", "Oui" if l['needTakenCell'] else "Non"],
        ["Utilisations par tour", count(l['maxCastPerTurn'], "Illimité")],
        ["Utilisations par cible", count(l['maxCastPerTarget'], "Illimité")],
        ["Tours de relance", count(l['minCastInterval'], "Aucun")],
        ["Relance globale", count(l['globalCooldown'], "Aucune")],
        ["Intervalle de relance initial", count(l['initialCooldown'], "Aucun")],
    ]

def main():
    breeds = get('breeds', {'$limit': 50})['data']
    breeds.sort(key=lambda b: b['id'])
    spells = {}
    for b in breeds:
        for ids in chunks(b['breedSpellsId'], 25):
            for s in get('spells', {'id[$in][]': ids, '$limit': 50, '$select[]': ['id', 'name']})['data']:
                spells[s['id']] = s['name']['fr']
    best = {}
    for ids in chunks(list(spells), 10):
        r = get('spell-levels', {'spellId[$in][]': ids, '$limit': 100})
        assert r['total'] <= 100
        for l in r['data']:
            if l['spellId'] not in best or l['grade'] > best[l['spellId']]['grade']: best[l['spellId']] = l
    lines, dump = [], []
    for b in breeds:
        cls = b['shortName']['fr']
        for sid in b['breedSpellsId']:
            if sid not in best: continue
            l = best[sid]
            champs = build({**l, 'effects': [{'effectId': e['effectId'], 'zone': e['zoneDescr']['shape'],
                                              'p1': e['zoneDescr']['param1'], 'p2': e['zoneDescr']['param2']} for e in l['effects']]})
            q = f"Sort « {spells[sid]} » ({cls}), au rang maximal (niveau {l['grade']})"
            lines.append("    " + json.dumps({'q': q, 'champs': champs, 'pts': PTS, 'temps': TEMPS}, ensure_ascii=False) + ",")
            dump.append({'classe': cls, 'sort': spells[sid], 'id': sid, 'niveau': l['grade'], **{c[0]: c[1] for c in champs}})
    (ROOT / 'js/questions/sorts.js').write_text(
        "// Fichier généré par tools/sorts_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une question à 10 champs par sort de classe, au rang maximal. Données : DofusDB.\n"
        'export default {\n  cat: "Sort de classe",\n  items: [\n' + "\n".join(lines) + "\n  ],\n};\n", encoding='utf-8')
    (ROOT / 'data/sorts-dofus.json').write_text(json.dumps(dump, ensure_ascii=False, indent=1), encoding='utf-8')
    print(len(lines), 'questions écrites', file=sys.stderr)

if __name__ == '__main__': main()
