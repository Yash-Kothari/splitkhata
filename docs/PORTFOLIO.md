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
| `catalog` | `{ funds: [{ key, isin, schemeCode, name, short, amc, group: 'zerodha'\|'other', category, holdingsKey, owner?, kind?, symbol?, stockId?, sector? }], benchmark: { schemeCode, name } }`. `owner` is a household member's name (absent = Yash); `kind: 'stock'` marks a share held directly (see Stocks) |
| `sip` | `{ schedule: [{ from, plan: { [fundKey]: rupees bought per trading day } }], plan }`, the plan over time (`plan` is the latest). A setup import with a plain `sipPlan` writes `{ plan }`, read as one entry that always applied |
| `limits` | `{ items: [{ id, metric: 'adani'\|'amc'\|'category'\|'stock'\|'fund', name?, max }] }`, the concentration caps you saved |
| `overlap` | `{ asOf, asOfDate: 'YYYY-MM-DD', holdings: { [holdingsKey]: { [stock]: weightPct } }, names, groups: { adani: [...] }, futures }` |
| `snap_<date>_<source>[_<Owner>]` | one snapshot: `{ date, source: 'kite'\|'cas'\|'kite_stocks'\|'manual', owner?, positions: { [fundKey]: { units, avgCost } } }`. Yash's keep the plain id; anyone else's carries their name so two people's imports on one day never overwrite each other |
| `trade_<date>_<id>` | a purchase or sale you recorded by hand: `{ fundKey, kind: 'buy'\|'sell', date, units, amount }` |
| `nav_<schemeCode>_<year>` | `{ schemeCode, year, series: { 'YYYY-MM-DD': nav } }`. A stock's price points live here too, under its own key `STK_<symbol>` |
| `state` | `{ lastSync: { kite\|cas\|kite_stocks: { date, at }, 'cas:Kruti': ... }, lastNavFetchAt }`; Yash keeps the plain key, anyone else's is `<place>:<Name>` |

A later snapshot replaces earlier positions only for the funds it lists, so a Kite sync (Zerodha funds) leaves the
funds held elsewhere (CAS) as they were. A fund held in two places (same ISIN, two folios) is two catalog entries
with the same `schemeCode` and `holdingsKey`.

## Whose holdings

More than one person can hold something (Yash, and Kruti). Everything is still one portfolio: an `owner` on each catalog fund says
whose it is, and a missing `owner` means Yash, so nothing imported before a second person existed needed migrating. Positions, trades
and the SIP plan are keyed by fund, so they already know whose they are. Two people holding the same fund are two catalog entries
under their own keys that share a `schemeCode` and `holdingsKey` (one NAV history, one overlap entry).

- **The tab** has a **Combined | Yash | Kruti** switcher (only drawn when more than one person holds anything), remembered on the
  device and falling back to Combined if the remembered person is gone. Every card computes from the funds in view
  (`fundsForView`, `planForFunds`): summary, charts, allocation, limits, overlap, what-if, projection and the Nifty comparison. The
  history's trading days come from everyone's funds (`calendarFunds`), so one person's line sits on the same dates as the combined one.
- **Sync** is per person (`computeSyncStatus`): a combined view is only as fresh as its stalest part, a reminder names whose
  holdings are stale, and a place nobody in the view uses gets no tile and no reminder.
- **Import** has a **Whose Holdings** choice (a file that names an `owner` selects it; a different choice is refused, and so is a name
  that is not one of the people). An import never overwrites someone else's data: a catalog replaces only that person's funds
  (`mergeCatalog`, which also refuses a key already used by someone else), overlap is added by fund (`mergeOverlap`), a SIP plan
  becomes a dated change that keeps the schedule and the other person's amounts (`mergeSipPlan`; the very first plan is stored plainly
  as before), a Kite list maps an ISIN only to the chosen person's fund, and a position naming another person's fund is refused.
  `buildImportWrites` works all of that out as plain data and `importPortfolioSnapshot` only writes it.

## Stocks

A catalog entry with `kind: 'stock'` is a share held directly (`symbol`, `exchange`, `isin`, `sector`, `group` for where it is held).
Mutual funds behave exactly as before; a stock differs in these ways:

- **Priced at each import.** There is no price feed to ask from a static site, so every import carries a price (Kite's `last_price`,
  or a `prices` map in a file) and saves it as a price point under `STK_<symbol>` in the NAV store. Between imports the price is the
  last one, labelled "price at import", and the stock has no day change and no daily P&L. Before its first price a stock is left out
  of value and put-in alike. The NAV fetch never asks about stocks, and a stock never sets the NAV date or the trading days.
- **No SIP.** The SIP editor and the what-if card list funds only; between imports a stock's shares are only changed by trades you
  record (which need both the number of shares and the amount paid, since there is no price to work one from the other).
- **Kite stocks import** (`source: 'kite_stocks'`): a Kite equity holdings list (rows with an `exchange`) maps by ISIN to that person's
  Zerodha stocks. It is the **complete** list for that person's Zerodha stocks, so a stock missing from it has been sold and is set to
  zero (the preview lists them first; a stock held elsewhere is never touched). A stock with no price is refused. New stocks must be in
  the catalog (a setup-style file with a `catalog` adds them, each needing a `symbol`).
- **Concentration** counts a direct stock as 100% of its own company under the id the funds' disclosures use (`stockId`, default the
  symbol): Largest Single Stock, the Adani group and "stocks you own several ways" include it. Fund house, category and "largest single
  fund" are about funds only, and the benchmark table and Nifty lines skip stocks.
- **Allocation** gains a **Type** view (mutual funds / stocks); a stock's category is its sector and its fund house is "Direct stocks".
- A stock held at another place (not Zerodha) is entered by hand through a `manual` file, which is not a complete list.
- Limits: splits and bonus issues are not adjusted for in a stock's history (it is drawn from snapshot shares), and dividends are not
  captured.

## How the numbers stay current

1. **NAVs, automatically.** Opening the tab finds, per scheme, the last stored NAV date and fetches only the days
   since from the public AMFI mirror `api.mfapi.in` (a date-ranged request, see gotcha below), writing them back.
   It skips schemes that are already at the previous weekday's NAV and re-checks at most every 2 hours; a failed
   run is retried on the next open. **Check NAVs** (on the Sync status card, and in Settings) forces it.
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
   the days before that), a CAS is more than 35 days old, the overlap data (`overlap.asOfDate`) is more than 45 days
   old, or a limit you saved is breached, with what to ask Claude for.

## Where things live

The tab only **shows**; anything you set up or change now and then is a **setting** and lives in **Settings -> Portfolio**,
like the rest of the app (a reminder or button on the tab opens the right Settings page directly).

- **Portfolio tab**, four short sections in the app's segmented style: **Overview** (summary with Hide amounts, sync
  status and reminders, daily P&L, value against what you put in), **Funds** (the fund list with **Record a trade**, a pop-up, and Fund vs
  Nifty 50), **Insights** (allocation donut, limits as read-only bars, overlap) and **Plan** (SIP what-if, long-term illustration).
- **Settings -> Portfolio -> SIP plan:** edit the daily SIP plan. **Limits:** set the caps. **Import & export:** Update
  holdings (the setup file the first time, then Kite and CAS snapshots), Check NAVs, and the holdings CSV.

## Planning cards

All of these use the same holdings, NAVs and overlap data, and fold on a phone like the other charts.

- **SIP plan (Settings).** Rupees a day per fund, saved as a dated schedule. A change applies from the date you pick (today by
  default), so days before it keep the plan they ran under and their estimated units do not move. The first edit of a
  plain plan keeps the old one in force up to the day before.
- **Limits (shown in Insights, set in Settings).** Caps on Adani group, a fund house, a category, the largest single stock and the largest single fund,
  each shown as a bar against its limit (ok below 85%, near from 85%, breach above). Until you save your own they are
  suggestions and raise no alerts; once saved, a breach also appears in the reminders at the top.
- **SIP what-if.** Today, your current plan and a plan you try, after 3 months, 1 year or 3 years of SIPs, with prices
  held still, so it shows the effect of the SIP choice alone. It reuses the overlap data, so its shares are a floor.
- **Charts.** Four line/donut charts share one chart (`PortfolioLineChart`: axis labels from `formatY`, a faint guide and dots on the
  tapped point, taps on invisible columns) and one pill toggle (`PortfolioPills`), so Hide Amounts only has to mask one place.
  *Portfolio value* draws value against **put in** (dashed) over 1M / 3M / 6M / 1Y; put in is `computeHistory().invested`, the cost of the
  units held (snapshot cost, plus SIP and buys since, minus sales at the average cost), so its newest point equals the Invested
  figure. *Allocation* is a donut by category, fund house or fund (`computeAllocation`; beyond 6 slices the small ones fold into
  "Others"; tap a legend row, not a slice). *Fund vs Nifty* draws percent change since the start of 1M / 3M / 6M / 1Y
  (`computeRelativeLines`) with the three largest funds on and a chip for each other fund. *Long-term illustration* draws the three
  cases and the put-in line. A window the stored NAVs do not reach says so instead of drawing from a wrong start.
- **Fund vs Nifty 50.** Each fund's NAV-to-NAV return over 1 month, 3 months, 6 months and 1 year next to the benchmark
  index fund's (`catalog.benchmark`, stored and backfilled like any fund) and the gap. These are fund returns, not
  what you earned on your own purchases; a dash means the stored history does not reach back that far.
- **Long-term illustration.** Compounding arithmetic from today's value and a monthly SIP at a low, middle and high
  yearly return you set, optionally with a yearly SIP increase and an inflation rate. A headline tile gives the middle
  case at your horizon (what you put in versus what growth added, and the value in today's money); a one-line-per-year
  table shows the three cases, switchable between future rupees and today's money (`summariseProjection`), under a chart of the
  three cases and the money put in (always in future rupees). It is not a forecast.
- **Hide amounts.** One switch (remembered on this device) that turns every rupee amount and unit count on the tab
  into dots; percentages stay.
- **Export CSV (Settings).** The holdings table (with an Owner column) as a CSV (a download on the website, the share sheet on a phone).

Daily P&L uses the units held at the previous close, so a day's own SIP purchase never counts as profit. The value
chart before the first snapshot assumes that snapshot's units (it says so under the chart).

## Importing (the only way holdings reach the database)

Production data is changed by the signed-in user, not by automation. **Settings -> Portfolio -> Import & export** takes pasted
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
2. Open Settings -> Portfolio -> Import & export -> **Paste from clipboard**, check the preview and Confirm.

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
