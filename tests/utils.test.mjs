import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PERSONS as PERSONS,
  computeBalance,
  computeMemberTotals,
  computeSettlements,
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
  buildTripDigestPrompt,
  buildCategorySuggestionSchema,
  buildCategorySuggestionPrompt,
  buildQuickAddSchema,
  buildQuickAddPrompt,
  buildAskQuestionSchema,
  buildAskQuestionPrompt,
  resolveAskQuery,
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

// --- Regression tests for computeSettlements (trip guests) ---
//
// A trip with a guest has 3+ members, where computeBalance's
// biggest-debtor-vs-biggest-creditor fallback can silently drop a real
// debt. computeSettlements is what the UI actually shows once a trip has
// guests - it must produce the full, correct set of pairwise transfers.

test('computeSettlements matches computeBalance exactly for two people', () => {
  const entries = [
    { amount: 600, payer: 'Yash', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 300, payer: 'Kruti', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
  ];
  const balance = computeBalance(entries, 'travel', PERSONS);
  const settlements = computeSettlements(entries, 'travel', PERSONS);

  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].debtor, balance.debtor);
  assert.equal(settlements[0].creditor, balance.creditor);
  assert.equal(settlements[0].amount, balance.amount);
});

test('computeSettlements returns no transfers when three people are already settled', () => {
  const entries = [
    { amount: 300, payer: 'Yash', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 300, payer: 'Kruti', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 300, payer: 'Guest', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
  ];
  const settlements = computeSettlements(entries, 'travel', ['Yash', 'Kruti', 'Guest']);
  assert.deepEqual(settlements, []);
});

// This is exactly the case computeBalance's 3+-member fallback gets wrong:
// two separate people (Yash and Kruti) each owe the same third person
// (Guest), but the fallback only ever reports the single biggest pair -
// here it would report "Yash owes Guest 1000" and silently drop that
// Kruti owes Guest 500 too. computeSettlements must report both.
test('computeSettlements reports every real debt, not just the largest one', () => {
  const entries = [
    { amount: 3000, payer: 'Guest', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
  ];
  const members = ['Yash', 'Kruti', 'Guest'];
  const settlements = computeSettlements(entries, 'travel', members);

  assert.equal(settlements.length, 2);
  const byDebtor = Object.fromEntries(settlements.map((s) => [s.debtor, s]));
  assert.equal(byDebtor.Yash.creditor, 'Guest');
  assert.equal(byDebtor.Yash.amount, 1000);
  assert.equal(byDebtor.Kruti.creditor, 'Guest');
  assert.equal(byDebtor.Kruti.amount, 1000);

  // Sanity check against the actual bug: computeBalance's fallback drops one.
  const lossyBalance = computeBalance(entries, 'travel', members);
  assert.equal(lossyBalance.amount, 2000); // only sees one of the two 1000s owed
});

test('computeSettlements nets out a three-way mix to the minimal transfers', () => {
  // Each of Yash/Kruti/Guest pays one 300 shared expense (net +200 for the
  // payer, -100 for each of the other two), plus Yash separately covers a
  // 90 expense that's owed back fully by Kruti. Hand-computed nets: Yash
  // +90, Kruti -90, Guest exactly 0 - so Guest should need no settlement
  // at all, and the whole thing should resolve to one clean transfer.
  const entries = [
    { amount: 300, payer: 'Yash', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 300, payer: 'Kruti', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 300, payer: 'Guest', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
    { amount: 90, payer: 'Yash', split: true, splitType: 'owed', owedBy: 'Kruti', ledger: 'travel', tripName: 'Trip' },
  ];
  const members = ['Yash', 'Kruti', 'Guest'];
  const settlements = computeSettlements(entries, 'travel', members);

  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].debtor, 'Kruti');
  assert.equal(settlements[0].creditor, 'Yash');
  assert.equal(settlements[0].amount, 90);
});

// --- Regression tests for splitAmong (narrowing a shared entry to fewer
// than all the trip's members - e.g. a guest who wasn't in on one specific
// expense) ---

test('a shared entry with no splitAmong still splits among everyone (unchanged legacy behavior)', () => {
  const entries = [
    { amount: 300, payer: 'Guest', split: true, splitType: 'shared', ledger: 'travel', tripName: 'Trip' },
  ];
  const members = ['Yash', 'Kruti', 'Guest'];
  const settlements = computeSettlements(entries, 'travel', members);
  assert.equal(settlements.length, 2);
  assert.ok(settlements.every((s) => s.creditor === 'Guest' && s.amount === 100));
});

test('splitAmong excludes a guest from an expense that was never theirs', () => {
  // Yash pays for a coffee that's just Yash+Kruti - Guest was elsewhere and
  // shouldn't owe anything, even though Guest is on the trip generally.
  const entries = [
    {
      amount: 300, payer: 'Yash', split: true, splitType: 'shared', splitAmong: ['Yash', 'Kruti'],
      ledger: 'travel', tripName: 'Trip',
    },
  ];
  const members = ['Yash', 'Kruti', 'Guest'];
  const settlements = computeSettlements(entries, 'travel', members);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].debtor, 'Kruti');
  assert.equal(settlements[0].creditor, 'Yash');
  assert.equal(settlements[0].amount, 150);
});

test('splitAmong works for odd totals across an odd-sized subset with no rounding bias', () => {
  // 100.03 split 3 ways doesn't divide evenly in paise - confirm the total
  // charged across the subset exactly equals the entry amount either way,
  // whichever of the two possible "someone gets the extra fraction of a
  // paisa" outcomes it lands on, and that computeMemberTotals agrees.
  const members = ['Yash', 'Kruti', 'Guest', 'Extra'];
  const entries = [
    {
      amount: 100.03, payer: 'Yash', split: true, splitType: 'shared', splitAmong: ['Yash', 'Kruti', 'Guest'],
      ledger: 'travel', tripName: 'Trip',
    },
  ];
  const totals = computeMemberTotals(entries, members);
  assert.equal(
    Math.round((totals.Yash + totals.Kruti + totals.Guest) * 100),
    Math.round(100.03 * 100),
  );
  assert.equal(totals.Extra, 0);
});

test('computeMemberTotals respects splitAmong the same way computeBalance does', () => {
  const members = ['Yash', 'Kruti', 'Guest'];
  const entries = [
    {
      amount: 300, payer: 'Yash', split: true, splitType: 'shared', splitAmong: ['Yash', 'Kruti'],
      ledger: 'travel', tripName: 'Trip',
    },
  ];
  const totals = computeMemberTotals(entries, members);
  assert.equal(totals.Yash, 150);
  assert.equal(totals.Kruti, 150);
  assert.equal(totals.Guest, 0);
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

test('buildTripDigestPrompt includes every figure it was given and nothing it wasn\'t', () => {
  const prompt = buildTripDigestPrompt({
    tripName: 'Vietnam',
    currency: 'INR',
    totalSpend: 12000,
    memberTotals: { Yash: 6000, Kruti: 6000 },
    categoryBreakdown: [{ category: 'Food', amount: 8000 }, { category: 'Hotel', amount: 4000 }],
    settlementLines: ['Kruti owes Yash ₹3,000.00'],
  });
  assert.match(prompt, /Vietnam/);
  assert.match(prompt, /₹12,000\.00/);
  assert.match(prompt, /Yash: ₹6,000\.00/);
  assert.match(prompt, /Kruti: ₹6,000\.00/);
  assert.match(prompt, /Food: ₹8,000\.00/);
  assert.match(prompt, /Kruti owes Yash ₹3,000\.00/);
  assert.match(prompt, /never invent or estimate/);
});

test('buildTripDigestPrompt reports "settled up" when given no settlement lines', () => {
  const prompt = buildTripDigestPrompt({
    tripName: 'Vietnam',
    totalSpend: 0,
    memberTotals: {},
    categoryBreakdown: [],
    settlementLines: [],
  });
  assert.match(prompt, /Everyone is settled up\./);
  assert.match(prompt, /No entries yet\./);
});

test('buildCategorySuggestionSchema constrains category to the given list', () => {
  const schema = buildCategorySuggestionSchema(['Food', 'Hotel', 'Flight']);
  assert.deepEqual(schema.properties.category.enum, ['Food', 'Hotel', 'Flight']);
  assert.deepEqual(schema.required, ['category']);
});

test('buildCategorySuggestionPrompt includes the note and the category list', () => {
  const prompt = buildCategorySuggestionPrompt('taxi to airport', ['Food', 'Commute']);
  assert.match(prompt, /taxi to airport/);
  assert.match(prompt, /Food, Commute/);
});

test('buildQuickAddSchema constrains category/payer/splitType to real values, and only adds paymentMethod for travel', () => {
  const householdSchema = buildQuickAddSchema({
    categories: ['Groceries', 'Rent'],
    members: ['Yash', 'Kruti'],
    paymentMethods: ['Cash', 'Card'],
    isTravel: false,
  });
  assert.deepEqual(householdSchema.properties.category.enum, ['Groceries', 'Rent']);
  assert.deepEqual(householdSchema.properties.payer.enum, ['Yash', 'Kruti']);
  assert.deepEqual(householdSchema.properties.splitType.enum, ['shared', 'personal', 'owed']);
  assert.equal(householdSchema.properties.paymentMethod, undefined);

  const travelSchema = buildQuickAddSchema({
    categories: ['Flight'],
    members: ['Yash', 'Kruti'],
    paymentMethods: ['Cash', 'Card'],
    isTravel: true,
  });
  assert.deepEqual(travelSchema.properties.paymentMethod.enum, ['Cash', 'Card']);
});

test('buildQuickAddPrompt includes the free text, today\'s date, and the member list', () => {
  const prompt = buildQuickAddPrompt('1200 dinner with Kruti last night', {
    members: ['Yash', 'Kruti'],
    today: '2026-08-10',
  });
  assert.match(prompt, /1200 dinner with Kruti last night/);
  assert.match(prompt, /2026-08-10/);
  assert.match(prompt, /Yash, Kruti/);
});

test('buildAskQuestionSchema constrains metric to the fixed list, category/member to the given lists', () => {
  const schema = buildAskQuestionSchema({ categories: ['Food', 'Hotel'], members: ['Yash', 'Kruti'] });
  assert.deepEqual(schema.properties.metric.enum, [
    'total_spend', 'category_total', 'member_total', 'balance', 'entry_count', 'biggest_expense', 'monthly_trend',
  ]);
  assert.deepEqual(schema.properties.category.enum, ['Food', 'Hotel']);
  assert.deepEqual(schema.properties.member.enum, ['Yash', 'Kruti']);
  assert.deepEqual(schema.required, ['metric']);
});

test('buildAskQuestionPrompt includes the question, today\'s date, and both allowed lists', () => {
  const prompt = buildAskQuestionPrompt('how much did we spend on Food this month?', {
    categories: ['Food', 'Hotel'],
    members: ['Yash', 'Kruti'],
    today: '2026-08-10',
  });
  assert.match(prompt, /how much did we spend on Food this month\?/);
  assert.match(prompt, /2026-08-10/);
  assert.match(prompt, /Food, Hotel/);
  assert.match(prompt, /Yash, Kruti/);
});

test('resolveAskQuery: total_spend sums countable entries and respects a month filter', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared' },
    { amount: 50, category: 'Food', date: '2026-07-01', ledger: 'household', splitType: 'shared' },
    { amount: 999, category: 'Transfer', date: '2026-08-01', ledger: 'household', splitType: 'settlement' },
  ];
  const all = resolveAskQuery({ metric: 'total_spend' }, entries, 'household', PERSONS);
  assert.match(all, /₹350\.00/);
  const august = resolveAskQuery({ metric: 'total_spend', month: '2026-08' }, entries, 'household', PERSONS);
  assert.match(august, /₹300\.00/);
});

test('resolveAskQuery: category_total only sums the matching category', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared' },
    { amount: 40, category: 'Food', date: '2026-08-10', ledger: 'household', splitType: 'shared' },
  ];
  const answer = resolveAskQuery({ metric: 'category_total', category: 'Food' }, entries, 'household', PERSONS);
  assert.match(answer, /₹140\.00/);
});

test('resolveAskQuery: member_total matches computeMemberTotals', () => {
  const entries = [
    { amount: 200, payer: 'Yash', split: true, splitType: 'shared', date: '2026-08-01', ledger: 'household' },
  ];
  const answer = resolveAskQuery({ metric: 'member_total', member: 'Yash' }, entries, 'household', PERSONS);
  assert.match(answer, /₹100\.00/);
});

test('resolveAskQuery: balance reports "settled up" or the real debtor/creditor for a 2-person ledger', () => {
  const settled = resolveAskQuery({ metric: 'balance' }, [], 'household', PERSONS);
  assert.equal(settled, 'Everyone is settled up.');

  const entries = [{ amount: 600, payer: 'Yash', split: true, splitType: 'shared', ledger: 'household' }];
  const owed = resolveAskQuery({ metric: 'balance' }, entries, 'household', PERSONS);
  assert.match(owed, /Kruti owes Yash ₹300\.00/);
});

test('resolveAskQuery: balance lists every real debt for a 3+ person (guest) ledger', () => {
  const members = ['Yash', 'Kruti', 'Priya'];
  const entries = [
    { amount: 300, payer: 'Yash', split: true, splitType: 'shared', ledger: 'travel' },
  ];
  const answer = resolveAskQuery({ metric: 'balance' }, entries, 'travel', members);
  assert.match(answer, /owes Yash/);
});

test('resolveAskQuery: entry_count excludes settlements/withdrawals/rollups', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 999, date: '2026-08-01', ledger: 'household', splitType: 'settlement' },
  ];
  const answer = resolveAskQuery({ metric: 'entry_count' }, entries, 'household', PERSONS);
  assert.match(answer, /^2 entries/);
});

test('resolveAskQuery: biggest_expense picks the largest countable entry', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 500, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared', payer: 'Kruti', note: 'Resort' },
  ];
  const answer = resolveAskQuery({ metric: 'biggest_expense' }, entries, 'household', PERSONS);
  assert.match(answer, /₹500\.00/);
  assert.match(answer, /Hotel/);
  assert.match(answer, /Kruti/);
});

test('resolveAskQuery: unknown metric falls back to a plain message instead of throwing', () => {
  const answer = resolveAskQuery({ metric: 'nonsense' }, [], 'household', PERSONS);
  assert.equal(answer, "I couldn't understand that question.");
});
