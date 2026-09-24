# Splitkhata - Household & Travel Ledger

A shared expense tracker for two people. Log an expense, say who paid, split it or not, tag a category, and see month-over-month and category trends. Built for GitHub Pages and comfortable phone use.

## Features

- **Balance strip**: always shows who owes whom (split expenses only), with real pairwise settlements once a household or trip has more than two members
- **Quick add form**: amount, payer, category, payment method, split toggle, date, note - plus a natural-language Quick Add and receipt scanning
- **Card rewards**: tracks credit card reward rules against each bank's real terms, links card transactions to ledger entries, and ranks which card to use for a given entry
- **Recurring rules & budgets**: recurring bills auto-generate their monthly entry, and category budgets warn before they're exceeded, including a month-end forecast
- **Charts**: monthly spend by payer, category donut with month filter
- **Entry list**: passbook-style rows, filtered by month, search filter, deletable with undo
- **Export & backup**: CSV per ledger or a full JSON backup of everything, from Settings
- **Real-time sync**: Firebase Firestore keeps both partners in sync instantly, on the website and the native app
- **Responsive shell**: a two-column layout with a top nav above 1024px; a single-column, bottom-tab layout on phones

## Stack

- Expo / React Native, built for both the native iOS app and the website (via `expo export --platform web`)
- NativeWind (Tailwind for React Native)
- Firebase Firestore

The app lives in `mobile/` - see `mobile/README.md` for that project's own setup. This repo root otherwise only holds Firebase project config (`firestore.rules`, `firebase.json`).

## Local development

```bash
cd mobile
npm install
npm run web       # website, via react-native-web
# or
npm start         # Expo dev server, for the native app in a simulator/device
```

## License

MIT
