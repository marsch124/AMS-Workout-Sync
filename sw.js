/*
 * Offline support.
 *
 * The app shell is cached on install so the app opens without a network; the
 * plan itself is already on the device in IndexedDB. Dropbox is deliberately
 * never cached — a stale workbook would be worse than no workbook.
 */
const CACHE_NAME = 'ams-workout-sync-v1';
const BASE = '/AMS-Workout-Sync/';

const SHELL = [
    BASE,
    BASE + 'index.html',
    BASE + 'css/style.css',
    BASE + 'js/db.js',
    BASE + 'js/zip.js',
    BASE + 'js/xlsx.js',
    BASE + 'js/mapping.js',
    BASE + 'js/plan.js',
    BASE + 'js/dropbox.js',
    BASE + 'js/sync.js',
    BASE + 'js/ui.js',
    BASE + 'js/app.js',
    BASE + 'manifest.json',
    BASE + 'icons/icon-192.png',
    BASE + 'icons/icon-512.png',
    BASE + 'icons/icon-512-maskable.png',
    BASE + 'icons/apple-touch-icon.png',
    BASE + 'icons/favicon-64.png'
];

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
                if (event.request.mode === 'navigate') return caches.match(BASE + 'index.html');
                return new Response('', { status: 504, statusText: 'Offline' });
            }))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
