import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

function envStr(key: string): string {
  const v = import.meta.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

const measurementId = envStr('VITE_FIREBASE_MEASUREMENT_ID');

const firebaseConfig = {
  apiKey: envStr('VITE_FIREBASE_API_KEY'),
  authDomain: envStr('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: envStr('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: envStr('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: envStr('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: envStr('VITE_FIREBASE_APP_ID'),
  ...(measurementId ? { measurementId } : {}),
};

if (import.meta.env.DEV) {
  if (!firebaseConfig.apiKey) {
    console.error(
      '[ZenTeams] Missing VITE_FIREBASE_API_KEY. Copy .env.example to .env, add your Firebase web config, then restart Vite (npm run dev).'
    );
  }
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// App Check temporarily disabled. To restore: import initializeAppCheck + ReCaptchaV3Provider
// from 'firebase/app-check', then initialize with VITE_APPCHECK_RECAPTCHA_SITE_KEY when set.

function createDb() {
  if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    return firestore;
  }
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();
export const storage = getStorage(app);

void (async () => {
  if (typeof window === 'undefined' || !measurementId) return;
  if (await isSupported()) {
    getAnalytics(app);
  }
})();

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
