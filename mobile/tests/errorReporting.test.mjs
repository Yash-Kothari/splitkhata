import test from 'node:test';
import assert from 'node:assert/strict';
import { reportError, clearReportedError, subscribeToReportedErrors } from '../lib/errorReporting.js';

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
