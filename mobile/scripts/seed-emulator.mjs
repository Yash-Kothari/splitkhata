// Usage: node scripts/seed-emulator.mjs (with the Firestore emulator already
// running: `firebase emulators:start --only firestore,auth` from the repo
// root, and mobile/.env's EXPO_PUBLIC_USE_FIRESTORE_EMULATOR=true).
//
// Writes a realistic, non-empty dataset straight to the emulator's REST API
// - no Firebase SDK needed, since the emulator accepts any bearer token as
// an authenticated "owner" in emulator mode (see 3.3 of the design doc).
// Every doc uses a fixed id, so re-running this just overwrites the same
// fixtures instead of piling up duplicates.
//
// The host is hardcoded to the emulator's own address - there is no flag or
// env var that could point this at production.
import { DEFAULT_PERSONS, DEFAULT_CATEGORIES, DEFAULT_TRAVEL_CATEGORIES, CARD_STRATEGY_DEFAULTS } from '../lib/utils.js';

const PROJECT_ID = 'splitkhata-96cbd';
const BASE_URL = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFirestoreFields(value) } };
  throw new Error(`Unsupported fixture value: ${JSON.stringify(value)}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

async function upsertDoc(path, data) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    throw new Error(`Failed to seed ${path}: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const now = new Date();

  // Members, categories, currencies - the reference lists every screen
  // expects, one doc each (matches subscribeToMembers/Categories/Currencies).
  await Promise.all(DEFAULT_PERSONS.map((name, i) => upsertDoc(`members/seed_member_${i}`, { name, createdAt: now })));
  await Promise.all(
    DEFAULT_CATEGORIES.map((name, i) => upsertDoc(`categories/seed_cat_household_${i}`, { name, ledger: 'household', createdAt: now })),
  );
  await Promise.all(
    DEFAULT_TRAVEL_CATEGORIES.map((name, i) => upsertDoc(`categories/seed_cat_travel_${i}`, { name, ledger: 'travel', createdAt: now })),
  );
  await Promise.all(
    ['USD', 'EUR'].map((name, i) => upsertDoc(`currencies/seed_currency_${i}`, { name, createdAt: now })),
  );

  // Household expenses - a shared one and a personal one, a few days apart.
  await upsertDoc('expenses/seed_household_1', {
    ledger: 'household',
    amount: 1200,
    category: 'Groceries',
    payer: DEFAULT_PERSONS[0],
    split: true,
    splitType: 'shared',
    note: 'Weekly groceries',
    date: daysAgoISO(2),
    paymentMethod: 'Cash',
    createdAt: now,
  });
  await upsertDoc('expenses/seed_household_2', {
    ledger: 'household',
    amount: 450,
    category: 'Dining',
    payer: DEFAULT_PERSONS[1] || DEFAULT_PERSONS[0],
    split: false,
    splitType: 'personal',
    note: 'Coffee with a friend',
    date: daysAgoISO(1),
    paymentMethod: 'Cash',
    createdAt: now,
  });

  // A trip with one travel expense, so Travel and BalanceStrip have data.
  await upsertDoc('trips/seed_trip_1', {
    name: 'Goa',
    currency: 'INR',
    createdAt: now,
  });
  await upsertDoc('expenses/seed_travel_1', {
    ledger: 'travel',
    tripName: 'Goa',
    amount: 2500,
    category: DEFAULT_TRAVEL_CATEGORIES[0],
    payer: DEFAULT_PERSONS[0],
    split: true,
    splitType: 'shared',
    note: 'Beach shack lunch',
    date: daysAgoISO(3),
    paymentMethod: 'Cash',
    createdAt: now,
  });

  // One credit card with strategyParamsHistory (required, or rewards
  // compute as NaN) plus a card transaction so cards.js has a real cycle.
  await upsertDoc('creditCards/seed_card_1', {
    name: 'Seed SBI Cashback',
    billingCycleDay: 1,
    rewardStrategy: 'sbi_two_channel_cashback',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }],
    createdAt: now,
  });
  await upsertDoc('cardTransactions/seed_card_txn_1', {
    cardId: 'seed_card_1',
    amount: 3200,
    channel: 'online',
    date: daysAgoISO(4),
    createdAt: now,
  });

  console.log('Seeded members, categories, currencies, 2 household entries, 1 trip + travel entry, 1 card + transaction.');
}

main().catch((err) => {
  console.error(err.message || err);
  console.error('\nIs the Firestore emulator running? From the repo root: firebase emulators:start --only firestore,auth');
  process.exit(1);
});
