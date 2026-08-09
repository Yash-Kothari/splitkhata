import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PERSONS as PERSONS,
  computeBalance,
  computeMemberTotals,
  excludeCashSpend,
  computeTripTotalSpend,
  getTripLastDate,
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

// --- Regression tests for the trip-balance double-counting bug ---
//
// A shared ATM withdrawal and the itemized Cash-tagged purchases it funds
// both carry a real INR `amount`. The withdrawal already creates the
// shared debt for that cash (both people owe half of what was taken
// out) - re-splitting the itemized purchases on top double-counts the
// same money. This silently broke Sri Lanka's and South Korea's real
// balances (caught only by cross-checking against their actual Splitwise
// settlement figures) while Taiwan looked fine, purely because Taiwan's
// cash purchases all happened to be personal, not shared, so there was
// nothing to double-count. These fixtures reproduce that exact shape -
// a shared withdrawal fully spent on shared cash purchases - so a future
// change that reintroduces the double-count fails loudly instead of
// waiting for someone to notice a real-money mismatch.
function tripFixtureWithSharedCashWithdrawal() {
  return [
    // Card-paid hotel, split 50/50 - not cash, always counted.
    { amount: 4000, payer: 'Yash', split: true, splitType: 'shared', paymentMethod: 'Yash Diners', ledger: 'travel', tripName: 'Trip' },
    // The withdrawal itself: real INR cost, split 50/50 - this alone
    // creates the shared debt for the cash that follows.
    { amount: 1000, payer: 'Yash', split: true, splitType: 'shared', paymentMethod: 'Yash Diners', isWithdrawal: true, localAmount: 100, ledger: 'travel', tripName: 'Trip' },
    // Two shared cash purchases that together spend the entire
    // withdrawal - re-splitting these on top of the withdrawal above is
    // the double-count.
    { amount: 300, payer: 'Yash', split: true, splitType: 'shared', paymentMethod: 'Cash', localAmount: 30, ledger: 'travel', tripName: 'Trip' },
    { amount: 700, payer: 'Yash', split: true, splitType: 'shared', paymentMethod: 'Cash', localAmount: 70, ledger: 'travel', tripName: 'Trip' },
  ];
}

test('excludeCashSpend drops only Cash-paid entries, keeping the withdrawal itself', () => {
  const entries = tripFixtureWithSharedCashWithdrawal();
  const filtered = excludeCashSpend(entries);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((e) => e.paymentMethod !== 'Cash'));
  assert.ok(filtered.some((e) => e.isWithdrawal));
});

test('a trip balance does not double-count a shared withdrawal and the shared cash purchases it funds', () => {
  const entries = tripFixtureWithSharedCashWithdrawal();
  const balance = computeBalance(excludeCashSpend(entries), 'travel', PERSONS);
  // Only the hotel (4000) and the withdrawal (1000) should count - 5000
  // total, split 50/50, so Kruti owes Yash 2500. If the double-count
  // regresses, the 1000 KRW of cash purchases gets added back in on top
  // of the withdrawal, inflating this to 3000.
  assert.equal(balance.status, 'owes');
  assert.equal(balance.debtor, 'Kruti');
  assert.equal(balance.creditor, 'Yash');
  assert.equal(balance.amount, 2500);
});

test('per-person totals do not double-count a shared withdrawal and the cash purchases it funds', () => {
  const entries = tripFixtureWithSharedCashWithdrawal();
  const totals = computeMemberTotals(excludeCashSpend(entries), PERSONS);
  // Same 5000 total (hotel + withdrawal), split evenly.
  assert.equal(totals.Yash, 2500);
  assert.equal(totals.Kruti, 2500);
});

test('computeTripTotalSpend always equals the sum of per-person totals', () => {
  const entries = tripFixtureWithSharedCashWithdrawal();
  const totalSpend = computeTripTotalSpend(entries);
  const totals = computeMemberTotals(excludeCashSpend(entries), PERSONS);
  assert.equal(totalSpend, 5000);
  assert.equal(totalSpend, totals.Yash + totals.Kruti);
});

test('computeTripTotalSpend excludes settlements and trip rollups', () => {
  const entries = [
    ...tripFixtureWithSharedCashWithdrawal(),
    { amount: 2500, payer: 'Kruti', owedBy: 'Yash', split: true, splitType: 'settlement', paymentMethod: 'Yash Diners', ledger: 'travel', tripName: 'Trip' },
    { amount: 2500, payer: 'Yash', owedBy: 'Kruti', split: true, splitType: 'owed', isTripRollup: true, ledger: 'household' },
  ];
  assert.equal(computeTripTotalSpend(entries), 5000);
});

// Rupee floating-point addition isn't associative - summing the same
// entries in a different order used to give a slightly different total
// (a few paise off), which made a trip's rollup spuriously flag as
// "stale" against the household ledger even when nothing had changed.
// Regression test for the fix: shuffle the same entries and confirm every
// order gives back the exact same balance and per-person totals.
test('computeBalance and computeMemberTotals are exact and order-independent', () => {
  const amounts = [4755.94, 132.26, 404.67, 832.98, 1319.1, 648, 428.32, 314.15, 668.4, 565.83, 733, 732.78];
  const forward = amounts.map((amount, i) => ({
    amount,
    payer: i % 2 === 0 ? 'Yash' : 'Kruti',
    split: true,
    splitType: 'shared',
    ledger: 'travel',
    tripName: 'Trip',
  }));
  // Same (amount, payer) pairs, just reordered - not regenerated by
  // position, which would silently reassign who paid for what.
  const shuffled = [...forward].reverse();

  const forwardBalance = computeBalance(forward, 'travel', PERSONS);
  const shuffledBalance = computeBalance(shuffled, 'travel', PERSONS);
  assert.equal(forwardBalance.amount, shuffledBalance.amount);

  const forwardTotals = computeMemberTotals(forward, PERSONS);
  const shuffledTotals = computeMemberTotals(shuffled, PERSONS);
  assert.equal(forwardTotals.Yash, shuffledTotals.Yash);
  assert.equal(forwardTotals.Kruti, shuffledTotals.Kruti);
});

test('a trip with only personal cash purchases has nothing to double-count (Taiwan-shaped)', () => {
  const entries = [
    { amount: 1000, payer: 'Yash', split: true, splitType: 'shared', paymentMethod: 'Yash Diners', isWithdrawal: true, localAmount: 100, ledger: 'travel', tripName: 'Trip' },
    { amount: 400, payer: 'Yash', split: false, splitType: 'personal', paymentMethod: 'Cash', localAmount: 40, ledger: 'travel', tripName: 'Trip' },
    { amount: 600, payer: 'Yash', split: false, splitType: 'personal', paymentMethod: 'Cash', localAmount: 60, ledger: 'travel', tripName: 'Trip' },
  ];
  const withCash = computeBalance(entries, 'travel', PERSONS);
  const withoutCash = computeBalance(excludeCashSpend(entries), 'travel', PERSONS);
  // Personal entries are skipped by computeBalance regardless (split:
  // false), so excluding Cash changes nothing here - this is the exact
  // reason Taiwan's real numbers stayed correct even before the fix.
  assert.equal(withCash.amount, withoutCash.amount);
  assert.equal(withoutCash.amount, 500);
});

test('getTripLastDate returns the latest date among a trip\'s entries', () => {
  const entries = [
    { date: '2025-04-01' },
    { date: '2025-04-12' },
    { date: '2025-03-30' },
  ];
  assert.equal(getTripLastDate(entries), '2025-04-12');
});

test('getTripLastDate returns an empty string for a trip with no entries', () => {
  assert.equal(getTripLastDate([]), '');
});

// --- Regression tests for reward points ---
//
// A personal points redemption (e.g. paying for your own flight with
// airline miles) shouldn't create a person-to-person points debt, even
// though real points were spent - only a *shared* points-bearing entry
// should. Getting this backwards is what caused a "settled" trip's
// rollup to still show a points badge on its Payments-tab line.
test('a personal points redemption creates no cross-person points debt', () => {
  const entries = [
    { amount: 10000, payer: 'Yash', split: false, splitType: 'personal', rewardPoints: 20000, ledger: 'travel', tripName: 'Trip' },
  ];
  const pointsBalance = computeBalance(entries, 'travel', PERSONS, 'rewardPoints');
  assert.equal(pointsBalance.status, 'settled');
});

test('a shared points-bearing entry creates a real cross-person points debt', () => {
  const entries = [
    { amount: 10000, payer: 'Yash', split: true, splitType: 'shared', rewardPoints: 20000, ledger: 'travel', tripName: 'Trip' },
  ];
  const pointsBalance = computeBalance(entries, 'travel', PERSONS, 'rewardPoints');
  assert.equal(pointsBalance.status, 'owes');
  assert.equal(pointsBalance.debtor, 'Kruti');
  assert.equal(pointsBalance.creditor, 'Yash');
  assert.equal(pointsBalance.amount, 10000);
});

test('computeMemberTotals attributes a personal points redemption fully to its payer', () => {
  const entries = [
    { amount: 10000, payer: 'Yash', split: false, splitType: 'personal', rewardPoints: 20000, ledger: 'travel', tripName: 'Trip' },
    { amount: 5000, payer: 'Kruti', split: false, splitType: 'personal', rewardPoints: 8000, ledger: 'travel', tripName: 'Trip' },
  ];
  const pointsTotals = computeMemberTotals(entries, PERSONS, 'rewardPoints');
  assert.equal(pointsTotals.Yash, 20000);
  assert.equal(pointsTotals.Kruti, 8000);
});
