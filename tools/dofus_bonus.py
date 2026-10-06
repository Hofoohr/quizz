#!/usr/bin/env python3
"""Génère les questions « Quels sont les bonus fixes et le passif du Dofus X ? » à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/dofus_bonus.py
Écrit : js/questions/dofus.js  (catégorie « Items », une question par Dofus)

- Bonus fixes : les effets de caractéristiques de l'item (ex. « +80 Puissance », « +4% Résistance Feu »).
- Passif : le sort rattaché au Dofus par l'effet 1175 (ex. « Bleu Turquoise »), avec sa description.
Les Dofus qui n'ont ni bonus ni passif sont ignorés ; si deux Dofus portent le même nom, on garde le plus renseigné.
Relancer le script après une mise à jour du jeu.
"""
import json, re, subprocess, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PTS, TEMPS = 4, 60
TYPE_DOFUS = 23
EFFET_PASSIF = 1175       # diceNum = identifiant du sort passif

def get(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe='[]$')
    return json.loads(subprocess.run(['curl', '-gsS', '-m', '120', f'https://api.dofusdb.fr/{path}?{q}'],
                                     capture_output=True, text=True, check=True).stdout)

def get_all(path, params, page=50):
    out, skip = [], 0
    while True:
        r = get(path, {**params, '$limit': page, '$skip': skip})
        out += r['data']; skip += len(r['data'])
        if not r['data'] or skip >= r['total']: return out

def by_ids(path, ids, select):
    out, ids = {}, sorted(set(ids))
    for i in range(0, len(ids), 25):
        for x in get(path, {'id[$in][]': ids[i:i + 25], '$limit': 50, '$select[]': select})['data']: out[x['id']] = x
    return out

def bonus(e, meta):
    """« +25 Vitalité », « +6 à 30 Prospection »… (None si l'effet n'est pas une caractéristique)."""
    m = meta.get(e['effectId'])
    if not m or not m.get('useDice') or not m.get('characteristic') or not (m.get('description') or {}).get('fr'): return None
    lo, hi = e['diceNum'], e['diceSide']
    txt = re.sub(r'#1\{\{~1~2 à \}\}#2', f"+{lo} à {hi}" if hi else f"+{lo}", m['description']['fr'])
    return re.sub(r'\{\{~ps\}\}\{\{~zs\}\}', 's' if max(lo, hi) > 1 else '', txt).replace('+', '+', 1)

def clean(text):
    text = re.sub(r'\{\{[a-z]+,\d+::([^}]*)\}\}', r'\1', text or '')       # {{item,23408::Dorigami}} -> Dorigami
    return re.sub(r'\s*\n\s*', ' ', text).strip()

def main():
    items = get_all('items', {'typeId': TYPE_DOFUS, '$select[]': ['id', 'name', 'level', 'possibleEffects']})
    meta = by_ids('effects', [e['effectId'] for it in items for e in it['possibleEffects']],
                  ['id', 'characteristic', 'useDice', 'description'])
    spells = by_ids('spells', [e['diceNum'] for it in items for e in it['possibleEffects'] if e['effectId'] == EFFET_PASSIF],
                    ['id', 'name', 'description'])
    rows = {}
    for it in sorted(items, key=lambda x: x['id']):
        bonuses = [b for b in (bonus(e, meta) for e in it['possibleEffects']) if b]
        passifs = [clean(spells[e['diceNum']]['description']['fr']) for e in it['possibleEffects']
                   if e['effectId'] == EFFET_PASSIF and e['diceNum'] in spells]
        passifs = [p for p in passifs if p]
        if not bonuses and not passifs: print('ignoré (aucune info):', it['name']['fr'], it['id'], file=sys.stderr); continue
        nom = it['name']['fr']
        poids = len(bonuses) + sum(map(len, passifs))
        if nom not in rows or poids > rows[nom][0]: rows[nom] = (poids, bonuses, passifs)
    lines = []
    for nom, (_, bonuses, passifs) in rows.items():
        champs = [["Bonus fixes", ", ".join(bonuses) or "Aucun"], ["Passif", " ".join(passifs) or "Aucun"]]
        q = f"Quels sont les bonus fixes et le passif du « {nom} » ?"
        lines.append("    " + json.dumps({'q': q, 'champs': champs, 'pts': PTS, 'temps': TEMPS}, ensure_ascii=False) + ",")
    (ROOT / 'js/questions/dofus.js').write_text(
        "// Fichier généré par tools/dofus_bonus.py : ne pas modifier à la main (relancer le script).\n"
        "// Une question par Dofus : bonus fixes et passif. Données : DofusDB.\n"
        'export default {\n  cat: "Items",\n  items: [\n' + "\n".join(lines) + "\n  ],\n};\n", encoding='utf-8')
    print(len(lines), 'questions écrites', file=sys.stderr)

if __name__ == '__main__': main()
