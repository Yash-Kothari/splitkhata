# Splitkhata: how we build and ship

The working rules for this project, written from what the repo and our history
actually do. Versions are those in `mobile/package.json` at **v3.2.3**. When a
rule here and the code disagree, the code is right: fix this page.

---

## 1. What this is

A shared household, travel and credit-card expense ledger for two people.
**One codebase** (`mobile/`, Expo / React Native) builds the iPhone app and, via
`expo export --platform web`, the website on GitHub Pages
(`https://yash-kothari.github.io/splitkhata/`). There is no separate web app and
no `src/` or `/legacy` tree. Never recreate one or mirror changes into one.

| Path | What lives there |
|---|---|
| `mobile/app/` | Expo Router screens (`(tabs)/household`, `travel`, `payments`, `cards`) |
| `mobile/components/` | Shared UI |
| `mobile/lib/utils.js` | The whole calculation engine (splits, balances, rewards, cards). **No React, no DOM, no Firebase.** |
| `mobile/lib/firebase.js` | The only Firestore/Auth layer |
| `mobile/lib/useEntryForm.js` + `components/EntryFormFields.js` | The shared Add/Edit entry form (see section 5) |
| `mobile/public/sw.js` | Offline service worker (section 8) |
| `firestore.rules`, `firebase.json`, `tests/` (repo root) | Firebase project config and security-rule tests |
| `.github/workflows/deploy.yml` | Test, build, deploy to Pages |
| `mobile/scripts/` | `bump-version.mjs`, `seed-emulator.mjs` |

---

## 2. Tech stack (pinned versions)

| Area | Choice |
|---|---|
| Framework | Expo `~57.0.15`, React Native `0.86.2`, React `19.2.3` |
| Web target | `react-native-web ^0.21.2`, Metro bundler, `output: "single"` (SPA), `experiments.baseUrl: "/splitkhata"` |
| Routing | `expo-router ~57.0.15` (real client routes: `/household`, `/travel`, ...) |
| Styling | NativeWind `^4.2.6` on **Tailwind v3** (`tailwindcss ^3.4.19`) |
| Fonts | Fraunces (display), Inter (body), IBM Plex Mono (numbers) via `@expo-google-fonts/*` |
| Backend | Firebase `^12.18.0`: Firestore + Auth (Google sign-in only) |
| Animation | `react-native-reanimated 4.5.1` |
| Types | TypeScript `^6.0.3`, **checking JS** (`checkJs`) on `lib/**/*.js` only, `strict: false` |
| Lint | ESLint `^9` + `eslint-config-expo ~57.0.2` |
| Errors | `@sentry/react-native ^8.28.0` |
| Tests | Node's built-in `node --test` (no Jest/Vitest) |
| CI node | Node 24 (GitHub Actions) |
| Firebase project | `splitkhata-96cbd` |

Rules:
- **Tailwind is v3 here.** v4-only utilities do not exist (`shadow-2xs` and `text-2xs`
  are defined by hand in `tailwind.config.js`). Do not copy v4 snippets.
- Keep Expo, React Native and React on the versions Expo 57 expects. Upgrade them
  together with `npx expo install`, never one at a time.
- No new dependency without a reason: the engine in `lib/utils.js` stays dependency-free.

---

## 3. Environments and running it

```bash
cd mobile
npm install
npm run web          # website via react-native-web (port 8081)
```

**Local testing never touches real data.** Use the emulators:

1. From the repo root: `firebase emulators:start --only firestore,auth --project splitkhata-96cbd`
2. `EXPO_PUBLIC_USE_FIRESTORE_EMULATOR=true` (set it on the command line or in `mobile/.env`).
   This also skips Google sign-in (auto-signs in as a test user).
3. Seed sample data: `node mobile/scripts/seed-emulator.mjs` (writes to the emulator only,
   the host is hardcoded to `127.0.0.1:8080`).
4. Stop the emulators when done and delete the stray `firestore-debug.log` /
   `ui-debug.log` / `firebase-debug.log` files.

Environment variables (`mobile/.env`, never committed; template in `.env.example`):
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
`EXPO_PUBLIC_USE_FIRESTORE_EMULATOR`, `EXPO_PUBLIC_SENTRY_DSN`. In CI these come
from GitHub Actions secrets.

Long native builds (`expo run:ios`): run them with a bounded timeout or poll them,
and kill them if stuck. Never leave one running unattended.

---

## 4. Data and security rules

- **Access:** `firestore.rules` allows only Google sign-in, verified email, and the
  two household addresses. Every collection is covered by the one rule.
  Changing it means updating `tests/firestore.rules.test.mjs` (run with `npm run test:rules` at the repo root).
- **Secrets** never go in the repo: `.env` is git-ignored; the Sentry DSN and OAuth
  client ids are Actions secrets.
- **Trips are joined by `tripId`.** `tripName` is a legacy fallback only
  (`e.tripId ? e.tripId === id : e.tripName === name`). New entries write `tripId` and
  no `tripName`; display names are resolved live from the trips list, so renaming is free.
- **Rewards are computed, not stored.** Card rewards are recomputed from card
  transactions on every render. Only overrides (`rewardOverride`, `travelMultiplier`)
  and the flags below live on documents.
- **Money:** amounts are rupees; sums use paise helpers (`toPaise`) to avoid float drift.
  A ₹0 entry is valid (a stay paid entirely with reward points).
- **Cash and withdrawals:** an ATM withdrawal is always charged to a card or forex
  account, never to Cash. `isWithdrawalEntry()` ignores a stale `isWithdrawal` flag on a
  cash-paid entry. Cash purchases are priced oldest-withdrawal-first (FIFO).
- **Reward points:** stored positive = spent, negative = earned. They are a separate
  balance and never mixed into rupee totals.
- **Card flags on an entry:** `skipCardTracking: true` means "this entry is not on the
  card" (statement already closed). Edit Entry honours it.
- **Statement-only cards** (`annual_milestone_only`): each typed-in statement is a bill.
  It is unpaid until `paidAt` is set on that card transaction.
- Writes use partial `updateDoc` so unrelated fields (for example `paidAt`, `pinned`)
  survive an edit. Never replace a whole document to change one field.

---

## 5. Code conventions

- **One copy of anything shared.** Add Entry and Edit Entry both use `useEntryForm`
  (state, defaults, validation) and `EntryFormFields` (layout). A field, a rule or a
  layout change goes there, not into one form. Duplicating logic between the two is
  what caused earlier bugs.
- **The engine is pure.** Logic that can be tested without React goes in `lib/utils.js`
  as a pure function with a test. Components stay thin.
- **Platform guards** (enforced by `tests/static-guards.test.mjs`):
  - No `Alert.alert` outside `lib/dialogs.js`. It is a silent no-op on the website. Use
    `notify()` and `confirmAsync()`.
  - No `crypto.randomUUID` (missing on Hermes). Use `expo-crypto`.
  - The service worker must stay same-origin, GET-only and navigation-aware.
- **No presses on SVG shapes.** react-native-svg can't take `onPress` on a shape on the website:
  it logs "Unknown event handler" and the tap never fires. Put an invisible `Pressable` over the
  shape (the bar chart does this) or use a legend row.
- **Shadows go through `shadowStyle()`** (`lib/shadow.js`), never raw `shadowColor`/`shadowOffset`/
  `shadowOpacity`/`shadowRadius`. react-native-web deprecated those and warns; the helper emits
  `boxShadow` on the web and the native props on the phone. Use `style.pointerEvents`, not the
  `pointerEvents` prop.
- **The console should be clean.** After UI work, walk all four tabs on a fresh page load and
  read the console; a new error or warning is a bug to fix, not noise to ignore. The seed
  script sets the app's `seed_state` flags, otherwise the members exist twice in the emulator
  and React logs duplicate-key errors that don't exist in production.
- Class names that only work on web (`calc(...)` widths, `order-*`, `sm:` / `lg:`
  breakpoints) are fine for layout, but behaviour must not depend on them.
- Derive state instead of syncing it with effects where you can. The lint baseline
  counts "set state in an effect" warnings, so don't add new ones.
- Comments explain **why** (the bug it prevents, the rule it follows), not what.
- Keep changes scoped. No drive-by refactors in a feature commit.

---

## 6. UI strategy

**Mobile first.** The website is used on a phone as much as on a laptop. Always check
at 375px wide as well as desktop.

- **Phone layout order:** Add Entry comes right under the balance. Charts and the side
  rail go **below** the passbook (above 1024px they are the right-hand column).
  Category Breakdown sits between Add Entry and the passbook, folded to a one-line
  summary on phones.
- **Add Entry stays short:** two fields per row (`47%` widths so it fits a 320px
  screen), Category right after Amount, rarely used fields (tags, reward points,
  split across months) under **More details**, which opens itself when one has a value.
- **Defaults help, they never decide.** The form starts from the last entry's payer
  and payment method. A "💡 … (as before)" suggestion from the note is a tap-to-apply
  chip, **never** applied automatically: category drives card rewards and budgets.
- **Theme tokens only.** Colours come from CSS variables in `global.css`, exposed as
  `ink`, `paper`, `paper-card`, `ledger-green`, `mustard`, `stamp-red`, `muted-text`.
  Never hard-code a colour (dark mode re-themes through the tokens). For raw SVG or
  style colours use `themeColor` / `themeRgba` from `lib/theme.js`.
- **Type:** display font (`font-display`) for card titles at `text-lg`; body font
  for text; **mono bold for every number**; small-caps labels are
  `font-body-semibold text-2xs uppercase tracking-wider text-muted-text`.
  Each Tailwind font family maps to one specific weight file, so use the named
  families, not `font-bold`.
- **Cards:** `Card` with `p-4`, inner tiles `rounded-xl border border-ink/10 bg-paper px-3.5 py-2.5`,
  the green-tinted tile (`bg-ledger-green/10`) only for a headline total.
  Match the neighbouring cards on the screen before inventing a new style.
- **Spacing:** forms inserted into a list get equal space above and below
  (`my-3`), not just below.
- **An emoji ignores text colour.** Show state with opacity or a tinted chip (the
  pin: dim = not pinned, mustard chip = pinned), never with `text-*` colour.
- **Money is shown with `formatCurrency` (₹, Indian grouping).** Dates in the
  "8 Oct" short style outside forms.
- **Destructive actions confirm** (`confirmAsync`) and deletes use undo (`useUndoDelete`).
- **Don't add settings** for something with an obvious right answer. Fix the default.

---

## 7. Quality gates (run before every commit)

From `mobile/`:

```bash
npm test                    # node --test: engine, static guards, error reporting
npx expo lint --no-cache    # baseline: 0 errors, 34 warnings; do not add new ones
npm run typecheck           # tsc over lib/**/*.js
```

- **Add a test with every engine change**, pure-function style. The suite has 330+
  tests in `tests/utils.test.mjs`. A test that encodes a bug must be rewritten, not
  deleted (for example a stale-flag withdrawal now counts as cash spend).
- Two workflows run in CI:
  - `.github/workflows/ci.yml` runs lint, typecheck, `npm test` and the Firestore rules tests on
    every **pull request and every branch except `main`**.
  - `.github/workflows/deploy.yml` runs on **push to `main`**: `npm test`, the web export, then
    deploy. It does **not** run lint or typecheck. Since we push straight to `main`, run
    lint and typecheck locally before committing.
- Security rules: `npm run test:rules` at the repo root.

**UI verification (the "UI testing" we actually do):**
1. Start the emulator and seed realistic data (the real-data shape, for example
   a statement-only card with the same dates as production).
2. `npm run web` against the emulator, open the screen at **375px** and at desktop width.
3. Exercise the actual feature (save an entry, mark paid, edit and re-save) and read
   the stored documents back. Assert on stored values, not just on-screen text.
4. Check the neighbouring cards for style consistency, and dark mode.
5. Tear everything down (servers, emulators, debug logs, any temporary `launch.json` edit).

**Verifying production:** read-only. Open the live site in the signed-in browser pane
and read what's on screen or in the local Firestore cache. Compare totals against what
local testing predicted.

---

## 8. Monitoring and offline

- **Sentry** (`lib/sentry.js`, org `splitkhata-y3`): crash and error reporting only,
  `tracesSampleRate: 0`. It is enabled **only in a real production build**
  (`DSN set and __DEV__ false`). Local and dev runs never report, so testing can't
  pollute real errors. Session replay is 10% of sessions and 100% of sessions with an
  error, and only records in a native build, not on the website.
- **User-visible errors:** every failed load or save goes through
  `reportError(err, 'what failed')` (`lib/errorReporting.js`). It shows in the
  `ConnectionBanner`, keeps a short newest-first history, and forwards to Sentry.
  Never swallow a Firestore error with a bare `console.warn`.
- **Offline (website):** `mobile/public/sw.js` caches the app so it opens with no
  internet. Firestore itself keeps an IndexedDB copy and queues writes until you're
  back online. The fonts are bundled, so they work offline. Sign-in (the first time)
  and the AI features (Quick Add, receipt scan, digests, Ask) still need internet. The
  cache name is `splitkhata-offline-v1`; changing caching behaviour means changing that name.
- **After every deploy, reload the site twice.** The service worker serves the old
  version once while it updates in the background.

---

## 9. Versioning, commits and deploy

- **Bump the version on every push:** `node scripts/bump-version.mjs <major|minor|patch>`
  from `mobile/`. It updates `package.json`, `package-lock.json` and `app.json`
  and the iOS/Android build numbers. The number shows under the app title.
  - **patch**: a fix or small tweak
  - **minor**: a new feature or a large internal change (v3.1.0 was the shared entry form)
  - **major**: a big redesign or a breaking data change
- **Commit message:** `vX.Y.Z: short description of what the user gets`, lower-case after
  the colon, one line, then the attribution trailer:

  ```
  v3.1.4: make a pinned entry visibly different (tinted chip, unpinned dimmed)

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  ```
- **Commit and push only when asked.** The usual instruction is "bump version, commit
  and push". Until then, changes stay uncommitted. Never force-push, never skip hooks.
- **Deploy:** a push to `main` runs `.github/workflows/deploy.yml` (install, tests,
  `expo export --platform web`, copy `index.html` to `404.html` for the SPA fallback,
  publish to Pages). Check the run is green (`gh run list`), then reload the site twice
  and confirm the version under the title.
- **Dependabot** (`.github/dependabot.yml`) opens weekly, grouped PRs on Mondays: Expo SDK
  patch releases (one PR), our own libraries (firebase, Sentry, NativeWind, react-native-web,
  fonts: minor and patch), the root Firebase tooling, and GitHub Actions. It deliberately
  **ignores** `react`, `react-native` and every native package Expo pins, plus the majors of
  `tailwindcss`, `typescript`, `eslint` and `firebase`. Those move only with an Expo SDK
  upgrade (`npx expo install --fix`), by hand. Each PR is checked by `ci.yml`; merge only
  when it is green. Merging to `main` deploys the site, so reload twice afterwards.
- **One-off tools are removed afterwards.** A temporary import button shipped as
  v3.0.16 and was deleted in v3.0.17 once its job was done. Don't leave dead code behind.

---

## 10. Working agreements

- **Ask only when blocked or the action is destructive or touches production data.**
  For design choices, pick the recommended option, state the assumption, and go. Don't
  open question pop-ups for things with a sensible default.
- **Bigger or unclear features:** explain what and why in chat first, wait for a yes,
  then build. The gap-analysis backlog (P0/P1/P2/D) was worked one item at a time.
- **Ambiguous payer on an imported or unsplit entry:** never guess. Ask, one entry at
  a time, so the answer can be discussed.
- **Production data is changed by the user, not by automation.** Claude does not write to
  the live database, extract sign-in tokens or other credentials, or batch-edit entries
  through the browser. When a bulk change is needed, build a small, tested, one-time
  tool (preview, then confirm) that the user runs while signed in, then remove it.
- **Test locally first, then verify on production read-only.** Never mark something
  done on a local result alone: confirm the live numbers afterwards.
- **Report honestly:** say what was tested, what wasn't, and what's still open. If a
  figure doesn't reconcile, say by how much.

---

## 11. Known gotchas

- The browser pane may not composite screenshots when hidden; use text and style reads then.
- A statement-only card entered with the statement date falls inside the open cycle,
  which is why it's tracked per statement (paid/unpaid) and never as a "next statement".
- An old "Cash withdrawal" checkbox once let ordinary cash purchases be flagged as
  withdrawals (they were counted as cash coming in and double-charged to the trip).
  The checkbox is gone; the flag is ignored on cash-paid entries.
- The browser's NetInfo probe (`HEAD /`) 404s on GitHub Pages, so it is switched off on the web
  (`ConnectionBanner`); the app only uses the browser's online signal.
- Pins sort within the currently shown list (for Household, the selected month).
- GitHub's "AI Scan for PRs" is explicitly **disabled** on all repos
  (`gh api repos/Yash-Kothari/<repo>/code-scanning/ai-scan`).
