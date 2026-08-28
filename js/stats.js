/*
 * What the plan says about how the training is actually going.
 *
 * The workbook already computes statistics — the Progress sheet totals planned
 * against actual, week by week, and draws a chart of it. This module does not
 * repeat any of that, for two reasons.
 *
 * The first is that it cannot. Those cells are formulas, and a formula in a
 * file carries its last answer alongside it. When this app writes a logged
 * session it edits the cell it was asked to edit and nothing else, so the
 * SUMIFS in Progress still holds the number Excel worked out the last time
 * Excel had the file open. Read it and you would show a stale figure with
 * complete confidence. Excel recalculates the instant the workbook is opened,
 * which is exactly why the sheet is right and reading it from here is wrong.
 *
 * The second is that it would be pointless. A phone is a bad place to look at
 * a grid of 48 weeks by 16 columns, and the sheet is a good place to look at
 * it. Repeating it here would cost code and give nothing back.
 *
 * So this asks the questions a spreadsheet of that shape structurally cannot,
 * from the rows themselves:
 *
 *   - which sport quietly runs behind the others
 *   - how consistent the last stretch has been
 *   - how often a session was moved rather than lost
 *
 * A fourth — which weekday gets skipped — was built, shown, and removed at
 * Martin's word: he was not interested and never would be, and a figure
 * nobody wants is noise wearing the clothes of information. The commit that
 * removed it restores it if that ever changes.
 *
 * All three are derived, none are stored, and nothing here writes anything.
 */
const AmsStats = (function () {
    'use strict';


    /*
     * A session in the future has not been missed; it simply has not happened.
     * Every count here is over sessions whose day has passed, which is the same
     * guard the Progress sheet applies with its own >TODAY() tests. Without it
     * every statistic would be dragged towards zero by a plan that runs to next
     * August.
     */
    function isPast(workout, todayKey) {
        return !!workout.dayKey && workout.dayKey < todayKey;
    }

    function outcomeOf(workout, isMissed, isRecorded) {
        if (isMissed(workout)) return 'missed';
        if (isRecorded(workout)) return 'done';
        return 'unlogged';
    }

    /*
     * How many sessions in a row, counting back from the most recent day that
     * has passed. A missed session breaks it; so does one never logged at all,
     * because a plan you did not answer is not a plan you kept.
     */
    function streaks(past) {
        let current = 0;
        let longest = 0;
        let run = 0;

        past.forEach((workout) => {
            if (workout.outcome === 'done') {
                run += 1;
                if (run > longest) longest = run;
            } else {
                run = 0;
            }
        });

        for (let i = past.length - 1; i >= 0; i--) {
            if (past[i].outcome !== 'done') break;
            current += 1;
        }

        return { current: current, longest: longest };
    }

    /*
     * A remembered move is only believed if the session it names is still the
     * session it was. The key is sheet plus row, and a row inserted in Excel
     * slides every session below it onto its neighbour's identity — so without
     * this check a move recorded against a bike session would later be read
     * against whatever now sits in that row, which may be a rest day. The
     * sport is the cheapest thing that survives an edit and settles the
     * question; when it disagrees the record is ignored, and the session simply
     * counts on the day the sheet currently gives it.
     */
    function moveFor(workout, moves) {
        const move = moves[workout.key];
        if (!move) return null;
        if (move.disciplineId && workout.discipline
                && move.disciplineId !== workout.discipline.id) return null;
        return move;
    }


    /*
     * Which sport runs behind. Counted in minutes as well as sessions, because
     * a sport can keep every short session and lose every long one and still
     * look faultless by count alone.
     */
    function bySport(past) {
        const map = new Map();

        past.forEach((workout) => {
            const id = workout.discipline ? workout.discipline.id : 'other';
            if (!map.has(id)) {
                map.set(id, {
                    id: id,
                    label: workout.discipline ? workout.discipline.label : 'Other',
                    color: workout.discipline ? workout.discipline.color : null,
                    order: workout.order,
                    planned: 0, done: 0, missed: 0, unlogged: 0,
                    plannedSeconds: 0, doneSeconds: 0, rate: null
                });
            }
            const row = map.get(id);
            row.planned += 1;
            row[workout.outcome] += 1;
            row.plannedSeconds += workout.plannedSeconds || 0;
            if (workout.outcome === 'done') row.doneSeconds += workout.plannedSeconds || 0;
        });

        const rows = Array.from(map.values());
        rows.forEach((row) => { if (row.planned) row.rate = row.done / row.planned; });
        rows.sort((a, b) => a.order - b.order);

        const worst = rows.length
            ? rows.reduce((low, row) => (row.rate < low.rate ? row : low))
            : null;

        return { rows: rows, worst: worst };
    }

    /*
     * Missed against moved.
     *
     * The workbook cannot answer this on its own: rescheduling writes the new
     * date over the old one, so a moved session afterwards looks like a session
     * that was always on that day. The moves counted here are the ones this app
     * made and remembered locally, which means the figure starts from the day
     * that record began rather than from the start of the plan. It says so on
     * the screen rather than quietly reporting a low number as if it were the
     * whole truth.
     */
    function movedVsMissed(past, moves, since) {
        const missed = past.filter((workout) => workout.outcome === 'missed').length;

        /*
         * Only sessions whose day has passed, on the same principle as
         * everything else here: a session moved to next Tuesday has not yet
         * been saved by moving it, and counting it as rescued would be
         * counting a promise.
         *
         * And only sessions not missed in the end. Moving a session and then
         * missing it anyway is a miss, not a save, and counting it as both
         * would let one abandoned session improve the figure it belongs in.
         */
        const moved = past.filter((workout) => {
            if (workout.outcome === 'missed') return false;
            const move = moveFor(workout, moves);
            return !!(move && move.from && move.to && move.from !== move.to);
        }).length;

        const total = missed + moved;
        return {
            missed: missed,
            moved: moved,
            keptByMoving: total ? moved / total : null,
            since: since || null
        };
    }

    /*
     * `workouts` is the plan as the app already holds it; `isMissed` and
     * `isRecorded` are passed in rather than reimplemented, so that a session's
     * status means one thing across the whole app and cannot drift here.
     */
    function summarise(options) {
        const workouts = (options && options.workouts) || [];
        const moves = (options && options.moves) || {};
        const todayKey = (options && options.todayKey) || '';
        const isMissed = (options && options.isMissed) || (() => false);
        const isRecorded = (options && options.isRecorded) || (() => false);
        const plannedSecondsOf = (options && options.plannedSecondsOf) || (() => 0);
        const orderOf = (options && options.orderOf) || (() => 99);

        const past = workouts
            /* A rest day is not a session. It cannot be kept or missed, and
               counting it would inflate every rate with days spent resting
               exactly as instructed. */
            .filter((workout) => workout.discipline && workout.discipline.id !== 'rest')
            .filter((workout) => isPast(workout, todayKey))
            .map((workout) => ({
                key: workout.key,
                dayKey: workout.dayKey,
                discipline: workout.discipline,
                order: orderOf(workout.discipline ? workout.discipline.id : 'other'),
                plannedSeconds: plannedSecondsOf(workout) || 0,
                outcome: outcomeOf(workout, isMissed, isRecorded)
            }))
            .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));

        const done = past.filter((w) => w.outcome === 'done').length;
        const missed = past.filter((w) => w.outcome === 'missed').length;
        const unlogged = past.filter((w) => w.outcome === 'unlogged').length;

        return {
            any: past.length > 0,
            counted: past.length,
            done: done,
            missed: missed,
            unlogged: unlogged,
            answered: done + missed,
            firstDay: past.length ? past[0].dayKey : null,
            lastDay: past.length ? past[past.length - 1].dayKey : null,
            streak: streaks(past),
            sport: bySport(past),
            moves: movedVsMissed(past, moves, (options && options.movesSince) || null)
        };
    }

    return {
        summarise: summarise
    };
})();
