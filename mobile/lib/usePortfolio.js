import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeToPortfolio, savePortfolioNavs, markPortfolioNavFetched } from './firebase';
import { reportError } from './errorReporting';
import { todayISO } from './utils';
import {
  buildNavByCode,
  planNavFetch,
  parseMfapiHistory,
  newNavPointsByYear,
  computePortfolio,
  computeHistory,
  computeOverlap,
  classifySync,
  computeSyncStatus,
  ownersOf,
  fundsForView,
  planForFunds,
  isStock,
  syncNudges,
  normalizeSipSchedule,
  sipPlanAt,
  computeMetrics,
  evaluateLimits,
  limitNudges,
  computeBenchmarkTable,
  DEFAULT_LIMITS,
} from './portfolio';
import { buildLedgers, computeReturns, TAX } from './portfolioLedger';
import { computeAssetMix, computeFees, computeDrawdowns, monthlyChanges, checkSips } from './portfolioInsights';

// The public AMFI mirror. NAVs are free and keyless; only the fund's scheme code is ever sent.
const NAV_API = 'https://api.mfapi.in/mf';
// A fund house publishes the NAV late in the evening, so opening the tab many times in a day would otherwise
// re-check every fund each time for a NAV that is not out yet.
const MIN_RECHECK_MS = 2 * 60 * 60 * 1000;
// The mirror rate-limits bursts, and its error replies carry no CORS header, so the browser reports a refused
// request as a network failure. Two at a time with a retry each keeps a full first fill (about 20 funds) reliable.
const CONCURRENCY = 2;
const ATTEMPTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Asks only for the days since the last stored NAV. That is also what keeps this working in a browser: the mirror
// leaves the CORS header off replies it serves from its own cache (a bare /mf/<code> is cached, so it fails
// there), while a date-ranged request is answered fresh and is a few rows instead of the fund's whole history.
async function fetchScheme(code, from, to) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(1500 * attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(`${NAV_API}/${code}?startDate=${from}&endDate=${to}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`NAV service answered ${res.status} for scheme ${code}`);
      const json = await res.json();
      return parseMfapiHistory(json?.data);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// Everything the Portfolio tab shows, plus the NAV backfill: when the tab opens it finds, per fund, the last NAV
// date already stored and fetches only the days since, writing them back so the next open starts from there.
// `view` is whose holdings to show (a person's name), or null for everyone together; the NAV check always covers every fund.
// `autoBackfill: false` is for the Settings pages: they read the same data but leave the once-per-visit NAV check to the
// Portfolio tab (the Check NAVs button still works).
export default function usePortfolio({ autoBackfill = true, view = null } = {}) {
  const [docs, setDocs] = useState(null);
  const [backfill, setBackfill] = useState({ running: false, done: 0, total: 0, failed: 0, updated: 0, manual: false, lastRunAt: null });
  const startedRef = useRef(false);

  useEffect(
    () =>
      subscribeToPortfolio(setDocs, (err) => {
        reportError(err, 'Could not load the portfolio');
        setDocs({});
      }),
    [],
  );

  const funds = useMemo(() => docs?.catalog?.funds || [], [docs]);
  const snapshots = useMemo(
    () =>
      Object.entries(docs || {})
        .filter(([id]) => id.startsWith('snap_'))
        .map(([, d]) => d),
    [docs],
  );
  const navByCode = useMemo(() => buildNavByCode(docs), [docs]);
  // The SIP plan is a dated schedule; `sipPlan` is the one in force today.
  const sipSchedule = useMemo(() => normalizeSipSchedule(docs?.sip), [docs]);
  const sipPlan = useMemo(() => sipPlanAt(sipSchedule, todayISO()), [sipSchedule]);
  const benchmark = docs?.catalog?.benchmark || null;
  const limitsSaved = docs?.limits?.items || null;
  const overlapData = docs?.overlap || null;
  // Newest first, for the list under the trade form.
  const trades = useMemo(
    () =>
      Object.entries(docs || {})
        .filter(([id]) => id.startsWith('trade_'))
        .map(([id, d]) => ({ id, fundKey: d.fundKey, kind: d.kind, date: d.date, units: Number(d.units), amount: Number(d.amount) }))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [docs],
  );

  // Who is in view: every calculation below runs on these funds and their share of the SIP plan.
  const owners = useMemo(() => ownersOf(funds), [funds]);
  // A remembered person who is no longer on the portfolio falls back to everyone, rather than an empty screen.
  const activeView = view && owners.includes(view) ? view : null;
  const viewFunds = useMemo(() => fundsForView(funds, activeView), [funds, activeView]);
  const viewSipPlan = useMemo(() => planForFunds(sipPlan, viewFunds), [sipPlan, viewFunds]);

  // Trades of the funds in view (the trade form lists them; another person's would show as bare keys).
  const viewTrades = useMemo(() => {
    const keys = new Set(viewFunds.map((f) => f.key));
    return trades.filter((t) => keys.has(t.fundKey));
  }, [trades, viewFunds]);

  const histories = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(docs || {})
          .filter(([id]) => id.startsWith('txn_'))
          .map(([, d]) => [d.fundKey, d]),
      ),
    [docs],
  );
  const fundInfo = useMemo(() => docs?.fundinfo?.funds || {}, [docs]);
  const targets = docs?.targets?.mix || null;
  const slabPct = docs?.targets?.slabPct ?? TAX.slabDefault;

  const portfolio = useMemo(
    () => computePortfolio({ funds: viewFunds, snapshots, navByCode, sipPlan, sipSchedule, trades }),
    [viewFunds, snapshots, navByCode, sipPlan, sipSchedule, trades],
  );
  const history = useMemo(
    () => computeHistory({ funds: viewFunds, calendarFunds: funds, snapshots, navByCode, sipPlan, sipSchedule, trades, days: 365 }),
    [viewFunds, funds, snapshots, navByCode, sipPlan, sipSchedule, trades],
  );
  const overlap = useMemo(() => (overlapData ? computeOverlap(overlapData, portfolio.rows) : null), [overlapData, portfolio.rows]);
  const metrics = useMemo(() => computeMetrics(portfolio.rows, overlap), [portfolio.rows, overlap]);
  const limits = limitsSaved || DEFAULT_LIMITS;
  const evaluatedLimits = useMemo(() => evaluateLimits(limits, metrics), [limits, metrics]);
  const benchmarkTable = useMemo(
    () => computeBenchmarkTable({ rows: portfolio.rows, navByCode, benchmarkCode: benchmark?.schemeCode }),
    [portfolio.rows, navByCode, benchmark],
  );

  const today = todayISO();
  // Purchase lots per fund, for the funds whose transaction history has been imported.
  const ledgers = useMemo(
    () => buildLedgers({ funds, histories, snapshots, trades, navByCode, sipPlan, sipSchedule, today }),
    [funds, histories, snapshots, trades, navByCode, sipPlan, sipSchedule, today],
  );
  const returns = useMemo(() => computeReturns({ rows: portfolio.rows, funds: viewFunds, ledgers, today }), [portfolio.rows, viewFunds, ledgers, today]);
  const assetMix = useMemo(
    () => computeAssetMix({ rows: portfolio.rows, funds: viewFunds, info: fundInfo, targets, plan: viewSipPlan }),
    [portfolio.rows, viewFunds, fundInfo, targets, viewSipPlan],
  );
  const fees = useMemo(() => computeFees({ rows: portfolio.rows, info: fundInfo }), [portfolio.rows, fundInfo]);
  const drawdowns = useMemo(() => computeDrawdowns({ rows: portfolio.rows, navByCode }), [portfolio.rows, navByCode]);
  const months = useMemo(() => monthlyChanges(history, 3), [history]);
  const sipChecks = useMemo(
    () => checkSips({ funds: viewFunds, snapshots, navByCode, sipPlan, sipSchedule, trades }),
    [viewFunds, snapshots, navByCode, sipPlan, sipSchedule, trades],
  );
  const syncState = docs?.state;
  const sync = useMemo(() => {
    const fresh = computeSyncStatus({ funds, snapshots, state: syncState, view: activeView, today });
    return { ...fresh, navDate: portfolio.navDate || null, nav: classifySync(portfolio.navDate || null, today) };
  }, [funds, snapshots, syncState, activeView, portfolio.navDate, today]);

  const hasSetup = funds.length > 0;
  // Limits only raise an alert once you have saved your own; until then they are suggestions.
  const nudges = useMemo(
    () => [
      ...syncNudges({ sync, hasSetup, overlapDate: overlapData?.asOfDate || null, today }),
      ...(limitsSaved ? limitNudges(evaluatedLimits) : []),
    ],
    [sync, hasSetup, overlapData, today, limitsSaved, evaluatedLimits],
  );
  // The benchmark's NAVs are stored and backfilled like a fund's, so it needs no separate path.
  // Stocks are priced at imports (there is no price feed to ask), so only mutual funds are fetched.
  const navTargets = useMemo(() => {
    const mf = funds.filter((f) => !isStock(f));
    return benchmark ? [...mf, { key: '__benchmark', schemeCode: benchmark.schemeCode }] : mf;
  }, [funds, benchmark]);

  const runBackfill = useCallback(
    async (force = false) => {
      if (!docs || funds.length === 0) return;
      const lastFetch = docs.state?.lastNavFetchAt?.toMillis?.() ?? 0;
      if (!force && Date.now() - lastFetch < MIN_RECHECK_MS) return;
      const today = todayISO();
      // A manual check asks for anything newer than what is stored; the automatic one only for what should be out by now.
      const plan = planNavFetch(navTargets, navByCode, today, 400, force ? today : undefined);
      if (plan.length === 0) {
        if (force) {
          markPortfolioNavFetched().catch((err) => reportError(err, 'Could not save the NAV check time'));
          setBackfill({ running: false, done: 0, total: 0, failed: 0, updated: 0, manual: true, lastRunAt: Date.now() });
        }
        return;
      }
      setBackfill({ running: true, done: 0, total: plan.length, failed: 0, updated: 0, manual: force, lastRunAt: null });
      const queue = [...plan];
      let done = 0;
      let failed = 0;
      let updated = 0;
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          try {
            const series = await fetchScheme(item.schemeCode, item.from, todayISO());
            const { byYear, count } = newNavPointsByYear(series, item.from, todayISO());
            if (count > 0) {
              await savePortfolioNavs(item.schemeCode, byYear);
              updated += 1;
            }
          } catch (err) {
            failed += 1;
            if (failed === 1) reportError(err, 'Could not fetch the latest NAVs');
          }
          done += 1;
          setBackfill((b) => ({ ...b, done, failed, updated }));
          await sleep(250);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.length) }, worker));
      // A failed run is not marked as checked, so the next open tries again.
      if (failed === 0) await markPortfolioNavFetched().catch((err) => reportError(err, 'Could not save the NAV check time'));
      setBackfill({ running: false, done, total: plan.length, failed, updated, manual: force, lastRunAt: Date.now() });
    },
    [docs, funds, navTargets, navByCode],
  );

  // Once per visit, as soon as the fund list and stored NAVs have loaded.
  useEffect(() => {
    if (!autoBackfill || !docs || funds.length === 0 || startedRef.current) return;
    startedRef.current = true;
    runBackfill(false);
  }, [autoBackfill, docs, funds.length, runBackfill]);

  return {
    loading: docs === null,
    hasSetup,
    funds,
    viewFunds,
    owners,
    view: activeView,
    snapshots,
    trades,
    viewTrades,
    nudges,
    sipSchedule,
    limits,
    limitsSaved: Boolean(limitsSaved),
    evaluatedLimits,
    metrics,
    overlapData,
    catalogDoc: docs?.catalog || null,
    sipDoc: docs?.sip || null,
    stateDoc: docs?.state || null,
    benchmark,
    benchmarkTable,
    navByCode,
    sipPlan,
    viewSipPlan,
    portfolio,
    history,
    overlap,
    overlapAsOf: overlapData?.asOf || null,
    sync,
    backfill,
    histories,
    ledgers,
    returns,
    fundInfo,
    targets,
    slabPct,
    assetMix,
    fees,
    drawdowns,
    months,
    sipChecks,
    refreshNavs: () => runBackfill(true),
  };
}
