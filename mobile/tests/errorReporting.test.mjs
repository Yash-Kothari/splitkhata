import test from 'node:test';
import assert from 'node:assert/strict';
import { reportError, clearReportedError, subscribeToReportedErrors } from '../lib/errorReporting.js';
import { SENTRY_ENABLED } from '../lib/sentry.js';

// errorReporting.js imports lib/sentry.js, which has no RN/Metro __DEV__
// global to read in this plain-Node environment - the assertions above
// already prove importing it doesn't throw; this just also pins
// SENTRY_ENABLED to a real boolean (never reports from this test run, since
// EXPO_PUBLIC_SENTRY_DSN is unset here) rather than leaving it unchecked.
test('SENTRY_ENABLED is a boolean and stays off with no DSN configured (this test run)', () => {
  assert.equal(typeof SENTRY_ENABLED, 'boolean');
  assert.equal(SENTRY_ENABLED, false);
});

test('reported errors keep a short newest-first history, folding repeats', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    clearReportedError();
    let latest = null;
    let history = [];
    const unsubscribe = subscribeToReportedErrors((m, h) => { latest = m; history = h; });
    reportError(new Error('first'), 'Save');
    reportError(new Error('second'), 'Load');
    reportError(new Error('second'), 'Load');
    assert.equal(latest, 'Load: second');
    assert.deepEqual(history.map((e) => [e.message, e.count]), [['Load: second', 2], ['Save: first', 1]]);
    for (let i = 0; i < 10; i++) reportError(new Error(`e${i}`));
    assert.equal(history.length, 5, 'capped');
    clearReportedError();
    assert.equal(latest, null);
    assert.deepEqual(history, []);
    unsubscribe();
  } finally {
    console.warn = originalWarn;
  }
});
