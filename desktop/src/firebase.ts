import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Same web app configs as the iOS Nucleus app — Firebase web apiKeys
// are public identifiers; access is enforced by Firestore Security Rules.
// See BRIDGE.md §1 for the full rationale.
//
// Two projects: live (the family's data) and staging (fake households for
// trying changes). `npm run dev` uses staging; a packaged build uses live.
// VITE_NUCLEUS_ENV=live|staging overrides either.
const FIREBASE_CONFIGS = {
  live: {
    apiKey: "AIzaSyDgRavOYvAYbw2nVmOUG_CT8Klifl24Xbk",
    authDomain: "schedule-buddy-dd2cf.firebaseapp.com",
    projectId: "schedule-buddy-dd2cf",
    storageBucket: "schedule-buddy-dd2cf.firebasestorage.app",
    messagingSenderId: "751719086344",
    appId: "1:751719086344:web:d831238f5039d29d17d4bd",
  },
  staging: {
    apiKey: "AIzaSyD5RWmvRWqrp0GKZeOcxqZPw1Ja8z2Pbog",
    authDomain: "schedule-buddy-staging.firebaseapp.com",
    projectId: "schedule-buddy-staging",
    storageBucket: "schedule-buddy-staging.firebasestorage.app",
    messagingSenderId: "713442891579",
    appId: "1:713442891579:web:c68260e15783cbc2c4c91e",
  },
} as const;

export const NUCLEUS_ENV: "live" | "staging" =
  import.meta.env.VITE_NUCLEUS_ENV === "live" || import.meta.env.VITE_NUCLEUS_ENV === "staging"
    ? import.meta.env.VITE_NUCLEUS_ENV
    : import.meta.env.DEV ? "staging" : "live";

const firebaseConfig = FIREBASE_CONFIGS[NUCLEUS_ENV];

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Force long polling instead of WebChannel/QUIC streams. Electron + some
// home networks intermittently break QUIC, which makes the Firestore
// onSnapshot listener appear dead until the app is fully restarted.
// Long polling is slightly slower per-message but vastly more reliable
// for long-running desktop sessions.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
// Always offer Google's account picker, rather than silently reusing the last
// account — so someone with several accounts (or a shared Mac) can choose.
googleProvider.setCustomParameters({ prompt: "select_account" });

export const appleProvider = new OAuthProvider("apple.com");
appleProvider.addScope("email");
appleProvider.addScope("name");
