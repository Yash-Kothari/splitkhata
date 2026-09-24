// No-ops entirely when no DSN is configured (e.g. a local dev checkout with
// nothing in .env) - matches how the other optional integrations in this
// app (the Firestore emulator flag, Google auth client ids) stay silent
// when unset instead of throwing. Crash/error reporting only - no
// performance tracing, so tracesSampleRate stays at 0.
//
// Session Replay (replaysSessionSampleRate/replaysOnErrorSampleRate +
// mobileReplayIntegration): mobileReplayIntegration() checks for itself and
// safely no-ops (native module unavailable) on web and inside Expo Go - it
// only actually records once the app is run as a real native build (`expo
// run:ios`/`run:android`, or an EAS/dev-client build), which links Sentry's
// native replay module in. 10% of ordinary sessions, 100% of sessions that
// hit an error - matches Sentry's own recommended starting point.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const SENTRY_ENABLED = Boolean(dsn);

// Dynamic import, not a static one - this file (via lib/errorReporting.js)
// is also reachable from the plain-Node unit tests, where a static `import
// ... from '@sentry/react-native'` fails: Node's ESM resolver can't follow
// that package's own internal exports map (it's built for Metro's bundler,
// not Node directly). Gating the import itself behind SENTRY_ENABLED - not
// just the init() call - means the test environment (no DSN in its
// process.env) never touches that module graph at all. Under Metro
// (the real app), a non-lazy dynamic import like this resolves within the
// same bundle almost instantly, not over the network, so the startup delay
// before Sentry is ready is a fraction of a tick - not worth the
// complexity of a synchronous alternative.
let sentryModule = null;
if (SENTRY_ENABLED) {
  import('@sentry/react-native').then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      integrations: [Sentry.mobileReplayIntegration()],
    });
    sentryModule = Sentry;
  });
}

export function captureException(error, context) {
  if (!sentryModule) return;
  sentryModule.captureException(error, context ? { extra: { context } } : undefined);
}
