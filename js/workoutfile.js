/*
 * A workout file, read directly.
 *
 * This exists because the route through Apple Health does not exist on every
 * phone: the Shortcuts action that reads Health offers a list of sample types,
 * and on some versions of iOS that list has no Workouts in it. An instruction
 * that depends on something not being there is not an instruction.
 *
 * So: Garmin Connect can export a session as a file, and a file can be opened.
 * No Shortcut, no Health, no account, nothing to build — export, then open.
 *
 * TCX and GPX are both XML and are read here. FIT is Garmin's own binary
 * format and is not, yet; TCX carries everything this app asks for.
 */
const AmsWorkoutFile = (function () {
    'use strict';

    /* What Garmin writes in a TCX Sport attribute, and in GPX type tags. */
    const SPORTS = {
        running: 'Run',
        run: 'Run',
        biking: 'Bike',
        cycling: 'Bike',
        ride: 'Bike',
        swimming: 'Swim',
        swim: 'Swim',
        walking: 'Walk',
        hiking: 'Hike',
        strength: 'Strength',
        strength_training: 'Strength',
        multisport: 'Brick',
        other: ''
    };

    function sportName(raw) {
        const key = String(raw || '').toLowerCase().replace(/\s+/g, '_');
        if (Object.prototype.hasOwnProperty.call(SPORTS, key)) return SPORTS[key] || String(raw || '');
        return String(raw || '');
    }

    function text(node, tag) {
        if (!node) return '';
        const found = node.getElementsByTagName(tag);
        return found.length ? String(found[0].textContent || '').trim() : '';
    }

    function num(value) {
        const n = parseFloat(String(value).replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    function dayKeyOf(iso) {
        const at = Date.parse(iso);
        if (isNaN(at)) return '';
        const d = new Date(at);
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    /*
     * TCX: an activity of laps. Garmin writes one lap for a plain session and
     * several for an interval workout, so everything is summed rather than
     * read off the first one — and the heart rate is averaged by time, since
     * an average of averages over unequal laps is not an average of anything.
     */
    function fromTcx(doc) {
        const activities = doc.getElementsByTagName('Activity');
        if (!activities.length) return null;

        const activity = activities[0];
        const laps = activity.getElementsByTagName('Lap');

        let seconds = 0;
        let metres = 0;
        let calories = 0;
        let hrWeighted = 0;
        let hrSeconds = 0;
        let maxHr = null;

        for (let i = 0; i < laps.length; i++) {
            const lap = laps[i];
            const lapSeconds = num(text(lap, 'TotalTimeSeconds')) || 0;
            seconds += lapSeconds;
            metres += num(text(lap, 'DistanceMeters')) || 0;
            calories += num(text(lap, 'Calories')) || 0;

            const avg = lap.getElementsByTagName('AverageHeartRateBpm');
            const avgValue = avg.length ? num(text(avg[0], 'Value')) : null;
            if (avgValue && lapSeconds) {
                hrWeighted += avgValue * lapSeconds;
                hrSeconds += lapSeconds;
            }

            const max = lap.getElementsByTagName('MaximumHeartRateBpm');
            const maxValue = max.length ? num(text(max[0], 'Value')) : null;
            if (maxValue && (maxHr === null || maxValue > maxHr)) maxHr = maxValue;
        }

        const started = text(activity, 'Id')
            || (laps.length ? laps[0].getAttribute('StartTime') : '');

        return {
            sport: sportName(activity.getAttribute('Sport')),
            dayKey: dayKeyOf(started),
            minutes: seconds ? seconds / 60 : null,
            km: metres ? metres / 1000 : null,
            avgHr: hrSeconds ? Math.round(hrWeighted / hrSeconds) : null,
            maxHr: maxHr,
            calories: calories || null,
            name: text(activity, 'Notes')
        };
    }

    /* Metres between two points on the earth, near enough for a run. */
    function metresBetween(a, b) {
        const R = 6371000;
        const toRad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * toRad;
        const dLon = (b.lon - a.lon) * toRad;
        const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad)
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    /*
     * GPX: a line of points with times. Nothing is stated outright, so
     * everything is worked out — the duration from the first and last point,
     * the distance by walking the line, the heart rate from the extension
     * Garmin writes into each point where a strap was worn.
     */
    function fromGpx(doc) {
        const points = doc.getElementsByTagName('trkpt');
        if (!points.length) return null;

        let metres = 0;
        let previous = null;
        let firstTime = '';
        let lastTime = '';
        let hrTotal = 0;
        let hrCount = 0;

        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const lat = num(point.getAttribute('lat'));
            const lon = num(point.getAttribute('lon'));
            const when = text(point, 'time');

            if (when) {
                if (!firstTime) firstTime = when;
                lastTime = when;
            }

            if (lat !== null && lon !== null) {
                const here = { lat: lat, lon: lon };
                if (previous) metres += metresBetween(previous, here);
                previous = here;
            }

            // <gpxtpx:hr>138</gpxtpx:hr>, namespaced in ways best not relied on.
            const hrNodes = point.getElementsByTagName('*');
            for (let j = 0; j < hrNodes.length; j++) {
                if (!/(^|:)hr$/i.test(hrNodes[j].nodeName)) continue;
                const value = num(hrNodes[j].textContent);
                if (value) { hrTotal += value; hrCount++; }
                break;
            }
        }

        const from = Date.parse(firstTime);
        const to = Date.parse(lastTime);
        const seconds = !isNaN(from) && !isNaN(to) && to > from ? (to - from) / 1000 : 0;

        const trk = doc.getElementsByTagName('trk');
        return {
            sport: sportName(trk.length ? text(trk[0], 'type') : ''),
            dayKey: dayKeyOf(firstTime),
            minutes: seconds ? seconds / 60 : null,
            km: metres ? metres / 1000 : null,
            avgHr: hrCount ? Math.round(hrTotal / hrCount) : null,
            maxHr: null,
            calories: null,
            name: trk.length ? text(trk[0], 'name') : ''
        };
    }

    /*
     * `text` is the file's contents. Returns one entry in the same shape the
     * rest of the app already understands, so it lands in the same card and
     * fills the same form.
     */
    function parse(content, fileName) {
        const raw = String(content || '').trim();
        if (!raw) throw new Error('That file is empty.');

        // Say what it actually is. A zip is not a FIT file, and being told the
        // wrong thing about your own file wastes more time than saying nothing.
        if (/\.fit$/i.test(fileName || '') || raw.slice(0, 16).indexOf('.FIT') !== -1) {
            throw new Error('That is a .fit file, which the app cannot read yet. '
                + 'Garmin Connect can export the same session as TCX, which it can.');
        }
        if (raw.slice(0, 2) === 'PK') {
            throw new Error('That is a zip file — a spreadsheet, most likely. '
                + 'A workout file from Garmin Connect ends in .tcx or .gpx.');
        }

        let doc;
        try {
            doc = new DOMParser().parseFromString(raw, 'application/xml');
        } catch (err) {
            throw new Error('That file could not be read as TCX or GPX.');
        }
        if (doc.getElementsByTagName('parsererror').length) {
            throw new Error('That file could not be read as TCX or GPX.');
        }

        const entry = doc.getElementsByTagName('TrainingCenterDatabase').length
            ? fromTcx(doc)
            : fromGpx(doc);

        if (!entry) throw new Error('No workout was found in that file.');
        if (!entry.dayKey) throw new Error('That workout has no date in it.');

        entry.id = 'file-' + (fileName || 'workout');
        entry.discipline = AmsInbox.disciplineFor(entry.sport);
        if (!entry.name) entry.name = fileName ? String(fileName).replace(/\.[a-z0-9]+$/i, '') : '';
        return entry;
    }

    return {
        parse: parse,
        fromTcx: fromTcx,
        fromGpx: fromGpx
    };
})();
