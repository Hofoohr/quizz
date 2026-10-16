// Chat du salon : une bulle 💬 en bas à droite, visible dès qu'on est dans un salon (attente, jeu, correction, résultats).
import { db, ref, set, onValue, serverNow } from "./firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const MAX_SHOWN = 100, MAX_LEN = 200, COOLDOWN_MS = 800;

let ctx = null, off = null, msgs = [], open = false, seen = 0, lastSent = 0;

function render() {
  const box = $('chat-msgs');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.innerHTML = msgs.map(m => `<div class="msg${m.uid === ctx.uid ? ' mine' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</div>`).join('')
    || '<p class="hint">Aucun message pour l\'instant.</p>';
  if (stick || open) box.scrollTop = box.scrollHeight;
  if (open) seen = msgs.length;
  const unread = Math.max(0, msgs.length - seen);
  $('chat-badge').hidden = !unread;
  $('chat-badge').textContent = unread > 9 ? '9+' : unread;
}

function setOpen(v) {
  open = v;
  $('chat-panel').hidden = !v;
  if (v) { seen = msgs.length; render(); $('chat-text').focus(); }
}

function send() {
  const text = $('chat-text').value.trim().slice(0, MAX_LEN);
  const now = Date.now();
  if (!text || !ctx || now - lastSent < COOLDOWN_MS) return;
  lastSent = now;
  $('chat-text').value = '';
  const id = serverNow().toString(36) + ctx.uid.slice(0, 6) + Math.random().toString(36).slice(2, 5);
  set(ref(db, `rooms/${ctx.code}/chat/${id}`), { uid: ctx.uid, name: ctx.name().slice(0, 20), text, at: serverNow() }).catch(console.error);
}

$('chat-btn').onclick = () => setOpen(!open);
$('chat-close').onclick = () => setOpen(false);
$('chat-form').onsubmit = e => { e.preventDefault(); send(); };

// c = { code, uid, name: () => pseudo du joueur }
export function start(c) {
  stop();
  ctx = c; msgs = []; seen = 0;
  $('chat').hidden = false;
  off = onValue(ref(db, `rooms/${c.code}/chat`), s => {
    msgs = Object.values(s.val() || {}).sort((a, b) => a.at - b.at).slice(-MAX_SHOWN);
    if (seen === 0 && !open && msgs.length && !start.first) seen = msgs.length;   // l'historique déjà là n'est pas « non lu »
    start.first = true;
    render();
  });
  render();
}

export function stop() {
  if (off) { off(); off = null; }
  ctx = null; msgs = []; start.first = false;
  $('chat').hidden = true; setOpen(false);
}
