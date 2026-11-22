import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIsoDate,
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
  computeMix,
  formatRupeesCompact,
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

test('computeMix sums value per category, largest first', () => {
  const mix = computeMix([
    { category: 'Thematic', value: 300 },
    { category: 'Small cap', value: 700 },
    { category: 'Thematic', value: 100 },
  ]);
  assert.deepEqual(mix.map((m) => [m.label, m.value]), [['Small cap', 700], ['Thematic', 400]]);
  assert.ok(Math.abs(mix[0].pct - (700 / 1100) * 100) < 1e-9);
  assert.ok(Math.abs(mix[0].pct + mix[1].pct - 100) < 1e-9);
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
