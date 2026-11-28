// Asset mix against targets, fund fees, how far each fund is below its peak, what changed in a month, and whether the SIPs
// went through. Pure; tested in tests/portfolioLedger.test.mjs.
import { daysBetween, isIsoDate, isStock, ownerOf, projectRows, sipAmountFn, latestPositions } from './portfolio.js';

// ---------- facts about a fund ----------

export const ASSETS = [
  ['equity', 'Indian Equity'],
  ['international', 'International'],
  ['debt', 'Debt & Liquid'],
  ['gold', 'Gold & Silver'],
];

const INTERNATIONAL = /\b(global|international|overseas|world|nasdaq|s&p 500|us |u\.s\.|china|japan|emerging)/i;
const METAL = /\b(gold|silver)\b/i;

// Facts about a fund that come from an imported fund-details file, keyed by holdingsKey (or key).
export const fundDetails = (fund, info) => info?.[fund?.holdingsKey || fund?.key] || info?.[fund?.key] || {};

// What the money is in. The fund-details file can say; otherwise the category and name do.
export function assetOf(fund, info) {
  const said = fundDetails(fund, info).asset;
  if (said) return said;
  if (isStock(fund)) return 'equity';
  if (/debt|liquid|money market|gilt|overnight/i.test(fund.category || '')) return 'debt';
  if (METAL.test(fund.name || '')) return 'gold';
  if (INTERNATIONAL.test(`${fund.name || ''} `)) return 'international';
  return 'equity';
}

// How its gains are taxed: 'equity', 'debt' or 'other' (see TAX in portfolioLedger.js). A hybrid fund needs the file to say.
export function taxClassOf(fund, info) {
  const said = fundDetails(fund, info).taxClass;
  if (said) return said;
  const asset = assetOf(fund, info);
  return asset === 'equity' ? 'equity' : asset === 'debt' ? 'debt' : 'other';
}

// ---------- asset mix ----------

const TRADING_DAYS = 250;

// Value and share of each asset class, against the targets you set, today and after a year of the current SIPs at today's
// prices. For a class below target, `perDay` is the extra a day, into that class alone for a year, that would reach it.
export function computeAssetMix({ rows, funds, info, targets = null, plan = {} }) {
  const sum = (list) => {
    const out = Object.fromEntries(ASSETS.map(([k]) => [k, 0]));
    for (const r of list || []) if (r.value > 0) out[assetOf(r, info)] = (out[assetOf(r, info)] || 0) + r.value;
    return out;
  };
  const now = sum(rows);
  const later = sum(projectRows({ rows, funds, plan, days: TRADING_DAYS }));
  const total = Object.values(now).reduce((a, v) => a + v, 0);
  const laterTotal = Object.values(later).reduce((a, v) => a + v, 0);
  const classes = ASSETS.map(([key, label]) => {
    const target = targets && Number(targets[key]) > 0 ? Number(targets[key]) : targets ? 0 : null;
    const pct = total > 0 ? (now[key] / total) * 100 : 0;
    const laterPct = laterTotal > 0 ? (later[key] / laterTotal) * 100 : 0;
    let perDay = null;
    if (target != null && target < 100 && laterPct < target - 0.5) {
      // (later + extra) / (laterTotal + extra) = target
      const t = target / 100;
      perDay = (t * laterTotal - later[key]) / (1 - t) / TRADING_DAYS;
    }
    return { key, label, value: now[key], pct, target, gap: target == null ? null : (target / 100) * total - now[key], laterPct, perDay };
  }).filter((c) => c.value > 0 || c.laterPct > 0 || c.target > 0);
  return { total, classes, hasTargets: Boolean(targets) };
}

// ---------- fees ----------

// What each fund's expense ratio costs a year on today's value. The fee is already inside the NAV; this only shows it.
export function computeFees({ rows, info }) {
  const funds = [];
  const missing = [];
  let covered = 0;
  let asOf = null;
  for (const r of rows || []) {
    if (isStock(r) || !(r.value > 0)) continue;
    const d = fundDetails(r, info);
    const ter = Number(d.ter);
    if (d.ter == null || !Number.isFinite(ter)) {
      missing.push(r.short || r.name);
      continue;
    }
    funds.push({ key: r.key, short: r.short || r.name, group: r.group, owner: r.owner, ter, yearly: (r.value * ter) / 100 });
    covered += r.value;
    if (d.asOf && (!asOf || d.asOf < asOf)) asOf = d.asOf;
  }
  funds.sort((a, b) => b.yearly - a.yearly);
  const yearly = funds.reduce((a, f) => a + f.yearly, 0);
  return { funds, missing, yearly, avgTer: covered > 0 ? (yearly / covered) * 100 : null, asOf };
}

// ---------- drawdown ----------

// How far each fund's latest NAV is below the highest NAV stored (about the last year).
export function computeDrawdowns({ rows, navByCode }) {
  const out = {};
  for (const r of rows || []) {
    if (isStock(r)) continue;
    const series = navByCode?.[String(r.schemeCode)] || [];
    if (series.length < 2) continue;
    let peak = series[0];
    for (const p of series) if (p[1] >= peak[1]) peak = p;
    const last = series[series.length - 1];
    out[r.key] = { pct: (last[1] / peak[1] - 1) * 100, peakDate: peak[0], since: series[0][0], days: daysBetween(series[0][0], last[0]) };
  }
  return out;
}

// ---------- what changed in a month ----------

// Splits each of the last `months` calendar months into market movement (the daily P&L) and money in or out (the rest).
// A month wholly before the first import is left out (units are assumed flat then, so nothing could show as money in); one
// that straddles it is marked partial.
export function monthlyChanges(history, months = 3) {
  const { dates = [], value = [], day = [], constantBefore = null } = history || {};
  if (dates.length < 2 || value.length !== dates.length) return [];
  const out = [];
  const byMonth = new Map();
  dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(i);
  });
  for (const [month, idx] of byMonth) {
    const startI = idx[0] - 1; // the last day of the month before
    if (startI < 0) continue;
    const endI = idx[idx.length - 1];
    if (constantBefore != null && dates[endI] <= constantBefore) continue;
    const market = idx.reduce((a, i) => a + day[i], 0);
    const start = value[startI];
    const end = value[endI];
    out.push({ month, from: dates[startI], to: dates[endI], start, end, market, added: Math.abs(end - start - market) < 1 ? 0 : end - start - market, partial: constantBefore != null && dates[startI] < constantBefore });
  }
  return out.slice(-months).reverse();
}

// ---------- SIP check ----------

// Compares the two latest imports of each SIP fund: the units that should have arrived in between (the plan, plus recorded
// trades) against the units that did. `short` when more than two days' SIP is missing (units arrive a day or two late).
export function checkSips({ funds, snapshots, navByCode, sipPlan = {}, sipSchedule = null, trades = [] }) {
  const out = [];
  for (const f of funds || []) {
    if (isStock(f) || !(Number(sipPlan[f.key]) > 0)) continue;
    const mine = (snapshots || []).filter((s) => s.positions?.[f.key] && isIsoDate(s.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (mine.length < 2) continue;
    const b = latestPositions(mine)[f.key];
    const a = [...mine].reverse().find((s) => s.date < b.date);
    if (!a) continue;
    const series = navByCode?.[String(f.schemeCode)] || [];
    const amountOn = sipAmountFn(sipPlan, sipSchedule, f.key);
    let expected = 0;
    let days = 0;
    for (const [d, nav] of series) {
      if (d > a.date && d <= b.date && amountOn(d) > 0) {
        expected += amountOn(d) / nav;
        days += 1;
      }
    }
    if (days < 3) continue;
    for (const t of trades) if (t.fundKey === f.key && t.date > a.date && t.date <= b.date) expected += t.kind === 'sell' ? -t.units : t.units;
    const actual = b.units - Number(a.positions[f.key].units);
    const nav = series[series.length - 1]?.[1] || 0;
    const missingRupees = (expected - actual) * nav;
    const daily = amountOn(b.date) || Number(sipPlan[f.key]);
    out.push({ key: f.key, short: f.short || f.name, owner: ownerOf(f), from: a.date, to: b.date, days, expected, actual, missingRupees, isShort: missingRupees > 2.5 * daily });
  }
  return out;
}

// ---------- importing fund details and targets ----------

// A fund-details file: { source: 'fundinfo', asOf, funds: { [key | isin]: { ter?, exitLoad?: [{ days, pct }], taxClass?, asset? } } }.
export function parseFundInfo(json, { funds }) {
  const asOf = json?.asOf;
  if (!isIsoDate(asOf)) return { ok: false, error: 'The fund details need an as-of date like 2026-11-21.' };
  const entries = Object.entries(json.funds || {});
  if (!entries.length) return { ok: false, error: 'No fund details in that file.' };
  const out = {};
  const problems = [];
  const names = [];
  for (const [id, d] of entries) {
    const fund = (funds || []).find((f) => f.key === id || f.holdingsKey === id) || (funds || []).find((f) => f.isin === id);
    if (!fund) {
      problems.push(`Unknown fund ${id}`);
      continue;
    }
    const entry = { asOf };
    if (d.ter != null) {
      if (!(Number(d.ter) >= 0 && Number(d.ter) <= 5)) problems.push(`Expense ratio for ${id} should be between 0 and 5 percent`);
      entry.ter = Number(d.ter);
    }
    if (d.exitLoad != null) {
      const ok = Array.isArray(d.exitLoad) && d.exitLoad.every((t) => Number(t.days) > 0 && Number(t.pct) >= 0 && Number(t.pct) <= 10);
      if (!ok) problems.push(`Exit load for ${id} should be a list of { days, pct }`);
      else entry.exitLoad = d.exitLoad.map((t) => ({ days: Number(t.days), pct: Number(t.pct) }));
    }
    if (d.taxClass != null) {
      if (!['equity', 'debt', 'other'].includes(d.taxClass)) problems.push(`Tax class for ${id} should be equity, debt or other`);
      else entry.taxClass = d.taxClass;
    }
    if (d.asset != null) {
      if (!ASSETS.some(([k]) => k === d.asset)) problems.push(`Asset class for ${id} should be one of ${ASSETS.map(([k]) => k).join(', ')}`);
      else entry.asset = d.asset;
    }
    out[fund.holdingsKey || fund.key] = entry;
    names.push(fund.short || fund.name);
  }
  if (problems.length) return { ok: false, error: problems.slice(0, 4).join('. ') + (problems.length > 4 ? ` (+${problems.length - 4} more)` : '') };
  return { ok: true, asOf, funds: out, names };
}

// Targets as typed in Settings: percentages that add up to 100 (blank means 0), and the slab rate used for tax estimates.
export function checkTargets(mix, slabPct) {
  const clean = {};
  let sum = 0;
  for (const [k, label] of ASSETS) {
    const text = String(mix?.[k] ?? '').trim();
    const n = text === '' ? 0 : Number(text);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: `Enter a percentage between 0 and 100 for ${label}.` };
    clean[k] = n;
    sum += n;
  }
  const slab = Number(slabPct);
  if (!Number.isFinite(slab) || slab < 0 || slab > 45) return { ok: false, error: 'Enter your slab rate, between 0 and 45.' };
  if (sum !== 0 && Math.abs(sum - 100) > 0.01) return { ok: false, error: `The targets add up to ${Math.round(sum * 10) / 10}%, not 100%.` };
  return { ok: true, mix: sum === 0 ? null : clean, slabPct: slab };
}
