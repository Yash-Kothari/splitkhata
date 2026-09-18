# Splitkhata (mobile)

Expo/React Native app for Splitkhata - this is the whole product now: it builds both the native iOS app and, via `expo export --platform web` / `expo start --web`, the production website (there is no separate web codebase). Same Firebase project (`splitkhata-96cbd`) either way, so data added on one device shows up everywhere.

## Structure

- `lib/utils.js` - the entire reward/budget/split calculation engine. Zero React or DOM dependencies, so it runs unchanged on native and web. `tests/utils.test.mjs` is the test suite for it; run with `npm test`.
- `lib/firebase.js` - the Firestore layer (collections, document shapes, auth), written for React Native (AsyncStorage-backed auth persistence, `Platform.OS` branches where web and native genuinely differ).
- `app/` - Expo Router screens and layouts. `components/` - shared UI.

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
npm run web                # the website, via react-native-web
# or
npx expo run:ios           # builds a native project into ios/, boots the Simulator, installs & launches
```

First native run takes a few minutes (CocoaPods + native compile). After that, `npx expo start` alone is enough for fast iteration (Metro reload) as long as the native shell hasn't changed.

## Installing on your actual iPhone (free Apple ID, no paid Developer account)

1. Plug your iPhone in, unlock it, tap "Trust This Computer" if asked.
2. Open `mobile/ios/Splitkhata.xcworkspace` in Xcode (not the `.xcodeproj`).
3. Select your iPhone as the run destination (top toolbar, next to the scheme).
4. Xcode → Settings → Accounts → sign in with your regular Apple ID if not already.
5. Select the project in the left sidebar → **Signing & Capabilities** → set **Team** to your personal team (created automatically from your Apple ID) → make sure "Automatically manage signing" is checked.
6. Press ▶ (Run). The app installs and launches directly on your phone — a real home-screen icon, no browser.

**The catch**: a free-account signing certificate is only valid for **7 days**. After that the app just won't open until you repeat step 6 (with the phone plugged into this Mac) — Xcode re-signs it in seconds, no rebuild needed unless the code changed. This is an Apple policy for non-paid accounts, not something fixable in code; a $99/year Apple Developer account removes this limit entirely (via TestFlight) if it ever becomes worth it.
