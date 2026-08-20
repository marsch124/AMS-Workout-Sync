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

    const DEFAULT_FILE = 'ams-health-inbox.json';

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

    function parse(text) {
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (err) {
            throw new Error('The file from your watch is not readable JSON.');
        }

        const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.workouts) ? raw.workouts : [raw]);

        return rows.map((row, index) => {
            if (!row || typeof row !== 'object') return null;

            const sport = pick(row, ['sport', 'type', 'workoutType', 'activity', 'activityType']);
            const minutes = number(pick(row, ['minutes', 'durationMin', 'durationMinutes', 'duration']));
            const km = number(pick(row, ['km', 'distanceKm', 'distance']));
            const dayKey = dayKeyOf(pick(row, ['date', 'start', 'startDate', 'day']));
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
        pathFor: pathFor,
        parse: parse,
        matchTo: matchTo,
        valuesFor: valuesFor,
        extraFor: extraFor,
        describe: describe,
        disciplineFor: disciplineFor
    };
})();
