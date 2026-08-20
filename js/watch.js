/*
 * What the watch says, on its way to the log form.
 *
 * A session read out of a file exported from Garmin Connect: classified into
 * one of the plan's own disciplines, matched to the session it belongs to, and
 * turned into values the log form understands.
 *
 * Reading the file is js/workoutfile.js. This is what happens to it afterwards,
 * and it is deliberately separate: a second source of numbers — a different
 * watch, a different format — would land here unchanged.
 *
 * Nothing here writes anywhere. The numbers are offered, the form is filled in,
 * and it is still a person who decides that is what happened.
 */
const AmsWatch = (function () {
    'use strict';

    /*
     * Names a watch or a phone gives to what you were doing, mapped onto the
     * plan's own disciplines. Most fall out of the classifier the workbook
     * already uses — "Cycling" is a bike, "Strength Training" has "strength" in
     * it — and the rest are named here.
     */
    const SPORT_ALIASES = {
        elliptical: 'other',
        rowing: 'other',
        'indoor rowing': 'other',
        walking: 'other',
        walk: 'other',
        hiking: 'other',
        hike: 'other',
        cooldown: 'mobility',
        'preparation and recovery': 'mobility',
        'core training': 'strength',
        'high intensity interval training': 'other',
        'cross training': 'other',
        'mixed cardio': 'other'
    };

    function disciplineFor(sport) {
        const text = String(sport || '').trim();
        if (!text) return AmsPlan.OTHER_DISCIPLINE;

        const alias = SPORT_ALIASES[AmsMapping.normalise(text)];
        if (alias) {
            return AmsPlan.DISCIPLINE_BY_ID.get(alias) || AmsPlan.OTHER_DISCIPLINE;
        }
        return AmsPlan.classifyDiscipline(text) || AmsPlan.OTHER_DISCIPLINE;
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
        if (entry.maxHr) values.maxHr = String(Math.round(entry.maxHr));
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
        disciplineFor: disciplineFor,
        matchTo: matchTo,
        valuesFor: valuesFor,
        extraFor: extraFor,
        describe: describe
    };
})();
