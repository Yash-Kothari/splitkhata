# Splitkhata (mobile)

Native iPhone app for Splitkhata, built with Expo/React Native. Same Firebase project as the web app (`splitkhata-96cbd`) — data added here shows up on the web app and vice versa.

**Phase 1 scope**: sign-in + a fully working Household ledger tab. Payments/Travel/Cards show a "coming soon" placeholder — those are later phases.

## What's reused from the web app

- `lib/utils.js` is a byte-for-byte copy of the web app's `src/utils.js` — the entire reward/budget/split calculation engine. It has zero React or DOM dependencies, so it ports unchanged. `tests/utils.test.mjs` is the same 162-test suite; run it with `npm test`.
- `lib/firebase.js` is a from-scratch port of the web app's Firestore layer (same collections, same document shapes), rewritten for React Native (AsyncStorage-backed auth persistence, no `window`/`localStorage`).

## One-time setup

### 1. Xcode

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license   # scroll to the end, type "agree"
brew install cocoapods
```

### 2. Google Sign-In

The web app signs in via a browser popup, which doesn't exist on iOS. The mobile app uses `expo-auth-session`'s Google OAuth flow instead, which needs an **iOS-type OAuth client** registered in Google Cloud Console (the same project as Firebase, since a Firebase project *is* a Google Cloud project):

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=splitkhata-96cbd).
2. **Create Credentials → OAuth client ID → Application type: iOS**.
3. Bundle ID: `com.splitkhata.mobile` (must match `app.json`'s `ios.bundleIdentifier` exactly).
4. Copy the generated **iOS client ID**.
5. On the same Credentials page, find the **Web client (auto created by Google Service)** entry (Firebase creates this automatically) and copy its **client ID** too.
6. Create `mobile/.env` (copy from `.env.example`) and fill in both:
   ```
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ```

Sign-in is gated to the same two emails as the web app (`firestore.rules`) — signing in with any other Google account will show "Not an approved account."

## Running it

```bash
cd mobile
npm install
npx expo run:ios          # builds a native project into ios/, boots the Simulator, installs & launches
```

First run takes a few minutes (CocoaPods + native compile). After that, `npx expo start` alone is enough for fast iteration (Metro reload) as long as the native shell hasn't changed.

## Installing on your actual iPhone (free Apple ID, no paid Developer account)

1. Plug your iPhone in, unlock it, tap "Trust This Computer" if asked.
2. Open `mobile/ios/Splitkhata.xcworkspace` in Xcode (not the `.xcodeproj`).
3. Select your iPhone as the run destination (top toolbar, next to the scheme).
4. Xcode → Settings → Accounts → sign in with your regular Apple ID if not already.
5. Select the project in the left sidebar → **Signing & Capabilities** → set **Team** to your personal team (created automatically from your Apple ID) → make sure "Automatically manage signing" is checked.
6. Press ▶ (Run). The app installs and launches directly on your phone — a real home-screen icon, no browser.

**The catch**: a free-account signing certificate is only valid for **7 days**. After that the app just won't open until you repeat step 6 (with the phone plugged into this Mac) — Xcode re-signs it in seconds, no rebuild needed unless the code changed. This is an Apple policy for non-paid accounts, not something fixable in code; a $99/year Apple Developer account removes this limit entirely (via TestFlight) if it ever becomes worth it.

## Later phases (not built yet)

Travel + Payments + charts, then Cards (the biggest single feature), then Settings/receipt-scanning/PIN-lock/search. See `/Users/yash/.claude/plans/synchronous-mixing-corbato.md` for the full phase breakdown.
