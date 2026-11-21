import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-level guards for mistakes that only show up on one platform, so
// they can't come back unnoticed: both slipped through before because the
// web build and the phone build fail in opposite places.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

const files = ['app', 'components', 'lib'].flatMap((d) => sourceFiles(join(root, d)));

test('no Alert.alert outside lib/dialogs.js (it is a no-op on the website)', () => {
  const offenders = files.filter((f) => !f.endsWith(join('lib', 'dialogs.js')) && readFileSync(f, 'utf8').includes('Alert.alert('));
  assert.deepEqual(offenders.map((f) => f.slice(root.length + 1)), []);
});

test('no global crypto.randomUUID (undefined on Hermes) - use expo-crypto', () => {
  const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('crypto.randomUUID'));
  assert.deepEqual(offenders.map((f) => f.slice(root.length + 1)), []);
});


test('offline support: service worker exists, is registered, and only touches same-origin files', () => {
  const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes("register(base + '/sw.js'"), 'public/index.html must register sw.js');
  assert.ok(html.includes("location.protocol !== 'https:'"), 'registration must skip the local dev server');
  // Firestore/Auth/Sentry/AI calls are cross-origin; caching them would break sync.
  assert.ok(sw.includes('url.origin !== self.location.origin'), 'sw.js must ignore cross-origin requests');
  assert.ok(sw.includes("request.method !== 'GET'"), 'sw.js must ignore non-GET requests');
  assert.ok(sw.includes("request.mode === 'navigate'"), 'sw.js must serve the cached shell for page loads');
});

// --- Shared edition (see docs/SHARED_EDITION.md) -------------------------------------------------
// The admin app must stay exactly as it was, and the shared edition must never be able to touch a
// top-level path, whatever the code around it changes.
const repoRoot = join(root, '..');

test('shared edition: firebase.js builds every data path through the tenant-aware helpers', () => {
  const src = readFileSync(join(root, 'lib', 'firebase.js'), 'utf8');
  // Raw doc(dbInstance, 'x', ...) / collection(dbInstance, 'x') is only allowed for the groups collection itself.
  const raw = [...src.matchAll(/\b(?:doc|collection)\(dbInstance, '([^']+)'/g)].map((m) => m[1]).filter((name) => name !== 'groups');
  assert.deepEqual(raw, [], 'use col()/docAt() so the shared edition scopes this path to a household');
  // The one place that may spell a top-level collection is col() itself, and it must refuse to run un-scoped.
  assert.ok(src.includes("throw new Error('No group selected yet')"), 'col() must throw in the shared edition when no group is open');
});

test('shared edition: defaults to the admin edition with every feature on', async () => {
  const saved = process.env.EXPO_PUBLIC_EDITION;
  try {
    delete process.env.EXPO_PUBLIC_EDITION;
    const admin = await import(`../lib/edition.js?admin=${Math.random()}`);
    assert.equal(admin.IS_SHARED_EDITION, false);
    assert.deepEqual(admin.FEATURES, { travel: true, cards: true, payments: true, ai: true, pin: true, recurring: true, household: true, groups: false });
    process.env.EXPO_PUBLIC_EDITION = 'shared';
    const shared = await import(`../lib/edition.js?shared=${Math.random()}`);
    assert.equal(shared.IS_SHARED_EDITION, true);
    assert.deepEqual(shared.FEATURES, { travel: false, cards: false, payments: false, ai: false, pin: false, recurring: false, household: false, groups: true });
    process.env.EXPO_PUBLIC_EDITION = 'something-else';
    const other = await import(`../lib/edition.js?other=${Math.random()}`);
    assert.equal(other.IS_SHARED_EDITION, false, 'anything but "shared" is the admin edition');
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_EDITION;
    else process.env.EXPO_PUBLIC_EDITION = saved;
  }
});

test('shared edition: app.config.js leaves the admin build config untouched', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const factory = require('../app.config.js');
  const base = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  const saved = process.env.EXPO_PUBLIC_EDITION;
  try {
    delete process.env.EXPO_PUBLIC_EDITION;
    assert.deepEqual(factory({ config: base }), base);
    assert.equal(factory({ config: base }).experiments.baseUrl, '/splitkhata');
    process.env.EXPO_PUBLIC_EDITION = 'shared';
    assert.equal(factory({ config: base }).experiments.baseUrl, undefined, 'the shared site lives at its own root');
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_EDITION;
    else process.env.EXPO_PUBLIC_EDITION = saved;
  }
});

test('shared edition: security rules keep groups apart, and the admin rules are separate', () => {
  const shared = readFileSync(join(repoRoot, 'firestore.shared.rules'), 'utf8');
  assert.ok(shared.includes('match /{col}/{document=**}'), 'member data must match subcollections only (a bare {document=**} also matches the household doc itself)');
  assert.ok(!/match \/\{document=\*\*\}/.test(shared), 'no catch-all match at the root');
  assert.ok(!shared.includes('@gmail.com'), 'no hardcoded accounts in the shared rules');
  const admin = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8');
  assert.ok(admin.includes('isAllowedUser()') && !admin.includes('groups'), 'the admin rules stay the two-person allowlist');
  assert.equal(JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8')).firestore.rules, 'firestore.rules', 'the default firebase.json still deploys the admin rules');
});

test('shared edition: the shared build carries no admin identifiers (they compile out)', () => {
  const src = readFileSync(join(root, 'lib', 'firebase.js'), 'utf8');
  // Literal comparison on the env var so the bundler can fold it away.
  assert.ok(src.includes("const BUILDING_SHARED = process.env.EXPO_PUBLIC_EDITION === 'shared';"));
  assert.ok(/adminFirebaseConfig = BUILDING_SHARED\s*\?\s*null/.test(src));
  assert.ok(src.includes('new Set(BUILDING_SHARED ? []'));
});
