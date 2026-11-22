// Portfolio engine: mutual-fund holdings, NAV history, daily and total P&L, how stale the data is,
// and how much your funds overlap. Pure on purpose (no React, no Firebase, no network), like utils.js.
//
// Where the data comes from (see docs/PORTFOLIO.md):
//  - Units and average cost: a SNAPSHOT you import (from Zerodha/Kite, or a CAS statement for funds held
//    elsewhere). Between snapshots units are ESTIMATED from the daily SIP plan, and the next snapshot
//    reconciles them.
//  - NAVs: fetched by the app from the public AMFI mirror (mfapi.in) and stored, so only the days since
//    the last stored date are ever fetched (the "backfill").
//
// Shapes used below:
//   fund      { key, isin, schemeCode, name, short, amc, group: 'zerodha' | 'other', category, holdingsKey? }
//   snapshot  { date: 'YYYY-MM-DD', source, positions: { [fundKey]: { units, avgCost } } }
//   series    [[ 'YYYY-MM-DD', nav ], ...] ascending by date; navByCode is { [schemeCode]: series }
//   sipPlan   { [fundKey]: rupees bought per trading day }

// ---------- dates ----------

export function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((utcDay(toIso) - utcDay(fromIso)) / 86400000);
}

export function addDaysISO(iso, days) {
  const d = new Date(utcDay(iso) + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// The most recent weekday strictly before `iso` - the newest NAV that should already be published.
// (Indian market holidays are not modelled: a holiday only means one harmless extra check.)
export function previousWeekday(iso) {
  let d = addDaysISO(iso, -1);
  for (;;) {
    const dow = new Date(utcDay(d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return d;
    d = addDaysISO(d, -1);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "8 Oct", the app's short date style outside forms.
export function formatShortDate(iso) {
  if (!isIsoDate(iso)) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// ---------- sync status ----------

// How fresh the imported holdings are. `fresh` up to a day old (units since are a SIP estimate), `stale` up to a
// week, `old` beyond that. `never` before the first import.
export function classifySync(lastSnapshotDate, today) {
  if (!lastSnapshotDate || !isIsoDate(lastSnapshotDate)) return { level: 'never', days: null, label: 'Never synced' };
  const days = Math.max(0, daysBetween(lastSnapshotDate, today));
  const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const level = days <= 1 ? 'fresh' : days <= 7 ? 'stale' : 'old';
  return { level, days, label };
}

// ---------- NAV series ----------

// mfapi.in gives dates as dd-mm-yyyy.
export function isoFromApiDate(dmy) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(dmy));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isIsoDate(iso) ? iso : null;
}

// mfapi.in's `data` array (newest first, nav as a string) -> ascending [[iso, nav]] with bad rows dropped.
export function parseMfapiHistory(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const date = isoFromApiDate(row?.date);
    const nav = Number(row?.nav);
    if (date && Number.isFinite(nav) && nav > 0) out.push([date, Math.round(nav * 1e4) / 1e4]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

// Index of the last entry on or before `date`, or -1.
export function indexOnOrBefore(series, date) {
  let lo = 0;
  let hi = (series?.length || 0) - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function navOnOrBefore(series, date) {
  const i = indexOnOrBefore(series, date);
  return i < 0 ? null : series[i];
}

// Firestore keeps NAVs in one document per scheme and year ({ series: { 'YYYY-MM-DD': nav } }), so a day's
// backfill rewrites at most a small document. This folds those documents back into ascending series.
export function buildNavByCode(docs) {
  const maps = {};
  for (const [id, data] of Object.entries(docs || {})) {
    if (!id.startsWith('nav_') || !data?.series) continue;
    const code = String(data.schemeCode ?? id.split('_')[1]);
    const map = (maps[code] = maps[code] || {});
    for (const [date, nav] of Object.entries(data.series)) map[date] = Number(nav);
  }
  const out = {};
  for (const [code, map] of Object.entries(maps)) {
    out[code] = Object.keys(map)
      .sort()
      .map((d) => [d, map[d]]);
  }
  return out;
}

export function lastNavDate(series) {
  return series?.length ? series[series.length - 1][0] : null;
}

// Which schemes need NAVs fetched, and from when. A scheme is current when its newest NAV is at least `expected`,
// by default the previous weekday's (the newest one that should be published). A manual check passes today's date
// as `expected` instead, so it asks for anything newer than what is stored. With nothing stored yet it asks for
// `historyDays` of history.
export function planNavFetch(funds, navByCode, today, historyDays = 400, expected = previousWeekday(today)) {
  const seen = new Set();
  const plan = [];
  for (const f of funds || []) {
    const code = String(f.schemeCode || '');
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const last = lastNavDate(navByCode?.[code]);
    if (last && last >= expected) continue;
    plan.push({ schemeCode: code, from: last ? addDaysISO(last, 1) : addDaysISO(today, -historyDays), last });
  }
  return plan;
}

// New points only (after what is stored, up to today), grouped by year for the per-year documents.
export function newNavPointsByYear(parsedSeries, from, today) {
  const byYear = {};
  let count = 0;
  for (const [date, nav] of parsedSeries) {
    if (date < from || date > today) continue;
    (byYear[date.slice(0, 4)] = byYear[date.slice(0, 4)] || {})[date] = nav;
    count += 1;
  }
  return { byYear, count };
}

// ---------- SIP plan over time ----------

const FAR_PAST = '0000-01-01';

// The SIP plan as a dated schedule: [{ from, plan: { [fundKey]: rupeesPerDay } }]. A plan saved before schedules
// existed ({ plan }) is one entry that has always applied. A change only affects days from its own date, so an edit
// today never rewrites what was bought last month.
export function normalizeSipSchedule(doc) {
  const list = Array.isArray(doc?.schedule) ? doc.schedule : null;
  if (list && list.length) {
    return list
      .filter((e) => e && typeof e.from === 'string' && e.plan && typeof e.plan === 'object')
      .map((e) => ({ from: e.from, plan: e.plan }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  }
  if (doc?.plan && typeof doc.plan === 'object') return [{ from: FAR_PAST, plan: doc.plan }];
  return [];
}

// The plan in force on `date`.
export function sipPlanAt(schedule, date) {
  let plan = {};
  for (const e of schedule || []) {
    if (e.from <= date) plan = e.plan;
    else break;
  }
  return plan;
}

// Rupees a day for one fund as a function of the date, for estimateHolding. With no schedule it falls back to a
// constant from the plain plan map.
export function sipAmountFn(sipPlan, schedule, key) {
  if (schedule && schedule.length) {
    return (date) => Number(sipPlanAt(schedule, date)[key]) || 0;
  }
  const a = Number(sipPlan?.[key]) || 0;
  return () => a;
}

// A new schedule with `plan` taking effect from `from`. The same date replaces that entry; the first edit of a
// legacy plan keeps the old plan in force up to the day before.
export function applySipChange(schedule, from, plan) {
  const clean = {};
  for (const [k, v] of Object.entries(plan || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) clean[k] = Math.round(n * 100) / 100;
  }
  const next = (schedule || []).filter((e) => e.from !== from).map((e) => ({ from: e.from, plan: e.plan }));
  next.push({ from, plan: clean });
  next.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return next;
}

// ---------- holdings ----------

// The latest position per fund across all snapshots (a later snapshot overrides an earlier one for the funds it
// lists, so a Kite-only sync leaves the funds held elsewhere as they were).
export function latestPositions(snapshots) {
  const out = {};
  const ordered = [...(snapshots || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of ordered) {
    for (const [key, p] of Object.entries(s.positions || {})) {
      out[key] = { units: Number(p.units) || 0, avgCost: Number(p.avgCost) || 0, date: s.date, source: s.source || null };
    }
  }
  return out;
}

// Cumulative rupees-per-NAV for a SIP, so units bought between two dates are a subtraction.
function cumulativeSipUnits(series, amountOn) {
  const cum = new Array(series.length);
  let run = 0;
  for (let i = 0; i < series.length; i += 1) {
    run += amountOn(series[i][0]) / series[i][1];
    cum[i] = run;
  }
  return cum;
}

// Units and cost a fund holds on `asOf`: the position at its snapshot, plus what the daily SIP would have bought on
// each NAV date after it, plus the trades you recorded after it (a trade dated on or before the snapshot is already
// in the snapshot). A sale takes units out at the running average cost, so it leaves the average cost unchanged.
// `estimated` is true when anything after the snapshot was added.
export function estimateHolding(position, series, sipAmount, asOf, trades = []) {
  if (!position) return null;
  let units = position.units;
  let cost = position.units * position.avgCost;
  let sipDays = 0;
  let tradeCount = 0;
  const events = [];
  // `sipAmount` is rupees a day, or a function of the date when the SIP changed over time (see sipAmountFn).
  const amountOn = typeof sipAmount === 'function' ? sipAmount : () => Number(sipAmount) || 0;
  if (series?.length) {
    for (const [d, nav] of series) {
      if (d > position.date && d <= asOf) {
        const a = amountOn(d);
        if (a > 0) events.push({ d, order: 1, sip: a / nav, amount: a });
      }
    }
  }
  for (const t of trades || []) if (t.date > position.date && t.date <= asOf) events.push({ d: t.date, order: 0, trade: t });
  events.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.order - b.order));
  for (const e of events) {
    if (e.trade) {
      const t = e.trade;
      if (t.kind === 'sell') {
        const sold = Math.min(t.units, units);
        cost -= units > 0 ? (cost / units) * sold : 0;
        units -= sold;
      } else {
        units += t.units;
        cost += t.amount;
      }
      tradeCount += 1;
    } else {
      units += e.sip;
      cost += e.amount;
      sipDays += 1;
    }
  }
  return {
    units,
    cost,
    avgCost: units > 0 ? cost / units : position.avgCost,
    estimated: sipDays > 0 || tradeCount > 0,
    sipDays,
    tradeCount,
  };
}

// Per-fund rows and totals as of the newest NAV on hand.
export function computePortfolio({ funds, snapshots, navByCode, sipPlan = {}, sipSchedule = null, trades = [] }) {
  const positions = latestPositions(snapshots);
  const rows = [];
  for (const f of funds || []) {
    const pos = positions[f.key];
    const series = navByCode?.[String(f.schemeCode)] || [];
    if (!pos || series.length === 0) continue;
    const [navDate, nav] = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : series[series.length - 1];
    const mine = (trades || []).filter((t) => t.fundKey === f.key);
    // Today's holding includes a trade made after the newest NAV; the day's P&L is on what was held at the prior close.
    const amountOn = sipAmountFn(sipPlan, sipSchedule, f.key);
    const h = estimateHolding(pos, series, amountOn, '9999-12-31', mine);
    const before = estimateHolding(pos, series, amountOn, prev[0], mine);
    const value = h.units * nav;
    const day = before.units * (nav - prev[1]);
    rows.push({
      ...f,
      units: h.units,
      avgCost: h.avgCost,
      cost: h.cost,
      nav,
      navDate,
      prevNav: prev[1],
      value,
      pnl: value - h.cost,
      pnlPct: h.cost > 0 ? (value / h.cost - 1) * 100 : 0,
      day,
      dayPct: prev[1] > 0 ? (nav / prev[1] - 1) * 100 : 0,
      estimated: h.estimated,
      sipDays: h.sipDays,
      tradeCount: h.tradeCount,
      snapshotDate: pos.date,
    });
  }
  const sum = (list, k) => list.reduce((a, r) => a + r[k], 0);
  const totalOf = (list) => {
    const value = sum(list, 'value');
    const cost = sum(list, 'cost');
    const day = sum(list, 'day');
    return {
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost > 0 ? (value / cost - 1) * 100 : 0,
      day,
      dayPct: value - day > 0 ? (day / (value - day)) * 100 : 0,
      count: list.length,
    };
  };
  const total = totalOf(rows);
  rows.forEach((r) => {
    r.share = total.value > 0 ? (r.value / total.value) * 100 : 0;
  });
  rows.sort((a, b) => b.value - a.value);
  return {
    rows,
    total,
    byGroup: { zerodha: totalOf(rows.filter((r) => r.group === 'zerodha')), other: totalOf(rows.filter((r) => r.group === 'other')) },
    navDate: rows.reduce((d, r) => (r.navDate > d ? r.navDate : d), ''),
    estimatedCount: rows.filter((r) => r.estimated).length,
  };
}

// Portfolio value and day-over-day P&L for the last `days` trading days. Units at each date come from the nearest
// earlier snapshot plus SIP-estimated units; before the first snapshot they are held at the first snapshot's units
// (there is nothing earlier to go on), which `constantBefore` reports so the chart can say so.
export function computeHistory({ funds, snapshots, navByCode, sipPlan = {}, sipSchedule = null, trades = [], days = 90 }) {
  const ordered = [...(snapshots || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const live = (funds || []).filter((f) => navByCode?.[String(f.schemeCode)]?.length && ordered.some((s) => s.positions?.[f.key]));
  if (live.length === 0) return { dates: [], value: [], invested: [], day: [], constantBefore: null };

  // A trading day is one most of the funds priced (liquid funds also publish on weekends).
  const counts = new Map();
  for (const f of live) for (const [d] of navByCode[String(f.schemeCode)]) counts.set(d, (counts.get(d) || 0) + 1);
  const need = Math.ceil(live.length / 2);
  const all = [...counts.entries()].filter(([, c]) => c >= need).map(([d]) => d).sort();
  const dates = all.slice(-(days + 1));
  if (dates.length < 2) return { dates, value: [], invested: [], day: [], constantBefore: null };

  const perFund = live.map((f) => {
    const series = navByCode[String(f.schemeCode)];
    const snaps = ordered.filter((s) => s.positions?.[f.key]);
    return {
      f,
      series,
      snaps,
      cum: sipPlan[f.key] > 0 || sipSchedule?.length ? cumulativeSipUnits(series, sipAmountFn(sipPlan, sipSchedule, f.key)) : null,
      trades: (trades || []).filter((t) => t.fundKey === f.key),
    };
  });

  const unitsAt = (pf, date) => {
    let base = pf.snaps[0];
    for (const s of pf.snaps) if (s.date <= date) base = s;
    let units = Number(base.positions[pf.f.key].units) || 0;
    if (date <= base.date) return units;
    if (pf.cum) {
      const to = indexOnOrBefore(pf.series, date);
      const from = indexOnOrBefore(pf.series, base.date);
      units += to > from ? pf.cum[to] - (from >= 0 ? pf.cum[from] : 0) : 0;
    }
    for (const t of pf.trades) if (t.date > base.date && t.date <= date) units += t.kind === 'sell' ? -t.units : t.units;
    return Math.max(units, 0);
  };

  // What was put in (the cost of the units held) on a date: the position at its snapshot plus the SIP and trades after it,
  // the same arithmetic as estimateHolding, so the line meets today's invested figure. Before the first snapshot it is
  // held at that snapshot's cost, like the units.
  const costAt = (pf, date) => {
    let base = pf.snaps[0];
    for (const s of pf.snaps) if (s.date <= date) base = s;
    const pos = base.positions[pf.f.key];
    if (date <= base.date) return (Number(pos.units) || 0) * (Number(pos.avgCost) || 0);
    const position = { units: Number(pos.units) || 0, avgCost: Number(pos.avgCost) || 0, date: base.date };
    return estimateHolding(position, pf.series, pf.amountOn, date, pf.trades).cost;
  };
  perFund.forEach((pf) => {
    pf.amountOn = sipAmountFn(sipPlan, sipSchedule, pf.f.key);
  });

  const value = [];
  const invested = [];
  const day = [];
  let prevUnits = null;
  let prevNavs = null;
  for (const date of dates) {
    let v = 0;
    let d = 0;
    let c = 0;
    const unitsNow = [];
    const navsNow = [];
    perFund.forEach((pf, i) => {
      const nav = navOnOrBefore(pf.series, date)?.[1] ?? null;
      const units = unitsAt(pf, date);
      unitsNow.push(units);
      navsNow.push(nav);
      if (nav != null) v += units * nav;
      c += costAt(pf, date);
      if (prevUnits && nav != null && prevNavs[i] != null) d += prevUnits[i] * (nav - prevNavs[i]);
    });
    value.push(v);
    invested.push(c);
    day.push(prevUnits ? d : 0);
    prevUnits = unitsNow;
    prevNavs = navsNow;
  }
  return { dates, value, invested, day, constantBefore: ordered[0].date };
}

// ---------- importing a snapshot ----------

function positionsToMap(positions, funds, source) {
  // Accepts { key: {units, avgCost} } or [ { key | isin, units, avgCost } ]. A bare isin means the Zerodha fund.
  const byKey = new Set((funds || []).map((f) => f.key));
  const out = {};
  const problems = [];
  const list = Array.isArray(positions) ? positions : Object.entries(positions || {}).map(([key, p]) => ({ key, ...p }));
  for (const p of list) {
    let key = p.key;
    if (!key && p.isin) {
      const hit = (funds || []).find((f) => f.isin === p.isin && (source === 'kite' ? f.group === 'zerodha' : true));
      key = hit?.key;
    }
    if (!key || !byKey.has(key)) {
      problems.push(`Unknown fund ${p.key || p.isin || '(no id)'}`);
      continue;
    }
    const units = Number(p.units);
    const avgCost = Number(p.avgCost);
    if (!Number.isFinite(units) || units < 0 || !Number.isFinite(avgCost) || avgCost < 0) {
      problems.push(`Bad units or cost for ${key}`);
      continue;
    }
    out[key] = { units: Math.round(units * 1e3) / 1e3, avgCost: Math.round(avgCost * 1e6) / 1e6 };
  }
  return { positions: out, problems };
}

// Turns pasted text into something the import preview can show. Two shapes are accepted:
//  - the array Kite's mutual-fund holdings call returns ([{ tradingsymbol (the ISIN), quantity, average_price }]),
//    stamped with `asOfDefault` and mapped to your Zerodha funds;
//  - an object { asOf, source, positions, catalog?, overlap?, sipPlan? }, used for the first setup and for funds
//    held outside Zerodha (positions from a CAS statement).
export function parseImport(text, { catalog = null, asOfDefault, today }) {
  let json;
  try {
    json = JSON.parse(String(text || '').trim());
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the whole file.' };
  }
  const isKite = Array.isArray(json);
  const body = isKite ? { positions: json.map((h) => ({ isin: h.tradingsymbol, units: h.quantity, avgCost: h.average_price })), source: 'kite' } : json;
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a snapshot object or a list of holdings.' };

  const asOf = body.asOf || asOfDefault;
  if (!isIsoDate(asOf)) return { ok: false, error: 'The snapshot needs an as-of date like 2026-11-21.' };
  if (today && asOf > today) return { ok: false, error: 'The as-of date is in the future.' };

  const funds = body.catalog?.funds || catalog?.funds;
  if (!Array.isArray(funds) || funds.length === 0) return { ok: false, error: 'No fund list yet. Import the setup file first.' };

  const source = body.source || 'manual';
  const { positions, problems } = positionsToMap(body.positions, funds, source);
  if (problems.length) return { ok: false, error: problems.slice(0, 4).join('. ') + (problems.length > 4 ? ` (+${problems.length - 4} more)` : '') };
  if (Object.keys(positions).length === 0) return { ok: false, error: 'No holdings found in that text.' };

  const warnings = [];
  if (isKite) {
    const missing = funds.filter((f) => f.group === 'zerodha' && !positions[f.key]).map((f) => f.short || f.name);
    if (missing.length) warnings.push(`Not in this Kite list (left as before): ${missing.join(', ')}`);
  }
  return {
    ok: true,
    warnings,
    payload: { asOf, source, positions, catalog: body.catalog || null, overlap: body.overlap || null, sipPlan: body.sipPlan || null },
  };
}

// Preview rows: what changes per fund, and for a fund with an estimate, how far the estimate was from reality.
export function diffForPreview({ funds, snapshots, navByCode, sipPlan = {}, sipSchedule = null, trades = [], next, asOf }) {
  const before = latestPositions(snapshots);
  const rows = [];
  for (const f of funds || []) {
    const incoming = next[f.key];
    if (!incoming) continue;
    const prev = before[f.key];
    const series = navByCode?.[String(f.schemeCode)] || [];
    const mine = (trades || []).filter((t) => t.fundKey === f.key);
    const est = prev ? estimateHolding(prev, series, sipAmountFn(sipPlan, sipSchedule, f.key), asOf, mine) : null;
    rows.push({
      key: f.key,
      name: f.short || f.name,
      prevUnits: prev ? prev.units : null,
      estimatedUnits: est && est.estimated ? est.units : null,
      nextUnits: incoming.units,
      // Positive: you hold more than the SIP estimate said (an extra purchase); negative: fewer (a sale or a missed SIP).
      drift: est && est.estimated ? incoming.units - est.units : null,
      isNew: !prev,
    });
  }
  return rows;
}

// ---------- overlap ----------

// `overlap`: { holdings: { [holdingsKey]: { [stock]: weightPct } }, names, groups: { adani: [stock...] } }
// `values`: rupee value per holdingsKey (DSP held in two places is summed under one key).
export function valuesByHoldingsKey(rows) {
  const out = {};
  for (const r of rows || []) out[r.holdingsKey || r.key] = (out[r.holdingsKey || r.key] || 0) + r.value;
  return out;
}

export function computeOverlap(overlap, rows) {
  const holdings = overlap?.holdings || {};
  const values = valuesByHoldingsKey(rows);
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  const exposure = {};
  const heldIn = {};
  for (const [fund, h] of Object.entries(holdings)) {
    if (!values[fund]) continue;
    for (const [stock, w] of Object.entries(h)) {
      const x = (values[fund] * w) / 100;
      exposure[stock] = (exposure[stock] || 0) + x;
      (heldIn[stock] = heldIn[stock] || {})[fund] = x;
    }
  }
  const nameOf = (s) => overlap?.names?.[s] || s;
  const shortOf = (k) => (rows || []).find((r) => (r.holdingsKey || r.key) === k)?.short || k;

  const adaniStocks = overlap?.groups?.adani || [];
  const adaniByStock = adaniStocks.map((s) => ({ stock: s, name: nameOf(s), value: exposure[s] || 0 })).filter((a) => a.value > 0).sort((a, b) => b.value - a.value);
  const adaniByFund = {};
  for (const s of adaniStocks) for (const [fund, x] of Object.entries(heldIn[s] || {})) adaniByFund[fund] = (adaniByFund[fund] || 0) + x;
  const adaniTotal = adaniByStock.reduce((a, b) => a + b.value, 0);

  const shared = Object.entries(exposure)
    .filter(([s]) => Object.keys(heldIn[s] || {}).length >= 2)
    .map(([s, v]) => ({ stock: s, name: nameOf(s), value: v, pct: total > 0 ? (v / total) * 100 : 0, funds: Object.keys(heldIn[s]).map(shortOf) }))
    .sort((a, b) => b.value - a.value);

  const keys = Object.keys(holdings).filter((k) => values[k]);
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = holdings[keys[i]];
      const b = holdings[keys[j]];
      let o = 0;
      for (const s in a) if (s in b) o += Math.min(a[s], b[s]);
      pairs.push({ a: shortOf(keys[i]), b: shortOf(keys[j]), pct: o });
    }
  }
  pairs.sort((x, y) => y.pct - x.pct);

  const stocks = Object.entries(exposure)
    .map(([st, v]) => ({ stock: st, name: nameOf(st), value: v, pct: total > 0 ? (v / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const futures = overlap?.futures || [];
  return {
    total,
    stocks,
    adani: {
      total: adaniTotal,
      pct: total > 0 ? (adaniTotal / total) * 100 : 0,
      byStock: adaniByStock,
      byFund: Object.entries(adaniByFund).map(([k, v]) => ({ fund: shortOf(k), value: v })).sort((a, b) => b.value - a.value),
      // Futures are not part of the totals; they are listed so the number is not read as complete.
      futures: futures.map((f) => ({ ...f, value: ((values[f.fund] || 0) * f.weight) / 100 })).filter((f) => f.value > 0),
    },
    shared,
    pairs,
  };
}

// The last `days` calendar days of a computeHistory result (the whole thing when `days` is empty or longer than it).
export function sliceHistory(history, days) {
  const n = history?.dates?.length || 0;
  if (!n || !days) return history;
  const from = addDaysISO(history.dates[n - 1], -days);
  const first = history.dates.findIndex((d) => d >= from);
  const i = first < 0 ? 0 : first;
  const cut = (a) => (a || []).slice(i);
  return { ...history, dates: cut(history.dates), value: cut(history.value), invested: cut(history.invested), day: cut(history.day) };
}

// What the portfolio is made of, for a donut: slices by fund, fund house or category, largest first. Beyond `maxSlices`
// the small ones are folded into "Others" so the donut and its legend stay readable.
export function computeAllocation(rows, by = 'category', maxSlices = 6) {
  const labelOf = (r) => (by === 'fund' ? r.short || r.name : by === 'amc' ? r.amc : r.category) || 'Other';
  const total = (rows || []).reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0);
  const groups = new Map();
  for (const r of rows || []) {
    if (!(r.value > 0)) continue;
    const label = labelOf(r);
    const g = groups.get(label) || { label, value: 0, count: 0 };
    g.value += r.value;
    g.count += 1;
    groups.set(label, g);
  }
  let slices = [...groups.values()].sort((a, b) => b.value - a.value);
  if (slices.length > maxSlices) {
    const rest = slices.slice(maxSlices - 1);
    slices = [...slices.slice(0, maxSlices - 1), { label: 'Others', value: rest.reduce((a, g) => a + g.value, 0), count: rest.reduce((a, g) => a + g.count, 0), others: rest.map((g) => g.label) }];
  }
  return slices.map((g) => ({ ...g, pct: total > 0 ? (g.value / total) * 100 : 0 }));
}

// ---------- recorded trades ----------

// Validates the "record a trade" form and works out what is not typed. Give the amount and the units come from the NAV
// on or before the date; give the units and the amount does. A purchase is allotted at a business day's NAV, so for
// an exact figure type the units from your statement. `heldUnits` stops a sale larger than what is held.
export function buildTrade({ fundKey, kind, date, amount, units, funds, navByCode, heldUnits = null, today = null }) {
  const fund = (funds || []).find((f) => f.key === fundKey);
  if (!fund) return { ok: false, error: 'Pick a fund.' };
  if (kind !== 'buy' && kind !== 'sell') return { ok: false, error: 'Choose bought or sold.' };
  if (!isIsoDate(date)) return { ok: false, error: 'Use a date like 2026-11-21.' };
  if (today && date > today) return { ok: false, error: 'That date is in the future.' };
  const amt = Number(amount);
  const typedUnits = Number(units);
  const hasAmount = Number.isFinite(amt) && amt > 0;
  const hasUnits = Number.isFinite(typedUnits) && typedUnits > 0;
  if (!hasAmount && !hasUnits) return { ok: false, error: 'Enter the amount or the units.' };

  const nav = navOnOrBefore(navByCode?.[String(fund.schemeCode)], date);
  let tradeUnits = hasUnits ? typedUnits : null;
  let tradeAmount = hasAmount ? amt : null;
  if (tradeUnits == null) {
    if (!nav) return { ok: false, error: 'There is no NAV on or before that date yet, so enter the units.' };
    tradeUnits = amt / nav[1];
  }
  if (tradeAmount == null) {
    if (nav) tradeAmount = typedUnits * nav[1];
    else if (kind === 'buy') return { ok: false, error: 'There is no NAV on or before that date yet, so enter the amount.' };
    else tradeAmount = 0;
  }
  tradeUnits = Math.round(tradeUnits * 1e3) / 1e3;
  tradeAmount = Math.round(tradeAmount * 100) / 100;
  if (kind === 'sell' && heldUnits != null && tradeUnits > heldUnits + 0.0005) {
    return { ok: false, error: `You hold about ${Number(heldUnits).toLocaleString('en-IN', { maximumFractionDigits: 3 })} units, fewer than this sale.` };
  }
  return { ok: true, trade: { fundKey, kind, date, units: tradeUnits, amount: tradeAmount }, nav: nav ? { date: nav[0], value: nav[1] } : null };
}

// ---------- sync reminders ----------

const CAS_DUE_DAYS = 35;
const OVERLAP_DUE_DAYS = 45;

// Reminders shown above the numbers. Kite holdings are due after a week (SIP estimates cover the days between); a
// CAS is due after about a month. Nothing is said before the first setup.
export function syncNudges({ sync, hasSetup, overlapDate = null, today = null }) {
  if (!hasSetup || !sync) return [];
  const out = [];
  if (sync.kite.level === 'never') {
    out.push({ key: 'kite', level: 'old', text: 'Zerodha holdings have not been synced yet.' });
  } else if (sync.kite.level === 'old') {
    out.push({ key: 'kite', level: 'old', text: `Zerodha holdings were last synced ${sync.kite.days} days ago. Units since then are SIP estimates.` });
  }
  if (sync.cas.level !== 'never' && sync.cas.days > CAS_DUE_DAYS) {
    out.push({ key: 'cas', level: 'stale', text: `Funds outside Zerodha were last updated from a CAS ${sync.cas.days} days ago.` });
  }
  // The overlap numbers come from monthly portfolio disclosures, so they go stale on their own.
  if (overlapDate && today && isIsoDate(overlapDate) && daysBetween(overlapDate, today) > OVERLAP_DUE_DAYS) {
    out.push({ key: 'overlap', level: 'stale', text: `The overlap data is from the ${formatShortDate(overlapDate)} disclosures, ${daysBetween(overlapDate, today)} days ago.` });
  }
  return out;
}

// Which Settings tab fixes a reminder: holdings, CAS and overlap data are imported; limits are edited.
export function nudgeTarget(key) {
  if (typeof key === 'string' && key.startsWith('limit')) return 'portfolioLimits';
  if (key === 'kite' || key === 'cas' || key === 'overlap') return 'portfolioData';
  return null;
}

// ---------- concentration limits ----------

// Where the portfolio stands on the things worth capping. `overlap` is computeOverlap's result (null without data).
export function computeMetrics(rows, overlap) {
  const total = (rows || []).reduce((a, r) => a + r.value, 0);
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0);
  const byAmc = {};
  const byCategory = {};
  for (const r of rows || []) {
    byAmc[r.amc || 'Other'] = (byAmc[r.amc || 'Other'] || 0) + pct(r.value);
    byCategory[r.category || 'Other'] = (byCategory[r.category || 'Other'] || 0) + pct(r.value);
  }
  const byHoldings = valuesByHoldingsKey(rows);
  const nameOfFund = (k) => (rows || []).find((r) => (r.holdingsKey || r.key) === k)?.short || k;
  const topFund = Object.entries(byHoldings).sort((a, b) => b[1] - a[1])[0];
  const topStock = overlap?.stocks?.[0] || null;
  return {
    total,
    adaniPct: overlap ? overlap.adani.pct : null,
    byAmc,
    byCategory,
    maxFund: topFund ? { name: nameOfFund(topFund[0]), pct: pct(topFund[1]) } : null,
    maxStock: topStock ? { name: topStock.name, pct: topStock.pct } : null,
  };
}

// Starting points, shown as suggestions until you save your own. They are placeholders, not advice.
export const DEFAULT_LIMITS = [
  { id: 'adani', metric: 'adani', max: 8 },
  { id: 'amc-Quant', metric: 'amc', name: 'Quant', max: 40 },
  { id: 'cat-Thematic', metric: 'category', name: 'Thematic', max: 35 },
  { id: 'cat-Small cap', metric: 'category', name: 'Small cap', max: 25 },
  { id: 'stock', metric: 'stock', max: 3 },
  { id: 'fund', metric: 'fund', max: 15 },
];

const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'on', 'to', 'for']);
const titleCase = (text) =>
  String(text || '')
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

export function limitLabel(limit) {
  switch (limit.metric) {
    case 'adani':
      return 'Adani Group';
    case 'amc':
      return `${titleCase(limit.name)} Funds`;
    case 'category':
      return `${titleCase(limit.name)} Funds`;
    case 'stock':
      return 'Largest Single Stock';
    case 'fund':
      return 'Largest Single Fund';
    default:
      return limit.id;
  }
}

export function limitValue(metrics, limit) {
  switch (limit.metric) {
    case 'adani':
      return metrics.adaniPct;
    case 'amc':
      return metrics.byAmc[limit.name] ?? 0;
    case 'category':
      return metrics.byCategory[limit.name] ?? 0;
    case 'stock':
      return metrics.maxStock ? metrics.maxStock.pct : null;
    case 'fund':
      return metrics.maxFund ? metrics.maxFund.pct : null;
    default:
      return null;
  }
}

// Each limit with its current value and a status: ok, near (from 85% of the limit) or breach (over it).
export function evaluateLimits(limits, metrics) {
  const out = [];
  for (const l of limits || []) {
    const value = limitValue(metrics, l);
    if (value == null || !(Number(l.max) > 0)) continue;
    const usage = value / Number(l.max);
    const detail = l.metric === 'stock' ? metrics.maxStock?.name : l.metric === 'fund' ? metrics.maxFund?.name : null;
    out.push({ ...l, label: limitLabel(l), value, usage, detail, status: usage > 1 ? 'breach' : usage >= 0.85 ? 'near' : 'ok' });
  }
  return out;
}

export function limitNudges(evaluated) {
  return (evaluated || [])
    .filter((e) => e.status === 'breach')
    .map((e) => ({ key: `limit-${e.id}`, level: 'old', text: `${e.label}${e.detail ? ` (${e.detail})` : ''} is ${e.value.toFixed(1)}% against your ${Number(e.max)}% limit.` }));
}

// ---------- SIP what-if ----------

// The portfolio after `days` more trading days of SIPs at `plan` rupees a day, with prices unchanged (a way to see
// where the money would sit, not a forecast). A fund held in no row yet (a new SIP) is added from the catalog.
export function projectRows({ rows, funds, plan, days }) {
  const have = new Set((rows || []).map((r) => r.key));
  const out = (rows || []).map((r) => ({ ...r, value: r.value + (Number(plan?.[r.key]) || 0) * days }));
  for (const f of funds || []) {
    const a = Number(plan?.[f.key]) || 0;
    if (!have.has(f.key) && a > 0) out.push({ ...f, value: a * days });
  }
  return out;
}

export function simulateSip({ rows, funds, overlapData, plan, days }) {
  const projected = projectRows({ rows, funds, plan, days });
  const overlap = overlapData ? computeOverlap(overlapData, projected) : null;
  return { rows: projected, metrics: computeMetrics(projected, overlap), perDay: Object.values(plan || {}).reduce((a, v) => a + (Number(v) || 0), 0) };
}

// ---------- fund versus benchmark ----------

export const BENCHMARK_PERIODS = [
  ['1M', 30],
  ['3M', 91],
  ['6M', 182],
  ['1Y', 365],
];

// Percent change from the NAV on or before (latest date - days) to the latest, or null when the history does not
// reach back that far.
export function periodReturnPct(series, days) {
  if (!series || series.length < 2) return null;
  const [lastDate, last] = series[series.length - 1];
  const target = addDaysISO(lastDate, -days);
  if (series[0][0] > addDaysISO(target, 7)) return null; // the history starts too late to answer
  const base = navOnOrBefore(series, target) || series[0];
  return base[1] > 0 ? (last / base[1] - 1) * 100 : null;
}

// One row per distinct scheme, with the return over each period and how far it is from the benchmark's.
export function computeBenchmarkTable({ rows, navByCode, benchmarkCode }) {
  const bench = navByCode?.[String(benchmarkCode)] || null;
  const benchReturns = {};
  for (const [label, days] of BENCHMARK_PERIODS) benchReturns[label] = bench ? periodReturnPct(bench, days) : null;
  const seen = new Set();
  const table = [];
  for (const r of rows || []) {
    const code = String(r.schemeCode);
    if (seen.has(code)) continue;
    seen.add(code);
    const series = navByCode?.[code];
    const returns = {};
    const vs = {};
    for (const [label, days] of BENCHMARK_PERIODS) {
      const v = series ? periodReturnPct(series, days) : null;
      returns[label] = v;
      vs[label] = v != null && benchReturns[label] != null ? v - benchReturns[label] : null;
    }
    table.push({ key: r.key, short: r.short || r.name, category: r.category, returns, vs });
  }
  table.sort((a, b) => (b.vs['1Y'] ?? -Infinity) - (a.vs['1Y'] ?? -Infinity));
  return { benchmark: benchReturns, hasBenchmark: Boolean(bench), table };
}

// Percent change since the start of a window for the benchmark and for each distinct fund scheme, on the benchmark's own
// trading days, for a line chart. A fund whose stored NAVs start too late for the window is left out rather than drawn
// from a wrong starting point (like periodReturnPct).
export function computeRelativeLines({ rows, navByCode, benchmarkCode, days }) {
  const bench = navByCode?.[String(benchmarkCode)] || null;
  if (!bench || bench.length < 2) return { dates: [], benchmark: [], funds: [], hasBenchmark: false };
  const lastDate = bench[bench.length - 1][0];
  const start = addDaysISO(lastDate, -days);
  if (bench[0][0] > addDaysISO(start, 7)) return { dates: [], benchmark: [], funds: [], hasBenchmark: true, tooShort: true };
  const dates = bench.map(([d]) => d).filter((d) => d >= start);
  if (dates.length < 2) return { dates: [], benchmark: [], funds: [], hasBenchmark: true, tooShort: true };
  const line = (series) => {
    if (!series || series.length < 2 || series[0][0] > addDaysISO(start, 7)) return null;
    const base = navOnOrBefore(series, dates[0]) || series[0];
    if (!(base[1] > 0)) return null;
    return dates.map((d) => ((navOnOrBefore(series, d)?.[1] ?? base[1]) / base[1] - 1) * 100);
  };
  const seen = new Set();
  const funds = [];
  for (const r of rows || []) {
    const code = String(r.schemeCode);
    if (seen.has(code)) continue;
    seen.add(code);
    const values = line(navByCode?.[code]);
    if (values) funds.push({ key: r.key, short: r.short || r.name, value: r.value, values, last: values[values.length - 1] });
  }
  return { dates, benchmark: line(bench), funds, hasBenchmark: true };
}

// ONE-OFF TOOL (remove with PortfolioBenchmarkTool once the benchmark is saved): turns pasted text into the benchmark the
// catalog should name. It takes `{ schemeCode, name }`, or a setup file and reads only `catalog.benchmark` (or `benchmark`)
// out of it, so no holding in a pasted file is ever looked at or saved.
export function parseBenchmarkInput(text) {
  let json;
  try {
    json = JSON.parse(String(text || '').trim());
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the benchmark file, or the setup file.' };
  }
  const found = json && typeof json === 'object' ? (json.catalog?.benchmark ?? json.benchmark ?? (json.schemeCode != null ? json : null)) : null;
  if (!found || typeof found !== 'object') return { ok: false, error: 'No benchmark found. Expected { "schemeCode": "...", "name": "..." }.' };
  const schemeCode = String(found.schemeCode ?? '').trim();
  const name = String(found.name ?? '').trim();
  if (!/^\d{3,8}$/.test(schemeCode)) return { ok: false, error: 'The scheme code should be the fund\'s number on mfapi.in (digits only).' };
  if (!name || name.length > 120) return { ok: false, error: 'The benchmark needs a name (up to 120 characters).' };
  return { ok: true, benchmark: { schemeCode, name } };
}

// ---------- long-horizon illustration ----------

// What a corpus could grow to if it earned `annualReturnPct` a year (compounded monthly) with `monthlySip` added at each
// month end, optionally rising by `stepUpPct` each year. An illustration of arithmetic, not a forecast.
export function projectCorpus({ start, monthlySip, annualReturnPct, years, stepUpPct = 0 }) {
  const r = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  let value = Number(start) || 0;
  let invested = Number(start) || 0;
  let sip = Number(monthlySip) || 0;
  const out = [{ year: 0, value, invested }];
  for (let m = 1; m <= Math.round(years * 12); m += 1) {
    value = value * (1 + r) + sip;
    invested += sip;
    if (m % 12 === 0) {
      out.push({ year: m / 12, value, invested });
      sip *= 1 + stepUpPct / 100;
    }
  }
  return out;
}

// A rupee amount `year` years out, expressed in today's money after `inflationPct` a year.
export function inTodaysMoney(value, year, inflationPct) {
  return (Number(value) || 0) / Math.pow(1 + (Number(inflationPct) || 0) / 100, year);
}

// The headline for one scenario at one year of a projectCorpus path: what it grows to, how much of that you put in
// versus what growth added (investedShare is 0..1, for the bar), and the same value in today's money.
export function summariseProjection(path, year, inflationPct) {
  const point = (path || []).find((p) => p.year === year) || { value: 0, invested: 0 };
  const value = point.value;
  const growth = Math.max(value - point.invested, 0);
  return {
    year,
    value,
    invested: point.invested,
    growth,
    investedShare: value > 0 ? Math.min(Math.max(point.invested / value, 0), 1) : 1,
    real: inTodaysMoney(value, year, inflationPct),
  };
}

// ---------- export ----------

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// The holdings table as CSV (rupees and units unrounded enough to re-add), for a spreadsheet.
export function holdingsToCsv(rows) {
  const head = ['Fund', 'Held at', 'Fund house', 'Category', 'Units', 'Average cost', 'Invested', 'NAV', 'NAV date', 'Value', 'P&L', 'P&L %', 'Day change'];
  const lines = [head.join(',')];
  for (const r of rows || []) {
    lines.push(
      [
        r.name,
        r.group === 'zerodha' ? 'Zerodha' : 'Other',
        r.amc,
        r.category,
        r.units.toFixed(3),
        r.avgCost.toFixed(4),
        r.cost.toFixed(2),
        r.nav,
        r.navDate,
        r.value.toFixed(2),
        r.pnl.toFixed(2),
        r.pnlPct.toFixed(2),
        r.day.toFixed(2),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// ---------- display ----------

// Axis labels: lakh / crore for the big numbers, the way the rest of the app reads rupees.
export function formatRupeesCompact(n) {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)}L`;
  if (v >= 1e3) return `${sign}₹${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(v)}`;
}
