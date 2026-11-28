import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIsoDate,
  limitLabel,
  daysBetween,
  addDaysISO,
  previousWeekday,
  formatShortDate,
  classifySync,
  classifyMonthlySync,
  isoFromApiDate,
  parseMfapiHistory,
  indexOnOrBefore,
  navOnOrBefore,
  buildNavByCode,
  planNavFetch,
  newNavPointsByYear,
  latestPositions,
  estimateHolding,
  computePortfolio,
  computeHistory,
  parseImport,
  diffForPreview,
  computeOverlap,
  formatRupeesCompact,
  buildTrade,
  syncNudges,
  normalizeSipSchedule,
  sipPlanAt,
  sipAmountFn,
  applySipChange,
  computeMetrics,
  evaluateLimits,
  limitNudges,
  DEFAULT_LIMITS,
  projectRows,
  simulateSip,
  periodReturnPct,
  computeBenchmarkTable,
  sliceHistory,
  computeAllocation,
  computeRelativeLines,
  DEFAULT_OWNER,
  ownerOf,
  ownersOf,
  fundsForView,
  planForFunds,
  lastSyncKey,
  computeSyncStatus,
  mergeCatalog,
  mergeOverlap,
  mergeSipPlan,
  snapshotId,
  buildImportWrites,
  isStock,
  projectCorpus,
  summariseProjection,
  inTodaysMoney,
  holdingsToCsv,
  nudgeTarget,
} from '../lib/portfolio.js';

// Two made-up funds, nothing here is real data.
const FUNDS = [
  { key: 'A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', amc: 'Alp', group: 'zerodha', category: 'Diversified', holdingsKey: 'A' },
  { key: 'B', isin: 'INF000B', schemeCode: '2', name: 'Beta Fund', short: 'Beta', amc: 'Bet', group: 'other', category: 'Thematic', holdingsKey: 'B' },
];
const NAV = {
  1: [['2026-11-17', 10], ['2026-11-18', 11], ['2026-11-19', 12], ['2026-11-20', 13]],
  2: [['2026-11-17', 100], ['2026-11-18', 100], ['2026-11-19', 110], ['2026-11-20', 120]],
};
const SNAP = [{ date: '2026-11-18', source: 'kite', positions: { A: { units: 100, avgCost: 8 }, B: { units: 10, avgCost: 90 } } }];

test('dates: validation, differences, weekdays and the short style', () => {
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2026-11-21'), true);
  assert.equal(daysBetween('2026-11-18', '2026-11-21'), 3);
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(previousWeekday('2026-11-23'), '2026-11-20', 'Monday -> the Friday before');
  assert.equal(previousWeekday('2026-11-22'), '2026-11-20', 'Sunday -> Friday');
  assert.equal(previousWeekday('2026-11-24'), '2026-11-23');
  assert.equal(formatShortDate('2026-10-08'), '8 Oct');
  assert.equal(formatShortDate('nope'), '');
});

test('classifySync: fresh up to a day, stale up to a week, then old', () => {
  assert.deepEqual(classifySync(null, '2026-11-22'), { level: 'never', days: null, label: 'Never synced' });
  assert.deepEqual(classifySync('2026-11-22', '2026-11-22'), { level: 'fresh', days: 0, label: 'today' });
  assert.equal(classifySync('2026-11-21', '2026-11-22').label, 'yesterday');
  assert.equal(classifySync('2026-11-20', '2026-11-22').level, 'stale');
  assert.equal(classifySync('2026-11-15', '2026-11-22').level, 'stale');
  assert.equal(classifySync('2026-11-14', '2026-11-22').level, 'old');
});

test('mfapi history is parsed to ascending ISO series and bad rows are dropped', () => {
  assert.equal(isoFromApiDate('20-11-2026'), '2026-11-20');
  assert.equal(isoFromApiDate('2026-11-20'), null);
  const rows = [{ date: '20-11-2026', nav: '13.50000' }, { date: '19-11-2026', nav: 'x' }, { date: 'bad', nav: '1' }, { date: '18-11-2026', nav: '12' }];
  assert.deepEqual(parseMfapiHistory(rows), [['2026-11-18', 12], ['2026-11-20', 13.5]]);
  assert.deepEqual(parseMfapiHistory(null), []);
});

test('indexOnOrBefore and navOnOrBefore find the price in force on a date', () => {
  const s = NAV[1];
  assert.equal(indexOnOrBefore(s, '2026-11-16'), -1);
  assert.equal(indexOnOrBefore(s, '2026-11-18'), 1);
  assert.equal(indexOnOrBefore(s, '2026-11-21'), 3, 'a weekend uses Friday');
  assert.deepEqual(navOnOrBefore(s, '2026-11-19'), ['2026-11-19', 12]);
  assert.equal(navOnOrBefore(s, '2026-01-01'), null);
});

test('buildNavByCode folds per-year documents into one ascending series per scheme', () => {
  const docs = {
    nav_1_2025: { schemeCode: '1', year: 2025, series: { '2025-12-31': 9 } },
    nav_1_2026: { schemeCode: '1', year: 2026, series: { '2026-01-02': 9.5, '2026-01-01': 9.2 } },
    state: { lastSnapshotDate: '2026-11-18' },
  };
  assert.deepEqual(buildNavByCode(docs), { 1: [['2025-12-31', 9], ['2026-01-01', 9.2], ['2026-01-02', 9.5]] });
});

test('planNavFetch asks only for what is missing and de-duplicates a scheme held twice', () => {
  const funds = [...FUNDS, { key: 'A2', schemeCode: '1' }];
  // Today is Mon 23 Nov: the NAV that should exist is Friday 20 Nov. Scheme 1 has it, scheme 2 does not.
  const navByCode = { 1: NAV[1], 2: [['2026-11-18', 100]] };
  assert.deepEqual(planNavFetch(funds, navByCode, '2026-11-23'), [{ schemeCode: '2', from: '2026-11-19', last: '2026-11-18' }]);
  // Nothing stored: ask for the history window.
  assert.deepEqual(planNavFetch([FUNDS[0]], {}, '2026-11-23', 10), [{ schemeCode: '1', from: '2026-11-13', last: null }]);
  assert.deepEqual(planNavFetch([{ key: 'x' }], {}, '2026-11-23'), [], 'a fund with no scheme code is skipped');
});

test('planNavFetch: a manual check asks for anything newer than stored, not just up to the previous weekday', () => {
  // Sunday 22 Nov: the newest NAV that should exist is Friday 20 Nov, which scheme 1 already has.
  const navByCode = { 1: NAV[1], 2: NAV[2] };
  assert.deepEqual(planNavFetch(FUNDS, navByCode, '2026-11-22'), [], 'the automatic check has nothing to do');
  assert.deepEqual(
    planNavFetch(FUNDS, navByCode, '2026-11-22', 400, '2026-11-22').map((p) => [p.schemeCode, p.from]),
    [['1', '2026-11-21'], ['2', '2026-11-21']],
    'a manual check looks from the day after what is stored',
  );
  // A scheme already holding today's NAV is skipped even by a manual check.
  assert.deepEqual(planNavFetch([FUNDS[0]], { 1: [...NAV[1], ['2026-11-22', 14]] }, '2026-11-22', 400, '2026-11-22'), []);
});

test('newNavPointsByYear keeps only new dates, grouped by year', () => {
  const series = [['2025-12-31', 1], ['2026-01-02', 2], ['2026-01-03', 3], ['2026-11-30', 4]];
  const { byYear, count } = newNavPointsByYear(series, '2026-01-01', '2026-06-01');
  assert.deepEqual(byYear, { 2026: { '2026-01-02': 2, '2026-01-03': 3 } });
  assert.equal(count, 2);
});

test('latestPositions: a later snapshot overrides only the funds it lists', () => {
  const snaps = [
    { date: '2026-11-10', source: 'cas', positions: { A: { units: 1, avgCost: 5 }, B: { units: 2, avgCost: 6 } } },
    { date: '2026-11-18', source: 'kite', positions: { A: { units: 3, avgCost: 7 } } },
  ];
  const p = latestPositions(snaps);
  assert.deepEqual(p.A, { units: 3, avgCost: 7, date: '2026-11-18', source: 'kite' });
  assert.deepEqual(p.B, { units: 2, avgCost: 6, date: '2026-11-10', source: 'cas' });
});

test('estimateHolding adds the daily SIP after the snapshot date, in units and in cost', () => {
  const pos = { units: 100, avgCost: 8, date: '2026-11-18' };
  // 19 Nov at 12 and 20 Nov at 13 with Rs 120 a day: 10 + 120/13 units.
  const h = estimateHolding(pos, NAV[1], 120, '2026-11-20');
  assert.ok(Math.abs(h.units - (100 + 120 / 12 + 120 / 13)) < 1e-9);
  assert.equal(h.cost, 800 + 240);
  assert.equal(h.estimated, true);
  assert.equal(h.sipDays, 2);
  const none = estimateHolding(pos, NAV[1], 0, '2026-11-20');
  assert.deepEqual([none.units, none.estimated], [100, false]);
  assert.equal(estimateHolding(null, NAV[1], 120, '2026-11-20'), null);
});

test('computePortfolio: value, total P&L, day P&L from the previous close, shares and group totals', () => {
  const p = computePortfolio({ funds: FUNDS, snapshots: SNAP, navByCode: NAV, sipPlan: {} });
  const a = p.rows.find((r) => r.key === 'A');
  const b = p.rows.find((r) => r.key === 'B');
  assert.equal(a.value, 1300); // 100 x 13
  assert.equal(a.pnl, 500); // 1300 - 100 x 8
  assert.equal(a.day, 100); // 100 x (13 - 12)
  assert.equal(b.value, 1200); // 10 x 120
  assert.equal(b.day, 100); // 10 x (120 - 110)
  assert.equal(p.total.value, 2500);
  assert.equal(p.total.cost, 800 + 900);
  assert.equal(p.total.pnl, 800);
  assert.equal(p.total.day, 200);
  assert.ok(Math.abs(p.total.dayPct - (200 / 2300) * 100) < 1e-9);
  assert.ok(Math.abs(a.share + b.share - 100) < 1e-9);
  assert.equal(p.byGroup.zerodha.value, 1300);
  assert.equal(p.byGroup.other.value, 1200);
  assert.equal(p.navDate, '2026-11-20');
  assert.deepEqual(p.rows.map((r) => r.key), ['A', 'B'], 'largest first');
  assert.equal(p.estimatedCount, 0);
});

test('computePortfolio: SIP-estimated units count in the value but not in the day P&L of their own day', () => {
  const p = computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipPlan: { A: 130 } });
  const a = p.rows[0];
  // Units bought on 19 Nov (130/12) are held at the 19 -> 20 move; the 20 Nov purchase (130/13 = 10) is not.
  const unitsBeforeToday = 100 + 130 / 12;
  assert.ok(Math.abs(a.day - unitsBeforeToday * 1) < 1e-9);
  assert.equal(a.estimated, true);
  assert.equal(a.sipDays, 2);
  assert.ok(Math.abs(a.value - (100 + 130 / 12 + 10) * 13) < 1e-9);
});

test('computePortfolio skips a fund with no position or no NAVs yet', () => {
  assert.equal(computePortfolio({ funds: FUNDS, snapshots: SNAP, navByCode: { 1: NAV[1] } }).rows.length, 1);
  assert.equal(computePortfolio({ funds: FUNDS, snapshots: [], navByCode: NAV }).rows.length, 0);
});

test('computeHistory: units are held at the first snapshot before it, and SIP units build up after it', () => {
  const h = computeHistory({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipPlan: {}, days: 10 });
  assert.deepEqual(h.dates, ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual(h.value, [1000, 1100, 1200, 1300]); // 100 units throughout
  assert.deepEqual(h.day, [0, 100, 100, 100]);
  assert.equal(h.constantBefore, '2026-11-18');
  const withSip = computeHistory({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipPlan: { A: 120 }, days: 10 });
  // 19 Nov adds 10 units (120/12); the day P&L of 19 Nov still uses the 100 units held at the 18th close.
  assert.ok(Math.abs(withSip.value[2] - 110 * 12) < 1e-9);
  assert.ok(Math.abs(withSip.day[2] - 100 * 1) < 1e-9);
});

test('computeHistory ignores weekend-only dates and returns nothing without data', () => {
  const navs = { 1: [...NAV[1], ['2026-11-21', 13]], 2: NAV[2] }; // only one of two funds priced on Saturday
  const h = computeHistory({ funds: FUNDS, snapshots: SNAP, navByCode: navs, days: 10 });
  assert.ok(!h.dates.includes('2026-11-21') || h.dates.length >= 4);
  assert.deepEqual(computeHistory({ funds: FUNDS, snapshots: [], navByCode: NAV }).dates, []);
});

test('parseImport: Kite holdings map ISIN to the Zerodha fund and are stamped with the as-of date', () => {
  const kite = JSON.stringify([{ tradingsymbol: 'INF000A', quantity: 123.456, average_price: 9.5 }]);
  // A second Zerodha fund that is not in this Kite list is reported, not treated as sold.
  const funds = [...FUNDS, { key: 'C', isin: 'INF000C', schemeCode: '3', name: 'Gamma Fund', short: 'Gamma', group: 'zerodha' }];
  const r = parseImport(kite, { catalog: { funds }, asOfDefault: '2026-11-21', today: '2026-11-22' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload.positions, { A: { units: 123.456, avgCost: 9.5 } });
  assert.equal(r.payload.source, 'kite');
  assert.equal(r.payload.asOf, '2026-11-21');
  assert.match(r.warnings[0], /Not in this Kite list/);
});

test('parseImport: an ISIN held in two places goes to the Zerodha one for a Kite list', () => {
  const funds = [...FUNDS, { key: 'A_other', isin: 'INF000A', schemeCode: '1', name: 'Alpha (elsewhere)', group: 'other' }];
  const kite = JSON.stringify([{ tradingsymbol: 'INF000A', quantity: 5, average_price: 1 }]);
  const r = parseImport(kite, { catalog: { funds }, asOfDefault: '2026-11-21', today: '2026-11-22' });
  assert.deepEqual(Object.keys(r.payload.positions), ['A']);
});

test('parseImport: a setup object carries its own catalog, overlap and SIP plan', () => {
  const text = JSON.stringify({
    asOf: '2026-11-21',
    source: 'cas',
    catalog: { funds: FUNDS },
    overlap: { holdings: {} },
    sipPlan: { A: 1100 },
    positions: [{ key: 'A', units: 1, avgCost: 2 }, { key: 'B', units: 3, avgCost: 4 }],
  });
  const r = parseImport(text, { catalog: null, today: '2026-11-22' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.payload.positions), ['A', 'B']);
  assert.deepEqual(r.payload.sipPlan, { A: 1100 });
});

test('parseImport: clear errors for bad input', () => {
  const ctx = { catalog: { funds: FUNDS }, asOfDefault: '2026-11-21', today: '2026-11-22' };
  assert.match(parseImport('{nope', ctx).error, /not valid JSON/);
  assert.match(parseImport('[]', ctx).error, /No holdings/);
  assert.match(parseImport(JSON.stringify([{ tradingsymbol: 'INF999', quantity: 1, average_price: 1 }]), ctx).error, /Unknown fund INF999/);
  assert.match(parseImport(JSON.stringify([{ tradingsymbol: 'INF000A', quantity: -1, average_price: 1 }]), ctx).error, /Bad units/);
  assert.match(parseImport(JSON.stringify({ asOf: '2027-01-01', positions: [] }), ctx).error, /future/);
  assert.match(parseImport(JSON.stringify({ asOf: 'x', positions: [] }), ctx).error, /as-of date/);
  assert.match(parseImport('[]', { asOfDefault: '2026-11-21', today: '2026-11-22' }).error, /No fund list/);
});

test('diffForPreview reports how far the SIP estimate was from the new snapshot', () => {
  const rows = diffForPreview({
    funds: FUNDS,
    snapshots: SNAP,
    navByCode: NAV,
    sipPlan: { A: 120 },
    next: { A: { units: 125, avgCost: 8.1 } },
    asOf: '2026-11-20',
  });
  assert.equal(rows.length, 1);
  const estimated = 100 + 120 / 12 + 120 / 13;
  assert.ok(Math.abs(rows[0].estimatedUnits - estimated) < 1e-9);
  assert.ok(Math.abs(rows[0].drift - (125 - estimated)) < 1e-9);
  assert.equal(rows[0].prevUnits, 100);
  const first = diffForPreview({ funds: FUNDS, snapshots: [], navByCode: NAV, next: { B: { units: 1, avgCost: 1 } }, asOf: '2026-11-20' });
  assert.equal(first[0].isNew, true);
  assert.equal(first[0].drift, null);
});

test('computeOverlap: group exposure, shared stocks, pairs, and a fund held in two places counted once per key', () => {
  const rows = [
    { key: 'A', holdingsKey: 'A', short: 'Alpha', value: 1000 },
    { key: 'B', holdingsKey: 'B', short: 'Beta', value: 500 },
    { key: 'B2', holdingsKey: 'B', short: 'Beta', value: 500 }, // same fund, second account
  ];
  const overlap = {
    holdings: { A: { X: 10, Y: 5 }, B: { X: 20, Z: 4 } },
    names: { X: 'X Corp' },
    groups: { adani: ['X'] },
    futures: [{ fund: 'A', name: 'X futures', weight: 10 }],
  };
  const o = computeOverlap(overlap, rows);
  assert.equal(o.total, 2000);
  // X: 1000 x 10% + 1000 x 20% = 300
  assert.equal(o.adani.total, 300);
  assert.equal(o.adani.pct, 15);
  assert.deepEqual(o.adani.byStock, [{ stock: 'X', name: 'X Corp', value: 300 }]);
  assert.deepEqual(o.adani.byFund.map((f) => [f.fund, f.value]), [['Beta', 200], ['Alpha', 100]]);
  assert.equal(o.adani.futures[0].value, 100, 'futures are shown but kept out of the total');
  assert.equal(o.shared.length, 1);
  assert.deepEqual(o.shared[0].funds.sort(), ['Alpha', 'Beta']);
  assert.deepEqual(o.pairs, [{ a: 'Alpha', b: 'Beta', pct: 10 }]); // min(10, 20) on X
});

test('formatRupeesCompact reads in lakh and crore', () => {
  assert.equal(formatRupeesCompact(5421351), '₹54.2L');
  assert.equal(formatRupeesCompact(250000), '₹2.50L');
  assert.equal(formatRupeesCompact(15000000), '₹1.50Cr');
  assert.equal(formatRupeesCompact(12500), '₹13k');
  assert.equal(formatRupeesCompact(950), '₹950');
  assert.equal(formatRupeesCompact(-164000), '-₹1.64L');
  assert.equal(formatRupeesCompact(-45000), '-₹45k');
});

// ---------- recorded trades ----------

const POS = { units: 100, avgCost: 8, date: '2026-11-18' };

test('estimateHolding: a recorded purchase adds units and cost after the snapshot date', () => {
  const h = estimateHolding(POS, NAV[1], 0, '2026-11-20', [{ fundKey: 'A', kind: 'buy', date: '2026-11-19', units: 5, amount: 60 }]);
  assert.equal(h.units, 105);
  assert.equal(h.cost, 860);
  assert.equal(h.tradeCount, 1);
  assert.equal(h.estimated, true);
});

test('estimateHolding: a sale takes units out at the running average cost, leaving the average unchanged', () => {
  const h = estimateHolding(POS, NAV[1], 0, '2026-11-20', [{ fundKey: 'A', kind: 'sell', date: '2026-11-19', units: 20, amount: 240 }]);
  assert.equal(h.units, 80);
  assert.equal(h.cost, 640); // 800 - 20 x 8
  assert.equal(h.avgCost, 8);
  const all = estimateHolding(POS, NAV[1], 0, '2026-11-20', [{ fundKey: 'A', kind: 'sell', date: '2026-11-19', units: 500, amount: 0 }]);
  assert.deepEqual([all.units, all.cost], [0, 0], 'a sale larger than the holding stops at zero');
});

test('estimateHolding: trades dated on or before the snapshot are already in it', () => {
  const trades = [
    { fundKey: 'A', kind: 'buy', date: '2026-11-18', units: 5, amount: 60 },
    { fundKey: 'A', kind: 'buy', date: '2026-11-17', units: 5, amount: 60 },
  ];
  assert.equal(estimateHolding(POS, NAV[1], 0, '2026-11-20', trades).units, 100);
});

test('computePortfolio: recorded trades change the holding, and the day P&L uses what was held the day before', () => {
  const sell = [{ fundKey: 'A', kind: 'sell', date: '2026-11-20', units: 20, amount: 260 }];
  const p = computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, trades: sell });
  const a = p.rows[0];
  assert.equal(a.units, 80);
  assert.equal(a.value, 1040);
  assert.equal(a.pnl, 400); // 1040 - 640
  assert.equal(a.day, 100, 'the 20th sale does not reduce the 19th -> 20th move');
  assert.equal(a.tradeCount, 1);
  // A trade dated after the newest NAV still counts today.
  const later = computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, trades: [{ fundKey: 'A', kind: 'buy', date: '2026-11-21', units: 5, amount: 65 }] });
  assert.equal(later.rows[0].units, 105);
  // A trade for another fund is ignored.
  assert.equal(computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, trades: [{ fundKey: 'B', kind: 'buy', date: '2026-11-20', units: 5, amount: 600 }] }).rows[0].units, 100);
});

test('computeHistory: a trade changes the units from its date', () => {
  const h = computeHistory({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, trades: [{ fundKey: 'A', kind: 'buy', date: '2026-11-19', units: 5, amount: 60 }], days: 10 });
  assert.deepEqual(h.value, [1000, 1100, 105 * 12, 105 * 13]);
  assert.deepEqual(h.day, [0, 100, 100, 105]);
});

test('diffForPreview counts recorded trades in the estimate it compares against', () => {
  const rows = diffForPreview({
    funds: FUNDS,
    snapshots: SNAP,
    navByCode: NAV,
    trades: [{ fundKey: 'A', kind: 'sell', date: '2026-11-19', units: 20, amount: 240 }],
    next: { A: { units: 80, avgCost: 8 } },
    asOf: '2026-11-20',
  });
  assert.equal(rows[0].estimatedUnits, 80);
  assert.equal(rows[0].drift, 0);
});

test('buildTrade: units come from the amount and the NAV on or before the date, and the reverse', () => {
  const ctx = { funds: FUNDS, navByCode: NAV, today: '2026-11-22' };
  const byAmount = buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-11-20', amount: 1300 });
  assert.deepEqual(byAmount.trade, { fundKey: 'A', kind: 'buy', date: '2026-11-20', units: 100, amount: 1300 });
  assert.deepEqual(byAmount.nav, { date: '2026-11-20', value: 13 });
  const weekend = buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-11-21', amount: 130 });
  assert.equal(weekend.trade.units, 10, 'a Saturday uses Friday NAV');
  const byUnits = buildTrade({ ...ctx, fundKey: 'A', kind: 'sell', date: '2026-11-19', units: 10 });
  assert.equal(byUnits.trade.amount, 120);
  const both = buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-11-19', units: 9.5, amount: 100 });
  assert.deepEqual([both.trade.units, both.trade.amount], [9.5, 100], 'typed values win over the NAV');
});

test('buildTrade: clear errors', () => {
  const ctx = { funds: FUNDS, navByCode: NAV, today: '2026-11-22' };
  assert.match(buildTrade({ ...ctx, fundKey: 'Z', kind: 'buy', date: '2026-11-20', amount: 1 }).error, /Pick a fund/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'hold', date: '2026-11-20', amount: 1 }).error, /bought or sold/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: 'x', amount: 1 }).error, /date/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-11-23', amount: 1 }).error, /future/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-11-20' }).error, /amount or the units/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-01-01', amount: 100 }).error, /no NAV/);
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'buy', date: '2026-01-01', units: 1 }).error, /no NAV/);
  assert.equal(buildTrade({ ...ctx, fundKey: 'A', kind: 'sell', date: '2026-01-01', units: 1 }).trade.amount, 0, 'a sale with no NAV keeps the typed units');
  assert.match(buildTrade({ ...ctx, fundKey: 'A', kind: 'sell', date: '2026-11-20', units: 50, heldUnits: 40 }).error, /fewer than this sale/);
  assert.equal(buildTrade({ ...ctx, fundKey: 'A', kind: 'sell', date: '2026-11-20', units: 40, heldUnits: 40 }).ok, true);
});

test('classifyMonthlySync: due from the 1st until a CAS is dated or imported that month', () => {
  assert.deepEqual(classifyMonthlySync(null, null, '2026-12-01'), { level: 'never', days: null, label: 'Never synced', due: false });
  const sameMonth = classifyMonthlySync('2026-11-01', null, '2026-11-30');
  assert.deepEqual([sameMonth.level, sameMonth.due], ['fresh', false]);
  const firstOfNext = classifyMonthlySync('2026-11-30', null, '2026-12-01');
  assert.deepEqual([firstOfNext.level, firstOfNext.due], ['stale', true]);
  assert.equal(classifyMonthlySync('2026-11-30', '2026-12-02', '2026-12-20').due, false, 'last month\'s statement imported this month counts');
  assert.equal(classifyMonthlySync('2026-12-31', null, '2027-01-01').due, true, 'across a year end');
});

test('syncNudges: Kite after a week, CAS once a month, nothing before setup', () => {
  const sync = (kite, cas) => ({ kite: { level: kite[0], days: kite[1] }, cas: { level: cas[0], days: cas[1], due: cas[2] === true } });
  assert.deepEqual(syncNudges({ hasSetup: false, sync: sync(['never', null], ['never', null]) }), []);
  assert.deepEqual(syncNudges({ hasSetup: true, sync: sync(['fresh', 0], ['stale', 20]) }), []);
  assert.deepEqual(syncNudges({ hasSetup: true, sync: sync(['stale', 5], ['never', null]) }), [], 'up to a week is covered by SIP estimates');
  const old = syncNudges({ hasSetup: true, sync: sync(['old', 9], ['stale', 40, true]) });
  assert.deepEqual(old.map((n) => n.key), ['kite', 'cas']);
  assert.match(old[0].text, /9 days ago/);
  assert.match(old[1].text, /40 days ago/);
  assert.match(syncNudges({ hasSetup: true, sync: sync(['never', null], ['never', null]) })[0].text, /not been synced/);
});

// ---------- SIP schedule ----------

test('SIP schedule: a legacy plan is one entry that always applied, and a dated change only affects later days', () => {
  assert.deepEqual(normalizeSipSchedule({ plan: { A: 100 } }), [{ from: '0000-01-01', plan: { A: 100 } }]);
  assert.deepEqual(normalizeSipSchedule(null), []);
  const sched = normalizeSipSchedule({ schedule: [{ from: '2026-11-20', plan: { A: 200 } }, { from: '2026-01-01', plan: { A: 100 } }] });
  assert.deepEqual(sched.map((e) => e.from), ['2026-01-01', '2026-11-20'], 'sorted by date');
  assert.deepEqual(sipPlanAt(sched, '2025-12-31'), {}, 'before the first entry there is no plan');
  assert.deepEqual(sipPlanAt(sched, '2026-11-19'), { A: 100 });
  assert.deepEqual(sipPlanAt(sched, '2026-11-20'), { A: 200 });
  const amount = sipAmountFn({}, sched, 'A');
  assert.deepEqual([amount('2026-11-19'), amount('2026-11-20'), amount('2027-01-01')], [100, 200, 200]);
  assert.equal(sipAmountFn({ A: 50 }, null, 'A')('2026-11-19'), 50, 'with no schedule the plain plan is constant');
  assert.equal(sipAmountFn({}, null, 'A')('2026-11-19'), 0);
});

test('applySipChange: replaces the same date, drops zero amounts and keeps earlier entries', () => {
  const base = [{ from: '0000-01-01', plan: { A: 100, B: 50 } }];
  const next = applySipChange(base, '2026-11-20', { A: '200', B: 0, C: 'x' });
  assert.deepEqual(next, [{ from: '0000-01-01', plan: { A: 100, B: 50 } }, { from: '2026-11-20', plan: { A: 200 } }]);
  const again = applySipChange(next, '2026-11-20', { A: 300 });
  assert.equal(again.length, 2);
  assert.deepEqual(again[1].plan, { A: 300 });
  assert.deepEqual(base, [{ from: '0000-01-01', plan: { A: 100, B: 50 } }], 'the input is not changed');
});

test('estimateHolding and computeHistory follow a SIP that changed on a date', () => {
  const schedule = [{ from: '0000-01-01', plan: { A: 120 } }, { from: '2026-11-20', plan: { A: 260 } }];
  // 19 Nov at NAV 12 buys 120/12 = 10 units; 20 Nov at NAV 13 buys 260/13 = 20 units.
  const h = estimateHolding(POS, NAV[1], sipAmountFn({}, schedule, 'A'), '2026-11-20');
  assert.ok(Math.abs(h.units - 130) < 1e-9);
  assert.equal(h.cost, 800 + 120 + 260);
  const p = computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipSchedule: schedule });
  assert.ok(Math.abs(p.rows[0].units - 130) < 1e-9);
  const hist = computeHistory({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipSchedule: schedule, days: 10 });
  assert.ok(Math.abs(hist.value[3] - 130 * 13) < 1e-9);
  assert.ok(Math.abs(hist.day[3] - 110 * 1) < 1e-9, 'the 20th day P&L uses the 110 units held at the 19th close');
});

// ---------- limits, metrics, what-if ----------

const MROWS = [
  { key: 'A', holdingsKey: 'A', short: 'Alpha', amc: 'Q', category: 'Diversified', value: 1000 },
  { key: 'B', holdingsKey: 'B', short: 'Beta', amc: 'T', category: 'Thematic', value: 1000 },
];
const MOVERLAP = { holdings: { A: { X: 10, Y: 5 }, B: { X: 20, Z: 4 } }, names: { X: 'X Corp' }, groups: { adani: ['X'] } };

test('computeOverlap also lists every stock by exposure', () => {
  const o = computeOverlap(MOVERLAP, MROWS);
  assert.deepEqual(o.stocks.map((s) => [s.stock, s.value]), [['X', 300], ['Y', 50], ['Z', 40]]);
  assert.equal(o.stocks[0].pct, 15);
});

test('computeMetrics: Adani share, fund house and category shares, largest stock and fund', () => {
  const m = computeMetrics(MROWS, computeOverlap(MOVERLAP, MROWS));
  assert.equal(m.adaniPct, 15);
  assert.deepEqual(m.byAmc, { Q: 50, T: 50 });
  assert.deepEqual(m.byCategory, { Diversified: 50, Thematic: 50 });
  assert.deepEqual(m.maxStock, { name: 'X Corp', pct: 15 });
  assert.equal(m.maxFund.pct, 50);
  const noData = computeMetrics(MROWS, null);
  assert.equal(noData.adaniPct, null);
  assert.equal(noData.maxStock, null);
});

test('evaluateLimits: ok below 85%, near from 85% to the limit, breach above it', () => {
  const m = computeMetrics(MROWS, computeOverlap(MOVERLAP, MROWS));
  const ev = evaluateLimits(
    [
      { id: 'adani', metric: 'adani', max: 20 }, // 15 of 20 = 75%
      { id: 'amc-Q', metric: 'amc', name: 'Q', max: 40 }, // 50 of 40
      { id: 'stock', metric: 'stock', max: 15 }, // exactly at the limit
      { id: 'bad', metric: 'adani', max: 0 },
    ],
    m,
  );
  assert.deepEqual(ev.map((e) => [e.id, e.status]), [['adani', 'ok'], ['amc-Q', 'breach'], ['stock', 'near']]);
  assert.equal(ev[1].label, 'Q Funds');
  assert.equal(ev[2].detail, 'X Corp');
  const nudges = limitNudges(ev);
  assert.equal(nudges.length, 1);
  assert.match(nudges[0].text, /Q Funds is 50\.0% against your 40% limit/);
  assert.ok(DEFAULT_LIMITS.length >= 5);
});

test('simulateSip: more days of SIP at a plan move the shares, and a new fund is added from the catalog', () => {
  const funds = [
    { key: 'A', holdingsKey: 'A', short: 'Alpha', amc: 'Q', category: 'Diversified' },
    { key: 'B', holdingsKey: 'B', short: 'Beta', amc: 'T', category: 'Thematic' },
    { key: 'C', holdingsKey: 'C', short: 'Gamma', amc: 'G', category: 'Large cap' },
  ];
  const rows = projectRows({ rows: MROWS, funds, plan: { A: 10, C: 100 }, days: 10 });
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['A', 1100], ['B', 1000], ['C', 1000]]);
  const sim = simulateSip({ rows: MROWS, funds, overlapData: MOVERLAP, plan: { A: 10, C: 100 }, days: 10 });
  assert.equal(sim.metrics.total, 3100);
  assert.equal(sim.perDay, 110);
  assert.ok(Math.abs(sim.metrics.byAmc.Q - (1100 / 3100) * 100) < 1e-9);
  assert.equal(sim.metrics.byCategory['Large cap'] > 0, true);
});

// ---------- benchmark ----------

test('periodReturnPct: the return over a window, or null when the history does not reach back', () => {
  const series = [['2026-01-01', 100], ['2026-06-01', 110], ['2026-11-20', 121]];
  assert.ok(Math.abs(periodReturnPct(series, 91) - 10) < 1e-9);
  assert.ok(Math.abs(periodReturnPct(series, 30) - 10) < 1e-9);
  assert.ok(Math.abs(periodReturnPct(series, 182) - 21) < 1e-9);
  assert.equal(periodReturnPct(series, 365), null, 'only 11 months of history');
  assert.equal(periodReturnPct([['2026-01-01', 100]], 30), null);
});

test('computeBenchmarkTable: returns against the benchmark, one row per scheme, nothing invented without a benchmark', () => {
  const navByCode = { 1: [['2026-01-01', 100], ['2026-11-20', 120]], 2: [['2026-01-01', 100], ['2026-11-20', 105]], 9: [['2026-01-01', 100], ['2026-11-20', 110]] };
  const rows = [
    { key: 'A', schemeCode: '1', short: 'Alpha' },
    { key: 'A2', schemeCode: '1', short: 'Alpha (second folio)' },
    { key: 'B', schemeCode: '2', short: 'Beta' },
  ];
  const t = computeBenchmarkTable({ rows, navByCode, benchmarkCode: '9' });
  assert.equal(t.hasBenchmark, true);
  assert.equal(t.table.length, 2, 'a scheme held twice is listed once');
  assert.deepEqual(t.table.map((r) => r.key), ['A', 'B'], 'best against the benchmark first');
  assert.ok(Math.abs(t.table[0].vs['6M'] - 10) < 1e-9);
  assert.ok(Math.abs(t.table[1].vs['6M'] - -5) < 1e-9);
  assert.equal(t.table[0].vs['1Y'], null);
  const none = computeBenchmarkTable({ rows, navByCode: { 1: navByCode[1] }, benchmarkCode: '9' });
  assert.equal(none.hasBenchmark, false);
  assert.equal(none.table[0].vs['6M'], null);
  assert.ok(none.table[0].returns['6M'] > 0);
});

// ---------- projection and export ----------

test('projectCorpus: plain addition at 0%, a yearly step-up, and 12% a year compounding to 12% over a year', () => {
  const flat = projectCorpus({ start: 1000, monthlySip: 100, annualReturnPct: 0, years: 2 });
  assert.equal(flat[flat.length - 1].value, 3400);
  assert.equal(flat[flat.length - 1].invested, 3400);
  assert.deepEqual(flat.map((p) => p.year), [0, 1, 2]);
  const stepped = projectCorpus({ start: 1000, monthlySip: 100, annualReturnPct: 0, years: 2, stepUpPct: 10 });
  assert.ok(Math.abs(stepped[2].value - 3520) < 1e-9); // 1000 + 12 x 100 + 12 x 110
  const grown = projectCorpus({ start: 100, monthlySip: 0, annualReturnPct: 12, years: 1 });
  assert.ok(Math.abs(grown[1].value - 112) < 1e-9);
});

test('summariseProjection: value, what you put in versus growth, and the value in today\'s money', () => {
  const path = projectCorpus({ start: 1000, monthlySip: 100, annualReturnPct: 0, years: 2 });
  const flat = summariseProjection(path, 2, 6);
  assert.equal(flat.value, 3400);
  assert.equal(flat.invested, 3400);
  assert.equal(flat.growth, 0);
  assert.equal(flat.investedShare, 1);
  assert.ok(Math.abs(flat.real - 3400 / 1.06 ** 2) < 1e-9);
  const grown = summariseProjection(projectCorpus({ start: 100, monthlySip: 0, annualReturnPct: 12, years: 1 }), 1, 0);
  assert.ok(Math.abs(grown.growth - 12) < 1e-9);
  assert.ok(Math.abs(grown.investedShare - 100 / 112) < 1e-9);
  assert.equal(grown.real, grown.value); // no inflation: today's money is the same
  // a year the path does not reach, and an empty path, never throw or divide by zero
  assert.equal(summariseProjection(path, 9, 6).value, 0);
  assert.equal(summariseProjection([], 1, 6).investedShare, 1);
  assert.equal(inTodaysMoney(100, 0, 6), 100);
});

test('computeHistory: what was put in is the snapshot cost, plus SIP and buys after it, minus sales at the average cost', () => {
  const base = { funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, days: 10 };
  assert.deepEqual(computeHistory({ ...base, sipPlan: {} }).invested, [800, 800, 800, 800]); // 100 units at 8, held flat
  const sip = computeHistory({ ...base, sipPlan: { A: 120 } });
  assert.deepEqual(sip.invested, [800, 800, 920, 1040]); // 120 a day on 19 and 20 Nov
  const buy = computeHistory({ ...base, trades: [{ fundKey: 'A', kind: 'buy', date: '2026-11-19', units: 5, amount: 60 }] });
  assert.deepEqual(buy.invested, [800, 800, 860, 860]);
  const sell = computeHistory({ ...base, trades: [{ fundKey: 'A', kind: 'sell', date: '2026-11-19', units: 20, amount: 240 }] });
  assert.deepEqual(sell.invested, [800, 800, 640, 640]); // 20 of 100 units leave at the average cost of 8
  // the newest point meets the invested figure the portfolio table shows
  const total = computePortfolio({ funds: [FUNDS[0]], snapshots: SNAP, navByCode: NAV, sipPlan: { A: 120 } }).total.cost;
  assert.ok(Math.abs(sip.invested[sip.invested.length - 1] - total) < 1e-9);
  assert.deepEqual(computeHistory({ funds: FUNDS, snapshots: [], navByCode: NAV }).invested, []);
});

test('sliceHistory keeps the last N calendar days of every series, and all of it when N is empty or too long', () => {
  const h = { dates: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], value: [1, 2, 3, 4], invested: [9, 9, 9, 9], day: [0, 1, 1, 1], constantBefore: '2026-11-18' };
  const one = sliceHistory(h, 1);
  assert.deepEqual(one.dates, ['2026-11-19', '2026-11-20']);
  assert.deepEqual(one.value, [3, 4]);
  assert.deepEqual(one.invested, [9, 9]);
  assert.equal(one.constantBefore, '2026-11-18');
  assert.equal(sliceHistory(h, 0), h);
  assert.equal(sliceHistory(h, 365).dates.length, 4);
  assert.deepEqual(sliceHistory({ dates: [], value: [], invested: [], day: [] }, 30).dates, []);
});

test('computeAllocation: slices by fund, fund house or category, largest first, small ones folded into Others, percentages add to 100', () => {
  const rows = [
    { key: 'A', short: 'Alpha', amc: 'Alp', category: 'Diversified', value: 500 },
    { key: 'B', short: 'Beta', amc: 'Bet', category: 'Thematic', value: 300 },
    { key: 'C', short: 'Gamma', amc: 'Alp', category: 'Thematic', value: 150 },
    { key: 'D', short: 'Delta', amc: 'Del', category: null, value: 50 },
    { key: 'E', short: 'Gone', amc: 'Gon', category: 'Thematic', value: 0 }, // sold out: no slice
  ];
  const cat = computeAllocation(rows, 'category');
  assert.deepEqual(cat.map((c) => [c.label, c.value]), [['Diversified', 500], ['Thematic', 450], ['Other', 50]]);
  assert.ok(Math.abs(cat.reduce((a, c) => a + c.pct, 0) - 100) < 1e-9);
  const amc = computeAllocation(rows, 'amc');
  assert.deepEqual(amc.map((c) => [c.label, c.value, c.count]), [['Alp', 650, 2], ['Bet', 300, 1], ['Del', 50, 1]]);
  const folded = computeAllocation(rows, 'fund', 3);
  assert.deepEqual(folded.map((c) => c.label), ['Alpha', 'Beta', 'Others']);
  assert.equal(folded[2].value, 200);
  assert.deepEqual(folded[2].others, ['Gamma', 'Delta']);
  assert.deepEqual(computeAllocation([], 'fund'), []);
});

test('computeRelativeLines: percent change since the window start for the index and each fund; a window the history does not reach is reported', () => {
  const rows = [{ key: 'B', schemeCode: '2', short: 'Beta', value: 1 }];
  const navs = { 1: NAV[1], 2: NAV[2] };
  const r = computeRelativeLines({ rows, navByCode: navs, benchmarkCode: '1', days: 3 });
  assert.deepEqual(r.dates, ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  const near = (got, want) => got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) < 1e-9);
  assert.ok(near(r.benchmark, [0, 10, 20, 30])); // 10 -> 13
  assert.ok(near(r.funds[0].values, [0, 0, 10, 20])); // 100 -> 120
  assert.ok(Math.abs(r.funds[0].last - 20) < 1e-9);
  assert.equal(computeRelativeLines({ rows, navByCode: navs, benchmarkCode: '1', days: 365 }).tooShort, true);
  assert.equal(computeRelativeLines({ rows, navByCode: navs, benchmarkCode: '9', days: 3 }).hasBenchmark, false);
  // a fund whose NAVs start well after the window is left out, not drawn from a wrong start
  const longBench = [['2026-10-01', 100], ['2026-10-21', 110], ['2026-11-20', 120]];
  const late = { 1: longBench, 2: [['2026-11-10', 5], ['2026-11-20', 6]] };
  const out = computeRelativeLines({ rows, navByCode: late, benchmarkCode: '1', days: 30 });
  assert.ok(out.dates.length >= 2);
  assert.equal(out.funds.length, 0);
});

// ---------- whose holdings ----------

// A made-up second person who holds Alpha too (same scheme and holdings key, her own entry) and nothing of Beta.
const KRUTI_A = { key: 'K_A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', amc: 'Alp', group: 'other', category: 'Diversified', holdingsKey: 'A', owner: 'Kruti' };
const KRUTI_SNAP = { date: '2026-11-19', source: 'cas', owner: 'Kruti', positions: { K_A: { units: 50, avgCost: 9 } } };
const TWO = { funds: [...FUNDS, KRUTI_A], snapshots: [...SNAP, KRUTI_SNAP], navByCode: NAV };

test('owners: a fund with no owner is the default person\'s, and a view picks one person or everyone', () => {
  assert.equal(ownerOf(FUNDS[0]), DEFAULT_OWNER);
  assert.equal(ownerOf(KRUTI_A), 'Kruti');
  assert.deepEqual(ownersOf(TWO.funds), [DEFAULT_OWNER, 'Kruti']);
  assert.deepEqual(ownersOf([KRUTI_A, ...FUNDS]), [DEFAULT_OWNER, 'Kruti'], 'the default person comes first whatever the order');
  assert.deepEqual(ownersOf(FUNDS), [DEFAULT_OWNER]);
  assert.deepEqual(ownersOf([]), []);
  assert.equal(fundsForView(TWO.funds, null).length, 3);
  assert.deepEqual(fundsForView(TWO.funds, 'Kruti').map((f) => f.key), ['K_A']);
  assert.deepEqual(fundsForView(TWO.funds, DEFAULT_OWNER).map((f) => f.key), ['A', 'B']);
  assert.deepEqual(fundsForView(TWO.funds, 'Nobody'), []);
  // a plan cut down to a view's funds, so a sum over it is that view's SIP
  const plan = { A: 100, B: 50, K_A: 20 };
  assert.deepEqual(planForFunds(plan, fundsForView(TWO.funds, 'Kruti')), { K_A: 20 });
  assert.equal(Object.values(planForFunds(plan, TWO.funds)).reduce((a, b) => a + b, 0), 170);
  assert.deepEqual(planForFunds(null, TWO.funds), {});
});

test('computePortfolio: rows carry their owner, totals are kept per person, and a person\'s view adds up to the whole', () => {
  const all = computePortfolio(TWO);
  assert.deepEqual(all.rows.map((r) => [r.key, r.owner]).sort(), [['A', DEFAULT_OWNER], ['B', DEFAULT_OWNER], ['K_A', 'Kruti']]);
  assert.equal(all.total.value, 100 * 13 + 10 * 120 + 50 * 13); // 3150
  assert.equal(all.byOwner[DEFAULT_OWNER].value, 2500);
  assert.equal(all.byOwner.Kruti.value, 650);
  assert.equal(all.byOwner.Kruti.cost, 450); // 50 units at 9
  const mine = computePortfolio({ ...TWO, funds: fundsForView(TWO.funds, DEFAULT_OWNER) });
  const hers = computePortfolio({ ...TWO, funds: fundsForView(TWO.funds, 'Kruti') });
  assert.equal(mine.total.value, all.byOwner[DEFAULT_OWNER].value);
  assert.equal(hers.total.value, all.byOwner.Kruti.value);
  assert.equal(mine.total.value + hers.total.value, all.total.value);
  assert.equal(mine.total.cost + hers.total.cost, all.total.cost);
  assert.equal(mine.total.day + hers.total.day, all.total.day);
  assert.deepEqual(hers.rows.map((r) => r.key), ['K_A']);
  // shares are of the view in front of you
  assert.equal(hers.rows[0].share, 100);
  // a person with no funds yet has an empty view, not an error
  assert.equal(computePortfolio({ ...TWO, funds: [] }).rows.length, 0);
});

test('computeHistory: each person\'s value and put-in add up to the combined line on every date', () => {
  const run = (funds) => computeHistory({ ...TWO, funds, sipPlan: { A: 120 }, days: 10 });
  const all = run(TWO.funds);
  const mine = run(fundsForView(TWO.funds, DEFAULT_OWNER));
  const hers = run(fundsForView(TWO.funds, 'Kruti'));
  assert.deepEqual(all.dates, mine.dates);
  assert.deepEqual(all.dates, hers.dates);
  all.dates.forEach((_, i) => {
    assert.ok(Math.abs(mine.value[i] + hers.value[i] - all.value[i]) < 1e-9);
    assert.ok(Math.abs(mine.invested[i] + hers.invested[i] - all.invested[i]) < 1e-9);
    assert.ok(Math.abs(mine.day[i] + hers.day[i] - all.day[i]) < 1e-9);
  });
  // before her snapshot (19 Nov) her units are held flat at the snapshot's, like anyone's
  assert.equal(hers.value[0], 50 * 10);
});

test('the same fund held by both people is one fund in the overlap, and allocation can be split by person', () => {
  const rows = computePortfolio(TWO).rows;
  const overlap = { holdings: { A: { X: 10 }, B: { Y: 5 } }, names: {}, groups: { adani: ['X'] }, futures: [] };
  const combined = computeOverlap(overlap, rows);
  // Alpha: 1300 + 650 = 1950 at 10% in X
  assert.equal(combined.adani.total, 195);
  const hers = computeOverlap(overlap, rows.filter((r) => r.owner === 'Kruti'));
  assert.equal(hers.adani.total, 65);
  assert.equal(hers.adani.pct, 10);
  const split = computeAllocation(rows, 'owner');
  assert.deepEqual(split.map((x) => [x.label, x.value]), [[DEFAULT_OWNER, 2500], ['Kruti', 650]]);
  assert.ok(Math.abs(split.reduce((a, x) => a + x.pct, 0) - 100) < 1e-9);
});

test('computeSyncStatus: each person has their own freshness, and a combined view is only as fresh as its stalest part', () => {
  assert.equal(lastSyncKey('kite', DEFAULT_OWNER), 'kite');
  assert.equal(lastSyncKey('kite', undefined), 'kite');
  assert.equal(lastSyncKey('cas', 'Kruti'), 'cas:Kruti');
  const funds = [FUNDS[0] /* Yash, zerodha */, FUNDS[1] /* Yash, other */, KRUTI_A /* Kruti, other */];
  const snapshots = [
    { date: '2026-11-20', source: 'kite', positions: {} }, // no owner: Yash's
    { date: '2026-11-18', source: 'cas', positions: {} }, // Yash's CAS
    { date: '2026-11-01', source: 'cas', owner: 'Kruti', positions: {} },
  ];
  const today = '2026-11-22';
  const state = { lastSync: { kite: { date: '2026-11-21' } } }; // a recorded date wins over the snapshots'
  const mine = computeSyncStatus({ funds, snapshots, state, view: DEFAULT_OWNER, today });
  assert.equal(mine.kiteDate, '2026-11-21');
  assert.equal(mine.casDate, '2026-11-18');
  const hers = computeSyncStatus({ funds, snapshots, state, view: 'Kruti', today });
  assert.equal(hers.casDate, '2026-11-01');
  assert.equal(hers.cas.level, 'fresh', 'dated this month');
  // she holds nothing at Zerodha: that place is marked unused, so her view is not nagged about it
  assert.equal(hers.kiteUsed, false);
  assert.equal(hers.casUsed, true);
  assert.deepEqual(syncNudges({ sync: hers, hasSetup: true, today }), [], 'her CAS is from this month, and Zerodha is unused');
  const later = computeSyncStatus({ funds, snapshots, state, view: 'Kruti', today: '2026-12-20' });
  assert.deepEqual(syncNudges({ sync: later, hasSetup: true, today: '2026-12-20' }).map((n) => n.key), ['cas'], 'a stale CAS is reminded, a Zerodha she does not use is not');
  assert.equal(computeSyncStatus({ funds, snapshots, state, view: DEFAULT_OWNER, today }).kiteUsed, true);
  const both = computeSyncStatus({ funds, snapshots, state, view: null, today });
  assert.equal(both.casDate, '2026-11-01', 'the stalest CAS decides the combined freshness');
  assert.equal(both.cas.level, 'fresh');
  assert.equal(both.kiteDate, '2026-11-21', 'only Yash holds anything at Zerodha');
  assert.deepEqual(both.casByOwner.map((p) => p.owner), ['Kruti', DEFAULT_OWNER], 'the stalest first');
  // her own recorded date, under her own key
  const recorded = computeSyncStatus({ funds, snapshots, state: { lastSync: { 'cas:Kruti': { date: '2026-11-21' } } }, view: 'Kruti', today });
  assert.equal(recorded.casDate, '2026-11-21');
  assert.equal(recorded.cas.level, 'fresh');
  // nothing imported yet
  assert.equal(computeSyncStatus({ funds: [], snapshots: [], state: {}, today }).kite.level, 'never');
});

test('computeHistory: one person\'s line sits on the same dates as the combined line even when their funds price on different days', () => {
  // Yash holds a liquid fund that also prices on weekends; Kruti holds two equity funds that do not.
  const LIQUID = { key: 'L', schemeCode: '7', name: 'Liquid', short: 'Liquid', group: 'zerodha' };
  const E1 = { key: 'K1', schemeCode: '1', name: 'E1', short: 'E1', group: 'other', owner: 'Kruti' };
  const E2 = { key: 'K2', schemeCode: '2', name: 'E2', short: 'E2', group: 'other', owner: 'Kruti' };
  const weekdays = ['2026-11-18', '2026-11-19', '2026-11-20'];
  const navs = {
    1: weekdays.map((d, i) => [d, 10 + i]),
    2: weekdays.map((d, i) => [d, 20 + i]),
    7: [...weekdays, '2026-11-21', '2026-11-22'].map((d) => [d, 100]), // priced on Saturday and Sunday too
  };
  const snaps = [{ date: '2026-11-18', source: 'kite', positions: { L: { units: 1, avgCost: 100 } } }, { date: '2026-11-18', source: 'cas', owner: 'Kruti', positions: { K1: { units: 1, avgCost: 10 }, K2: { units: 1, avgCost: 20 } } }];
  const funds = [LIQUID, E1, E2];
  const combined = computeHistory({ funds, snapshots: snaps, navByCode: navs, days: 10 });
  const hisOnly = computeHistory({ funds: [LIQUID], snapshots: snaps, navByCode: navs, days: 10 });
  const hisOnAll = computeHistory({ funds: [LIQUID], calendarFunds: funds, snapshots: snaps, navByCode: navs, days: 10 });
  assert.deepEqual(combined.dates, weekdays, 'the weekend is not a trading day for the household');
  assert.equal(hisOnly.dates.length, 5, 'on its own the liquid fund draws the weekend too (why a shared calendar is needed)');
  assert.deepEqual(hisOnAll.dates, combined.dates, 'with the household\'s calendar it matches');
  const hers = computeHistory({ funds: [E1, E2], calendarFunds: funds, snapshots: snaps, navByCode: navs, days: 10 });
  combined.dates.forEach((_, i) => assert.ok(Math.abs(hisOnAll.value[i] + hers.value[i] - combined.value[i]) < 1e-9));
});

test('syncNudges: a single person with nothing at Zerodha is no longer reminded to sync it', () => {
  const only = [{ key: 'a', group: 'other', schemeCode: '1' }];
  const sync = computeSyncStatus({ funds: only, snapshots: [], state: {}, today: '2026-11-22' });
  assert.equal(sync.kiteUsed, false);
  assert.deepEqual(syncNudges({ sync, hasSetup: true, today: '2026-11-22' }).map((n) => n.key), []);
});

test('syncNudges: a reminder names whose holdings are stale once more than one person is in view, and reads as before for one', () => {
  const funds = [FUNDS[0], FUNDS[1], KRUTI_A];
  const snaps = [
    { date: '2026-11-20', source: 'kite', positions: {} },
    { date: '2026-11-15', source: 'cas', positions: {} },
    { date: '2026-09-01', source: 'cas', owner: 'Kruti', positions: {} },
  ];
  const today = '2026-11-22';
  const both = computeSyncStatus({ funds, snapshots: snaps, state: {}, view: null, today });
  const texts = syncNudges({ sync: both, hasSetup: true, today }).map((n) => n.text);
  assert.deepEqual(texts, ['Monthly CAS update due: funds outside Zerodha (Kruti) were last updated 82 days ago.']);
  // her own view has one person, so no name is added
  const hers = computeSyncStatus({ funds, snapshots: snaps, state: {}, view: 'Kruti', today });
  assert.equal(syncNudges({ sync: hers, hasSetup: true, today })[0].text, 'Monthly CAS update due: funds outside Zerodha were last updated 82 days ago.');
  // a Kite that has never synced, with two people holding Zerodha funds, says whose
  const twoKite = [FUNDS[0], { ...FUNDS[0], key: 'K_Z', owner: 'Kruti' }];
  const never = computeSyncStatus({ funds: twoKite, snapshots: [], state: {}, view: null, today });
  assert.match(syncNudges({ sync: never, hasSetup: true, today })[0].text, /^Zerodha holdings \((Kruti|Yash)\) have not been synced yet\.$/);
});

// ---------- importing for a person ----------

const BENCH = { schemeCode: '999', name: 'Index' };
const STORED_CATALOG = { funds: FUNDS, benchmark: BENCH };
// Kruti's setup file: her own entries (same Alpha fund under her own key) and nothing of Yash's.
const KRUTI_SETUP = {
  asOf: '2026-11-21',
  source: 'cas',
  owner: 'Kruti',
  catalog: { funds: [{ key: 'K_A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', amc: 'Alp', group: 'other', category: 'Diversified', holdingsKey: 'A' }] },
  positions: { K_A: { units: 50, avgCost: 9 } },
};

test('mergeCatalog: an import replaces only that person\'s funds, keeps everyone else\'s and the benchmark, and stamps the owner', () => {
  const r = mergeCatalog(STORED_CATALOG, KRUTI_SETUP.catalog, 'Kruti');
  assert.equal(r.ok, true);
  assert.deepEqual(r.catalog.funds.map((f) => f.key), ['A', 'B', 'K_A'], 'Yash\'s two funds come first and are untouched');
  assert.equal(r.catalog.funds[2].owner, 'Kruti');
  assert.equal(r.catalog.funds[0].owner, undefined, 'the default person\'s funds stay unstamped');
  assert.deepEqual(r.catalog.benchmark, BENCH, 'the stored benchmark survives a file that names none');
  // importing again replaces her funds rather than adding to them
  const again = mergeCatalog(r.catalog, { funds: [{ key: 'K_B', schemeCode: '2', name: 'Beta Fund', short: 'Beta', group: 'other' }] }, 'Kruti');
  assert.deepEqual(again.catalog.funds.map((f) => f.key), ['A', 'B', 'K_B']);
  // a file that names a benchmark replaces it
  assert.equal(mergeCatalog(STORED_CATALOG, { ...KRUTI_SETUP.catalog, benchmark: { schemeCode: '1', name: 'New' } }, 'Kruti').catalog.benchmark.name, 'New');
  // the default person re-importing keeps Kruti's funds and puts his own first
  const yash = mergeCatalog(r.catalog, { funds: [{ key: 'A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', group: 'zerodha' }] }, DEFAULT_OWNER);
  assert.deepEqual(yash.catalog.funds.map((f) => f.key), ['A', 'K_A']);
  // with nobody else stored it is a plain replacement, as it always was
  assert.deepEqual(mergeCatalog(null, { funds: FUNDS }, DEFAULT_OWNER).catalog.funds, FUNDS);
});

test('mergeCatalog refuses what would mix two people\'s funds up', () => {
  const clash = mergeCatalog(STORED_CATALOG, { funds: [{ key: 'A', schemeCode: '1', name: 'x' }] }, 'Kruti'); // A is Yash's
  assert.equal(clash.ok, false);
  assert.match(clash.error, /already Yash's/);
  const wrongOwner = mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_X', owner: 'Someone', schemeCode: '1', name: 'x' }] }, 'Kruti');
  assert.match(wrongOwner.error, /Someone's/);
  assert.match(mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_X', schemeCode: '1', name: 'x' }, { key: 'K_X', schemeCode: '1', name: 'y' }] }, 'Kruti').error, /twice/);
  assert.equal(mergeCatalog(STORED_CATALOG, { funds: [] }, 'Kruti').ok, false);
  assert.equal(mergeCatalog(STORED_CATALOG, { funds: [{ name: 'no key' }] }, 'Kruti').ok, false);
  assert.equal(mergeCatalog(STORED_CATALOG, null, 'Kruti').ok, false);
});

test('mergeOverlap: adds to the stored data by fund and keeps both sides\' stocks, groups and futures', () => {
  const stored = { asOf: 'Oct 2026', asOfDate: '2026-10-31', holdings: { A: { X: 10 } }, names: { X: 'X Corp' }, groups: { adani: ['X'] }, futures: [{ fund: 'A', name: 'X fut', weight: 1 }] };
  const incoming = { asOf: 'Nov 2026', asOfDate: '2026-11-30', holdings: { B: { Y: 5 } }, names: { Y: 'Y Ltd' }, groups: { adani: ['Y'], other: ['Z'] }, futures: [{ fund: 'A', name: 'X fut', weight: 1 }, { fund: 'B', name: 'Y fut', weight: 2 }] };
  const m = mergeOverlap(stored, incoming);
  assert.deepEqual(Object.keys(m.holdings).sort(), ['A', 'B']);
  assert.deepEqual(m.names, { X: 'X Corp', Y: 'Y Ltd' });
  assert.deepEqual(m.groups, { adani: ['X', 'Y'], other: ['Z'] });
  assert.equal(m.futures.length, 2, 'the same future is listed once');
  assert.equal(m.asOfDate, '2026-11-30');
  // an older disclosure does not move the date back
  assert.equal(mergeOverlap(stored, { holdings: { B: {} }, asOfDate: '2026-01-01', asOf: 'Jan' }).asOfDate, '2026-10-31');
  assert.equal(mergeOverlap(stored, null), stored);
  assert.equal(mergeOverlap(null, incoming), incoming);
  assert.equal(mergeOverlap(null, null), null);
});

test('mergeSipPlan: the first plan is stored plainly; later ones are dated and keep the schedule and the other person\'s amounts', () => {
  const funds = [...FUNDS, { key: 'K_A', owner: 'Kruti' }, { key: 'K_B', owner: 'Kruti' }];
  const first = mergeSipPlan({ existingDoc: null, incomingPlan: { A: 100 }, owner: DEFAULT_OWNER, funds, asOf: '2026-11-01' });
  assert.deepEqual(first.sip, { plan: { A: 100 } });
  // Kruti's plan arrives after Yash's schedule has two entries
  const existing = { schedule: [{ from: '2026-01-01', plan: { A: 100, B: 50 } }, { from: '2026-06-01', plan: { A: 120, B: 50 } }], plan: { A: 120, B: 50 } };
  const r = mergeSipPlan({ existingDoc: existing, incomingPlan: { K_A: 30 }, owner: 'Kruti', funds, asOf: '2026-11-21' });
  assert.equal(r.ok, true);
  assert.equal(r.sip.schedule.length, 3, 'earlier entries are kept');
  assert.deepEqual(r.sip.schedule[2], { from: '2026-11-21', plan: { A: 120, B: 50, K_A: 30 } });
  assert.deepEqual(r.sip.plan, { A: 120, B: 50, K_A: 30 });
  assert.deepEqual(r.sip.schedule[1].plan, { A: 120, B: 50 }, 'days before the import keep the plan they ran under');
  // re-importing her plan replaces her amounts, not Yash's
  const next = mergeSipPlan({ existingDoc: r.sip, incomingPlan: { K_B: 10 }, owner: 'Kruti', funds, asOf: '2026-11-22' });
  assert.deepEqual(next.sip.plan, { A: 120, B: 50, K_B: 10 });
  // a plan that names someone else's fund is refused
  assert.match(mergeSipPlan({ existingDoc: existing, incomingPlan: { A: 5 }, owner: 'Kruti', funds, asOf: '2026-11-21' }).error, /not Kruti's/);
  assert.deepEqual(mergeSipPlan({ existingDoc: existing, incomingPlan: null, owner: 'Kruti', funds, asOf: '2026-11-21' }), { ok: true, sip: null });
});

test('snapshotId: the default person keeps the plain id, anyone else\'s carries their name', () => {
  assert.equal(snapshotId('2026-11-21', 'kite'), 'snap_2026-11-21_kite');
  assert.equal(snapshotId('2026-11-21', 'cas', DEFAULT_OWNER), 'snap_2026-11-21_cas');
  assert.equal(snapshotId('2026-11-21', 'cas', 'Kruti'), 'snap_2026-11-21_cas_Kruti');
  assert.equal(snapshotId('2026-11-21', 'cas', 'Mary Ann/2'), 'snap_2026-11-21_cas_Mary_Ann_2', 'nothing that is not allowed in a document id');
});

test('parseImport for a person: a setup file merges into the stored catalog and says what it replaces and keeps', () => {
  const base = { catalog: STORED_CATALOG, asOfDefault: '2026-11-21', today: '2026-11-22' };
  const r = parseImport(JSON.stringify(KRUTI_SETUP), { ...base, owner: 'Kruti' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.owner, 'Kruti');
  assert.deepEqual(r.payload.positions, { K_A: { units: 50, avgCost: 9 } });
  assert.deepEqual(r.funds.map((f) => f.key), ['A', 'B', 'K_A']);
  assert.deepEqual(r.summary, { owner: 'Kruti', replacedFunds: 0, keptOtherFunds: 2, removed: [], dropped: [] });
  // the file's own owner is used when no one is chosen, and a different choice is refused
  assert.equal(parseImport(JSON.stringify(KRUTI_SETUP), base).payload.owner, 'Kruti');
  const mismatch = parseImport(JSON.stringify(KRUTI_SETUP), { ...base, owner: DEFAULT_OWNER });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /file is for Kruti, but you chose Yash/);
  // a colliding key is reported, not written
  const bad = { ...KRUTI_SETUP, catalog: { funds: [{ key: 'A', schemeCode: '1', name: 'x', group: 'other' }] }, positions: { A: { units: 1, avgCost: 1 } } };
  assert.match(parseImport(JSON.stringify(bad), base).error, /already Yash's/);
});

test('parseImport: a person who is not on the portfolio is refused, and names are matched exactly', () => {
  const base = { catalog: STORED_CATALOG, asOfDefault: '2026-11-21', today: '2026-11-22', people: [DEFAULT_OWNER, 'Kruti'] };
  assert.equal(parseImport(JSON.stringify(KRUTI_SETUP), base).ok, true);
  const lower = parseImport(JSON.stringify({ ...KRUTI_SETUP, owner: 'kruti' }), base);
  assert.equal(lower.ok, false);
  assert.match(lower.error, /kruti is not one of the people/);
  assert.equal(parseImport(JSON.stringify({ ...KRUTI_SETUP, owner: '  Kruti  ' }), base).payload.owner, 'Kruti', 'stray spaces are trimmed, not a new person');
  // without a list nothing is checked (the default person alone)
  assert.equal(parseImport(JSON.stringify({ ...KRUTI_SETUP, owner: 'Someone' }), { ...base, people: null }).ok, true);
});

test('parseImport: positions can only be for the chosen person\'s funds, and a Kite ISIN means that person\'s Zerodha fund', () => {
  const funds = [
    { key: 'A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', group: 'zerodha' },
    { key: 'K_A', isin: 'INF000A', schemeCode: '1', name: 'Alpha Fund', short: 'Alpha', group: 'zerodha', owner: 'Kruti' },
    { key: 'K_B', isin: 'INF000B', schemeCode: '2', name: 'Beta Fund', short: 'Beta', group: 'zerodha', owner: 'Kruti' },
  ];
  const kite = JSON.stringify([{ tradingsymbol: 'INF000A', quantity: 7, average_price: 3 }]);
  const base = { catalog: { funds }, asOfDefault: '2026-11-21', today: '2026-11-22' };
  const hers = parseImport(kite, { ...base, owner: 'Kruti' });
  assert.deepEqual(Object.keys(hers.payload.positions), ['K_A'], 'the same ISIN goes to the chosen person\'s fund');
  assert.match(hers.warnings[0], /Not in this Kite list \(left as before\): Beta/, 'and the missing-fund warning is hers alone');
  const his = parseImport(kite, { ...base, owner: DEFAULT_OWNER });
  assert.deepEqual(Object.keys(his.payload.positions), ['A']);
  assert.deepEqual(his.warnings, [], 'Kruti\'s Beta is not Yash\'s to miss');
  // naming another person's fund by key is refused
  const stray = JSON.stringify({ asOf: '2026-11-21', source: 'cas', positions: { A: { units: 1, avgCost: 1 } } });
  assert.match(parseImport(stray, { ...base, owner: 'Kruti' }).error, /A belongs to Yash, not Kruti/);
});

test('buildImportWrites: the snapshot, sync key and merged documents for one person, without touching anyone else\'s', () => {
  const existing = {
    catalog: STORED_CATALOG,
    overlap: { asOfDate: '2026-10-31', holdings: { A: { X: 10 } }, names: {}, groups: {}, futures: [] },
    sip: { schedule: [{ from: '2026-01-01', plan: { A: 100 } }], plan: { A: 100 } },
  };
  const file = { ...KRUTI_SETUP, overlap: { asOfDate: '2026-11-15', holdings: { C: { Y: 1 } }, names: {}, groups: {}, futures: [] }, sipPlan: { K_A: 25 } };
  const payload = parseImport(JSON.stringify(file), { catalog: STORED_CATALOG, asOfDefault: '2026-11-21', today: '2026-11-22' }).payload;
  const w = buildImportWrites({ payload, existing });
  assert.equal(w.ok, true);
  assert.equal(w.writes.snapshot.id, 'snap_2026-11-21_cas_Kruti');
  assert.deepEqual(w.writes.snapshot.data, { date: '2026-11-21', source: 'cas', positions: { K_A: { units: 50, avgCost: 9 } }, owner: 'Kruti' });
  assert.equal(w.writes.syncKey, 'cas:Kruti');
  assert.deepEqual(w.writes.catalog.funds.map((f) => f.key), ['A', 'B', 'K_A']);
  assert.deepEqual(w.writes.catalog.benchmark, BENCH);
  assert.deepEqual(Object.keys(w.writes.overlap.holdings).sort(), ['A', 'C']);
  assert.equal(w.writes.sip.schedule.length, 2);
  assert.deepEqual(w.writes.sip.plan, { A: 100, K_A: 25 });
  // the default person's import is written exactly as before: plain id, plain key, no owner field
  const yash = buildImportWrites({ payload: { asOf: '2026-11-22', source: 'kite', owner: DEFAULT_OWNER, positions: { A: { units: 1, avgCost: 1 } } }, existing });
  assert.equal(yash.writes.snapshot.id, 'snap_2026-11-22_kite');
  assert.equal(yash.writes.syncKey, 'kite');
  assert.equal('owner' in yash.writes.snapshot.data, false);
  assert.equal(yash.writes.catalog, null);
  assert.equal(yash.writes.sip, null);
  // a bad merge is reported instead of written
  assert.equal(buildImportWrites({ payload: { ...payload, sipPlan: { A: 1 } }, existing }).ok, false);
});

// ---------- stocks ----------

// Made-up stocks: Kruti holds two at Zerodha and one elsewhere; Yash holds the same company ("XCO") that a fund also holds.
const STOCK_X = { key: 'K_X', kind: 'stock', symbol: 'XCO', name: 'X Company', short: 'XCo', sector: 'Energy', group: 'zerodha', owner: 'Kruti', isin: 'INE000X', schemeCode: 'STK_XCO' };
const STOCK_Y = { key: 'K_Y', kind: 'stock', symbol: 'YCO', name: 'Y Company', short: 'YCo', sector: 'Banks', group: 'zerodha', owner: 'Kruti', isin: 'INE000Y', schemeCode: 'STK_YCO' };
const STOCK_Z = { key: 'K_Z', kind: 'stock', symbol: 'ZCO', name: 'Z Company', short: 'ZCo', sector: 'Banks', group: 'other', owner: 'Kruti', isin: 'INE000Z', schemeCode: 'STK_ZCO' };
const STOCK_NAV = { STK_XCO: [['2026-11-20', 200]], STK_YCO: [['2026-11-20', 50]], STK_ZCO: [['2026-11-20', 10]] };
const STOCK_SNAP = { date: '2026-11-20', source: 'kite_stocks', owner: 'Kruti', positions: { K_X: { units: 10, avgCost: 150 }, K_Y: { units: 100, avgCost: 60 }, K_Z: { units: 5, avgCost: 12 } } };

test('computePortfolio: a stock is valued at its saved price, has no day change, is counted apart from funds and is left out once sold', () => {
  const funds = [...FUNDS, STOCK_X, STOCK_Y, STOCK_Z];
  const nav = { ...NAV, ...STOCK_NAV };
  const all = computePortfolio({ funds, snapshots: [...SNAP, STOCK_SNAP], navByCode: nav });
  const x = all.rows.find((r) => r.key === 'K_X');
  assert.equal(x.value, 2000);
  assert.equal(x.pnl, 500);
  assert.equal(x.day, 0);
  assert.equal(x.dayPct, 0);
  assert.equal(x.owner, 'Kruti');
  assert.equal(all.byKind.stocks.value, 2000 + 5000 + 50);
  assert.equal(all.byKind.funds.value, 100 * 13 + 10 * 120);
  assert.equal(all.total.value, all.byKind.funds.value + all.byKind.stocks.value);
  // the date of the NAVs is the funds' own, never a stock's price date
  const withLaterPrice = computePortfolio({ funds, snapshots: [...SNAP, STOCK_SNAP], navByCode: { ...nav, STK_XCO: [['2026-11-22', 210]] } });
  assert.equal(withLaterPrice.navDate, '2026-11-20');
  // sold (units to zero) disappears
  const sold = { ...STOCK_SNAP, date: '2026-11-21', positions: { ...STOCK_SNAP.positions, K_Y: { units: 0, avgCost: 0 } } };
  const after = computePortfolio({ funds, snapshots: [...SNAP, STOCK_SNAP, sold], navByCode: nav });
  assert.equal(after.rows.some((r) => r.key === 'K_Y'), false);
  // a portfolio of only stocks still has a NAV date
  assert.equal(computePortfolio({ funds: [STOCK_X], snapshots: [STOCK_SNAP], navByCode: nav }).navDate, '2026-11-20');
});

test('computePortfolio: a sold fund is left out, comes back when bought again, and keeps the sale day\'s P&L', () => {
  const sold = { date: '2026-11-20', source: 'kite', positions: { A: { units: 0, avgCost: 0 } } };
  const snapshots = [...SNAP, sold];
  const gone = computePortfolio({ funds: FUNDS, snapshots, navByCode: NAV });
  assert.deepEqual(gone.rows.map((r) => r.key), ['B']);
  assert.deepEqual(gone.soldKeys, ['A']);
  assert.equal(gone.total.count, 1);

  const bought = { fundKey: 'A', kind: 'buy', date: '2026-11-21', units: 5, amount: 65 };
  const back = computePortfolio({ funds: FUNDS, snapshots, navByCode: NAV, trades: [bought] });
  assert.equal(back.rows.find((r) => r.key === 'A').units, 5);
  assert.deepEqual(back.soldKeys, []);

  // sold on the newest NAV date: the units held at the previous close still earned that day's move
  const sale = { fundKey: 'A', kind: 'sell', date: '2026-11-20', units: 100, amount: 1300 };
  const saleDay = computePortfolio({ funds: FUNDS, snapshots: SNAP, navByCode: NAV, trades: [sale] });
  const a = saleDay.rows.find((r) => r.key === 'A');
  assert.deepEqual([a.value, a.day], [0, 100]);
});

test('computeHistory: stocks are valued at their last saved price, never set the trading days, and have no daily P&L', () => {
  const funds = [FUNDS[0], STOCK_X];
  const nav = { ...NAV, STK_XCO: [['2026-11-18', 100], ['2026-11-20', 200]] }; // priced only at two imports
  const snaps = [...SNAP, { date: '2026-11-18', source: 'kite_stocks', owner: 'Kruti', positions: { K_X: { units: 10, avgCost: 90 } } }];
  const h = computeHistory({ funds, calendarFunds: funds, snapshots: snaps, navByCode: nav, days: 10 });
  assert.deepEqual(h.dates, ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], 'the funds\' days, not the stock\'s two');
  // before its first saved price (the 18th) a stock is not valued; then it is carried forward: 10 shares x 100 until the 20th, then x 200
  assert.deepEqual(h.value, [1000, 1100 + 1000, 1200 + 1000, 1300 + 2000]);
  assert.deepEqual(h.day, [0, 100, 100, 100], 'the stock\'s price jump on the 20th is not a day\'s profit');
  assert.deepEqual(h.invested, [800, 800 + 900, 800 + 900, 800 + 900], 'and its cost is left out of the put-in until then too');
  // a portfolio of only stocks has dates of its own
  const only = computeHistory({ funds: [STOCK_X], calendarFunds: [STOCK_X], snapshots: snaps, navByCode: nav, days: 10 });
  assert.deepEqual(only.dates, ['2026-11-18', '2026-11-20']);
});

test('overlap and limits: a directly held stock adds to the same company held through funds, and is not a fund', () => {
  const fundRow = { key: 'A', holdingsKey: 'A', short: 'Alpha', value: 1000, category: 'Diversified', amc: 'Alp' };
  const direct = { key: 'K_X', kind: 'stock', symbol: 'XCO', stockId: 'XCO', holdingsKey: 'K_X', name: 'X Company', short: 'XCo', sector: 'Energy', value: 500, owner: 'Kruti' };
  const overlap = { holdings: { A: { XCO: 10, OTHER: 5 } }, names: { XCO: 'X Corp' }, groups: { adani: ['XCO'] }, futures: [] };
  const o = computeOverlap(overlap, [fundRow, direct]);
  assert.equal(o.total, 1500);
  // 10% of 1000 through the fund + 100% of 500 held directly
  assert.equal(o.adani.total, 600);
  assert.equal(o.stocks.find((x) => x.stock === 'XCO').value, 600);
  assert.equal(o.shared.find((x) => x.stock === 'XCO').funds.length, 2, 'owned two ways');
  assert.deepEqual(o.pairs, [], 'a stock is not a fund, so it makes no fund pair');
  // a stock with no entry in the disclosures is its own company, named from the catalog
  const lone = computeOverlap({ holdings: {}, names: {}, groups: {}, futures: [] }, [direct]);
  assert.deepEqual(lone.stocks.map((x) => [x.stock, x.name, x.value]), [['XCO', 'X Company', 500]]);
  // the fund-only numbers leave stocks out, the stock numbers include them
  const m = computeMetrics([fundRow, direct], o);
  assert.equal(m.byCategory.Diversified, (1000 / 1500) * 100);
  assert.equal(m.byCategory.Energy, undefined);
  assert.equal(m.maxFund.name, 'Alpha');
  assert.equal(m.maxStock.name, 'X Corp');
  assert.ok(Math.abs(m.maxStock.pct - 40) < 1e-9);
  assert.ok(Math.abs(m.adaniPct - 40) < 1e-9);
});

test('computeAllocation by type and sector; benchmark and relative lines ignore stocks', () => {
  const rows = [
    { key: 'A', short: 'Alpha', amc: 'Alp', category: 'Diversified', value: 600 },
    { key: 'K_X', kind: 'stock', short: 'XCo', sector: 'Energy', value: 300, owner: 'Kruti' },
    { key: 'K_Y', kind: 'stock', short: 'YCo', sector: 'Banks', value: 100, owner: 'Kruti' },
  ];
  assert.deepEqual(computeAllocation(rows, 'kind').map((x) => [x.label, x.value]), [['Mutual funds', 600], ['Stocks', 400]]);
  assert.deepEqual(computeAllocation(rows, 'category').map((x) => x.label), ['Diversified', 'Energy', 'Banks'], 'a stock\'s category is its sector');
  assert.deepEqual(computeAllocation(rows, 'amc').map((x) => x.label), ['Alp', 'Direct stocks']);
  const table = computeBenchmarkTable({ rows: [{ key: 'A', schemeCode: '1', short: 'Alpha' }, { key: 'K_X', kind: 'stock', schemeCode: 'STK_XCO', short: 'XCo' }], navByCode: { 1: NAV[1], STK_XCO: STOCK_NAV.STK_XCO, 999: NAV[2] }, benchmarkCode: '999' });
  assert.deepEqual(table.table.map((r) => r.key), ['A']);
  const lines = computeRelativeLines({ rows: [{ key: 'K_X', kind: 'stock', schemeCode: 'STK_XCO', short: 'XCo' }], navByCode: { STK_XCO: STOCK_NAV.STK_XCO, 1: NAV[1] }, benchmarkCode: '1', days: 3 });
  assert.deepEqual(lines.funds, []);
});

test('buildTrade: a stock needs both the shares and the amount, because there is no price to work one from the other', () => {
  const ctx = { funds: [STOCK_X], navByCode: STOCK_NAV, today: '2026-11-22' };
  assert.match(buildTrade({ ...ctx, fundKey: 'K_X', kind: 'buy', date: '2026-11-20', amount: 1000 }).error, /both the number of shares and the amount/);
  assert.match(buildTrade({ ...ctx, fundKey: 'K_X', kind: 'buy', date: '2026-11-20', units: 5 }).error, /both the number of shares and the amount/);
  const ok = buildTrade({ ...ctx, fundKey: 'K_X', kind: 'buy', date: '2026-11-20', units: 5, amount: 1000 });
  assert.deepEqual(ok.trade, { fundKey: 'K_X', kind: 'buy', date: '2026-11-20', units: 5, amount: 1000 });
});

test('stock sync: its own place, used only by people who hold Zerodha stocks, with a reminder after a week', () => {
  const funds = [FUNDS[0], STOCK_X, STOCK_Z];
  const today = '2026-11-22';
  const none = computeSyncStatus({ funds, snapshots: [], state: {}, view: 'Kruti', today });
  assert.equal(none.stocksUsed, true);
  assert.equal(none.stocks.level, 'never');
  assert.equal(none.kiteUsed, false, 'her Zerodha is stocks, not mutual funds');
  assert.equal(none.casUsed, false, 'the one stock held elsewhere is manual and has no sync place');
  assert.match(syncNudges({ sync: none, hasSetup: true, today })[0].text, /^Stocks have not been synced yet\./);
  const fresh = computeSyncStatus({ funds, snapshots: [{ date: '2026-11-20', source: 'kite_stocks', owner: 'Kruti', positions: {} }], state: {}, view: 'Kruti', today });
  assert.equal(fresh.stocks.level, 'stale');
  assert.deepEqual(syncNudges({ sync: fresh, hasSetup: true, today }), []);
  const old = computeSyncStatus({ funds, snapshots: [{ date: '2026-11-10', source: 'kite_stocks', owner: 'Kruti', positions: {} }], state: {}, view: 'Kruti', today });
  assert.match(syncNudges({ sync: old, hasSetup: true, today })[0].text, /^Stocks were last synced 12 days ago\. Their prices are as of then\.$/);
  assert.equal(nudgeTarget('stocks'), 'portfolioData');
  // her recorded date is under her own key
  assert.equal(computeSyncStatus({ funds, snapshots: [], state: { lastSync: { 'kite_stocks:Kruti': { date: '2026-11-21' } } }, view: 'Kruti', today }).stocksDate, '2026-11-21');
});

test('mergeCatalog: a stock entry is completed (symbol, price key, exchange) and needs a symbol', () => {
  const r = mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_X', kind: 'stock', symbol: 'XCO', name: 'X Company', sector: 'Energy' }] }, 'Kruti');
  assert.equal(r.ok, true);
  const x = r.catalog.funds.find((f) => f.key === 'K_X');
  assert.deepEqual([x.schemeCode, x.stockId, x.exchange, x.group, x.holdingsKey, x.owner], ['STK_XCO', 'XCO', 'NSE', 'zerodha', 'K_X', 'Kruti']);
  assert.match(mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_X', kind: 'stock', name: 'No symbol' }] }, 'Kruti').error, /needs a symbol/);
  assert.equal(isStock(x), true);
  assert.equal(isStock(FUNDS[0]), false);
});

test('parseImport: a Kite equity list maps by ISIN to that person\'s Zerodha stocks, takes the last price, and treats a stock missing from it as sold', () => {
  const funds = [...FUNDS, STOCK_X, STOCK_Y, STOCK_Z];
  const base = { catalog: { funds }, asOfDefault: '2026-11-22', today: '2026-11-22', owner: 'Kruti', people: ['Yash', 'Kruti'] };
  const kite = JSON.stringify([{ tradingsymbol: 'XCO', exchange: 'NSE', isin: 'INE000X', quantity: 12, t1_quantity: 1, average_price: 160, last_price: 210.5 }]);
  const r = parseImport(kite, base);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.payload.source, 'kite_stocks');
  assert.deepEqual(r.payload.positions.K_X, { units: 13, avgCost: 160 });
  assert.deepEqual(r.payload.prices, { K_X: 210.5 });
  // YCo is a Zerodha stock of hers that is not in the list: sold. ZCo is held elsewhere, so it is not touched.
  assert.deepEqual(r.payload.positions.K_Y, { units: 0, avgCost: 0 });
  assert.equal('K_Z' in r.payload.positions, false);
  assert.deepEqual(r.summary.removed, ['YCo']);
  // only stocks held now are listed as removed
  assert.deepEqual(parseImport(kite, { ...base, heldKeys: ['K_X'] }).summary.removed, []);
  assert.deepEqual(parseImport(kite, { ...base, heldKeys: ['K_X', 'K_Y'] }).summary.removed, ['YCo']);
  // a stock with no price is refused; a mutual-fund Kite list never touches stocks
  const noPrice = JSON.stringify([{ tradingsymbol: 'XCO', exchange: 'NSE', isin: 'INE000X', quantity: 1, average_price: 1 }]);
  assert.match(parseImport(noPrice, base).error, /No price for XCO/);
  const mf = JSON.stringify([{ tradingsymbol: 'INE000X', quantity: 1, average_price: 1 }]);
  assert.match(parseImport(mf, base).error, /Unknown fund/);
  // Yash cannot import a stock that is Kruti's
  assert.match(parseImport(kite, { ...base, owner: 'Yash' }).error, /Unknown stock/);
  // a setup/manual file carries prices alongside the positions
  const manual = JSON.stringify({ asOf: '2026-11-22', source: 'manual', owner: 'Kruti', positions: { K_Z: { units: 5, avgCost: 12 } }, prices: { K_Z: 11 } });
  const m = parseImport(manual, base);
  assert.equal(m.ok, true, m.error);
  assert.deepEqual(m.payload.prices, { K_Z: 11 });
  assert.deepEqual(m.summary.removed, [], 'a manual file is not a complete list');
});

test('buildImportWrites: a stock import saves each price under the stock\'s own key and year, merged with earlier ones', () => {
  const existing = { catalog: { funds: [...FUNDS, STOCK_X, STOCK_Y] }, overlap: null, sip: null };
  const payload = { asOf: '2026-12-31', source: 'kite_stocks', owner: 'Kruti', positions: { K_X: { units: 1, avgCost: 1 }, K_Y: { units: 0, avgCost: 0 } }, prices: { K_X: 220 } };
  const w = buildImportWrites({ payload, existing });
  assert.equal(w.ok, true);
  assert.equal(w.writes.snapshot.id, 'snap_2026-12-31_kite_stocks_Kruti');
  assert.equal(w.writes.syncKey, 'kite_stocks:Kruti');
  assert.deepEqual(w.writes.prices, [{ code: 'STK_XCO', year: '2026', series: { '2026-12-31': 220 } }]);
  assert.equal(buildImportWrites({ payload: { ...payload, prices: { NOPE: 1 } }, existing }).ok, false);
  // two people holding the same stock share one price series
  const both = { catalog: { funds: [STOCK_X, { ...STOCK_X, key: 'Y_X', owner: undefined }] }, overlap: null, sip: null };
  const shared = buildImportWrites({ payload: { asOf: '2026-12-31', source: 'kite_stocks', owner: 'Kruti', positions: { K_X: { units: 1, avgCost: 1 } }, prices: { K_X: 5, Y_X: 5 } }, existing: both });
  assert.equal(shared.writes.prices.length, 1);
});

test('mergeSipPlan: a plan dated before a later SIP edit still reaches the plan in force now, without overriding a deliberate later edit', () => {
  const funds = [...FUNDS, { key: 'K_A', owner: 'Kruti' }, { key: 'K_OLD_OWNER_FUND', owner: 'Kruti' }];
  const existing = { schedule: [{ from: '2026-01-01', plan: { A: 100 } }, { from: '2026-11-21', plan: { A: 120 } }], plan: { A: 120 } };
  // Kruti's statement is dated 15 Nov, before Yash's 21 Nov edit, which never mentioned her
  const r = mergeSipPlan({ existingDoc: existing, incomingPlan: { K_A: 30 }, owner: 'Kruti', funds, asOf: '2026-11-15' });
  assert.deepEqual(r.sip.schedule.map((e) => e.from), ['2026-01-01', '2026-11-15', '2026-11-21']);
  assert.deepEqual(r.sip.schedule[1].plan, { A: 100, K_A: 30 });
  assert.deepEqual(r.sip.schedule[2].plan, { A: 120, K_A: 30 }, 'her plan carries into the later entry that left her out');
  assert.deepEqual(r.sip.plan, { A: 120, K_A: 30 }, 'so the plan in force now has her SIP');
  // a later entry that already has her funds is a later edit of hers: it stays
  const edited = { schedule: [{ from: '2026-01-01', plan: { A: 100 } }, { from: '2026-11-21', plan: { A: 120, K_A: 99 } }], plan: { A: 120, K_A: 99 } };
  const kept = mergeSipPlan({ existingDoc: edited, incomingPlan: { K_A: 30 }, owner: 'Kruti', funds, asOf: '2026-11-15' });
  assert.deepEqual(kept.sip.plan, { A: 120, K_A: 99 });
  // a backdated plan for someone who already has later entries does not undo them
  const yash = mergeSipPlan({ existingDoc: existing, incomingPlan: { A: 777 }, owner: DEFAULT_OWNER, funds, asOf: '2026-11-15' });
  assert.deepEqual(yash.sip.plan, { A: 120 });
  assert.deepEqual(yash.sip.schedule[1].plan, { A: 777 });
});

test('mergeSipPlan: SIP amounts for a fund that is in nobody\'s catalog any more are dropped on the next import', () => {
  const funds = [...FUNDS, { key: 'K_NEW', owner: 'Kruti' }]; // she dropped K_OLD in this re-import
  const existing = { schedule: [{ from: '2026-01-01', plan: { A: 100, K_OLD: 40 } }], plan: { A: 100, K_OLD: 40 } };
  const r = mergeSipPlan({ existingDoc: existing, incomingPlan: { K_NEW: 10 }, owner: 'Kruti', funds, asOf: '2026-11-21' });
  assert.deepEqual(r.sip.plan, { A: 100, K_NEW: 10 });
});

test('mergeOverlap: a newer file replaces what it lists (a closed future goes, a changed weight changes); an older file only fills gaps; the date comes as a pair', () => {
  const stored = { asOf: 'Nov 2026', asOfDate: '2026-11-10', holdings: { A: { X: 10 } }, names: { X: 'X Corp' }, groups: { adani: ['X'] }, futures: [{ fund: 'A', name: 'X fut', weight: 5 }, { fund: 'B', name: 'B fut', weight: 1 }] };
  const newer = mergeOverlap(stored, { asOf: 'Dec 2026', asOfDate: '2026-12-10', holdings: { A: { X: 12 } }, futures: [{ fund: 'A', name: 'X fut', weight: 2 }] });
  assert.deepEqual(newer.holdings.A, { X: 12 });
  assert.deepEqual(newer.futures, [{ fund: 'B', name: 'B fut', weight: 1 }, { fund: 'A', name: 'X fut', weight: 2 }], 'A\'s future follows the new file; B\'s is untouched');
  const closed = mergeOverlap(stored, { asOf: 'Dec 2026', asOfDate: '2026-12-10', holdings: { A: { X: 12 } }, futures: [] });
  assert.deepEqual(closed.futures.map((f) => f.fund), ['B'], 'a future the new file no longer lists is closed');
  const older = mergeOverlap(stored, { asOf: 'Oct 2026', asOfDate: '2026-10-01', holdings: { A: { X: 99 }, C: { Z: 1 } }, futures: [{ fund: 'A', name: 'X fut', weight: 9 }, { fund: 'C', name: 'C fut', weight: 3 }] });
  assert.deepEqual(older.holdings.A, { X: 10 }, 'an older disclosure does not overwrite a stored fund');
  assert.deepEqual(older.holdings.C, { Z: 1 }, 'but it fills in a fund that was not stored');
  assert.equal(older.futures.find((f) => f.fund === 'A').weight, 5);
  assert.ok(older.futures.some((f) => f.fund === 'C'));
  assert.equal(older.asOfDate, '2026-11-10');
  assert.equal(older.asOf, 'Nov 2026', 'the label stays with its date');
  // nothing undefined is ever produced (Firestore refuses it)
  const bare = mergeOverlap({ holdings: { A: {} } }, { holdings: { B: {} } });
  assert.equal(Object.values(bare).some((v) => v === undefined), false);
  assert.equal('asOf' in bare, false);
});

test('mergeOverlap: an older file never re-opens a future that a newer file closed', () => {
  // 15 Nov lists a future on A; 20 Nov lists A with none (closed); an older 1 Oct file still lists it
  let m = mergeOverlap(null, { asOfDate: '2026-11-15', holdings: { A: { X: 10 } }, futures: [{ fund: 'A', name: 'FUT X', weight: 4 }] });
  m = mergeOverlap(m, { asOfDate: '2026-11-20', holdings: { A: { X: 11 } }, futures: [] });
  assert.deepEqual(m.futures, []);
  m = mergeOverlap(m, { asOfDate: '2026-10-01', holdings: { A: { X: 9 } }, futures: [{ fund: 'A', name: 'FUT X', weight: 4 }] });
  assert.deepEqual(m.futures, [], 'A is already stored, so the older file leaves it alone');
  assert.deepEqual(m.holdings.A, { X: 11 });
  assert.equal(m.asOfDate, '2026-11-20');
  // but an older file's futures for a fund that was never stored are still taken
  const filled = mergeOverlap(m, { asOfDate: '2026-10-01', holdings: { C: { Z: 1 } }, futures: [{ fund: 'C', name: 'C fut', weight: 2 }] });
  assert.deepEqual(filled.futures.map((f) => f.fund), ['C']);
});

test('stocks, round three: warnings by kind, no SIP for a stock, rows that add up, valid symbols, what leaves the list, and the chart\'s last date', () => {
  const funds = [...FUNDS, { ...FUNDS[0], key: 'K_D', owner: 'Kruti', isin: 'INF000D', group: 'zerodha', short: 'Delta' }, STOCK_X, STOCK_Y];
  const base = { catalog: { funds }, asOfDefault: '2026-11-22', today: '2026-11-22', owner: 'Kruti' };
  // a mutual-fund Kite list warns about her missing mutual funds only, and a stocks list warns about none (it lists removals)
  const mfList = JSON.stringify([{ tradingsymbol: 'INF000D', quantity: 1, average_price: 1 }]);
  assert.deepEqual(parseImport(mfList, base).warnings, []);
  const mfMissing = parseImport(JSON.stringify([{ tradingsymbol: 'INF000A', quantity: 1, average_price: 1 }]), { ...base, owner: DEFAULT_OWNER, catalog: { funds: [...funds, { key: 'A2', isin: 'INF000Q', group: 'zerodha', short: 'Quiet', name: 'Quiet' }] } });
  assert.match(mfMissing.warnings.join(' '), /Quiet/);
  assert.equal(/XCo|YCo/.test(mfMissing.warnings.join(' ')), false, 'stocks are never "missing funds"');
  const eq = JSON.stringify([{ tradingsymbol: 'XCO', exchange: 'NSE', isin: 'INE000X', quantity: 1, average_price: 1, last_price: 2 }]);
  assert.equal(parseImport(eq, base).warnings.some((w) => /Not in this Kite list/.test(w)), false);
  // a SIP plan cannot name a stock
  assert.match(mergeSipPlan({ existingDoc: null, incomingPlan: { K_X: 100 }, owner: 'Kruti', funds, asOf: '2026-11-22' }).error, /A stock has no SIP/);
  // the same share on two rows (NSE and BSE) adds up at the weighted cost
  const twoRows = JSON.stringify([
    { tradingsymbol: 'XCO', exchange: 'NSE', isin: 'INE000X', quantity: 10, average_price: 100, last_price: 150 },
    { tradingsymbol: 'XCO', exchange: 'BSE', isin: 'INE000X', quantity: 5, average_price: 160, last_price: 151 },
  ]);
  assert.deepEqual(parseImport(twoRows, base).payload.positions.K_X, { units: 15, avgCost: 120 });
  // a symbol with a slash cannot be a document id
  assert.match(mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_S', kind: 'stock', symbol: 'A/B', name: 's' }] }, 'Kruti').error, /slash/);
  assert.equal(mergeCatalog(STORED_CATALOG, { funds: [{ key: 'K_S', kind: 'stock', symbol: 'M&M', name: 's' }] }, 'Kruti').ok, true);
  // a catalog that leaves out funds or stocks she has now says so
  const stored = { funds: [...FUNDS, KRUTI_A, STOCK_X, STOCK_Y] };
  const replace = parseImport(JSON.stringify({ ...KRUTI_SETUP, catalog: { funds: [KRUTI_SETUP.catalog.funds[0]] } }), { catalog: stored, asOfDefault: '2026-11-21', today: '2026-11-22', owner: 'Kruti' });
  assert.deepEqual(replace.summary.dropped, ['XCo', 'YCo']);
  assert.equal(replace.summary.replacedFunds, 3);
  // a stock priced after the newest NAV day is the chart's last date, so its last point agrees with the summary
  const nav = { ...NAV, STK_XCO: [['2026-11-20', 200], ['2026-11-22', 210]] };
  const snaps = [...SNAP, { date: '2026-11-20', source: 'kite_stocks', owner: 'Kruti', positions: { K_X: { units: 10, avgCost: 150 } } }];
  const h = computeHistory({ funds: [FUNDS[0], STOCK_X], calendarFunds: [FUNDS[0], STOCK_X], snapshots: snaps, navByCode: nav, days: 10 });
  assert.equal(h.dates[h.dates.length - 1], '2026-11-22');
  assert.equal(h.value[h.value.length - 1], 100 * 13 + 10 * 210);
  assert.equal(h.day[h.day.length - 1], 0, 'no NAV moved on the extra day, and a stock has no day P&L');
  const p = computePortfolio({ funds: [FUNDS[0], STOCK_X], snapshots: snaps, navByCode: nav });
  assert.equal(p.total.value, h.value[h.value.length - 1], 'the chart ends where the summary does');
});

test('parseImport: a Kite list with nobody chosen says it goes to the first person when there is more than one', () => {
  const funds = [{ key: 'A', isin: 'INF000A', schemeCode: '1', name: 'Alpha', short: 'Alpha', group: 'zerodha' }, { key: 'K_A', isin: 'INF000A', schemeCode: '1', name: 'Alpha', short: 'Alpha', group: 'zerodha', owner: 'Kruti' }];
  const kite = JSON.stringify([{ tradingsymbol: 'INF000A', quantity: 1, average_price: 1 }]);
  const base = { catalog: { funds }, asOfDefault: '2026-11-21', today: '2026-11-22', people: [DEFAULT_OWNER, 'Kruti'] };
  const open = parseImport(kite, base);
  assert.deepEqual(Object.keys(open.payload.positions), ['A']);
  assert.match(open.warnings[0], /No person is chosen, so this goes to Yash/);
  assert.equal(parseImport(kite, { ...base, owner: 'Kruti' }).warnings.some((w) => /No person is chosen/.test(w)), false, 'choosing silences it');
  assert.equal(parseImport(kite, { ...base, people: [DEFAULT_OWNER] }).warnings.some((w) => /No person is chosen/.test(w)), false, 'one person: nothing to warn about');
});

test('parseImport: a setup file must say whose it is when there is more than one person, and a bad name is called a bad name', () => {
  const base = { catalog: STORED_CATALOG, asOfDefault: '2026-11-21', today: '2026-11-22', people: [DEFAULT_OWNER, 'Kruti'] };
  const { owner: _o, ...ownerless } = KRUTI_SETUP;
  const refused = parseImport(JSON.stringify(ownerless), base);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /does not say whose it is/);
  assert.equal(parseImport(JSON.stringify(ownerless), { ...base, owner: 'Kruti' }).ok, true, 'choosing the person is enough');
  // a positions-only file (no catalog) still falls back to the first person, as a Kite list always did
  assert.equal(parseImport(JSON.stringify({ asOf: '2026-11-21', source: 'manual', positions: { A: { units: 1, avgCost: 1 } } }), base).payload.owner, DEFAULT_OWNER);
  // 'kruti' with the Yash pill chosen is a bad name, not advice to pick a pill that does not exist
  const bad = parseImport(JSON.stringify({ ...KRUTI_SETUP, owner: 'kruti' }), { ...base, owner: DEFAULT_OWNER });
  assert.match(bad.error, /kruti is not one of the people/);
});

test('snapshotId: nothing in the source can break the document id either', () => {
  assert.equal(snapshotId('2026-11-21', 'a/b'), 'snap_2026-11-21_a_b');
  assert.equal(snapshotId('2026-11-21', 'kite_stocks', 'Kruti'), 'snap_2026-11-21_kite_stocks_Kruti');
});

test('holdingsToCsv: a header, one line per fund, the owner of each, and commas and quotes escaped', () => {
  const csv = holdingsToCsv([
    { name: 'Fund, "X"', group: 'zerodha', amc: 'Q', category: 'Thematic', units: 10.5, avgCost: 8, cost: 84, nav: 12, navDate: '2026-11-20', value: 126, pnl: 42, pnlPct: 50, day: 3 },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Fund,Owner,Held at,Fund house,Category,Units/);
  assert.equal(lines[1], '"Fund, ""X""",Yash,Zerodha,Q,Thematic,10.500,8.0000,84.00,12,2026-11-20,126.00,42.00,50.00,3.00');
  // a row that carries an owner says whose it is
  const hers = holdingsToCsv([{ name: 'Alpha', owner: 'Kruti', group: 'other', amc: 'Alp', category: 'D', units: 1, avgCost: 1, cost: 1, nav: 1, navDate: '2026-11-20', value: 1, pnl: 0, pnlPct: 0, day: 0 }]);
  assert.match(hers.trim().split('\n')[1], /^Alpha,Kruti,Other,/);
});

test('syncNudges: the overlap data is flagged once it is more than 45 days old', () => {
  const sync = { kite: { level: 'fresh', days: 0 }, cas: { level: 'fresh', days: 0 } };
  assert.deepEqual(syncNudges({ hasSetup: true, sync, overlapDate: '2026-10-31', today: '2026-11-22' }), []);
  const old = syncNudges({ hasSetup: true, sync, overlapDate: '2026-10-31', today: '2026-12-20' });
  assert.equal(old[0].key, 'overlap');
  assert.match(old[0].text, /31 Oct disclosures, 50 days ago/);
  assert.deepEqual(syncNudges({ hasSetup: true, sync, today: '2026-12-20' }), [], 'no date, no reminder');
});

test('nudgeTarget: imports for sync reminders, the limits tab for a breached limit', () => {
  assert.equal(nudgeTarget('kite'), 'portfolioData');
  assert.equal(nudgeTarget('cas'), 'portfolioData');
  assert.equal(nudgeTarget('overlap'), 'portfolioData');
  assert.equal(nudgeTarget('limit-amc-Quant'), 'portfolioLimits');
  assert.equal(nudgeTarget('something-else'), null);
});

test('limitLabel capitalises category names that come from the data', () => {
  assert.equal(limitLabel({ metric: 'category', name: 'Small cap' }), 'Small Cap Funds');
  assert.equal(limitLabel({ metric: 'category', name: 'Banking and finance' }), 'Banking and Finance Funds');
});
