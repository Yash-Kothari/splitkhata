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
  // @ts-expect-error - getReactNativePersistence is a real, documented
  // export of @firebase/auth's "react-native" build (see above), but TS's
  // own module resolution here picks a different conditional export whose
  // .d.ts doesn't declare it - a types-only gap, not a runtime one.
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
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  deleteField,
  setDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
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
  computeRecurringEntriesToGenerate,
  buildPaymentInstruments,
  resolveInstrument,
  isStatementOnlyCard,
  resolveStrategyParamsForDate,
  inferCardRewardFields,
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
  // Multi-tab: with the default single-tab manager, a second open tab (or an
  // old page still closing during a reload) failed to get the IndexedDB lock
  // with failed-precondition and silently fell back to a memory-only cache.
  localCache: Platform.OS === 'web' ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
});

// A count of writes still in flight, for ConnectionBanner to show "N changes
// waiting to sync" - there was previously no way to tell a stuck save from a
// successful one apart from watching the spinner never stop. `track` never
// swallows the write's own outcome (the returned promise still rejects the
// same way); it only observes it to keep the count and to report a failure
// that nothing else is watching for.
let pendingWriteCount = 0;
let pendingWriteListeners = [];
function notifyPendingWrites() {
  pendingWriteListeners.forEach((listener) => listener(pendingWriteCount));
}
export function subscribeToPendingWrites(listener) {
  pendingWriteListeners.push(listener);
  listener(pendingWriteCount);
  return () => {
    pendingWriteListeners = pendingWriteListeners.filter((l) => l !== listener);
  };
}
function track(promise, context) {
  pendingWriteCount += 1;
  notifyPendingWrites();
  promise
    .catch(() => {}) // the caller's own await/catch still sees the rejection - this just stops it becoming an unhandled one here
    .finally(() => {
      pendingWriteCount -= 1;
      notifyPendingWrites();
    });
  return promise;
}

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
    }).catch((err) => {
      // Don't cache a failed load (e.g. a flaky network fetching the module) -
      // every AI feature stayed broken until a full reload.
      aiInitPromise = null;
      throw err;
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

// Default lists are seeded at most once per list, ever: a flag doc records
// it in the same batch as the defaults. Without it, an empty snapshot from
// the offline cache (first launch with no network) or two devices starting
// at once seeded a second set, and deleting every item in a list brought
// the defaults back on the next launch.
async function seedOnce(key, writeDefaults) {
  const seedStateRef = doc(dbInstance, 'settings', 'seed_state');
  const state = await getDoc(seedStateRef);
  if (state.exists() && state.data()[key]) return;
  const batch = writeBatch(dbInstance);
  writeDefaults(batch);
  batch.set(seedStateRef, { [key]: true }, { merge: true });
  await batch.commit();
}

async function seedDefaultCategories() {
  await seedOnce('categories', (batch) => {
    for (const cat of CATEGORIES) {
      batch.set(doc(categoriesRef), { name: cat, ledger: 'household', createdAt: serverTimestamp() });
    }
    for (const cat of TRAVEL_CATEGORIES) {
      batch.set(doc(categoriesRef), { name: cat, ledger: 'travel', createdAt: serverTimestamp() });
    }
  });
}

// Lists keep their creation order unless a saved sortOrder says otherwise (see
// saveSortOrder); anything added later has no sortOrder and lands at the end.
function sortByOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = a.item.sortOrder;
      const bo = b.item.sortOrder;
      if (ao == null && bo == null) return a.index - b.index;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo || a.index - b.index;
    })
    .map(({ item }) => item);
}

export async function saveSortOrder(collectionName, orderedIds) {
  const batch = writeBatch(dbInstance);
  orderedIds.forEach((id, index) => batch.update(doc(dbInstance, collectionName, id), { sortOrder: index }));
  await batch.commit();
}

export function subscribeToCategories(onData, onError) {
  const q = query(categoriesRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    // Metadata changes too, so a cache-only empty result is followed by the
    // server's answer even when that answer is also empty.
    { includeMetadataChanges: true },
    (snapshot) => {
      // An empty result straight from the local cache says nothing about the
      // server: show the defaults, but don't seed until the server confirms.
      if (snapshot.empty && snapshot.metadata.fromCache) {
        onData({ household: [...CATEGORIES], travel: [...TRAVEL_CATEGORIES], rawDocs: [] });
        return;
      }
      if (snapshot.empty && !snapshot.metadata.fromCache && !categoriesSeededFlag) {
        categoriesSeededFlag = true;
        seedDefaultCategories().catch(() => {});
        onData({ household: [...CATEGORIES], travel: [...TRAVEL_CATEGORIES], rawDocs: [] });
        return;
      }
      const household = [];
      const travel = [];
      const rawDocs = [];
      sortByOrder(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))).forEach((item) => {
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
  await seedOnce('members', (batch) => {
    for (const name of PERSONS) {
      batch.set(doc(membersRef), { name, createdAt: serverTimestamp() });
    }
  });
}

export function subscribeToMembers(onData, onError) {
  const q = query(membersRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    // Metadata changes too, so a cache-only empty result is followed by the
    // server's answer even when that answer is also empty.
    { includeMetadataChanges: true },
    (snapshot) => {
      // An empty result straight from the local cache says nothing about the
      // server: show the defaults, but don't seed until the server confirms.
      if (snapshot.empty && snapshot.metadata.fromCache) {
        onData({ members: [...PERSONS], rawDocs: [] });
        return;
      }
      if (snapshot.empty && !snapshot.metadata.fromCache && !membersSeededFlag) {
        membersSeededFlag = true;
        seedDefaultMembers().catch(() => {});
        onData({ members: [...PERSONS], rawDocs: [] });
        return;
      }
      const members = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        /** @type {{id: string, name?: string}} */
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
  const docRef = await track(addDoc(expensesRef, { ...entry, createdAt: serverTimestamp() }), 'Could not save entry');
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
  await track(batch.commit(), 'Could not save entries');
}

export async function updateExpense(id, updates) {
  await track(updateDoc(doc(dbInstance, 'expenses', id), updates), 'Could not save changes');
}

export async function deleteExpense(id) {
  await track(deleteDoc(doc(dbInstance, 'expenses', id)), 'Could not delete entry');
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

// Deleting a trip's household rollup line from Payment History left the trip
// still pointing at it - "Add to Main Ledger" never came back and "Update"
// failed on the missing entry. Clears the pointer on whichever trip holds it
// (normally at most one) in a single write, rather than one updateDoc per
// match with no shared all-or-nothing outcome between them.
export async function clearTripRollupPointer(entryId) {
  if (!entryId) return;
  const snap = await getDocs(query(tripsRef, where('rolledUpEntryId', '==', entryId)));
  if (snap.empty) return;
  const batch = writeBatch(dbInstance);
  snap.docs.forEach((d) => batch.update(d.ref, { rolledUpEntryId: null, rolledUpAmount: null, rolledUpDebtor: null, rolledUpCreditor: null }));
  await track(batch.commit(), "Could not reset the trip's rollup");
}

// Atomic: the household "rollup" entry for a trip and the trip's own
// rolledUpEntryId/Amount/Debtor/Creditor pointer must always agree - these
// three helpers replace what used to be a separate expense write (create,
// update, or delete) followed by a separate updateTripInDb call, which on a
// mid-way failure left the two out of sync (a deleted rollup entry the trip
// still pointed at, or a newly created one the trip never learned the id of).

export async function clearTripRollupEntry(tripId, entryId) {
  const batch = writeBatch(dbInstance);
  batch.delete(doc(dbInstance, 'expenses', entryId));
  if (tripId) {
    batch.update(doc(dbInstance, 'trips', tripId), { rolledUpEntryId: null, rolledUpAmount: null, rolledUpDebtor: null, rolledUpCreditor: null });
  }
  await track(batch.commit(), 'Could not update the trip rollup');
}

export async function updateTripRollupEntry(tripId, entryId, entryUpdates, pointerUpdates) {
  const batch = writeBatch(dbInstance);
  batch.update(doc(dbInstance, 'expenses', entryId), entryUpdates);
  if (tripId) {
    batch.update(doc(dbInstance, 'trips', tripId), pointerUpdates);
  }
  await track(batch.commit(), 'Could not update the trip rollup');
}

export async function createTripRollupEntry(tripId, entryData, pointerData) {
  const entryRef = doc(expensesRef);
  const batch = writeBatch(dbInstance);
  batch.set(entryRef, { ...entryData, createdAt: serverTimestamp() });
  if (tripId) {
    batch.update(doc(dbInstance, 'trips', tripId), { ...pointerData, rolledUpEntryId: entryRef.id });
  }
  await track(batch.commit(), 'Could not update the trip rollup');
  return entryRef.id;
}

export async function deleteTripFromDb(tripId) {
  if (!tripId) return;
  await deleteDoc(doc(dbInstance, 'trips', tripId));
}

// Deleting a trip used to remove only the trip doc: its entries stayed (still
// counted by search, Ask, exports and the points balance, and adopted by any
// new trip with the same name), its household rollup line stayed in the
// balance for good, and its cash records stayed too. This removes all of it:
// the trip's travel entries and their linked card transactions, its cash
// movements, its household rollup line, then the trip. Needs the server.
export async function deleteTripCascade(trip) {
  if (!trip?.id) return;
  const [entriesSnap, movementsSnap] = await Promise.all([
    getDocs(query(expensesRef, where('tripName', '==', trip.name))),
    getDocs(query(cashMovementsRef, where('tripName', '==', trip.name))),
  ]);
  const refs = [];
  entriesSnap.docs.forEach((d) => {
    const data = d.data();
    if (normalizeLedger(data.ledger) !== 'travel') return;
    refs.push(d.ref);
    if (data.cardTransactionId) refs.push(doc(dbInstance, 'cardTransactions', data.cardTransactionId));
  });
  movementsSnap.docs.forEach((d) => refs.push(d.ref));
  if (trip.rolledUpEntryId) refs.push(doc(expensesRef, trip.rolledUpEntryId));
  refs.push(doc(dbInstance, 'trips', trip.id));
  // Batches cap at 500 writes; the trip doc goes last so a partial failure
  // leaves the trip visible to delete again.
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(dbInstance);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
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
  await track(addDoc(cashMovementsRef, { ...movement, createdAt: serverTimestamp() }), 'Could not save cash record');
}

// Atomic: an ATM withdrawal is really two records at once - the cash
// movement (what left the card/account) and the shared expense entry
// (where that cash went) - previously two separate calls, which on a
// mid-way failure left a withdrawal in the cash ledger with no matching
// expense (the trip's cash balance and its spend total would disagree).
export async function addWithdrawal(movement, entry) {
  const batch = writeBatch(dbInstance);
  batch.set(doc(cashMovementsRef), { ...movement, createdAt: serverTimestamp() });
  batch.set(doc(expensesRef), { ...entry, createdAt: serverTimestamp() });
  await track(batch.commit(), 'Could not record the withdrawal');
}

// Starting cash is one value per trip: this replaces every earlier opening
// record for the trip. Saving used to add another record each time, so
// correcting 20,000 to 25,000 showed 45,000.
export async function setOpeningCash(tripName, tripId, amount) {
  const existing = await getDocs(query(cashMovementsRef, where('tripName', '==', tripName)));
  const batch = writeBatch(dbInstance);
  existing.docs.forEach((d) => {
    if (d.data().type === 'opening') batch.delete(d.ref);
  });
  batch.set(doc(cashMovementsRef, `opening_${tripId}`), { tripName, type: 'opening', amount, createdAt: serverTimestamp() });
  await track(batch.commit(), 'Could not save opening cash');
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
    // Metadata changes too, so a cache-only empty result is followed by the
    // server's answer even when that answer is also empty.
    { includeMetadataChanges: true },
    (snapshot) => {
      // An empty result straight from the local cache says nothing about the
      // server: show the defaults, but don't seed until the server confirms.
      if (snapshot.empty && snapshot.metadata.fromCache) {
        onData({ methods: [...PAYMENT_METHODS], rawDocs: [] });
        return;
      }
      if (snapshot.empty && !snapshot.metadata.fromCache && !paymentMethodsSeededFlag) {
        paymentMethodsSeededFlag = true;
        seedDefaultPaymentMethods().catch(() => {});
        onData({ methods: [...PAYMENT_METHODS], rawDocs: [] });
        return;
      }
      const methods = [];
      const rawDocs = [];
      sortByOrder(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))).forEach((item) => {
        rawDocs.push(item);
        if (item.name) methods.push(item.name);
      });
      onData({ methods, rawDocs });
    },
    onError,
  );
}

async function seedDefaultPaymentMethods() {
  await seedOnce('paymentMethods', (batch) => {
    for (const name of PAYMENT_METHODS) {
      batch.set(doc(paymentMethodsRef), { name, createdAt: serverTimestamp() });
    }
  });
}

/**
 * @param {string} name
 * @param {Array<{name?: string}>} [existingRawDocs]
 * @param {{type?: string, owner?: string}} [options]
 */
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

// By id - two methods can share a name (told apart by owner), and deleting
// by name removed whichever came first, not the one tapped.
export async function deletePaymentMethodFromDb(id) {
  if (!id) return;
  await deleteDoc(doc(dbInstance, 'paymentMethods', id));
}

// --- Rename / usage guards (P1-5): a category/member/guest historically
// couldn't be renamed at all - deleting and re-adding left every past
// record saying the old name forever - and deleting one still in use
// silently orphaned that history instead of refusing. These read the
// relevant collections once (this app's scale - a household plus
// occasional trip guests, not enterprise volume - makes that fine, and
// Firestore can't query "does this map have key X" or combine an
// array-contains with other filters in one query anyway) and batch every
// doc that needs a change, chunked at 400 writes per commit (Firestore's
// real cap is 500).

async function batchUpdateDocs(collectionRef, computeUpdates) {
  const snap = await getDocs(collectionRef);
  const toUpdate = [];
  snap.docs.forEach((d) => {
    const updates = computeUpdates(d.data(), d);
    if (updates) toUpdate.push({ ref: d.ref, updates });
  });
  for (let i = 0; i < toUpdate.length; i += 400) {
    const batch = writeBatch(dbInstance);
    toUpdate.slice(i, i + 400).forEach(({ ref, updates }) => batch.update(ref, updates));
    await track(batch.commit(), 'Could not update some records');
  }
  return toUpdate.length;
}

// Shared by members and guests - both are just "a person" as far as
// entries, trips, cards and payment methods are concerned. A guest rename
// additionally touches trip.guests arrays (a member never appears there);
// a member rename touches nothing extra, so one function covers both.
async function renamePersonEverywhere(oldName, newName) {
  const entriesUpdated = await batchUpdateDocs(expensesRef, (entry) => {
    const updates = {};
    let changed = false;
    if (entry.payer === oldName) {
      updates.payer = newName;
      changed = true;
    }
    if (entry.owedBy === oldName) {
      updates.owedBy = newName;
      changed = true;
    }
    if (Array.isArray(entry.splitAmong) && entry.splitAmong.includes(oldName)) {
      updates.splitAmong = entry.splitAmong.map((m) => (m === oldName ? newName : m));
      changed = true;
    }
    if (entry.splitShares && Object.prototype.hasOwnProperty.call(entry.splitShares, oldName)) {
      const { [oldName]: value, ...rest } = entry.splitShares;
      updates.splitShares = { ...rest, [newName]: value };
      changed = true;
    }
    return changed ? updates : null;
  });

  await batchUpdateDocs(tripsRef, (trip) => {
    const updates = {};
    let changed = false;
    if (trip.rolledUpDebtor === oldName) {
      updates.rolledUpDebtor = newName;
      changed = true;
    }
    if (trip.rolledUpCreditor === oldName) {
      updates.rolledUpCreditor = newName;
      changed = true;
    }
    if (Array.isArray(trip.guests) && trip.guests.includes(oldName)) {
      updates.guests = trip.guests.map((g) => (g === oldName ? newName : g));
      changed = true;
    }
    return changed ? updates : null;
  });

  await batchUpdateDocs(creditCardsRef, (card) => (card.owner === oldName ? { owner: newName } : null));
  await batchUpdateDocs(paymentMethodsRef, (pm) => (pm.owner === oldName ? { owner: newName } : null));

  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  await track(
    runTransaction(dbInstance, async (tx) => {
      const snap = await tx.get(rulesRef);
      const rules = snap.exists() && Array.isArray(snap.data().rules) ? snap.data().rules : [];
      let changed = false;
      const nextRules = rules.map((r) => {
        if (r.payer !== oldName && r.owedBy !== oldName && !(r.splitShares && Object.prototype.hasOwnProperty.call(r.splitShares, oldName))) {
          return r;
        }
        changed = true;
        const next = { ...r };
        if (r.payer === oldName) next.payer = newName;
        if (r.owedBy === oldName) next.owedBy = newName;
        if (r.splitShares && Object.prototype.hasOwnProperty.call(r.splitShares, oldName)) {
          const { [oldName]: value, ...rest } = r.splitShares;
          next.splitShares = { ...rest, [newName]: value };
        }
        return next;
      });
      if (!changed) return;
      tx.set(rulesRef, { rules: nextRules, updatedAt: serverTimestamp() }, { merge: true });
    }),
    'Could not rename on recurring rules',
  );

  return entriesUpdated;
}

// Counts every record anywhere that still names this person - members and
// guests share the same check, since both are just "a person" in the data.
export async function countRecordsUsingPerson(name) {
  const [entriesSnap, tripsSnap, cardsSnap, pmSnap, rulesSnap] = await Promise.all([
    getDocs(expensesRef),
    getDocs(tripsRef),
    getDocs(creditCardsRef),
    getDocs(paymentMethodsRef),
    getDoc(doc(dbInstance, 'settings', 'recurring_rules')),
  ]);
  let count = 0;
  entriesSnap.docs.forEach((d) => {
    const e = d.data();
    if (e.payer === name || e.owedBy === name) count += 1;
    else if (Array.isArray(e.splitAmong) && e.splitAmong.includes(name)) count += 1;
    else if (e.splitShares && Object.prototype.hasOwnProperty.call(e.splitShares, name)) count += 1;
  });
  tripsSnap.docs.forEach((d) => {
    const t = d.data();
    if (t.rolledUpDebtor === name || t.rolledUpCreditor === name) count += 1;
    if (Array.isArray(t.guests) && t.guests.includes(name)) count += 1;
  });
  cardsSnap.docs.forEach((d) => {
    if (d.data().owner === name) count += 1;
  });
  pmSnap.docs.forEach((d) => {
    if (d.data().owner === name) count += 1;
  });
  if (rulesSnap.exists()) {
    const rules = rulesSnap.data().rules || [];
    rules.forEach((r) => {
      if (r.payer === name || r.owedBy === name || (r.splitShares && Object.prototype.hasOwnProperty.call(r.splitShares, name))) count += 1;
    });
  }
  return count;
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

// Renames the guest everywhere - the directory doc, every entry/trip/card/
// payment method that already named them (see renamePersonEverywhere), and
// every trip's guests array that includes them (a guest can be reused
// across trips via this same directory).
export async function renameGuestInDb(oldName, newName, existingRawDocs = []) {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return 0;
  const guestDoc = existingRawDocs.find((d) => d.name?.trim().toLowerCase() === trimmedOld.toLowerCase());
  if (guestDoc?.id) {
    await track(updateDoc(doc(dbInstance, 'guests', guestDoc.id), { name: trimmedNew }), 'Could not rename guest');
  }
  return renamePersonEverywhere(trimmedOld, trimmedNew);
}

export async function deleteGuestFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const inUseCount = await countRecordsUsingPerson(trimmed);
  if (inUseCount > 0) {
    throw new Error(`"${trimmed}" is still used by ${inUseCount} ${inUseCount === 1 ? 'record' : 'records'} - rename them instead, or edit those first.`);
  }
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
    // Metadata changes too, so a cache-only empty result is followed by the
    // server's answer even when that answer is also empty.
    { includeMetadataChanges: true },
    (snapshot) => {
      // An empty result straight from the local cache says nothing about the
      // server: show the defaults, but don't seed until the server confirms.
      if (snapshot.empty && snapshot.metadata.fromCache) {
        onData({ currencies: [...CURRENCIES], rawDocs: [] });
        return;
      }
      if (snapshot.empty && !snapshot.metadata.fromCache && !currenciesSeededFlag) {
        currenciesSeededFlag = true;
        seedDefaultCurrencies().catch(() => {});
        onData({ currencies: [...CURRENCIES], rawDocs: [] });
        return;
      }
      const currencies = [];
      const rawDocs = [];
      snapshot.docs.forEach((d) => {
        /** @type {{id: string, name?: string}} */
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
  await seedOnce('currencies', (batch) => {
    for (const name of CURRENCIES) {
      batch.set(doc(currenciesRef), { name, createdAt: serverTimestamp() });
    }
  });
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

// Renames the member everywhere - the roster doc, every entry/trip/card/
// payment method that already named them, and any recurring rule (see
// renamePersonEverywhere).
export async function renameMemberInDb(oldName, newName, existingRawDocs = []) {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return 0;
  const memberDoc = existingRawDocs.find((d) => d.name?.trim().toLowerCase() === trimmedOld.toLowerCase());
  if (memberDoc?.id) {
    await track(updateDoc(doc(dbInstance, 'members', memberDoc.id), { name: trimmedNew }), 'Could not rename member');
  }
  return renamePersonEverywhere(trimmedOld, trimmedNew);
}

export async function deleteMemberFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const inUseCount = await countRecordsUsingPerson(trimmed);
  if (inUseCount > 0) {
    throw new Error(`"${trimmed}" is still used by ${inUseCount} ${inUseCount === 1 ? 'record' : 'records'} - rename them instead, or edit those first.`);
  }
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

// Field-path writes: each only touches its own category's key inside the
// `budgets` map (Firestore deep-merges a nested object under `{merge:
// true}`), rather than overwriting the whole map with whatever this device
// last saw - two people editing different categories at the same time used
// to have the second save silently drop the first's change.
export async function saveHouseholdBudget(category, amount) {
  const budgetsDocRef = doc(dbInstance, 'settings', 'household_budgets');
  await track(
    setDoc(budgetsDocRef, { budgets: { [category]: amount }, updatedAt: serverTimestamp() }, { merge: true }),
    'Could not save budget',
  );
}

export async function deleteHouseholdBudget(category) {
  const budgetsDocRef = doc(dbInstance, 'settings', 'household_budgets');
  await track(
    setDoc(budgetsDocRef, { budgets: { [category]: deleteField() }, updatedAt: serverTimestamp() }, { merge: true }),
    'Could not remove budget',
  );
}

// --- Payment reminder config (save - subscribeToPaymentReminderConfig already exists above) ---

// Takes only the field(s) actually changing (e.g. just {enabled}) and
// merges them in, rather than overwriting the whole two-field config with
// this device's full local copy - toggling "enabled" on one phone used to
// be able to revert a threshold edit made moments earlier on the other.
export async function savePaymentReminderConfigToDb(updates) {
  const configDocRef = doc(dbInstance, 'settings', 'payment_reminder_config');
  await track(setDoc(configDocRef, { ...updates, updatedAt: serverTimestamp() }, { merge: true }), 'Could not save reminder settings');
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

// Generates every recurring entry that's due, inside one transaction that
// re-reads the rules from the server: the entries (fixed ids per rule and
// month, see recurringEntryId) and the rules' lastGeneratedMonth commit
// together or not at all, and an entry that already exists - made by the
// other phone, or edited since - is never written over. The old runner
// wrote entries with random ids and saved the rules separately, so two
// devices opening at once, a stale cached snapshot, or a failed rules save
// all produced duplicate rent entries. Needs the server; returns how many
// entries it created.
export async function runRecurringGeneration(currentMonthKey) {
  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  const { created, linkable } = await runTransaction(dbInstance, async (tx) => {
    const rulesSnap = await tx.get(rulesRef);
    const rules = rulesSnap.exists() && Array.isArray(rulesSnap.data().rules) ? rulesSnap.data().rules : [];
    const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, currentMonthKey);
    if (!updatedRules) return { created: 0, linkable: [] };
    const refs = toCreate.map((item) => doc(expensesRef, item.id));
    const existing = await Promise.all(refs.map((ref) => tx.get(ref)));
    let createdCount = 0;
    const linkableEntries = [];
    toCreate.forEach(({ id, ...entry }, index) => {
      if (existing[index].exists()) return;
      tx.set(refs[index], { ...entry, createdAt: serverTimestamp() });
      createdCount += 1;
      if (entry.paymentInstrumentId) linkableEntries.push({ id, ...entry });
    });
    tx.update(rulesRef, { rules: updatedRules, updatedAt: serverTimestamp() });
    return { created: createdCount, linkable: linkableEntries };
  });

  // Best-effort card linking, same reasoning as AddEntryForm's own card
  // link (see addCardTransactionAndLink's call sites): a failure here
  // shouldn't undo entries that already saved fine, and a writeBatch can't
  // safely be combined with the runTransaction above.
  if (linkable.length > 0) {
    try {
      const [paymentMethodsSnap, creditCardsSnap] = await Promise.all([getDocs(paymentMethodsRef), getDocs(creditCardsRef)]);
      const rawPaymentMethods = paymentMethodsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const creditCardDocs = creditCardsSnap.docs.map((d) => /** @type {import('./types').Card} */ ({ id: d.id, ...d.data() }));
      const instruments = buildPaymentInstruments(rawPaymentMethods, creditCardDocs);
      for (const entry of linkable) {
        const instrument = resolveInstrument(instruments, entry);
        const linkedCard = instrument?.cardId ? creditCardDocs.find((c) => c.id === instrument.cardId) : null;
        const matchedCard = linkedCard && !isStatementOnlyCard(linkedCard) ? linkedCard : null;
        if (!matchedCard) continue;
        try {
          const params = resolveStrategyParamsForDate(matchedCard.strategyParamsHistory, entry.date);
          const fields = inferCardRewardFields(matchedCard, entry.category, params);
          await addCardTransactionAndLink(entry.id, {
            cardId: matchedCard.id,
            amount: entry.amount,
            date: entry.date,
            description: entry.note || entry.category,
            ...fields,
          });
        } catch (err) {
          reportError(err, 'Created a recurring entry, but could not link it to the card');
        }
      }
    } catch (err) {
      reportError(err, 'Created recurring entries, but could not check their card links');
    }
  }

  return created;
}

// Both re-read the rules array from the server inside a transaction rather
// than trusting this device's possibly-stale local copy, then apply the
// add/remove against that fresh copy - adding one rule on one phone while
// deleting a different one on the other used to have whichever save landed
// second silently overwrite the first's change with its own stale snapshot.
export async function addRecurringRule(rule) {
  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  await track(
    runTransaction(dbInstance, async (tx) => {
      const snap = await tx.get(rulesRef);
      const rules = snap.exists() && Array.isArray(snap.data().rules) ? snap.data().rules : [];
      tx.set(rulesRef, { rules: [...rules, rule], updatedAt: serverTimestamp() }, { merge: true });
    }),
    'Could not save the recurring rule',
  );
}

// Edits an existing rule in place (category, amount, payer, split, payment
// method, day, frequency, end date, note) - or just flips `active` for
// pause/resume. Re-reads from the server first, same reasoning as
// add/delete above. Editing never touches lastGeneratedMonth, so it can't
// accidentally re-create or skip a month the rule already generated.
export async function updateRecurringRule(ruleId, updates) {
  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  await track(
    runTransaction(dbInstance, async (tx) => {
      const snap = await tx.get(rulesRef);
      const rules = snap.exists() && Array.isArray(snap.data().rules) ? snap.data().rules : [];
      tx.set(
        rulesRef,
        { rules: rules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r)), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }),
    'Could not save the recurring rule',
  );
}

export async function deleteRecurringRule(ruleId) {
  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  await track(
    runTransaction(dbInstance, async (tx) => {
      const snap = await tx.get(rulesRef);
      const rules = snap.exists() && Array.isArray(snap.data().rules) ? snap.data().rules : [];
      tx.set(rulesRef, { rules: rules.filter((r) => r.id !== ruleId), updatedAt: serverTimestamp() }, { merge: true });
    }),
    'Could not delete the recurring rule',
  );
}

// --- PIN lock config - stored as plain text (not hashed), matching web's
// own storage exactly (a 4-digit device passcode, not an account credential). ---

// Reports enough for decideInitialLock (utils.js) to fail closed instead of
// reading an unproven snapshot as "PIN disabled": `fromCache`/`exists` on a
// normal read, or `{error:true}` when the listener itself fails (offline
// with nothing cached, permission-denied). `pinHash` is the current hashed
// PIN (see lib/pinAuth.js); `legacyPin` is a plaintext PIN saved before
// hashing existed, kept working until the next save overwrites it.
export function subscribeToPinConfig(callback) {
  const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
  return onSnapshot(
    pinDocRef,
    { includeMetadataChanges: true },
    (docSnap) => {
      const data = docSnap.exists() ? docSnap.data() : {};
      callback({
        enabled: Boolean(data.enabled),
        pinHash: typeof data.pinHash === 'string' ? data.pinHash : null,
        legacyPin: typeof data.pin === 'string' && data.pin ? data.pin : null,
        fromCache: docSnap.metadata.fromCache,
        exists: docSnap.exists(),
        error: false,
      });
    },
    (err) => {
      reportError(err, 'Could not load security PIN settings');
      callback({ enabled: false, pinHash: null, legacyPin: null, fromCache: false, exists: false, error: true });
    },
  );
}

// `pinHash` (see lib/pinAuth.js's hashPin) replaces the old plaintext `pin`
// field on every save - deleteField() clears it rather than leaving a stale
// plaintext copy next to the hash once a device that still has the PIN
// disabled saves again.
export async function savePinConfigToDb({ pinHash, enabled }) {
  const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
  await setDoc(pinDocRef, { pinHash: pinHash || null, pin: deleteField(), enabled: Boolean(enabled), updatedAt: serverTimestamp() }, { merge: true });
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
  const docRef = await track(addDoc(cardTransactionsRef, { ...transaction, createdAt: serverTimestamp() }), 'Could not save card transaction');
  return docRef.id;
}

export async function updateCardTransaction(id, updates) {
  if (!id) return;
  await track(updateDoc(doc(dbInstance, 'cardTransactions', id), updates), 'Could not save card transaction');
}

export async function deleteCardTransaction(id) {
  if (!id) return;
  await track(deleteDoc(doc(dbInstance, 'cardTransactions', id)), 'Could not delete card transaction');
}

// Atomic: creates a card transaction and stamps the entry it belongs to
// with the new id, in one write - previously two separate calls (create,
// then update the entry), which could leave a card transaction with no
// back-reference on its entry if the connection dropped in between. Callers
// keep their own best-effort try/catch around this (the entry itself was
// already saved by a separate, earlier call) - this only makes the "create
// the card side and link it" pair atomic with each other.
export async function addCardTransactionAndLink(entryId, cardTransaction) {
  const cardTxnRef = doc(cardTransactionsRef);
  const batch = writeBatch(dbInstance);
  batch.set(cardTxnRef, { ...cardTransaction, linkedEntryId: entryId, createdAt: serverTimestamp() });
  batch.update(doc(dbInstance, 'expenses', entryId), { cardTransactionId: cardTxnRef.id });
  await track(batch.commit(), 'Could not link the card transaction');
  return cardTxnRef.id;
}

// Atomic swap of a linked card transaction: deletes `oldId` (if given) and
// creates `newData` as one card transaction (if given) in a single write -
// previously a delete followed by a separate create, which on a mid-way
// failure left the entry's old cardTransactionId pointing at a transaction
// that no longer existed (not "kept the old link" the way the catch-and-
// keep-oldTxnId error handling around this assumed). Returns the new
// transaction's id, or null if newData wasn't given (a pure removal).
export async function replaceCardTransaction(oldId, newData) {
  if (!oldId && !newData) return null;
  const batch = writeBatch(dbInstance);
  if (oldId) batch.delete(doc(dbInstance, 'cardTransactions', oldId));
  let newId = null;
  if (newData) {
    const newRef = doc(cardTransactionsRef);
    batch.set(newRef, { ...newData, createdAt: serverTimestamp() });
    newId = newRef.id;
  }
  await track(batch.commit(), 'Could not update the linked card transaction');
  return newId;
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
  await track(
    setDoc(doc(dbInstance, 'cardBillingCycles', key), { cardId, cycleStart, ...updates, updatedAt: serverTimestamp() }, { merge: true }),
    'Could not save card billing cycle',
  );
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

// Counts expenses in this ledger still using this category - categories are
// per-ledger, so a household "Rent" and a travel "Rent" are unrelated.
export async function countEntriesUsingCategory(ledger, name) {
  const targetKey = ledger === 'travel' ? 'travel' : 'household';
  const snap = await getDocs(expensesRef);
  return snap.docs.filter((d) => (d.data().ledger || 'household') === targetKey && d.data().category === name).length;
}

// Renames the category doc, every matching entry's category field, the
// household budget (or every trip's per-trip category budget, for travel),
// and any recurring rule using it.
export async function renameCategoryInDb(ledger, oldName, newName, existingRawDocs = []) {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return 0;
  const targetKey = ledger === 'travel' ? 'travel' : 'household';

  const catDoc = existingRawDocs.find(
    (d) => d.name?.trim().toLowerCase() === trimmedOld.toLowerCase() && (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
  );
  if (catDoc?.id) {
    await track(updateDoc(doc(dbInstance, 'categories', catDoc.id), { name: trimmedNew }), 'Could not rename category');
  }

  const entriesUpdated = await batchUpdateDocs(expensesRef, (entry) =>
    (entry.ledger || 'household') === targetKey && entry.category === trimmedOld ? { category: trimmedNew } : null,
  );

  if (targetKey === 'household') {
    const budgetsDocRef = doc(dbInstance, 'settings', 'household_budgets');
    const budgetsSnap = await getDoc(budgetsDocRef);
    const budgets = budgetsSnap.exists() ? budgetsSnap.data().budgets || {} : {};
    if (Object.prototype.hasOwnProperty.call(budgets, trimmedOld)) {
      await track(
        setDoc(
          budgetsDocRef,
          { budgets: { [trimmedOld]: deleteField(), [trimmedNew]: budgets[trimmedOld] }, updatedAt: serverTimestamp() },
          { merge: true },
        ),
        'Could not rename category on the household budget',
      );
    }
  } else {
    await batchUpdateDocs(tripsRef, (trip) => {
      const cb = trip.categoryBudgets;
      if (!cb || !Object.prototype.hasOwnProperty.call(cb, trimmedOld)) return null;
      return { [`categoryBudgets.${trimmedOld}`]: deleteField(), [`categoryBudgets.${trimmedNew}`]: cb[trimmedOld] };
    });
  }

  const rulesRef = doc(dbInstance, 'settings', 'recurring_rules');
  await track(
    runTransaction(dbInstance, async (tx) => {
      const snap = await tx.get(rulesRef);
      const rules = snap.exists() && Array.isArray(snap.data().rules) ? snap.data().rules : [];
      if (!rules.some((r) => r.category === trimmedOld)) return;
      tx.set(
        rulesRef,
        { rules: rules.map((r) => (r.category === trimmedOld ? { ...r, category: trimmedNew } : r)), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }),
    'Could not rename category on recurring rules',
  );

  return entriesUpdated;
}

export async function deleteCategoryFromDb(ledger, categoryName, rawDocs = []) {
  const trimmed = categoryName.trim();
  if (!trimmed) return;
  const targetKey = ledger === 'travel' ? 'travel' : 'household';
  const inUseCount = await countEntriesUsingCategory(ledger, trimmed);
  if (inUseCount > 0) {
    throw new Error(`"${trimmed}" is still used by ${inUseCount} ${inUseCount === 1 ? 'entry' : 'entries'} - rename it instead, or edit those entries first.`);
  }
  const docToDelete = rawDocs.find(
    (d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase() && (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
  );
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'categories', docToDelete.id));
    return;
  }
  // Fallback by name, limited to this ledger - it used to delete a same-named
  // category from the other ledger too (e.g. travel "Food" and household "Food").
  const q = query(categoriesRef, where('name', '==', trimmed));
  const snap = await getDocs(q);
  const matches = snap.docs.filter((d) => {
    const docLedger = d.data().ledger;
    return docLedger === targetKey || (!docLedger && targetKey === 'household');
  });
  await Promise.all(matches.map((d) => deleteDoc(doc(dbInstance, 'categories', d.id))));
}
