/*
 * Photographs attached to a session, or to something the plan did not ask for.
 *
 * These do not go into the workbook and cannot. Every other thing this app
 * records is a number or a word that belongs in a cell, and the file it writes
 * back is the same archive it read with 17 of 19 parts byte-identical
 * (invariant 1). Putting pictures into an .xlsx means adding drawing parts,
 * relationships and anchors to somebody's real training plan: a large amount
 * of new machinery aimed straight at the one file that matters. So a photo
 * lives on the phone, beside the plan rather than inside it.
 *
 * What follows from that is the honest part, and the app says it out loud in
 * Settings: the workbook is still the record, and a photo is not in it. Reset
 * the app and the photos go with it, which is why there is a way to save them
 * out.
 *
 * Two stores, not one. The metadata is read at boot so a count can be drawn on
 * a card without waiting, and pulling the pictures themselves into memory to
 * do that would cost hundreds of megabytes on a season's worth.
 *
 * Attribution follows the rule the move log had to learn. A session is
 * identified by sheet + row, so inserting a row in Excel slides every session
 * below it onto its neighbour's identity, and a photo of Tuesday's ride would
 * be shown against whatever now sits in that row. The sport it was taken
 * against is stored with it and has to still agree, or the photo is not shown
 * against that session at all. It is not lost: it is counted in Settings and
 * included when photos are saved out. But a picture shown against the wrong
 * session is worse than one you have to go and look for.
 *
 * An extra is identified differently, and has to be. It has no row until it
 * syncs and no queue entry afterwards, so neither survives its own life;
 * `AmsExtras.keyFor()` names it by the day, the activity and the length
 * instead, which is what the writer already uses to recognise one. See
 * `belongsTo()` for what that changes here.
 */
const AmsPhotos = (function () {
    'use strict';

    /*
     * 1600 on the long edge and JPEG at 0.72 puts a phone photograph at
     * roughly 250 KB instead of three or four megabytes, and it is still
     * sharper than the screen it will be looked at on. The point of a photo
     * here is "that was the morning the lake was flat", not a print.
     */
    const MAX_EDGE = 1600;
    const QUALITY = 0.72;

    /* Metadata only, never the pictures. Kept in memory so the rest of the app
       can ask how many a session has without going asynchronous. */
    let index = [];

    async function load() {
        index = await AmsDb.listPhotoMeta();
        return index;
    }

    function all() {
        return index.slice().sort((a, b) => a.addedAt - b.addedAt);
    }

    function totalBytes() {
        return index.reduce((sum, photo) => sum + (photo.bytes || 0), 0);
    }

    function count() {
        return index.length;
    }

    /*
     * Does this photograph belong to that thing?
     *
     * For a planned session, the key is sheet + row and the sport is the
     * guard: see the note at the top. For an extra it is the key alone,
     * because `AmsExtras.keyFor()` already carries the day, the activity and
     * the length — the same three things the writer uses to recognise an extra
     * it has already written. There is nothing left for a second check to
     * catch, and applying one anyway would hide a photograph every time the
     * activity list was edited underneath it.
     */
    function belongsTo(photo, owner) {
        if (!photo || !owner || photo.workoutKey !== owner.key) return false;
        if (AmsExtras.isKey(owner.key)) return true;
        return photo.disciplineId === owner.discipline.id;
    }

    /* Everything attached to one session or one extra. */
    function forWorkout(owner) {
        if (!owner) return [];
        return all().filter((photo) => belongsTo(photo, owner));
    }

    function countFor(owner) {
        return forWorkout(owner).length;
    }

    /*
     * Photos whose session or extra cannot be found again. They are shown
     * nowhere, and must not be quietly dropped from a count or from an export
     * either. `owners` is every session in the plan plus every extra the app
     * knows about, so an extra that has not synced yet does not read as lost.
     */
    function orphans(owners) {
        const list = owners || [];
        return all().filter((photo) => !list.some((owner) => belongsTo(photo, owner)));
    }

    function blob(id) {
        return AmsDb.getPhotoBlob(id);
    }

    /* ---------- taking one in ---------- */

    /*
     * Decoding is tried two ways because the phone is the awkward case. A
     * picture straight from the camera is a JPEG and either route reads it;
     * one chosen from the library may be HEIC, which some browsers will not
     * hand to createImageBitmap. `imageOrientation: 'from-image'` is what stops
     * a photo taken in portrait arriving on its side: a canvas draws raw pixels
     * and ignores the EXIF rotation unless it is asked not to.
     */
    async function decode(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                return await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (err) { /* fall through to the <img> route */ }
        }

        const url = URL.createObjectURL(file);
        try {
            return await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('That picture could not be opened.'));
                image.src = url;
            });
        } finally {
            // Revoked on a later turn: revoking before the bitmap has been
            // drawn has been known to blank it.
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
    }

    function sizeOf(source) {
        const width = source.width || source.naturalWidth || 0;
        const height = source.height || source.naturalHeight || 0;
        return { width: width, height: height };
    }

    /*
     * Shrunk to something a phone can hold a season of. If any step of this
     * fails, whether an image format the canvas will not take or a browser
     * with no toBlob, the original file is stored as it is rather than
     * refused. A large photo kept beats a photo lost.
     */
    async function shrink(file) {
        let source;
        try {
            source = await decode(file);
        } catch (err) {
            return { blob: file, width: 0, height: 0, resized: false };
        }

        const size = sizeOf(source);
        if (!size.width || !size.height) {
            return { blob: file, width: 0, height: 0, resized: false };
        }

        const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height));
        const outW = Math.max(1, Math.round(size.width * scale));
        const outH = Math.max(1, Math.round(size.height * scale));

        try {
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            canvas.getContext('2d').drawImage(source, 0, 0, outW, outH);

            const out = await new Promise((resolve) => {
                if (canvas.toBlob) canvas.toBlob(resolve, 'image/jpeg', QUALITY);
                else resolve(null);
            });
            if (source.close) source.close();

            // A picture that came out bigger than it went in is not an
            // improvement, which happens with small or already-squeezed ones.
            if (!out || out.size >= file.size) {
                return { blob: file, width: size.width, height: size.height, resized: false };
            }
            return { blob: out, width: outW, height: outH, resized: true };
        } catch (err) {
            return { blob: file, width: size.width, height: size.height, resized: false };
        }
    }

    function newId() {
        return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    async function add(workout, file) {
        if (!workout || !file) return null;
        const shrunk = await shrink(file);

        const meta = {
            id: newId(),
            workoutKey: workout.key,
            /* The sport is the guard on attribution. The day and the wording
               are here so a photo can still be recognised by a person looking
               at an export long after the row has moved. */
            disciplineId: workout.discipline.id,
            dayKey: workout.dayKey,
            title: workout.title || '',
            sheet: workout.sheet || '',
            /* Only set for an extra, and only so a saved file can be named
               after the walk rather than after the word "extra". */
            kind: AmsExtras.isKey(workout.key) ? 'extra' : 'session',
            addedAt: Date.now(),
            bytes: shrunk.blob.size,
            type: shrunk.blob.type || file.type || 'image/jpeg',
            width: shrunk.width,
            height: shrunk.height
        };

        await AmsDb.putPhoto(meta, shrunk.blob);
        index.push(meta);
        return meta;
    }

    async function remove(id) {
        await AmsDb.deletePhoto(id);
        index = index.filter((photo) => photo.id !== id);
    }

    async function removeAll() {
        await AmsDb.clearPhotos();
        index = [];
    }

    /* ---------- getting them out ---------- */

    /*
     * A name a person can read in a folder six months later: the date, the
     * sport, and enough of the session to recognise it.
     */
    function fileNameFor(photo, seen) {
        const safe = String(photo.title || '')
            /*
             * Folded to plain letters before anything is thrown away, or a
             * Swedish name comes out full of dashes: "Kolmården ridge" became
             * "Kolm-rden-ridge" until this was here. NFD splits an accented
             * letter into the letter and its mark, and the mark is what goes.
             */
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z0-9 +-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 40)
            .replace(/\s/g, '-');
        const sport = photo.disciplineId || 'session';
        const extension = photo.type === 'image/png' ? 'png'
            : photo.type === 'image/heic' ? 'heic' : 'jpg';

        let name = [photo.dayKey || 'undated', sport, safe]
            .filter(Boolean).join('_') + '.' + extension;

        if (seen) {
            // Two photos of one session would otherwise overwrite each other
            // inside the zip, which most unpackers do without saying so.
            const base = name.slice(0, -(extension.length + 1));
            let n = 2;
            while (seen.has(name)) name = base + '-' + (n++) + '.' + extension;
            seen.add(name);
        }
        return name;
    }

    return {
        load: load,
        all: all,
        belongsTo: belongsTo,
        forWorkout: forWorkout,
        countFor: countFor,
        orphans: orphans,
        count: count,
        totalBytes: totalBytes,
        blob: blob,
        add: add,
        remove: remove,
        removeAll: removeAll,
        fileNameFor: fileNameFor,
        MAX_EDGE: MAX_EDGE
    };
})();
