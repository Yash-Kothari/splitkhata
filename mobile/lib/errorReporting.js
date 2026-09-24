import { captureException } from './sentry.js';

// A single, app-wide "something failed" surface. Every load (subscription),
// save, and delete failure across this app used to just console.warn and
// show nothing - real on real devices, since nobody watches the Metro log
// on their phone, so a broken sync or a rejected write looked identical to
// success. This is a plain pub-sub singleton (not a React Context) so any
// module - including lib/firebase.js itself, which has no component tree to
// thread a prop through - can report a failure with one call. ConnectionBanner
// is the one subscriber that renders it.
let currentMessage = null;
// The last few failures, newest first. With a single slot, a second failure
// replaced the first before anyone saw it (and failures raised while the
// offline banner was showing were simply lost).
const HISTORY_LIMIT = 5;
let history = [];
let listeners = [];

function notifyListeners() {
  listeners.forEach((listener) => listener(currentMessage, history));
}

export function reportError(err, context) {
  const detail = err?.message || String(err);
  currentMessage = context ? `${context}: ${detail}` : detail;
  console.warn(currentMessage, err);
  captureException(err, context);
  const [latest] = history;
  if (latest && latest.message === currentMessage) {
    history = [{ ...latest, count: latest.count + 1, at: Date.now() }, ...history.slice(1)];
  } else {
    history = [{ message: currentMessage, count: 1, at: Date.now() }, ...history].slice(0, HISTORY_LIMIT);
  }
  notifyListeners();
}

export function clearReportedError() {
  currentMessage = null;
  history = [];
  notifyListeners();
}

// listener(latestMessage, history) - history is [{ message, count, at }], newest first.
export function subscribeToReportedErrors(listener) {
  listeners.push(listener);
  listener(currentMessage, history);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
