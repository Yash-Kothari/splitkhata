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

// ---------- whose holdings ----------

// A catalog fund (and a snapshot) says whose it is with `owner`, a household member's name. Without one it is the default
// person's, so everything imported before a second person existed needs no migration.
export const DEFAULT_OWNER = 'Yash';
export const ownerOf = (item) => item?.owner || DEFAULT_OWNER;

// A catalog entry is a mutual fund unless it says `kind: 'stock'`: a share held directly. A stock is priced from the price saved
// with each import (a price point in the same store as NAVs, under its own key), has no SIP, and counts as 100% of its own
// company in the overlap and concentration numbers.
export const isStock = (f) => f?.kind === 'stock';

// The people who hold something, the default person first, the rest in the order they appear.
export function ownersOf(funds) {
  const seen = [];
  for (const f of funds || []) if (!seen.includes(ownerOf(f))) seen.push(ownerOf(f));
  return [...seen.filter((o) => o === DEFAULT_OWNER), ...seen.filter((o) => o !== DEFAULT_OWNER)];
}

// One person's funds, or all of them when `view` is empty ("Combined").
export function fundsForView(funds, view) {
  return view ? (funds || []).filter((f) => ownerOf(f) === view) : funds || [];
}

// A { fundKey: rupees } plan cut down to the given funds, so a sum over it is that view's SIP and not everyone's.
export function planForFunds(plan, funds) {
  const keep = new Set((funds || []).map((f) => f.key));
  return Object.fromEntries(Object.entries(plan || {}).filter(([k]) => keep.has(k)));
}

// Where each person's last import is recorded (`state.lastSync`): the default person keeps the plain source name, so what
// was saved before stays valid, and anyone else gets "kite:Kruti".
export function lastSyncKey(source, owner) {
  return !owner || owner === DEFAULT_OWNER ? source : `${source}:${owner}`;
}

const SYNC_RANK = { never: 3, old: 2, stale: 1, fresh: 0 };

// How fresh the holdings in a view are, for each place they come from (mutual funds at Zerodha / Kite, funds elsewhere / CAS, and
// stocks at Kite). A view with several people is only as fresh as its stalest part, and a person who holds nothing at a place
// is not counted for it.
export function computeSyncStatus({ funds, snapshots, state, view = null, today }) {
  const inView = fundsForView(funds, view);
  const people = ownersOf(inView);
  if (people.length === 0) people.push(view || DEFAULT_OWNER);
  const out = {};
  const places = [
    { name: 'kite', source: 'kite', holds: (f) => !isStock(f) && f.group === 'zerodha' },
    { name: 'cas', source: 'cas', holds: (f) => !isStock(f) && f.group === 'other' },
    { name: 'stocks', source: 'kite_stocks', holds: (f) => isStock(f) && f.group === 'zerodha' },
  ];
  for (const { name, source, holds } of places) {
    let relevant = people.filter((o) => inView.some((f) => ownerOf(f) === o && holds(f)));
    out[`${name}Used`] = relevant.length > 0;
    if (relevant.length === 0) relevant = [people[0]];
    const per = relevant.map((o) => {
      const recorded = state?.lastSync?.[lastSyncKey(source, o)];
      const fromSnapshots = (snapshots || []).reduce((d, sn) => (sn.source === source && ownerOf(sn) === o && sn.date > d ? sn.date : d), '');
      const date = recorded?.date || fromSnapshots || null;
      return { owner: o, date, at: recorded?.at?.toDate?.() ?? null, status: classifySync(date, today) };
    });
    per.sort((a, b) => SYNC_RANK[b.status.level] - SYNC_RANK[a.status.level] || (a.date || '').localeCompare(b.date || ''));
    out[name] = per[0].status;
    out[`${name}Date`] = per[0].date;
    out[`${name}At`] = per[0].at;
    out[`${name}ByOwner`] = per;
  }
  return out;
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
  const soldKeys = [];
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
    // A holding whose units have gone to zero (sold) is left out. A fund stays while it still held units at the previous
    // close, so the sale day's P&L is not lost. A stock's price only moves at imports, so it has no "today".
    if (h.units <= 0 && (isStock(f) || before.units <= 0)) {
      soldKeys.push(f.key);
      continue;
    }
    const value = h.units * nav;
    const day = isStock(f) ? 0 : before.units * (nav - prev[1]);
    rows.push({
      ...f,
      owner: ownerOf(f),
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
      dayPct: !isStock(f) && prev[1] > 0 ? (nav / prev[1] - 1) * 100 : 0,
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
    soldKeys,
    total,
    byGroup: { zerodha: totalOf(rows.filter((r) => r.group === 'zerodha')), other: totalOf(rows.filter((r) => r.group === 'other')) },
    byOwner: Object.fromEntries(ownersOf(rows).map((o) => [o, totalOf(rows.filter((r) => r.owner === o))])),
    // The date of the newest NAV: stocks are priced at imports, so they do not decide how current the NAVs are.
    navDate: (rows.some((r) => !isStock(r)) ? rows.filter((r) => !isStock(r)) : rows).reduce((d, r) => (r.navDate > d ? r.navDate : d), ''),
    byKind: { funds: totalOf(rows.filter((r) => !isStock(r))), stocks: totalOf(rows.filter((r) => isStock(r))) },
    estimatedCount: rows.filter((r) => r.estimated).length,
  };
}

// Portfolio value and day-over-day P&L for the last `days` trading days. Units at each date come from the nearest
// earlier snapshot plus SIP-estimated units; before the first snapshot they are held at the first snapshot's units
// (there is nothing earlier to go on), which `constantBefore` reports so the chart can say so.
// `calendarFunds` are the funds whose prices decide which dates count as trading days (everyone's, so one person's line and the
// combined line sit on the same dates); it defaults to `funds`.
export function computeHistory({ funds, snapshots, navByCode, sipPlan = {}, sipSchedule = null, trades = [], days = 90, calendarFunds = null }) {
  const ordered = [...(snapshots || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const isLive = (f) => navByCode?.[String(f.schemeCode)]?.length && ordered.some((s) => s.positions?.[f.key]);
  const live = (funds || []).filter(isLive);
  if (live.length === 0) return { dates: [], value: [], invested: [], day: [], constantBefore: null };

  // A trading day is one most of the funds priced (liquid funds also publish on weekends).
  // Stocks are priced only at imports, so they never decide which days are trading days (unless there is nothing else).
  const calendar = (calendarFunds || []).filter((f) => isLive(f) && !isStock(f));
  const dated = calendar.length ? calendar : live.some((f) => !isStock(f)) ? live.filter((f) => !isStock(f)) : live;
  const counts = new Map();
  for (const f of dated) for (const [d] of navByCode[String(f.schemeCode)]) counts.set(d, (counts.get(d) || 0) + 1);
  const need = Math.ceil(dated.length / 2);
  const all = [...counts.entries()].filter(([, c]) => c >= need).map(([d]) => d).sort();
  // A stock priced at an import after the newest NAV day (a weekend, or before the evening NAV publish) still counts as the
  // latest date, so the chart's last point carries the same prices as the summary.
  const lastNavDay = all[all.length - 1];
  if (lastNavDay) {
    const later = new Set();
    for (const f of live) if (isStock(f)) for (const [d] of navByCode[String(f.schemeCode)]) if (d > lastNavDay) later.add(d);
    all.push(...[...later].sort());
  }
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
      // A stock has no price before its first import, so before then it is left out of the put-in as well as the value.
      if (nav != null || !isStock(pf.f)) c += costAt(pf, date);
      // A stock's price only changes at an import, so its jump would show as one day's profit: it has no daily P&L.
      if (!isStock(pf.f) && prevUnits && nav != null && prevNavs[i] != null) d += prevUnits[i] * (nav - prevNavs[i]);
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

function positionsToMap(positions, funds, source, owner = DEFAULT_OWNER, extraPrices = {}) {
  // Accepts { key: {units, avgCost, price?} } or [ { key | isin | symbol, units, avgCost, price? } ]. A bare isin (or, for a stock,
  // symbol) means that person's fund or stock at the place the source is about. A stock position needs a price.
  const byKey = new Map((funds || []).map((f) => [f.key, f]));
  const placeOk = (f) => (source === 'kite' ? f.group === 'zerodha' && !isStock(f) : source === 'kite_stocks' ? f.group === 'zerodha' && isStock(f) : true);
  const out = {};
  const prices = {};
  const problems = [];
  const list = Array.isArray(positions) ? positions : Object.entries(positions || {}).map(([key, p]) => ({ key, ...p }));
  for (const p of list) {
    let key = p.key;
    if (!key && (p.isin || p.symbol)) {
      const hit = (funds || []).find((f) => ownerOf(f) === owner && placeOk(f) && (p.isin ? f.isin === p.isin : f.symbol === p.symbol));
      key = hit?.key;
    }
    if (!key || !byKey.has(key)) {
      problems.push(`Unknown ${source === 'kite_stocks' ? 'stock' : 'fund'} ${p.key || p.isin || p.symbol || '(no id)'}`);
      continue;
    }
    const fund = byKey.get(key);
    if (ownerOf(fund) !== owner) {
      problems.push(`${key} belongs to ${ownerOf(fund)}, not ${owner}`);
      continue;
    }
    const units = Number(p.units);
    const avgCost = Number(p.avgCost);
    if (!Number.isFinite(units) || units < 0 || !Number.isFinite(avgCost) || avgCost < 0) {
      problems.push(`Bad units or cost for ${key}`);
      continue;
    }
    if (isStock(fund) && units > 0) {
      const price = Number(p.price ?? extraPrices?.[key]);
      if (!Number.isFinite(price) || price <= 0) {
        problems.push(`No price for ${fund.symbol || fund.short || key}`);
        continue;
      }
      prices[key] = Math.round(price * 1e4) / 1e4;
    }
    // The same holding on two rows (a share held on NSE and BSE) is one holding: the shares add up at their weighted average cost.
    const before = out[key];
    if (before) {
      const total = before.units + units;
      const cost = before.units * before.avgCost + units * avgCost;
      out[key] = { units: Math.round(total * 1e3) / 1e3, avgCost: total > 0 ? Math.round((cost / total) * 1e6) / 1e6 : 0 };
    } else {
      out[key] = { units: Math.round(units * 1e3) / 1e3, avgCost: Math.round(avgCost * 1e6) / 1e6 };
    }
  }
  return { positions: out, prices, problems };
}

// Turns pasted text into something the import preview can show. Two shapes are accepted:
//  - the array Kite's mutual-fund holdings call returns ([{ tradingsymbol (the ISIN), quantity, average_price }]),
//    stamped with `asOfDefault` and mapped to that person's Zerodha funds;
//  - an object { asOf, source, owner?, positions, catalog?, overlap?, sipPlan? }, used for the first setup and for funds
//    held outside Zerodha (positions from a CAS statement).
// `owner` is whose holdings the file is (the person chosen in the form); a file that names a different owner is refused, and
// so is a name outside `people` when that list is given.
// `catalog` is the catalog document as stored. An imported catalog replaces only that person's funds (see mergeCatalog).
export function parseImport(text, { catalog = null, asOfDefault, today, owner = null, people = null, heldKeys = null }) {
  let json;
  try {
    json = JSON.parse(String(text || '').trim());
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the whole file.' };
  }
  const isKite = Array.isArray(json);
  // Kite's equity holdings carry an exchange and a last price; its mutual-fund holdings carry the ISIN as the symbol.
  const isEquity = isKite && json.some((h) => h && h.exchange);
  const body = isKite
    ? {
        positions: isEquity
          ? json.map((h) => ({ isin: h.isin, symbol: h.tradingsymbol, units: (Number(h.quantity) || 0) + (Number(h.t1_quantity) || 0), avgCost: h.average_price, price: h.last_price }))
          : json.map((h) => ({ isin: h.tradingsymbol, units: h.quantity, avgCost: h.average_price })),
        source: isEquity ? 'kite_stocks' : 'kite',
      }
    : json;
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a snapshot object or a list of holdings.' };

  const asOf = body.asOf || asOfDefault;
  if (!isIsoDate(asOf)) return { ok: false, error: 'The snapshot needs an as-of date like 2026-11-21.' };
  if (today && asOf > today) return { ok: false, error: 'The as-of date is in the future.' };
  // Names are matched exactly ("kruti" is not "Kruti"), so a file may only name someone the household actually has.
  const fileOwner = body.owner == null ? null : String(body.owner).trim();
  if (fileOwner && people && !people.includes(fileOwner)) return { ok: false, error: `${fileOwner} is not one of the people on this portfolio (${people.join(', ')}).` };
  if (fileOwner && owner && fileOwner !== owner) return { ok: false, error: `This file is for ${fileOwner}, but you chose ${owner}. Pick ${fileOwner} to import it.` };
  // A setup file replaces a person's whole fund list, so with more than one person it must say whose it is (or you must choose),
  // never silently fall back to the first person.
  if (body.catalog && !fileOwner && !owner && people && people.length > 1) return { ok: false, error: 'This setup file does not say whose it is. Choose a person above, then import it.' };
  const who = fileOwner || owner || DEFAULT_OWNER;
  if (people && !people.includes(who)) return { ok: false, error: `${who} is not one of the people on this portfolio (${people.join(', ')}).` };

  let funds = catalog?.funds;
  let keptOthers = (catalog?.funds || []).filter((f) => ownerOf(f) !== who).length;
  let replaced = (catalog?.funds || []).filter((f) => ownerOf(f) === who).length;
  if (body.catalog) {
    const merged = mergeCatalog(catalog, body.catalog, who);
    if (!merged.ok) return { ok: false, error: merged.error };
    funds = merged.catalog.funds;
  }
  if (!Array.isArray(funds) || funds.length === 0) return { ok: false, error: 'No fund list yet. Import the setup file first.' };

  const source = body.source || 'manual';
  const { positions, prices, problems } = positionsToMap(body.positions, funds, source, who, body.prices);
  if (problems.length) return { ok: false, error: problems.slice(0, 4).join('. ') + (problems.length > 4 ? ` (+${problems.length - 4} more)` : '') };
  if (Object.keys(positions).length === 0) return { ok: false, error: 'No holdings found in that text.' };

  // A Kite stock list is the whole list for that person's Zerodha stocks, so one that is missing from it has been sold: it is set
  // to zero (the preview lists them). `heldKeys` limits that to stocks actually held now, so a long-sold one is not listed again.
  const removed = [];
  if (source === 'kite_stocks') {
    for (const f of funds) {
      if (ownerOf(f) !== who || !isStock(f) || f.group !== 'zerodha' || positions[f.key]) continue;
      if (heldKeys && !new Set(heldKeys).has(f.key)) continue;
      positions[f.key] = { units: 0, avgCost: 0 };
      removed.push(f.short || f.name);
    }
  }

  const warnings = [];
  // With more than one person and nobody chosen, a Kite list goes to the default person: say so, in case it is someone else's.
  if (isKite && !owner && people && people.length > 1) warnings.push(`No person is chosen, so this goes to ${who}. Pick the right person above if it is someone else's.`);
  if (isKite && !isEquity) {
    const missing = funds.filter((f) => ownerOf(f) === who && !isStock(f) && f.group === 'zerodha' && !positions[f.key]).map((f) => f.short || f.name);
    if (missing.length) warnings.push(`Not in this Kite list (left as before): ${missing.join(', ')}`);
  }
  // Funds and stocks this person has now that the new catalog does not list: they leave the fund list (their old positions stay in
  // the snapshots but are no longer shown), so the preview names them.
  const dropped = body.catalog ? (catalog?.funds || []).filter((f) => ownerOf(f) === who && !funds.some((x) => x.key === f.key)).map((f) => f.short || f.name || f.key) : [];
  if (!body.catalog) {
    replaced = 0;
    keptOthers = 0;
  }
  return {
    ok: true,
    warnings,
    funds,
    summary: { owner: who, replacedFunds: replaced, keptOtherFunds: keptOthers, removed, dropped },
    payload: { asOf, source, owner: who, positions, prices, catalog: body.catalog || null, overlap: body.overlap || null, sipPlan: body.sipPlan || null },
  };
}

// An imported catalog replaces only the importing person's funds: everyone else's stay as they are, and so does the benchmark
// unless the file names one. Each fund is stamped with its owner (the default person's stay unstamped, as before), and a key
// already used by someone else's fund is refused, because positions, trades and the SIP plan are all keyed by fund.
export function mergeCatalog(existing, incoming, owner = DEFAULT_OWNER) {
  const mine = (incoming?.funds || []);
  if (!Array.isArray(incoming?.funds) || mine.length === 0) return { ok: false, error: 'The catalog in that file has no funds.' };
  const others = (existing?.funds || []).filter((f) => ownerOf(f) !== owner);
  const taken = new Map(others.map((f) => [f.key, ownerOf(f)]));
  const seen = new Set();
  const stamped = [];
  for (const f of mine) {
    if (!f?.key) return { ok: false, error: 'A fund in that catalog has no key.' };
    if (f.owner && f.owner !== owner) return { ok: false, error: `Fund ${f.key} in that file is ${f.owner}'s, but the import is for ${owner}.` };
    if (taken.has(f.key)) return { ok: false, error: `Fund key ${f.key} is already ${taken.get(f.key)}'s. Give ${owner}'s fund its own key.` };
    if (seen.has(f.key)) return { ok: false, error: `Fund key ${f.key} appears twice in that catalog.` };
    seen.add(f.key);
    let entry = f;
    if (isStock(f)) {
      const symbol = f.symbol || f.stockId;
      if (!symbol) return { ok: false, error: `Stock ${f.key} needs a symbol.` };
      if (/[\/\\]/.test(String(symbol))) return { ok: false, error: `The symbol ${symbol} cannot contain a slash.` };
      // The price is stored under the symbol, so two people holding the same stock share one price history.
      entry = { ...f, symbol, stockId: f.stockId || symbol, exchange: f.exchange || 'NSE', group: f.group || 'zerodha', schemeCode: String(f.schemeCode || `STK_${symbol}`), holdingsKey: f.holdingsKey || f.key };
    }
    const { owner: _drop, ...rest } = entry;
    stamped.push(owner === DEFAULT_OWNER ? rest : { ...rest, owner });
  }
  const all = [...others, ...stamped];
  const funds = ownersOf(all).flatMap((o) => all.filter((f) => ownerOf(f) === o));
  const benchmark = incoming.benchmark || existing?.benchmark || null;
  return { ok: true, catalog: { ...(existing || {}), funds, ...(benchmark ? { benchmark } : {}) } };
}

// Overlap data is by fund (holdingsKey), shared by whoever holds the fund, so an import adds to it. For the funds the file lists,
// its holdings and names replace the stored ones, unless the stored disclosure is newer (an older file then only fills in funds
// not stored yet). A fund the file lists also gets that file's futures, so a closed or changed future is not kept from before.
// Groups only ever grow: a stock is added to a group by an import, never removed by one. The date and its label come from the newer file.
export function mergeOverlap(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  const incomingNewer = (incoming.asOfDate || '') >= (existing.asOfDate || '');
  const pick = (stored, fresh) => {
    const out = { ...(stored || {}), ...(fresh || {}) };
    if (!incomingNewer) for (const k of Object.keys(fresh || {})) if (stored && k in stored) out[k] = stored[k];
    return out;
  };
  const groups = {};
  for (const k of new Set([...Object.keys(existing.groups || {}), ...Object.keys(incoming.groups || {})])) {
    groups[k] = [...new Set([...(existing.groups?.[k] || []), ...(incoming.groups?.[k] || [])])];
  }
  const listed = new Set([...Object.keys(incoming.holdings || {}), ...(incoming.futures || []).map((f) => f.fund)]);
  const futures = [];
  for (const f of existing.futures || []) if (!incomingNewer || !listed.has(f.fund)) futures.push(f);
  for (const f of incoming.futures || []) {
    const clash = futures.some((x) => x.fund === f.fund && x.name === f.name);
    // An older file only fills gaps: a fund already stored (its holdings or its futures) is left exactly as stored.
    const storedHasFund = (existing.futures || []).some((x) => x.fund === f.fund) || Object.prototype.hasOwnProperty.call(existing.holdings || {}, f.fund);
    if (!clash && (incomingNewer || !storedHasFund)) futures.push(f);
  }
  const newer = incomingNewer ? incoming : existing;
  const merged = { ...existing, ...incoming, holdings: pick(existing.holdings, incoming.holdings), names: pick(existing.names, incoming.names), groups, futures };
  delete merged.asOf;
  delete merged.asOfDate;
  if (newer.asOf != null) merged.asOf = newer.asOf;
  if (newer.asOfDate != null) merged.asOfDate = newer.asOfDate;
  return merged;
}

// An imported SIP plan covers one person's funds. The first plan ever is stored plainly (it always applied); after that it is
// a dated change from the import date that keeps the schedule and everyone else's amounts, so earlier days keep the plan
// they ran under.
export function mergeSipPlan({ existingDoc, incomingPlan, owner = DEFAULT_OWNER, funds, asOf }) {
  if (!incomingPlan) return { ok: true, sip: null };
  const mineKeys = new Set((funds || []).filter((f) => ownerOf(f) === owner && !isStock(f)).map((f) => f.key));
  const stockKeys = Object.keys(incomingPlan).filter((k) => (funds || []).some((f) => f.key === k && isStock(f)));
  if (stockKeys.length) return { ok: false, error: `A stock has no SIP, but the plan names ${stockKeys.slice(0, 4).join(', ')}.` };
  const unknown = Object.keys(incomingPlan).filter((k) => !mineKeys.has(k));
  if (unknown.length) return { ok: false, error: `The SIP plan names funds that are not ${owner}'s: ${unknown.slice(0, 4).join(', ')}.` };
  const schedule = normalizeSipSchedule(existingDoc);
  const current = schedule.length ? sipPlanAt(schedule, asOf) : {};
  // Everyone else's amounts stay; amounts for a fund that is in no one's catalog any more (a fund dropped by a re-import) go.
  const known = new Set((funds || []).map((f) => f.key));
  const others = Object.fromEntries(Object.entries(current).filter(([k]) => known.has(k) && !mineKeys.has(k)));
  const plan = { ...others, ...incomingPlan };
  if (schedule.length === 0) return { ok: true, sip: { plan } };
  const next = applySipChange(schedule, asOf, plan).map((e) => {
    // A statement dated before a later SIP edit must not leave this person out of the plan in force now: a later entry that has
    // never mentioned any of their funds gets their amounts (an entry that has is a deliberate later edit, and stays).
    if (e.from <= asOf || Object.keys(e.plan).some((k) => mineKeys.has(k))) return e;
    return { from: e.from, plan: { ...e.plan, ...incomingPlan } };
  });
  return { ok: true, sip: { schedule: next, plan: sipPlanAt(next, '9999-12-31') } };
}

// Where a snapshot is stored: the default person's keep the plain name they always had, anyone else's carries their name so
// two people's imports on the same day, from the same place, never overwrite each other.
export function snapshotId(asOf, source, owner = DEFAULT_OWNER) {
  const who = !owner || owner === DEFAULT_OWNER ? '' : `_${String(owner).replace(/[^A-Za-z0-9]+/g, '_')}`;
  return `snap_${asOf}_${String(source).replace(/[^A-Za-z0-9_-]+/g, '_')}${who}`;
}

// Everything one confirmed import writes, worked out from the parsed payload and what is stored, as plain data: the
// snapshot, which sync record it updates, and the catalog, overlap and SIP documents when the file carries them (already
// merged, so nobody else's data is lost). firebase.js only has to write it.
export function buildImportWrites({ payload, existing = /** @type {{ catalog?: any, overlap?: any, sip?: any }} */ ({}) }) {
  const owner = payload.owner || DEFAULT_OWNER;
  let funds = existing.catalog?.funds || [];
  const writes = {
    snapshot: {
      id: snapshotId(payload.asOf, payload.source, owner),
      data: { date: payload.asOf, source: payload.source, positions: payload.positions, ...(owner === DEFAULT_OWNER ? {} : { owner }) },
    },
    syncKey: lastSyncKey(payload.source, owner),
    syncDate: payload.asOf,
    catalog: null,
    overlap: null,
    sip: null,
    prices: [],
  };
  if (payload.catalog) {
    const merged = mergeCatalog(existing.catalog, payload.catalog, owner);
    if (!merged.ok) return { ok: false, error: merged.error };
    writes.catalog = merged.catalog;
    funds = merged.catalog.funds;
  }
  // A stock's price at the import date is saved like a NAV, under its own key, year by year.
  const byDoc = {};
  for (const [key, price] of Object.entries(payload.prices || {})) {
    const fund = funds.find((f) => f.key === key);
    if (!fund) return { ok: false, error: `A price was given for ${key}, which is not in the fund list.` };
    const code = String(fund.schemeCode);
    const year = payload.asOf.slice(0, 4);
    const doc = (byDoc[`${code}|${year}`] ||= { code, year, series: {} });
    doc.series[payload.asOf] = price;
  }
  writes.prices = Object.values(byDoc);
  if (payload.overlap) writes.overlap = mergeOverlap(existing.overlap, payload.overlap);
  if (payload.sipPlan) {
    const sip = mergeSipPlan({ existingDoc: existing.sip, incomingPlan: payload.sipPlan, owner, funds, asOf: payload.asOf });
    if (!sip.ok) return { ok: false, error: sip.error };
    writes.sip = sip.sip;
  }
  return { ok: true, writes };
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
  const fundHoldings = overlap?.holdings || {};
  // A directly held stock is 100% of its own company (under the same id the funds' disclosures use), so it adds to that
  // company's total exposure, to the Adani group, and to "stocks you own several ways", without being a fund in the pairs.
  const stockRows = (rows || []).filter(isStock);
  const holdings = { ...fundHoldings };
  const stockNames = {};
  for (const r of stockRows) {
    const id = r.stockId || r.symbol || r.key;
    holdings[r.holdingsKey || r.key] = { [id]: 100 };
    stockNames[id] = r.name;
  }
  const stockKeys = new Set(stockRows.map((r) => r.holdingsKey || r.key));
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
  const nameOf = (s) => overlap?.names?.[s] || stockNames[s] || s;
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

  const keys = Object.keys(holdings).filter((k) => values[k] && !stockKeys.has(k));
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

// What the portfolio is made of, for a donut: slices by fund, fund house, category, owner or type (mutual fund / stock), largest first. Beyond `maxSlices`
// the small ones are folded into "Others" so the donut and its legend stay readable.
export function computeAllocation(rows, by = 'category', maxSlices = 6) {
  const labelOf = (r) => {
    if (by === 'fund') return r.short || r.name || 'Other';
    if (by === 'owner') return ownerOf(r);
    if (by === 'kind') return isStock(r) ? 'Stocks' : 'Mutual funds';
    if (by === 'amc') return (isStock(r) ? 'Direct stocks' : r.amc) || 'Other';
    return (isStock(r) ? r.sector || 'Stocks' : r.category) || 'Other';
  };
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
  // A stock's price is only known at each import, so there is no price to work one figure out from the other.
  if (isStock(fund) && !(hasAmount && hasUnits)) return { ok: false, error: 'For a stock, enter both the number of shares and the amount paid.' };

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
  // A place nobody in the view holds anything at needs no reminder (`kiteUsed` is absent on older callers: treated as used).
  // With more than one person in the view, the reminder says whose holdings are the stale ones.
  const whose = (list) => (list?.length > 1 ? ` (${list[0].owner})` : '');
  if (sync.kiteUsed !== false) {
    if (sync.kite.level === 'never') {
      out.push({ key: 'kite', level: 'old', text: `Zerodha holdings${whose(sync.kiteByOwner)} have not been synced yet.` });
    } else if (sync.kite.level === 'old') {
      out.push({ key: 'kite', level: 'old', text: `Zerodha holdings${whose(sync.kiteByOwner)} were last synced ${sync.kite.days} days ago. Units since then are SIP estimates.` });
    }
  }
  if (sync.stocks && sync.stocksUsed !== false) {
    if (sync.stocks.level === 'never') {
      out.push({ key: 'stocks', level: 'old', text: `Stocks${whose(sync.stocksByOwner)} have not been synced yet.` });
    } else if (sync.stocks.level === 'old') {
      out.push({ key: 'stocks', level: 'old', text: `Stocks${whose(sync.stocksByOwner)} were last synced ${sync.stocks.days} days ago. Their prices are as of then.` });
    }
  }
  if (sync.casUsed !== false && sync.cas.level !== 'never' && sync.cas.days > CAS_DUE_DAYS) {
    out.push({ key: 'cas', level: 'stale', text: `Funds outside Zerodha${whose(sync.casByOwner)} were last updated from a CAS ${sync.cas.days} days ago.` });
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
  if (key === 'kite' || key === 'cas' || key === 'stocks' || key === 'overlap') return 'portfolioData';
  return null;
}

// ---------- concentration limits ----------

// Where the portfolio stands on the things worth capping. `overlap` is computeOverlap's result (null without data).
export function computeMetrics(rows, overlap) {
  const total = (rows || []).reduce((a, r) => a + r.value, 0);
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0);
  const byAmc = {};
  const byCategory = {};
  // Fund house, category and "largest single fund" are about funds; a direct stock counts only in the stock numbers (via overlap).
  const funds = (rows || []).filter((r) => !isStock(r));
  for (const r of funds) {
    byAmc[r.amc || 'Other'] = (byAmc[r.amc || 'Other'] || 0) + pct(r.value);
    byCategory[r.category || 'Other'] = (byCategory[r.category || 'Other'] || 0) + pct(r.value);
  }
  const byHoldings = valuesByHoldingsKey(funds);
  const nameOfFund = (k) => funds.find((r) => (r.holdingsKey || r.key) === k)?.short || k;
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
  for (const r of (rows || []).filter((x) => !isStock(x))) {
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
  for (const r of (rows || []).filter((x) => !isStock(x))) {
    const code = String(r.schemeCode);
    if (seen.has(code)) continue;
    seen.add(code);
    const values = line(navByCode?.[code]);
    if (values) funds.push({ key: r.key, short: r.short || r.name, value: r.value, values, last: values[values.length - 1] });
  }
  return { dates, benchmark: line(bench), funds, hasBenchmark: true };
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
  const head = ['Fund', 'Owner', 'Held at', 'Fund house', 'Category', 'Units', 'Average cost', 'Invested', 'NAV', 'NAV date', 'Value', 'P&L', 'P&L %', 'Day change'];
  const lines = [head.join(',')];
  for (const r of rows || []) {
    lines.push(
      [
        r.name,
        ownerOf(r),
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
