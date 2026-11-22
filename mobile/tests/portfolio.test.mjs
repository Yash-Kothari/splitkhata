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
  parseBenchmarkInput,
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

test('syncNudges: Kite after a week, CAS after about a month, nothing before setup', () => {
  const sync = (kite, cas) => ({ kite: { level: kite[0], days: kite[1] }, cas: { level: cas[0], days: cas[1] } });
  assert.deepEqual(syncNudges({ hasSetup: false, sync: sync(['never', null], ['never', null]) }), []);
  assert.deepEqual(syncNudges({ hasSetup: true, sync: sync(['fresh', 0], ['stale', 20]) }), []);
  assert.deepEqual(syncNudges({ hasSetup: true, sync: sync(['stale', 5], ['never', null]) }), [], 'up to a week is covered by SIP estimates');
  const old = syncNudges({ hasSetup: true, sync: sync(['old', 9], ['old', 40]) });
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

test('parseBenchmarkInput: takes a bare benchmark or a setup file, reads only the benchmark, and rejects anything malformed', () => {
  const bench = { schemeCode: '120716', name: 'Test Nifty 50 Index' };
  assert.deepEqual(parseBenchmarkInput(JSON.stringify(bench)), { ok: true, benchmark: bench });
  assert.deepEqual(parseBenchmarkInput(JSON.stringify({ benchmark: bench })).benchmark, bench);
  // A whole setup file: only catalog.benchmark comes out, never a holding, a fund or a plan.
  const setup = { asOf: '2026-11-01', catalog: { funds: [{ key: 'A' }], benchmark: bench }, positions: { A: { units: 1, avgCost: 2 } }, sipPlan: { A: 5 } };
  const r = parseBenchmarkInput(JSON.stringify(setup));
  assert.deepEqual(r, { ok: true, benchmark: bench });
  assert.deepEqual(Object.keys(r), ['ok', 'benchmark']);
  assert.equal(parseBenchmarkInput(JSON.stringify({ schemeCode: 120716, name: ' Padded ' })).benchmark.name, 'Padded'); // a number code is accepted as text
  assert.equal(parseBenchmarkInput('not json').ok, false);
  assert.equal(parseBenchmarkInput('').ok, false);
  assert.equal(parseBenchmarkInput(JSON.stringify({ catalog: { funds: [] } })).ok, false); // no benchmark in it
  assert.equal(parseBenchmarkInput(JSON.stringify({ schemeCode: 'abc', name: 'X' })).ok, false); // not digits
  assert.equal(parseBenchmarkInput(JSON.stringify({ schemeCode: '12', name: 'X' })).ok, false); // too short
  assert.equal(parseBenchmarkInput(JSON.stringify({ schemeCode: '120716', name: '' })).ok, false);
  assert.equal(parseBenchmarkInput(JSON.stringify({ schemeCode: '120716', name: 'x'.repeat(121) })).ok, false);
  assert.equal(parseBenchmarkInput('[1,2]').ok, false);
  assert.equal(parseBenchmarkInput('null').ok, false);
});

test('holdingsToCsv: a header, one line per fund, and commas and quotes escaped', () => {
  const csv = holdingsToCsv([
    { name: 'Fund, "X"', group: 'zerodha', amc: 'Q', category: 'Thematic', units: 10.5, avgCost: 8, cost: 84, nav: 12, navDate: '2026-11-20', value: 126, pnl: 42, pnlPct: 50, day: 3 },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Fund,Held at,Fund house,Category,Units/);
  assert.equal(lines[1], '"Fund, ""X""",Zerodha,Q,Thematic,10.500,8.0000,84.00,12,2026-11-20,126.00,42.00,50.00,3.00');
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
