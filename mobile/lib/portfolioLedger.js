// Transaction history: purchase lots, the annual return (XIRR), and capital-gains arithmetic. Pure; tested in
// tests/portfolioLedger.test.mjs. A history comes from a detailed CAS (see docs/PORTFOLIO.md) and covers a fund from its
// first purchase; what happened after the statement is filled in from later snapshots, the SIP plan and recorded trades.
import { addDaysISO, daysBetween, isIsoDate, isStock, ownerOf, navOnOrBefore, sipAmountFn, snapshotId, lastSyncKey, DEFAULT_OWNER } from './portfolio.js';

const EPS = 0.0005;
const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------- lots ----------

// First in, first out: `sell` takes units from the oldest lots and says which, and how much each cost.
function takeFifo(lots, units) {
  let left = units;
  const taken = [];
  while (left > EPS && lots.length) {
    const lot = lots[0];
    const n = Math.min(lot.units, left);
    const cost = (lot.cost / lot.units) * n;
    taken.push({ date: lot.date, units: n, cost, estimated: lot.estimated });
    lot.units -= n;
    lot.cost -= cost;
    left -= n;
    if (lot.units <= EPS) lots.shift();
  }
  return { taken, short: Math.max(0, left) };
}

// Replays events ({ date, units (+ bought, - sold), amount, estimated }) in date order into the lots still held, the sales
// made (with the lots each consumed) and the money that moved. `short` is units sold that were never bought: the history
// does not start at the beginning.
export function replayLots(events) {
  // On one day, purchases come first, so a switch in and out on the same date does not read as a sale of nothing.
  const ordered = [...(events || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(b.units > 0) - Number(a.units > 0)));
  const lots = [];
  const sales = [];
  const flows = [];
  let short = 0;
  for (const e of ordered) {
    if (e.units > 0) {
      lots.push({ date: e.date, units: e.units, cost: e.amount, estimated: Boolean(e.estimated) });
      flows.push({ date: e.date, amount: -e.amount });
    } else if (e.units < 0) {
      const sold = takeFifo(lots, -e.units);
      short += sold.short > 0.01 ? sold.short : 0;
      sales.push({ date: e.date, units: -e.units, amount: e.amount, lots: sold.taken, estimated: Boolean(e.estimated) });
      flows.push({ date: e.date, amount: e.amount });
    }
  }
  return { lots, sales, flows, short, units: lots.reduce((a, l) => a + l.units, 0), cost: lots.reduce((a, l) => a + l.cost, 0) };
}

// Everything known about one fund: the statement's transactions, then what happened since. For each later snapshot, the SIP
// and recorded trades up to it are added, and the units are then matched to what the snapshot says: fewer than estimated
// trims the newest estimated purchases (a SIP that did not go through), and any other difference is an extra purchase or sale
// at that day's NAV. Those entries are marked `estimated`.
export function fundLedger({ fund, history, snapshots = [], trades = [], series = [], amountOn = (/** @type {string} */ _date) => 0, today }) {
  if (!history?.items?.length) return null;
  const events = history.items.map((t) => ({ date: t.d, units: Number(t.u), amount: Math.abs(Number(t.a) || 0) }));
  let from = history.asOf;
  const mine = trades.filter((t) => t.fundKey === fund.key);
  const unitsNow = () => events.reduce((a, e) => a + e.units, 0);
  const addSince = (/** @type {string} */ to) => {
    const added = [];
    for (const [d, nav] of series) {
      const a = d > from && d <= to ? amountOn(d) : 0;
      if (a > 0) added.push({ date: d, units: a / nav, amount: a, estimated: true });
    }
    for (const t of mine) {
      if (t.date > from && t.date <= to) added.push({ date: t.date, units: t.kind === 'sell' ? -t.units : t.units, amount: t.amount, estimated: true, trade: true });
    }
    events.push(...added);
    return added;
  };
  const later = [...snapshots]
    .filter((s) => s.date >= history.asOf && s.source !== 'history' && s.positions?.[fund.key])
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of later) {
    const added = addSince(s.date);
    let diff = Number(s.positions[fund.key].units) - unitsNow();
    if (diff < -EPS) {
      // newest SIP estimates first
      for (const e of added.filter((x) => !x.trade).sort((a, b) => (a.date < b.date ? 1 : -1))) {
        if (diff >= -EPS) break;
        const cut = Math.min(e.units, -diff);
        e.amount -= (e.amount / e.units) * cut;
        e.units -= cut;
        diff += cut;
      }
    }
    if (Math.abs(diff) > 0.001) {
      const nav = navOnOrBefore(series, s.date)?.[1] ?? series[0]?.[1] ?? 0;
      events.push({ date: s.date, units: diff, amount: Math.abs(diff) * nav, estimated: true });
    }
    from = s.date;
  }
  addSince(today);
  const kept = events.filter((e) => Math.abs(e.units) > EPS);
  const replay = replayLots(kept);
  return { ...replay, asOf: history.asOf, estimated: kept.some((e) => e.estimated) };
}

// One ledger per fund that has a history.
export function buildLedgers({ funds, histories, snapshots, trades = [], navByCode, sipPlan = {}, sipSchedule = null, today }) {
  const out = {};
  for (const f of funds || []) {
    if (isStock(f)) continue;
    const ledger = fundLedger({
      fund: f,
      history: histories?.[f.key],
      snapshots,
      trades,
      series: navByCode?.[String(f.schemeCode)] || [],
      amountOn: sipAmountFn(sipPlan, sipSchedule, f.key),
      today,
    });
    if (ledger) out[f.key] = ledger;
  }
  return out;
}

// ---------- XIRR ----------

const npv = (rate, flows, t0) => flows.reduce((a, f) => a + f.amount / (1 + rate) ** (daysBetween(t0, f.date) / 365), 0);

// The yearly rate at which the money put in grows into what came out and what is held now. Null when it has no answer
// (nothing on one side, or a rate outside -99.9% to 10000%). Found by bisection, which cannot run away.
export function xirr(flows) {
  const list = (flows || []).filter((f) => f.amount !== 0);
  if (!list.some((f) => f.amount < 0) || !list.some((f) => f.amount > 0)) return null;
  const t0 = list.reduce((d, f) => (f.date < d ? f.date : d), list[0].date);
  let lo = -0.999;
  let hi = 100;
  let atLo = npv(lo, list, t0);
  if (atLo * npv(hi, list, t0) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-9; i += 1) {
    const mid = (lo + hi) / 2;
    const atMid = npv(mid, list, t0);
    if (atLo * atMid <= 0) hi = mid;
    else {
      lo = mid;
      atLo = atMid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

// A yearly rate worked out from a few weeks is wildly large either way, so it is not shown before this many days.
export const XIRR_MIN_DAYS = 90;

// The return of each held fund and of all of them together. `rows` are the portfolio rows (value and NAV date). A fund sold
// out completely still counts in the total, since its gain or loss was real. Funds without a history are listed as missing.
export function computeReturns({ rows, funds, ledgers, today }) {
  const out = [];
  const missing = [];
  const all = [];
  let value = 0;
  const byKey = new Map((rows || []).map((r) => [r.key, r]));
  for (const f of funds || []) {
    if (isStock(f)) continue;
    const ledger = ledgers?.[f.key];
    const r = byKey.get(f.key);
    if (!ledger) {
      if (r) missing.push(r.short || r.name);
      continue;
    }
    const end = r?.value || 0;
    const flows = [...ledger.flows, ...(end > 0 ? [{ date: r.navDate > today ? today : r.navDate, amount: end }] : [])];
    all.push(...flows);
    value += end;
    if (!r) continue;
    const first = ledger.flows[0]?.date || today;
    const days = daysBetween(first, today);
    out.push({ key: f.key, short: r.short || r.name, group: r.group, since: first, days, xirr: days >= XIRR_MIN_DAYS ? xirr(flows) : null, value: end, estimated: ledger.estimated });
  }
  const paid = all.filter((x) => x.amount < 0).reduce((a, x) => a - x.amount, 0);
  const received = all.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0);
  const first = all.reduce((d, x) => (!d || x.date < d ? x.date : d), '');
  const total = first && daysBetween(first, today) >= XIRR_MIN_DAYS ? xirr(all) : null;
  out.sort((a, b) => (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity));
  return { funds: out, missing, total: { xirr: total, since: first || null, gain: received - paid, value, paid, returned: received - value }, estimated: out.some((x) => x.estimated) };
}

// ---------- tax ----------

// India, FY 2026-27, for resident individuals, before surcharge. Equity funds: sold within 12 months 20%, later 12.5% on the
// year's long-term gain above ₹1.25 lakh. Debt funds bought from April 2023: your slab rate. Other funds (international,
// gold) and older debt units: after 24 months 12.5% with no exemption, before that your slab rate. Plus 4% cess.
export const TAX = { equityShort: 20, long: 12.5, exemption: 125000, cess: 4, slabDefault: 30, debtCutoff: '2023-04-01', grandfather: '2018-02-01' };

const addMonthsISO = (iso, months) => {
  const [y, m, d] = iso.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, end))).toISOString().slice(0, 10);
};

// Which tax bucket a lot of this class falls in when sold on `sold`: equityST, equityLT, otherLT or slab.
export function taxBucket(taxClass, bought, sold) {
  if (taxClass === 'equity') return sold > addMonthsISO(bought, 12) ? 'equityLT' : 'equityST';
  if (taxClass === 'debt' && bought >= TAX.debtCutoff) return 'slab';
  return sold > addMonthsISO(bought, 24) ? 'otherLT' : 'slab';
}

export const emptyBuckets = () => ({ equityST: 0, equityLT: 0, otherLT: 0, slab: 0 });
export const addBuckets = (a, b) => Object.fromEntries(Object.keys(emptyBuckets()).map((k) => [k, (a[k] || 0) + (b[k] || 0)]));

// Tax on a year's gains by bucket. A short-term loss (equityST or a slab loss) can be set against any gain; a long-term loss
// only against long-term gains. Short-term losses go against the highest-taxed gain first. Losses left over are not shown.
export function computeTax(buckets, slabPct = TAX.slabDefault) {
  const g = { ...emptyBuckets(), ...buckets };
  // long-term against long-term
  for (const [loss, gain] of [['equityLT', 'otherLT'], ['otherLT', 'equityLT']]) {
    if (g[loss] < 0 && g[gain] > 0) {
      const use = Math.min(-g[loss], g[gain]);
      g[loss] += use;
      g[gain] -= use;
    }
  }
  let shortLoss = Math.max(0, -g.equityST) + Math.max(0, -g.slab);
  g.equityST = Math.max(0, g.equityST);
  g.slab = Math.max(0, g.slab);
  g.equityLT = Math.max(0, g.equityLT);
  g.otherLT = Math.max(0, g.otherLT);
  const order = slabPct >= TAX.equityShort ? ['slab', 'equityST', 'otherLT', 'equityLT'] : ['equityST', 'otherLT', 'equityLT', 'slab'];
  for (const k of order) {
    // exempt long-term equity gain needs no loss set against it
    const taxable = k === 'equityLT' ? Math.max(0, g[k] - TAX.exemption) : g[k];
    const use = Math.min(shortLoss, taxable);
    g[k] -= use;
    shortLoss -= use;
  }
  const base =
    (g.equityST * TAX.equityShort) / 100 + (g.slab * slabPct) / 100 + (Math.max(0, g.equityLT - TAX.exemption) * TAX.long) / 100 + (g.otherLT * TAX.long) / 100;
  return base * (1 + TAX.cess / 100);
}

// The Indian financial year (April to March) a date falls in.
export function financialYear(iso) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { start: `${start}-04-01`, end: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

// Gains already realised this financial year by one person, from the sales in their ledgers.
export function realisedGains({ funds, ledgers, taxClassOf, owner = DEFAULT_OWNER, today }) {
  const fy = financialYear(today);
  const buckets = emptyBuckets();
  const sales = [];
  const missing = [];
  let estimated = false;
  let oldLots = false;
  for (const f of funds || []) {
    if (isStock(f) || ownerOf(f) !== owner) continue;
    const ledger = ledgers?.[f.key];
    if (!ledger) {
      missing.push(f.short || f.name);
      continue;
    }
    for (const s of ledger.sales) {
      if (s.date < fy.start || s.date > fy.end) continue;
      let gain = 0;
      for (const lot of s.lots) {
        const part = (s.amount * lot.units) / s.units - lot.cost;
        buckets[taxBucket(taxClassOf(f), lot.date, s.date)] += part;
        gain += part;
        if (taxClassOf(f) === 'equity' && lot.date < TAX.grandfather) oldLots = true;
        if (lot.estimated) estimated = true;
      }
      if (s.estimated) estimated = true;
      sales.push({ key: f.key, short: f.short || f.name, date: s.date, units: s.units, amount: s.amount, gain });
    }
  }
  sales.sort((a, b) => (a.date < b.date ? 1 : -1));
  const used = Math.min(TAX.exemption, Math.max(0, buckets.equityLT + Math.min(0, buckets.otherLT)));
  return { fy, buckets, sales, missing, estimated, oldLots, exemptionUsed: used, exemptionLeft: TAX.exemption - used };
}

// The exit load, in percent, on units held `days` days: the first tier the holding is still inside. Null when the fund's
// load is not on file (which is different from a fund with no load, an empty list).
export function exitLoadPct(tiers, days) {
  if (!Array.isArray(tiers)) return null;
  const hit = [...tiers].sort((a, b) => a.days - b.days).find((t) => days <= t.days);
  return hit ? Number(hit.pct) : 0;
}

// A lot bought on `bought` can be redeemed on `date` once its lock-in is over.
export const unlocksOn = (bought, months) => addMonthsISO(bought, months);

// What redeeming `units` (or `amount` rupees) of one fund on `date` would look like: which lots go, first in first out, the
// exit load on each, the gain in each tax bucket, and the extra tax on top of what was already realised this year.
export function previewSale({ ledger, nav, units = null, amount = null, date, taxClass, exitLoad = null, freePct = 0, lockInMonths = 0, realised = emptyBuckets(), slabPct = TAX.slabDefault }) {
  if (!ledger) return { ok: false, error: 'This fund has no transaction history yet.' };
  if (!(nav > 0) || !isIsoDate(date)) return { ok: false, error: 'There is no NAV for this fund yet.' };
  // Units still locked in cannot be redeemed at all, so only the rest are on offer.
  const open = lockInMonths > 0 ? ledger.lots.filter((l) => unlocksOn(l.date, lockInMonths) <= date) : ledger.lots;
  const locked = ledger.lots.filter((l) => !open.includes(l));
  const held = open.reduce((a, l) => a + l.units, 0);
  const nextUnlock = locked.length ? unlocksOn(locked[0].date, lockInMonths) : null;
  if (locked.length && held <= 0.01) return { ok: false, error: `All units are locked in. The first unlock on ${nextUnlock}.` };
  let want = units != null ? Number(units) : amount != null ? Number(amount) / nav : NaN;
  if (!(want > 0)) return { ok: false, error: 'Enter an amount or units to redeem.' };
  if (want > held + 0.01) {
    return { ok: false, error: locked.length ? `Only ${round3(held)} units are out of the lock-in. The next unlock on ${nextUnlock}.` : `That is more than the ${round3(held)} units held.` };
  }
  want = Math.min(want, held);
  const { taken } = takeFifo(open.map((l) => ({ ...l })), want);
  // Some funds let a share of the units still inside the load period go free. The allowance is that share of those units,
  // used oldest first; earlier redemptions that may have used some of it are not tracked.
  let free = (ledger.lots.reduce((a, l) => a + (exitLoadPct(exitLoad, daysBetween(l.date, date)) > 0 ? l.units : 0), 0) * freePct) / 100;
  let freeUsed = 0;
  const buckets = emptyBuckets();
  let load = 0;
  let loadKnown = true;
  const lots = taken.map((l) => {
    const days = daysBetween(l.date, date);
    const value = l.units * nav;
    const pct = exitLoadPct(exitLoad, days);
    if (pct == null) loadKnown = false;
    const waived = pct > 0 ? Math.min(free, l.units) : 0;
    free -= waived;
    freeUsed += waived;
    const fee = pct ? ((l.units - waived) * nav * pct) / 100 : 0;
    const gain = value - fee - l.cost;
    const bucket = taxBucket(taxClass, l.date, date);
    buckets[bucket] += gain;
    load += fee;
    return { date: l.date, units: l.units, cost: l.cost, value, days, gain, bucket, load: fee, loadPct: pct, freeUnits: waived, estimated: l.estimated };
  });
  const value = want * nav;
  const tax = Math.max(0, computeTax(addBuckets(realised, buckets), slabPct) - computeTax(realised, slabPct));
  // Equity units bought in the last year that turn long-term soon: waiting changes their rate.
  const waiting = taxClass === 'equity' ? lots.filter((l) => l.bucket === 'equityST' && l.gain > 0) : [];
  const nextLongTerm = waiting.length ? addDaysISO(addMonthsISO(waiting[0].date, 12), 1) : null;
  return {
    ok: true,
    units: want,
    value,
    cost: lots.reduce((a, l) => a + l.cost, 0),
    gain: lots.reduce((a, l) => a + l.gain, 0),
    exitLoad: load,
    exitLoadKnown: loadKnown,
    freeUnits: freeUsed,
    lockedUnits: locked.reduce((a, l) => a + l.units, 0),
    nextUnlock,
    buckets,
    tax,
    inHand: value - load - tax,
    lots,
    nextLongTerm,
    estimated: lots.some((l) => l.estimated),
    oldLots: taxClass === 'equity' && lots.some((l) => l.date < TAX.grandfather),
  };
}

// ---------- importing a history ----------

// A transaction file: { source: 'transactions', asOf, owner?, transactions: [{ key | isin, date, units, amount, type }] },
// the full history of every fund it names. `type: 'sell'` (or negative units) is units leaving. A fund whose history sells
// more than it bought is refused: the statement does not start from the beginning.
export function parseTransactions(json, { funds, owner = null, people = null, today }) {
  const asOf = json?.asOf;
  if (!isIsoDate(asOf)) return { ok: false, error: 'The history needs an as-of date like 2026-11-21.' };
  if (today && asOf > today) return { ok: false, error: 'The as-of date is in the future.' };
  const fileOwner = json.owner ? String(json.owner).trim() : null;
  if (fileOwner && owner && fileOwner !== owner) return { ok: false, error: `This file is for ${fileOwner}, but you chose ${owner}. Pick ${fileOwner} to import it.` };
  const who = fileOwner || owner || DEFAULT_OWNER;
  if (people && !people.includes(who)) return { ok: false, error: `${who} is not one of the people on this portfolio (${people.join(', ')}).` };
  if (!Array.isArray(json.transactions) || json.transactions.length === 0) return { ok: false, error: 'No transactions in that file.' };
  const mine = (funds || []).filter((f) => ownerOf(f) === who && !isStock(f));
  const byFund = {};
  const problems = [];
  for (const t of json.transactions) {
    let hits = mine.filter((f) => (t.key ? f.key === t.key : t.isin && f.isin === t.isin));
    if (hits.length > 1 && t.group) hits = hits.filter((f) => f.group === t.group);
    if (hits.length !== 1) {
      problems.push(hits.length ? `${t.isin} is held in two places: give each row its fund key` : `Unknown fund ${t.key || t.isin || '(no id)'}`);
      continue;
    }
    const units = Number(t.units);
    const amount = Math.abs(Number(t.amount));
    const sell = t.type === 'sell' || units < 0;
    if (!isIsoDate(t.date) || t.date > asOf || !Number.isFinite(units) || units === 0 || !Number.isFinite(amount)) {
      problems.push(`Bad row for ${hits[0].short || hits[0].key} dated ${t.date}`);
      continue;
    }
    (byFund[hits[0].key] ||= []).push({ d: t.date, u: (sell ? -1 : 1) * round3(Math.abs(units)), a: Math.round(amount * 100) / 100 });
  }
  const histories = [];
  const positions = {};
  for (const [key, items] of Object.entries(byFund)) {
    items.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const r = replayLots(items.map((x) => ({ date: x.d, units: x.u, amount: x.a })));
    const fund = mine.find((f) => f.key === key);
    if (r.short > 0) {
      problems.push(`${fund.short || key} sells more than was bought: the statement must start from the first purchase`);
      continue;
    }
    const units = r.units < 0.01 ? 0 : round3(r.units);
    positions[key] = { units, avgCost: units > 0 ? Math.round((r.cost / r.units) * 1e6) / 1e6 : 0 };
    histories.push({ key, asOf, items, short: fund.short || fund.name, units, count: items.length });
  }
  if (problems.length) {
    const unique = [...new Set(problems)];
    return { ok: false, error: unique.slice(0, 4).join('. ') + (unique.length > 4 ? ` (+${unique.length - 4} more)` : '') };
  }
  return { ok: true, owner: who, asOf, histories, positions, groups: [...new Set(histories.map((h) => mine.find((f) => f.key === h.key).group))] };
}

// What one confirmed history import writes: each fund's history, and a snapshot of the units it ends on. A history that
// covers funds held outside Zerodha counts as that month's CAS, unless a later CAS is already recorded.
export function buildHistoryWrites({ parsed, state = null }) {
  const { owner, asOf, histories, positions, groups } = parsed;
  const key = lastSyncKey('cas', owner);
  const counts = groups.includes('other') && !(state?.lastSync?.[key]?.date > asOf);
  return {
    histories: histories.map((h) => ({ key: h.key, asOf, items: h.items })),
    snapshot: { id: snapshotId(asOf, 'history', owner), data: { date: asOf, source: 'history', positions, ...(owner === DEFAULT_OWNER ? {} : { owner }) } },
    syncKey: counts ? key : null,
    syncDate: counts ? asOf : null,
  };
}
