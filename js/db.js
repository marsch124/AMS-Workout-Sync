/*
 * Local storage for the app: settings, the cached workbook, and the queue of
 * sessions you have logged but which have not reached Dropbox yet.
 *
 * The queue is the important idea. Pools and gyms have no signal, so logging a
 * session never waits on the network: the entry is written here first and shown
 * straight away. Syncing then downloads the *current* file from Dropbox and
 * replays the queue onto it. Replaying rather than uploading a locally-edited
 * copy is what stops the app from overwriting changes you made in Excel on the
 * laptop in the meantime.
 */
const AmsDb = (function () {
    'use strict';

    const DB_NAME = 'ams-workout';
    /*
     * Version 2 added the two photo stores. The upgrade only creates what is
     * missing, so a phone that has been logging since version 1 keeps its
     * queue and its settings and simply gains the new stores.
     */
    const DB_VERSION = 2;
    const STORE_KV = 'kv';
    const STORE_QUEUE = 'queue';
    /*
     * Photographs are split in two on purpose. The metadata is read whole at
     * every boot so a session can show how many pictures it has without
     * waiting; if the pictures were in the same records, that read would pull
     * a season of photographs into memory to count them.
     */
    const STORE_PHOTOS = 'photos';
    const STORE_PHOTO_BLOBS = 'photoBlobs';

    let dbPromise = null;
    const memory = new Map();

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_KV)) {
                    db.createObjectStore(STORE_KV);
                }
                if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                    db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
                    db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_PHOTO_BLOBS)) {
                    db.createObjectStore(STORE_PHOTO_BLOBS);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
        });
        return dbPromise;
    }

    function tx(store, mode, work) {
        return open().then((db) => new Promise((resolve, reject) => {
            const transaction = db.transaction(store, mode);
            const request = work(transaction.objectStore(store));
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            if (request) {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } else {
                transaction.oncomplete = () => resolve();
            }
        }));
    }

    /* ---------- settings ---------- */

    async function get(key, fallback) {
        if (memory.has(key)) return memory.get(key);
        try {
            const value = await tx(STORE_KV, 'readonly', (store) => store.get(key));
            const result = value === undefined ? fallback : value;
            memory.set(key, result);
            return result;
        } catch (err) {
            return fallback;
        }
    }

    async function set(key, value) {
        memory.set(key, value);
        await tx(STORE_KV, 'readwrite', (store) => store.put(value, key));
        return value;
    }

    async function remove(key) {
        memory.delete(key);
        await tx(STORE_KV, 'readwrite', (store) => store.delete(key));
    }

    /* ---------- cached workbook ---------- */

    /*
     * The last workbook we downloaded, kept so today's plan is readable with no
     * connection at all. `rev` is Dropbox's version marker for the file — the
     * app sends it back on upload so Dropbox refuses the write if the file has
     * changed underneath us.
     */
    /*
     * Best effort, deliberately. This copy is a convenience — it makes today's
     * session readable with no signal — and a phone that is full, or in a
     * private window, will refuse the write. That must not take down the load
     * that produced it: the workbook in hand is still perfectly usable, and
     * failing here used to abandon it and show an error for a file that had
     * downloaded fine.
     */
    async function saveWorkbook(bytes, meta) {
        try {
            await set('workbook.bytes', bytes);
            await set('workbook.meta', Object.assign({ savedAt: Date.now() }, meta || {}));
            return true;
        } catch (err) {
            console.warn('The workbook could not be cached on this device:', err);
            // The metadata alone is small and worth keeping if it will go.
            try {
                await set('workbook.meta', Object.assign({ savedAt: Date.now(), uncached: true }, meta || {}));
            } catch (ignored) { /* nothing more to try */ }
            return false;
        }
    }

    async function getWorkbook() {
        try {
            const bytes = await get('workbook.bytes', null);
            const meta = await get('workbook.meta', null);
            if (!bytes || !bytes.length) return null;
            return { bytes, meta: meta || {} };
        } catch (err) {
            console.warn('The cached workbook could not be read back:', err);
            return null;
        }
    }

    /* ---------- the pending queue ---------- */

    function newId() {
        return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /*
     * One logged session waiting to be written into the workbook. The workout
     * is identified by sheet + row *and* by date + discipline, so that if rows
     * shift in Excel before the entry syncs, it can still be matched.
     */
    async function queue(entry) {
        const record = Object.assign({
            id: newId(),
            createdAt: Date.now(),
            attempts: 0,
            lastError: null
        }, entry);
        try {
            await tx(STORE_QUEUE, 'readwrite', (store) => store.put(record));
        } catch (err) {
            // This one is not survivable quietly: the whole promise of logging
            // offline is that the entry is safe on the phone. If it is not, the
            // person needs to hear so while they still remember the numbers.
            throw new Error('This phone would not store the entry, so it was not saved. '
                + 'Free some space, or check that private browsing is off, and enter it again.');
        }
        return record;
    }

    async function listQueue() {
        try {
            const all = await tx(STORE_QUEUE, 'readonly', (store) => store.getAll());
            return (all || []).sort((a, b) => a.createdAt - b.createdAt);
        } catch (err) {
            return [];
        }
    }

    async function updateQueued(record) {
        await tx(STORE_QUEUE, 'readwrite', (store) => store.put(record));
        return record;
    }

    async function unqueue(id) {
        await tx(STORE_QUEUE, 'readwrite', (store) => store.delete(id));
    }

    async function clearQueue() {
        await tx(STORE_QUEUE, 'readwrite', (store) => store.clear());
    }

    async function queueCount() {
        return (await listQueue()).length;
    }

    /* ---------- photographs ---------- */

    /*
     * A picture and its description go in together or not at all. Two separate
     * transactions could leave metadata pointing at a picture that was never
     * written, which would show as a broken thumbnail with no way to clear it;
     * one transaction over both stores cannot.
     */
    function photoTx(mode, work) {
        return open().then((db) => new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_PHOTOS, STORE_PHOTO_BLOBS], mode);
            let result;
            const request = work(transaction.objectStore(STORE_PHOTOS),
                transaction.objectStore(STORE_PHOTO_BLOBS));
            if (request) request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        }));
    }

    async function putPhoto(meta, blob) {
        try {
            await photoTx('readwrite', (photos, blobs) => {
                photos.put(meta);
                blobs.put(blob, meta.id);
            });
        } catch (err) {
            // Worth saying out loud, like the queue: a photo the person thinks
            // they attached and which is not there is the failure that only
            // shows up when they go looking for it months later.
            throw new Error('This phone would not store that picture. '
                + 'It may be out of space, or in private browsing.');
        }
        return meta;
    }

    async function listPhotoMeta() {
        try {
            return (await tx(STORE_PHOTOS, 'readonly', (store) => store.getAll())) || [];
        } catch (err) {
            return [];
        }
    }

    async function getPhotoBlob(id) {
        try {
            return await tx(STORE_PHOTO_BLOBS, 'readonly', (store) => store.get(id));
        } catch (err) {
            return null;
        }
    }

    async function deletePhoto(id) {
        await photoTx('readwrite', (photos, blobs) => {
            photos.delete(id);
            blobs.delete(id);
        });
    }

    async function clearPhotos() {
        await photoTx('readwrite', (photos, blobs) => {
            photos.clear();
            blobs.clear();
        });
    }

    /* ---------- wholesale reset ---------- */

    async function reset() {
        memory.clear();
        await tx(STORE_KV, 'readwrite', (store) => store.clear());
        await clearQueue();
    }

    return {
        open, get, set, remove,
        saveWorkbook, getWorkbook,
        queue, listQueue, updateQueued, unqueue, clearQueue, queueCount,
        putPhoto, listPhotoMeta, getPhotoBlob, deletePhoto, clearPhotos,
        reset
    };
})();
