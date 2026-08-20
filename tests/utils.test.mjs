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
  buildAskAnswerNarrationPrompt,
  resolveAskQuery,
  computeBudgetAlerts,
  computeBudgetStatus,
  computeBudgetTrend,
  getHouseholdBudgets,
  setHouseholdBudgets,
  groupByCategory,
  getRecurringRules,
  setRecurringRules,
  buildRecurringEntryDate,
  computeRecurringEntriesToGenerate,
  getPaymentReminderConfig,
  setPaymentReminderConfig,
  getUnsettledSinceDate,
  computePaymentReminder,
  buildReceiptExtractionSchema,
  buildReceiptExtractionPrompt,
  searchAllEntries,
  CARD_STRATEGY_DEFAULTS,
  getCardCycleForDate,
  getTransactionsInCycle,
  listRecentCardCycles,
  getQuarterBounds,
  computeDinersCycleReward,
  computeSbiCycleReward,
  computeHsbcCycleReward,
  computeSuperMoneyCycleReward,
  computeHsbcPremierCycleReward,
  computeCardCycleReward,
  previewTransactionReward,
  resolveStrategyParamsForDate,
  computeCardMilestoneProgress,
  getAnnualMilestoneWindow,
  computeCardCapStatus,
  applyRewardOverrides,
  getCreditCards,
  setCreditCards,
  getCardTransactions,
  setCardTransactions,
  getCardBillingCycles,
  setCardBillingCycles,
  getCardBillingCycleKey,
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

test('buildAskQuestionSchema wraps a per-item schema in a queries array, constraining scope/trip/metric/category/member', () => {
  const schema = buildAskQuestionSchema({ categories: ['Food', 'Hotel'], members: ['Yash', 'Kruti'], trips: ['Japan', 'Vietnam'] });
  assert.deepEqual(schema.required, ['queries']);
  assert.equal(schema.properties.queries.type, 'array');
  const item = schema.properties.queries.items;
  assert.deepEqual(item.properties.scope.enum, ['household', 'travel']);
  assert.deepEqual(item.properties.trip.enum, ['Japan', 'Vietnam']);
  assert.deepEqual(item.properties.metric.enum, [
    'total_spend', 'category_total', 'member_total', 'balance', 'entry_count',
    'biggest_expense', 'smallest_expense', 'monthly_trend', 'trip_comparison',
  ]);
  assert.deepEqual(item.properties.category.enum, ['Food', 'Hotel']);
  assert.deepEqual(item.properties.member.enum, ['Yash', 'Kruti']);
  assert.deepEqual(item.required, ['metric', 'scope']);
});

test('buildAskQuestionPrompt includes the question, today\'s date, current context, and every allowed list', () => {
  const prompt = buildAskQuestionPrompt('how much did we spend on Food this month?', {
    categories: ['Food', 'Hotel'],
    members: ['Yash', 'Kruti'],
    trips: ['Japan', 'Vietnam'],
    today: '2026-08-10',
    currentContext: 'Payments tab (no single ledger in view - default to household)',
  });
  assert.match(prompt, /how much did we spend on Food this month\?/);
  assert.match(prompt, /2026-08-10/);
  assert.match(prompt, /Payments tab \(no single ledger in view - default to household\)/);
  assert.match(prompt, /Food, Hotel/);
  assert.match(prompt, /Yash, Kruti/);
  assert.match(prompt, /Japan, Vietnam/);
});

test('resolveAskQuery: total_spend sums countable entries and respects a month filter', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared' },
    { amount: 50, category: 'Food', date: '2026-07-01', ledger: 'household', splitType: 'shared' },
    { amount: 999, category: 'Transfer', date: '2026-08-01', ledger: 'household', splitType: 'settlement' },
  ];
  const all = resolveAskQuery({ metric: 'total_spend', scope: 'household' }, entries, PERSONS);
  assert.match(all, /₹350\.00/);
  const august = resolveAskQuery({ metric: 'total_spend', scope: 'household', month: '2026-08' }, entries, PERSONS);
  assert.match(august, /₹300\.00/);
});

test('resolveAskQuery: scope picks out only that ledger\'s entries, even from a combined household+travel array', () => {
  const entries = [
    { amount: 100, category: 'Groceries', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 5000, category: 'Flight', date: '2026-08-01', ledger: 'travel', tripName: 'Japan', splitType: 'shared' },
  ];
  const household = resolveAskQuery({ metric: 'total_spend', scope: 'household' }, entries, PERSONS);
  assert.match(household, /₹100\.00/);
  const travel = resolveAskQuery({ metric: 'total_spend', scope: 'travel' }, entries, PERSONS);
  assert.match(travel, /₹5,000\.00/);
});

test('resolveAskQuery: trip narrows travel scope to just that trip, regardless of which ledger/tab is currently open', () => {
  const entries = [
    { amount: 5000, category: 'Flight', date: '2026-08-01', ledger: 'travel', tripName: 'Japan', splitType: 'shared' },
    { amount: 3000, category: 'Hotel', date: '2026-08-01', ledger: 'travel', tripName: 'Vietnam', splitType: 'shared' },
  ];
  const japan = resolveAskQuery({ metric: 'total_spend', scope: 'travel', trip: 'Japan' }, entries, PERSONS);
  assert.match(japan, /₹5,000\.00/);
  assert.match(japan, /\(Japan\)/);
  const vietnam = resolveAskQuery({ metric: 'total_spend', scope: 'travel', trip: 'Vietnam' }, entries, PERSONS);
  assert.match(vietnam, /₹3,000\.00/);
});

test('resolveAskQuery: category_total only sums the matching category', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared' },
    { amount: 40, category: 'Food', date: '2026-08-10', ledger: 'household', splitType: 'shared' },
  ];
  const answer = resolveAskQuery({ metric: 'category_total', scope: 'household', category: 'Food' }, entries, PERSONS);
  assert.match(answer, /₹140\.00/);
});

test('resolveAskQuery: member_total matches computeMemberTotals', () => {
  const entries = [
    { amount: 200, payer: 'Yash', split: true, splitType: 'shared', date: '2026-08-01', ledger: 'household' },
  ];
  const answer = resolveAskQuery({ metric: 'member_total', scope: 'household', member: 'Yash' }, entries, PERSONS);
  assert.match(answer, /₹100\.00/);
});

test('resolveAskQuery: balance reports "settled up" or the real debtor/creditor for a 2-person ledger', () => {
  const settled = resolveAskQuery({ metric: 'balance', scope: 'household' }, [], PERSONS);
  assert.equal(settled, 'Everyone is settled up.');

  const entries = [{ amount: 600, payer: 'Yash', split: true, splitType: 'shared', ledger: 'household' }];
  const owed = resolveAskQuery({ metric: 'balance', scope: 'household' }, entries, PERSONS);
  assert.match(owed, /Kruti owes Yash ₹300\.00/);
});

test('resolveAskQuery: balance lists every real debt for a 3+ person (guest) ledger', () => {
  const members = ['Yash', 'Kruti', 'Priya'];
  const entries = [
    { amount: 300, payer: 'Yash', split: true, splitType: 'shared', ledger: 'travel' },
  ];
  const answer = resolveAskQuery({ metric: 'balance', scope: 'travel' }, entries, members);
  assert.match(answer, /owes Yash/);
});

test('resolveAskQuery: entry_count excludes settlements/withdrawals/rollups', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 200, category: 'Hotel', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
    { amount: 999, date: '2026-08-01', ledger: 'household', splitType: 'settlement' },
  ];
  const answer = resolveAskQuery({ metric: 'entry_count', scope: 'household' }, entries, PERSONS);
  assert.match(answer, /^2 entries/);
});

test('resolveAskQuery: biggest_expense picks the largest countable entry', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 500, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared', payer: 'Kruti', note: 'Resort' },
  ];
  const answer = resolveAskQuery({ metric: 'biggest_expense', scope: 'household' }, entries, PERSONS);
  assert.match(answer, /₹500\.00/);
  assert.match(answer, /Hotel/);
  assert.match(answer, /Kruti/);
});

test('resolveAskQuery: smallest_expense picks the smallest countable entry', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 500, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
  ];
  const answer = resolveAskQuery({ metric: 'smallest_expense', scope: 'household' }, entries, PERSONS);
  assert.match(answer, /₹100\.00/);
  assert.match(answer, /Food/);
  assert.match(answer, /Yash/);
});

test('resolveAskQuery: biggest_expense/smallest_expense scope to a category when given one, and drop the redundant "on X"', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 40, category: 'Food', date: '2026-08-02', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
    { amount: 500, category: 'Hotel', date: '2026-08-05', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
  ];
  const biggestFood = resolveAskQuery({ metric: 'biggest_expense', scope: 'household', category: 'Food' }, entries, PERSONS);
  assert.match(biggestFood, /₹100\.00/);
  assert.doesNotMatch(biggestFood, /on Food/);
  const smallestFood = resolveAskQuery({ metric: 'smallest_expense', scope: 'household', category: 'Food' }, entries, PERSONS);
  assert.match(smallestFood, /₹40\.00/);
});

test('resolveAskQuery: biggest_expense with count returns that many, ranked, biggest first', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 500, category: 'Hotel', date: '2026-08-02', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
    { amount: 250, category: 'Transport', date: '2026-08-03', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 10, category: 'Food', date: '2026-08-04', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
  ];
  const answer = resolveAskQuery({ metric: 'biggest_expense', scope: 'household', count: 3 }, entries, PERSONS);
  assert.match(answer, /Top 3 biggest expenses/);
  const iHotel = answer.indexOf('₹500.00');
  const iTransport = answer.indexOf('₹250.00');
  const iFood = answer.indexOf('₹100.00');
  assert.ok(iHotel < iTransport && iTransport < iFood, 'expected biggest-first ordering');
  assert.doesNotMatch(answer, /₹10\.00/);
});

test('resolveAskQuery: biggest_expense count is clamped to the available pool and to a max of 10', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared', payer: 'Yash' },
    { amount: 50, category: 'Food', date: '2026-08-02', ledger: 'household', splitType: 'shared', payer: 'Kruti' },
  ];
  const answer = resolveAskQuery({ metric: 'biggest_expense', scope: 'household', count: 500 }, entries, PERSONS);
  assert.match(answer, /Top 2 biggest expenses/);
});

test('resolveAskQuery: defaults to household scope when a spec somehow omits it', () => {
  const entries = [{ amount: 100, category: 'Food', date: '2026-08-01', ledger: 'household', splitType: 'shared' }];
  const answer = resolveAskQuery({ metric: 'total_spend' }, entries, PERSONS);
  assert.match(answer, /₹100\.00/);
});

test('resolveAskQuery: trip_comparison ranks every trip highest first, scoped to a category', () => {
  const entries = [
    { amount: 3000, category: 'Food', date: '2026-08-01', ledger: 'travel', tripName: 'Japan', splitType: 'shared' },
    { amount: 1000, category: 'Food', date: '2026-08-01', ledger: 'travel', tripName: 'Vietnam', splitType: 'shared' },
    { amount: 5000, category: 'Flight', date: '2026-08-01', ledger: 'travel', tripName: 'Japan', splitType: 'shared' },
    { amount: 2000, category: 'Food', date: '2026-08-01', ledger: 'travel', tripName: 'Taiwan', splitType: 'shared' },
  ];
  const answer = resolveAskQuery({ metric: 'trip_comparison', scope: 'travel', category: 'Food' }, entries, PERSONS);
  assert.match(answer, /Spend on Food by trip/);
  const iJapan = answer.indexOf('Japan: ₹3,000.00');
  const iTaiwan = answer.indexOf('Taiwan: ₹2,000.00');
  const iVietnam = answer.indexOf('Vietnam: ₹1,000.00');
  assert.ok(iJapan >= 0 && iTaiwan > iJapan && iVietnam > iTaiwan, 'expected Japan, Taiwan, Vietnam in that order');
  assert.doesNotMatch(answer, /₹5,000\.00/, 'Flight spend should not leak into a Food-scoped comparison');
});

test('resolveAskQuery: trip_comparison ignores a trip filter, since comparing across trips is the whole point', () => {
  const entries = [
    { amount: 100, category: 'Food', date: '2026-08-01', ledger: 'travel', tripName: 'Japan', splitType: 'shared' },
    { amount: 200, category: 'Food', date: '2026-08-01', ledger: 'travel', tripName: 'Vietnam', splitType: 'shared' },
  ];
  const answer = resolveAskQuery({ metric: 'trip_comparison', scope: 'travel', trip: 'Japan' }, entries, PERSONS);
  assert.match(answer, /Japan: ₹100\.00/);
  assert.match(answer, /Vietnam: ₹200\.00/);
});

test('resolveAskQuery: trip_comparison reports no trips when there are none', () => {
  const answer = resolveAskQuery({ metric: 'trip_comparison', scope: 'travel' }, [], PERSONS);
  assert.equal(answer, 'No trips recorded yet.');
});

test('resolveAskQuery: unknown metric falls back to a plain message instead of throwing', () => {
  const answer = resolveAskQuery({ metric: 'nonsense', scope: 'household' }, [], PERSONS);
  assert.equal(answer, "I couldn't understand that question.");
});

test('buildAskAnswerNarrationPrompt includes the question, every fact, and a never-invent guardrail', () => {
  const prompt = buildAskAnswerNarrationPrompt('compare Food and Hotel', [
    'Food (all time): ₹140.00.',
    'Hotel (all time): ₹500.00.',
  ]);
  assert.match(prompt, /compare Food and Hotel/);
  assert.match(prompt, /Food \(all time\): ₹140\.00\./);
  assert.match(prompt, /Hotel \(all time\): ₹500\.00\./);
  assert.match(prompt, /never invent/);
});

test('computeBudgetAlerts ignores categories with no budget set', () => {
  const totals = [{ category: 'Food', amount: 9000 }];
  const alerts = computeBudgetAlerts(totals, {});
  assert.deepEqual(alerts, []);
});

test('computeBudgetAlerts ignores a zero or invalid limit (still counts as "no limit")', () => {
  const totals = [{ category: 'Food', amount: 9000 }];
  const alerts = computeBudgetAlerts(totals, { Food: 0, Hotel: -5, Transport: 'not a number' });
  assert.deepEqual(alerts, []);
});

test('computeBudgetAlerts flags "warning" at the 80% threshold, before it\'s actually over', () => {
  const totals = [{ category: 'Food', amount: 8000 }];
  const alerts = computeBudgetAlerts(totals, { Food: 10000 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'warning');
  assert.equal(alerts[0].spent, 8000);
  assert.equal(alerts[0].limit, 10000);
  assert.equal(alerts[0].pctUsed, 0.8);
});

test('computeBudgetAlerts flags "over" once spend exceeds the limit', () => {
  const totals = [{ category: 'Food', amount: 12000 }];
  const alerts = computeBudgetAlerts(totals, { Food: 10000 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'over');
});

test('computeBudgetAlerts says nothing for a category comfortably under its limit', () => {
  const totals = [{ category: 'Food', amount: 1000 }];
  const alerts = computeBudgetAlerts(totals, { Food: 10000 });
  assert.deepEqual(alerts, []);
});

test('computeBudgetAlerts treats a budgeted category with zero actual spend as 0% used, not an alert', () => {
  const alerts = computeBudgetAlerts([], { Food: 10000 });
  assert.deepEqual(alerts, []);
});

test('computeBudgetAlerts ranks worst (highest % used) first', () => {
  const totals = [
    { category: 'Food', amount: 8500 },
    { category: 'Hotel', amount: 25000 },
  ];
  const alerts = computeBudgetAlerts(totals, { Food: 10000, Hotel: 20000 });
  assert.deepEqual(alerts.map((a) => a.category), ['Hotel', 'Food']);
});

test('computeBudgetAlerts works directly with groupByCategory\'s output shape', () => {
  const entries = [
    { amount: 9500, category: 'Groceries', date: '2026-08-01', ledger: 'household', splitType: 'shared' },
  ];
  const totals = groupByCategory(entries, '2026-08', 'household');
  const alerts = computeBudgetAlerts(totals, { Groceries: 10000 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'warning');
});

test('computeBudgetStatus returns every budgeted category, even one comfortably under its limit', () => {
  const totals = [{ category: 'Food', amount: 1000 }];
  const status = computeBudgetStatus(totals, { Food: 10000 });
  assert.equal(status.length, 1);
  assert.equal(status[0].spent, 1000);
  assert.equal(status[0].limit, 10000);
  assert.equal(status[0].pctUsed, 0.1);
  assert.equal(status[0].status, undefined, 'computeBudgetStatus rows have no over/warning label - that\'s computeBudgetAlerts\' job');
});

test('computeBudgetStatus still excludes categories with no budget or an invalid one', () => {
  const totals = [{ category: 'Food', amount: 1000 }, { category: 'Hotel', amount: 500 }];
  const status = computeBudgetStatus(totals, { Food: 10000, Hotel: 0 });
  assert.deepEqual(status.map((s) => s.category), ['Food']);
});

test('computeBudgetStatus ranks worst first, same as computeBudgetAlerts', () => {
  const totals = [
    { category: 'Food', amount: 1000 },
    { category: 'Hotel', amount: 18000 },
  ];
  const status = computeBudgetStatus(totals, { Food: 10000, Hotel: 20000 });
  assert.deepEqual(status.map((s) => s.category), ['Hotel', 'Food']);
});

test('computeBudgetAlerts is computeBudgetStatus filtered to >=80% and labeled', () => {
  const totals = [{ category: 'Food', amount: 1000 }, { category: 'Hotel', amount: 18000 }];
  const budgets = { Food: 10000, Hotel: 20000 };
  const status = computeBudgetStatus(totals, budgets);
  const alerts = computeBudgetAlerts(totals, budgets);
  assert.equal(status.length, 2);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].category, 'Hotel');
  assert.equal(alerts[0].status, 'warning');
});

test('computeBudgetTrend attaches last period\'s status to each current-period row', () => {
  const totals = [{ category: 'Food', amount: 9000 }];
  const prevTotals = [{ category: 'Food', amount: 12000 }];
  const trend = computeBudgetTrend(totals, prevTotals, { Food: 10000 });
  assert.equal(trend.length, 1);
  assert.equal(trend[0].spent, 9000);
  assert.equal(trend[0].pctUsed, 0.9);
  assert.ok(trend[0].previous);
  assert.equal(trend[0].previous.spent, 12000);
  assert.equal(trend[0].previous.pctUsed, 1.2);
});

test('computeBudgetTrend gives 0% previous status for a category with no spend last period', () => {
  const totals = [{ category: 'Food', amount: 5000 }];
  const trend = computeBudgetTrend(totals, [], { Food: 10000 });
  assert.equal(trend[0].previous.spent, 0);
  assert.equal(trend[0].previous.pctUsed, 0);
});

test('computeBudgetTrend never surfaces a previous-period row for a category with no budget at all', () => {
  const totals = [{ category: 'Food', amount: 5000 }];
  const prevTotals = [{ category: 'Food', amount: 5000 }, { category: 'Hotel', amount: 9000 }];
  const trend = computeBudgetTrend(totals, prevTotals, { Food: 10000 });
  assert.deepEqual(trend.map((t) => t.category), ['Food']);
});

test('getHouseholdBudgets/setHouseholdBudgets round-trip through storage, defaulting to {}', () => {
  setHouseholdBudgets({ Groceries: 10000 });
  assert.deepEqual(getHouseholdBudgets(), { Groceries: 10000 });
  setHouseholdBudgets({});
  assert.deepEqual(getHouseholdBudgets(), {});
});

test('getRecurringRules/setRecurringRules round-trip through storage, defaulting to []', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: true }];
  setRecurringRules(rules);
  assert.deepEqual(getRecurringRules(), rules);
  setRecurringRules([]);
  assert.deepEqual(getRecurringRules(), []);
});

test('buildRecurringEntryDate clamps the day to however many days the target month actually has', () => {
  assert.equal(buildRecurringEntryDate('2026-08', 15), '2026-08-15');
  assert.equal(buildRecurringEntryDate('2026-02', 31), '2026-02-28');
  assert.equal(buildRecurringEntryDate('2028-02', 31), '2028-02-29', 'leap year Feb has 29 days');
  assert.equal(buildRecurringEntryDate('2026-04', 31), '2026-04-30');
});

test('computeRecurringEntriesToGenerate creates only the current month for a rule that has never generated', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: true, lastGeneratedMonth: null }];
  const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, '2026-08');
  assert.equal(toCreate.length, 1);
  assert.equal(toCreate[0].date, '2026-08-01');
  assert.equal(toCreate[0].category, 'Rent');
  assert.equal(toCreate[0].ledger, 'household');
  assert.equal(updatedRules[0].lastGeneratedMonth, '2026-08');
});

test('computeRecurringEntriesToGenerate backfills every month since lastGeneratedMonth up to the current one', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: true, lastGeneratedMonth: '2026-05' }];
  const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, '2026-08');
  assert.deepEqual(toCreate.map((e) => e.date), ['2026-06-01', '2026-07-01', '2026-08-01']);
  assert.equal(updatedRules[0].lastGeneratedMonth, '2026-08');
});

test('computeRecurringEntriesToGenerate creates nothing for a rule already generated this month', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: true, lastGeneratedMonth: '2026-08' }];
  const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, '2026-08');
  assert.equal(toCreate.length, 0);
  assert.equal(updatedRules, null, 'nothing changed, so there\'s nothing new to persist');
});

test('computeRecurringEntriesToGenerate skips inactive rules entirely', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: false, lastGeneratedMonth: null }];
  const { toCreate, updatedRules } = computeRecurringEntriesToGenerate(rules, '2026-08');
  assert.equal(toCreate.length, 0);
  assert.equal(updatedRules, null);
});

test('computeRecurringEntriesToGenerate caps backfill so a long-dormant rule doesn\'t flood the ledger', () => {
  const rules = [{ id: 'r1', category: 'Rent', amount: 30000, payer: 'Yash', splitType: 'shared', dayOfMonth: 1, active: true, lastGeneratedMonth: '2020-01' }];
  const { toCreate } = computeRecurringEntriesToGenerate(rules, '2026-08');
  assert.ok(toCreate.length <= 6, `expected a bounded backfill, got ${toCreate.length} entries`);
});

test('getPaymentReminderConfig/setPaymentReminderConfig round-trip through storage, defaulting to enabled/₹2000', () => {
  setPaymentReminderConfig({});
  assert.deepEqual(getPaymentReminderConfig(), { enabled: true, amountThreshold: 2000 });
  setPaymentReminderConfig({ enabled: false, amountThreshold: 5000 });
  assert.deepEqual(getPaymentReminderConfig(), { enabled: false, amountThreshold: 5000 });
});

test('getUnsettledSinceDate uses the most recent settlement date when one exists', () => {
  const entries = [
    { ledger: 'household', date: '2026-01-01', splitType: 'shared' },
    { ledger: 'household', date: '2026-05-10', splitType: 'settlement' },
    { ledger: 'household', date: '2026-03-01', splitType: 'settlement' },
  ];
  assert.equal(getUnsettledSinceDate(entries, 'household'), '2026-05-10');
});

test('getUnsettledSinceDate falls back to the earliest expense date when nothing has ever been settled', () => {
  const entries = [
    { ledger: 'household', date: '2026-03-01', splitType: 'shared' },
    { ledger: 'household', date: '2026-01-15', splitType: 'shared' },
  ];
  assert.equal(getUnsettledSinceDate(entries, 'household'), '2026-01-15');
});

test('getUnsettledSinceDate returns null when there are no entries for that ledger', () => {
  assert.equal(getUnsettledSinceDate([], 'household'), null);
});

test('computePaymentReminder is null when the balance is settled', () => {
  const entries = [
    { ledger: 'household', amount: 5000, payer: 'Yash', split: true, date: '2026-01-01' },
    { ledger: 'household', amount: 5000, payer: 'Kruti', split: true, date: '2026-01-02' },
  ];
  assert.equal(computePaymentReminder(entries, 'household', PERSONS, { enabled: true, amountThreshold: 2000 }, '2026-08-01'), null);
});

test('computePaymentReminder is null when the amount owed hasn\'t crossed the threshold yet', () => {
  const entries = [{ ledger: 'household', amount: 1000, payer: 'Yash', split: true, date: '2026-01-01' }];
  // Kruti owes 500, well under a 2000 threshold - no amount of elapsed time should matter now.
  assert.equal(computePaymentReminder(entries, 'household', PERSONS, { enabled: true, amountThreshold: 2000 }, '2026-08-01'), null);
});

test('computePaymentReminder is null when reminders are disabled, even with a large unsettled balance', () => {
  const entries = [{ ledger: 'household', amount: 10000, payer: 'Yash', split: true, date: '2026-08-01' }];
  assert.equal(computePaymentReminder(entries, 'household', PERSONS, { enabled: false, amountThreshold: 2000 }, '2026-08-01'), null);
});

test('computePaymentReminder fires as soon as the amount owed crosses the threshold, regardless of how recent', () => {
  const entries = [{ ledger: 'household', amount: 10000, payer: 'Yash', split: true, date: '2026-08-01' }];
  const reminder = computePaymentReminder(entries, 'household', PERSONS, { enabled: true, amountThreshold: 2000 }, '2026-08-01');
  assert.ok(reminder);
  assert.equal(reminder.debtor, 'Kruti');
  assert.equal(reminder.creditor, 'Yash');
  assert.equal(reminder.amount, 5000);
  assert.equal(reminder.daysSince, 0, 'the entry is from today, so it should fire immediately, not wait out a day count');
});

test('computePaymentReminder fires exactly at the threshold (>=, not strictly greater)', () => {
  const entries = [{ ledger: 'household', amount: 4000, payer: 'Yash', split: true, date: '2026-08-01' }];
  const reminder = computePaymentReminder(entries, 'household', PERSONS, { enabled: true, amountThreshold: 2000 }, '2026-08-01');
  assert.ok(reminder);
  assert.equal(reminder.amount, 2000);
});

test('buildReceiptExtractionSchema constrains category to the real household category list', () => {
  const schema = buildReceiptExtractionSchema(['Groceries', 'Utilities']);
  assert.deepEqual(schema.properties.category.enum, ['Groceries', 'Utilities']);
  assert.deepEqual(schema.required, ['amount', 'date', 'category', 'note']);
});

test('buildReceiptExtractionPrompt includes the real categories and the fallback date', () => {
  const prompt = buildReceiptExtractionPrompt(['Groceries', 'Utilities'], '2026-08-12');
  assert.match(prompt, /Groceries, Utilities/);
  assert.match(prompt, /2026-08-12/);
});

test('searchAllEntries matches a multi-word query across different fields of the same entry, not as one literal phrase', () => {
  const entries = [
    { id: 'e1', ledger: 'travel', tripName: "Japan Summer Vacation '26", category: 'Entertainment', note: 'USJ tickets', payer: 'Yash', date: '2026-06-15' },
    { id: 'e2', ledger: 'travel', tripName: 'Goa Trip', category: 'Food', note: 'USJ-themed cafe', payer: 'Kruti', date: '2026-06-10' },
  ];
  const results = searchAllEntries(entries, 'Japan USJ');
  assert.deepEqual(results.map((r) => r.id), ['e1'], 'only the entry with BOTH "japan" and "usj" somewhere should match');
});

test('searchAllEntries is case-insensitive and matches a single word against any field', () => {
  const entries = [
    { id: 'e1', ledger: 'household', category: 'Groceries', note: 'Big Bazaar run', payer: 'Yash', date: '2026-07-01' },
  ];
  assert.deepEqual(searchAllEntries(entries, 'BAZAAR').map((r) => r.id), ['e1']);
});

test('searchAllEntries excludes settlements and trip rollups', () => {
  const entries = [
    { id: 'e1', ledger: 'household', splitType: 'settlement', note: 'Yash paid Kruti', payer: 'Yash', date: '2026-07-01' },
    { id: 'e2', ledger: 'travel', isTripRollup: true, note: 'Trip rollup', payer: 'Yash', date: '2026-07-01' },
  ];
  assert.deepEqual(searchAllEntries(entries, 'yash'), []);
});

test('searchAllEntries returns nothing for a blank query', () => {
  const entries = [{ id: 'e1', ledger: 'household', category: 'Groceries', payer: 'Yash', date: '2026-07-01' }];
  assert.deepEqual(searchAllEntries(entries, '   '), []);
});

test('searchAllEntries matches on amount as a word', () => {
  const entries = [
    { id: 'e1', ledger: 'household', category: 'Groceries', amount: 850, payer: 'Yash', date: '2026-07-01' },
    { id: 'e2', ledger: 'household', category: 'Utilities', amount: 1200, payer: 'Kruti', date: '2026-07-02' },
  ];
  assert.deepEqual(searchAllEntries(entries, '850').map((r) => r.id), ['e1']);
});

// --- Credit card billing cycle helpers ---

test('getCardCycleForDate: a transaction before the cycle day belongs to the cycle ending this month', () => {
  const { cycleStart, cycleEnd } = getCardCycleForDate('2026-08-15', 20);
  assert.equal(cycleStart, '2026-07-20');
  assert.equal(cycleEnd, '2026-08-20');
});

test('getCardCycleForDate: a transaction on or after the cycle day belongs to next month\'s cycle', () => {
  const { cycleStart, cycleEnd } = getCardCycleForDate('2026-08-20', 20);
  assert.equal(cycleStart, '2026-08-20');
  assert.equal(cycleEnd, '2026-09-20');
});

test('getCardCycleForDate clamps the cycle day to however many days a short month actually has', () => {
  const { cycleStart, cycleEnd } = getCardCycleForDate('2026-02-20', 31);
  assert.equal(cycleStart, '2026-01-31');
  assert.equal(cycleEnd, '2026-02-28', '2026 is not a leap year');
});

test('getTransactionsInCycle filters by both card and date range', () => {
  const txns = [
    { id: 't1', cardId: 'c1', date: '2026-07-25' },
    { id: 't2', cardId: 'c1', date: '2026-08-05' },
    { id: 't3', cardId: 'c2', date: '2026-07-25' },
  ];
  const result = getTransactionsInCycle(txns, 'c1', '2026-07-20', '2026-08-20');
  assert.deepEqual(result.map((t) => t.id), ['t1', 't2']);
});

test('listRecentCardCycles marks exactly the cycle containing today as open', () => {
  const cycles = listRecentCardCycles(4, '2026-08-12', 3);
  assert.equal(cycles.length, 3);
  assert.equal(cycles[0].isOpen, true);
  assert.equal(cycles[1].isOpen, false);
  assert.equal(cycles[2].isOpen, false);
});

test('listRecentCardCycles produces a strictly consecutive, non-overlapping chain across a year and leap-day boundary', () => {
  // billing day 1, walking back from March 2028 (a leap year) - crosses
  // both Jan 1 and the Feb 29 boundary in the same short run.
  const cycles = listRecentCardCycles(1, '2028-03-15', 4);
  assert.deepEqual(
    cycles.map((c) => [c.cycleStart, c.cycleEnd]),
    [
      ['2028-03-01', '2028-04-01'],
      ['2028-02-01', '2028-03-01'],
      ['2028-01-01', '2028-02-01'],
      ['2027-12-01', '2028-01-01'],
    ],
  );
  // Every cycle's end must exactly equal the next (older) cycle's... start
  // of the *following* cycle, i.e. no gap and no overlap anywhere in the chain.
  for (let i = 0; i < cycles.length - 1; i++) {
    assert.equal(cycles[i].cycleStart, cycles[i + 1].cycleEnd);
  }
});

test('getQuarterBounds returns calendar-quarter boundaries regardless of billing cycle', () => {
  assert.deepEqual(getQuarterBounds('2026-08-12'), { quarterStart: '2026-07-01', quarterEnd: '2026-10-01' });
  assert.deepEqual(getQuarterBounds('2026-01-05'), { quarterStart: '2026-01-01', quarterEnd: '2026-04-01' });
  assert.deepEqual(getQuarterBounds('2026-12-25'), { quarterStart: '2026-10-01', quarterEnd: '2027-01-01' });
});

// --- HDFC Diners Club Black Metal ---

test('Diners: base slab is 5 points per ₹150, floored', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 449, category: 'regular' },
  ]);
  assert.equal(totalReward, 10, 'floor(449/150)=2, 2*5=10');
});

test('Diners: weekend dining doubles the base rate', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 450, category: 'weekend_dining' },
  ]);
  assert.equal(totalReward, 30, 'floor(450/150)=3, 3*5*2=30');
});

test('Diners: a category day-cap stops a second same-day transaction from earning past it', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward, perTransaction } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 30000, category: 'weekend_dining' }, // floor(30000/150)*5*2 = 2000, way past the 1000/day cap
    { id: 't2', date: '2026-08-01', amount: 30000, category: 'weekend_dining' },
  ]);
  assert.equal(perTransaction[0].earned, 1000, 'first transaction alone already exceeds the day cap');
  assert.equal(perTransaction[1].earned, 0, 'the day cap is already exhausted');
  assert.equal(totalReward, 1000);
});

test('Diners: a category month-cap accumulates across different days in the same month', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward, perTransaction } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 45000, category: 'grocery' }, // floor(45000/150)*5 = 1500
    { id: 't2', date: '2026-08-15', amount: 45000, category: 'grocery' }, // would be another 1500, but month cap is 2000
  ]);
  assert.equal(perTransaction[0].earned, 1500);
  assert.equal(perTransaction[1].earned, 500, 'only 500 left under the 2000/month grocery cap');
  assert.equal(totalReward, 2000);
});

test('Diners: the overall cycle cap wins even when no single category cap is hit', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 3000000, category: 'regular' }, // floor(3000000/150)*5 = 100000, way past 75000 cycle cap
  ]);
  assert.equal(totalReward, 75000);
});

test('Diners: excluded categories earn nothing regardless of amount', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50000, category: 'excluded' },
  ]);
  assert.equal(totalReward, 0);
});

// --- SBI Cashback ---

test('SBI: 5% online and 1% offline are computed and capped independently', () => {
  const params = CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback;
  const { totalReward, onlineTotal, offlineTotal } = computeSbiCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 10000, channel: 'online' }, // 500
    { id: 't2', date: '2026-08-02', amount: 10000, channel: 'offline' }, // 100
  ]);
  assert.equal(onlineTotal, 500);
  assert.equal(offlineTotal, 100);
  assert.equal(totalReward, 600);
});

test('SBI: online cap of ₹2000/cycle does not consume the offline cap', () => {
  const params = CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback;
  const { onlineTotal, offlineTotal } = computeSbiCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 100000, channel: 'online' }, // 5% = 5000, capped to 2000
    { id: 't2', date: '2026-08-02', amount: 100000, channel: 'offline' }, // 1% = 1000, under the 2000 cap
  ]);
  assert.equal(onlineTotal, 2000);
  assert.equal(offlineTotal, 1000);
});

test('SBI: excluded-category transactions earn nothing on either channel', () => {
  const params = CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback;
  const { totalReward } = computeSbiCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 5000, channel: 'excluded' },
  ]);
  assert.equal(totalReward, 0);
});

// SBI's own Cashback T&C, clause 11.1.s: "Card Cashback is not applicable
// on transactions less than ₹100."
test('SBI: transactions under ₹100 earn no cashback, per SBI\'s own T&C', () => {
  const params = CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback;
  const { perTransaction, totalReward } = computeSbiCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50, channel: 'online' },
    { id: 't2', date: '2026-08-02', amount: 99, channel: 'offline' },
    { id: 't3', date: '2026-08-03', amount: 100, channel: 'online' },
  ]);
  assert.equal(perTransaction[0].earned, 0, 'a ₹50 online transaction is under the ₹100 minimum');
  assert.equal(perTransaction[1].earned, 0, 'a ₹99 offline transaction is under the ₹100 minimum');
  assert.equal(perTransaction[2].earned, 5, 'a ₹100 transaction meets the minimum and earns normally');
  assert.equal(totalReward, 5);
});

test('SBI: a blank/null minTransaction means no minimum, not "everything is under it"', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback, minTransaction: null };
  const { totalReward } = computeSbiCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50, channel: 'online' },
  ]);
  assert.equal(totalReward, 2, 'floor(50*5/100)=2 - a cleared minimum must not zero out every transaction');
});

// --- HSBC Live+ ---

test('HSBC Live+: bonus and base tiers are computed on the cycle aggregate, not per transaction', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate;
  const { totalReward, bonusEarned, baseEarned } = computeHsbcCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 1000, isBonusEligible: true },
    { id: 't2', date: '2026-08-02', amount: 500, isBonusEligible: true },
    { id: 't3', date: '2026-08-03', amount: 2000, isBonusEligible: false },
  ]);
  assert.equal(bonusEarned, 150, 'round((1000+500)*10/100) = 150');
  assert.equal(baseEarned, 30, 'round(2000*1.5/100) = 30');
  assert.equal(totalReward, 180);
});

test('HSBC Live+: the ₹1,200/month bonus cap applies to the combined eligible total, not per transaction', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate;
  const { bonusEarned } = computeHsbcCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 8000, isBonusEligible: true }, // 800
    { id: 't2', date: '2026-08-02', amount: 8000, isBonusEligible: true }, // another 800, combined 1600 > 1200 cap
  ]);
  assert.equal(bonusEarned, 1200);
});

test('HSBC Live+: excluded transactions (e.g. international) are counted in neither pool', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate;
  const { totalReward } = computeHsbcCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 5000, isBonusEligible: true, channel: 'excluded' },
  ]);
  assert.equal(totalReward, 0);
});

test('HSBC Live+: a blank/null bonusMonthlyCap means uncapped, not "capped at zero"', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate, bonusMonthlyCap: null };
  const { bonusEarned } = computeHsbcCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 8000, isBonusEligible: true }, // round(8000*10/100) = 800
  ]);
  assert.equal(bonusEarned, 800, 'a cleared cap field must not silently zero out every bonus-tier reward');
});

// --- Axis SuperMoney RuPay ---

test('SuperMoney: a transaction under ₹100 earns nothing on either pool', () => {
  const params = CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool;
  const { totalReward } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50, isBonusEligible: true },
    { id: 't2', date: '2026-08-01', amount: 99, isBonusEligible: false },
  ]);
  assert.equal(totalReward, 0);
});

test('SuperMoney: the 3% bonus pool is capped by the 1% base pool when the base pool exceeds ₹100', () => {
  const params = CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool;
  const { totalReward, baseTotal, bonusFinal } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 10000, isBonusEligible: false }, // base 1% = 100
    { id: 't2', date: '2026-08-01', amount: 10000, isBonusEligible: true }, // bonus 3% = 300, but capped by base pool
  ]);
  assert.equal(baseTotal, 100);
  assert.equal(bonusFinal, 100, 'bonus pool capped at the base pool of 100');
  assert.equal(totalReward, 200);
});

test('SuperMoney: the bonus pool floor is ₹100 even when the base pool earned less', () => {
  const params = CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool;
  const { baseTotal, bonusFinal } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 100, isBonusEligible: false }, // base 1% = 1
    { id: 't2', date: '2026-08-01', amount: 10000, isBonusEligible: true }, // bonus raw 3% = 300
  ]);
  assert.equal(baseTotal, 1);
  assert.equal(bonusFinal, 100, 'floor of 100 applies since the base pool (1) is under 100');
});

test('SuperMoney: the bonus pool never exceeds what it actually raw-earned, even under the floor', () => {
  const params = CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool;
  const { bonusFinal } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 100, isBonusEligible: true }, // bonus raw 3% = 3
  ]);
  assert.equal(bonusFinal, 3, 'raw bonus (3) is below the 100 floor, so it is not topped up to 100');
});

test('SuperMoney: a blank/null minTransaction does not disable earning entirely', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool, minTransaction: null };
  const { totalReward } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50, isBonusEligible: false }, // floor(50*1/100) = 0, but not skipped entirely
  ]);
  assert.equal(totalReward, 0, 'still earns nothing at this tiny amount due to rounding, but the transaction was actually evaluated');
});

test('SuperMoney: a blank/null bonusFloor still lets the bonus pool earn up to the base pool', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool, bonusFloor: null };
  const { bonusFinal } = computeSuperMoneyCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 10000, isBonusEligible: false }, // base 1% = 100
    { id: 't2', date: '2026-08-01', amount: 10000, isBonusEligible: true }, // bonus raw 3% = 300, capped by base pool
  ]);
  assert.equal(bonusFinal, 100, 'without a floor, the bonus pool is simply capped at the base pool, same as the normal case');
});

// --- HSBC Premier ---

test('HSBC Premier: flat 3 points per ₹100 on a regular transaction', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 1000, category: 'regular' },
  ]);
  assert.equal(totalReward, 30);
});

test('HSBC Premier: fuel earns nothing', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 5000, category: 'fuel_excluded' },
  ]);
  assert.equal(totalReward, 0);
});

test('HSBC Premier: the ₹1L category cap stops earning once crossed, even across multiple transactions', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { perTransaction, totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 90000, category: 'capped_category' }, // earns fully: floor(90000*3/100)=2700
    { id: 't2', date: '2026-08-02', amount: 20000, category: 'capped_category' }, // only 10000 of this is still under the cap
    { id: 't3', date: '2026-08-03', amount: 5000, category: 'capped_category' }, // cap already exhausted
  ]);
  assert.equal(perTransaction[0].earned, 2700);
  assert.equal(perTransaction[1].earned, 300, 'floor(10000*3/100)=300, only 10000 of the 20000 was still under the cap');
  assert.equal(perTransaction[2].earned, 0);
  assert.equal(totalReward, 3000);
});

test('HSBC Premier: a travel-bonus transaction applies its own multiplier on top of the base rate', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 10000, category: 'travel_bonus', travelMultiplier: 6 },
  ]);
  assert.equal(totalReward, 1800, 'floor(10000*3/100)*6 = 300*6 = 1800');
});

test('HSBC Premier: Travel with Points earnings are capped at 18,000 points/month, even across bookings', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { perTransaction, totalReward } = computeHsbcPremierCycleReward(params, [
    // floor(50000*3/100)*12 = 1500*12 = 18000, already at the cap alone
    { id: 't1', date: '2026-08-01', amount: 50000, category: 'travel_bonus', travelMultiplier: 12 },
    { id: 't2', date: '2026-08-02', amount: 10000, category: 'travel_bonus', travelMultiplier: 6 },
  ]);
  assert.equal(perTransaction[0].earned, 18000);
  assert.equal(perTransaction[1].earned, 0, 'the 18,000/month travel cap is already exhausted');
  assert.equal(totalReward, 18000);
});

test('HSBC Premier: a blank/null categoryMonthlyCap means uncapped, not "no room left"', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped, categoryMonthlyCap: null };
  const { totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 500000, category: 'capped_category' },
  ]);
  assert.equal(totalReward, 15000, 'floor(500000*3/100)=15000 - a cleared cap must not zero out every capped-category reward');
});

// HSBC's Rewards T&C spells out a worked example for this exact mechanic:
// ₹130 -> 3pts (₹30 carried), (₹270+₹30)=₹300 -> 9pts, ₹500 -> 15pts. Rows 1
// and 3 both match floor(eligible/100)*3 exactly; row 2's printed "6pts" is
// inconsistent with that same formula (and with the "3 points per ₹100"
// headline rate) and reads as a typo in HSBC's own PDF, so this test follows
// the documented formula rather than the one inconsistent cell.
test('HSBC Premier: a sub-₹100 remainder carries forward to the next transaction, per HSBC\'s own worked example', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { perTransaction, totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 130, category: 'regular' },
    { id: 't2', date: '2026-08-02', amount: 270, category: 'regular' },
    { id: 't3', date: '2026-08-03', amount: 500, category: 'regular' },
  ]);
  assert.equal(perTransaction[0].earned, 3, 'floor(130/100)*3 = 3, ₹30 carried forward');
  assert.equal(perTransaction[1].earned, 9, 'floor((270+30)/100)*3 = floor(300/100)*3 = 9');
  assert.equal(perTransaction[2].earned, 15, 'floor(500/100)*3 = 15, no remainder left to carry');
  assert.equal(totalReward, 27);
});

test('HSBC Premier: carry-forward keeps a capped-category transaction\'s leftover fraction alive for the next one', () => {
  const params = CARD_STRATEGY_DEFAULTS.hsbc_premier_flat_capped;
  const { perTransaction, totalReward } = computeHsbcPremierCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 50, category: 'capped_category' }, // floor(50/100)=0 -> 0pts, ₹50 carried
    { id: 't2', date: '2026-08-02', amount: 50, category: 'regular' }, // 50+50=100 -> floor(100/100)=1 -> 3pts
  ]);
  assert.equal(perTransaction[0].earned, 0);
  assert.equal(perTransaction[1].earned, 3, 'the carried ₹50 combines with this ₹50 spend to cross the ₹100 threshold');
  assert.equal(totalReward, 3);
});

test('Diners: a missing/empty categories list falls back to the base slab rate instead of throwing', () => {
  const params = { ...CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone, categories: [] };
  const { totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 450, category: 'regular' },
  ]);
  assert.equal(totalReward, 15, 'floor(450/150)*5 = 15, at the safe 1x fallback multiplier');
});

test('Diners: a transaction\'s own travelMultiplier overrides its category\'s default multiplier', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { perTransaction, totalReward } = computeDinersCycleReward(params, [
    // smartbuy_hotel defaults to 10x, but a flight booking on SmartBuy
    // earns a different real-world rate - the transaction's own multiplier
    // should win.
    { id: 't1', date: '2026-08-01', amount: 4500, category: 'smartbuy_hotel', travelMultiplier: 5 },
  ]);
  assert.equal(perTransaction[0].multiplier, 5);
  assert.equal(totalReward, 750, 'floor(4500/150)*5*5 = 30*5*5 = 750');
});

test('Diners: no travelMultiplier on a transaction falls back to the category\'s fixed multiplier', () => {
  const params = CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone;
  const { perTransaction, totalReward } = computeDinersCycleReward(params, [
    { id: 't1', date: '2026-08-01', amount: 4500, category: 'smartbuy_hotel' },
  ]);
  assert.equal(perTransaction[0].multiplier, 10, 'unset travelMultiplier keeps the category default (10x for smartbuy_hotel)');
  assert.equal(totalReward, 1500, 'floor(4500/150)*5*10 = 30*5*10 = 1500');
});

// --- Dispatcher ---

test('computeCardCycleReward dispatches to the right strategy based on the card record', () => {
  const card = {
    rewardStrategy: 'sbi_two_channel_cashback',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }],
  };
  const { totalReward } = computeCardCycleReward(card, [{ id: 't1', date: '2026-08-01', amount: 10000, channel: 'online' }], '2026-08-01');
  assert.equal(totalReward, 500);
});

test('computeCardCycleReward returns a safe zero for an unknown strategy instead of throwing', () => {
  const result = computeCardCycleReward({ rewardStrategy: 'not_a_real_strategy' }, []);
  assert.equal(result.totalReward, 0);
});

test('computeCardCycleReward resolves the rule version active at asOfDate, not the latest one', () => {
  const card = {
    rewardStrategy: 'sbi_two_channel_cashback',
    strategyParamsHistory: [
      { effectiveFrom: '2026-01-01', params: { ...CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback, onlineRate: 5 } },
      { effectiveFrom: '2026-04-01', params: { ...CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback, onlineRate: 2 } },
    ],
  };
  const txns = [{ id: 't1', date: '2026-03-15', amount: 10000, channel: 'online' }];
  const beforeChange = computeCardCycleReward(card, txns, '2026-03-15');
  const afterChange = computeCardCycleReward(card, txns, '2026-04-15');
  assert.equal(beforeChange.totalReward, 500, 'a cycle that opened before the rate change still uses the old 5% rate');
  assert.equal(afterChange.totalReward, 200, 'a cycle that opened after the rate change uses the new 2% rate on the same spend');
});

// --- Dated rule version resolution ---

test('resolveStrategyParamsForDate picks the version whose effectiveFrom is the latest one on or before the given date', () => {
  const history = [
    { effectiveFrom: '2026-01-01', params: { rate: 1 } },
    { effectiveFrom: '2026-04-01', params: { rate: 2 } },
    { effectiveFrom: '2026-08-01', params: { rate: 3 } },
  ];
  assert.equal(resolveStrategyParamsForDate(history, '2026-03-31').rate, 1);
  assert.equal(resolveStrategyParamsForDate(history, '2026-04-01').rate, 2, 'the boundary date itself belongs to the new version');
  assert.equal(resolveStrategyParamsForDate(history, '2026-07-31').rate, 2);
  assert.equal(resolveStrategyParamsForDate(history, '2026-12-31').rate, 3);
});

test('resolveStrategyParamsForDate falls back to the earliest version for a date before any recorded rule', () => {
  const history = [{ effectiveFrom: '2026-04-01', params: { rate: 2 } }];
  assert.equal(resolveStrategyParamsForDate(history, '2020-01-01').rate, 2);
});

test('resolveStrategyParamsForDate is order-independent - an unsorted history resolves the same as a sorted one', () => {
  const history = [
    { effectiveFrom: '2026-08-01', params: { rate: 3 } },
    { effectiveFrom: '2026-01-01', params: { rate: 1 } },
    { effectiveFrom: '2026-04-01', params: { rate: 2 } },
  ];
  assert.equal(resolveStrategyParamsForDate(history, '2026-05-01').rate, 2);
});

test('resolveStrategyParamsForDate returns an empty object for a card with no rule history at all', () => {
  assert.deepEqual(resolveStrategyParamsForDate(null, '2026-08-01'), {});
  assert.deepEqual(resolveStrategyParamsForDate([], '2026-08-01'), {});
});

// --- Milestone progress ---

test('computeCardMilestoneProgress sums only that card\'s non-excluded spend in the period', () => {
  const txns = [
    { cardId: 'c1', date: '2026-07-05', amount: 100000, category: 'regular' },
    { cardId: 'c1', date: '2026-10-05', amount: 500000, category: 'regular' }, // outside the quarter
    { cardId: 'c1', date: '2026-07-10', amount: 50000, category: 'excluded' }, // excluded category
    { cardId: 'c2', date: '2026-07-05', amount: 900000, category: 'regular' }, // different card
  ];
  const { spent, pctUsed, remaining } = computeCardMilestoneProgress(txns, 'c1', '2026-07-01', '2026-10-01', 400000);
  assert.equal(spent, 100000);
  assert.equal(pctUsed, 0.25);
  assert.equal(remaining, 300000);
});

test('computeCardMilestoneProgress handles a null target (no milestone on this card) without dividing by zero', () => {
  const { pctUsed, remaining } = computeCardMilestoneProgress([], 'c1', '2026-07-01', '2026-10-01', null);
  assert.equal(pctUsed, 0);
  assert.equal(remaining, null);
});

test('computeCardMilestoneProgress adds startingSpend as a baseline for spend that predates tracking', () => {
  const txns = [{ cardId: 'c1', date: '2026-07-05', amount: 100000, category: 'regular' }];
  const { spent, remaining } = computeCardMilestoneProgress(txns, 'c1', '2026-07-01', '2026-10-01', 400000, 150000);
  assert.equal(spent, 250000, 'the 150000 carried-over baseline plus the 100000 tracked in-app');
  assert.equal(remaining, 150000);
});

test('computeCardMilestoneProgress treats a missing startingSpend as zero, not NaN', () => {
  const txns = [{ cardId: 'c1', date: '2026-07-05', amount: 100000, category: 'regular' }];
  const { spent } = computeCardMilestoneProgress(txns, 'c1', '2026-07-01', '2026-10-01', 400000);
  assert.equal(spent, 100000);
});

// --- Annual milestone window (card renewal cycle, not calendar year) ---

test('getAnnualMilestoneWindow runs a 12-month window from the given anchor month, not Jan-Dec', () => {
  assert.deepEqual(getAnnualMilestoneWindow(3, '2026-08-12'), { periodStart: '2026-03-01', periodEnd: '2027-03-01' });
  assert.deepEqual(getAnnualMilestoneWindow(3, '2026-02-15'), { periodStart: '2025-03-01', periodEnd: '2026-03-01' }, 'before this year\'s anchor month, so the window is still last year\'s');
  assert.deepEqual(getAnnualMilestoneWindow(3, '2026-03-01'), { periodStart: '2026-03-01', periodEnd: '2027-03-01' }, 'the anchor date itself belongs to the new window');
});

test('getAnnualMilestoneWindow defaults to January for a card with no anchor month set', () => {
  assert.deepEqual(getAnnualMilestoneWindow(null, '2026-08-12'), { periodStart: '2026-01-01', periodEnd: '2027-01-01' });
  assert.deepEqual(getAnnualMilestoneWindow(undefined, '2026-08-12'), { periodStart: '2026-01-01', periodEnd: '2027-01-01' });
});

// --- Live single-transaction preview (add/edit forms) ---

test('previewTransactionReward computes what a brand-new transaction would earn among its cycle\'s existing ones', () => {
  const card = { billingCycleDay: 1, rewardStrategy: 'sbi_two_channel_cashback', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }] };
  const existing = [{ id: 't1', date: '2026-08-05', amount: 1000, channel: 'online' }]; // already earned 50, online cap 2000
  const preview = previewTransactionReward(card, existing, { date: '2026-08-10', amount: 40000, channel: 'online' });
  assert.equal(preview.earned, 1950, 'the ₹2000 online cap minus the 50 already earned by the existing transaction this cycle');
});

test('previewTransactionReward excludes the transaction being edited from "the others" using its own id', () => {
  const card = { billingCycleDay: 1, rewardStrategy: 'sbi_two_channel_cashback', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }] };
  const existing = [{ id: 't1', date: '2026-08-05', amount: 1000, channel: 'online' }];
  // editing t1 itself with a changed amount shouldn't double count it against its own cap room
  const preview = previewTransactionReward(card, existing, { id: 't1', date: '2026-08-05', amount: 2000, channel: 'online' });
  assert.equal(preview.earned, 100, 'floor(2000*5/100)=100, well under the cap, not stacked on top of the original 1000');
});

test('previewTransactionReward returns null until there is enough to compute (no date/amount yet)', () => {
  const card = { billingCycleDay: 1, rewardStrategy: 'sbi_two_channel_cashback', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }] };
  assert.equal(previewTransactionReward(card, [], { date: '2026-08-10' }), null);
  assert.equal(previewTransactionReward(card, [], { amount: 500 }), null);
});

// --- Cap-remaining status (per-category / per-pool "how much room is left") ---

test('computeCardCapStatus (Diners) reports remaining room per category for the period containing today', () => {
  const card = {
    rewardStrategy: 'hdfc_diners_slab_milestone',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone }],
  };
  const txns = [
    { id: 't1', date: '2026-08-05', amount: 9000, category: 'smartbuy_hotel' }, // floor(9000/150)*5*10 = 3000
    { id: 't2', date: '2026-08-06', amount: 759, category: 'grocery' }, // floor(759/150)*5 = 25
  ];
  const statuses = computeCardCapStatus(card, txns, txns, '2026-08-12');
  const smartbuy = statuses.find((s) => s.key === 'smartbuy_hotel');
  const grocery = statuses.find((s) => s.key === 'grocery');
  assert.equal(smartbuy.earned, 3000);
  assert.equal(smartbuy.remaining, 7000, '10000 cap - 3000 earned so far this month');
  assert.equal(grocery.earned, 25);
  assert.equal(grocery.remaining, 1975, '2000 cap - 25 earned so far this month');
});

test('computeCardCapStatus (Diners) scopes a day-period cap to only that day, not the whole month', () => {
  const card = {
    rewardStrategy: 'hdfc_diners_slab_milestone',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.hdfc_diners_slab_milestone }],
  };
  const txns = [
    { id: 't1', date: '2026-08-01', amount: 1500, category: 'weekend_dining' }, // a different day this month
    { id: 't2', date: '2026-08-12', amount: 300, category: 'weekend_dining' }, // floor(300/150)*5*2 = 20
  ];
  const status = computeCardCapStatus(card, txns, txns, '2026-08-12').find((s) => s.key === 'weekend_dining');
  assert.equal(status.earned, 20, 'only the transaction on 2026-08-12 counts toward a day-period cap');
  assert.equal(status.remaining, 980);
});

test('computeCardCapStatus (HSBC Live+) reports the bonus-category cap remaining for the current month', () => {
  const card = {
    rewardStrategy: 'hsbc_tiered_cashback_aggregate',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate }],
  };
  const txns = [
    { id: 't1', date: '2026-08-01', amount: 8000, isBonusEligible: true, channel: null }, // round(8000*10/100) = 800
    { id: 't2', date: '2026-07-31', amount: 50000, isBonusEligible: true, channel: null }, // different month, excluded
  ];
  const [status] = computeCardCapStatus(card, txns, txns, '2026-08-15');
  assert.equal(status.earned, 800);
  assert.equal(status.remaining, 400, '1200 cap - 800 earned, last month\'s spend does not count');
});

test('computeCardCapStatus (SBI) reads the current billing cycle, not the calendar month', () => {
  const card = {
    rewardStrategy: 'sbi_two_channel_cashback',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }],
  };
  const cycleTxns = [{ id: 't1', date: '2026-08-05', amount: 30000, channel: 'online' }]; // floor(30000*5/100)=1500
  const status = computeCardCapStatus(card, cycleTxns, cycleTxns, '2026-08-12').find((s) => s.key === 'online');
  assert.equal(status.earned, 1500);
  assert.equal(status.remaining, 500, '2000 cap - 1500 earned this cycle');
});

test('computeCardCapStatus returns an empty list for a strategy with no hard cap to track', () => {
  const card = {
    rewardStrategy: 'axis_supermoney_dual_pool',
    strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.axis_supermoney_dual_pool }],
  };
  assert.deepEqual(computeCardCapStatus(card, [], [], '2026-08-12'), []);
});

// --- Manual reward overrides ---

test('applyRewardOverrides leaves the result untouched when nothing is overridden', () => {
  const card = { rewardStrategy: 'sbi_two_channel_cashback', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }] };
  const txns = [{ id: 't1', date: '2026-08-01', amount: 1000, channel: 'online' }];
  const cycleReward = computeCardCycleReward(card, txns, '2026-08-01');
  const result = applyRewardOverrides(cycleReward, txns);
  assert.deepEqual(result, cycleReward);
});

test('applyRewardOverrides substitutes the override and recomputes the total (earned-based strategies)', () => {
  const card = { rewardStrategy: 'sbi_two_channel_cashback', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.sbi_two_channel_cashback }] };
  const txns = [
    { id: 't1', date: '2026-08-01', amount: 1000, channel: 'online' }, // formula: 50
    { id: 't2', date: '2026-08-02', amount: 2000, channel: 'online', rewardOverride: 200 }, // formula would be 100, corrected to 200
  ];
  const cycleReward = computeCardCycleReward(card, txns, '2026-08-01');
  const result = applyRewardOverrides(cycleReward, txns);
  const overridden = result.perTransaction.find((p) => p.id === 't2');
  const untouched = result.perTransaction.find((p) => p.id === 't1');
  assert.equal(overridden.earned, 200);
  assert.equal(overridden.overridden, true);
  assert.equal(untouched.earned, 50, 'the non-overridden transaction keeps its formula value');
  assert.equal(result.totalReward, 250, '50 (formula) + 200 (override)');
});

test('applyRewardOverrides works for the HSBC Live+ aggregate model via its per-transaction estimate', () => {
  const card = { rewardStrategy: 'hsbc_tiered_cashback_aggregate', strategyParamsHistory: [{ effectiveFrom: '2026-01-01', params: CARD_STRATEGY_DEFAULTS.hsbc_tiered_cashback_aggregate }] };
  const txns = [
    { id: 't1', date: '2026-08-01', amount: 1000, isBonusEligible: true, channel: null }, // estimate: round(1000*10/100)=100
    { id: 't2', date: '2026-08-02', amount: 500, isBonusEligible: false, channel: null, rewardOverride: 50 }, // estimate would be round(500*1.5/100)=8, corrected to 50
  ];
  const cycleReward = computeCardCycleReward(card, txns, '2026-08-01');
  const result = applyRewardOverrides(cycleReward, txns);
  assert.equal(result.totalReward, 150, '100 (estimate) + 50 (override), overriding away from the pure aggregate total');
});

// --- Local storage round-trips ---

test('getCreditCards/setCreditCards round-trip through storage, defaulting to []', () => {
  setCreditCards([{ id: 'c1', name: 'Test Card' }]);
  assert.deepEqual(getCreditCards(), [{ id: 'c1', name: 'Test Card' }]);
  setCreditCards([]);
  assert.deepEqual(getCreditCards(), []);
});

test('getCardTransactions/setCardTransactions round-trip through storage, defaulting to []', () => {
  setCardTransactions([{ id: 't1', cardId: 'c1', amount: 100 }]);
  assert.deepEqual(getCardTransactions(), [{ id: 't1', cardId: 'c1', amount: 100 }]);
  setCardTransactions([]);
  assert.deepEqual(getCardTransactions(), []);
});

test('getCardBillingCycles/setCardBillingCycles round-trip through storage, defaulting to []', () => {
  setCardBillingCycles([{ cardId: 'c1', cycleStart: '2026-07-04' }]);
  assert.deepEqual(getCardBillingCycles(), [{ cardId: 'c1', cycleStart: '2026-07-04' }]);
  setCardBillingCycles([]);
  assert.deepEqual(getCardBillingCycles(), []);
});

test('getCardBillingCycleKey combines card and cycle start into a stable key', () => {
  assert.equal(getCardBillingCycleKey('c1', '2026-07-04'), 'c1|2026-07-04');
});
