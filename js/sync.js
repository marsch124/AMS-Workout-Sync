/*
 * The part that keeps the phone and the workbook agreeing with each other.
 *
 * Reading is cheap and forgiving: if Dropbox is reachable the workbook is
 * fetched, otherwise the last copy is read from the phone, so today's session
 * is always on screen.
 *
 * Writing is deliberately indirect. Logging a session only adds it to a queue.
 * A sync then downloads the workbook as it stands *now*, replays the queue onto
 * that copy, and uploads with the rev it just read — so an edit you made in
 * Excel between logging and syncing is never overwritten. If the file moved on
 * mid-sync, Dropbox refuses the write and the whole cycle simply runs again.
 */
const AmsSync = (function () {
    'use strict';

    const state = {
        workbook: null,
        mapping: null,
        plan: [],
        meta: null,
        source: null,      // 'dropbox' | 'cache' | 'file'
        lastError: null,
        syncing: false
    };

    const listeners = new Set();

    function subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function emit(event, detail) {
        for (const fn of listeners) {
            try { fn(event, detail || {}); } catch (err) { console.error(err); }
        }
    }

    function getState() {
        return state;
    }

    /* ---------- settings ---------- */

    function filePath() {
        return AmsDb.get('workbook.path', '');
    }

    async function setFile(file) {
        await AmsDb.set('workbook.path', file.path);
        await AmsDb.set('workbook.name', file.name || '');
        await AmsDb.remove('mapping');           // a new file needs a new layout
        state.mapping = null;
    }

    async function getMapping() {
        return AmsDb.get('mapping', null);
    }

    async function saveMapping(mapping) {
        state.mapping = mapping;
        await AmsDb.set('mapping', mapping);
        if (state.workbook) {
            state.plan = await buildPlan(state.workbook, mapping);
            await overlayQueue();
            emit('plan', { plan: state.plan });
        }
        return mapping;
    }

    /* ---------- loading ---------- */

    async function openBytes(bytes) {
        return AmsXlsx.open(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }

    /*
     * Everything a freshly detected mapping needs before it can be used: the
     * units the workbook keeps its numbers in, and the marker its own formulas
     * expect in the completed column.
     */
    async function prepareMapping(workbook, mapping) {
        if (!mapping) return mapping;
        if (!mapping.units) await AmsPlan.inferUnits(workbook, mapping);
        if (!mapping.doneValue || !mapping.missedValue) {
            const markers = await AmsPlan.detectDoneMarkers(workbook, mapping);
            if (!mapping.doneValue) mapping.doneValue = markers.done || 'Yes';
            if (!mapping.missedValue) mapping.missedValue = markers.missed || 'Missed';
        }
        return mapping;
    }

    async function buildPlan(workbook, mapping) {
        if (!AmsMapping.isComplete(mapping)) return [];
        await prepareMapping(workbook, mapping);
        return AmsPlan.build(workbook, mapping);
    }

    /*
     * Bring the plan on screen. Prefers Dropbox, falls back to the cached copy,
     * and never throws for want of a network — an offline start is normal.
     */
    async function load(options) {
        const opts = options || {};
        const path = await filePath();
        let bytes = null;
        let meta = null;
        let source = null;

        const connected = await AmsDropbox.isConnected();

        if (path && connected && navigator.onLine !== false && !opts.cacheOnly) {
            try {
                const file = await AmsDropbox.download(path);
                bytes = file.bytes;
                meta = { rev: file.rev, name: file.name, path: file.path, modified: file.modified, size: file.size };
                source = 'dropbox';
                await AmsDb.saveWorkbook(bytes, meta);
                state.lastError = null;
            } catch (err) {
                state.lastError = err.message;
                emit('error', { error: err, phase: 'download' });
            }
        }

        if (!bytes) {
            const cached = await AmsDb.getWorkbook();
            if (cached) {
                bytes = cached.bytes;
                meta = cached.meta;
                source = 'cache';
            }
        }

        if (!bytes) {
            state.workbook = null;
            state.plan = [];
            state.meta = null;
            state.source = null;
            emit('plan', { plan: [] });
            return state;
        }

        state.workbook = await openBytes(bytes);
        state.meta = meta;
        state.source = source;

        let mapping = await getMapping();
        if (!AmsMapping.isComplete(mapping)) {
            mapping = await AmsMapping.autoDetect(state.workbook);
            if (mapping) {
                await prepareMapping(state.workbook, mapping);
                await AmsDb.set('mapping', mapping);
            }
        }
        state.mapping = mapping;

        state.plan = mapping ? await buildPlan(state.workbook, mapping) : [];
        await overlayQueue();
        emit('plan', { plan: state.plan, source: source });
        return state;
    }

    /* Open a workbook the user picked from their phone rather than Dropbox. */
    async function loadFromFile(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        state.workbook = await openBytes(bytes);
        state.meta = { name: file.name, local: true };
        state.source = 'file';
        await AmsDb.set('workbook.name', file.name);
        await AmsDb.saveWorkbook(bytes, state.meta);

        let mapping = await getMapping();
        if (!AmsMapping.isComplete(mapping)) {
            mapping = await AmsMapping.autoDetect(state.workbook);
            if (mapping) await prepareMapping(state.workbook, mapping);
        }
        state.mapping = mapping;
        if (mapping) await AmsDb.set('mapping', mapping);

        state.plan = mapping ? await buildPlan(state.workbook, mapping) : [];
        await overlayQueue();
        emit('plan', { plan: state.plan, source: 'file' });
        return state;
    }

    /* ---------- logging ---------- */

    /*
     * Record a session. It lands in the queue and on screen immediately; the
     * upload is a separate concern that may happen seconds or hours later.
     */
    async function logWorkout(workout, values) {
        const record = await AmsDb.queue({
            workoutKey: workout.key,
            sheet: workout.sheet,
            row: workout.row,
            dayKey: workout.dayKey,
            disciplineId: workout.discipline.id,
            title: workout.title,
            values: values
        });

        await overlayQueue();
        emit('plan', { plan: state.plan });
        emit('queued', { entry: record });

        // Try to get it into Dropbox now, but a failure here is not the user's
        // problem — the entry is safe in the queue either way.
        if (await AmsDropbox.isConnected()) {
            sync().catch(() => {});
        }
        return record;
    }

    /*
     * Record that a session did not happen. Queued and synced by exactly the
     * same path as a logged one — the difference is only in what gets written.
     */
    async function markMissed(workout, note) {
        return logWorkout(workout, { missed: true, notes: note || '' });
    }

    /* Show queued entries on the plan as though they were already in the file. */
    async function overlayQueue() {
        const queued = await AmsDb.listQueue();
        const byKey = new Map();
        for (const entry of queued) byKey.set(entry.workoutKey, entry);

        for (const workout of state.plan) {
            const entry = matchEntry(queued, workout);
            workout.pending = null;
            if (entry) {
                workout.pending = entry;
                workout.logged = true;
            }
        }
        return queued;
    }

    /*
     * Find the queued entry belonging to a workout. Matching on the day and
     * discipline as well as the row means an entry still finds its home if the
     * spreadsheet gained a row in the meantime.
     */
    function matchEntry(queued, workout) {
        return queued.find((entry) => entry.workoutKey === workout.key)
            || queued.find((entry) => entry.dayKey === workout.dayKey
                && entry.disciplineId === workout.discipline.id
                && entry.sheet === workout.sheet)
            || null;
    }

    function findWorkoutFor(entry, plan) {
        return plan.find((w) => w.key === entry.workoutKey)
            || plan.find((w) => w.dayKey === entry.dayKey
                && w.discipline.id === entry.disciplineId
                && w.sheet === entry.sheet)
            || null;
    }

    /* ---------- syncing ---------- */

    /*
     * Push the queue into the workbook in Dropbox. Returns a summary rather
     * than throwing for the ordinary failures, since this runs in the
     * background as often as it runs from a button.
     */
    async function sync(options) {
        const opts = options || {};
        if (state.syncing) return { skipped: 'already-syncing' };

        const path = await filePath();
        if (!path) return { skipped: 'no-file' };
        if (!(await AmsDropbox.isConnected())) return { skipped: 'not-connected' };

        const queued = await AmsDb.listQueue();
        if (!queued.length && !opts.force) return { skipped: 'nothing-to-do' };

        state.syncing = true;
        emit('sync', { phase: 'start' });

        try {
            // Always work from the copy that is in Dropbox right now.
            const file = await AmsDropbox.download(path);
            const workbook = await openBytes(file.bytes);

            let mapping = await getMapping();
            if (!AmsMapping.isComplete(mapping)) {
                mapping = await AmsMapping.autoDetect(workbook);
                if (!mapping) throw new Error('The layout of this workbook could not be worked out — open Sheet setup.');
                await prepareMapping(workbook, mapping);
                await AmsDb.set('mapping', mapping);
            }
            await prepareMapping(workbook, mapping);

            const plan = await AmsPlan.build(workbook, mapping);

            const written = [];
            const failed = [];

            for (const entry of queued) {
                const workout = findWorkoutFor(entry, plan);
                if (!workout) {
                    entry.attempts = (entry.attempts || 0) + 1;
                    entry.lastError = 'No row in the workbook matches this session any more.';
                    await AmsDb.updateQueued(entry);
                    failed.push(entry);
                    continue;
                }
                const edits = AmsPlan.buildEdits(workout, entry.values, mapping);
                if (!edits.length) {
                    // Nothing mappable to write — drop it rather than retry forever.
                    await AmsDb.unqueue(entry.id);
                    continue;
                }
                await workbook.writeCells(workout.sheet, edits);
                written.push(entry);
            }

            if (!written.length) {
                state.syncing = false;
                emit('sync', { phase: 'done', written: 0, failed: failed.length });
                return { written: 0, failed: failed.length };
            }

            const blob = await workbook.save();
            await AmsDropbox.upload(path, blob, file.rev);

            for (const entry of written) await AmsDb.unqueue(entry.id);

            // Re-read so the app is looking at exactly what Dropbox now holds.
            state.syncing = false;
            await load();
            emit('sync', { phase: 'done', written: written.length, failed: failed.length });
            return { written: written.length, failed: failed.length };

        } catch (err) {
            state.syncing = false;

            if (err.isConflict && !opts.noRetry) {
                // Someone saved the file while we were working. Start again on
                // the newer version — the queue is still intact.
                emit('sync', { phase: 'conflict' });
                return sync({ noRetry: true });
            }

            state.lastError = err.message;
            emit('sync', { phase: 'failed', error: err });
            emit('error', { error: err, phase: 'sync' });
            return { error: err.message };
        }
    }

    /*
     * Persist edits made to the workbook held in memory — at present, the
     * result columns Sheet setup can append to a plan that has none.
     *
     * This cannot go through sync(): that deliberately starts from a freshly
     * downloaded copy and replays the queue onto it, which is right for logged
     * sessions but would throw these edits away. Here the in-memory workbook
     * *is* the edit.
     *
     * The cached copy is always updated, so the plan on screen and "Save a
     * copy" both see the new columns even with no Dropbox connection at all.
     */
    async function persistWorkbookEdits() {
        if (!state.workbook || !state.workbook.isDirty) return { skipped: 'nothing-to-do' };

        const blob = await state.workbook.save();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const path = await filePath();
        const connected = await AmsDropbox.isConnected();

        if (path && connected) {
            try {
                // The rev we read at, so a change made in Excel meanwhile still
                // refuses the write rather than being buried.
                const written = await AmsDropbox.upload(path, blob, state.meta && state.meta.rev);
                await AmsDb.saveWorkbook(bytes, {
                    rev: written.rev,
                    name: written.name,
                    path: written.path_lower || path,
                    modified: written.server_modified,
                    size: written.size
                });
                await load();
                return { uploaded: true };
            } catch (err) {
                if (err.isConflict) {
                    return { error: 'The workbook changed in Dropbox while you were editing the layout. '
                        + 'Open Sheet setup again and re-add the columns.' };
                }
                state.lastError = err.message;
                return { error: err.message };
            }
        }

        // No Dropbox behind this file: keep the edits on the phone.
        await AmsDb.saveWorkbook(bytes, state.meta || {});
        state.workbook = await openBytes(bytes);
        const mapping = await getMapping();
        state.plan = mapping ? await buildPlan(state.workbook, mapping) : [];
        await overlayQueue();
        emit('plan', { plan: state.plan });
        return { savedLocally: true };
    }

    /*
     * For the no-Dropbox case: apply the queue to the local copy and hand back
     * a file to save wherever the user likes.
     */
    async function exportWorkbook() {
        const cached = await AmsDb.getWorkbook();
        if (!cached) throw new Error('No workbook has been loaded yet.');

        const workbook = await openBytes(cached.bytes);
        let mapping = await getMapping();
        if (!AmsMapping.isComplete(mapping)) throw new Error('Set the sheet layout up first.');
        await prepareMapping(workbook, mapping);

        const plan = await AmsPlan.build(workbook, mapping);
        const queued = await AmsDb.listQueue();
        let count = 0;

        for (const entry of queued) {
            const workout = findWorkoutFor(entry, plan);
            if (!workout) continue;
            const edits = AmsPlan.buildEdits(workout, entry.values, mapping);
            if (edits.length) {
                await workbook.writeCells(workout.sheet, edits);
                count++;
            }
        }

        const blob = await workbook.save();
        const name = (await AmsDb.get('workbook.name', '')) || 'workout-plan.xlsx';
        return { blob: blob, name: name, applied: count };
    }

    /* ---------- selecting workouts ---------- */

    function todayKey() {
        const now = new Date();
        return AmsXlsx.dayKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    }

    function forDay(dayKey) {
        return state.plan.filter((w) => w.dayKey === dayKey);
    }

    function today() {
        return forDay(todayKey());
    }

    function upcoming(limit) {
        const key = todayKey();
        return state.plan.filter((w) => w.dayKey > key).slice(0, limit || 20);
    }

    function recent(limit) {
        const key = todayKey();
        return state.plan.filter((w) => w.dayKey < key).slice(-(limit || 20)).reverse();
    }

    function byKey(key) {
        return state.plan.find((w) => w.key === key) || null;
    }

    return {
        subscribe,
        getState,
        filePath,
        setFile,
        getMapping,
        saveMapping,
        prepareMapping,
        load,
        loadFromFile,
        logWorkout,
        markMissed,
        overlayQueue,
        sync,
        persistWorkbookEdits,
        exportWorkbook,
        todayKey,
        forDay,
        today,
        upcoming,
        recent,
        byKey
    };
})();
