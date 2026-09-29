// D-3: rules tests for firestore.rules. Needs the Firestore emulator running
// on 127.0.0.1:8080 (matches firebase.json). Run with:
//   npx firebase emulators:exec --only firestore "node --test tests/*.test.mjs"
// which starts the emulator, runs the tests, and tears it down for you.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const ALLOWED_EMAIL = 'yash.sk.kothari@gmail.com';

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    // A "demo-*" project id (Firebase's own recommendation for rules tests)
    // makes the emulator refuse any accidental connection to a real project,
    // even if the host/port config were ever wrong.
    projectId: 'demo-splitkhata-rules-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

test.after(async () => {
  await testEnv?.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

function contextFor(email, overrides = {}) {
  return testEnv.authenticatedContext('test-user', {
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  });
}

test('an allowed, verified Google user can read and write any document', async () => {
  const db = contextFor(ALLOWED_EMAIL).firestore();
  await assertSucceeds(setDoc(doc(db, 'expenses', 'e1'), { amount: 100 }));
  await assertSucceeds(getDoc(doc(db, 'expenses', 'e1')));
});

test('an authenticated Google user not on the allow-list is denied', async () => {
  const db = contextFor('someone.else@gmail.com').firestore();
  await assertFails(setDoc(doc(db, 'expenses', 'e2'), { amount: 100 }));
});

test('an allowed email with an unverified email is denied', async () => {
  const db = contextFor(ALLOWED_EMAIL, { email_verified: false }).firestore();
  await assertFails(setDoc(doc(db, 'expenses', 'e3'), { amount: 100 }));
});

test('an allowed email signed in via a non-Google provider is denied', async () => {
  const db = contextFor(ALLOWED_EMAIL, { firebase: { sign_in_provider: 'password' } }).firestore();
  await assertFails(setDoc(doc(db, 'expenses', 'e4'), { amount: 100 }));
});

test('an unauthenticated request is denied', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'expenses', 'e1')));
});
