#!/usr/bin/env python3
"""Génère la catégorie « Donjons » : les 4 monstres de la dernière salle (celle du boss) de chaque donjon.

Usage : python3 tools/salle_boss_dofus.py
Écrit : js/questions/donjons.js

Cette fois, DofusDB ne suffit pas : son API sait quels monstres vivent dans un donjon, mais pas dans quelle salle.
Cette information est dans les articles de dofus.jeuxonline.info, qui contiennent un tableau « Salles du donjon »
(une ligne par salle, la dernière étant celle du boss). On combine donc deux sources :
  - jeuxonline : l'index des donjons (nom, identifiant du boss, lien de l'article) puis le tableau de chaque article,
    c'est du vrai scraping HTML, avec des expressions régulières ;
  - DofusDB : le nom officiel du donjon et du boss, à partir de l'identifiant du boss (la « clé » commune aux deux sites).
    Quand plusieurs boss partagent un même donjon dans DofusDB, on utilise à la place le nom du donjon de jeuxonline.

Les étapes : 1. récupérer  2. extraire  3. contrôler  4. écrire.
Le tableau d'un article liste 8 entrées par salle : le groupe de 4 monstres rencontré en combat, puis une
seconde série. Les 4 PREMIÈRES entrées correspondent aux captures de combat (vérifié à l'œil sur le Bouftou Royal,
le Korriandre et Guerre). Un monstre présent deux fois parmi les 4 s'écrit « Nom ×2 ».
Est ignoré et signalé (mieux vaut une question en moins qu'une réponse fausse) tout donjon dont l'article n'a pas de
tableau, dont la dernière salle n'a pas exactement 8 entrées, dont les 4 premières ne contiennent pas le boss,
ou dont un nom de monstre est manifestement du texte parasite.
"""
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOL = "https://dofus.jeuxonline.info"
DOFUSDB = "https://api.dofusdb.fr"
PTS, TEMPS = 3, 60
NB_MONSTRES = 4      # taille du groupe rencontré en combat
TAILLE_TABLEAU = 8   # entrées par salle dans les articles jeuxonline : 2 groupes de 4
NOM_MAX = 40         # au-delà, ce n'est pas un nom de monstre (texte parasite de la page)
PAUSE = 0.3  # politesse envers le serveur


# --------------------------------------------------------------------------- 1. récupérer
def telecharger(url, essais=3):
    # Certains sites refusent les requêtes sans « User-Agent » : on se présente comme un navigateur.
    requete = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for n in range(essais):
        try:
            with urllib.request.urlopen(requete, timeout=60) as r:
                time.sleep(PAUSE)
                return r.read().decode("utf-8", errors="replace")
        except OSError:
            if n == essais - 1:
                raise
            time.sleep(2 ** (n + 1))


def get_json(path, params):
    q = urllib.parse.urlencode(params, doseq=True, safe="[]$")
    return json.loads(telecharger(f"{DOFUSDB}/{path}?{q}"))


def sans_accent(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if not unicodedata.combining(c)).lower().strip()


def fiches_index():
    """L'index liste une « fiche » par donjon : <div data-bossid=… data-donjon=… class="fiche-donjon">."""
    page = telecharger(f"{JOL}/donjons")
    fiches = []
    for m in re.finditer(r'<div data-bossid="([^"]*)" data-bossname="([^"]*)" data-niveau="[^"]*" '
                         r'data-donjon="([^"]*)" class="fiche-donjon">(.*?)(?=<div data-bossid=|\Z)', page, flags=re.S):
        boss_id, boss, donjon, corps = m.groups()
        lien = re.search(r'href="((?:https?://dofus\.jeuxonline\.info)?/article/[^"#]+)"[^>]*>\s*Détails du donjon', corps)
        if lien and boss_id.isdigit():
            url = lien.group(1)
            fiches.append({"boss_id": int(boss_id), "boss": html.unescape(boss), "donjon": html.unescape(donjon),
                           "url": url if url.startswith("http") else JOL + url})
    return fiches


def noms_dofusdb(fiches):
    """Nom officiel du donjon et du boss, via l'identifiant du boss."""
    donjons, page, skip = [], 50, 0
    while True:
        r = get_json("dungeons", {"$limit": page, "$skip": skip, "$select[]": ["id", "name", "bosses"]})
        donjons += r["data"]
        skip += len(r["data"])
        if not r["data"] or skip >= r["total"]:
            break
    par_boss = {b: d["name"]["fr"] for d in donjons for b in d["bosses"]}
    ids = sorted({f["boss_id"] for f in fiches})
    monstres = {}
    for i in range(0, len(ids), 50):
        for m in get_json("monsters", {"id[$in][]": ids[i:i + 50], "$limit": 50, "$select[]": ["id", "name"]})["data"]:
            monstres[m["id"]] = m["name"]["fr"]
    return par_boss, monstres


# --------------------------------------------------------------------------- 2. extraire
def derniere_salle(page):
    """Renvoie (titre de la dernière salle, [noms des monstres]) ou None si l'article n'a pas de tableau."""
    debut = page.find("Salles du donjon")
    if debut < 0:
        return None
    fin = page.find("<h2", debut + 20)
    salles = re.findall(r'<th colspan="\d">([^<]*)</th>.*?<td>\s*((?:(?!</td>).)*?)\s*</td>\s*</tr>',
                        page[debut:fin if fin > 0 else None], flags=re.S)
    if not salles:
        return None
    titre, cellule = salles[-1]
    # Certains noms sont enveloppés dans un lien d'infobulle dont l'attribut title contient lui-même du HTML (des « > ») :
    # on retire donc les balises en respectant les guillemets, et pas avec un simple <[^>]+>.
    balise = r"<(?:[^>\"']|\"[^\"]*\"|'[^']*')*>"
    lignes = [html.unescape(re.sub(balise, "", x)).strip() for x in re.split(r"<br\s*/?>", cellule) if x.strip()]
    # « Bouftou Royal (30) », « (209) Nocturlabe » ou « Dodox 212) » (parenthèse oubliée dans la source) -> le nom seul,
    # avec une majuscule initiale (« kardorim » est écrit en minuscules sur la page).
    noms = [re.sub(r"\s+", " ", re.sub(r"[()]|\b\d+\b", " ", l)).strip() for l in lignes]
    noms = [n[:1].upper() + n[1:] for n in noms]
    return titre.strip(), noms


def formater(noms):
    """['Abrazif', 'Abrazif', 'Mérulette'] -> « Abrazif ×2, Mérulette » (ordre d'apparition conservé)."""
    effectifs = Counter(sans_accent(n) for n in noms)
    vus, out = set(), []
    for n in noms:
        cle = sans_accent(n)
        if cle not in vus:
            vus.add(cle)
            out.append(f"{n} ×{effectifs[cle]}" if effectifs[cle] > 1 else n)
    return ", ".join(out)


# --------------------------------------------------------------------------- 3. contrôler + 4. écrire
def main():
    fiches = fiches_index()
    par_boss, monstres = noms_dofusdb(fiches)
    # DofusDB range parfois plusieurs boss sous un même donjon (ex. les Cavaliers de l'Eliocalypse, tous dans
    # « Tempête de l'Eliocalypse »). Dans ce cas son nom n'identifie plus le donjon : on prend celui de jeuxonline
    # (« Trône de sang », « Sentence de la balance »…), propre à chaque boss. Sinon on garde le nom officiel de DofusDB.
    partages = Counter(par_boss.get(f["boss_id"]) for f in fiches)
    # Un même article peut décrire deux donjons (Minotot / Minotoror) : sa « dernière salle » ne dit alors pas
    # laquelle est celle de CE boss, donc on n'écrit aucune des deux questions.
    articles = Counter(f["url"] for f in fiches)
    items, ignores, deja = [], [], set()
    for f in fiches:
        officiel = par_boss.get(f["boss_id"])
        nom = officiel if officiel and partages[officiel] == 1 else f["donjon"]
        if "[RIP]" in nom:
            continue
        if nom in deja:  # deux fiches pour un même nom : on le dit au lieu d'écarter en silence
            ignores.append((nom, "nom de donjon en double"))
            continue
        if articles[f["url"]] > 1:
            ignores.append((nom, "article partagé avec un autre donjon : salle du boss ambiguë"))
            continue
        try:
            salle = derniere_salle(telecharger(f["url"]))
        except OSError as e:  # une page en erreur ne doit pas arrêter tout le script
            ignores.append((nom, f"page inaccessible ({e})"))
            continue
        if not salle:
            ignores.append((nom, "pas de tableau des salles"))
            continue
        tous = salle[1]
        if len(tous) != TAILLE_TABLEAU:
            ignores.append((nom, f"dernière salle de {len(tous)} entrées au lieu de {TAILLE_TABLEAU}"))
            continue
        noms = tous[:NB_MONSTRES]
        if any(len(n) > NOM_MAX or not n for n in noms):
            ignores.append((nom, f"texte parasite à la place d'un nom de monstre ({noms})"))
            continue
        # Contrôle : le boss doit figurer parmi les 4 monstres (nom DofusDB ou nom jeuxonline).
        boss = {sans_accent(f["boss"]), sans_accent(monstres.get(f["boss_id"], ""))}
        if not any(sans_accent(n) in boss for n in noms):
            ignores.append((nom, f"boss absent des 4 premiers monstres ({', '.join(noms)})"))
            continue
        deja.add(nom)
        items.append([f"Quels sont les {NB_MONSTRES} monstres de la dernière salle du donjon « {nom} » ?", formater(noms), PTS, TEMPS])

    lignes = ["    " + json.dumps(i, ensure_ascii=False) + "," for i in items]
    (ROOT / "js/questions/donjons.js").write_text(
        "// Fichier généré par tools/salle_boss_dofus.py : ne pas modifier à la main (relancer le script).\n"
        "// Les 4 monstres de la dernière salle (celle du boss) de chaque donjon.\n"
        'export default {\n  cat: "Donjons",\n  items: [\n' + "\n".join(lignes) + "\n  ],\n};\n", encoding="utf-8")
    print(f"{len(items)} questions écrites ; {len(ignores)} donjons ignorés :", file=sys.stderr)
    for nom, raison in ignores:
        print(f"  - {nom} : {raison}", file=sys.stderr)


if __name__ == "__main__":
    main()
