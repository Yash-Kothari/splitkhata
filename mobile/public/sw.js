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
 */
const CACHE = 'splitkhata-offline-v1';
const SCOPE = self.registration.scope; // e.g. https://host/splitkhata/
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SCOPE, { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('splitkhata-offline-') && k !== CACHE).map((k) => caches.delete(k))))
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
  // Drop bundles from earlier deploys - every deploy has new hashed names.
  const hasCurrentBundle = wanted.some((u) => u.includes('/_expo/static/js/'));
  if (!hasCurrentBundle) return;
  const keep = new Set(wanted);
  for (const request of await cache.keys()) {
    const isOldBundle = request.url.includes('/_expo/static/js/') || request.url.includes('/_expo/static/css/');
    if (isOldBundle && !keep.has(request.url)) await cache.delete(request);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cache-urls' && Array.isArray(data.urls)) event.waitUntil(cacheUrls(data.urls));
});
