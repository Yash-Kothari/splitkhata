# Splitkhata - Household & Travel Ledger

A shared expense tracker for two people. Log an expense, say who paid, split it or not, tag a category, and see month-over-month and category trends. Built for GitHub Pages, Cloud Run, and comfortable phone use.

## Features

- **Balance strip**: always shows who owes whom (split expenses only)
- **Quick add form**: amount, payer, category dropdown, split toggle, date, note
- **Category database manager**: manage and add new categories dynamically in Settings
- **Charts**: monthly spend by payer, category donut with month filter
- **Entry list**: passbook-style rows, filtered by month, search filter, deletable
- **Real-time sync**: Firebase Firestore keeps both partners in sync instantly
- **Offline support**: Firestore and local database fallback cache locally and sync when reconnected

## Stack

- Vite + React
- Tailwind CSS v4
- Recharts
- Firebase Firestore

## Local development

1. **Create a Firebase project** (Spark / free plan)
   - Enable **Firestore Database** (start in production mode)
   - In **Authentication → Sign-in method**, enable **Google** sign-in. Only the Google accounts listed in `firestore.rules` can access the shared ledger.
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

4. Open the local URL, pick your identity (e.g. Yash or Kruti) - this is saved on your device.

## License

MIT
