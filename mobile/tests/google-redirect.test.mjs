import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { isIosHomeScreenApp, appRootAddress, startHomeScreenSignIn, finishHomeScreenSignIn, PENDING_KEY, MAX_AGE_MS } from '../lib/googleRedirect.js';

const NOW = 1_700_000_000_000;

// A made-up browser window, hosted under /app like a project site.
function fakeWindow() {
  const stored = new Map();
  const visited = [];
  return {
    navigator: { standalone: true },
    crypto: webcrypto,
    location: { origin: 'https://host.test', assign: (url) => visited.push(new URL(url)) },
    document: { querySelector: () => ({ src: 'https://host.test/app/_expo/static/js/web/entry-1.js' }) },
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
    stored,
    visited,
  };
}

const token = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

// Starts a sign-in and returns the window with what was sent to Google.
function started() {
  const win = fakeWindow();
  startHomeScreenSignIn(win, 'client-1', NOW);
  const sent = win.visited[0].searchParams;
  return { win, sent, state: sent.get('state'), nonce: sent.get('nonce') };
}
const back = (win, fields) => (win.__googleReturn = new URLSearchParams(fields).toString());

test('only a Home Screen icon counts as a Home Screen app', () => {
  assert.equal(isIosHomeScreenApp({ navigator: { standalone: true } }), true);
  assert.equal(isIosHomeScreenApp({ navigator: { standalone: false } }), false);
  assert.equal(isIosHomeScreenApp({ navigator: {} }), false);
  assert.equal(isIosHomeScreenApp(undefined), false);
});

test('Google is asked for an ID token and sent back to the front page of the app', () => {
  const { win, sent, state, nonce } = started();
  assert.equal(win.visited[0].origin, 'https://accounts.google.com');
  assert.equal(sent.get('client_id'), 'client-1');
  assert.equal(sent.get('redirect_uri'), 'https://host.test/app/');
  assert.equal(sent.get('response_type'), 'id_token');
  assert.match(sent.get('scope'), /openid.*email/);
  assert.ok(state.length >= 32 && nonce.length >= 32 && state !== nonce);
  assert.deepEqual(JSON.parse(win.stored.get(PENDING_KEY)), { state, nonce, at: NOW });
  assert.notEqual(started().state, state, 'a new one each time');
  assert.equal(appRootAddress({ ...win, document: { querySelector: () => null } }), 'https://host.test/');
});

test('a matching answer gives the token, once', () => {
  const { win, state, nonce } = started();
  const idToken = token({ nonce, email: 'someone@host.test' });
  back(win, { state, id_token: idToken });
  assert.deepEqual(finishHomeScreenSignIn(win, NOW + 1000), { idToken });
  assert.equal(finishHomeScreenSignIn(win, NOW + 1000), null);
  assert.equal(win.stored.has(PENDING_KEY), false);
});

test('an ordinary launch is not a return', () => {
  assert.equal(finishHomeScreenSignIn(started().win, NOW), null);
});

test('an answer that does not match what this device asked for is refused', () => {
  const unasked = fakeWindow();
  back(unasked, { state: 'x', id_token: token({ nonce: 'y' }) });
  assert.match(finishHomeScreenSignIn(unasked, NOW).error, /Could not finish/);

  const wrongState = started();
  back(wrongState.win, { state: 'someone-else', id_token: token({ nonce: wrongState.nonce }) });
  assert.match(finishHomeScreenSignIn(wrongState.win, NOW).error, /Could not finish/);
  assert.equal(wrongState.win.stored.has(PENDING_KEY), true, 'a stray link does not cancel the sign-in in progress');

  for (const idToken of [token({ nonce: 'replayed' }), 'not-a-token', '']) {
    const s = started();
    back(s.win, { state: s.state, id_token: idToken });
    assert.match(finishHomeScreenSignIn(s.win, NOW).error, /Could not finish/);
  }

  const late = started();
  back(late.win, { state: late.state, id_token: token({ nonce: late.nonce }) });
  assert.match(finishHomeScreenSignIn(late.win, NOW + MAX_AGE_MS + 1).error, /too long/);
});

test('cancelling or a Google error is explained', () => {
  const cancelled = started();
  back(cancelled.win, { state: cancelled.state, error: 'access_denied' });
  assert.match(finishHomeScreenSignIn(cancelled.win, NOW).error, /cancelled/);
  const failed = started();
  back(failed.win, { state: failed.state, error: 'server_error' });
  assert.match(finishHomeScreenSignIn(failed.win, NOW).error, /server_error/);
});

// Runs the real script from public/index.html against a made-up address.
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8');
const capture = html.match(/<script id="google-return">([\s\S]*?)<\/script>/)[1];
function open(hash) {
  const window = {};
  const replaced = [];
  vm.runInContext(capture, vm.createContext({ window, location: { hash, pathname: '/app/', search: '' }, history: { state: null, replaceState: (_s, _t, url) => replaced.push(url) } }));
  return { returned: window.__googleReturn, replaced };
}

test('the page takes the answer out of the address before the app starts', () => {
  assert.deepEqual(open('#state=a&id_token=b.c.d'), { returned: 'state=a&id_token=b.c.d', replaced: ['/app/'] });
  assert.deepEqual(open('#error=access_denied&state=a'), { returned: 'error=access_denied&state=a', replaced: ['/app/'] });
  for (const hash of ['', '#section', '#state=a', '#id_token=b']) assert.deepEqual(open(hash), { returned: undefined, replaced: [] }, hash);
  assert.ok(html.indexOf('id="google-return"') < html.indexOf('</head>'), 'it sits in the head, ahead of the app bundle');
});
