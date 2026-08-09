import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  writeBatch,
  enableIndexedDbPersistence,
} from 'firebase/firestore';
import {
  DEFAULT_CATEGORIES as CATEGORIES,
  DEFAULT_TRAVEL_CATEGORIES as TRAVEL_CATEGORIES,
  DEFAULT_CURRENCIES as CURRENCIES,
  DEFAULT_PERSONS as PERSONS,
  DEFAULT_PAYMENT_METHODS as PAYMENT_METHODS,
  getStoredHouseholdCategories,
  setStoredHouseholdCategories,
  getStoredTravelCategories,
  setStoredTravelCategories,
  getStoredCurrencies,
  setStoredCurrencies,
  getStoredMembers,
  setStoredMembers,
  getStoredTrips,
  setStoredTrips,
  getStoredCashMovements,
  setStoredCashMovements,
  getStoredPaymentMethods,
  setStoredPaymentMethods,
  getPinConfig,
  setPinConfig,
  normalizeLedger,
  HOUSEHOLD_CATEGORIES_KEY,
  TRAVEL_CATEGORIES_KEY,
  CURRENCIES_KEY,
  MEMBERS_KEY,
  TRIPS_KEY,
  CASH_MOVEMENTS_KEY,
  PAYMENT_METHODS_KEY,
} from './utils';

// Firestore write batches are capped at 500 operations.
const BATCH_LIMIT = 500;

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const LOCAL_EXPENSES_KEY = 'splitkhata_expenses_fallback';
const LOCAL_CATEGORIES_KEY = 'splitkhata_categories_fallback';
const ALLOWED_EMAILS = new Set([
  'yash.sk.kothari@gmail.com',
  'kruti.v.sheth@gmail.com',
]);

export function isFirebaseConfigured() {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID,
  );
}

let dbInstance = null;
let expensesRef = null;
let categoriesRef = null;
let currenciesRef = null;
let membersRef = null;
let tripsRef = null;
let cashMovementsRef = null;
let paymentMethodsRef = null;
let authInstance = null;

if (isFirebaseConfigured()) {
  try {
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    const app = initializeApp(firebaseConfig);
    authInstance = getAuth(app);
    dbInstance = getFirestore(app);
    enableIndexedDbPersistence(dbInstance).catch((err) => {
      if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
        console.warn('Firestore persistence error:', err);
      }
    });
    expensesRef = collection(dbInstance, 'expenses');
    categoriesRef = collection(dbInstance, 'categories');
    currenciesRef = collection(dbInstance, 'currencies');
    membersRef = collection(dbInstance, 'members');
    tripsRef = collection(dbInstance, 'trips');
    cashMovementsRef = collection(dbInstance, 'cashMovements');
    paymentMethodsRef = collection(dbInstance, 'paymentMethods');
  } catch (err) {
    console.warn('Firebase initialization failed, falling back to local database:', err);
  }
}

export const db = dbInstance;

export function isAllowedUser(user) {
  return Boolean(user?.email && user.emailVerified && ALLOWED_EMAILS.has(user.email.toLowerCase()));
}

export function subscribeToAuth(callback) {
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, callback);
}

export async function signInWithGoogle() {
  if (!authInstance) throw new Error('Firebase is not configured.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(authInstance, provider);
}

export async function signOutUser() {
  if (authInstance) await signOut(authInstance);
}

// Local storage event listeners for reactive multi-tab updates when in fallback mode
const expenseListeners = new Set();
const categoryListeners = new Set();
const currencyListeners = new Set();
const memberListeners = new Set();
const tripListeners = new Set();
const cashMovementListeners = new Set();
const paymentMethodListeners = new Set();

let categoriesSeededFlag = false;

function getLocalExpenses() {
  try {
    const raw = localStorage.getItem(LOCAL_EXPENSES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalExpenses(data) {
  try {
    localStorage.setItem(LOCAL_EXPENSES_KEY, JSON.stringify(data));
    expenseListeners.forEach((fn) => fn(data));
  } catch (err) {
    console.error('Failed to save expenses to local database:', err);
  }
}

function getLocalCategories() {
  return {
    household: getStoredHouseholdCategories(),
    travel: getStoredTravelCategories(),
  };
}

function saveLocalCategories(data) {
  try {
    if (data.household) setStoredHouseholdCategories(data.household);
    if (data.travel) setStoredTravelCategories(data.travel);
    localStorage.setItem(LOCAL_CATEGORIES_KEY, JSON.stringify(data));
    categoryListeners.forEach((fn) => fn(getLocalCategories()));
  } catch (err) {
    console.error('Failed to save categories to local database:', err);
  }
}

// Subscriptions
export function subscribeToExpenses(ledger, onData, onError) {
  const targetLedger = normalizeLedger(ledger);

  if (expensesRef) {
    // Scoped to the active ledger so a client never downloads the other
    // ledger's history. Ordered server-side by `date` (what the UI actually
    // sorts by) rather than `createdAt`, and doubles as the cursor field if
    // pagination is added later. Requires a composite index on (ledger, date).
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
  } else {
    const handler = (data) => onData(data.filter((e) => normalizeLedger(e.ledger) === targetLedger));
    expenseListeners.add(handler);
    onData(getLocalExpenses().filter((e) => normalizeLedger(e.ledger) === targetLedger));

    const storageListener = (e) => {
      if (e.key === LOCAL_EXPENSES_KEY) {
        onData(getLocalExpenses().filter((entry) => normalizeLedger(entry.ledger) === targetLedger));
      }
    };
    window.addEventListener('storage', storageListener);

    return () => {
      expenseListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

export function subscribeToCategories(onData, onError) {
  if (categoriesRef) {
    const q = query(categoriesRef, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty && !categoriesSeededFlag) {
          categoriesSeededFlag = true;
          // Seed database with defaults once if empty
          seedDefaultCategories().catch(() => {});
          onData({ household: [...CATEGORIES], travel: [...TRAVEL_CATEGORIES], rawDocs: [] });
          return;
        }

        const household = [];
        const travel = [];
        const categoryDocs = [];

        snapshot.docs.forEach((docSnap) => {
          const item = { id: docSnap.id, ...docSnap.data() };
          categoryDocs.push(item);
          if (item.ledger === 'travel') {
            if (item.name) travel.push(item.name);
          } else {
            if (item.name) household.push(item.name);
          }
        });

        onData({
          household: categoriesSeededFlag && snapshot.empty ? [] : household,
          travel: categoriesSeededFlag && snapshot.empty ? [] : travel,
          rawDocs: categoryDocs,
        });
      },
      onError,
    );
  } else {
    const handler = (data) => onData(data);
    categoryListeners.add(handler);
    onData(getLocalCategories());

    const storageListener = (e) => {
      if (
        e.key === HOUSEHOLD_CATEGORIES_KEY ||
        e.key === TRAVEL_CATEGORIES_KEY ||
        e.key === LOCAL_CATEGORIES_KEY
      ) {
        onData(getLocalCategories());
      }
    };
    window.addEventListener('storage', storageListener);

    return () => {
      categoryListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

async function seedDefaultCategories() {
  if (!categoriesRef) return;
  const batch = writeBatch(dbInstance);
  for (const cat of CATEGORIES) {
    batch.set(doc(categoriesRef), { name: cat, ledger: 'household', createdAt: serverTimestamp() });
  }
  for (const cat of TRAVEL_CATEGORIES) {
    batch.set(doc(categoriesRef), { name: cat, ledger: 'travel', createdAt: serverTimestamp() });
  }
  await batch.commit();
}

// Currencies Subscription & Actions
let currenciesSeededFlag = false;

export function subscribeToCurrencies(onData, onError) {
  if (currenciesRef) {
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
        const currenciesList = [];
        const rawDocs = [];
        snapshot.docs.forEach((d) => {
          const item = { id: d.id, ...d.data() };
          rawDocs.push(item);
          if (item.name) currenciesList.push(item.name);
        });
        onData({
          currencies: currenciesList,
          rawDocs,
        });
      },
      onError,
    );
  } else {
    const handler = (data) => onData(data);
    currencyListeners.add(handler);
    onData({ currencies: getStoredCurrencies(), rawDocs: [] });

    const storageListener = (e) => {
      if (e.key === CURRENCIES_KEY) {
        onData({ currencies: getStoredCurrencies(), rawDocs: [] });
      }
    };
    window.addEventListener('storage', storageListener);

    return () => {
      currencyListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

async function seedDefaultCurrencies() {
  if (!currenciesRef) return;
  const batch = writeBatch(dbInstance);
  for (const cur of CURRENCIES) {
    batch.set(doc(currenciesRef), { name: cur, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function addCurrencyToDb(name, existingRawDocs = []) {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) return;

  if (currenciesRef) {
    const exists = existingRawDocs.some(
      (d) => d.name && d.name.trim().toUpperCase() === trimmed,
    );
    if (!exists) {
      await addDoc(currenciesRef, {
        name: trimmed,
        createdAt: serverTimestamp(),
      });
    }
  }

  const current = getStoredCurrencies();
  if (!current.includes(trimmed)) {
    const updated = [...current, trimmed];
    setStoredCurrencies(updated);
    currencyListeners.forEach((fn) => fn({ currencies: updated, rawDocs: [] }));
  }
}

export async function deleteCurrencyFromDb(name, rawDocs = []) {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) return;

  if (currenciesRef) {
    const docToDelete = rawDocs.find(
      (d) => d.name && d.name.trim().toUpperCase() === trimmed,
    );
    if (docToDelete?.id) {
      await deleteDoc(doc(dbInstance, 'currencies', docToDelete.id));
    } else {
      try {
        const q = query(currenciesRef, where('name', '==', trimmed));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const promises = snap.docs.map((d) => deleteDoc(doc(dbInstance, 'currencies', d.id)));
          await Promise.all(promises);
        } else {
          // If Firestore had no docs for defaults, seed remaining defaults
          const current = getStoredCurrencies();
          const remaining = current.filter((c) => c.toUpperCase() !== trimmed);
          for (const c of remaining) {
            await addDoc(currenciesRef, { name: c, createdAt: serverTimestamp() });
          }
        }
      } catch (err) {
        console.error('Error deleting currency from Firestore:', err);
      }
    }
  }

  const current = getStoredCurrencies();
  const updated = current.filter((c) => c.toUpperCase() !== trimmed);
  setStoredCurrencies(updated);
  currencyListeners.forEach((fn) => fn({ currencies: updated, rawDocs: [] }));
}

// Members Subscription & Actions
let membersSeededFlag = false;

export function subscribeToMembers(onData, onError) {
  if (membersRef) {
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
        const membersList = [];
        const rawDocs = [];
        snapshot.docs.forEach((d) => {
          const item = { id: d.id, ...d.data() };
          rawDocs.push(item);
          if (item.name) membersList.push(item.name);
        });
        onData({
          members: membersList,
          rawDocs,
        });
      },
      onError,
    );
  } else {
    const handler = (data) => onData(data);
    memberListeners.add(handler);
    onData({ members: getStoredMembers(), rawDocs: [] });

    const storageListener = (e) => {
      if (e.key === MEMBERS_KEY) {
        onData({ members: getStoredMembers(), rawDocs: [] });
      }
    };
    window.addEventListener('storage', storageListener);

    return () => {
      memberListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

async function seedDefaultMembers() {
  if (!membersRef) return;
  const batch = writeBatch(dbInstance);
  for (const p of PERSONS) {
    batch.set(doc(membersRef), { name: p, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function addMemberToDb(name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (membersRef) {
    const exists = existingRawDocs.some(
      (d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (!exists) {
      await addDoc(membersRef, {
        name: trimmed,
        createdAt: serverTimestamp(),
      });
    }
  }

  const current = getStoredMembers();
  if (!current.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
    const updated = [...current, trimmed];
    setStoredMembers(updated);
    memberListeners.forEach((fn) => fn({ members: updated, rawDocs: [] }));
  }
}

export async function deleteMemberFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (membersRef) {
    const docToDelete = rawDocs.find(
      (d) => d.name && d.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (docToDelete?.id) {
      await deleteDoc(doc(dbInstance, 'members', docToDelete.id));
    } else {
      try {
        const q = query(membersRef, where('name', '==', trimmed));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const promises = snap.docs.map((d) => deleteDoc(doc(dbInstance, 'members', d.id)));
          await Promise.all(promises);
        } else {
          const current = getStoredMembers();
          const remaining = current.filter((m) => m.toLowerCase() !== trimmed.toLowerCase());
          for (const m of remaining) {
            await addDoc(membersRef, { name: m, createdAt: serverTimestamp() });
          }
        }
      } catch (err) {
        console.error('Error deleting member from Firestore:', err);
      }
    }
  }

  const current = getStoredMembers();
  const updated = current.filter((m) => m.toLowerCase() !== trimmed.toLowerCase());
  setStoredMembers(updated);
  memberListeners.forEach((fn) => fn({ members: updated, rawDocs: [] }));
}

// Trips (travel ledger)
export function subscribeToTrips(onData, onError) {
  if (tripsRef) {
    const q = query(tripsRef, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      onError,
    );
  } else {
    const handler = (data) => onData(data);
    tripListeners.add(handler);
    onData(getStoredTrips());

    const storageListener = (e) => {
      if (e.key === TRIPS_KEY) onData(getStoredTrips());
    };
    window.addEventListener('storage', storageListener);

    return () => {
      tripListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

export async function addTripToDb(name, currency, year, existingTrips = [], startDate = null, endDate = null) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = existingTrips.some((t) => t.name?.trim().toLowerCase() === trimmed.toLowerCase());
  if (exists) return;

  if (tripsRef) {
    await addDoc(tripsRef, { name: trimmed, currency, year, startDate, endDate, createdAt: serverTimestamp() });
  } else {
    const current = getStoredTrips();
    const newTrip = { id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: trimmed, currency, year, startDate, endDate };
    const updated = [...current, newTrip];
    setStoredTrips(updated);
    tripListeners.forEach((fn) => fn(updated));
  }
}

export async function updateTripInDb(tripId, updates) {
  if (tripsRef) {
    if (tripId) await updateDoc(doc(dbInstance, 'trips', tripId), updates);
  } else {
    const current = getStoredTrips();
    const updated = current.map((t) => (t.id === tripId ? { ...t, ...updates } : t));
    setStoredTrips(updated);
    tripListeners.forEach((fn) => fn(updated));
  }
}

export async function deleteTripFromDb(tripId, tripName) {
  if (tripsRef) {
    if (tripId) await deleteDoc(doc(dbInstance, 'trips', tripId));
  } else {
    const current = getStoredTrips();
    const updated = current.filter((t) => t.name !== tripName);
    setStoredTrips(updated);
    tripListeners.forEach((fn) => fn(updated));
  }
}

// Cash movements (travel ledger - opening balance + ATM withdrawals per trip)
export function subscribeToCashMovements(onData, onError) {
  if (cashMovementsRef) {
    const q = query(cashMovementsRef, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        onData(snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
        })));
      },
      onError,
    );
  } else {
    const handler = (data) => onData(data);
    cashMovementListeners.add(handler);
    onData(getStoredCashMovements());

    const storageListener = (e) => {
      if (e.key === CASH_MOVEMENTS_KEY) onData(getStoredCashMovements());
    };
    window.addEventListener('storage', storageListener);

    return () => {
      cashMovementListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

export async function addCashMovementToDb(movement) {
  if (cashMovementsRef) {
    await addDoc(cashMovementsRef, { ...movement, createdAt: serverTimestamp() });
  } else {
    const current = getStoredCashMovements();
    const newMovement = {
      id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ...movement,
      createdAt: new Date().toISOString(),
    };
    const updated = [...current, newMovement];
    setStoredCashMovements(updated);
    cashMovementListeners.forEach((fn) => fn(updated));
  }
}

export async function deleteCashMovementFromDb(id) {
  if (cashMovementsRef) {
    await deleteDoc(doc(dbInstance, 'cashMovements', id));
  } else {
    const current = getStoredCashMovements();
    const updated = current.filter((m) => m.id !== id);
    setStoredCashMovements(updated);
    cashMovementListeners.forEach((fn) => fn(updated));
  }
}

// Payment methods (travel ledger - "Cash", "Yash Forex", "Kruti Diners", etc.)
let paymentMethodsSeededFlag = false;

export function subscribeToPaymentMethods(onData, onError) {
  if (paymentMethodsRef) {
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
  } else {
    const handler = (data) => onData(data);
    paymentMethodListeners.add(handler);
    onData({ methods: getStoredPaymentMethods(), rawDocs: [] });

    const storageListener = (e) => {
      if (e.key === PAYMENT_METHODS_KEY) onData({ methods: getStoredPaymentMethods(), rawDocs: [] });
    };
    window.addEventListener('storage', storageListener);

    return () => {
      paymentMethodListeners.delete(handler);
      window.removeEventListener('storage', storageListener);
    };
  }
}

async function seedDefaultPaymentMethods() {
  if (!paymentMethodsRef) return;
  const batch = writeBatch(dbInstance);
  for (const m of PAYMENT_METHODS) {
    batch.set(doc(paymentMethodsRef), { name: m, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function addPaymentMethodToDb(name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (paymentMethodsRef) {
    const exists = existingRawDocs.some((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      await addDoc(paymentMethodsRef, { name: trimmed, createdAt: serverTimestamp() });
    }
  }

  const current = getStoredPaymentMethods();
  if (!current.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
    const updated = [...current, trimmed];
    setStoredPaymentMethods(updated);
    paymentMethodListeners.forEach((fn) => fn({ methods: updated, rawDocs: [] }));
  }
}

export async function deletePaymentMethodFromDb(name, rawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (paymentMethodsRef) {
    const docToDelete = rawDocs.find((d) => d.name?.trim().toLowerCase() === trimmed.toLowerCase());
    if (docToDelete?.id) {
      await deleteDoc(doc(dbInstance, 'paymentMethods', docToDelete.id));
    }
  }

  const current = getStoredPaymentMethods();
  const updated = current.filter((m) => m.toLowerCase() !== trimmed.toLowerCase());
  setStoredPaymentMethods(updated);
  paymentMethodListeners.forEach((fn) => fn({ methods: updated, rawDocs: [] }));
}

// Database Actions
export async function addExpense(entry) {
  if (expensesRef) {
    const docRef = await addDoc(expensesRef, {
      ...entry,
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  } else {
    const current = getLocalExpenses();
    const newEntry = {
      id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ...entry,
      createdAt: new Date().toISOString(),
    };
    saveLocalExpenses([newEntry, ...current]);
    return newEntry.id;
  }
}

// Writes multiple expenses as one atomic operation (chunked at Firestore's
// 500-op batch limit) instead of N sequential round-trips - used for the
// multi-month split, where a single "Add Entry" submit can create a dozen+ docs.
export async function addExpensesBatch(entries) {
  if (!entries.length) return;

  if (expensesRef) {
    for (const group of chunk(entries, BATCH_LIMIT)) {
      const batch = writeBatch(dbInstance);
      for (const entry of group) {
        batch.set(doc(expensesRef), { ...entry, createdAt: serverTimestamp() });
      }
      await batch.commit();
    }
  } else {
    const current = getLocalExpenses();
    const newEntries = entries.map((entry, i) => ({
      id: 'local_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 7),
      ...entry,
      createdAt: new Date().toISOString(),
    }));
    saveLocalExpenses([...newEntries, ...current]);
  }
}

export async function deleteExpense(id) {
  if (expensesRef) {
    await deleteDoc(doc(dbInstance, 'expenses', id));
  } else {
    const current = getLocalExpenses();
    const filtered = current.filter((item) => item.id !== id);
    saveLocalExpenses(filtered);
  }
}

export async function updateExpense(id, updates) {
  if (expensesRef) {
    await updateDoc(doc(dbInstance, 'expenses', id), updates);
  } else {
    const current = getLocalExpenses();
    const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
    saveLocalExpenses(updated);
  }
}

export async function addCategoryToDb(ledger, name, existingRawDocs = []) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const targetKey = ledger === 'travel' ? 'travel' : 'household';

  if (categoriesRef) {
    // Check if duplicate exists
    const exists = existingRawDocs.some(
      (d) =>
        d.name &&
        d.name.trim().toLowerCase() === trimmed.toLowerCase() &&
        (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
    );
    if (!exists) {
      await addDoc(categoriesRef, {
        name: trimmed,
        ledger: targetKey,
        createdAt: serverTimestamp(),
      });
    }
  }

  const current = getLocalCategories();
  const list = current[targetKey] || (targetKey === 'travel' ? TRAVEL_CATEGORIES : CATEGORIES);
  if (!list.some((c) => c.trim().toLowerCase() === trimmed.toLowerCase())) {
    const next = { ...current, [targetKey]: [...list, trimmed] };
    saveLocalCategories(next);
  }
}

export async function deleteCategoryFromDb(ledger, categoryName, rawDocs = []) {
  const trimmed = categoryName.trim();
  if (!trimmed) return;

  const targetKey = ledger === 'travel' ? 'travel' : 'household';

  if (categoriesRef) {
    const docToDelete = rawDocs.find(
      (d) =>
        d.name &&
        d.name.trim().toLowerCase() === trimmed.toLowerCase() &&
        (d.ledger === targetKey || (!d.ledger && targetKey === 'household')),
    );
    if (docToDelete?.id) {
      await deleteDoc(doc(dbInstance, 'categories', docToDelete.id));
    } else {
      try {
        const q = query(categoriesRef, where('name', '==', trimmed));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const deletePromises = snap.docs.map((d) => deleteDoc(doc(dbInstance, 'categories', d.id)));
          await Promise.all(deletePromises);
        } else {
          // Seed remaining defaults if no Firestore docs existed for defaults
          const defaultList = targetKey === 'travel' ? TRAVEL_CATEGORIES : CATEGORIES;
          const remainingDefaults = defaultList.filter(
            (c) => c.trim().toLowerCase() !== trimmed.toLowerCase(),
          );
          for (const cat of remainingDefaults) {
            await addDoc(categoriesRef, {
              name: cat,
              ledger: targetKey,
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        console.error('Error deleting category doc from Firestore:', err);
      }
    }
  }

  const current = getLocalCategories();
  const list = current[targetKey] || (targetKey === 'travel' ? TRAVEL_CATEGORIES : CATEGORIES);
  const updatedList = list.filter((c) => c.trim().toLowerCase() !== trimmed.toLowerCase());
  
  saveLocalCategories({
    ...current,
    [targetKey]: updatedList,
  });
}

export async function wipeAllExpenses() {
  if (expensesRef) {
    try {
      const snap = await getDocs(expensesRef);
      for (const group of chunk(snap.docs, BATCH_LIMIT)) {
        const batch = writeBatch(dbInstance);
        for (const d of group) {
          batch.delete(doc(dbInstance, 'expenses', d.id));
        }
        await batch.commit();
      }
    } catch (err) {
      console.error('Error wiping expenses in Firestore:', err);
    }
  }
  saveLocalExpenses([]);
}

export async function seedSampleExpenses() {
  const SAMPLE_ENTRIES = [
    // July 2026
    { amount: 3800, category: 'Groceries', payer: 'Yash', split: true, ledger: 'household', date: '2026-07-04', note: 'Weekly supermarket shop', deviceName: 'Yash' },
    { amount: 2200, category: 'Utilities', payer: 'Kruti', split: true, ledger: 'household', date: '2026-07-08', note: 'Electricity bill', deviceName: 'Kruti' },
    { amount: 1950, category: 'Eating Out', payer: 'Yash', split: true, ledger: 'household', date: '2026-07-12', note: 'Weekend dinner', deviceName: 'Yash' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-07-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 1400, category: 'Health', payer: 'Kruti', split: true, ledger: 'household', date: '2026-07-19', note: 'Pharmacy refills', deviceName: 'Kruti' },

    // June 2026
    { amount: 4200, category: 'Groceries', payer: 'Kruti', split: true, ledger: 'household', date: '2026-06-05', note: 'Organic market', deviceName: 'Kruti' },
    { amount: 2100, category: 'Utilities', payer: 'Yash', split: true, ledger: 'household', date: '2026-06-09', note: 'Water & wifi bill', deviceName: 'Yash' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-06-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 3100, category: 'Eating Out', payer: 'Kruti', split: true, ledger: 'household', date: '2026-06-15', note: 'Celebration lunch', deviceName: 'Kruti' },
    { amount: 1600, category: 'Transport', payer: 'Yash', split: true, ledger: 'household', date: '2026-06-20', note: 'Fuel refill', deviceName: 'Yash' },
    { amount: 2500, category: 'Entertainment', payer: 'Yash', split: true, ledger: 'household', date: '2026-06-24', note: 'Concert tickets', deviceName: 'Yash' },

    // May 2026
    { amount: 3100, category: 'Groceries', payer: 'Yash', split: true, ledger: 'household', date: '2026-05-03', note: 'Pantry restocking', deviceName: 'Yash' },
    { amount: 1900, category: 'Utilities', payer: 'Kruti', split: true, ledger: 'household', date: '2026-05-10', note: 'Electricity', deviceName: 'Kruti' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-05-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 2800, category: 'Health', payer: 'Yash', split: true, ledger: 'household', date: '2026-05-18', note: 'Dental checkup', deviceName: 'Yash' },
    { amount: 1200, category: 'Transport', payer: 'Kruti', split: true, ledger: 'household', date: '2026-05-22', note: 'Cab passes', deviceName: 'Kruti' },

    // April 2026
    { amount: 3900, category: 'Groceries', payer: 'Kruti', split: true, ledger: 'household', date: '2026-04-06', note: 'Monthly groceries', deviceName: 'Kruti' },
    { amount: 2400, category: 'Utilities', payer: 'Yash', split: true, ledger: 'household', date: '2026-04-11', note: 'Maintenance fee', deviceName: 'Yash' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-04-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 2200, category: 'Eating Out', payer: 'Yash', split: true, ledger: 'household', date: '2026-04-17', note: 'Pizza night', deviceName: 'Yash' },
    { amount: 4500, category: 'Household', payer: 'Kruti', split: true, ledger: 'household', date: '2026-04-25', note: 'Kitchen appliances', deviceName: 'Kruti' },

    // March 2026
    { amount: 2900, category: 'Groceries', payer: 'Yash', split: true, ledger: 'household', date: '2026-03-05', note: 'Weekly produce', deviceName: 'Yash' },
    { amount: 1800, category: 'Utilities', payer: 'Kruti', split: true, ledger: 'household', date: '2026-03-09', note: 'Internet & power', deviceName: 'Kruti' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-03-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 1100, category: 'Transport', payer: 'Yash', split: true, ledger: 'household', date: '2026-03-14', note: 'Metro card topup', deviceName: 'Yash' },
    { amount: 1800, category: 'Entertainment', payer: 'Kruti', split: true, ledger: 'household', date: '2026-03-22', note: 'Movie & snacks', deviceName: 'Kruti' },

    // February 2026
    { amount: 3200, category: 'Groceries', payer: 'Kruti', split: true, ledger: 'household', date: '2026-02-04', note: 'Supermarket', deviceName: 'Kruti' },
    { amount: 2000, category: 'Utilities', payer: 'Yash', split: true, ledger: 'household', date: '2026-02-08', note: 'Power bill', deviceName: 'Yash' },
    { amount: 18000, category: 'Rent', payer: 'Yash', split: true, ledger: 'household', date: '2026-02-01', note: 'Monthly apartment rent', deviceName: 'Yash' },
    { amount: 2800, category: 'Eating Out', payer: 'Kruti', split: true, ledger: 'household', date: '2026-02-14', note: 'Valentine dinner', deviceName: 'Kruti' },
    { amount: 900, category: 'Health', payer: 'Yash', split: true, ledger: 'household', date: '2026-02-21', note: 'Vitamins', deviceName: 'Yash' },

    // Travel ledger entries
    { amount: 14500, category: 'Flight', payer: 'Yash', split: true, ledger: 'travel', trip: "Japan Summer '26", date: '2026-06-02', note: 'Tokyo round trip', deviceName: 'Yash' },
    { amount: 22000, category: 'Hotel', payer: 'Kruti', split: true, ledger: 'travel', trip: "Japan Summer '26", date: '2026-06-04', note: 'Shinjuku stay 4 nights', deviceName: 'Kruti' },
    { amount: 4800, category: 'Food', payer: 'Yash', split: true, ledger: 'travel', trip: "Japan Summer '26", date: '2026-06-06', note: 'Ramen & Izakaya', deviceName: 'Yash' },
    { amount: 1900, category: 'Commute', payer: 'Kruti', split: true, ledger: 'travel', trip: "Japan Summer '26", date: '2026-06-07', note: 'JR Pass card', deviceName: 'Kruti' },
  ];

  await addExpensesBatch(SAMPLE_ENTRIES);
}

export function subscribeToPinConfig(callback) {
  if (dbInstance) {
    const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
    return onSnapshot(
      pinDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const config = {
            pin: typeof data.pin === 'string' ? data.pin : '',
            enabled: Boolean(data.enabled),
          };
          setPinConfig(config);
          callback(config);
        } else {
          callback(getPinConfig());
        }
      },
      (err) => {
        console.warn('PIN config subscription error:', err);
        callback(getPinConfig());
      },
    );
  } else {
    callback(getPinConfig());
    return () => {};
  }
}

export async function savePinConfigToDb(config) {
  setPinConfig(config);
  if (dbInstance) {
    try {
      const pinDocRef = doc(dbInstance, 'settings', 'pin_config');
      await setDoc(pinDocRef, {
        pin: config.pin || '',
        enabled: Boolean(config.enabled),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error saving PIN config to Firestore:', err);
    }
  }
}

