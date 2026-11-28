import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTripCash, priceCashPurchase, priceCashExchange, applyCashFunding, carryOverOptions, startingCashReplaced, parseRateInput, formatRate, formatCashBreakdown } from '../lib/tripCash.js';
import { computeTripTotalSpend, computeSettlements, computeMemberTotals, excludeCashSpend, computeTripCashByCurrency, groupByCategory } from '../lib/utils.js';

// Made-up trip: Asha takes 600 USD bought at 91 along; the trip's main currency is VND.
const MEMBERS = ['Asha', 'Bela', 'Chet'];
const TRIPS = [{ id: 't', name: 'Trip', currency: 'VND', otherCurrencies: ['USD'] }];
const opening = (over = {}) => ({ id: 'opening_t_USD_Asha', tripId: 't', type: 'opening', amount: 600, currency: 'USD', rate: 91, owner: 'Asha', createdAt: '2030-01-01T00:00:00Z', ...over });
let n = 0;
const buy = (localAmount, over = {}) => {
  n += 1;
  return { id: `e${n}`, tripId: 't', ledger: 'travel', date: '2030-02-02', createdAt: `2030-02-02T10:00:${String(n).padStart(2, '0')}Z`, paymentType: 'cash', localCurrency: 'USD', localAmount, amount: 0, payer: 'Bela', split: true, splitType: 'shared', splitAmong: ['Asha', 'Bela'], category: 'Food', ...over };
};
const atm = (localAmount, amount, over = {}) => ({ ...buy(localAmount), paymentType: 'forex', isWithdrawal: true, amount, payer: 'Chet', splitAmong: null, category: 'Misc', ...over });
// An exchange as the form saves it: a withdrawal paid for with other cash, shared by everyone.
const exchange = (given, received, { from = 'USD', ...over } = {}) => ({ id: 'x1', tripId: 't', ledger: 'travel', date: '2030-02-01', createdAt: '2030-02-01T09:00:00Z', isWithdrawal: true, paymentMethod: null, exchangedFrom: { currency: from, amount: given }, localCurrency: 'VND', localAmount: received, amount: 0, payer: 'Asha', split: true, splitType: 'shared', category: 'Misc', ...over });
const read = (entries, movements) => applyCashFunding(entries, movements, TRIPS);
const owes = (entries) => computeSettlements(excludeCashSpend(entries), 'travel', MEMBERS);

test('starting cash charges nothing when saved, and each purchase counts when spent, as paid by its owner', () => {
  const card = { id: 'c', tripId: 't', ledger: 'travel', amount: 1000, payer: 'Asha', split: true, splitType: 'shared', splitAmong: ['Asha', 'Bela'], category: 'Food', paymentType: 'credit', date: '2030-02-01' };
  assert.equal(computeTripTotalSpend(read([card], [opening()]), MEMBERS), 1000, 'saving the cash adds nothing');
  const dinner = buy(20, { amount: 1820 });
  const seen = read([card, dinner], [opening()]);
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 2820);
  assert.deepEqual(seen[1].ownCash, [{ owner: 'Asha', amount: 1820 }]);
  // Bela handed the money over, but it was Asha's: Bela owes Asha 500 (card) + 910 (dinner).
  assert.deepEqual(owes(seen), [{ debtor: 'Bela', creditor: 'Asha', amount: 1410 }]);
  assert.deepEqual(computeMemberTotals(excludeCashSpend(seen), MEMBERS), { Asha: 1410, Bela: 1410, Chet: 0 });
  assert.equal(groupByCategory(seen, null, 'travel').reduce((a, c) => a + c.amount, 0), 2820);
  assert.equal(computeTripCashByCurrency(seen, [opening()], 't', 'Trip', 'VND').find((p) => p.currency === 'USD').balance, 580);
});

test('trips without priced starting cash are left exactly as they were', () => {
  const entries = [atm(100, 9000), buy(10, { amount: 900 })];
  assert.equal(read(entries, []), entries);
  assert.equal(read(entries, [opening({ rate: null, owner: null })]), entries, 'cash with no rate only counts the cash');
  assert.equal(computeTripTotalSpend(read(entries, []), MEMBERS), 9000, 'ATM cash still counts when withdrawn, not again when spent');
  assert.equal(excludeCashSpend(entries).length, 1);
});

test('who a purchase was for stays as entered', () => {
  const cases = [
    [{ split: false, splitType: 'personal' }, [{ debtor: 'Bela', creditor: 'Asha', amount: 910 }], 'Bela bought for themself with Asha\'s cash'],
    [{ split: false, splitType: 'personal', payer: 'Asha' }, [], 'Asha for herself'],
    [{ splitType: 'owed', owedBy: 'Chet', payer: 'Bela' }, [{ debtor: 'Chet', creditor: 'Asha', amount: 910 }], 'for Chet'],
    [{ splitType: 'owed', owedBy: 'Asha', payer: 'Bela' }, [], 'for Asha, with her own money'],
    [{ splitType: 'custom', splitShares: { Asha: 1, Bela: 4 } }, [{ debtor: 'Bela', creditor: 'Asha', amount: 728 }], 'custom shares'],
  ];
  for (const [over, expected, label] of cases) {
    const seen = read([buy(10, over)], [opening()]);
    assert.deepEqual(owes(seen), expected, label);
    assert.equal(computeTripTotalSpend(seen, MEMBERS), 910, label);
  }
});

test('own cash is used before ATM cash, and only the own part of a purchase counts', () => {
  const withdrawal = atm(100, 9500, { date: '2030-02-01', createdAt: '2030-02-01T00:00:00Z' });
  const first = buy(590);
  const straddle = buy(30);
  const after = buy(10);
  const seen = read([withdrawal, first, straddle, after], [opening()]);
  assert.equal(seen[1].amount, 53690);
  assert.equal(seen[2].amount, 10 * 91 + 20 * 95, 'priced at each rate');
  assert.deepEqual(seen[2].ownCash, [{ owner: 'Asha', amount: 910 }]);
  assert.equal(seen[3].ownCash, undefined, 'ATM cash: already charged at the withdrawal');
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 9500 + 53690 + 910);
});

test('a purchase beyond the recorded cash keeps the typed amount and counts only what own cash covered', () => {
  const seen = read([buy(700, { amount: 70000 })], [opening()]);
  assert.equal(seen[0].amount, 70000);
  assert.deepEqual(seen[0].ownCash, [{ owner: 'Asha', amount: 54600 }]);
});

test('editing the rate or removing an earlier purchase re-prices what follows', () => {
  const a = buy(100, { amount: 9100 });
  const b = buy(100, { amount: 9100 });
  assert.equal(read([a, b], [opening({ rate: 90 })])[1].amount, 9000);
  const ten = atm(500, 50000);
  const [, later] = read([a, b, ten], [opening({ amount: 100 })]).slice(0, 2);
  assert.equal(later.amount, 10000);
  assert.equal(read([b, ten], [opening({ amount: 100 })])[0].amount, 9100, 'with the first gone, the second gets the own cash');
});

test('the order entries arrive in does not matter, and a back-dated purchase takes the earlier place', () => {
  const late = buy(550, { date: '2030-02-05', createdAt: '2030-02-05T10:00:00Z' });
  const backDated = buy(100, { date: '2030-02-03', createdAt: '2030-02-06T10:00:00Z' });
  const money = atm(500, 50000, { date: '2030-02-01', createdAt: '2030-02-01T00:00:00Z' });
  for (const list of [[late, backDated, money], [money, backDated, late]]) {
    const seen = Object.fromEntries(read(list, [opening()]).map((e) => [e.id, e]));
    assert.deepEqual(seen[backDated.id].ownCash, [{ owner: 'Asha', amount: 9100 }]);
    assert.deepEqual(seen[late.id].ownCash, [{ owner: 'Asha', amount: 45500 }]);
  }
});

test('an exchange counts like an ATM withdrawal, as paid by the owner, and spending what it brought adds nothing', () => {
  const lunch = buy(500000, { localCurrency: 'VND' });
  const seen = read([exchange(100, 2500000), lunch], [opening()]);
  assert.deepEqual([seen[0].amount, seen[0].payer, seen[0].ownCash], [9100, 'Asha', [{ owner: 'Asha', amount: 9100 }]]);
  assert.equal(seen[1].amount, 1820, 'priced from the dollars handed over');
  assert.equal(seen[1].ownCash, undefined);
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 9100, 'only the exchange');
  assert.deepEqual(owes(seen).map((x) => [x.debtor, x.creditor, Math.round(x.amount)]).sort(), [['Bela', 'Asha', 3033], ['Chet', 'Asha', 3033]]);
  assert.equal(groupByCategory(seen, null, 'travel').reduce((a, c) => a + c.amount, 0), 1820, 'the purchase is the category spend, not the exchange');
  const walk = runTripCash({ entries: seen, movements: [opening()], primaryCurrency: 'VND' });
  assert.deepEqual(walk.leftover.map((x) => [x.currency, x.local, x.inr]), [['USD', 500, 45500]], 'the dong is paid for, so only the dollars are still Asha\'s');
  const pools = computeTripCashByCurrency(seen, [opening()], 't', 'Trip', 'VND');
  assert.deepEqual(pools.map((p) => [p.currency, p.withdrawn, p.exchanged, p.balance]), [['VND', 0, 2500000, 2000000], ['USD', 0, -100, 500]]);
});

test('the split on an exchange can be changed, and the owner stays the payer', () => {
  const mine = read([exchange(100, 2500000, { split: false, splitType: 'personal', payer: 'Chet' })], [opening()]);
  assert.equal(mine[0].payer, 'Asha');
  assert.deepEqual(owes(mine), []);
  assert.equal(computeTripTotalSpend(mine, MEMBERS), 9100);
  const two = read([exchange(100, 2500000, { splitAmong: ['Asha', 'Bela'] })], [opening()]);
  assert.deepEqual(owes(two), [{ debtor: 'Bela', creditor: 'Asha', amount: 4550 }]);
});

test('exchanging two owners\' cash counts each part as its owner\'s', () => {
  const movements = [opening({ amount: 60 }), opening({ id: 'b', owner: 'Bela', amount: 100, rate: 90, createdAt: '2030-01-02T00:00:00Z' })];
  const seen = read([exchange(100, 2500000)], movements);
  assert.equal(seen[0].amount, 60 * 91 + 40 * 90);
  assert.deepEqual(excludeCashSpend(seen).map((e) => [e.payer, e.amount]), [['Asha', 5460], ['Bela', 3600]]);
  assert.deepEqual(computeMemberTotals(excludeCashSpend(seen), MEMBERS), { Asha: 3020, Bela: 3020, Chet: 3020 });
});

test('exchanging cash that was already charged adds nothing again', () => {
  const withdrawal = atm(100, 9000, { date: '2030-01-31' });
  const change = exchange(100, 2500000);
  const lunch = buy(250000, { localCurrency: 'VND' });
  const seen = read([withdrawal, change, lunch], []);
  assert.equal(seen[1].amount, 0);
  assert.equal(seen[1].ownCash, undefined);
  assert.equal(seen[2].amount, 900, 'priced at the ATM rate');
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 9000);
  // one of Asha's dollars first, then 100 from the ATM: only hers is added
  const mixed = read([withdrawal, exchange(101, 2525000)], [opening({ amount: 1 })]);
  assert.deepEqual([mixed[1].amount, mixed[1].ownCash], [91, [{ owner: 'Asha', amount: 91 }]]);
});

test('dong changed back into dollars was already charged, so it stays nobody\'s own', () => {
  const back = exchange(1000000, 40, { id: 'x2', from: 'VND', localCurrency: 'USD', date: '2030-02-10', createdAt: '2030-02-10T00:00:00Z' });
  const seen = read([exchange(100, 2500000), back], [opening()]);
  assert.equal(seen[1].amount, 0);
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 9100);
  assert.deepEqual(runTripCash({ entries: seen, movements: [opening()], primaryCurrency: 'VND' }).leftover.map((x) => [x.currency, x.local]), [['USD', 500]]);
});

test('an exchange follows the starting cash: a new rate re-prices it, and without the cash it adds nothing', () => {
  const saved = exchange(100, 2500000, { amount: 9100 });
  assert.equal(read([saved], [opening({ rate: 90 })])[0].amount, 9000);
  assert.equal(read([saved], [])[0].amount, 0);
  const cashBefore = computeTripCashByCurrency(read([saved], []), [{ tripId: 't', type: 'withdrawal', amount: 70, currency: 'USD' }], 't', 'Trip', 'VND');
  assert.equal(cashBefore.find((p) => p.currency === 'USD').withdrawn, 70, 'an exchange does not hide older withdrawal records');
});

test('before saving, an exchange says what it adds and whether the recorded cash covers it', () => {
  const ask = (entries, movements, fromAmount, over = {}) =>
    priceCashExchange({ entries, movements, primaryCurrency: 'VND', target: { date: '2030-02-02', fromCurrency: 'USD', fromAmount, toCurrency: 'VND', toAmount: 1000, ...over } });
  assert.deepEqual(ask([], [opening()], 100), { covered: true, amount: 9100, ownParts: [{ owner: 'Asha', amount: 9100 }] });
  assert.equal(ask([], [opening()], 601).covered, false);
  assert.equal(ask([], [opening({ rate: null, owner: null })], 1).covered, false, 'cash with no rate cannot be priced');
  assert.deepEqual(ask([atm(100, 9000, { date: '2030-01-31' })], [], 100), { covered: true, amount: 0, ownParts: [] });
  // back-dated, it would take dollars a later purchase has already used
  const later = buy(550, { date: '2030-02-05', createdAt: '2030-02-05T10:00:00Z' });
  assert.equal(ask([later], [opening()], 100).covered, false);
  assert.equal(ask([later], [opening()], 50).covered, true);
  assert.equal(ask([], [opening()], 0), null);
  assert.equal(ask([], [opening()], 10, { toCurrency: 'USD' }), null);
});

test('a cash refund puts the money back and takes it off what counted', () => {
  const paid = buy(50);
  const back = buy(-20, { amount: -1820 });
  const next = buy(570);
  const seen = read([paid, back, next], [opening()]);
  assert.deepEqual(seen[1].ownCash, [{ owner: 'Asha', amount: -1820 }]);
  assert.deepEqual(seen[2].ownCash, [{ owner: 'Asha', amount: 51870 }]);
  assert.equal(computeTripTotalSpend(seen, MEMBERS), 54600, 'exactly the 600 dollars');
});

test('a form prices a purchase from the queue: oldest first, later withdrawals only for later purchases', () => {
  const first = atm(100, 1000, { date: '2030-01-01', createdAt: '2030-01-01T00:00:00Z' });
  const second = atm(100, 1100, { date: '2030-01-03', createdAt: '2030-01-03T00:00:00Z' });
  const used = buy(90, { date: '2030-01-02', createdAt: '2030-01-02T00:00:00Z' });
  const price = (localAmount, over = {}) => priceCashPurchase({ entries: [first, second, used], primaryCurrency: 'USD', target: { date: '2030-01-04', localAmount, localCurrency: 'USD', ...over } });
  assert.equal(price(90).amount, 10 * 10 + 80 * 11, 'straddles both at their own rates');
  assert.equal(price(110).amount, 1200);
  assert.equal(price(111), null, 'more than the cash recorded: typed by hand');
  assert.equal(price(0), null);
  // editing the purchase already saved leaves itself out of the queue
  assert.equal(price(100, { id: used.id, date: used.date, createdAt: used.createdAt }).amount, 1000);
  assert.match(formatCashBreakdown(price(90).breakdown, 'USD'), /10 USD @ 1 USD = ₹10\.00 \(withdrawal 2030-01-01\) \+ 80 USD/);
  const own = priceCashPurchase({ entries: [], movements: [opening()], primaryCurrency: 'VND', target: { date: '2030-01-04', localAmount: 20, localCurrency: 'USD' } });
  assert.deepEqual([own.amount, own.ownParts], [1820, [{ owner: 'Asha', amount: 1820 }]]);
  assert.match(formatCashBreakdown(own.breakdown, 'USD'), /Asha's starting cash/);
});

test('a leftover is offered to another trip once, at its own rate', () => {
  const trips = [...TRIPS, { id: 'u', name: 'Next', currency: 'USD' }, { id: 'v', name: 'After', currency: 'USD' }];
  const entries = [buy(350)];
  const ask = (movements, tripId, exceptId) => carryOverOptions({ entries, movements, trips, tripId, currencies: ['USD'], exceptId });
  const [offer] = ask([opening()], 'u');
  assert.deepEqual([offer.local, offer.owner, offer.rate, offer.tripId, offer.tripName], [250, 'Asha', 91, 't', 'Trip']);
  assert.deepEqual(ask([opening()], 't'), [], 'not to the trip it is on');
  const carried = opening({ id: 'opening_u_USD_Asha', tripId: 'u', amount: 200, carriedFrom: { tripId: 't', tripName: 'Trip' } });
  assert.deepEqual(ask([opening(), carried], 'v').map((x) => [x.tripId, x.local]), [['u', 200]], 'only what the later trip now holds');
  assert.deepEqual(ask([opening(), carried], 'u', carried.id).map((x) => x.tripId), ['t'], 'editing that record offers it again');
  assert.deepEqual(carryOverOptions({ entries, movements: [opening()], trips, tripId: 'u', currencies: ['VND'] }), []);
});

test('leftovers in every currency the new trip handles are offered, each at its own rate', () => {
  const euros = opening({ id: 'opening_t_EUR_Bela', currency: 'EUR', amount: 200, rate: 105, owner: 'Bela' });
  const trips = [{ id: 't', name: 'Trip', currency: 'VND', otherCurrencies: ['USD', 'EUR'] }, { id: 'u', name: 'Europe', currency: 'EUR', otherCurrencies: ['USD'] }];
  const offers = (currencies) => carryOverOptions({ entries: [], movements: [opening(), euros], trips, tripId: 'u', currencies });
  assert.deepEqual(offers(['EUR', 'USD']).map((x) => [x.currency, x.local, x.owner, x.rate]).sort(), [['EUR', 200, 'Bela', 105], ['USD', 600, 'Asha', 91]]);
  assert.deepEqual(offers(['EUR']).map((x) => x.currency), ['EUR']);
});

test('saving starting cash replaces the same owner\'s record and any unpriced one', () => {
  const records = [opening(), opening({ id: 'b', owner: 'Bela' }), { id: 'old', tripId: 't', type: 'opening', amount: 600, currency: 'USD' }, { id: 'dong', tripId: 't', type: 'opening', amount: 5 }, opening({ id: 'elsewhere', tripId: 'u' })];
  const replaced = (record, editing) => startingCashReplaced(records, { tripId: 't', currency: 'USD', ...record }, 'VND', editing);
  assert.deepEqual(replaced({ owner: 'Asha' }), ['opening_t_USD_Asha', 'old']);
  assert.deepEqual(replaced({ owner: null }), ['opening_t_USD_Asha', 'b', 'old'], 'one unpriced record stands for the currency');
  assert.deepEqual(replaced({ owner: 'Bela' }, 'opening_t_USD_Asha'), ['opening_t_USD_Asha', 'b', 'old'], 'changing the owner while editing removes the old one');
  assert.deepEqual(startingCashReplaced(records, { tripId: 't', currency: 'VND', owner: 'Asha' }, 'VND'), ['dong']);
});

test('rates take more decimals than amounts', () => {
  assert.equal(parseRateInput('91'), 91);
  assert.equal(parseRateInput('0.00364'), 0.00364);
  assert.equal(parseRateInput('1,000.5'), 1000.5);
  for (const bad of ['', '0', '-1', 'abc', '1.2.3']) assert.equal(parseRateInput(bad), null, bad);
  assert.equal(formatRate(91), '91');
  assert.equal(formatRate(7280 / 2000000), '0.00364');
});
