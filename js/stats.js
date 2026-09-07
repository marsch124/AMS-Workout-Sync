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
 *   - and, since v1.52.0, whether any of it is working: how far you travel
 *     per heartbeat, then against now, one sport at a time
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

    /* ---------- is it working ---------- */

    /*
     * The one question logging is for.
     *
     * Everything else in this module is about whether the plan was kept. This
     * is about whether it did anything — and it is the only question that
     * needs the numbers typed into the sheet rather than the ticks.
     *
     * The measure is how far you travel per heartbeat: speed divided by heart
     * rate. It is the plainest thing that can be built out of the three
     * figures actually recorded — distance, time and average heart rate — and
     * it moves in the right direction for the right reason. Going faster at
     * the same heart rate raises it; the same speed at a lower heart rate
     * raises it too. Both of those are fitness.
     *
     * Four rules keep it honest, and each of them costs data on purpose:
     *
     *   1. **Only sessions carrying all three numbers.** No inferring, no
     *      filling in.
     *   2. **One sport at a time.** A swim and a ride share no scale.
     *   3. **Easy sessions where there are enough of them.** Aerobic fitness
     *      shows up in steady work; a session of intervals is a different
     *      question wearing the same numbers. Effort 5 or under, and if that
     *      leaves too few the rest are used and the screen says so.
     *   4. **Enough on both sides to be worth comparing.** Four each way, and
     *      it says nothing at all rather than drawing a line through three
     *      points.
     *
     * Speed is derived from distance over time rather than read from the pace
     * column, which in this workbook means km/h on a bike, min/km on a run and
     * per-100m in the pool — one column, three units, and nothing good comes
     * of averaging that.
     */
    const TREND_SPORTS = ['swim', 'bike', 'run'];
    const TREND_MIN_PER_HALF = 4;
    const TREND_EASY_RPE = 5;

    /* Heart rates outside this are somebody mistyping, not somebody training. */
    const TREND_HR = [60, 220];

    function usableForTrend(row) {
        if (!row) return false;
        if (!(row.minutes > 0) || !(row.km > 0)) return false;
        if (!(row.hr >= TREND_HR[0] && row.hr <= TREND_HR[1])) return false;
        return true;
    }

    function meanOf(rows, pick) {
        if (!rows.length) return 0;
        return rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
    }

    function halfFigures(rows) {
        const speed = meanOf(rows, (r) => r.km / (r.minutes / 60));   // km/h
        const hr = meanOf(rows, (r) => r.hr);
        return {
            sessions: rows.length,
            from: rows[0].dayKey,
            to: rows[rows.length - 1].dayKey,
            speed: speed,
            hr: hr,
            // Seconds per kilometre, which is what a pace is.
            paceSeconds: speed > 0 ? 3600 / speed : 0,
            perBeat: hr > 0 ? speed / hr : 0
        };
    }

    /*
     * Better, the same, or worse — with a band in the middle wide enough that
     * ordinary noise does not get announced as progress. Three per cent of an
     * efficiency figure is roughly a good night's sleep.
     */
    function verdictFor(change) {
        if (change >= 0.03) return 'better';
        if (change <= -0.03) return 'down';
        return 'level';
    }

    function trends(input) {
        const rows = input.rows || [];
        const out = [];

        for (const sport of TREND_SPORTS) {
            /*
             * A sport he has recorded at all earns an entry, even when not one
             * of those sessions carries all three numbers. Staying silent in
             * that case would be the worst of both: the screen never appears,
             * and the reason it never appears — no heart rates written down —
             * is the one thing he would need to be told.
             */
            const mine = rows.filter((row) => row.sport === sport);
            if (!mine.length) continue;
            const all = mine.filter(usableForTrend);

            const easy = all.filter((row) => row.rpe > 0 && row.rpe <= TREND_EASY_RPE);
            const easyOnly = easy.length >= TREND_MIN_PER_HALF * 2;
            const used = (easyOnly ? easy : all)
                .slice()
                .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));

            if (used.length < TREND_MIN_PER_HALF * 2) {
                out.push({
                    sport: sport,
                    enough: false,
                    have: used.length,
                    need: TREND_MIN_PER_HALF * 2,
                    usable: all.length,
                    easyOnly: easyOnly
                });
                continue;
            }

            /*
             * Split down the middle by count rather than by date. An eight-week
             * gap in the winter would otherwise put almost everything on one
             * side of a date-based line and compare a season with a fortnight.
             */
            const middle = Math.floor(used.length / 2);
            const then = halfFigures(used.slice(0, middle));
            const now = halfFigures(used.slice(used.length - middle));

            const change = then.perBeat > 0 ? (now.perBeat - then.perBeat) / then.perBeat : 0;

            out.push({
                sport: sport,
                enough: true,
                easyOnly: easyOnly,
                sessions: used.length,
                then: then,
                now: now,
                change: change,
                verdict: verdictFor(change),
                // Said separately because they answer different halves of it:
                // faster, or the same speed for less work.
                speedChange: then.speed > 0 ? (now.speed - then.speed) / then.speed : 0,
                hrChange: then.hr > 0 ? (now.hr - then.hr) / then.hr : 0
            });
        }

        return {
            sports: out,
            any: out.some((s) => s.enough)
        };
    }

    /* ---------- where the hours went ---------- */

    /*
     * Two questions the Progress sheet answers in a grid and a phone cannot:
     * how each week came out against what it asked for, and where the hours
     * actually go between the sports.
     *
     * Both are hours rather than counts, which is the difference between this
     * and "which sport runs behind" further down the screen. That one asks
     * whether sessions were kept; this asks what the training was made of. A
     * swimmer who never misses a twenty-minute swim and skips half his rides
     * looks obedient there and lopsided here, and both are true.
     *
     * `weekStarts` is handed in already worked out, oldest first, with the day
     * the window stops at. Calendars are the caller's business — this module
     * has no notion of a Monday and is not going to grow one.
     *
     * `endExclusive` is not optional in spirit. Without it every session in the
     * rest of the plan fell into the last bucket, because "the last week
     * beginning on or before this day" is true of a session next March as much
     * as of one this Thursday. Twelve weeks then reported three hundred hours.
     */
    function load(input) {
        const rows = input.rows || [];
        const starts = (input.weekStarts || []).slice();
        if (!starts.length) return { weeks: [], sports: [], planned: 0, actual: 0 };

        const from = starts[0];
        const until = input.endExclusive || null;
        const weeks = starts.map((start) => ({ start: start, planned: 0, actual: 0, sessions: 0 }));

        const bucketFor = (dayKey) => {
            // The last week that begins on or before this day.
            for (let i = weeks.length - 1; i >= 0; i--) {
                if (dayKey >= weeks[i].start) return weeks[i];
            }
            return null;
        };

        const bySport = {};
        let planned = 0;
        let actual = 0;

        for (const row of rows) {
            if (!row.dayKey || row.dayKey < from) continue;
            if (until && row.dayKey >= until) continue;
            const week = bucketFor(row.dayKey);
            if (!week) continue;

            const p = row.planned || 0;
            const a = row.actual || 0;
            week.planned += p;
            week.actual += a;
            if (a > 0) week.sessions++;

            planned += p;
            actual += a;

            if (!bySport[row.sport]) bySport[row.sport] = { sport: row.sport, planned: 0, actual: 0 };
            bySport[row.sport].planned += p;
            bySport[row.sport].actual += a;
        }

        const sports = Object.keys(bySport)
            .map((id) => bySport[id])
            .filter((s) => s.planned > 0 || s.actual > 0)
            .sort((a, b) => b.actual - a.actual || b.planned - a.planned);

        // Shares are of what was actually done and of what was asked for, kept
        // apart on purpose: drifting from the plan's own balance is the thing
        // worth seeing, and one number cannot show a drift.
        sports.forEach((s) => {
            s.shareActual = actual > 0 ? s.actual / actual : 0;
            s.sharePlanned = planned > 0 ? s.planned / planned : 0;
        });

        return { weeks: weeks, sports: sports, planned: planned, actual: actual };
    }

    return {
        summarise: summarise,
        trends: trends,
        load: load
    };
})();

/* Pure arithmetic over rows, so it can be checked in plain node. */
if (typeof module !== 'undefined' && module.exports) module.exports = AmsStats;
