/*
 * What the watch says, on its way to the log form.
 *
 * Garmin has no API a personal app can use: the Connect programme wants a
 * company and a partner agreement, and it pushes to a server this app does not
 * have. But the watch already puts every session into Apple Health on the
 * phone, and Shortcuts can read Health and write a file to Dropbox. So the
 * bridge is a file: a Shortcut writes today's workouts next to the workbook,
 * and this reads them.
 *
 * Nothing here writes anywhere. The numbers are offered, the form is filled
 * in, and it is still a person who decides that is what happened.
 *
 * The shape it expects is deliberately loose, because it is written by hand in
 * Shortcuts and a strict schema would be a trap:
 *
 *   [
 *     { "date": "2026-08-20", "sport": "Running", "minutes": 42.3,
 *       "km": 8.12, "avgHr": 138, "calories": 520, "name": "Morning Run" }
 *   ]
 */
const AmsInbox = (function () {
    'use strict';

    /* Plain text now that a line of words and numbers is enough. The older
       name is still looked for, so a file already made does not stop working. */
    const DEFAULT_FILE = 'ams-health-inbox.txt';
    const ALSO_TRIED = ['ams-health-inbox.json'];

    /* Beside the workbook, wherever that is. */
    function pathFor(workbookPath, fileName) {
        const name = fileName || DEFAULT_FILE;
        const path = String(workbookPath || '');
        const cut = path.lastIndexOf('/');
        return (cut > 0 ? path.slice(0, cut) : '') + '/' + name;
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = parseFloat(String(value).replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    /* Any of several names for the same thing: Shortcuts encourages improvising. */
    function pick(row, names) {
        for (const name of names) {
            if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
        }
        return null;
    }

    function dayKeyOf(value) {
        const text = String(value || '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
        const at = Date.parse(text);
        if (isNaN(at)) return '';
        // Local, not UTC: a workout at 22:00 belongs to the day it felt like.
        const d = new Date(at);
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    /*
     * Apple Health's names for what you were doing, mapped onto the plan's own
     * disciplines. Most fall out of the classifier the workbook already uses —
     * "Cycling" is a bike, "Traditional Strength Training" has "strength" in it
     * — and the rest are named here.
     */
    const HEALTH_ALIASES = {
        'elliptical': 'other',
        'rowing': 'other',
        'indoor rowing': 'other',
        'walking': 'other',
        'hiking': 'other',
        'cooldown': 'mobility',
        'preparation and recovery': 'mobility',
        'core training': 'strength',
        'high intensity interval training': 'other',
        'cross training': 'other',
        'mixed cardio': 'other'
    };

    function disciplineFor(sport) {
        const text = String(sport || '').trim();
        if (!text) return AmsPlan.OTHER_DISCIPLINE;

        const alias = HEALTH_ALIASES[AmsMapping.normalise(text)];
        if (alias) {
            return AmsPlan.DISCIPLINE_BY_ID.get(alias) || AmsPlan.OTHER_DISCIPLINE;
        }
        return AmsPlan.classifyDiscipline(text) || AmsPlan.OTHER_DISCIPLINE;
    }

    /*
     * One workout per line, in whatever order the pieces arrive and separated
     * by whatever came to hand:
     *
     *     Running, 42.3 min, 8.12 km, 138 bpm
     *     Cycling | 1:45:00 | 52.4 km | 131 bpm | 780 kcal
     *     Open Water Swim 32 min 1.5 km
     *
     * This exists because writing JSON by hand in Shortcuts is genuinely
     * unpleasant — quotation marks around some values but not others, commas
     * between entries, square brackets round the lot, and a phone that turns
     * " into " so that none of it parses. A line of words and numbers asks
     * none of that.
     *
     * So the line is read the way a person reads it: find the measurements
     * wherever they are, and whatever is left over is what you were doing.
     * Commas are welcome and so are spaces; neither is required.
     */
    const MEASUREMENT = new RegExp(
        '(\\d{1,2}):([0-5]\\d)(?::([0-5]\\d))?'                       /* 1:45:00 or 42:18 */
        + '|(\\d+(?:[.,]\\d+)?)\\s*'
        + '(kilometres?|kilometers?|km|metres?|meters?|minutes?|mins?|min'
        + '|hours?|hrs?|bpm|kcal|calories|cal|kj|h|m)?',
        'gi');

    function readMeasurements(line) {
        const found = [];
        let match;

        MEASUREMENT.lastIndex = 0;
        while ((match = MEASUREMENT.exec(line)) !== null) {
            if (!match[0].trim()) { MEASUREMENT.lastIndex++; continue; }

            if (match[1] !== undefined) {
                /*
                 * Three parts are unambiguous. Two are not: "1:45" is an hour
                 * and three quarters, "42:18" is forty-two minutes. Sessions
                 * shorter than a quarter of an hour are rare and sessions of
                 * one to twelve hours are ordinary, so the first number
                 * decides. Either way the figure lands in a form to be looked
                 * at before it is saved.
                 */
                const parts = match[3] !== undefined;
                const asHours = !parts && (+match[1]) <= 12;
                found.push({
                    kind: 'minutes',
                    value: parts
                        ? (+match[1]) * 60 + (+match[2]) + (+match[3]) / 60
                        : asHours
                            ? (+match[1]) * 60 + (+match[2])
                            : (+match[1]) + (+match[2]) / 60,
                    at: match.index,
                    length: match[0].length
                });
                continue;
            }

            const value = number(match[4]);
            if (value === null) { MEASUREMENT.lastIndex++; continue; }
            const unit = (match[5] || '').toLowerCase();

            let kind = '';
            if (/^(km|kilomet)/.test(unit)) kind = 'km';
            else if (/^met/.test(unit) || unit === 'm') kind = 'metres';
            else if (/^min/.test(unit)) kind = 'minutes';
            else if (/^(hr|hour)/.test(unit) || unit === 'h') kind = 'hours';
            else if (unit === 'bpm') kind = 'bpm';
            else if (/^(kcal|cal|kj)/.test(unit)) kind = 'calories';

            found.push({ kind: kind, value: value, at: match.index, length: match[0].length });
        }
        return found;
    }

    function parseLines(text, fallbackDay) {
        const out = [];

        String(text).split(/\r?\n/).forEach((rawLine, index) => {
            let line = rawLine.trim();
            if (!line || line.charAt(0) === '#') return;

            const entry = {
                id: 'line-' + index,
                dayKey: '',
                sport: '',
                minutes: null,
                km: null,
                avgHr: null,
                calories: null,
                name: ''
            };

            // A date first, so its digits are not read as measurements.
            const dated = /\d{4}-\d{2}-\d{2}/.exec(line);
            if (dated) {
                entry.dayKey = dayKeyOf(dated[0]);
                line = line.slice(0, dated.index) + ' , ' + line.slice(dated.index + dated[0].length);
            }

            const measurements = readMeasurements(line);

            // Assign what is labelled; hold back the bare numbers.
            const bare = [];
            measurements.forEach((m) => {
                if (m.kind === 'km' && entry.km === null) entry.km = m.value;
                else if (m.kind === 'metres' && entry.km === null) entry.km = m.value / 1000;
                else if (m.kind === 'minutes' && entry.minutes === null) entry.minutes = m.value;
                else if (m.kind === 'hours' && entry.minutes === null) entry.minutes = m.value * 60;
                else if (m.kind === 'bpm' && entry.avgHr === null) entry.avgHr = m.value;
                else if (m.kind === 'calories' && entry.calories === null) entry.calories = m.value;
                else if (!m.kind) bare.push(m.value);
            });

            // Unlabelled numbers, in the order anybody would say them.
            bare.forEach((value) => {
                if (entry.minutes === null) entry.minutes = value;
                else if (entry.km === null && value < 500) entry.km = value;
                else if (entry.avgHr === null && value >= 30 && value <= 250) entry.avgHr = value;
            });

            // What is left when the numbers are taken out is what you did.
            let words = line;
            measurements.slice().reverse().forEach((m) => {
                words = words.slice(0, m.at) + ' , ' + words.slice(m.at + m.length);
            });

            const remaining = words.split(/[|,;\t]+/)
                .map((part) => part.replace(/\s+/g, ' ').trim())
                .filter((part) => part && /[A-Za-z\u00C0-\u024F]/.test(part));

            if (remaining.length) {
                entry.sport = remaining[0];
                entry.name = remaining.slice(1).join(', ');
            }

            if (!entry.sport && entry.minutes === null) return;

            entry.dayKey = entry.dayKey || fallbackDay;
            if (!entry.dayKey) return;

            entry.discipline = disciplineFor(entry.sport);
            out.push(entry);
        });

        return out;
    }

    /*
     * `fallbackDay` is the day the file itself was written, which is the right
     * answer when a line does not say: a Shortcut run after a session writes
     * that session's day. It saves the hardest part of the Shortcut — getting
     * a date formatted — for no loss of meaning.
     */
    function parse(text, fallbackDay) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return [];

        // Plain lines unless it is plainly JSON.
        if (trimmed.charAt(0) !== '[' && trimmed.charAt(0) !== '{') {
            return parseLines(trimmed, fallbackDay);
        }

        let raw;
        try {
            raw = JSON.parse(trimmed);
        } catch (err) {
            // It began like JSON and is not: say so, rather than reading the
            // braces as a sport called "{".
            throw new Error('That file starts like JSON but is not valid JSON. '
                + 'A missing comma, or a curly quotation mark, is the usual cause.');
        }

        const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.workouts) ? raw.workouts : [raw]);

        return rows.map((row, index) => {
            if (!row || typeof row !== 'object') return null;

            const sport = pick(row, ['sport', 'type', 'workoutType', 'activity', 'activityType']);
            const minutes = number(pick(row, ['minutes', 'durationMin', 'durationMinutes', 'duration']));
            const km = number(pick(row, ['km', 'distanceKm', 'distance']));
            const dayKey = dayKeyOf(pick(row, ['date', 'start', 'startDate', 'day'])) || fallbackDay || '';
            if (!dayKey) return null;

            return {
                id: String(pick(row, ['id', 'uuid']) || (dayKey + '-' + index)),
                dayKey: dayKey,
                sport: String(sport || '').trim(),
                discipline: disciplineFor(sport),
                minutes: minutes,
                km: km,
                avgHr: number(pick(row, ['avgHr', 'averageHeartRate', 'heartRate', 'hr'])),
                calories: number(pick(row, ['calories', 'kcal', 'energy'])),
                name: String(pick(row, ['name', 'title']) || '').trim()
            };
        }).filter(Boolean);
    }

    /*
     * Which planned session an entry belongs to. Same day, same sport, and not
     * already recorded — and where a day holds two of the same sport, the one
     * whose planned length is nearest.
     *
     * No match is not a failure: an unplanned run is a perfectly ordinary thing
     * for a watch to have recorded, and it has somewhere else to go.
     */
    function matchTo(entry, plan, mapping, isRecorded) {
        if (!entry || !plan) return null;

        const candidates = plan.filter((workout) =>
            workout.dayKey === entry.dayKey
            && workout.discipline.id === entry.discipline.id
            && workout.discipline.id !== 'rest'
            && !isRecorded(workout));

        if (!candidates.length) return null;
        if (candidates.length === 1) return candidates[0];

        const wanted = (entry.minutes || 0) * 60;
        return candidates.reduce((best, workout) => {
            if (!best) return workout;
            const a = Math.abs((AmsPlan.plannedDurationSeconds(workout, mapping) || 0) - wanted);
            const b = Math.abs((AmsPlan.plannedDurationSeconds(best, mapping) || 0) - wanted);
            return a < b ? workout : best;
        }, null);
    }

    /*
     * The entry as values the log form understands. Only what the watch
     * actually measured: a blank field leaves the cell alone, and a zero
     * invented here would be written into the workbook as fact.
     */
    function valuesFor(entry, workout) {
        const values = {};
        if (!entry) return values;

        if (entry.minutes) values.actualDuration = String(Math.round(entry.minutes * 10) / 10);

        if (entry.km) {
            // Swimmers count metres; the form is told which unit it is in.
            const unit = AmsPlan.DEFAULT_DISTANCE_UNIT[workout ? workout.discipline.id : 'other'] || 'km';
            values.actualDistance = unit === 'm'
                ? String(Math.round(entry.km * 1000))
                : String(Math.round(entry.km * 100) / 100);
            values.distanceUnit = unit;
        }

        if (entry.avgHr) values.avgHr = String(Math.round(entry.avgHr));
        if (entry.calories) values.calories = String(Math.round(entry.calories));

        return values;
    }

    /* The same entry as an unplanned session, for when nothing matches. */
    function extraFor(entry) {
        return {
            date: entry.dayKey,
            activity: entry.discipline.id === 'other' ? 'walk' : entry.discipline.id,
            what: entry.name || entry.sport || '',
            duration: entry.minutes ? String(Math.round(entry.minutes)) : '',
            distance: entry.km ? String(Math.round(entry.km * 100) / 100) : '',
            avgHr: entry.avgHr ? String(Math.round(entry.avgHr)) : '',
            effort: '',
            notes: ''
        };
    }

    /* A one-line description, for the card that offers it. */
    function describe(entry) {
        const parts = [];
        // Rounded to the minute for reading. The value handed to the form keeps
        // its seconds: the display is for a glance, the field is for the sheet.
        if (entry.minutes) parts.push(AmsPlan.formatDuration(Math.round(entry.minutes) * 60));
        if (entry.km) parts.push((Math.round(entry.km * 100) / 100) + ' km');
        if (entry.avgHr) parts.push(Math.round(entry.avgHr) + ' bpm');
        if (entry.calories) parts.push(Math.round(entry.calories) + ' kcal');
        return parts.join(' · ');
    }

    return {
        DEFAULT_FILE: DEFAULT_FILE,
        ALSO_TRIED: ALSO_TRIED,
        pathFor: pathFor,
        parse: parse,
        parseLines: parseLines,
        matchTo: matchTo,
        valuesFor: valuesFor,
        extraFor: extraFor,
        describe: describe,
        disciplineFor: disciplineFor
    };
})();
