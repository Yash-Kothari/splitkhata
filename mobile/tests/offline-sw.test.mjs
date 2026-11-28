import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Runs the real public/sw.js against a made-up build, network and cache. Offline, every tab has to open: each tab's code is
// its own file, fetched only when the tab is opened, and a missing one crashes the whole app.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');
const SCOPE = 'https://host.test/splitkhata/';
const js = (name) => `${SCOPE}_expo/static/js/web/${name}.js`;
const font = `${SCOPE}assets/fonts/Inter.ttf`;

// One build: the page loads `entry`, which names the lazy tab files by path, and one of those names another.
function build(version) {
  const path = (name) => `/splitkhata/_expo/static/js/web/${name}.js`;
  return {
    [SCOPE]: `<html><script src="${path(`entry-${version}`)}" defer></script></html>`,
    [js(`entry-${version}`)]: `const tabs = ["${path(`travel-${version}`)}", "${path(`cards-${version}`)}"];`,
    [js(`travel-${version}`)]: `import("${path(`travel-extra-${version}`)}")`,
    [js(`travel-extra-${version}`)]: 'extra();',
    [js(`cards-${version}`)]: 'cards();',
    [font]: 'font-bytes',
  };
}

function response(body) {
  return { ok: true, status: 200, body, clone: () => response(body), text: async () => body };
}

function sandbox() {
  const stores = new Map();
  const net = { files: {}, offline: false, failing: new Set() };
  const urlOf = (r) => (typeof r === 'string' ? r : r.url);
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      match: async (r) => (map.has(urlOf(r)) ? response(map.get(urlOf(r))) : undefined),
      put: async (r, res) => void map.set(urlOf(r), await res.clone().text()),
      keys: async () => [...map.keys()].map((url) => ({ url })),
      delete: async (r) => map.delete(urlOf(r)),
    };
  };
  const handlers = {};
  const context = vm.createContext({
    self: {
      registration: { scope: SCOPE },
      location: new URL(SCOPE),
      addEventListener: (type, fn) => (handlers[type] = fn),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async (n) => cacheFor(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) },
    fetch: async (r) => {
      const url = urlOf(r);
      if (net.offline || net.failing.has(url) || !(url in net.files)) throw new TypeError('network failed');
      return response(net.files[url]);
    },
    Request: function Request(url) {
      this.url = url;
    },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Set,
  });
  vm.runInContext(source, context);
  const fire = async (type, data) => {
    let waited = Promise.resolve();
    handlers[type]({ data, waitUntil: (p) => (waited = p) });
    await waited;
  };
  const current = () => [...stores.keys()].find((k) => k === vm.runInContext('CACHE', context));
  const saved = () => [...(stores.get(current())?.keys() || [])];
  return { net, stores, fire, saved };
}

// What the page sends after loading: only the files this launch happened to pull in.
const launch = (sw, version, extra = []) => sw.fire('message', { type: 'cache-urls', urls: [SCOPE, js(`entry-${version}`), ...extra] });

test('installing saves every tab file of the build, including ones nobody has opened', async () => {
  const sw = sandbox();
  sw.net.files = build('v1');
  await sw.fire('install');
  for (const name of ['entry-v1', 'travel-v1', 'travel-extra-v1', 'cards-v1']) assert.ok(sw.saved().includes(js(name)), `${name} saved`);
  assert.ok(sw.saved().includes(SCOPE), 'and the page itself');
});

test('a later launch that opens only the first screen keeps every other tab (it used to delete them)', async () => {
  const sw = sandbox();
  sw.net.files = build('v1');
  await sw.fire('install');
  await launch(sw, 'v1');
  await launch(sw, 'v1');
  for (const name of ['travel-v1', 'travel-extra-v1', 'cards-v1']) assert.ok(sw.saved().includes(js(name)), `${name} still saved`);
  // and offline, a launch deletes nothing at all
  sw.net.offline = true;
  await launch(sw, 'v1');
  assert.ok(sw.saved().includes(js('cards-v1')));
});

test('after a new deploy the new tabs are saved and the old build is removed - but only once the new one is complete', async () => {
  const sw = sandbox();
  sw.net.files = build('v1');
  await sw.fire('install');
  sw.net.files = { ...build('v2') };
  sw.net.failing = new Set([js('cards-v2')]); // a patchy connection: one new tab file cannot be fetched
  await launch(sw, 'v2');
  assert.ok(sw.saved().includes(js('cards-v1')), 'nothing is deleted while the new build is incomplete');
  assert.ok(sw.saved().includes(js('travel-v2')));
  sw.net.failing = new Set();
  await launch(sw, 'v2');
  assert.ok(sw.saved().includes(js('cards-v2')));
  assert.equal(sw.saved().some((u) => u.includes('-v1.js')), false, 'the old build is gone');
});

test('updating from an older worker carries its fonts over before removing its cache', async () => {
  const sw = sandbox();
  sw.net.files = build('v1');
  sw.stores.set('splitkhata-offline-v1', new Map([[font, 'font-bytes'], [js('entry-v0'), 'old']]));
  await sw.fire('install');
  await sw.fire('activate');
  assert.ok(sw.saved().includes(font));
  assert.equal(sw.saved().includes(js('entry-v0')), false, 'old code is not carried over');
  assert.equal(sw.stores.has('splitkhata-offline-v1'), false);
});
