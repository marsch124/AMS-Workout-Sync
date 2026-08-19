/*
 * Things you did that the plan did not ask for.
 *
 * These go on their own sheet, never into the training plan, for two reasons.
 * The plan's sheet is totalled both by fixed row ranges and by whole columns at
 * once, so a row added to it would be counted by one and missed by the other.
 * And more importantly, compliance means actual training divided by planned
 * training: twenty minutes of meditation is not twenty minutes of training, and
 * folding it in would make the one number the plan exists to produce dishonest.
 *
 * So extras are recorded alongside, with a column saying whether each one
 * counts as training load, and the plan's own arithmetic is left alone.
 */
const AmsExtras = (function () {
    'use strict';

    const SHEET_NAME = 'Extras';

    const COLUMNS = [
        'Date', 'Day', 'Activity', 'What it was', 'Duration (min)', 'Distance (km)',
        'Avg HR', 'Effort', 'Counts as training', 'Notes'
    ];

    const COL = {
        date: 1, weekday: 2, activity: 3, what: 4, duration: 5,
        distance: 6, avgHr: 7, effort: 8, isTraining: 9, notes: 10
    };

    /*
     * `kind` decides two things: whether the metric fields are worth showing,
     * and what "Counts as training" starts at. Both remain yours to override —
     * a four-hour hike is load whatever this list says.
     */
    const ACTIVITIES = [
        { id: 'run', label: 'Run', kind: 'training', icon: 'run', color: 'var(--sport-run)' },
        { id: 'bike', label: 'Bike', kind: 'training', icon: 'bike', color: 'var(--sport-bike)' },
        { id: 'swim', label: 'Swim', kind: 'training', icon: 'swim', color: 'var(--sport-swim)' },
        { id: 'strength', label: 'Strength', kind: 'training', icon: 'strength', color: 'var(--sport-strength)' },
        { id: 'mobility', label: 'Mobility', kind: 'restorative', icon: 'mobility', color: 'var(--sport-mobility)' },
        { id: 'stretching', label: 'Stretching', kind: 'restorative', icon: 'stretch', color: 'var(--sport-stretch)' },
        { id: 'yoga', label: 'Yoga', kind: 'restorative', icon: 'mobility', color: 'var(--sport-mobility)' },
        { id: 'meditation', label: 'Meditation', kind: 'restorative', icon: 'check', color: 'var(--sport-other)' },
        { id: 'breathing', label: 'Breathing', kind: 'restorative', icon: 'check', color: 'var(--sport-other)' },
        { id: 'walk', label: 'Walk', kind: 'everyday', icon: 'run', color: 'var(--sport-rest)' },
        { id: 'hike', label: 'Hike', kind: 'everyday', icon: 'run', color: 'var(--sport-rest)' },
        { id: 'ski', label: 'Ski', kind: 'everyday', icon: 'run', color: 'var(--sport-rest)' },
        { id: 'other', label: 'Something else', kind: 'everyday', icon: 'other', color: 'var(--sport-other)' }
    ];

    const ACTIVITY_BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

    function activity(id) {
        return ACTIVITY_BY_ID.get(id) || ACTIVITY_BY_ID.get('other');
    }

    /* Metrics are worth asking for when something was covered or worked at. */
    function wantsMetrics(activityId) {
        return activity(activityId).kind !== 'restorative';
    }

    async function ensureSheet(workbook) {
        const existing = workbook.findSheet(SHEET_NAME);
        if (existing) return existing;
        return workbook.createSheet(SHEET_NAME, COLUMNS);
    }

    /* First row with nothing in it. */
    function nextRow(sheet) {
        let row = 2;
        while (row <= sheet.maxRow) {
            const cells = sheet.rows.get(row);
            const used = cells && Array.from(cells.values()).some((c) => String(c.text || '').trim() !== '');
            if (!used) return row;
            row++;
        }
        return Math.max(row, 2);
    }

    /*
     * Has this already been written? Extras append rather than overwrite, so a
     * queue replayed twice would otherwise duplicate them. Matching on the day,
     * the activity and the duration is enough to recognise one.
     */
    function alreadyRecorded(sheet, entry) {
        for (let row = 2; row <= sheet.maxRow; row++) {
            if (sheet.textAt(row, COL.date) !== entry.date) continue;
            if (AmsMapping.normalise(sheet.textAt(row, COL.activity))
                !== AmsMapping.normalise(activity(entry.activity).label)) continue;
            const minutes = sheet.cell(row, COL.duration);
            const theirs = minutes && typeof minutes.number === 'number' ? minutes.number : null;
            if (theirs === (entry.minutes === undefined ? null : entry.minutes)) return true;
        }
        return false;
    }

    /* The cells for one extra, on the first free row. */
    function buildEdits(sheet, entry, weekdayNames) {
        const row = nextRow(sheet);
        const edits = [];

        const push = (col, kind, value) => {
            if (value === null || value === undefined || value === '') return;
            edits.push({ ref: AmsXlsx.makeRef(col, row), kind: kind, value: value });
        };

        const date = AmsPlan.parseDayKey(entry.date);
        push(COL.date, 'text', entry.date);
        if (date) {
            const names = weekdayNames || {};
            const name = names[date.getUTCDay()]
                || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
            push(COL.weekday, 'text', name);
        }
        push(COL.activity, 'text', activity(entry.activity).label);
        push(COL.what, 'text', entry.what);
        push(COL.duration, 'number', entry.minutes);
        push(COL.distance, 'number', entry.distance);
        push(COL.avgHr, 'number', entry.avgHr);
        push(COL.effort, 'number', entry.effort);
        push(COL.isTraining, 'text', entry.isTraining ? 'Yes' : 'No');
        push(COL.notes, 'text', entry.notes);

        return { row: row, edits: edits };
    }

    /* Everything recorded so far, newest first, for the history list. */
    async function read(workbook) {
        const meta = workbook.findSheet(SHEET_NAME);
        if (!meta) return [];

        let sheet;
        try {
            sheet = await workbook.readSheet(SHEET_NAME);
        } catch (err) {
            return [];
        }

        const out = [];
        for (let row = 2; row <= sheet.maxRow; row++) {
            const date = sheet.textAt(row, COL.date);
            const label = sheet.textAt(row, COL.activity);
            if (!date && !label) continue;

            const minutes = sheet.cell(row, COL.duration);
            const match = ACTIVITIES.find((a) => AmsMapping.normalise(a.label) === AmsMapping.normalise(label));

            out.push({
                row: row,
                date: date,
                dayKey: date,
                activity: match ? match.id : 'other',
                label: label || 'Something else',
                what: sheet.textAt(row, COL.what),
                minutes: minutes && typeof minutes.number === 'number' ? minutes.number : null,
                distance: sheet.textAt(row, COL.distance),
                avgHr: sheet.textAt(row, COL.avgHr),
                effort: sheet.textAt(row, COL.effort),
                isTraining: /^y|^j|^1|^true/i.test(sheet.textAt(row, COL.isTraining)),
                notes: sheet.textAt(row, COL.notes)
            });
        }

        out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.row - a.row));
        return out;
    }

    return {
        SHEET_NAME: SHEET_NAME,
        COLUMNS: COLUMNS,
        COL: COL,
        ACTIVITIES: ACTIVITIES,
        activity: activity,
        wantsMetrics: wantsMetrics,
        ensureSheet: ensureSheet,
        nextRow: nextRow,
        alreadyRecorded: alreadyRecorded,
        buildEdits: buildEdits,
        read: read
    };
})();
