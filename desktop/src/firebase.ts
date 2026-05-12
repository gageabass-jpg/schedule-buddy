import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Same web app config as the iOS Schedule Buddy app — Firebase web apiKeys
// are public identifiers; access is enforced by Firestore Security Rules.
// See BRIDGE.md §1 for the full rationale.
const firebaseConfig = {
  apiKey: "AIzaSyDgRavOYvAYbw2nVmOUG_CT8Klifl24Xbk",
  authDomain: "schedule-buddy-dd2cf.firebaseapp.com",
  projectId: "schedule-buddy-dd2cf",
  storageBucket: "schedule-buddy-dd2cf.firebasestorage.app",
  messagingSenderId: "751719086344",
  appId: "1:751719086344:web:d831238f5039d29d17d4bd",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
