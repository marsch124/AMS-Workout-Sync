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
    const DEFAULT_ACTIVITIES = [
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

    /*
     * The list in force. Starts as the defaults above, and is replaced by the
     * user's own once they have edited it — this is their vocabulary for their
     * own training, not a fixed taxonomy.
     */
    let activities = DEFAULT_ACTIVITIES.slice();
    let byId = new Map(activities.map((a) => [a.id, a]));

    const STORE_KEY = 'extras.activities';

    /* Colours and icons are matched from the defaults where an id is known, so
       a renamed or added activity still looks like it belongs. */
    const KIND_LOOK = {
        training:   { icon: 'other', color: 'var(--sport-other)' },
        restorative:{ icon: 'check', color: 'var(--sport-mobility)' },
        everyday:   { icon: 'run',   color: 'var(--sport-rest)' }
    };

    function decorate(entry) {
        const known = DEFAULT_ACTIVITIES.find((a) => a.id === entry.id);
        const look = KIND_LOOK[entry.kind] || KIND_LOOK.everyday;
        return {
            id: entry.id,
            label: entry.label,
            kind: entry.kind || 'everyday',
            icon: entry.icon || (known ? known.icon : look.icon),
            color: entry.color || (known ? known.color : look.color)
        };
    }

    function setActivities(list) {
        activities = (list && list.length ? list : DEFAULT_ACTIVITIES).map(decorate);
        byId = new Map(activities.map((a) => [a.id, a]));
        return activities;
    }

    function getActivities() {
        return activities;
    }

    async function loadActivities() {
        const stored = await AmsDb.get(STORE_KEY, null);
        return setActivities(stored);
    }

    async function saveActivities(list) {
        setActivities(list);
        await AmsDb.set(STORE_KEY, activities.map((a) => ({ id: a.id, label: a.label, kind: a.kind })));
        return activities;
    }

    async function resetActivities() {
        await AmsDb.remove(STORE_KEY);
        return setActivities(null);
    }

    /* A stable id from a label, unique against what is already there. */
    function idFor(label, existing) {
        const base = AmsMapping.normalise(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            || 'activity';
        let id = base;
        let n = 2;
        while (existing.some((a) => a.id === id)) id = base + '-' + (n++);
        return id;
    }

    /*
     * Unknown ids resolve to whatever is left rather than crashing — an extra
     * logged under an activity later deleted still has to render.
     */
    function activity(id) {
        return byId.get(id)
            || byId.get('other')
            || activities[activities.length - 1]
            || decorate({ id: 'other', label: 'Something else', kind: 'everyday' });
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
            const match = activities.find((a) => AmsMapping.normalise(a.label) === AmsMapping.normalise(label));

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
        DEFAULT_ACTIVITIES: DEFAULT_ACTIVITIES,
        getActivities: getActivities,
        setActivities: setActivities,
        loadActivities: loadActivities,
        saveActivities: saveActivities,
        resetActivities: resetActivities,
        idFor: idFor,
        activity: activity,
        wantsMetrics: wantsMetrics,
        ensureSheet: ensureSheet,
        nextRow: nextRow,
        alreadyRecorded: alreadyRecorded,
        buildEdits: buildEdits,
        read: read
    };
})();
