import { Platform } from 'react-native';
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
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
} from '@firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
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
const dbInstance = getFirestore(app);

// Opt-in only (EXPO_PUBLIC_USE_FIRESTORE_EMULATOR=true in mobile/.env) - lets
// development point at a disposable local Firestore (`firebase emulators:start
// --only firestore` from the repo root) instead of the real household's data,
// while still using the real Google Sign-In/Firebase Auth project. Default
// stays off so a plain `npx expo run:ios` always talks to prod, matching the
// web app's behavior.
if (__DEV__ && process.env.EXPO_PUBLIC_USE_FIRESTORE_EMULATOR === 'true') {
  connectFirestoreEmulator(dbInstance, 'localhost', 8080);
}

const expensesRef = collection(dbInstance, 'expenses');
const categoriesRef = collection(dbInstance, 'categories');
const membersRef = collection(dbInstance, 'members');
const tripsRef = collection(dbInstance, 'trips');
const cashMovementsRef = collection(dbInstance, 'cashMovements');
const paymentMethodsRef = collection(dbInstance, 'paymentMethods');
const currenciesRef = collection(dbInstance, 'currencies');

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
export async function signInWithGoogleIdToken(idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
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
    (err) => { console.warn('Household budgets subscription error:', err); callback({}); },
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
    (err) => { console.warn('Payment reminder config subscription error:', err); callback({ enabled: true, amountThreshold: 2000 }); },
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

export async function addPaymentMethodToDb(name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingRawDocs.some((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    await addDoc(paymentMethodsRef, { name: trimmed, createdAt: serverTimestamp() });
  }
}

export async function deletePaymentMethodFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const docToDelete = rawDocs.find((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (docToDelete?.id) {
    await deleteDoc(doc(dbInstance, 'paymentMethods', docToDelete.id));
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
