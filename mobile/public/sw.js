/* Splitkhata offline support.
 *
 * Keeps the app itself (page shell, JS bundle, fonts, icons) in a local cache
 * so the website opens with no internet. Data is separate: Firestore already
 * keeps its own offline copy in IndexedDB and queues writes until you are back
 * online (lib/firebase.js), so this only has to get the app on screen.
 *
 * - Same-origin GET requests under this worker's scope only. Everything else
 *   (Firestore, Auth, Sentry, the AI calls) is cross-origin and is left to the
 *   browser untouched.
 * - The page itself is network-first, always revalidated, so a new deploy is
 *   picked up the next time you open the app with a connection; the cached
 *   shell is only used when the network fails or is too slow.
 * - Hashed build files (/_expo/static, /assets) never change for a given URL,
 *   so they are cache-first.
 * - Every tab's code is a separate file that is only fetched when the tab is opened, so
 *   the whole build is saved up front (see cacheBuild): offline, every tab must open,
 *   including one never opened before. A missing file crashes the whole app.
 */
const CACHE = 'splitkhata-offline-v2';
const SCOPE = self.registration.scope; // e.g. https://host/splitkhata/
const NAVIGATION_TIMEOUT_MS = 4000;

// A build file named inside another one (the entry bundle lists the lazy tab files this way).
const BUILD_REFERENCE = /["'`]([^"'`\s]*\/_expo\/static\/(?:js|css)\/[^"'`\s]+?\.(?:js|css))["'`]/g;
// The script and style files the page itself pulls in.
const PAGE_REFERENCE = /(?:src|href)=["']([^"']*\/_expo\/static\/(?:js|css)\/[^"']+?\.(?:js|css))["']/g;

function inScope(path) {
  const url = new URL(path, SCOPE).href;
  return url.startsWith(SCOPE) ? url : null;
}

// Saves every file of a build that can be reached from `roots` (the page's own scripts and styles), following the names
// the scripts mention. `complete` is false if any of them could not be read, and then nothing may be deleted.
async function cacheBuild(cache, roots) {
  const files = new Set();
  const queue = [...roots];
  let complete = true;
  while (queue.length) {
    const url = queue.shift();
    if (files.has(url)) continue;
    files.add(url);
    try {
      let res = await cache.match(url);
      if (!res) {
        res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await cache.put(url, res.clone());
      }
      if (url.endsWith('.js')) {
        const text = await res.clone().text();
        for (const match of text.matchAll(BUILD_REFERENCE)) {
          const next = inScope(match[1]);
          if (next && !files.has(next)) queue.push(next);
        }
      }
    } catch (_) {
      complete = false;
    }
  }
  return { files, complete };
}

async function installShellAndBuild() {
  const cache = await caches.open(CACHE);
  const shell = await fetch(new Request(SCOPE, { cache: 'reload' }));
  if (!shell.ok) return;
  await cache.put(SCOPE, shell.clone());
  const html = await shell.text();
  await cacheBuild(cache, [...html.matchAll(PAGE_REFERENCE)].map((m) => inScope(m[1])).filter(Boolean));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    installShellAndBuild()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

// The fonts and icons an earlier version saved are carried over before its cache is removed, so an update is never the
// moment the app loses something it needs offline.
async function retireOldCaches() {
  const cache = await caches.open(CACHE);
  const old = (await caches.keys()).filter((k) => k.startsWith('splitkhata-offline-') && k !== CACHE);
  for (const name of old) {
    const previous = await caches.open(name);
    for (const request of await previous.keys()) {
      if (!request.url.includes('/assets/') || (await cache.match(request))) continue;
      const res = await previous.match(request);
      if (res) await cache.put(request, res);
    }
    await caches.delete(name);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    retireOldCaches()
      .catch(() => {})
      .then(() => self.clients.claim()),
  );
});

function isHashedBuildFile(url) {
  return url.pathname.includes('/_expo/static/') || url.pathname.includes('/assets/');
}

async function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { cache: 'no-cache', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function refreshShell() {
  try {
    const res = await fetch(SCOPE, { cache: 'no-cache' });
    if (res.ok) await (await caches.open(CACHE)).put(SCOPE, res);
  } catch (_) {
    // offline - keep the shell we have
  }
}

async function handleNavigation(request) {
  try {
    // GitHub Pages answers a deep link (/travel) with the shell as a 404; it is
    // still the app, so any response counts - only a failure falls back.
    const res = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    refreshShell();
    return res;
  } catch (_) {
    const cached = await (await caches.open(CACHE)).match(SCOPE);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
  } else if (isHashedBuildFile(url)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// The page tells the worker which files its first load already pulled in (it
// loaded them before this worker controlled it), so the very first visit is
// enough to work offline afterwards.
async function cacheUrls(urls) {
  const cache = await caches.open(CACHE);
  const wanted = urls.filter((u) => typeof u === 'string' && u.startsWith(SCOPE) && !u.endsWith('/sw.js'));
  await Promise.all(
    wanted.map(async (u) => {
      try {
        if (await cache.match(u)) return;
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch (_) {
        // fetched later at runtime if it is needed
      }
    }),
  );
  // The tabs not opened this time are part of this build too: save them, so they open offline.
  const roots = wanted.filter((u) => u.includes('/_expo/static/') && /\.(js|css)$/.test(u));
  const { files, complete } = await cacheBuild(cache, roots);
  // Drop bundles from earlier deploys (every deploy has new hashed names) - only when the whole current build was read,
  // so a launch with a poor connection can never delete a file that is still needed.
  const hasCurrentBundle = wanted.some((u) => u.includes('/_expo/static/js/'));
  if (!hasCurrentBundle || !complete) return;
  const keep = new Set([...wanted, ...files]);
  for (const request of await cache.keys()) {
    const isOldBundle = request.url.includes('/_expo/static/js/') || request.url.includes('/_expo/static/css/');
    if (isOldBundle && !keep.has(request.url)) await cache.delete(request);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cache-urls' && Array.isArray(data.urls)) event.waitUntil(cacheUrls(data.urls));
});
