import { Platform } from 'react-native';
import { reportError } from './errorReporting';
import { initializeApp } from 'firebase/app';
// firebase/auth's own package.json exports map has no "react-native"
// condition (only node/browser/default), so it resolves to the web build
// and silently lacks getReactNativePersistence - importing straight from
// the underlying @firebase/auth package instead, whose exports map does
// declare "react-native" and re-exports the full shared auth API plus the
// RN persistence helper. getReactNativePersistence itself throws on web
// (AsyncStorage-backed persistence is meaningless in a browser, which
// already has its own storage), so auth init below branches on Platform.
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  connectAuthEmulator,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from '@firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  memoryLocalCache,
  connectFirestoreEmulator,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  setDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_CATEGORIES as CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES as TRAVEL_CATEGORIES,
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_CURRENCIES as CURRENCIES,
  DEFAULT_PAYMENT_METHODS as PAYMENT_METHODS,
  normalizeLedger,
  getCardBillingCycleKey,
} from './utils';

// Same project the web app (yash-kothari.github.io/splitkhata) uses - public
// client config, not a secret; access is enforced by firestore.rules, not by
// hiding these values. Pulled from the deployed web bundle.
const firebaseConfig = {
  apiKey: 'AIzaSyBTKCJR836AU5RwRgNnd8JmHpdDCjHwk6g',
  authDomain: 'splitkhata-96cbd.firebaseapp.com',
  projectId: 'splitkhata-96cbd',
  storageBucket: 'splitkhata-96cbd.firebasestorage.app',
  messagingSenderId: '833405553997',
  appId: '1:833405553997:web:eac064e35ec9f0d0b87b04',
};

const ALLOWED_EMAILS = new Set([
  'yash.sk.kothari@gmail.com',
  'kruti.v.sheth@gmail.com',
]);

const app = initializeApp(firebaseConfig);
const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
// persistentLocalCache is backed by IndexedDB, which only exists in a real
// browser - on true React Native (Hermes, no DOM globals) the SDK detects
// its absence, logs a fallback warning, and downgrades to a memory cache
// anyway, so ask for that directly there instead of taking the noisy detour.
// This does mean native doesn't get a cache that survives a full app
// restart while offline the way the web build does (verified against a real
// iOS Simulator build, not just the type definitions) - the plain firebase
// JS SDK's persistent cache is a web-only feature; true native persistence
// would need @react-native-firebase/firestore instead, a larger swap not
// worth it just for this. Web still gets the real persistent cache matching
// enableIndexedDbPersistence behavior (src/firebase.js).
const dbInstance = initializeFirestore(app, {
  localCache: Platform.OS === 'web' ? persistentLocalCache() : memoryLocalCache(),
});

// Opt-in only (EXPO_PUBLIC_USE_FIRESTORE_EMULATOR=true in mobile/.env) - lets
// development point at a disposable local Firestore + Auth (`firebase
// emulators:start --only firestore,auth` from the repo root) instead of the
// real household's data and a real Google account. Default stays off so a
// plain `npx expo run:ios` always talks to prod, matching the web app's
// behavior.
export const IS_DEV_EMULATOR = __DEV__ && process.env.EXPO_PUBLIC_USE_FIRESTORE_EMULATOR === 'true';

if (IS_DEV_EMULATOR) {
  connectFirestoreEmulator(dbInstance, 'localhost', 8080);
  // disableWarnings: the emulator's own "do not use in production" banner is
  // noise here since IS_DEV_EMULATOR already guarantees __DEV__.
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

const expensesRef = collection(dbInstance, 'expenses');
const categoriesRef = collection(dbInstance, 'categories');
const membersRef = collection(dbInstance, 'members');
const tripsRef = collection(dbInstance, 'trips');
const cashMovementsRef = collection(dbInstance, 'cashMovements');
const paymentMethodsRef = collection(dbInstance, 'paymentMethods');
const guestsRef = collection(dbInstance, 'guests');
const currenciesRef = collection(dbInstance, 'currencies');
const creditCardsRef = collection(dbInstance, 'creditCards');
const cardTransactionsRef = collection(dbInstance, 'cardTransactions');
const cardBillingCyclesRef = collection(dbInstance, 'cardBillingCycles');

// Always true on mobile - the Firebase config above is hardcoded, not
// environment-gated the way web's "no config, run in a local-only demo
// mode" branch is. Exists so Settings can share the exact same
// `hasFirebase` check web uses, without needing its local-mode UI at all.
export function isFirebaseConfigured() {
  return true;
}

// Web gates AI Logic behind App Check (reCAPTCHA v3) on top of the base
// config - React Native can't use reCAPTCHA (it's a browser challenge), and
// the native equivalents (App Attest/Play Integrity) need their own Apple/
// Google developer enrollment, so mobile skips App Check entirely for now.
// AI Logic still works without it (App Check only blocks requests once you
// turn on Enforce mode for the API in Firebase Console, which isn't on) -
// this is a deliberate, temporary tradeoff, not a bug.
export function isAiConfigured() {
  return isFirebaseConfigured();
}

// The Gemini service regularly answers "high demand" (HTTP 500/503) for a few
// seconds at a time - retry a couple of times before giving up, and say so in
// plain words instead of surfacing the raw API error.
async function withAiRetry(call) {
  const delays = [1500, 3500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (err) {
      const busy = /\b(500|503)\b|high demand|overloaded|unavailable/i.test(err?.message || '');
      if (!busy) throw err;
      if (attempt >= delays.length) throw new Error('The AI service is busy right now - try again in a moment.');
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

let aiInitPromise = null;
function ensureAi() {
  if (!isAiConfigured()) return Promise.resolve(null);
  if (!aiInitPromise) {
    aiInitPromise = import('firebase/ai').then(({ getAI, GoogleAIBackend, getGenerativeModel }) => {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, { model: 'gemini-flash-latest' });
      return { ai, model, getGenerativeModel };
    });
  }
  return aiInitPromise;
}

// Narrates an already-computed summary (see buildTripDigestPrompt in
// utils.js) into plain English - the app does the math, Gemini just writes
// it up, so there's no risk of the AI inventing numbers that don't match
// the ledger.
export async function generateDigest(prompt) {
  const ctx = await ensureAi();
  if (!ctx) throw new Error('AI Logic is not configured.');
  const result = await withAiRetry(() => ctx.model.generateContent(prompt));
  return result.response.text();
}

// Constrains Gemini to return JSON matching the given schema (see
// buildQuickAddSchema / buildCategorySuggestionSchema in utils.js) - a
// fresh model is built per call since the schema differs every time
// (categories/members vary by ledger/trip).
export async function generateStructured(prompt, schema) {
  const ctx = await ensureAi();
  if (!ctx) throw new Error('AI Logic is not configured.');
  const jsonModel = ctx.getGenerativeModel(ctx.ai, {
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });
  const result = await withAiRetry(() => jsonModel.generateContent(prompt));
  return JSON.parse(result.response.text());
}

// Same schema-constrained approach as generateStructured, but with an image
// part alongside the text prompt (see buildReceiptExtractionSchema/Prompt in
// utils.js).
export async function extractReceiptFromImage(base64Data, mimeType, prompt, schema) {
  const ctx = await ensureAi();
  if (!ctx) throw new Error('AI Logic is not configured.');
  const jsonModel = ctx.getGenerativeModel(ctx.ai, {
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });
  const result = await withAiRetry(() =>
    jsonModel.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType } },
    ]),
  );
  return JSON.parse(result.response.text());
}

export function isAllowedUser(user) {
  return Boolean(user?.email && user.emailVerified && ALLOWED_EMAILS.has(user.email.toLowerCase()));
}

export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// Web uses signInWithPopup, which needs a browser popup RN doesn't have.
// The sign-in screen instead runs an expo-auth-session Google OAuth flow and
// hands the resulting id_token here to finish the same Firebase Auth login
// the web app gets, checked against the same firestore.rules allowlist.
// Web only: Firebase's own popup flow, which returns through the project's
// firebaseapp.com auth handler instead of the site's own address - the
// expo-auth-session redirect goes to the bare origin (yash-kothari.github.io,
// a 404 - the app lives under /splitkhata) and can never complete there.
export async function signInWithGooglePopup() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signInWithGoogleIdToken(idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}

// Dev-only shortcut so local testing (IS_DEV_EMULATOR) never has to click
// through a real Google OAuth popup. The Auth emulator's documented "fake
// IdP" format - a JSON blob passed as the id_token - creates/signs in a user
// with these claims without contacting Google, so sign_in_provider and
// email_verified still satisfy firestore.rules' isAllowedUser() check
// against the emulator's own copy of the rules. Throws if pointed at the
// real Auth service, since GoogleAuthProvider.credential(<this JSON blob>)
// isn't a real Google ID token.
export async function signInDevTestUser(email = 'yash.sk.kothari@gmail.com') {
  if (!IS_DEV_EMULATOR) throw new Error('signInDevTestUser only works against the Auth emulator (IS_DEV_EMULATOR).');
  const fakeIdToken = JSON.stringify({
    sub: `dev-${email}`,
    email,
    email_verified: true,
    name: email.split('@')[0].split('.')[0].replace(/^./, (c) => c.toUpperCase()),
  });
  const credential = GoogleAuthProvider.credential(fakeIdToken);
  return signInWithCredential(auth, credential);
}

export async function signOutUser() {
  await signOut(auth);
}

let categoriesSeededFlag = false;
let membersSeededFlag = false;

export function subscribeToExpenses(ledger, onData, onError) {
  const targetLedger = normalizeLedger(ledger);
  const q = query(expensesRef, where('ledger', '==', targetLedger), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const entries = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
      }));
      onData(entries);
    },
    onError,
  );
}

async function seedDefaultCategories() {
  const batch = writeBatch(dbInstance);
  for (const cat of CATEGORIES) {
    batch.set(doc(categoriesRef), { name: cat, ledger: 'household', createdAt: serverTimestamp() });
  }
  for (const cat of TRAVEL_CATEGORIES) {
    batch.set(doc(categoriesRef), { name: cat, ledger: 'travel', createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export function subscribeToCategories(onData, onError) {
  const q = query(categoriesRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty && !categoriesSeededFlag) {
        categoriesSeededFlag = true;
        seedDefaultCategories().catch(() => {});
        onData({ household: [...CATEGORIES], travel: [...TRAVEL_CATEGORIES], rawDocs: [] });
        return;
      }
      const household = [];
      const travel = [];
      const rawDocs = [];
      snapshot.docs.forEach((docSnap) => {
        const item = { id: docSnap.id, ...docSnap.data() };
        rawDocs.push(item);
        if (item.ledger === 'travel') {
          if (item.name) travel.push(item.name);
        } else if (item.name) household.push(item.name);
      });
      onData({ household, travel, rawDocs });
    },
    onError,
  );
}

async function seedDefaultMembers() {
  const batch = writeBatch(dbInstance);
  for (const p of PERSONS) {
    batch.set(doc(membersRef), { name: p, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export function subscribeToMembers(onData, onError) {
  const q = query(membersRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty && !membersSeededFlag) {
        membersSeededFlag = true;
        seedDefaultMembers().catch(() => {});
        onData({ members: [...PERSONS], rawDocs: [] });
        return;
      }
      const members = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        const item = { id: d.id, ...d.data() };
        rawDocs.push(item);
        if (item.name) members.push(item.name);
      });
      onData({ members, rawDocs });
    },
    onError,
  );
}

export async function addExpense(entry) {
  const docRef = await addDoc(expensesRef, { ...entry, createdAt: serverTimestamp() });
  return docRef.id;
}

// Writes multiple expenses as one atomic operation - used for the
// multi-month split, where a single "Add Entry" submit can create a dozen+ docs.
export async function addExpensesBatch(entries) {
  if (!entries.length) return;
  const batch = writeBatch(dbInstance);
  for (const entry of entries) {
    batch.set(doc(expensesRef), { ...entry, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function updateExpense(id, updates) {
  await updateDoc(doc(dbInstance, 'expenses', id), updates);
}

export async function deleteExpense(id) {
  await deleteDoc(doc(dbInstance, 'expenses', id));
}

export function subscribeToHouseholdBudgets(callback) {
  const budgetsDocRef = doc(dbInstance, 'settings', 'household_budgets');
  return onSnapshot(
    budgetsDocRef,
    (docSnap) => callback(docSnap.exists() && docSnap.data().budgets ? docSnap.data().budgets : {}),
    (err) => { reportError(err, 'Could not load household budgets'); callback({}); },
  );
}

export function subscribeToPaymentReminderConfig(callback) {
  const configDocRef = doc(dbInstance, 'settings', 'payment_reminder_config');
  return onSnapshot(
    configDocRef,
    (docSnap) => {
      const config = docSnap.exists()
        ? {
            enabled: docSnap.data().enabled !== false,
            amountThreshold: Number(docSnap.data().amountThreshold) || 2000,
          }
        : { enabled: true, amountThreshold: 2000 };
      callback(config);
    },
    (err) => { reportError(err, 'Could not load payment reminder settings'); callback({ enabled: true, amountThreshold: 2000 }); },
  );
}

// --- Trips ---

export function subscribeToTrips(onData, onError) {
  const q = query(tripsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export async function addTripToDb(name, currency, year, existingTrips = [], startDate = null, endDate = null) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingTrips.some((t) => t.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (exists) return;
  await addDoc(tripsRef, { name: trimmed, currency, year, startDate, endDate, createdAt: serverTimestamp() });
}

export async function updateTripInDb(tripId, updates) {
  if (!tripId) return;
  await updateDoc(doc(dbInstance, 'trips', tripId), updates);
}

export async function deleteTripFromDb(tripId) {
  if (!tripId) return;
  await deleteDoc(doc(dbInstance, 'trips', tripId));
}

// --- Cash movements (travel ledger - opening balance + ATM withdrawals per trip) ---

export function subscribeToCashMovements(onData, onError) {
  const q = query(cashMovementsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) =>
      onData(
        snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
        })),
      ),
    onError,
  );
}

export async function addCashMovementToDb(movement) {
  await addDoc(cashMovementsRef, { ...movement, createdAt: serverTimestamp() });
}

export async function deleteCashMovementFromDb(id) {
  await deleteDoc(doc(dbInstance, 'cashMovements', id));
}

// --- Payment methods (travel ledger - "Cash", "Yash Forex", "Kruti Diners", etc.) ---

let paymentMethodsSeededFlag = false;

export function subscribeToPaymentMethods(onData, onError) {
  const q = query(paymentMethodsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty && !paymentMethodsSeededFlag) {
        paymentMethodsSeededFlag = true;
        seedDefaultPaymentMethods().catch(() => {});
        onData({ methods: [...PAYMENT_METHODS], rawDocs: [] });
        return;
      }
      const methods = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        const item = { id: d.id, ...d.data() };
        rawDocs.push(item);
        if (item.name) methods.push(item.name);
      });
      onData({ methods, rawDocs });
    },
    onError,
  );
}

async function seedDefaultPaymentMethods() {
  const batch = writeBatch(dbInstance);
  for (const m of PAYMENT_METHODS) {
    batch.set(doc(paymentMethodsRef), { name: m, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function addPaymentMethodToDb(name, existingRawDocs = [], { type, owner } = {}) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingRawDocs.some((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    const docRef = await addDoc(paymentMethodsRef, {
      name: trimmed,
      ...(type ? { type } : {}),
      ...(owner ? { owner } : {}),
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  }
  return null;
}

// Links each unlinked card to the payment method with the same name (making
// it a Credit method), creating the method when none exists yet.
export async function linkCardsToPaymentMethods(cards, methodDocs) {
  const claimed = new Set(cards.map((c) => c.paymentMethodId).filter(Boolean));
  const docs = [...methodDocs];
  for (const card of cards) {
    const match = docs.find((d) => !claimed.has(d.id) && d.name?.trim().toLowerCase() === card.name.trim().toLowerCase());
    let methodId;
    if (match) {
      methodId = match.id;
      await updateDoc(doc(dbInstance, 'paymentMethods', methodId), {
        type: 'credit',
        ...(match.owner || !card.owner ? {} : { owner: card.owner }),
      });
    } else {
      const ref = await addDoc(paymentMethodsRef, {
        name: card.name.trim(),
        type: 'credit',
        ...(card.owner ? { owner: card.owner } : {}),
        createdAt: serverTimestamp(),
      });
      methodId = ref.id;
      docs.push({ id: methodId, name: card.name });
    }
    claimed.add(methodId);
    await updateDoc(doc(dbInstance, 'creditCards', card.id), { paymentMethodId: methodId });
  }
}

export async function updatePaymentMethodInDb(id, { name, type, owner }) {
  if (!id) return;
  await updateDoc(doc(dbInstance, 'paymentMethods', id), { name: name.trim(), type: type || 'other', owner: owner || '' });
}

export async function deletePaymentMethodFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const docToDelete = rawDocs.find((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'paymentMethods', docToDelete.id));
  }
}

// --- Guests (a reusable directory, not scoped to one trip - lets a trip
// guest be added by picking their name back up on a later trip instead of
// re-typing it, matching the reuse members/payment methods already get) ---

export function subscribeToGuests(onData, onError) {
  const q = query(guestsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const guests = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        const item = { id: d.id, ...d.data() };
        rawDocs.push(item);
        if (item.name) guests.push(item.name);
      });
      onData({ guests, rawDocs });
    },
    onError,
  );
}

export async function addGuestToDb(name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingRawDocs.some((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    await addDoc(guestsRef, { name: trimmed, createdAt: serverTimestamp() });
  }
}

export async function deleteGuestFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const docToDelete = rawDocs.find((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'guests', docToDelete.id));
  }
}

// --- Currencies (read-only for now - management UI is a Settings-screen feature, deferred) ---

let currenciesSeededFlag = false;

export function subscribeToCurrencies(onData, onError) {
  const q = query(currenciesRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty && !currenciesSeededFlag) {
        currenciesSeededFlag = true;
        seedDefaultCurrencies().catch(() => {});
        onData({ currencies: [...CURRENCIES], rawDocs: [] });
        return;
      }
      const currencies = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        const item = { id: d.id, ...d.data() };
        rawDocs.push(item);
        if (item.name) currencies.push(item.name);
      });
      onData({ currencies, rawDocs });
    },
    onError,
  );
}

async function seedDefaultCurrencies() {
  const batch = writeBatch(dbInstance);
  for (const cur of CURRENCIES) {
    batch.set(doc(currenciesRef), { name: cur, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

// --- Currencies (add/delete) ---

export async function addCurrencyToDb(name, existingRawDocs = []) {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) return;
  const exists = existingRawDocs.some((d) => d.name && d.name.trim().toUpperCase() === trimmed);
  if (!exists) {
    await addDoc(currenciesRef, { name: trimmed, createdAt: serverTimestamp() });
  }
}

export async function deleteCurrencyFromDb(name, rawDocs = []) {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) return;
  const docToDelete = rawDocs.find((d) => d.name && d.name.trim().toUpperCase() === trimmed);
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'currencies', docToDelete.id));
    return;
  }
  const q = query(currenciesRef, where('name', '==', trimmed));
  const snap = await getDocs(q);
  if (!snap.empty) {
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(dbInstance, 'currencies', d.id))));
  }
}

// --- Members (add/delete - subscribeToMembers already exists above) ---

export async function addMemberToDb(name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingRawDocs.some((d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    await addDoc(membersRef, { name: trimmed, createdAt: serverTimestamp() });
  }
}

export async function deleteMemberFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const docToDelete = rawDocs.find((d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'members', docToDelete.id));
    return;
  }
  const q = query(membersRef, where('name', '==', trimmed));
  const snap = await getDocs(q);
  if (!snap.empty) {
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(dbInstance, 'members', d.id))));
  }
}

// --- Household budgets (save - subscribeToHouseholdBudgets already exists above) ---

export async function saveHouseholdBudgetsToDb(budgets) {
  const budgetsDocRef = doc(dbInstance, 'settings', 'household_budgets');
  await setDoc(budgetsDocRef, { budgets, updatedAt: serverTimestamp() });
}

// --- Payment reminder config (save - subscribeToPaymentReminderConfig already exists above) ---

export async function savePaymentReminderConfigToDb(config) {
  const configDocRef = doc(dbInstance, 'settings', 'payment_reminder_config');
  await setDoc(configDocRef, { ...config, updatedAt: serverTimestamp() });
}

// --- Recurring expense rules (rent, subscriptions, utilities) - one settings
// doc holding the whole array, matching web's shape exactly. ---

export function subscribeToRecurringRules(callback) {
  const rulesDocRef = doc(dbInstance, 'settings', 'recurring_rules');
  return onSnapshot(
    rulesDocRef,
    (docSnap) => callback(docSnap.exists() && Array.isArray(docSnap.data().rules) ? docSnap.data().rules : []),
    (err) => { reportError(err, 'Could not load recurring rules'); callback([]); },
  );
}

export async function saveRecurringRulesToDb(rules) {
  const rulesDocRef = doc(dbInstance, 'settings', 'recurring_rules');
  await setDoc(rulesDocRef, { rules, updatedAt: serverTimestamp() });
}

// --- PIN lock config - stored as plain text (not hashed), matching web's
// own storage exactly (a 4-digit device passcode, not an account credential). ---

export function subscribeToPinConfig(callback) {
  const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
  return onSnapshot(
    pinDocRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        callback({ pin: typeof data.pin === 'string' ? data.pin : '', enabled: Boolean(data.enabled) });
      } else {
        callback({ pin: '', enabled: false });
      }
    },
    (err) => { reportError(err, 'Could not load security PIN settings'); callback({ pin: '', enabled: false }); },
  );
}

export async function savePinConfigToDb(config) {
  const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
  await setDoc(pinDocRef, { pin: config.pin || '', enabled: Boolean(config.enabled), updatedAt: serverTimestamp() });
}

// --- Credit cards - a handful of user-managed entities, one doc per card. ---

export function subscribeToCreditCards(onData, onError) {
  const q = query(creditCardsRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export async function addCreditCardToDb(card) {
  const docRef = await addDoc(creditCardsRef, { ...card, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function updateCreditCardInDb(cardId, updates) {
  if (!cardId) return;
  await updateDoc(doc(dbInstance, 'creditCards', cardId), updates);
}

export async function deleteCreditCardFromDb(cardId) {
  if (!cardId) return;
  await deleteDoc(doc(dbInstance, 'creditCards', cardId));
}

// --- Card transactions - potentially large over time, a real collection
// like expenses rather than a single settings doc. ---

export function subscribeToCardTransactions(onData, onError) {
  const q = query(cardTransactionsRef, orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) =>
      onData(
        snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
        })),
      ),
    onError,
  );
}

export async function addCardTransaction(transaction) {
  const docRef = await addDoc(cardTransactionsRef, { ...transaction, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function updateCardTransaction(id, updates) {
  if (!id) return;
  await updateDoc(doc(dbInstance, 'cardTransactions', id), updates);
}

export async function deleteCardTransaction(id) {
  if (!id) return;
  await deleteDoc(doc(dbInstance, 'cardTransactions', id));
}

// --- Billing-cycle confirmation records - "did the real statement match
// what we expected, and have the points actually landed." Keyed
// deterministically by `${cardId}|${cycleStart}` so confirming the same
// cycle twice updates the same record instead of creating a duplicate. ---

export function subscribeToCardBillingCycles(onData, onError) {
  return onSnapshot(
    cardBillingCyclesRef,
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export async function saveCardBillingCycle(cardId, cycleStart, updates) {
  const key = getCardBillingCycleKey(cardId, cycleStart);
  await setDoc(doc(dbInstance, 'cardBillingCycles', key), { cardId, cycleStart, ...updates, updatedAt: serverTimestamp() }, { merge: true });
}

// --- Categories (add/delete - subscribeToCategories already exists above) ---

export async function addCategoryToDb(ledger, name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const targetKey = ledger === 'travel' ? 'travel' : 'household';
  const exists = existingRawDocs.some(
    (d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase() && (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
  );
  if (!exists) {
    await addDoc(categoriesRef, { name: trimmed, ledger: targetKey, createdAt: serverTimestamp() });
  }
}

export async function deleteCategoryFromDb(ledger, categoryName, rawDocs = []) {
  const trimmed = categoryName.trim();
  if (!trimmed) return;
  const targetKey = ledger === 'travel' ? 'travel' : 'household';
  const docToDelete = rawDocs.find(
    (d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase() && (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
  );
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'categories', docToDelete.id));
    return;
  }
  const q = query(categoriesRef, where('name', '==', trimmed));
  const snap = await getDocs(q);
  if (!snap.empty) {
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(dbInstance, 'categories', d.id))));
  }
}
