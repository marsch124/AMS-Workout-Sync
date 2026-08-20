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
        extras: [],
        pendingExtras: [],
        watch: [],           /* sessions read out of a workout file */
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

        // What the headings say right now, so a later edit that moves them can
        // be noticed rather than written straight through. Recorded once and
        // then left alone: re-recording on every read would quietly bless
        // whatever the sheet had become, which is the opposite of the point.
        try {
            if (mapping.headings) return finishPreparing(workbook, mapping);
            const sheetName = (mapping.sheets && mapping.sheets[0]) || null;
            if (sheetName && workbook.findSheet(sheetName)) {
                mapping.headings = AmsMapping.headingSignature(
                    await workbook.readSheet(sheetName), mapping);
            }
        } catch (err) {
            console.warn('Could not record the heading signature:', err);
        }

        return finishPreparing(workbook, mapping);
    }

    async function finishPreparing(workbook, mapping) {
        if (!mapping.units) await AmsPlan.inferUnits(workbook, mapping);
        if (!mapping.doneValue || !mapping.missedValue) {
            const markers = await AmsPlan.detectDoneMarkers(workbook, mapping);
            if (!mapping.doneValue) mapping.doneValue = markers.done || 'Yes';
            if (!mapping.missedValue) mapping.missedValue = markers.missed || 'Missed';
        }
        return mapping;
    }

    /*
     * The layout, checked against the workbook actually in hand.
     *
     * Columns move: one inserted in Excel shifts every heading to its right,
     * and a saved layout would go on pointing at where things used to be. That
     * is the quiet catastrophe — durations written into the heart-rate column,
     * every week, with nothing on screen to suggest it. So before anything is
     * written, the headings are made to agree with what was recorded, and the
     * layout is worked out again if they do not.
     */
    async function mappingForWorkbook(workbook, mapping) {
        if (!AmsMapping.isComplete(mapping)) return mapping;

        const sheetName = mapping.sheets && mapping.sheets[0];
        if (!sheetName || !workbook.findSheet(sheetName)) return mapping;

        let holds = true;
        try {
            holds = AmsMapping.headingsHold(await workbook.readSheet(sheetName), mapping);
        } catch (err) {
            return mapping;
        }
        if (holds) return mapping;

        const detected = await AmsMapping.autoDetect(workbook);
        if (!detected) {
            throw new Error('The columns in this workbook have moved and the layout could not be '
                + 'worked out again, so nothing was written. Open Sheet setup and say which column '
                + 'is which.');
        }
        await prepareMapping(workbook, detected);
        await AmsDb.set('mapping', detected);
        emit('remapped', { mapping: detected, shifted: true });
        return detected;
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
        let workbook = null;
        let meta = null;
        let source = null;

        const connected = await AmsDropbox.isConnected();

        if (path && connected && navigator.onLine !== false && !opts.cacheOnly) {
            try {
                const file = await AmsDropbox.download(path);

                /*
                 * Prove it opens before trusting it, and before caching it. A
                 * download cut short by a lift or a lock screen is still bytes;
                 * cached blind, those bytes become what the app reads on every
                 * launch afterwards, and the way out is a full reset. Opening
                 * first costs a moment and keeps a bad copy from sticking.
                 */
                workbook = await openBytes(file.bytes);
                bytes = file.bytes;
                meta = { rev: file.rev, name: file.name, path: file.path, modified: file.modified, size: file.size };
                source = 'dropbox';
                await AmsDb.saveWorkbook(bytes, meta);
                state.lastError = null;
            } catch (err) {
                workbook = null;
                bytes = null;
                state.lastError = err.message;
                emit('error', { error: err, phase: 'download' });
            }
        }

        if (!workbook) {
            const cached = await AmsDb.getWorkbook();
            if (cached) {
                try {
                    workbook = await openBytes(cached.bytes);
                    bytes = cached.bytes;
                    meta = cached.meta;
                    source = 'cache';
                } catch (err) {
                    // The copy on the phone is unreadable, so it is worse than
                    // nothing: keeping it would fail this way on every launch.
                    console.warn('The cached workbook could not be opened; discarding it.', err);
                    try {
                        await AmsDb.remove('workbook.bytes');
                        await AmsDb.remove('workbook.meta');
                    } catch (ignored) { /* nothing more to do */ }
                    state.lastError = 'The copy of the workbook on this phone was unreadable and has been '
                        + 'discarded. Sync to fetch it again.';
                }
            }
        }

        if (!workbook) {
            state.workbook = null;
            state.plan = [];
            state.extras = [];
            state.meta = null;
            state.source = null;
            emit('plan', { plan: [] });
            return state;
        }

        state.workbook = workbook;
        state.meta = meta;
        state.source = source;

        let mapping = await getMapping();
        // A mapping from an older version of the detector is re-read rather
        // than trusted: every later improvement would otherwise never reach a
        // phone that had already been set up once.
        const stale = mapping && mapping.version !== AmsMapping.MAPPING_VERSION;

        /*
         * Headings that have moved matter more than a version number. A column
         * inserted in Excel shifts everything to its right, and a mapping that
         * kept pointing at the old positions would write results into whatever
         * now occupies them.
         */
        let shifted = false;
        if (!stale && AmsMapping.isComplete(mapping)) {
            try {
                const sheetName = mapping.sheets && mapping.sheets[0];
                if (sheetName && state.workbook.findSheet(sheetName)) {
                    shifted = !AmsMapping.headingsHold(await state.workbook.readSheet(sheetName), mapping);
                }
            } catch (err) { /* unreadable: the plan build will report it */ }
        }

        if (!AmsMapping.isComplete(mapping) || stale || shifted) {
            try {
                const detected = await AmsMapping.autoDetect(state.workbook);
                if (detected) {
                    await prepareMapping(state.workbook, detected);
                    await AmsDb.set('mapping', detected);
                    mapping = detected;
                    if (stale || shifted) emit('remapped', { mapping: detected, shifted: shifted });
                }
            } catch (err) {
                // A layout that cannot be guessed is not a reason to show
                // nothing at all: the workbook is open, and Sheet setup can
                // still be reached to say what is where by hand.
                console.warn('The layout of this workbook could not be worked out:', err);
                if (!AmsMapping.isComplete(mapping)) mapping = null;
            }
        }
        state.mapping = mapping;

        /*
         * From here on, one bad part of the workbook must not take the rest of
         * the app with it. A sheet that will not parse leaves an empty plan and
         * a message, not a blank screen.
         */
        try {
            state.plan = mapping ? await buildPlan(state.workbook, mapping) : [];
        } catch (err) {
            console.warn('The plan could not be read from this workbook:', err);
            state.plan = [];
            state.lastError = 'The plan could not be read from this workbook — check Sheet setup.';
        }

        try {
            state.extras = await AmsExtras.read(state.workbook);
        } catch (err) {
            console.warn('The Extras sheet could not be read:', err);
            state.extras = [];
        }

        try {
            await overlayQueue();
        } catch (err) {
            console.warn('The queue could not be overlaid on the plan:', err);
        }

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
        // Read here as well as in load(): a workbook opened from the phone has
        // an Extras sheet like any other, and leaving this out both lost what
        // was on it and left the previous workbook's extras standing.
        state.extras = await AmsExtras.read(state.workbook);
        await overlayQueue();
        emit('plan', { plan: state.plan, source: 'file' });
        return state;
    }

    /* ---------- what the watch says ---------- */

    /*
     * Sessions read out of a file the user opened, waiting to be offered on the
     * Today screen. They live for as long as the app is open: there is no file
     * to read them from again, and re-importing is one tap.
     */
    function addWatchEntry(entry) {
        if (!entry) return null;
        state.watch = (state.watch || []).filter((existing) => existing.id !== entry.id);
        state.watch.push(entry);
        emit('plan', { plan: state.plan });
        return entry;
    }

    function clearWatchEntries() {
        state.watch = [];
        emit('plan', { plan: state.plan });
    }

    /* Today's entries, each with the session it belongs to if there is one. */
    function watchForToday(dayKey) {
        const day = dayKey || todayKey();
        return (state.watch || [])
            .filter((entry) => entry.dayKey === day)
            .map((entry) => ({
                entry: entry,
                workout: AmsWatch.matchTo(entry, state.plan, state.mapping || {}, isRecorded)
            }));
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

    /*
     * Move a session to another day, and swap two sessions' days.
     *
     * A swap is simply two moves, which keeps the replay logic to one case and
     * means a half-applied swap is still coherent.
     */
    async function rescheduleWorkout(workout, toDayKey) {
        const state = getState();
        const weekdayNames = await weekdayNamesFor(workout.sheet);
        return logWorkout(workout, { moveTo: toDayKey, weekdayNames: weekdayNames });
    }

    async function swapWorkouts(a, b) {
        // Both days must be read before either move: queueing the first one
        // immediately rewrites a.dayKey on the plan so the move shows straight
        // away, and reading it afterwards would send both sessions to the same
        // day instead of exchanging them.
        const aDay = a.dayKey;
        const bDay = b.dayKey;
        const first = await rescheduleWorkout(a, bDay);
        const second = await rescheduleWorkout(b, aDay);
        return [first, second];
    }

    async function weekdayNamesFor(sheetName) {
        if (!state.workbook || !state.mapping) return {};
        try {
            const sheet = await state.workbook.readSheet(sheetName);
            return AmsPlan.learnWeekdayNames(sheet, state.mapping);
        } catch (err) {
            return {};
        }
    }

    /*
     * Record something the plan never asked for. Queued exactly like a logged
     * session, but it belongs to no row, so replay appends it to the Extras
     * sheet instead of writing into the plan.
     */
    async function logExtra(entry) {
        const record = await AmsDb.queue({
            extra: true,
            dayKey: entry.date,
            values: { extra: entry }
        });

        // Refresh the pending list, or what was just saved would not appear
        // until the next full load.
        await overlayQueue();
        emit('queued', { entry: record });
        emit('plan', { plan: state.plan });

        if (await AmsDropbox.isConnected()) sync().catch(() => {});
        return record;
    }

    /* Write one queued extra into the workbook, creating the sheet if needed. */
    async function applyExtra(workbook, entry) {
        const value = entry.values.extra;
        // The name is resolved rather than assumed: a workbook may already
        // have a sheet called Extras that has nothing to do with this app.
        const sheetName = await AmsExtras.ensureSheet(workbook);
        const sheet = await workbook.readSheet(sheetName);

        // Appending is not idempotent the way writing to a known row is, so a
        // replay must not add the same thing twice.
        if (AmsExtras.alreadyRecorded(sheet, value)) return true;

        let weekdayNames = {};
        try {
            const mapping = await getMapping();
            if (mapping && mapping.sheets) {
                const planSheet = await workbook.readSheet(mapping.sheets[0]);
                weekdayNames = AmsPlan.learnWeekdayNames(planSheet, mapping);
            }
        } catch (err) { /* fall back to English short names */ }

        const built = AmsExtras.buildEdits(sheet, value, weekdayNames);
        if (!built.edits.length) return false;
        await workbook.writeCells(sheetName, built.edits);
        return true;
    }

    /* Show queued entries on the plan as though they were already in the file. */
    async function overlayQueue() {
        const queued = await AmsDb.listQueue();

        // Extras belong to no row, so they are surfaced separately rather than
        // being matched onto a workout.
        state.pendingExtras = queued
            .filter((entry) => entry.extra)
            .map((entry) => Object.assign({ pending: true }, entry.values.extra));

        const byKey = new Map();
        for (const entry of queued) byKey.set(entry.workoutKey, entry);

        for (const workout of state.plan) {
            const entry = matchEntry(queued, workout);
            workout.pending = null;
            workout.movedTo = null;
            // Back to what the sheet itself says before any queued entry is
            // applied on top, so discarding one takes its effect away with it.
            workout.logged = !!workout.loggedInSheet;
            if (!entry) continue;

            workout.pending = entry;

            // A queued move should show on the day it was moved to, not the day
            // the sheet still says, or the app would look like it ignored you.
            if (entry.values && entry.values.moveTo) {
                const moved = AmsPlan.parseDayKey(entry.values.moveTo);
                if (moved) {
                    workout.date = moved;
                    workout.dayKey = entry.values.moveTo;
                    workout.movedTo = entry.values.moveTo;
                }
            } else {
                workout.logged = true;
            }
        }

        state.plan.sort((a, b) => (a.date - b.date) || a.row - b.row);
        return queued;
    }

    /*
     * Find the queued entry belonging to a workout. Matching on the day and
     * discipline as well as the row means an entry still finds its home if the
     * spreadsheet gained a row in the meantime.
     */
    /*
     * The queue is replayed in order, so where a session has more than one
     * entry the last is what the workbook will end up saying. Showing the
     * first meant the screen and the file could disagree: mark a session
     * missed and then log it, and the app went on calling it missed while the
     * workbook took the log.
     */
    function matchEntry(queued, workout) {
        queued = queued.filter((entry) => !entry.extra);

        const last = (list) => (list.length ? list[list.length - 1] : null);
        return last(queued.filter((entry) => entry.workoutKey === workout.key))
            || last(queued.filter((entry) => entry.dayKey === workout.dayKey
                && entry.disciplineId === workout.discipline.id
                && entry.sheet === workout.sheet))
            || null;
    }

    /*
     * Which row a queued entry belongs to, in a workbook that may have been
     * rewritten since the entry was made.
     *
     * The row number on its own is not enough, and quietly trusting it is the
     * worst thing this app could do: edit the plan in Excel so that Thursday's
     * run becomes a swim, and a run logged before that edit would be written
     * into the swim's row — 8.2 km at 132 bpm, recorded against a technique
     * session, silently, in the only copy.
     *
     * So the row is checked before it is used. The discipline is the hard
     * requirement: a session that is now a different sport is not the session
     * that was logged. Beyond that, either the date or the wording has to still
     * agree — which covers the two ordinary kinds of edit. Rewriting what a
     * session contains leaves its date; moving it to another day leaves its
     * wording. Changing all three makes it a different session, and that is
     * reported rather than guessed at.
     */
    function normaliseTitle(text) {
        return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function titlesAgree(a, b) {
        const x = normaliseTitle(a);
        const y = normaliseTitle(b);
        if (!x || !y) return false;
        if (x === y) return true;
        // "Easy run" against "Easy run + strides": a rewording, not a new session.
        if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return true;
        return x.slice(0, 20) === y.slice(0, 20);
    }

    function stillTheSameSession(workout, entry) {
        if (entry.disciplineId && workout.discipline.id !== entry.disciplineId) return false;
        if (!entry.dayKey && !entry.title) return true;
        return workout.dayKey === entry.dayKey || titlesAgree(workout.title, entry.title);
    }

    function findWorkoutFor(entry, plan) {
        const here = entry.sheet ? plan.filter((w) => w.sheet === entry.sheet) : plan;

        const atTheSameRow = here.find((w) => w.key === entry.workoutKey);
        if (atTheSameRow && stillTheSameSession(atTheSameRow, entry)) return atTheSameRow;

        /*
         * The row is not what it was. It may have moved — rows inserted above
         * it — so the session is looked for by what it is rather than where it
         * was. Rows that already carry a result are passed over first: writing
         * into a session someone has already recorded is its own kind of wrong.
         */
        const sameSession = here.filter((w) => stillTheSameSession(w, entry));
        if (!sameSession.length) return null;
        if (sameSession.length === 1) return sameSession[0];

        const byTitle = sameSession.filter((w) => titlesAgree(w.title, entry.title));
        const pool = byTitle.length ? byTitle : sameSession;

        const untouched = pool.filter((w) => !w.logged);
        const choose = untouched.length ? untouched : pool;

        // Two identical sessions on one day: the nearest row is the best guess
        // that can honestly be made, and it is the one the entry came from.
        return choose.reduce(function (best, w) {
            if (!best) return w;
            return Math.abs(w.row - entry.row) < Math.abs(best.row - entry.row) ? w : best;
        }, null);
    }

    /* ---------- syncing ---------- */

    /*
     * Push the queue into the workbook in Dropbox. Returns a summary rather
     * than throwing for the ordinary failures, since this runs in the
     * background as often as it runs from a button.
     */
    /*
     * Never hand Dropbox a file that cannot be read back.
     *
     * The writer is surgical — it rebuilds the cells you filled in and copies
     * every other part of the zip across untouched — but "surgical" is a claim,
     * and what it is a claim about is the only copy of a year's training. So
     * the bytes about to be uploaded are opened again and re-read here, and
     * anything short of a workbook that still parses stops the upload with the
     * queue intact. A sync that does not happen costs a tap; a workbook
     * uploaded broken costs the plan.
     */
    async function verifyBeforeUpload(bytes, mapping, sessionsBefore) {
        let check;
        try {
            check = await openBytes(bytes);
        } catch (err) {
            throw new Error('The app built a workbook it could not read back, so nothing was uploaded '
                + 'and your logging is still waiting. (' + (err.message || 'unreadable') + ')');
        }

        if (!check.sheets.length) {
            throw new Error('The app built a workbook with no sheets in it, so nothing was uploaded '
                + 'and your logging is still waiting.');
        }

        if (!mapping || !AmsMapping.isComplete(mapping)) return;

        let after;
        try {
            after = await AmsPlan.build(check, mapping);
        } catch (err) {
            throw new Error('The plan could not be read back out of the workbook the app just built, '
                + 'so nothing was uploaded and your logging is still waiting.');
        }

        // Sessions may appear (a row logged into a blank one) but they must
        // never vanish: that would mean the write had eaten part of the plan.
        if (typeof sessionsBefore === 'number' && after.length < sessionsBefore) {
            throw new Error('The workbook the app built has ' + after.length + ' sessions where the one it '
                + 'read had ' + sessionsBefore + '. Nothing was uploaded and your logging is still waiting.');
        }
    }

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
            mapping = await mappingForWorkbook(workbook, mapping);

            const plan = await AmsPlan.build(workbook, mapping);

            const written = [];
            const failed = [];

            /*
             * Each entry is applied inside its own guard. One that cannot be
             * written — a row that moved out from under it, a value the writer
             * chokes on — used to abort the whole sync, which meant it also
             * blocked every entry behind it, for ever, with no way through but
             * discarding it blind. Now it is recorded on the entry, shown in
             * Settings → Syncing, and the rest of the queue goes up.
             */
            for (const entry of queued) {
                try {
                    if (entry.extra) {
                        const ok = await applyExtra(workbook, entry);
                        if (ok) written.push(entry);
                        else throw new Error('This entry had nothing that could be written to the Extras sheet.');
                        continue;
                    }

                    const workout = findWorkoutFor(entry, plan);
                    if (!workout) {
                        throw new Error('The session this was logged against '
                            + (entry.title ? '("' + String(entry.title).slice(0, 40) + '") ' : '')
                            + 'is no longer in the workbook, or has been changed into a different one. '
                            + 'Nothing was written; log it again against the row you want.');
                    }

                    const edits = AmsPlan.buildEdits(workout, entry.values, mapping);
                    if (!edits.length) {
                        // Nothing mappable to write — drop it rather than retry
                        // for ever. Nothing is lost: there was nothing in it.
                        await AmsDb.unqueue(entry.id);
                        continue;
                    }

                    await workbook.writeCells(workout.sheet, edits);
                    written.push(entry);
                } catch (err) {
                    entry.attempts = (entry.attempts || 0) + 1;
                    entry.lastError = err.message || String(err);
                    try { await AmsDb.updateQueued(entry); } catch (ignored) { /* nothing more to do */ }
                    failed.push(entry);
                }
            }

            if (!written.length) {
                emit('sync', { phase: 'done', written: 0, failed: failed.length });
                return { written: 0, failed: failed.length };
            }

            const blob = await workbook.save();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await verifyBeforeUpload(bytes, mapping, plan.length);

            const receipt = await AmsDropbox.upload(path, blob, file.rev);

            // Only once Dropbox has it does the queue let go.
            for (const entry of written) {
                try { await AmsDb.unqueue(entry.id); } catch (ignored) { /* it will be replayed, harmlessly */ }
            }

            // Keep the copy on the phone in step with what was just uploaded,
            // so a later offline launch reads the current plan.
            await AmsDb.saveWorkbook(bytes, {
                rev: (receipt && receipt.rev) || file.rev,
                name: (receipt && receipt.name) || file.name,
                path: (receipt && receipt.path_lower) || path,
                modified: (receipt && receipt.server_modified) || file.modified,
                size: bytes.length
            });

            state.lastError = null;

            // Re-read so the app is looking at exactly what Dropbox now holds.
            // A failure here is a failure to refresh, not a failure to write:
            // the sessions are in the file. Saying "sync failed" at this point
            // would send someone to fix something that is already done.
            try {
                await load();
            } catch (err) {
                console.warn('Wrote to Dropbox but could not re-read the workbook:', err);
            }

            emit('sync', { phase: 'done', written: written.length, failed: failed.length });
            return { written: written.length, failed: failed.length };

        } catch (err) {
            if (err.isConflict && !opts.noRetry) {
                // Someone saved the file while we were working. Start again on
                // the newer version — the queue is still intact.
                state.syncing = false;
                emit('sync', { phase: 'conflict' });
                return sync({ noRetry: true });
            }

            state.lastError = err.message;
            emit('sync', { phase: 'failed', error: err });
            emit('error', { error: err, phase: 'sync' });
            return { error: err.message };

        } finally {
            // Whatever happened, the app is not syncing any more. Leaving this
            // set on an unexpected throw left the button spinning for ever and
            // refused every later sync as "already syncing".
            state.syncing = false;
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
            if (entry.extra) {
                if (await applyExtra(workbook, entry)) count++;
                continue;
            }
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

    /* Has this session been dealt with — logged or marked missed, in the sheet
       or in the queue? A move is not a record of anything. */
    /*
     * Marked missed, whether that is still queued or already in the sheet. It
     * is a recorded fact about the session and not a performance of it, which
     * is a distinction the week's figures have to keep: a session you did not
     * do cannot count among the ones you did.
     */
    function isMissed(workout) {
        if (workout.pending) {
            const values = workout.pending.values || {};
            return !values.moveTo && !!values.missed;
        }
        const done = workout.results && workout.results.done;
        // The same fallback the writer uses, so a workbook whose own formulas
        // never revealed a missed marker still reads back what it was given.
        const marker = (state.mapping || {}).missedValue || 'Missed';
        return !!(done && AmsMapping.normalise(done.text) === AmsMapping.normalise(marker));
    }

    function isRecorded(workout) {
        if (workout.pending) {
            const values = workout.pending.values || {};
            return !values.moveTo;
        }
        return !!workout.logged;
    }

    /*
     * Sessions in the past that were never recorded. These fall through both
     * Upcoming and Done by definition, and left alone they quietly rot: the
     * compliance figures the plan exists to produce drift away from the truth
     * one forgotten Tuesday at a time.
     */
    function outstanding() {
        const today = todayKey();
        return state.plan.filter((w) =>
            w.dayKey < today && w.discipline.id !== 'rest' && !isRecorded(w));
    }

    /* Monday of the week containing a day, in the UTC terms dates are held in. */
    function weekStart(dayKey) {
        const date = AmsPlan.parseDayKey(dayKey);
        if (!date) return null;
        const weekday = (date.getUTCDay() + 6) % 7;   // Monday = 0
        date.setUTCDate(date.getUTCDate() - weekday);
        return AmsXlsx.dayKey(date);
    }

    function addDays(dayKey, days) {
        const date = AmsPlan.parseDayKey(dayKey);
        if (!date) return dayKey;
        date.setUTCDate(date.getUTCDate() + days);
        return AmsXlsx.dayKey(date);
    }

    /*
     * How the current week stands: planned against recorded, in minutes and in
     * sessions. Computed from the plan already in memory, so it costs nothing
     * and needs no formula in the sheet.
     */
    function weekSummary(dayKey) {
        const mapping = state.mapping || {};
        const from = weekStart(dayKey || todayKey());
        if (!from) return null;
        const to = addDays(from, 6);

        const week = state.plan.filter((w) => w.dayKey >= from && w.dayKey <= to
            && w.discipline.id !== 'rest');
        if (!week.length) return null;

        const unit = (mapping.units && mapping.units.duration) || 'hours';
        let plannedSeconds = 0;
        let actualSeconds = 0;
        let performed = 0;
        let missed = 0;

        for (const workout of week) {
            const planned = AmsPlan.plannedDurationSeconds(workout, mapping);
            if (planned) plannedSeconds += planned;

            if (!isRecorded(workout)) continue;

            // Counted, but on the other side of the ledger.
            if (isMissed(workout)) { missed++; continue; }
            performed++;

            // A queued entry holds what was typed; a synced one holds the cell.
            if (workout.pending && workout.pending.values && !workout.pending.values.missed) {
                const typed = AmsPlan.parseDuration(workout.pending.values.actualDuration);
                if (typed) actualSeconds += typed;
            } else {
                const cell = workout.results && workout.results.actualDuration;
                if (cell && typeof cell.number === 'number') {
                    actualSeconds += AmsPlan.durationFromCell(cell.number, unit) || 0;
                }
            }
        }

        /*
         * Time performed outside the plan: an unplanned run, a hike, twenty
         * minutes on the mat. Counted, because you did it and the card claims
         * to say what you did — but kept in its own figure rather than added
         * to the actual hours. Compliance is actual training over planned
         * training; folding these in would make the one number the plan exists
         * to produce mean something else.
         */
        const inWeek = (key) => key && key >= from && key <= to;
        let extraSeconds = 0;
        let extraCount = 0;
        const everyExtra = (state.pendingExtras || []).map((e) => ({ key: e.date || e.dayKey, minutes: e.minutes }))
            .concat((state.extras || []).map((e) => ({ key: e.dayKey || e.date, minutes: e.minutes })));
        for (const extra of everyExtra) {
            if (!inWeek(extra.key)) continue;
            extraCount++;
            if (typeof extra.minutes === 'number') extraSeconds += extra.minutes * 60;
        }

        return {
            from: from,
            to: to,
            sessions: week.length,
            performed: performed,
            missed: missed,
            plannedSeconds: plannedSeconds,
            actualSeconds: actualSeconds,
            extraSeconds: extraSeconds,
            extraCount: extraCount
        };
    }

    /*
     * The week as seven days, whatever is or is not in them. Returned in full
     * — including empty days and rest days — because the shape of a week is
     * partly made of its gaps: Friday being clear is information.
     */
    function weekDays(dayKey) {
        const from = weekStart(dayKey || todayKey());
        if (!from) return [];
        const today = todayKey();
        const mapping = state.mapping || {};
        const days = [];

        for (let i = 0; i < 7; i++) {
            const key = addDays(from, i);
            const sessions = state.plan.filter((w) => w.dayKey === key);
            let plannedSeconds = 0;

            for (const workout of sessions) {
                if (workout.discipline.id === 'rest') continue;
                plannedSeconds += AmsPlan.plannedDurationSeconds(workout, mapping) || 0;
            }

            days.push({
                dayKey: key,
                date: AmsPlan.parseDayKey(key),
                isToday: key === today,
                isPast: key < today,
                sessions: sessions,
                training: sessions.filter((w) => w.discipline.id !== 'rest'),
                isRest: sessions.length > 0 && sessions.every((w) => w.discipline.id === 'rest'),
                plannedSeconds: plannedSeconds
            });
        }
        return days;
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
        logExtra,
        markMissed,
        rescheduleWorkout,
        swapWorkouts,
        overlayQueue,
        sync,
        persistWorkbookEdits,
        exportWorkbook,
        todayKey,
        forDay,
        today,
        upcoming,
        recent,
        byKey,
        isRecorded,
        isMissed,
        outstanding,
        weekSummary,
        weekDays,
        weekStart,
        addWatchEntry,
        clearWatchEntries,
        watchForToday
    };
})();
