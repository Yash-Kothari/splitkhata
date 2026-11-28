import test from 'node:test';
import assert from 'node:assert/strict';
import { replayLots, fundLedger, xirr, computeReturns, taxBucket, computeTax, emptyBuckets, financialYear, realisedGains, exitLoadPct, previewSale, parseTransactions, buildHistoryWrites } from '../lib/portfolioLedger.js';
import { assetOf, taxClassOf, lockInMonthsOf, computeAssetMix, computeFees, computeDrawdowns, monthlyChanges, checkSips, parseFundInfo, checkTargets } from '../lib/portfolioInsights.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const A = { key: 'A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', group: 'zerodha', category: 'Diversified' };

test('replayLots: sales take the oldest units first, and overselling is reported', () => {
  const r = replayLots([
    { date: '2024-01-01', units: 10, amount: 100 },
    { date: '2025-01-01', units: 10, amount: 200 },
    { date: '2026-01-01', units: -15, amount: 450 },
  ]);
  near(r.units, 5);
  near(r.cost, 100);
  assert.deepEqual(r.sales[0].lots.map((l) => [l.date, l.units, l.cost]), [['2024-01-01', 10, 100], ['2025-01-01', 5, 100]]);
  assert.deepEqual(r.flows.map((f) => f.amount), [-100, -200, 450]);
  assert.equal(replayLots([{ date: '2024-01-01', units: -1, amount: 1 }]).short, 1);
});

test('fundLedger: continues a history with SIP days, then matches a later snapshot', () => {
  const history = { asOf: '2026-11-01', items: [{ d: '2026-01-01', u: 100, a: 1000 }] };
  const series = [['2026-11-02', 10], ['2026-11-03', 10], ['2026-11-04', 10]];
  const base = { fund: A, history, series, amountOn: () => 100, today: '2026-11-04' };
  near(fundLedger(base).units, 130);
  // one SIP day did not go through: the newest estimate is trimmed, no sale appears
  const short = fundLedger({ ...base, snapshots: [{ date: '2026-11-04', positions: { A: { units: 120 } } }] });
  near(short.units, 120);
  assert.equal(short.sales.length, 0);
  // an extra purchase seen only in the snapshot
  const extra = fundLedger({ ...base, snapshots: [{ date: '2026-11-04', positions: { A: { units: 180 } } }] });
  near(extra.units, 180);
  near(extra.cost, 1000 + 300 + 500);
  // a redemption seen only in the snapshot
  const sold = fundLedger({ ...base, snapshots: [{ date: '2026-11-04', positions: { A: { units: 40 } } }] });
  near(sold.units, 40);
  assert.equal(sold.sales.length, 1);
  assert.equal(sold.sales[0].estimated, true);
  assert.equal(fundLedger({ ...base, history: null }), null);
});

test('xirr: a year at ten percent, a loss, and no answer without both sides', () => {
  near(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }]), 10);
  near(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 80 }]), -20);
  assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null);
});

test('computeReturns: per fund and together; too new has no yearly rate; no history is listed', () => {
  const B = { ...A, key: 'B', short: 'Beta' };
  const C = { ...A, key: 'C', short: 'Gamma' };
  const ledgers = {
    A: replayLots([{ date: '2025-11-20', units: 10, amount: 100 }]),
    B: replayLots([{ date: '2026-11-01', units: 10, amount: 100 }]),
  };
  const rows = [A, B, C].map((f) => ({ ...f, value: 110, navDate: '2026-11-20' }));
  const r = computeReturns({ rows, funds: [A, B, C], ledgers, today: '2026-11-20' });
  near(r.funds.find((f) => f.key === 'A').xirr, 10);
  assert.equal(r.funds.find((f) => f.key === 'B').xirr, null);
  assert.deepEqual(r.missing, ['Gamma']);
  near(r.total.gain, 20);
});

test('taxBucket: twelve months for equity, slab for new debt, twenty-four months for the rest', () => {
  assert.equal(taxBucket('equity', '2025-11-20', '2026-11-20'), 'equityST');
  assert.equal(taxBucket('equity', '2025-11-20', '2026-11-21'), 'equityLT');
  assert.equal(taxBucket('debt', '2023-04-01', '2030-01-01'), 'slab');
  assert.equal(taxBucket('debt', '2023-03-31', '2026-01-01'), 'otherLT');
  assert.equal(taxBucket('other', '2025-01-01', '2026-06-01'), 'slab');
  assert.equal(taxBucket('other', '2024-01-01', '2026-06-01'), 'otherLT');
});

test('computeTax: the exemption, the rates, cess, and losses set off the right way', () => {
  const t = (b, slab) => computeTax({ ...emptyBuckets(), ...b }, slab);
  assert.equal(t({ equityLT: 125000 }), 0);
  near(t({ equityLT: 225000 }), 100000 * 0.125 * 1.04);
  near(t({ equityST: 1000 }), 208);
  near(t({ slab: 1000 }, 30), 312);
  near(t({ otherLT: 1000 }), 130);
  near(t({ equityST: -1000, equityLT: 226000 }), 100000 * 0.125 * 1.04);
  // a long-term loss does not reduce a short-term gain
  near(t({ equityLT: -5000, equityST: 1000 }), 208);
});

test('financialYear runs April to March', () => {
  assert.equal(financialYear('2027-03-31').label, '2026-27');
  assert.equal(financialYear('2027-04-01').label, '2027-28');
});

test('realisedGains: this year only, one person only', () => {
  const ledgers = {
    A: replayLots([
      { date: '2024-01-01', units: 20, amount: 200 },
      { date: '2026-03-01', units: -10, amount: 150 }, // last financial year
      { date: '2026-05-01', units: -10, amount: 180 },
    ]),
  };
  const r = realisedGains({ funds: [A, { ...A, key: 'K', owner: 'Kruti' }], ledgers, taxClassOf: () => 'equity', today: '2026-11-20' });
  near(r.buckets.equityLT, 80);
  near(r.exemptionLeft, 125000 - 80);
  assert.equal(r.sales.length, 1);
  assert.deepEqual(r.missing, []);
});

test('exit load tiers, and a load not on file', () => {
  assert.equal(exitLoadPct([{ days: 365, pct: 1 }], 365), 1);
  assert.equal(exitLoadPct([{ days: 365, pct: 1 }], 366), 0);
  assert.equal(exitLoadPct([], 1), 0);
  assert.equal(exitLoadPct(undefined, 1), null);
});

test('previewSale: oldest units go first, with load, tax and money in hand', () => {
  const ledger = replayLots([{ date: '2024-01-01', units: 10, amount: 1000 }, { date: '2026-11-01', units: 10, amount: 1000 }]);
  const r = previewSale({ ledger, nav: 200, units: 15, date: '2026-11-20', taxClass: 'equity', exitLoad: [{ days: 365, pct: 1 }] });
  assert.equal(r.ok, true);
  near(r.exitLoad, 10); // 1% of the 5 new units
  near(r.buckets.equityLT, 1000);
  near(r.buckets.equityST, 490);
  near(r.tax, 490 * 0.208);
  near(r.inHand, 3000 - 10 - r.tax);
  assert.equal(r.nextLongTerm, '2027-11-02');
  near(ledger.units, 20); // the preview changes nothing
  assert.equal(previewSale({ ledger, nav: 200, units: 25, date: '2026-11-20', taxClass: 'equity' }).ok, false);
  assert.equal(previewSale({ ledger, nav: 200, amount: 400, date: '2026-11-20', taxClass: 'equity' }).exitLoadKnown, false);
});

test('parseTransactions: positions come from the history; unknown funds and partial statements are refused', () => {
  const base = { funds: [A], today: '2026-11-20' };
  const file = (transactions) => ({ source: 'transactions', asOf: '2026-11-19', transactions });
  const ok = parseTransactions(file([
    { isin: 'INF000A', date: '2025-01-01', units: 10, amount: 100, type: 'buy' },
    { key: 'A', date: '2026-01-01', units: 4, amount: 60, type: 'sell' },
  ]), base);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.positions, { A: { units: 6, avgCost: 10 } });
  assert.match(parseTransactions(file([{ isin: 'NOPE', date: '2025-01-01', units: 1, amount: 1 }]), base).error, /Unknown fund NOPE/);
  assert.match(parseTransactions(file([{ key: 'A', date: '2025-01-01', units: -1, amount: 1 }]), base).error, /first purchase/);
  const twice = { ...base, funds: [A, { ...A, key: 'A2', group: 'other' }] };
  assert.match(parseTransactions(file([{ isin: 'INF000A', date: '2025-01-01', units: 1, amount: 1 }]), twice).error, /two places/);
  assert.equal(parseTransactions(file([{ isin: 'INF000A', group: 'other', date: '2025-01-01', units: 1, amount: 1 }]), twice).ok, true);
});

test('asset and tax class come from the file first, then the category and name', () => {
  assert.equal(assetOf(A), 'equity');
  assert.equal(assetOf({ ...A, category: 'Debt' }), 'debt');
  const intl = { ...A, name: 'Mirae Asset Global X AI & Tech ETF FoF' };
  assert.equal(assetOf(intl), 'international');
  assert.equal(taxClassOf(intl), 'other');
  assert.equal(assetOf({ ...A, name: 'Some Gold Fund' }), 'gold');
  assert.equal(taxClassOf(A, { A: { taxClass: 'other' } }), 'other');
});

test('computeAssetMix: gap to target and the daily amount that would close it', () => {
  const debt = { ...A, key: 'D', category: 'Debt' };
  const mix = computeAssetMix({ rows: [{ ...A, value: 900 }, { ...debt, value: 100 }], funds: [A, debt], targets: { equity: 50, debt: 50 } });
  const d = mix.classes.find((c) => c.key === 'debt');
  near(d.pct, 10);
  near(d.gap, 400);
  near(d.perDay, (0.5 * 1000 - 100) / 0.5 / 250);
  assert.equal(mix.classes.find((c) => c.key === 'equity').perDay, null);
});

test('computeFees, computeDrawdowns', () => {
  const rows = [{ ...A, value: 10000 }, { ...A, key: 'B', short: 'Beta', value: 5000 }];
  const fees = computeFees({ rows, info: { A: { ter: 0.5, asOf: '2026-11-01' } } });
  near(fees.yearly, 50);
  assert.deepEqual(fees.missing, ['Beta']);
  const dd = computeDrawdowns({ rows: [A], navByCode: { 1: [['2026-01-01', 10], ['2026-06-01', 20], ['2026-11-01', 15]] } });
  near(dd.A.pct, -25);
  assert.equal(dd.A.peakDate, '2026-06-01');
});

test('monthlyChanges splits a month into market movement and money added', () => {
  const m = monthlyChanges({ dates: ['2026-10-30', '2026-11-02', '2026-11-03'], value: [1000, 1110, 1200], day: [0, 10, -5], constantBefore: '2026-10-01' });
  assert.equal(m.length, 1);
  near(m[0].market, 5);
  near(m[0].added, 195);
  assert.equal(m[0].partial, false);
});

test('checkSips flags units that did not arrive', () => {
  const series = ['02', '03', '04', '05', '06'].map((d) => [`2026-11-${d}`, 10]);
  const snaps = (units) => [{ date: '2026-11-01', positions: { A: { units: 100 } } }, { date: '2026-11-06', positions: { A: { units } } }];
  const base = { funds: [A], navByCode: { 1: series }, sipPlan: { A: 100 } };
  assert.equal(checkSips({ ...base, snapshots: snaps(150) })[0].isShort, false);
  assert.equal(checkSips({ ...base, snapshots: snaps(130) })[0].isShort, false, 'two days late is normal');
  assert.equal(checkSips({ ...base, snapshots: snaps(110) })[0].isShort, true);
});

test('parseFundInfo and checkTargets', () => {
  const ok = parseFundInfo({ asOf: '2026-11-01', funds: { INF000A: { ter: 0.6, exitLoad: [{ days: 365, pct: 1 }] } } }, { funds: [A] });
  assert.deepEqual(ok.funds.A, { asOf: '2026-11-01', ter: 0.6, exitLoad: [{ days: 365, pct: 1 }] });
  assert.equal(parseFundInfo({ asOf: '2026-11-01', funds: { X: {} } }, { funds: [A] }).ok, false);
  assert.equal(checkTargets({ equity: '70', debt: '20' }, 30).ok, false);
  assert.deepEqual(checkTargets({ equity: '80', debt: '20' }, 30).mix, { equity: 80, international: 0, debt: 20, gold: 0 });
  assert.equal(checkTargets({}, 30).mix, null);
});

test('buildHistoryWrites: a snapshot of the closing units, counted as a CAS only for outside funds and never backwards', () => {
  const parsed = { owner: 'Kruti', asOf: '2026-11-19', histories: [{ key: 'A', items: [] }], positions: {}, groups: ['other'] };
  const w = buildHistoryWrites({ parsed });
  assert.equal(w.snapshot.id, 'snap_2026-11-19_history_Kruti');
  assert.equal(w.snapshot.data.owner, 'Kruti');
  assert.equal(w.syncKey, 'cas:Kruti');
  assert.equal(buildHistoryWrites({ parsed: { ...parsed, groups: ['zerodha'] } }).syncKey, null);
  assert.equal(buildHistoryWrites({ parsed, state: { lastSync: { 'cas:Kruti': { date: '2026-11-25' } } } }).syncKey, null);
});

test('previewSale: a free-unit allowance cuts the load only on units still inside the load period', () => {
  const ledger = replayLots([{ date: '2024-01-01', units: 10, amount: 1000 }, { date: '2026-11-01', units: 20, amount: 2000 }]);
  const base = { ledger, nav: 200, date: '2026-11-20', taxClass: 'equity', exitLoad: [{ days: 365, pct: 1 }], freePct: 10 };
  const r = previewSale({ ...base, units: 15 });
  near(r.freeUnits, 2); // 10% of the 20 new units
  near(r.exitLoad, (5 - 2) * 200 * 0.01);
  near(previewSale({ ...base, units: 11 }).exitLoad, 0);
  near(previewSale({ ...base, units: 10 }).freeUnits, 0);
});

test('previewSale: locked-in units cannot be redeemed', () => {
  const ledger = replayLots([{ date: '2023-01-10', units: 10, amount: 1000 }, { date: '2025-01-10', units: 5, amount: 500 }]);
  const base = { ledger, nav: 200, date: '2026-11-20', taxClass: 'equity', exitLoad: [], lockInMonths: 36 };
  const r = previewSale({ ...base, units: 10 });
  near(r.lockedUnits, 5);
  assert.equal(r.nextUnlock, '2028-01-10');
  assert.match(previewSale({ ...base, units: 11 }).error, /Only 10 units are out of the lock-in/);
  assert.match(previewSale({ ...base, units: 1, date: '2025-06-01' }).error, /All units are locked in/);
});

test('lock-in comes from the file, else three years for a tax saver; free units and lock-in are validated', () => {
  const elss = { ...A, name: 'Mirae Asset ELSS Tax Saver Fund' };
  assert.equal(lockInMonthsOf(elss), 36);
  assert.equal(lockInMonthsOf(A), 0);
  assert.equal(lockInMonthsOf(elss, { A: { lockInMonths: 0 } }), 0);
  const ok = parseFundInfo({ asOf: '2026-11-01', funds: { A: { freePct: 10, lockInMonths: 36 } } }, { funds: [A] });
  assert.deepEqual(ok.funds.A, { asOf: '2026-11-01', freePct: 10, lockInMonths: 36 });
  assert.equal(parseFundInfo({ asOf: '2026-11-01', funds: { A: { freePct: 200 } } }, { funds: [A] }).ok, false);
});
