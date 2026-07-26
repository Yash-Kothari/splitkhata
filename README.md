# Household Ledger

A shared expense tracker for two people. Log an expense, say who paid, split it or not, tag a category, and see month-over-month and category trends. Built for free hosting on GitHub Pages and comfortable one-handed use on a phone.

## Features

- **Balance strip** — always shows who owes whom (split expenses only)
- **Quick add form** — amount, payer, category, split toggle, date, note
- **Charts** — monthly spend by payer, category donut with month filter
- **Entry list** — passbook-style rows, filtered by month, deletable
- **Real-time sync** — Firebase Firestore keeps both partners in sync instantly
- **Offline support** — Firestore caches locally and syncs when back online

## Stack

- Vite + React
- Tailwind CSS v4
- Recharts
- Firebase Firestore

## Local development

1. **Create a Firebase project** (Spark / free plan)
   - Enable **Firestore Database** (start in production mode)
   - Deploy the security rules from `firestore.rules`:
     ```bash
     firebase deploy --only firestore:rules
     ```
   - Register a web app and copy the config snippet

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Fill in VITE_FIREBASE_* values from Firebase Console
   ```

3. **Install and run**
   ```bash
   npm install
   npm run dev
   ```

4. Open the local URL, pick "Husband" or "Wife" — this is saved on your device only.

## Deploy to GitHub Pages

1. Push this repo to GitHub
2. In **Settings → Pages**, set source to **GitHub Actions**
3. Add repository secrets for each `VITE_FIREBASE_*` variable (Settings → Secrets → Actions)
4. Push to `main` — the workflow in `.github/workflows/deploy.yml` builds and publishes automatically

The app will be live at `https://<username>.github.io/splitkhata/`.

If your repo name differs, update `VITE_BASE_PATH` in `.env` and the deploy workflow.

## Firestore data model

Collection: `expenses`

| Field | Type | Description |
|---|---|---|
| `amount` | number | Rupees |
| `payer` | `"Husband"` \| `"Wife"` | Who paid |
| `category` | string | One of 9 fixed categories |
| `split` | boolean | Whether to include in balance |
| `note` | string | Optional |
| `date` | string | `YYYY-MM-DD` |
| `createdAt` | timestamp | Server timestamp for sort order |

## Optional: light protection

The default Firestore rules allow anyone with the project config to read/write. For a household tool this is usually fine. To add a shared PIN gate, update `firestore.rules` to require a field match — see [Firebase security rules docs](https://firebase.google.com/docs/firestore/security/get-started).

## License

MIT
