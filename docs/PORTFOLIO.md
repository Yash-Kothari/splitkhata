# Portfolio tab: mutual-fund P&L, sync and overlap

An admin-edition-only tab (`FEATURES.portfolio`, off in the shared edition) showing the household's mutual funds:
value, total and daily P&L, how fresh each input is, and how much the funds overlap. Calculation lives in
`mobile/lib/portfolio.js` (pure, tested in `mobile/tests/portfolio.test.mjs`); the data hook is
`mobile/lib/usePortfolio.js`; the screen is `mobile/app/(tabs)/portfolio.js` plus the `Portfolio*` components.

**Personal data never goes in git.** The repo is public. Holdings files live in `portfolio-private/` (git-ignored).
Folio numbers and PAN are never stored; only fund id, units and average cost.

## What is stored (Firestore collection `portfolio`, admin project)

| Document | Holds |
|---|---|
| `catalog` | `{ funds: [{ key, isin, schemeCode, name, short, amc, group: 'zerodha'\|'other', category, holdingsKey }] }` |
| `sip` | `{ plan: { [fundKey]: rupees bought per trading day } }` |
| `overlap` | `{ asOf, holdings: { [holdingsKey]: { [stock]: weightPct } }, names, groups: { adani: [...] }, futures }` |
| `snap_<date>_<source>` | one snapshot: `{ date, source: 'kite'\|'cas'\|'manual', positions: { [fundKey]: { units, avgCost } } }` |
| `trade_<date>_<id>` | a purchase or sale you recorded by hand: `{ fundKey, kind: 'buy'\|'sell', date, units, amount }` |
| `nav_<schemeCode>_<year>` | `{ schemeCode, year, series: { 'YYYY-MM-DD': nav } }` |
| `state` | `{ lastSync: { kite\|cas: { date, at } }, lastNavFetchAt }` |

A later snapshot replaces earlier positions only for the funds it lists, so a Kite sync (Zerodha funds) leaves the
funds held elsewhere (CAS) as they were. A fund held in two places (same ISIN, two folios) is two catalog entries
with the same `schemeCode` and `holdingsKey`.

## How the numbers stay current

1. **NAVs, automatically.** Opening the tab finds, per scheme, the last stored NAV date and fetches only the days
   since from the public AMFI mirror `api.mfapi.in` (a date-ranged request, see gotcha below), writing them back.
   It skips schemes that are already at the previous weekday's NAV and re-checks at most every 2 hours; a failed
   run is retried on the next open. **Check NAVs** forces it.
2. **Units, by snapshot.** Units and average cost come from an imported snapshot. Between snapshots they are
   **estimated** from the daily SIP plan (`estimateHolding`): each NAV day after the snapshot adds
   `SIP amount / NAV` units and the SIP amount to cost. Rows with such units show a "units est." chip. The next
   snapshot reconciles it, and the import preview shows the drift per fund.
3. **The sync status card** shows the last Kite sync, the last CAS import and the newest NAV date, each with a
   fresh (up to 1 day) / stale (up to 7) / old state, so a stale figure is never mistaken for a live one.

4. **Your own trades, recorded in the app.** A lump sum or a redemption outside the SIPs is the main thing that
   makes the estimate wrong. **Record a trade** takes the fund, bought or sold, the date and the amount (the units are
   worked out at the NAV on or before that date; type the units from your statement for an exact figure) or the units.
   A sale takes units out at the running average cost. A trade counts only after the latest snapshot's date, so the
   next Kite sync or CAS, which already contains it, never double-counts it. Recorded trades can be removed from the
   list under the form, and the import preview counts them in the estimate it compares against.
5. **Reminders.** The Sync status card says so when the Kite holdings are more than 7 days old (SIP estimates cover
   the days before that) or a CAS is more than 35 days old, with what to ask Claude for.

Daily P&L uses the units held at the previous close, so a day's own SIP purchase never counts as profit. The value
chart before the first snapshot assumes that snapshot's units (it says so under the chart).

## Importing (the only way holdings reach the database)

Production data is changed by the signed-in user, not by automation. **Portfolio -> Import snapshot** takes pasted
JSON (on the website there are also **Paste from clipboard** and **Choose file** buttons), shows a preview (funds changed, units before and after, drift against the SIP estimate, warnings), and writes
only when you press **Confirm import**. Two shapes are accepted:

- Kite's mutual-fund holdings array as returned (`[{ tradingsymbol, quantity, average_price, ... }]`), stamped with
  the "Holdings as of" date and matched to the Zerodha funds by ISIN.
- A snapshot object: `{ asOf, source, positions: [{ key, units, avgCost }], catalog?, overlap?, sipPlan? }`, used
  for the first setup and for a CAS statement (funds held outside Zerodha). `catalog`, `overlap` and `sipPlan`
  replace the stored ones when present. Edit `sipPlan` and import again whenever the SIPs change.

## Syncing from Kite (a Claude session)

Kite is only reachable through the Kite MCP server inside a Claude session, never from the app, so the sync is two
steps:

1. In a Claude session in this repo with the Kite connector enabled (server `https://mcp.kite.trade/mcp`; log in to
   Kite in the browser when asked, the Kite session lasts until about 6 AM the next day), ask for **"sync the
   portfolio"**. Claude reads the mutual-fund holdings and saves the raw `data` array to
   `portfolio-private/kite-YYYY-MM-DD.json`. Only units and average cost are used; Kite's `last_price` is ignored
   because it was found to be days stale.
   Claude also copies the file to the clipboard (`pbcopy`) so the next step is one paste.
2. Open Portfolio -> Import snapshot -> **Paste from clipboard**, check the preview and Confirm.

Funds held outside Zerodha come from a CAS statement (MFCentral / CAMS / KFintech). Give Claude the PDF (it can be read
with `pdftotext -layout`; the password is the PAN, which Claude does not need if you export it unlocked) and it writes a
snapshot object with `source: 'cas'` and `asOf` set to the statement date, the same shape as `cas-*.json` in
`portfolio-private/`. Import it the same way. A CAS also lists the Zerodha demat funds, which makes a handy
cross-check of the Kite units. Claude never writes to the live database.

## Gotchas

- **mfapi.in leaves the CORS header off replies it serves from its cache.** A bare `/mf/<code>` is cached and then
  fails in a browser ("blocked by CORS policy") for some schemes and not others. `startDate`/`endDate` requests are
  answered fresh, return only the missing rows, and are what the backfill uses. Requests are two at a time with
  retries because the mirror rate-limits bursts.
- The headline value uses each fund's newest NAV (liquid funds also publish on weekends), while the value chart
  uses equity trading days, so the chart's last point can differ from the headline by a weekend's liquid-fund move.
- Overlap uses each fund's top 15-20 disclosed holdings (aggregator data, refreshed by hand by re-importing
  `overlap`), so every overlap figure is a floor. Futures positions are listed but not counted.
- Only the signed-in household accounts can read the collection (the one rule in `firestore.rules` covers it), so
  both partners see the same portfolio.
