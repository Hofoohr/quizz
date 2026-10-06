#!/usr/bin/env python3
"""Génère les questions sur les items légendaires à partir de DofusDB (api.dofusdb.fr).

Usage : python3 tools/legendaires_dofus.py
Écrit : js/questions/legendaires.js  (catégorie « Légendaire »)
  - « Quel est le bonus passif de l'item légendaire X ? »  -> le passif (nom et effet)
  - « Quel item légendaire possède ce passif : … ? »        -> l'item (le titre du passif est retiré de l'énoncé, il cite souvent l'item)
Le passif est le sort rattaché à l'item par l'effet 1175. Relancer le script après une mise à jour du jeu.
"""
import json, re, subprocess, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EFFET_PASSIF = 1175
PTS_PASSIF, TEMPS_PASSIF = 3, 45          # « quel est le passif de l'item ? »
PTS_ITEM, TEMPS_ITEM = 2, 30              # « quel item a ce passif ? »

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

def clean(text):
    text = re.sub(r'\{\{[a-z]+,\d+::([^}]*)\}\}', r'\1', text or '')
    return re.sub(r'\s*\n\s*', ' ', text).strip()

def main():
    items = sorted(get_all('items', {'isLegendary': 'true', '$select[]': ['id', 'name', 'possibleEffects']}), key=lambda x: x['id'])
    ids = sorted({e['diceNum'] for it in items for e in it['possibleEffects'] if e['effectId'] == EFFET_PASSIF})
    spells = {}
    for i in range(0, len(ids), 25):
        for s in get('spells', {'id[$in][]': ids[i:i + 25], '$limit': 50, '$select[]': ['id', 'name', 'description']})['data']: spells[s['id']] = s
    rows = []
    for it in items:
        textes = [clean(spells[e['diceNum']]['description']['fr']) for e in it['possibleEffects']
                  if e['effectId'] == EFFET_PASSIF and e['diceNum'] in spells]
        textes = [t for t in textes if t]
        if not textes: print('ignoré (pas de passif):', it['name']['fr'], file=sys.stderr); continue
        passif = " ".join(textes)
        corps = re.sub(r'^[^•]*?\s*:\s*(?=•)', '', passif)          # retire le titre « Nom du passif : »
        if it['name']['fr'].lower() in corps.lower(): print('attention : le texte cite l\'item :', it['name']['fr'], file=sys.stderr)
        rows.append((it['name']['fr'], passif, corps))
    assert len({c for _, _, c in rows}) == len(rows), "deux items ont le même passif : question inverse ambiguë"
    out = []
    for nom, passif, _ in rows:
        out.append([f"Quel est le bonus passif de l'item légendaire « {nom} » ?", passif, PTS_PASSIF, TEMPS_PASSIF])
    for nom, _, corps in rows:
        out.append([f"Quel item légendaire possède ce passif : {corps} ?", nom, PTS_ITEM, TEMPS_ITEM])
    lines = ["    " + json.dumps(o, ensure_ascii=False) + "," for o in out]
    (ROOT / 'js/questions/legendaires.js').write_text(
        "// Fichier généré par tools/legendaires_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Items légendaires : le passif de chaque item, puis l'item correspondant à chaque passif. Données : DofusDB.\n"
        'export default {\n  cat: "Légendaire",\n  items: [\n' + "\n".join(lines) + "\n  ],\n};\n", encoding='utf-8')
    print(len(out), 'questions écrites', file=sys.stderr)

if __name__ == '__main__': main()
