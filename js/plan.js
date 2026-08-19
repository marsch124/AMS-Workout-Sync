/*
 * The training plan itself: turning mapped spreadsheet rows into workouts, and
 * turning what you type after a session back into cell values.
 *
 * The fiddly part is units. A "duration" column might hold 1.5 (hours), 90
 * (minutes), or a real Excel time value formatted 1:30:00 — and writing hours
 * into a minutes column would quietly corrupt every total in the sheet. So
 * rather than assume, the app reads what is already in the column and matches
 * it. Where it cannot tell, Sheet setup lets you say outright.
 */
const AmsPlan = (function () {
    'use strict';

    /* ---------- disciplines ---------- */

    const DISCIPLINES = [
        { id: 'swim', label: 'Swim', icon: 'swim', color: 'var(--sport-swim)',
          synonyms: ['swim', 'swimming', 'schwimmen', 'schwimmtraining', 'pool', 'open water',
                     'freiwasser', 'kraul', 'crawl', 'bahnen'] },
        { id: 'bike', label: 'Bike', icon: 'bike', color: 'var(--sport-bike)',
          synonyms: ['bike', 'biking', 'cycling', 'cycle', 'rad', 'radfahren', 'radeln', 'velo',
                     'ride', 'spinning', 'mtb', 'rennrad', 'turbo', 'rollentraining', 'indoor bike'] },
        { id: 'run', label: 'Run', icon: 'run', color: 'var(--sport-run)',
          synonyms: ['run', 'running', 'laufen', 'lauf', 'jog', 'jogging', 'joggen', 'trail',
                     'trailrun', 'dauerlauf', 'bahn'] },
        { id: 'mobility', label: 'Mobility', icon: 'mobility', color: 'var(--sport-mobility)',
          synonyms: ['mobility', 'mobilitat', 'beweglichkeit', 'yoga', 'faszien', 'foam roll',
                     'faszientraining', 'mobi'] },
        { id: 'stretching', label: 'Stretching', icon: 'stretch', color: 'var(--sport-stretch)',
          synonyms: ['stretch', 'stretching', 'dehnen', 'dehnung', 'flexibility', 'dehnprogramm'] },
        { id: 'strength', label: 'Strength', icon: 'strength', color: 'var(--sport-strength)',
          synonyms: ['strength', 'kraft', 'krafttraining', 'gym', 'weights', 'lifting', 'core',
                     'rumpf', 'stabilisation', 'stabi', 'athletik'] }
    ];

    const OTHER_DISCIPLINE = { id: 'other', label: 'Other', icon: 'other', color: 'var(--sport-other)', synonyms: [] };

    const DISCIPLINE_BY_ID = new Map(DISCIPLINES.concat([OTHER_DISCIPLINE]).map((d) => [d.id, d]));

    function classifyDiscipline(raw) {
        const text = AmsMapping.normalise(raw);
        if (!text) return OTHER_DISCIPLINE;
        let best = null;
        let bestLen = 0;
        for (const discipline of DISCIPLINES) {
            for (const synonym of discipline.synonyms) {
                const s = AmsMapping.normalise(synonym);
                if (!s) continue;
                if (text === s || text.startsWith(s) || text.indexOf(s) !== -1) {
                    if (s.length > bestLen) { bestLen = s.length; best = discipline; }
                }
            }
        }
        return best || OTHER_DISCIPLINE;
    }

    /*
     * Which numbers are worth asking for after each kind of session, in the
     * order they should appear. Only fields your sheet has a column for are
     * actually shown.
     */
    const FIELD_PREFERENCE = {
        swim:       ['actualDuration', 'actualDistance', 'avgPace', 'avgHr', 'maxHr', 'rpe', 'calories', 'notes'],
        bike:       ['actualDuration', 'actualDistance', 'avgSpeed', 'avgPower', 'avgHr', 'maxHr', 'cadence', 'elevation', 'rpe', 'calories', 'notes'],
        run:        ['actualDuration', 'actualDistance', 'avgPace', 'avgHr', 'maxHr', 'cadence', 'elevation', 'rpe', 'calories', 'notes'],
        strength:   ['actualDuration', 'rpe', 'avgHr', 'calories', 'notes'],
        mobility:   ['actualDuration', 'rpe', 'notes'],
        stretching: ['actualDuration', 'rpe', 'notes'],
        other:      ['actualDuration', 'actualDistance', 'avgHr', 'maxHr', 'rpe', 'calories', 'notes']
    };

    /* The unit a distance is entered in, per discipline — swimmers count metres. */
    const DEFAULT_DISTANCE_UNIT = { swim: 'm', bike: 'km', run: 'km', other: 'km', strength: 'km', mobility: 'km', stretching: 'km' };

    const SECTION_ORDER = ['warmup', 'intervals', 'technique', 'cooldown'];
    const SECTION_LABELS = {
        warmup: 'Warm-up',
        intervals: 'Intervals',
        cooldown: 'Cool-down',
        technique: 'Technique',
        main: 'Session'
    };

    /* Match a free-text section name from a "Section" column to one of ours. */
    function classifySection(raw) {
        const text = AmsMapping.normalise(raw);
        if (!text) return 'main';
        for (const id of ['warmup', 'intervals', 'cooldown', 'technique']) {
            const field = AmsMapping.FIELD_BY_ID.get(id);
            for (const synonym of field.synonyms) {
                const s = AmsMapping.normalise(synonym);
                if (s && (text === s || text.indexOf(s) !== -1)) return id;
            }
        }
        return 'main';
    }

    /* ---------- durations ---------- */

    /*
     * Read a duration the way a person would write one: 45, 45min, 1:15,
     * 1:15:30, 1h20, 1,5h, 90 min. Returns seconds, or null.
     */
    function parseDuration(input) {
        if (input === null || input === undefined) return null;
        if (typeof input === 'number') return isNaN(input) ? null : Math.round(input * 60);
        let text = String(input).trim().toLowerCase().replace(',', '.');
        if (!text) return null;

        const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
        if (clock) {
            const a = parseInt(clock[1], 10);
            const b = parseInt(clock[2], 10);
            const c = clock[3] ? parseInt(clock[3], 10) : null;
            // 1:15:30 is h:m:s; 1:15 on its own is minutes:seconds only if it
            // is written that way in a pace field — as a duration it is h:mm.
            return c === null ? (a * 3600 + b * 60) : (a * 3600 + b * 60 + c);
        }

        let seconds = 0;
        let matched = false;
        const unitRe = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|std|stunden|stunde|m|min|mins|minute|minuten|s|sec|secs|sek|sekunden)?/g;
        let m;
        while ((m = unitRe.exec(text))) {
            const value = parseFloat(m[1]);
            if (isNaN(value)) continue;
            const unit = m[2] || '';
            matched = true;
            if (/^(h|hr|hrs|hour|hours|std|stunde|stunden)$/.test(unit)) seconds += value * 3600;
            else if (/^(s|sec|secs|sek|sekunden)$/.test(unit)) seconds += value;
            else seconds += value * 60;   // bare numbers and m/min are minutes
        }
        return matched ? Math.round(seconds) : null;
    }

    function formatDuration(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) return '';
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        if (m) return s ? m + 'm ' + String(s).padStart(2, '0') + 's' : m + 'm';
        return s + 's';
    }

    function formatClock(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) return '';
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h
            ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
            : m + ':' + String(s).padStart(2, '0');
    }

    /*
     * Decide how a duration column stores its numbers, by looking at what is
     * already in it. A column of Excel time values is unmistakable; otherwise
     * values that cluster above 10 are minutes and below are hours.
     */
    function inferDurationUnit(workbook, sheet, col, mapping) {
        if (!col) return 'hours';
        const samples = [];
        let timeFormatted = 0;
        const last = Math.min(mapping.lastDataRow || sheet.maxRow, mapping.firstDataRow + 200);
        for (let r = mapping.firstDataRow; r <= last; r++) {
            const cell = sheet.cell(r, col);
            if (!cell) continue;
            if (cell.styleIndex >= 0 && workbook.dateStyles.has(cell.styleIndex)) timeFormatted++;
            if (typeof cell.number === 'number' && cell.number > 0) samples.push(cell.number);
        }
        if (timeFormatted >= 1 && timeFormatted >= samples.length / 2) return 'time';
        if (!samples.length) return 'hours';
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        return median >= 10 ? 'minutes' : 'hours';
    }

    function inferDistanceUnit(sheet, col, mapping, disciplineId) {
        if (!col) return DEFAULT_DISTANCE_UNIT[disciplineId] || 'km';
        const samples = [];
        const last = Math.min(mapping.lastDataRow || sheet.maxRow, mapping.firstDataRow + 200);
        for (let r = mapping.firstDataRow; r <= last; r++) {
            const cell = sheet.cell(r, col);
            if (cell && typeof cell.number === 'number' && cell.number > 0) samples.push(cell.number);
        }
        if (!samples.length) return DEFAULT_DISTANCE_UNIT[disciplineId] || 'km';
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        return median >= 400 ? 'm' : 'km';
    }

    /* Is this column formatted as a time/date? Used for pace and duration. */
    function columnIsTimeFormatted(workbook, sheet, col, mapping) {
        if (!col) return false;
        let hits = 0;
        let seen = 0;
        const last = Math.min(mapping.lastDataRow || sheet.maxRow, mapping.firstDataRow + 200);
        for (let r = mapping.firstDataRow; r <= last; r++) {
            const cell = sheet.cell(r, col);
            if (!cell || cell.styleIndex < 0) continue;
            seen++;
            if (workbook.dateStyles.has(cell.styleIndex)) hits++;
        }
        return seen > 0 && hits >= seen / 2;
    }

    /* ---------- building the plan ---------- */

    function cellText(sheet, row, col) {
        if (!col) return '';
        return sheet.textAt(row, col);
    }

    function cellNumber(sheet, row, col) {
        if (!col) return null;
        const cell = sheet.cell(row, col);
        return cell && typeof cell.number === 'number' ? cell.number : null;
    }

    function readDate(sheet, row, col) {
        if (!col) return null;
        const cell = sheet.cell(row, col);
        if (!cell) return null;
        if (cell.date) return cell.date;
        // Some plans keep the date as text.
        const text = String(cell.text || '').trim();
        if (!text) return null;
        const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
        if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
        const euro = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/.exec(text);
        if (euro) {
            const year = +euro[3] < 100 ? 2000 + +euro[3] : +euro[3];
            return new Date(Date.UTC(year, +euro[2] - 1, +euro[1]));
        }
        return null;
    }

    function sectionsFromRow(sheet, row, mapping) {
        const sections = [];
        for (const id of SECTION_ORDER) {
            const col = mapping.columns[id];
            if (!col) continue;
            const text = cellText(sheet, row, col);
            if (text) sections.push({ kind: id, label: SECTION_LABELS[id], text });
        }
        if (!sections.length) {
            const text = cellText(sheet, row, mapping.columns.description)
                || cellText(sheet, row, mapping.columns.title);
            if (text) sections.push({ kind: 'main', label: SECTION_LABELS.main, text });
        }
        return sections;
    }

    function readResults(sheet, row, mapping) {
        const results = {};
        for (const id of AmsMapping.RESULT_FIELDS) {
            const col = mapping.columns[id];
            if (!col) continue;
            const cell = sheet.cell(row, col);
            if (!cell) continue;
            const text = String(cell.text || '').trim();
            if (text) results[id] = { text, number: cell.number, date: cell.date };
        }
        return results;
    }

    function isLogged(results) {
        return ['actualDuration', 'actualDistance', 'avgHr', 'done', 'notes', 'rpe']
            .some((id) => results[id] && results[id].text);
    }

    /*
     * Read every mapped sheet into a flat list of workouts, newest handling of
     * both layouts: one row per workout, or one row per section grouped by
     * date + discipline.
     */
    async function build(workbook, mapping) {
        const workouts = [];

        for (const sheetName of mapping.sheets) {
            let sheet;
            try {
                sheet = await workbook.readSheet(sheetName);
            } catch (err) {
                continue;
            }

            const lastRow = mapping.lastDataRow
                ? Math.max(mapping.lastDataRow, mapping.firstDataRow)
                : sheet.maxRow;

            let carriedDate = null;
            let group = null;

            for (let row = mapping.firstDataRow; row <= lastRow; row++) {
                const rowDate = readDate(sheet, row, mapping.columns.date);
                if (rowDate) carriedDate = rowDate;
                const date = rowDate || carriedDate;

                const disciplineRaw = cellText(sheet, row, mapping.columns.discipline);
                const title = cellText(sheet, row, mapping.columns.title);
                const anyContent = disciplineRaw || title
                    || SECTION_ORDER.some((id) => cellText(sheet, row, mapping.columns[id]))
                    || cellText(sheet, row, mapping.columns.description);
                if (!date || !anyContent) { if (!anyContent) group = null; continue; }

                if (mapping.mode === 'section-rows') {
                    const key = AmsXlsx.dayKey(date) + '|' + AmsMapping.normalise(disciplineRaw || (group && group.disciplineRaw) || '');
                    if (!group || group.key !== key) {
                        group = {
                            key,
                            sheet: sheetName,
                            row,
                            rows: [],
                            date,
                            disciplineRaw: disciplineRaw || '',
                            title: title || '',
                            sections: [],
                            planned: {},
                            results: readResults(sheet, row, mapping)
                        };
                        workouts.push(group);
                    }
                    group.rows.push(row);
                    if (!group.disciplineRaw && disciplineRaw) group.disciplineRaw = disciplineRaw;

                    const kind = classifySection(cellText(sheet, row, mapping.sectionColumn));
                    const text = cellText(sheet, row, mapping.columns.description)
                        || cellText(sheet, row, mapping.columns.title);
                    if (text) {
                        group.sections.push({
                            kind,
                            label: cellText(sheet, row, mapping.sectionColumn) || SECTION_LABELS[kind],
                            text,
                            target: cellText(sheet, row, mapping.columns.plannedIntensity),
                            row
                        });
                    }
                    const planned = cellNumber(sheet, row, mapping.columns.plannedDuration);
                    if (planned !== null) {
                        group.planned.durationRaw = (group.planned.durationRaw || 0) + planned;
                    }
                    continue;
                }

                // One row per workout.
                workouts.push({
                    key: sheetName + '!' + row,
                    sheet: sheetName,
                    row,
                    rows: [row],
                    date,
                    disciplineRaw,
                    title,
                    sections: sectionsFromRow(sheet, row, mapping),
                    planned: {
                        durationRaw: cellNumber(sheet, row, mapping.columns.plannedDuration),
                        distanceRaw: cellNumber(sheet, row, mapping.columns.plannedDistance),
                        intensity: cellText(sheet, row, mapping.columns.plannedIntensity),
                        description: cellText(sheet, row, mapping.columns.description)
                    },
                    results: readResults(sheet, row, mapping)
                });
            }
        }

        // Finish each workout: identity, ordering, formatting.
        for (const workout of workouts) {
            workout.key = workout.key || (workout.sheet + '!' + workout.row);
            workout.discipline = classifyDiscipline(workout.disciplineRaw);
            workout.dayKey = AmsXlsx.dayKey(workout.date);
            workout.logged = isLogged(workout.results);
            workout.sections.sort((a, b) => {
                const ai = SECTION_ORDER.indexOf(a.kind);
                const bi = SECTION_ORDER.indexOf(b.kind);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            if (!workout.title) {
                workout.title = workout.discipline.label
                    + (workout.sections.length ? ' — ' + workout.sections[0].text.slice(0, 40) : '');
            }
        }

        workouts.sort((a, b) => (a.date - b.date) || a.row - b.row);
        return workouts;
    }

    /*
     * Units for this workbook, inferred once and then stored in the mapping so
     * the guess is stable (and correctable on the setup screen).
     */
    async function inferUnits(workbook, mapping) {
        const sheet = await workbook.readSheet(mapping.sheets[0]);
        const units = Object.assign({ duration: 'auto', distance: 'auto', paceIsTime: null }, mapping.units || {});

        if (units.duration === 'auto') {
            const col = mapping.columns.actualDuration || mapping.columns.plannedDuration;
            units.duration = inferDurationUnit(workbook, sheet, col, mapping);
        }
        if (units.distance === 'auto') {
            const col = mapping.columns.actualDistance || mapping.columns.plannedDistance;
            units.distance = inferDistanceUnit(sheet, col, mapping, 'other');
        }
        if (units.paceIsTime === null) {
            units.paceIsTime = columnIsTimeFormatted(workbook, sheet, mapping.columns.avgPace, mapping);
        }
        mapping.units = units;
        return units;
    }

    /* Turn a duration in seconds into the number this workbook expects. */
    function durationToCell(seconds, unit) {
        if (seconds === null) return null;
        if (unit === 'time') return seconds / 86400;
        if (unit === 'minutes') return seconds / 60;
        return seconds / 3600;
    }

    function durationFromCell(value, unit) {
        if (value === null || value === undefined || isNaN(value)) return null;
        if (unit === 'time') return value * 86400;
        if (unit === 'minutes') return value * 60;
        return value * 3600;
    }

    function distanceToCell(value, enteredUnit, sheetUnit) {
        if (value === null || isNaN(value)) return null;
        if (enteredUnit === sheetUnit) return value;
        if (enteredUnit === 'km' && sheetUnit === 'm') return value * 1000;
        if (enteredUnit === 'm' && sheetUnit === 'km') return value / 1000;
        return value;
    }

    /*
     * Build the list of cell edits for one logged session. `entry` holds raw
     * strings straight from the form; everything is converted here so that the
     * only thing the writer has to do is put values in cells.
     */
    function buildEdits(workout, entry, mapping) {
        const units = mapping.units || { duration: 'hours', distance: 'km', paceIsTime: false };
        const columns = mapping.columns;
        const row = workout.row;
        const edits = [];

        function push(fieldId, kind, value) {
            const col = columns[fieldId];
            if (!col) return;
            if (value === null || value === undefined || value === '') return;
            edits.push({ ref: AmsXlsx.makeRef(col, row), kind, value, field: fieldId });
        }

        const seconds = parseDuration(entry.actualDuration);
        if (seconds !== null) push('actualDuration', 'number', durationToCell(seconds, units.duration));

        if (entry.actualDistance !== '' && entry.actualDistance !== undefined && entry.actualDistance !== null) {
            const raw = parseFloat(String(entry.actualDistance).replace(',', '.'));
            if (!isNaN(raw)) {
                const enteredUnit = entry.distanceUnit || DEFAULT_DISTANCE_UNIT[workout.discipline.id] || 'km';
                push('actualDistance', 'number', distanceToCell(raw, enteredUnit, units.distance));
            }
        }

        for (const id of ['avgHr', 'maxHr', 'avgSpeed', 'avgPower', 'cadence', 'elevation', 'calories', 'rpe']) {
            const raw = entry[id];
            if (raw === '' || raw === undefined || raw === null) continue;
            const num = parseFloat(String(raw).replace(',', '.'));
            if (!isNaN(num)) push(id, 'number', num);
        }

        if (entry.avgPace) {
            if (units.paceIsTime) {
                const paceSeconds = parsePace(entry.avgPace);
                if (paceSeconds !== null) push('avgPace', 'number', paceSeconds / 86400);
            } else {
                push('avgPace', 'text', String(entry.avgPace).trim());
            }
        }

        if (entry.notes) push('notes', 'text', String(entry.notes).trim());
        if (columns.done) push('done', 'text', entry.doneLabel || 'Yes');
        if (columns.completedAt) push('completedAt', 'date', entry.completedAt ? new Date(entry.completedAt) : new Date());

        return edits;
    }

    /* "4:52" or "4:52 /km" -> seconds per unit. */
    function parsePace(input) {
        const m = /(\d+):([0-5]?\d)/.exec(String(input || ''));
        if (!m) {
            const num = parseFloat(String(input).replace(',', '.'));
            return isNaN(num) ? null : Math.round(num * 60);
        }
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    /* Which fields to show on the log form for this workout. */
    function formFields(workout, mapping) {
        const preference = FIELD_PREFERENCE[workout.discipline.id] || FIELD_PREFERENCE.other;
        const available = new Set(AmsMapping.writableFields(mapping).map((f) => f.id));
        return preference
            .filter((id) => available.has(id))
            .map((id) => AmsMapping.FIELD_BY_ID.get(id));
    }

    /* Planned duration rendered for display, using the workbook's own unit. */
    function plannedDurationSeconds(workout, mapping) {
        const raw = workout.planned && workout.planned.durationRaw;
        if (raw === null || raw === undefined) return null;
        const unit = (mapping.units && mapping.units.duration) || 'hours';
        return durationFromCell(raw, unit);
    }

    return {
        DISCIPLINES,
        OTHER_DISCIPLINE,
        DISCIPLINE_BY_ID,
        DEFAULT_DISTANCE_UNIT,
        SECTION_ORDER,
        SECTION_LABELS,
        FIELD_PREFERENCE,
        classifyDiscipline,
        classifySection,
        parseDuration,
        formatDuration,
        formatClock,
        parsePace,
        build,
        inferUnits,
        inferDurationUnit,
        inferDistanceUnit,
        columnIsTimeFormatted,
        durationToCell,
        durationFromCell,
        distanceToCell,
        buildEdits,
        formFields,
        plannedDurationSeconds
    };
})();
