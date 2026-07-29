import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PERSONS as PERSONS,
  computeBalance,
  getLedgerCategories,
  getStoredHouseholdCategories,
  getStoredTrips,
  normalizeLedger,
  setStoredHouseholdCategories,
  getPreviousMonthKey,
  getLast6MonthsData,
  getCategoryMoMComparison,
} from '../src/utils.js';

test('uses Yash and Kruti as default pair names', () => {
  assert.deepEqual(PERSONS, ['Yash', 'Kruti']);
});

test('computes balances per ledger using the active pair names', () => {
  const entries = [
    { amount: 600, payer: 'Yash', split: true, ledger: 'household' },
    { amount: 300, payer: 'Kruti', split: true, ledger: 'household' },
    { amount: 400, payer: 'Yash', split: true, ledger: 'travel' },
  ];

  const householdBalance = computeBalance(entries, 'household');
  const travelBalance = computeBalance(entries, 'travel');

  assert.equal(householdBalance.status, 'owes');
  assert.equal(householdBalance.debtor, 'Kruti');
  assert.equal(householdBalance.creditor, 'Yash');
  assert.equal(householdBalance.amount, 150);

  assert.equal(travelBalance.status, 'owes');
  assert.equal(travelBalance.debtor, 'Kruti');
  assert.equal(travelBalance.creditor, 'Yash');
  assert.equal(travelBalance.amount, 200);
});

test('computes previous month key correctly', () => {
  assert.equal(getPreviousMonthKey('2026-03'), '2026-02');
  assert.equal(getPreviousMonthKey('2026-01'), '2025-12');
});

test('computes last 6 months spend data', () => {
  const entries = [
    { amount: 1000, date: '2026-03-10', ledger: 'household' },
    { amount: 500, date: '2026-02-15', ledger: 'household' },
  ];
  const data = getLast6MonthsData(entries, 'household');
  assert.equal(data.length, 6);
  const marchData = data.find((d) => d.month === '2026-03');
  assert.equal(marchData.total, 1000);
  assert.equal(marchData.prevTotal, 500);
  assert.equal(marchData.pctChange, 100);
});

test('computes category MoM comparison with percentage changes', () => {
  const entries = [
    { amount: 200, category: 'Groceries', date: '2026-03-01', ledger: 'household' },
    { amount: 100, category: 'Groceries', date: '2026-02-01', ledger: 'household' },
  ];
  const comp = getCategoryMoMComparison(entries, '2026-03', 'household');
  const groceries = comp.find((c) => c.category === 'Groceries');
  assert.equal(groceries.amount, 200);
  assert.equal(groceries.prevAmount, 100);
  assert.equal(groceries.pctChange, 100);
});

test('returns the expected category list for travel and household ledgers', () => {
  assert.deepEqual(getLedgerCategories('travel'), [
    'Flight',
    'Hotel',
    'Food',
    'Commute',
    'Attraction',
    'Souvenir',
    'Insurance',
    'Misc',
    'Other',
  ]);
  assert.deepEqual(getLedgerCategories('household'), [
    'Groceries',
    'Utilities',
    'Rent',
    'Eating Out',
    'Transport',
    'Household',
    'Health',
    'Entertainment',
    'Other',
  ]);
});

test('normalizes legacy ledger values to household', () => {
  assert.equal(normalizeLedger('travel'), 'travel');
  assert.equal(normalizeLedger('Travel'), 'travel');
  assert.equal(normalizeLedger(undefined), 'household');
  assert.equal(normalizeLedger(null), 'household');
});

test('stores trips in local storage as a list', () => {
  const trips = getStoredTrips();
  assert.ok(Array.isArray(trips));
});

test('stores and retrieves custom household categories', () => {
  const categories = ['Groceries', 'Rent', 'School'];
  setStoredHouseholdCategories(categories);
  assert.deepEqual(getStoredHouseholdCategories(), categories);
});
