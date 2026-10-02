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
