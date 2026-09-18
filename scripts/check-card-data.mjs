import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

const db = getFirestore(app);

async function fetchCollection(name, orderField) {
  const ref = collection(db, name);
  const q = orderField ? query(ref, orderBy(orderField, 'desc')) : ref;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const [cards, txns, cycles] = await Promise.all([
  fetchCollection('creditCards', 'createdAt'),
  fetchCollection('cardTransactions', 'date'),
  fetchCollection('cardBillingCycles'),
]);

console.log(JSON.stringify({ creditCards: cards, cardTransactions: txns, cardBillingCycles: cycles }, null, 2));
console.error('\n--- Summary ---');
console.error(`creditCards: ${cards.length}`);
console.error(`cardTransactions: ${txns.length}`);
console.error(`cardBillingCycles: ${cycles.length}`);

process.exit(0);
