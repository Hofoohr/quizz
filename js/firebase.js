// Version du SDK Firebase utilisée (modifiable : remplace les numéros ci-dessous).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export { ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getDatabase(app);

// Connexion anonyme : chaque navigateur garde le même identifiant d'un passage à l'autre.
export async function signIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

// Horloge du serveur : tous les joueurs se basent sur la même heure, quelle que soit leur horloge locale.
let offset = 0;
export const clockReady = new Promise(resolve => {
  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; resolve(); });
});
export const serverNow = () => Date.now() + offset;
