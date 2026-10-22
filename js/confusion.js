// Mini-jeu « Confusion horaire » (Comte Harebourg) : une Enutrof (le joueur) lance un sort sur le Comte, mais la case visée est tournée
// autour du lanceur selon la couleur de sa confusion. Il faut cliquer la case qui, une fois tournée, tombe sur le Comte.
//   rouge : rotation de 90° dans le sens horaire ; bleue : 180° ; verte : 270° dans le sens horaire (= 90° anti-horaire).
// Repère : x vers le bas-droite de l'écran, y vers le bas-gauche (comme les cases de Dofus vues en isométrique).

export const COULEURS = {
  rouge: { k: 1, hex: '#e53935', nom: 'rouge', angle: '90° dans le sens horaire' },
  bleue: { k: 2, hex: '#2f6bff', nom: 'bleue', angle: '180°' },
  verte: { k: 3, hex: '#2fc24b', nom: 'verte', angle: '270° dans le sens horaire (soit 90° dans le sens anti-horaire)' },
};

// Texte affiché dans le jeu pour chaque confusion (plusieurs écritures de la même rotation) et plage de vie de l'Enutrof qui la déclenche.
export const AFFICHAGE = {
  rouge: ['270° Contre Horaire', 'Contre Horaire 3Pi/2', 'Horaire 1Pi/2', 'Horaire 2Pi/4', 'Contre Horaire 6Pi/4'],
  bleue: ['Horaire 2Pi/2', 'Horaire 4Pi/4', 'Contre Horaire 2Pi/2', 'Contre Horaire 4Pi/4'],
  verte: ['270° Horaire', 'Contre Horaire 1Pi/2', 'Horaire 3Pi/2', 'Contre Horaire 2Pi/4', 'Horaire 6Pi/4'],
};
export const PLAGE_VIE = { rouge: '100 % à 75 %', bleue: '75 % à 25 %', verte: '25 % à 0 %' };
// Encadré « vie + confusion » affiché au-dessus de la scène (HTML).
export const infosScene = scene => `<div class="conf" style="--c:${COULEURS[scene.conf].hex}">
  <div class="pv"><span>❤️ Vie de l'Enutrof : <b>${scene.pv} %</b></span><i style="width:${scene.pv}%"></i></div>
  <ul>${AFFICHAGE[scene.conf].map(t => `<li>${t}</li>`).join('')}</ul></div>`;

// Un quart de tour dans le sens horaire (à l'écran) d'un décalage (dx, dy), répété k fois.
export function tourner([dx, dy], k) {
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
  return [dx, dy];
}
// Case où tombe le sort quand le joueur clique sur « clic ».
export function caseTouchee(scene, clic) {
  const k = COULEURS[scene.conf].k, [dx, dy] = tourner([clic[0] - scene.e[0], clic[1] - scene.e[1]], k);
  return [scene.e[0] + dx, scene.e[1] + dy];
}
// Case sur laquelle il faut cliquer pour toucher le Comte.
export function caseAViser(scene) {
  const k = COULEURS[scene.conf].k, [dx, dy] = tourner([scene.c[0] - scene.e[0], scene.c[1] - scene.e[1]], 4 - k);
  return [scene.e[0] + dx, scene.e[1] + dy];
}
export const lireCase = t => { const m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(String(t ?? '')); return m ? [+m[1], +m[2]] : null; };
export const estJuste = (scene, t) => { const c = lireCase(t), v = caseAViser(scene); return !!c && c[0] === v[0] && c[1] === v[1]; };

// --- Dessin ---
const W = 64, H = 32, HAUT = 70;   // largeur / hauteur d'une case, marge en haut pour les personnages
const IMG = {};
const charge = src => IMG[src] || (IMG[src] = Object.assign(new Image(), { src }));

// Crée la scène dans un <canvas>. opts : { surClic(x, y) } ; renvoie { dessiner({ choix, marques, solution }) }.
export function creerScene(canvas, scene, opts = {}) {
  const n = scene.n, ctx = canvas.getContext('2d');
  canvas.width = n * W; canvas.height = n * H + HAUT + 10;
  const ox = n * W / 2, oy = HAUT;                                  // position à l'écran de la case (0, 0)
  const centre = (x, y) => [ox + (x - y) * W / 2, oy + (x + y) * H / 2 + H / 2];
  let survol = null, etat = { choix: null, marques: [], solution: null };
  const losange = (x, y, marge = 0) => {
    const [cx, cy] = centre(x, y);
    ctx.beginPath(); ctx.moveTo(cx, cy - H / 2 + marge); ctx.lineTo(cx + W / 2 - marge * 2, cy); ctx.lineTo(cx, cy + H / 2 - marge); ctx.lineTo(cx - W / 2 + marge * 2, cy); ctx.closePath();
  };
  const caseSous = (px, py) => {   // inverse de « centre » : case sous le pointeur, ou null
    const a = (px - ox) / (W / 2), b = (py - oy - H / 2) / (H / 2);   // a = x - y ; b = x + y
    const x = Math.round((a + b) / 2), y = Math.round((b - a) / 2);
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    const [cx, cy] = centre(x, y);
    return Math.abs(px - cx) / (W / 2) + Math.abs(py - cy) / (H / 2) <= 1 ? [x, y] : null;
  };
  const pointeur = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  function sprite(src, x, y, haut) {   // personnage découpé sans marge : les pieds sont posés au centre de la case
    const im = charge(src), [cx, cy] = centre(x, y);
    if (im.complete && im.naturalWidth) { const l = haut * im.naturalWidth / im.naturalHeight; ctx.drawImage(im, cx - l / 2, cy + H / 4 - haut, l, haut); }
  }
  function dessiner(e) {
    if (e) etat = { ...etat, ...e };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let s = 0; s <= 2 * (n - 1); s++) for (let x = 0; x < n; x++) {   // du fond vers l'avant
      const y = s - x; if (y < 0 || y >= n) continue;
      losange(x, y); ctx.fillStyle = (x + y) % 2 ? '#c9b98f' : '#d8caa3'; ctx.fill();
      ctx.strokeStyle = 'rgba(70,55,30,.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const col = COULEURS[scene.conf].hex;
    if (etat.solution) {   // correction : bonne case, et trajet du sort vers le Comte
      const [sx, sy] = etat.solution; losange(sx, sy); ctx.fillStyle = 'rgba(46,204,113,.55)'; ctx.fill(); ctx.strokeStyle = '#1e9e53'; ctx.lineWidth = 3; ctx.stroke();
      const a = centre(...scene.e), b = centre(sx, sy), c = centre(...scene.c);
      ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#1e9e53';
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...c); ctx.stroke(); ctx.setLineDash([]);
    }
    if (survol && !etat.solution && opts.surClic && (!etat.choix || survol[0] !== etat.choix[0] || survol[1] !== etat.choix[1])) {
      losange(...survol); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    }
    if (etat.choix) { losange(...etat.choix); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.stroke(); }
    // personnages, dans l'ordre d'affichage (le plus en arrière d'abord)
    const persos = [{ p: scene.e, src: 'img/confusion/enutrof.png', nom: 'Enutrof', halo: col }, { p: scene.c, src: 'img/confusion/comte.png', nom: 'Comte Harebourg' }]
      .sort((u, v) => (u.p[0] + u.p[1]) - (v.p[0] + v.p[1]));
    persos.forEach(o => {
      const [cx, cy] = centre(...o.p);
      if (o.halo) { ctx.beginPath(); ctx.ellipse(cx, cy, W * .36, H * .38, 0, 0, 7); ctx.strokeStyle = o.halo; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = o.halo + '55'; ctx.fill(); }
      sprite(o.src, o.p[0], o.p[1], o.nom === 'Enutrof' ? 72 : 82);
      ctx.font = 'bold 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
      const ty = cy - (o.nom === 'Enutrof' ? 62 : 72); ctx.strokeText(o.nom, cx, ty); ctx.fillText(o.nom, cx, ty);
    });
    (etat.marques || []).forEach(m => {   // correction : case cliquée par chaque joueur
      const [cx, cy] = centre(...m.p);
      ctx.beginPath(); ctx.arc(cx + (m.dec || 0), cy, 11, 0, 7); ctx.fillStyle = m.moi ? '#7c5cff' : '#fff'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = m.moi ? '#fff' : '#222'; ctx.font = 'bold 10px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label, cx + (m.dec || 0), cy + 1); ctx.textBaseline = 'alphabetic';
    });
  }
  (canvas._ecouteurs || []).forEach(([t, f]) => canvas.removeEventListener(t, f));   // la même zone de dessin sert à chaque question
  canvas._ecouteurs = [];
  if (opts.surClic) {
    canvas._ecouteurs = [
      ['mousemove', e => { survol = caseSous(...pointeur(e)); dessiner(); }],
      ['mouseleave', () => { survol = null; dessiner(); }],
      ['click', e => { const c = caseSous(...pointeur(e)); if (c) opts.surClic(c[0], c[1]); }],
    ];
    canvas._ecouteurs.forEach(([t, f]) => canvas.addEventListener(t, f));
  }
  ['enutrof.png', 'comte.png'].forEach(f => { const im = charge('img/confusion/' + f); if (!im.complete) im.addEventListener('load', () => dessiner()); });
  dessiner();
  return { dessiner };
}
