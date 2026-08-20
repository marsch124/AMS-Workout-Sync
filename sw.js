/*
 * Offline support.
 *
 * The app shell is cached on install so the app opens without a network; the
 * plan itself is already on the device in IndexedDB. Dropbox is deliberately
 * never cached — a stale workbook would be worse than no workbook.
 */
// Named after the app version, so shipping a release retires the old cache
// instead of leaving a phone on last week's code. Keep in step with
// AmsVersion.CURRENT in js/version.js.
const APP_VERSION = '1.13.0';
const CACHE_NAME = 'ams-workout-sync-' + APP_VERSION;
// Taken from the worker's own URL rather than hard-coded, so the app works
// wherever it is published — any repository name, a project page, or localhost —
// and a rename never leaves a stale path behind.
const BASE = new URL('./', self.location).href;

const SHELL = [
    '',
    'index.html',
    'css/style.css',
    'js/db.js',
    'js/zip.js',
    'js/xlsx.js',
    'js/mapping.js',
    'js/version.js',
    'js/plan.js',
    'js/extras.js',
    'js/dropbox.js',
    'js/sync.js',
    'js/ui.js',
    'js/app.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-512-maskable.png',
    'icons/apple-touch-icon.png',
    'icons/favicon-64.png'
].map((path) => new URL(path, BASE).href);

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL))
            .catch((err) => console.warn('Shell cache incomplete:', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(
            names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Dropbox, and anything else off-site, always goes to the network.
    if (url.origin !== location.origin) return;

    // Network-first for the app's own files, so a deployed update is picked up
    // on the next launch rather than sticking until the cache is cleared.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => {
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match(new URL('index.html', BASE).href);
                return new Response('', { status: 504, statusText: 'Offline' });
            }))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
