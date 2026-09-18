// A single, app-wide "something failed" surface. Every load (subscription),
// save, and delete failure across this app used to just console.warn and
// show nothing - real on real devices, since nobody watches the Metro log
// on their phone, so a broken sync or a rejected write looked identical to
// success. This is a plain pub-sub singleton (not a React Context) so any
// module - including lib/firebase.js itself, which has no component tree to
// thread a prop through - can report a failure with one call. ConnectionBanner
// is the one subscriber that renders it.
let currentMessage = null;
let listeners = [];

export function reportError(err, context) {
  const detail = err?.message || String(err);
  currentMessage = context ? `${context}: ${detail}` : detail;
  console.warn(currentMessage, err);
  listeners.forEach((listener) => listener(currentMessage));
}

export function clearReportedError() {
  currentMessage = null;
  listeners.forEach((listener) => listener(currentMessage));
}

export function subscribeToReportedErrors(listener) {
  listeners.push(listener);
  listener(currentMessage);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
