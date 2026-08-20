/*
 * Screens and rendering.
 *
 * The shape of the app follows the shape of the question it answers: Today
 * ("what am I doing?"), the workout ("how is it broken up?"), the log form
 * ("what did I actually do?"), and Settings, which is where the workbook is
 * connected and its columns explained once.
 */
const AmsUi = (function () {
    'use strict';

    let currentWorkout = null;
    let expandedDay = null;
    let legendOpen = false;
    let settingsFoldOpen = false;

    /* The hour a training day starts, for the calendar export. The workbook has
       no column for the time of day, so this is the app's choice and not the
       plan's — which is why it is written down here rather than buried. */
    const CALENDAR_START_HOUR = 6;
    let currentRange = 'upcoming';
    let setupDraft = null;
    let setupSheet = null;
    let dropboxFiles = null;

    /* ---------- small helpers ---------- */

    function esc(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function $(id) { return document.getElementById(id); }

    const MIDDOT = '·';

    /* Dates from the workbook are UTC-anchored, so they must be formatted in
       UTC too — otherwise a session drifts to the previous day west of London. */
    function formatDay(date, options) {
        if (!(date instanceof Date) || isNaN(date)) return '';
        return date.toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, options));
    }

    function longDay(date) {
        return formatDay(date, { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function shortDay(date) {
        return formatDay(date, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function relativeDay(dayKey) {
        const today = AmsSync.todayKey();
        if (dayKey === today) return 'Today';
        const a = Date.parse(dayKey + 'T00:00:00Z');
        const b = Date.parse(today + 'T00:00:00Z');
        const days = Math.round((a - b) / 86400000);
        if (days === 1) return 'Tomorrow';
        if (days === -1) return 'Yesterday';
        if (days > 1 && days < 7) return 'In ' + days + ' days';
        if (days < -1 && days > -7) return days * -1 + ' days ago';
        return '';
    }

    let toastTimer = null;

    function toast(message, tone) {
        const node = $('toast');
        node.textContent = message;
        node.className = 'toast show' + (tone ? ' ' + tone : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { node.className = 'toast'; }, tone === 'bad' ? 5200 : 3000);
    }

    /* ---------- navigation ---------- */

    const DETAIL_SCREENS = new Set(['workoutScreen', 'logScreen', 'setupScreen', 'rescheduleScreen',
        'extraScreen', 'guideScreen', 'versionScreen', 'queueScreen', 'activitiesScreen']);
    const history_ = [];

    function showScreen(id, options) {
        const opts = options || {};
        const current = document.querySelector('.screen.active');
        if (current && current.id === id) return;
        if (current && !opts.replace && DETAIL_SCREENS.has(id)) history_.push(current.id);

        document.querySelectorAll('.screen').forEach((screen) => {
            screen.classList.toggle('active', screen.id === id);
        });
        document.body.classList.toggle('detail-open', DETAIL_SCREENS.has(id));

        const body = document.querySelector('.screen.active .screen-body');
        if (body) body.scrollTop = 0;
    }

    function goBack() {
        const previous = history_.pop() || 'todayScreen';
        showScreen(previous, { replace: true });
        syncTabHighlight(previous);
    }

    function syncTabHighlight(screenId) {
        const map = { todayScreen: 'today', planScreen: 'plan', settingsScreen: 'settings' };
        const tab = map[screenId];
        if (!tab) return;
        document.body.dataset.tab = tab;
        document.querySelectorAll('.tab').forEach((node) => {
            node.classList.toggle('active', node.dataset.tab === tab);
        });
    }

    function openTab(tab) {
        const map = { today: 'todayScreen', plan: 'planScreen', settings: 'settingsScreen' };
        history_.length = 0;
        showScreen(map[tab] || 'todayScreen', { replace: true });
        syncTabHighlight(map[tab] || 'todayScreen');
        if (tab === 'plan') renderPlan();
        if (tab === 'settings') {
            // Shut again every time the tab is opened: the fold is a place to
            // go on purpose, not a state to leave lying open.
            settingsFoldOpen = false;
            renderSettings();
        }
        if (tab === 'today') renderToday();
    }

    /* ---------- rendering pieces ---------- */

    /*
     * What a workout's row already says about itself: logged, missed, or
     * waiting to be written. A session marked missed carries the workbook's own
     * missed marker in its completed column, so it is recognised on the way
     * back in as well as on the way out.
     */
    function statusOf(workout) {
        if (workout.pending) {
            const values = workout.pending.values || {};
            if (values.moveTo) return { kind: 'moved', pending: true, label: 'Moved — waiting to sync' };
            return values.missed
                ? { kind: 'missed', pending: true, label: 'Missed — waiting to sync' }
                : { kind: 'logged', pending: true, label: 'Waiting to sync' };
        }

        if (AmsSync.isMissed(workout)) return { kind: 'missed', pending: false, label: 'Missed' };

        if (workout.logged) return { kind: 'logged', pending: false, label: 'Logged' };
        return null;
    }

    function statusPill(workout) {
        const status = statusOf(workout);
        if (!status) return '';
        const cls = status.pending ? 'pending' : (status.kind === 'missed' ? 'missed' : 'done');
        return '<span class="pill ' + cls + '">' + esc(status.label) + '</span>';
    }

    function sportStyle(workout) {
        return 'style="--sport: ' + workout.discipline.color + '"';
    }

    function workoutCard(workout, options) {
        const opts = options || {};
        const state = AmsSync.getState();
        const planned = AmsPlan.plannedDurationSeconds(workout, state.mapping || {});
        const pills = [];

        if (planned) pills.push('<span class="pill strong">' + esc(AmsPlan.formatDuration(planned)) + '</span>');
        if (workout.planned && workout.planned.distanceRaw) {
            pills.push('<span class="pill">' + esc(formatDistance(workout.planned.distanceRaw, state.mapping)) + '</span>');
        }
        if (workout.planned && workout.planned.intensity) {
            pills.push('<span class="pill">' + esc(workout.planned.intensity) + '</span>');
        }
        pills.push(statusPill(workout));
        if (opts.showDate) {
            pills.unshift('<span class="pill">' + esc(shortDay(workout.date)) + '</span>');
        }

        return '<div class="card workout-card card-tappable" data-workout="' + esc(workout.key) + '" ' + sportStyle(workout) + '>'
            + '<div class="workout-card-head">'
            +   '<div class="sport-badge"><svg class="icon"><use href="#icon-' + esc(workout.discipline.icon) + '"></use></svg></div>'
            +   '<div class="workout-card-titles">'
            +     '<p class="workout-card-sport">' + esc(workout.discipline.label) + '</p>'
            +     '<p class="workout-card-title">' + esc(workout.title) + '</p>'
            +   '</div>'
            + '</div>'
            + (pills.length ? '<div class="workout-card-meta">' + pills.join('') + '</div>' : '')
            + '</div>';
    }

    function formatDistance(raw, mapping) {
        if (raw === null || raw === undefined) return '';
        const unit = (mapping && mapping.units && mapping.units.distance) || 'km';
        if (unit === 'm') return Math.round(raw) + ' m';
        return (Math.round(raw * 100) / 100) + ' km';
    }

    function sectionsHtml(workout) {
        if (!workout.sections.length) {
            return '<p class="prose">No breakdown for this session in the workbook.</p>';
        }
        return workout.sections.map((section) =>
            '<div class="section-block">'
            + '<p class="section-label">' + esc(section.label) + '</p>'
            + '<p class="section-text">' + esc(section.text) + '</p>'
            + (section.target ? '<p class="section-target">Target: ' + esc(section.target) + '</p>' : '')
            + '</div>'
        ).join('');
    }

    /* ---------- today ---------- */

    function renderToday() {
        const state = AmsSync.getState();
        const now = new Date();
        const todaysSessions = AmsSync.today();

        /*
         * The date used to be the biggest thing on the screen, which spent the
         * most prominent line in the app telling you something your phone
         * already says twice. It moves to the eyebrow, where reference
         * information belongs, and the heading carries the one piece of
         * orientation nothing else shows: which block of the plan you are in.
         */
        $('todayEyebrow').textContent =
            now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
        $('todayDate').textContent = todayHeading(todaysSessions);

        renderSyncState();

        const body = $('todayBody');

        if (!state.workbook) {
            body.innerHTML = emptyState('icon-cloud', 'No workbook yet',
                'Connect the training plan that lives in your Dropbox, and today’s session will be waiting here.',
                '<button class="btn btn-primary" data-go="settings">Open settings</button>');
            return;
        }

        if (!AmsMapping.isComplete(state.mapping)) {
            body.innerHTML = emptyState('icon-plan', 'The columns need explaining',
                'The workbook opened, but the app could not tell which column holds the date and which the discipline.',
                '<button class="btn btn-primary" data-go="setup">Open sheet setup</button>');
            return;
        }

        const todays = todaysSessions;
        const header = weekCard() + outstandingNudge();

        if (!todays.length) {
            const next = AmsSync.upcoming(3);
            body.innerHTML = header
                + emptyState('icon-check', 'Rest day',
                'Nothing is scheduled for today in the workbook.',
                '')
                + extrasBlock()
                + (next.length
                    ? '<div class="day-heading"><h2>Coming up</h2></div>'
                        + next.map((w) => workoutCard(w, { showDate: true })).join('')
                    : '');
            return;
        }

        body.innerHTML = header + todays.map((workout) => {
            const state2 = AmsSync.getState();
            const planned = AmsPlan.plannedDurationSeconds(workout, state2.mapping || {});
            return '<div class="card workout-card" ' + sportStyle(workout) + '>'
                + '<div class="workout-card-head">'
                +   '<div class="sport-badge"><svg class="icon"><use href="#icon-' + esc(workout.discipline.icon) + '"></use></svg></div>'
                +   '<div class="workout-card-titles">'
                +     '<p class="workout-card-sport">' + esc(workout.discipline.label) + '</p>'
                +     '<p class="workout-card-title">' + esc(workout.title) + '</p>'
                +   '</div>'
                + '</div>'
                + '<div class="workout-card-meta">'
                +   (planned ? '<span class="pill strong">' + esc(AmsPlan.formatDuration(planned)) + '</span>' : '')
                +   (workout.planned && workout.planned.distanceRaw
                        ? '<span class="pill">' + esc(formatDistance(workout.planned.distanceRaw, state2.mapping)) + '</span>' : '')
                +   statusPill(workout)
                + '</div>'
                + '<div style="margin-top:0.9rem">' + sectionsHtml(workout) + '</div>'
                + (workout.discipline.id === 'rest'
                    ? '<p class="hint-inline">Nothing to log — the adaptation happens now.</p>'
                    : '<div class="button-row" style="margin-top:0.4rem">'
                        + '<button class="btn btn-primary" data-log="' + esc(workout.key) + '">'
                        + (statusOf(workout) && statusOf(workout).kind === 'logged' ? 'Log again' : 'Log this session')
                        + '</button>'
                        + '<button class="btn btn-small" data-missed="' + esc(workout.key) + '">Missed</button>'
                        + '<button class="btn btn-small" data-move="' + esc(workout.key) + '">Move</button>'
                      + '</div>')
                + '</div>';
        }).join('') + extrasBlock();
    }

    /*
     * How the week stands. The figure that decides whether Thursday evening is
     * a session or the sofa, and it was previously only visible by opening the
     * workbook on a laptop.
     */
    /*
     * What the week's numbers should say, which is not the same sentence all
     * week. "0m of 3h 05m planned" is a true statement and a dispiriting one:
     * on a Monday it reports a shortfall against work that was never due yet.
     *
     * So: before anything is done, state the week's target and leave the zero
     * to the session count above. Once something is banked, lead with it and
     * point at what is left rather than at what is missing. And when the week
     * is met, say so instead of quietly reading 100%.
     */
    function weekFigures(week) {
        // Both numbers, every week, in that order: what you did, then what the
        // week asked for. Performed leads because it is the half you earned;
        // planned stays beside it because a figure with nothing to measure it
        // against says very little.
        //
        // "0s" is what the formatter makes of no time at all, which is not how
        // anybody says it about a week.
        const performed = week.actualSeconds ? AmsPlan.formatDuration(week.actualSeconds) : '0m';
        const line = performed + ' performed ' + MIDDOT + ' '
            + AmsPlan.formatDuration(week.plannedSeconds) + ' planned';

        // Meeting the week is worth saying outright rather than leaving to be
        // worked out from two numbers. Within a minute either way counts.
        const met = week.actualSeconds && week.plannedSeconds - week.actualSeconds <= 60;

        // Anything done outside the plan is named as such and kept out of the
        // two figures above, which are about the plan. It still has to appear:
        // twenty minutes on the mat is twenty minutes you spent.
        const extra = week.extraSeconds
            ? ' ' + MIDDOT + ' ' + AmsPlan.formatDuration(week.extraSeconds) + ' extra'
            : '';

        return line + (met ? ' ' + MIDDOT + ' week complete' : '') + extra;
    }

    /*
     * The week drawn rather than described: a column per day, a bar per
     * session, height by planned duration and colour by discipline. Solid once
     * recorded, hollow while outstanding.
     *
     * The point is the shape — where the long ride sits, which evening is
     * free, whether Friday is genuinely clear — which is the thing you plan
     * around and which no amount of "2h 34m to go" conveys.
     */
    function weekStrip() {
        const days = AmsSync.weekDays();
        if (!days.length) return '';

        // Bar heights are relative to the biggest day of this week, so a heavy
        // week and a light one each use the full height and stay readable.
        const tallest = days.reduce((max, d) => Math.max(max, d.plannedSeconds), 0);
        if (!tallest) return '';

        const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

        return '<div class="week-strip" role="list">' + days.map((day, index) => {
            const bars = day.training.map((workout) => {
                const planned = AmsPlan.plannedDurationSeconds(workout, AmsSync.getState().mapping || {}) || 0;
                // Every session stays visible, however short beside a long ride.
                const height = Math.max(9, Math.round(planned / tallest * 100));
                const status = statusOf(workout);
                const kind = status ? status.kind : 'todo';
                return '<span class="week-bar-seg is-' + esc(kind) + '"'
                    + ' style="height:' + height + '%; --sport: ' + workout.discipline.color + '"'
                    + ' title="' + esc(workout.discipline.label + ' · '
                        + (AmsPlan.formatDuration(planned) || '')) + '"></span>';
            }).join('');

            const label = day.date ? day.date.getUTCDate() : '';
            const classes = ['week-day'];
            if (day.isToday) classes.push('is-today');
            if (day.isPast) classes.push('is-past');
            if (day.isRest) classes.push('is-rest');
            if (expandedDay === day.dayKey) classes.push('is-open');

            return '<button class="' + classes.join(' ') + '" role="listitem"'
                + ' data-day="' + esc(day.dayKey) + '"'
                + ' aria-label="' + esc(longDay(day.date) + ' — '
                    + (day.isRest ? 'rest day'
                        : day.training.length ? day.training.length + ' session'
                            + (day.training.length === 1 ? '' : 's') + ', '
                            + (AmsPlan.formatDuration(day.plannedSeconds) || '')
                        : 'nothing planned')) + '">'
                + '<span class="week-day-bars">' + (day.isRest ? '<span class="week-rest"></span>' : bars) + '</span>'
                + '<span class="week-day-letter">' + letters[index] + '</span>'
                + '<span class="week-day-date">' + label + '</span>'
                + '</button>';
        }).join('') + '</div>';
    }

    /* The sessions of whichever day was tapped, shown without leaving Today. */
    function expandedDayBlock() {
        if (!expandedDay) return '';
        const sessions = AmsSync.forDay(expandedDay);
        const date = AmsPlan.parseDayKey(expandedDay);

        return '<div class="week-expanded">'
            + '<p class="week-expanded-title">' + esc(longDay(date)) + '</p>'
            + (sessions.length
                ? sessions.map((w) =>
                    '<div class="week-expanded-row" style="--sport: ' + w.discipline.color + '">'
                    + '<span class="week-expanded-sport">' + esc(w.discipline.label) + '</span>'
                    + '<span class="week-expanded-what">' + esc(w.title) + '</span>'
                    + '<span class="week-expanded-meta">'
                    + esc(AmsPlan.formatDuration(
                        AmsPlan.plannedDurationSeconds(w, AmsSync.getState().mapping || {})) || '')
                    + '</span></div>').join('')
                : '<p class="hint-inline">Nothing planned.</p>')
            + '</div>';
    }

    /*
     * Tap the slate itself and the week explains its own drawing.
     *
     * The strip says four different things with the same shape — solid,
     * hollow, dashed, hatched — and a shape carries no label. That is the
     * point of it, and also the one place it can be misread, so the key lives
     * one tap away rather than taking up room it does not need to.
     *
     * The sports listed are the ones this week actually contains: a legend for
     * a week with no swim in it would be a legend for somebody else’s week.
     */
    function weekLegend() {
        if (!legendOpen) return '';

        const shapes = [
            { cls: '', text: 'Recorded' },
            { cls: 'is-todo', text: 'Still to do' },
            { cls: 'is-moved', text: 'Moved to another day' },
            { cls: 'is-missed', text: 'Marked missed' }
        ];

        // The five are always listed, in training order, so the key is a key
        // rather than a description of this particular week — a colour missing
        // one week and present the next is not something to have to work out.
        // Anything else the week does contain — a brick, a race — is added after.
        const seen = new Map();
        let anyRest = false;
        AmsSync.weekDays().forEach((day) => {
            if (day.isRest) anyRest = true;
            day.training.forEach((workout) => {
                if (!seen.has(workout.discipline.id)) seen.set(workout.discipline.id, workout.discipline);
            });
        });
        AmsPlan.DISCIPLINES.forEach((discipline) => seen.set(discipline.id, discipline));
        const sports = Array.from(seen.values())
            .sort((a, b) => AmsPlan.disciplineOrder(a.id) - AmsPlan.disciplineOrder(b.id));

        const shapeRows = shapes.map((shape) =>
            '<li><span class="week-legend-swatch">'
            + '<span class="week-bar-seg ' + shape.cls + '"></span></span>'
            + esc(shape.text) + '</li>').join('')
            + (anyRest
                ? '<li><span class="week-legend-swatch"><span class="week-rest"></span></span>Rest day</li>'
                : '');

        const sportRows = sports.length
            ? '<ul class="week-legend-sports">' + sports.map((discipline) =>
                '<li style="--sport: ' + discipline.color + '">'
                + '<span class="week-legend-dot"></span>' + esc(discipline.label)
                + '</li>').join('') + '</ul>'
            : '';

        return '<div class="week-legend">'
            + '<p class="week-legend-title">Reading the week</p>'
            + '<ul class="week-legend-shapes">' + shapeRows + '</ul>'
            + sportRows
            + '<p class="week-legend-note">Height is the planned duration, against the '
            + 'biggest day of the week. Tap a day to see what is on it.</p>'
            + '</div>';
    }

    /* ---------- a choice, asked at the bottom of the screen ---------- */

    /*
     * Deliberately not a promise that resolves with the answer.
     *
     * The share sheet may only be opened from a tap, and a call made from a
     * promise continuation is far enough from the tap that iOS can refuse it.
     * So each option carries what it does, and does it in its own click.
     */
    function openChoice(title, options) {
        const sheet = $('actionSheet');
        $('actionSheetTitle').textContent = title;

        const actions = $('actionSheetActions');
        actions.innerHTML = '';
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn' + (index === 0 ? ' btn-primary' : '');
            button.innerHTML = esc(option.label)
                + (option.sub ? '<span class="action-sheet-option-sub">' + esc(option.sub) + '</span>' : '');
            button.addEventListener('click', () => {
                closeChoice();
                option.act();
            });
            actions.appendChild(button);
        });

        sheet.hidden = false;
        sheet.style.display = '';
        const first = actions.querySelector('button');
        if (first) first.focus();
    }

    function closeChoice() {
        const sheet = $('actionSheet');
        sheet.hidden = true;
        sheet.style.display = 'none';
    }

    /*
     * The week as plain text, for sending to somebody who does not have the
     * app. Written to be read in a message: no markdown, and no alignment by
     * spaces — a proportional font would ruin it — so one block per day.
     *
     * What is already done is marked, because a week shared on a Thursday is
     * partly a report. A week that has not started yet has nothing to report,
     * so it is sent as what it is: a plan.
     */
    function weekShareText(weeksAhead) {
        const ahead = weeksAhead || 0;
        const from = AmsSync.weekStart(AmsSync.todayKey());
        if (!from) return '';

        const start = ahead ? shiftDayKey(from, ahead * 7) : from;
        const days = AmsSync.weekDays(start);
        if (!days.length) return '';
        const week = AmsSync.weekSummary(start);
        const mapping = AmsSync.getState().mapping || {};
        const future = start > AmsSync.todayKey();

        const first = days[0].date;
        const last = days[days.length - 1].date;
        const range = first && last ? shortDay(first) + ' to ' + shortDay(last) : '';

        const lines = ['Training week' + (range ? ' — ' + range : ''), ''];

        days.forEach((day) => {
            const heading = day.date
                ? formatDay(day.date, { weekday: 'long', day: 'numeric', month: 'long' })
                : day.dayKey;

            if (day.isRest) { lines.push(heading + ' — rest day'); return; }
            if (!day.training.length) { lines.push(heading + ' — nothing planned'); return; }

            lines.push(heading);
            day.training.forEach((workout) => {
                const planned = AmsPlan.formatDuration(
                    AmsPlan.plannedDurationSeconds(workout, mapping) || 0);
                const status = future ? null : statusOf(workout);
                const mark = status && status.kind === 'logged' ? '  ✓'
                    : status && status.kind === 'missed' ? '  (missed)'
                        : '';
                lines.push('  • ' + workout.discipline.label
                    + (planned ? ', ' + planned : '')
                    + (workout.title ? ' — ' + workout.title : '')
                    + mark);
            });
        });

        if (week) {
            lines.push('');
            lines.push(future
                ? (AmsPlan.formatDuration(week.plannedSeconds) || '0m') + ' planned'
                : weekFigures(week));
        }

        return lines.join('\n');
    }

    /* Monday of a week, moved by whole days, in the terms dates are held in. */
    function shiftDayKey(dayKey, days) {
        const at = Date.parse(dayKey + 'T00:00:00Z');
        if (isNaN(at)) return dayKey;
        return new Date(at + days * 86400000).toISOString().slice(0, 10);
    }

    /*
     * The share sheet where there is one, the clipboard where there is not.
     * Cancelling a share is not a failure and says nothing.
     */
    async function shareText(text) {
        if (!text) { toast('There is nothing in that week to share.', 'bad'); return; }

        if (navigator.share) {
            try {
                await navigator.share({ title: 'Training week', text: text });
                return;
            } catch (err) {
                // A refusal is not the same as a cancellation: fall through to
                // the clipboard for the first, say nothing for the second.
                if (err && err.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            toast('The week is on the clipboard — paste it wherever you like.', 'good');
        } catch (err) {
            toast('This browser will not let the app share or copy.', 'bad');
        }
    }

    /*
     * A week as calendar events: one per session, plus the rest days, which are
     * as much a part of what somebody else wants to know as the training is.
     *
     * Sessions start at six in the morning and run as long as they are planned
     * to. Where a day holds more than one they follow each other rather than
     * sitting on top of each other: a thirty-minute swim at 06:00 puts the
     * mobility that goes with it at 06:30. Two events stacked on the same hour
     * would say the two happen at once, which is not what the plan means.
     *
     * The summary carries sport, duration and what the session is, because
     * that is the line a calendar shows without being opened. Everything else
     * — the purpose, the intensity, the breakdown into warm-up and intervals —
     * goes in the notes.
     */
    function weekCalendar(weeksAhead) {
        const from = AmsSync.weekStart(AmsSync.todayKey());
        if (!from) return null;

        const start = weeksAhead ? shiftDayKey(from, weeksAhead * 7) : from;
        const days = AmsSync.weekDays(start);
        if (!days.length) return null;

        const mapping = AmsSync.getState().mapping || {};
        const events = [];

        days.forEach((day) => {
            // Where the day's first session begins, and where each one after
            // it picks up.
            let at = CALENDAR_START_HOUR * 3600;

            if (day.isRest) {
                events.push({
                    key: 'rest-' + day.dayKey,
                    dayKey: day.dayKey,
                    summary: 'Rest day',
                    description: (day.sessions[0] && day.sessions[0].title) || ''
                });
                return;
            }

            day.training.forEach((workout) => {
                const seconds = AmsPlan.plannedDurationSeconds(workout, mapping) || 0;
                const planned = AmsPlan.formatDuration(seconds);

                let summary = workout.discipline.label + (planned ? ' ' + planned : '');
                if (workout.title) summary += ' — ' + workout.title;
                if (summary.length > 80) summary = summary.slice(0, 79).trimEnd() + '…';

                /*
                 * A sheet with no breakdown of its own has one section made
                 * from the description, so the same sentence can arrive twice
                 * by two routes. Notes should not repeat themselves.
                 */
                const notes = [];
                const seen = new Set();
                const add = (text) => {
                    const line = String(text || '').trim();
                    const key = line.toLowerCase();
                    if (!line || seen.has(key)) return;
                    seen.add(key);
                    notes.push(line);
                };

                if (workout.title) add(workout.title);
                if (workout.planned && workout.planned.intensity) {
                    add('Intensity: ' + workout.planned.intensity);
                }
                const purpose = workout.planned && workout.planned.description;
                if (purpose) add('Purpose: ' + purpose);
                (workout.sections || []).forEach((section) => {
                    if (purpose && section.text === purpose) return;
                    add(section.label + ': ' + section.text
                        + (section.target ? ' (' + section.target + ')' : ''));
                });

                events.push({
                    key: workout.key,
                    dayKey: workout.dayKey,
                    summary: summary,
                    description: notes.join('\n'),
                    // A session the plan gives no length to cannot be given an
                    // hour either: it stays all-day, and does not push along
                    // whatever comes after it.
                    startSeconds: seconds ? at : 0,
                    durationSeconds: seconds
                });
                at += seconds;
            });
        });

        if (!events.length) return null;

        return {
            ics: AmsIcs.build(events, 'Training'),
            name: 'training-week-' + start + '.ics',
            count: events.length,
            sessions: days.reduce((sum, day) => sum + day.training.length, 0)
        };
    }

    /*
     * Handed to the share sheet as a file where that is possible, which on a
     * phone is what puts "Add All to Calendar" in front of you. Where it is
     * not, it is saved instead, which comes to the same thing one tap later.
     */
    async function shareCalendar(calendar) {
        if (!calendar) { toast('There is nothing in that week to put in a calendar.', 'bad'); return; }

        const blob = new Blob([calendar.ics], { type: 'text/calendar;charset=utf-8' });
        const file = typeof File === 'function'
            ? new File([blob], calendar.name, { type: 'text/calendar' })
            : null;

        if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Training week' });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = calendar.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast('Calendar file saved — open it to add the week.', 'good');
    }

    /*
     * Both weeks are written out before the question is asked, so that the tap
     * that answers it goes straight to the share sheet with nothing in between.
     */
    function shareWeek() {
        const thisWeek = weekShareText(0);
        const nextWeek = weekShareText(1);

        const summarise = (weeksAhead) => {
            const start = shiftDayKey(AmsSync.weekStart(AmsSync.todayKey()) || AmsSync.todayKey(),
                weeksAhead * 7);
            const week = AmsSync.weekSummary(start);
            const days = AmsSync.weekDays(start);
            if (!week || !days.length) return 'nothing planned';
            const sessions = days.reduce((sum, day) => sum + day.training.length, 0);
            return sessions + ' session' + (sessions === 1 ? '' : 's')
                + (week.plannedSeconds ? ' · ' + AmsPlan.formatDuration(week.plannedSeconds) : '');
        };

        const thisCal = weekCalendar(0);
        const nextCal = weekCalendar(1);
        const events = (cal) => cal
            ? cal.count + ' event' + (cal.count === 1 ? '' : 's') + ' · '
                + 'from ' + String(CALENDAR_START_HOUR).padStart(2, '0') + ':00'
            : 'nothing to add';

        openChoice('Share which week?', [
            { label: 'This week', sub: 'as a message · ' + summarise(0),
              act: () => shareText(thisWeek) },
            { label: 'Next week', sub: 'as a message · ' + summarise(1),
              act: () => shareText(nextWeek) },
            { label: 'This week to the calendar', sub: events(thisCal),
              act: () => shareCalendar(thisCal) },
            { label: 'Next week to the calendar', sub: events(nextCal),
              act: () => shareCalendar(nextCal) }
        ]);
    }

    function weekCard() {
        const week = AmsSync.weekSummary();

        /*
         * A week with nothing in it still gets a line, provided there is a
         * week after it worth sending. A plan that starts next month would
         * otherwise take the share button down with the card, and with it the
         * only way to put the coming week in front of anyone.
         */
        if (!week || !week.plannedSeconds) {
            const ahead = weekCalendar(1);
            if (!ahead) return '';
            return '<div class="card week-card" data-legend>'
                + '<div class="week-card-head">'
                + '<span class="week-card-head-main"><span class="week-card-label">This week</span></span>'
                + '<button type="button" class="week-share" data-share-week'
                + ' aria-label="Share a week">'
                + '<svg class="icon"><use href="#icon-share"></use></svg></button>'
                + '</div>'
                + '<p class="week-card-figures">Nothing planned this week '
                + '— next week has ' + ahead.sessions + ' session'
                + (ahead.sessions === 1 ? '' : 's') + '.</p></div>';
        }

        const percent = Math.round(week.actualSeconds / week.plannedSeconds * 100);
        const width = Math.max(0, Math.min(100, percent));

        return '<div class="card week-card" data-legend>'
            + '<div class="week-card-head">'
            + '<button type="button" class="week-card-head-main" data-legend'
            + ' aria-expanded="' + (legendOpen ? 'true' : 'false') + '">'
            + '<span class="week-card-label">This week'
            + '<span class="week-legend-cue" aria-hidden="true">?</span></span>'
            + '<span class="week-card-count">' + week.performed + ' of ' + week.sessions + ' sessions'
            + (week.missed ? ' ' + MIDDOT + ' ' + week.missed + ' missed' : '') + '</span>'
            + '</button>'
            + '<button type="button" class="week-share" data-share-week'
            + ' aria-label="Share this week">'
            + '<svg class="icon"><use href="#icon-share"></use></svg></button>'
            + '</div>'
            + weekStrip()
            + expandedDayBlock()
            + weekLegend()
            + '<div class="week-bar"><span style="width:' + width + '%"></span></div>'
            + '<p class="week-card-figures">' + esc(weekFigures(week)) + '</p></div>';
    }

    /*
     * Sessions in the past that were never recorded. Shown quietly rather than
     * as an alarm — the point is to make them findable, not to nag.
     */
    function outstandingNudge() {
        const missing = AmsSync.outstanding();
        if (!missing.length) return '';
        return '<button class="btn btn-block outstanding-nudge" data-go-outstanding="1">'
            + missing.length + ' earlier session' + (missing.length === 1 ? '' : 's')
            + ' not recorded</button>';
    }

    /*
     * What was done today outside the plan, and the way to add more. Shown on
     * rest days too — a rest day is exactly when a breathing session happens.
     */
    function extrasBlock() {
        const state = AmsSync.getState();
        const today = AmsSync.todayKey();
        const saved = (state.extras || []).filter((e) => e.dayKey === today);
        const pending = (state.pendingExtras || []).filter((e) => e.date === today);

        const rows = pending.map((e) => ({
            label: AmsExtras.activity(e.activity).label,
            what: e.what,
            minutes: e.minutes,
            pending: true,
            colour: AmsExtras.activity(e.activity).color
        })).concat(saved.map((e) => ({
            label: e.label,
            what: e.what,
            minutes: e.minutes,
            pending: false,
            colour: AmsExtras.activity(e.activity).color
        })));

        return (rows.length
            ? '<div class="day-heading"><h2>Also today</h2></div>'
                + rows.map((r) =>
                    '<div class="card workout-card" style="--sport: ' + r.colour + '">'
                    + '<div class="workout-card-titles">'
                    + '<p class="workout-card-sport">' + esc(r.label) + '</p>'
                    + (r.what ? '<p class="workout-card-title">' + esc(r.what) + '</p>' : '')
                    + '</div>'
                    + '<div class="workout-card-meta">'
                    + (r.minutes ? '<span class="pill strong">' + r.minutes + 'm</span>' : '')
                    + (r.pending ? '<span class="pill pending">Waiting to sync</span>'
                                 : '<span class="pill done">Logged</span>')
                    + '</div></div>').join('')
            : '')
            + '<button class="btn btn-block" data-extra="1" style="margin-top:0.6rem">'
            + '＋ Log something else</button>'
            + '<p class="hint-inline">A walk, a meditation, an unplanned run — anything the plan did not ask for.</p>';
    }

    /*
     * What to call today. The plan's own phase if it has one — "Base 1 —
     * Foundation" tells you where you are in a 48-week build — otherwise what
     * is on, which at least beats repeating the date.
     */
    function todayHeading(sessions) {
        const phase = (sessions.map((w) => w.phase).find(Boolean))
            || (AmsSync.upcoming(3).map((w) => w.phase).find(Boolean))
            || '';
        if (phase) return phase;

        const training = sessions.filter((w) => w.discipline.id !== 'rest');
        if (training.length) {
            const names = [];
            for (const workout of training) {
                if (names.indexOf(workout.discipline.label) === -1) names.push(workout.discipline.label);
            }
            return names.join(' + ');
        }
        if (sessions.length) return 'Rest day';
        return 'Today';
    }

    function emptyState(icon, title, text, action) {
        return '<div class="empty-state">'
            + '<svg class="icon"><use href="#' + icon + '"></use></svg>'
            + '<h2>' + esc(title) + '</h2>'
            + '<p>' + esc(text) + '</p>'
            + (action || '')
            + '</div>';
    }

    /*
     * The sync button says how things stand, and the strip below it only
     * appears when there is something worth spelling out.
     *
     * Previously a full-width bar announced "In step with Dropbox" — the least
     * interesting state there is — directly beneath a button that meant the
     * same thing. Now the button is simply green when everything is through,
     * amber with a count when something is waiting, red when a sync failed,
     * and the strip is reserved for the cases that need words.
     */
    let syncStateToken = 0;

    async function renderSyncState() {
        // This is called from several places at once and has to await the queue
        // count, so two runs can finish out of order and the later-starting one
        // lose. A status light that flickers between states is worse than none.
        const token = ++syncStateToken;

        const state = AmsSync.getState();
        const pending = await AmsDb.queueCount();
        const connected = await AmsDropbox.isConnected();
        if (token !== syncStateToken) return;

        const strip = $('statusStrip');
        const button = $('syncButton');

        let tone = 'synced';
        let message = '';
        let stripTone = '';

        /*
         * Ordered by what most needs saying. A count of waiting entries is
         * worth knowing, but "this is a local file and will never sync on its
         * own" is worth knowing more — and the badge carries the count either
         * way, so nothing is lost by putting words to the rarer case.
         */
        if (state.syncing) {
            tone = 'busy';
        } else if (state.lastError) {
            tone = 'error';
            message = state.lastError;
            stripTone = 'bad';
        } else if (state.source === 'file') {
            tone = 'local';
            message = 'Reading a file from this device — not connected to Dropbox';
            stripTone = 'warn';
        } else if (state.source === 'cache' && connected) {
            tone = 'stale';
            message = 'Showing the last copy saved on this phone';
            stripTone = 'warn';
        } else if (pending > 0) {
            tone = 'pending';
        } else if (!connected) {
            tone = 'local';
        }

        button.className = 'icon-button sync-button is-' + tone + (state.syncing ? ' spinning' : '');
        button.setAttribute('aria-label', {
            synced: 'In step with Dropbox. Tap to sync again.',
            busy: 'Syncing…',
            pending: pending + ' waiting to reach Dropbox. Tap to sync.',
            error: 'Last sync failed. Tap to try again.',
            local: 'Not connected to Dropbox.',
            stale: 'Showing a cached copy. Tap to sync.'
        }[tone] || 'Sync');

        // A count is worth carrying on the button itself; a tick is not.
        const badge = button.querySelector('.sync-badge');
        if (badge) badge.remove();
        if (pending > 0 && !state.syncing) {
            const node = document.createElement('span');
            node.className = 'sync-badge';
            node.textContent = pending > 9 ? '9+' : String(pending);
            button.appendChild(node);
        }

        /*
         * Belt and braces: the attribute, and the inline style that no
         * stylesheet can outrank. The attribute alone was not enough — a
         * class setting `display` beat it, and the strip sat there empty —
         * and an inline style also holds if a phone is still on an older
         * copy of the CSS than of the code.
         */
        if (!message) {
            strip.hidden = true;
            strip.style.display = 'none';
            strip.innerHTML = '';
            return;
        }
        strip.hidden = false;
        strip.style.display = '';
        strip.className = 'status-strip' + (stripTone ? ' ' + stripTone : '');
        strip.innerHTML = '<svg class="icon"><use href="#icon-clock"></use></svg><span>'
            + esc(message) + '</span>';
    }

    /* ---------- plan ---------- */

    function renderPlan() {
        const body = $('planBody');
        const state = AmsSync.getState();

        if (!state.workbook || !AmsMapping.isComplete(state.mapping)) {
            body.innerHTML = emptyState('icon-plan', 'Nothing loaded',
                'Connect your workbook in Settings to see the schedule.',
                '<button class="btn btn-primary" data-go="settings">Open settings</button>');
            return;
        }

        let workouts;
        let outstandingFirst = [];
        if (currentRange === 'upcoming') {
            /*
             * Still to do: dated today or later, and not yet recorded. A logged
             * or missed session has been dealt with and belongs under Done —
             * leaving it here made the two lists overlap and left the tab
             * showing work that no longer needed doing. A session that has only
             * been moved is still outstanding, so it stays.
             */
            const today = AmsSync.todayKey();
            workouts = state.plan.filter((w) => {
                if (w.dayKey < today) return false;
                const status = statusOf(w);
                return !(status && (status.kind === 'logged' || status.kind === 'missed'));
            });
            // Anything from before today that was never recorded is still
            // outstanding, so it leads the list rather than falling between
            // Upcoming and Done and never being seen again.
            outstandingFirst = AmsSync.outstanding();
        } else if (currentRange === 'past') {
            /*
             * "Done" means performed, not merely past and not merely dealt
             * with. Filtering by date meant a session logged today could not
             * appear here at all — it is not in the past — while an untouched
             * session from last month was listed as done. A queued move is not
             * a record of anything, and a session you marked missed is the
             * opposite of one you did: it has its own list.
             */
            workouts = state.plan.filter((w) => {
                const status = statusOf(w);
                return status && status.kind === 'logged';
            }).reverse();
        } else if (currentRange === 'missed') {
            // Kept rather than hidden: what you did not do is part of the
            // record, and any of these can still be opened and logged if it
            // turns out you did it after all.
            workouts = state.plan.filter((w) => {
                const status = statusOf(w);
                return status && status.kind === 'missed';
            }).reverse();
        } else {
            workouts = state.plan.slice();
        }

        const outstandingHtml = outstandingFirst.length
            ? '<div class="day-heading is-outstanding"><h2>Not recorded</h2>'
                + '<span>' + outstandingFirst.length + ' from before today</span></div>'
                + outstandingFirst.map((w) => workoutCard(w, { showDate: true })).join('')
            : '';

        if (!workouts.length && !outstandingFirst.length) {
            body.innerHTML = emptyState('icon-today', 'Nothing here',
                currentRange === 'upcoming'
                    ? 'Nothing left to do from today onwards — everything scheduled has been recorded.'
                    : currentRange === 'past'
                        ? 'Nothing logged yet. Sessions appear here once you log one.'
                        : currentRange === 'missed'
                            ? 'Nothing marked missed. A session you did not do appears here rather than among the ones you did.'
                            : 'This workbook has no sessions.', '');
            return;
        }

        const groups = [];
        let lastKey = null;
        for (const workout of workouts) {
            if (workout.dayKey !== lastKey) {
                groups.push({ dayKey: workout.dayKey, date: workout.date, workouts: [] });
                lastKey = workout.dayKey;
            }
            groups[groups.length - 1].workouts.push(workout);
        }

        const today = AmsSync.todayKey();
        body.innerHTML = outstandingHtml + groups.map((group) => {
            const relative = relativeDay(group.dayKey);
            return '<div class="day-heading' + (group.dayKey === today ? ' is-today' : '') + '">'
                + '<h2>' + esc(longDay(group.date)) + '</h2>'
                + (relative ? '<span>' + esc(relative) + '</span>' : '')
                + '</div>'
                + group.workouts.map((w) => workoutCard(w)).join('');
        }).join('');

    }

    /* ---------- workout detail ---------- */

    function openWorkout(key) {
        const workout = AmsSync.byKey(key);
        if (!workout) return;
        currentWorkout = workout;

        const state = AmsSync.getState();
        $('workoutEyebrow').textContent = longDay(workout.date) + ' · ' + workout.discipline.label;
        $('workoutTitle').textContent = workout.title;

        const planned = AmsPlan.plannedDurationSeconds(workout, state.mapping || {});
        const pills = [];
        if (planned) pills.push('<span class="pill strong">' + esc(AmsPlan.formatDuration(planned)) + ' planned</span>');
        if (workout.planned && workout.planned.distanceRaw) {
            pills.push('<span class="pill">' + esc(formatDistance(workout.planned.distanceRaw, state.mapping)) + '</span>');
        }
        if (workout.planned && workout.planned.intensity) {
            pills.push('<span class="pill">' + esc(workout.planned.intensity) + '</span>');
        }

        const logged = loggedSummary(workout);

        $('workoutBody').innerHTML =
            '<div ' + sportStyle(workout) + '>'
            + (pills.length ? '<div class="workout-card-meta" style="margin-bottom:1rem">' + pills.join('') + '</div>' : '')
            + sectionsHtml(workout)
            // Only worth its own card if it is not already one of the sections
            // above — with no section columns, the description *is* the section.
            + (workout.planned && workout.planned.description
                && !workout.sections.some((s) => s.text === workout.planned.description)
                ? '<div class="card"><p class="section-label">Notes on the plan</p><p class="section-text">'
                    + esc(workout.planned.description) + '</p></div>'
                : '')
            + logged
            + (workout.discipline.id === 'rest' ? ''
                : '<button class="btn btn-block" data-move="' + esc(workout.key) + '" style="margin-top:0.6rem">'
                    + 'Move to another day</button>')
            + '<p class="hint-inline">From <strong>' + esc(workout.sheet) + '</strong>, row ' + workout.row + '.</p>'
            + '</div>';

        const logButton = $('openLogButton');
        const missedButton = $('markMissedButton');
        const isRest = workout.discipline.id === 'rest';
        logButton.hidden = isRest;
        missedButton.hidden = isRest;
        // "Log again" only makes sense if something was actually logged — a
        // session marked missed has nothing to repeat, though it can still be
        // logged if it turns out you did it after all.
        const status = statusOf(workout);
        logButton.textContent = (status && status.kind === 'logged') ? 'Log again' : 'Log this session';
        showScreen('workoutScreen');
    }

    function loggedSummary(workout) {
        const rows = [];
        const state = AmsSync.getState();

        if (workout.pending && workout.pending.values && workout.pending.values.missed) {
            return '<div class="card"><p class="section-label" style="color:var(--color-danger-text)">'
                + 'Marked missed — waiting to sync</p>'
                + (workout.pending.values.notes
                    ? '<p class="section-text">' + esc(workout.pending.values.notes) + '</p>' : '')
                + '</div>';
        }

        if (workout.pending) {
            const values = workout.pending.values || {};
            for (const field of AmsMapping.writableFields(state.mapping || {})) {
                const value = values[field.id];
                if (value !== '' && value !== undefined && value !== null) {
                    rows.push([field.label, value]);
                }
            }
            if (!rows.length) return '';
            return '<div class="card"><p class="section-label" style="color:var(--color-warning)">Logged — waiting to sync</p>'
                + rows.map((r) => '<div class="settings-row"><div class="settings-row-main">'
                    + '<div class="settings-row-sub">' + esc(r[0]) + '</div>'
                    + '<div class="settings-row-title">' + esc(r[1]) + '</div></div></div>').join('')
                + '</div>';
        }

        for (const [id, value] of Object.entries(workout.results || {})) {
            const field = AmsMapping.FIELD_BY_ID.get(id);
            if (field && value.text) rows.push([field.label, value.text]);
        }
        if (!rows.length) return '';

        return '<div class="card"><p class="section-label" style="color:var(--color-success)">Already in the workbook</p>'
            + rows.map((r) => '<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-sub">' + esc(r[0]) + '</div>'
                + '<div class="settings-row-title">' + esc(r[1]) + '</div></div></div>').join('')
            + '</div>';
    }

    /* ---------- the log form ---------- */

    async function openLog(key) {
        const workout = key ? AmsSync.byKey(key) : currentWorkout;
        if (!workout) return;
        currentWorkout = workout;

        const state = AmsSync.getState();
        const groups = AmsPlan.formFields(workout, state.mapping || {});
        // Once you have asked for the full set, you probably want it every time.
        const showAll = await AmsDb.get('log.showAllFields', false);
        const fields = showAll ? groups.all : groups.primary;

        /*
         * Each field is captioned with the column it will be written to. It
         * matters when one column serves two purposes — a heading of
         * "Avg Pace/Pwr" is what tells you to enter watts on the bike and a
         * pace on the run.
         */
        const destinations = {};
        try {
            const sheet = await state.workbook.readSheet(workout.sheet);
            for (const field of fields) {
                const col = state.mapping.columns[field.id];
                if (!col) continue;
                const heading = sheet.textAt(state.mapping.headerRow, col);
                destinations[field.id] = AmsXlsx.indexToCol(col) + (heading ? ' · ' + heading : '');
            }
        } catch (err) { /* captions are a nicety, not a requirement */ }

        $('logEyebrow').textContent = workout.discipline.label + ' · ' + shortDay(workout.date);

        if (!groups.all.length) {
            $('logBody').innerHTML = emptyState('icon-plan', 'Nowhere to write',
                'Your sheet has no columns for results yet — add them in Sheet setup and they will appear here.',
                '<button class="btn btn-primary" data-go="setup">Open sheet setup</button>');
            $('saveLogButton').disabled = true;
            showScreen('logScreen');
            return;
        }

        $('saveLogButton').disabled = false;

        const distanceUnit = AmsPlan.DEFAULT_DISTANCE_UNIT[workout.discipline.id] || 'km';
        const previous = workout.pending ? workout.pending.values : null;
        const plannedSeconds = AmsPlan.plannedDurationSeconds(workout, state.mapping || {});
        const plannedMinutes = plannedSeconds ? plannedSeconds / 60 : 0;

        const html = fields.map((field) => {
            const value = previous && previous[field.id] !== undefined ? previous[field.id] : '';
            // Duration is typed freehand, so showing the column's unit here would
            // read as an instruction to enter decimal hours.
            const unit = field.id === 'actualDistance' ? distanceUnit
                : field.id === 'actualDuration' ? '' : field.unit;
            const label = '<label for="log-' + field.id + '">' + esc(field.label)
                + (unit ? ' <span class="field-unit">(' + esc(unit) + ')</span>' : '') + '</label>';

            if (field.id === 'notes') {
                return '<div class="field">' + label
                    + '<textarea id="log-' + field.id + '" data-field="' + field.id
                    + '" placeholder="How it felt, conditions, anything worth remembering">' + esc(value) + '</textarea></div>';
            }

            const config = inputConfig(field, workout);
            const hints = [];
            if (config.hint) hints.push(config.hint);
            if (destinations[field.id]) hints.push('→ ' + destinations[field.id]);
            return '<div class="field">' + label
                + '<input id="log-' + field.id + '" data-field="' + field.id + '"'
                + ' type="' + config.type + '"' + (config.mode ? ' inputmode="' + config.mode + '"' : '')
                + (config.step ? ' step="' + config.step + '"' : '')
                + ' placeholder="' + esc(config.placeholder) + '" value="' + esc(value) + '">'
                + (hints.length ? '<p class="field-hint">' + esc(hints.join('  ')) + '</p>' : '')
                + '</div>';
        }).join('');

        const hidden = showAll ? 0 : groups.extra.length;

        $('logBody').innerHTML =
            '<div class="card" ' + sportStyle(workout) + '>'
            + '<p class="workout-card-sport">' + esc(workout.discipline.label) + '</p>'
            + '<p class="workout-card-title">' + esc(workout.title) + '</p>'
            + (plannedMinutes ? '<p class="compliance-line" id="complianceLine">'
                + esc(AmsPlan.formatDuration(plannedMinutes * 60)) + ' planned</p>' : '')
            + '</div>'
            + html
            + (hidden
                ? '<button class="btn btn-small btn-block" id="showAllFieldsButton">'
                    + 'Show ' + hidden + ' more field' + (hidden === 1 ? '' : 's') + '</button>'
                    + '<p class="hint-inline">' + esc(groups.extra.map((f) => f.label).join(', ')) + '</p>'
                : '')
            + '<input type="hidden" id="log-distanceUnit" value="' + esc(distanceUnit) + '">'
            + '<p class="hint-inline">Saved into <strong>' + esc(workout.sheet) + '</strong> row ' + workout.row
            + '. Leave anything blank and that cell is left exactly as it is.</p>';

        const showAllButton = $('showAllFieldsButton');
        if (showAllButton) {
            showAllButton.addEventListener('click', async () => {
                await AmsDb.set('log.showAllFields', true);
                const kept = collectLog();
                await openLog(workout.key);
                // Put back anything already typed before the form was rebuilt.
                for (const [id, value] of Object.entries(kept)) {
                    const node = document.getElementById('log-' + id);
                    if (node) node.value = value;
                }
            });
        }

        // Compliance is computed by the sheet, never written by the app — but
        // showing it as you type is the useful half of knowing it.
        const durationInput = $('log-actualDuration');
        if (durationInput && plannedMinutes) {
            const update = () => {
                const seconds = AmsPlan.parseDuration(durationInput.value);
                const line = $('complianceLine');
                if (!line) return;
                line.textContent = seconds
                    ? AmsPlan.formatDuration(plannedMinutes * 60) + ' planned · '
                        + Math.round((seconds / 60) / plannedMinutes * 100) + '% of plan'
                    : AmsPlan.formatDuration(plannedMinutes * 60) + ' planned';
            };
            durationInput.addEventListener('input', update);
            update();
        }

        showScreen('logScreen');
    }

    function inputConfig(field, workout) {
        if (field.id === 'actualDuration') {
            return { type: 'text', mode: 'text', placeholder: 'e.g. 45min, 1:15, 1h20',
                     hint: 'Minutes, h:mm, or "1h 20" — whichever is quicker to type.' };
        }
        if (field.id === 'avgPace') {
            return { type: 'text', mode: 'text',
                     placeholder: workout.discipline.id === 'swim' ? 'e.g. 1:45 per 100m' : 'e.g. 4:52' };
        }
        if (field.id === 'actualDistance') {
            return { type: 'number', mode: 'decimal', step: 'any',
                     placeholder: workout.discipline.id === 'swim' ? 'e.g. 2400' : 'e.g. 12.4' };
        }
        if (field.id === 'rpe') {
            return { type: 'number', mode: 'numeric', step: '1', placeholder: '1 easy — 10 all out' };
        }
        if (field.kind === 'number') {
            return { type: 'number', mode: 'decimal', step: 'any', placeholder: '' };
        }
        return { type: 'text', mode: 'text', placeholder: '' };
    }

    function collectLog() {
        const values = {};
        document.querySelectorAll('#logBody [data-field]').forEach((node) => {
            const value = String(node.value || '').trim();
            if (value) values[node.dataset.field] = value;
        });
        const unit = $('log-distanceUnit');
        if (unit) values.distanceUnit = unit.value;
        return values;
    }

    async function saveLog() {
        if (!currentWorkout) return;
        const values = collectLog();
        const meaningful = Object.keys(values).filter((k) => k !== 'distanceUnit');
        if (!meaningful.length) {
            toast('Nothing to save yet — fill in at least one field.', 'bad');
            return;
        }

        const button = $('saveLogButton');
        button.disabled = true;
        button.textContent = 'Saving…';

        try {
            await AmsSync.logWorkout(currentWorkout, values);
            const connected = await AmsDropbox.isConnected();
            toast(connected ? 'Saved — writing it into the workbook.' : 'Saved on this phone.', 'good');
            goBack();
            // Returning to the workout means returning to a view rendered
            // before the session was logged; re-render it so what was just
            // entered is actually there. showScreen no-ops on the active
            // screen, so this does not disturb the back stack.
            const active = document.querySelector('.screen.active');
            if (active && active.id === 'workoutScreen' && currentWorkout) {
                openWorkout(currentWorkout.key);
            }
            renderToday();
            renderPlan();
        } catch (err) {
            toast(err.message || 'That could not be saved.', 'bad');
        } finally {
            button.disabled = false;
            button.textContent = 'Save to the workbook';
        }
    }

    async function markMissed(key) {
        const workout = key ? AmsSync.byKey(key) : currentWorkout;
        if (!workout) return;

        const mapping = AmsSync.getState().mapping || {};
        if (!mapping.columns || !mapping.columns.done) {
            toast('Your sheet has no column to record that in — add one in Sheet setup.', 'bad');
            return;
        }

        const label = workout.discipline.label + ' on ' + shortDay(workout.date);
        if (!confirm('Mark "' + label + '" as missed?\n\n"' + (mapping.missedValue || 'Missed')
            + '" is written to its completed column. Nothing else is touched.')) return;

        try {
            await AmsSync.markMissed(workout);
            const connected = await AmsDropbox.isConnected();
            toast(connected ? 'Marked missed — writing it into the workbook.' : 'Marked missed.', 'good');
            const active = document.querySelector('.screen.active');
            if (active && active.id === 'workoutScreen') openWorkout(workout.key);
            renderToday();
            renderPlan();
        } catch (err) {
            toast(err.message || 'That could not be saved.', 'bad');
        }
    }

    /* ---------- things the plan did not ask for ---------- */

    let extraDraft = null;

    function openExtra() {
        const state = AmsSync.getState();
        if (!state.workbook) {
            toast('Load a workbook first.', 'bad');
            return;
        }
        extraDraft = Object.assign({
            date: AmsSync.todayKey(),
            activity: 'walk',
            what: '',
            duration: '',
            distance: '',
            avgHr: '',
            effort: '',
            notes: ''
        }, extraDraft && extraDraft.keep ? extraDraft : {});
        extraDraft.keep = false;
        renderExtra();
        showScreen('extraScreen');
    }

    function renderExtra() {
        const chosen = AmsExtras.activity(extraDraft.activity);
        const metrics = AmsExtras.wantsMetrics(extraDraft.activity);
        const isTraining = extraDraft.isTraining === undefined
            ? chosen.kind === 'training'
            : extraDraft.isTraining;

        const options = AmsExtras.getActivities().map((a) =>
            '<option value="' + a.id + '"' + (a.id === extraDraft.activity ? ' selected' : '') + '>'
            + esc(a.label) + '</option>').join('');

        $('extraBody').innerHTML =
            '<div class="prose"><p>Recorded on its own <strong>Extras</strong> sheet, never in the training '
            + 'plan — so your planned-versus-actual figures keep meaning what they say.</p></div>'

            + '<div class="field"><label for="extraActivity">What was it</label>'
            + '<select id="extraActivity">' + options + '</select></div>'

            + '<div class="field"><label for="extraDate">When</label>'
            + '<input id="extraDate" type="date" value="' + esc(extraDraft.date) + '"></div>'

            + '<div class="field"><label for="extraWhat">Describe it <span class="field-unit">(optional)</span></label>'
            + '<input id="extraWhat" type="text" placeholder="e.g. morning sit, breath focus" value="'
            + esc(extraDraft.what) + '"></div>'

            + '<div class="field"><label for="extraDuration">Duration</label>'
            + '<input id="extraDuration" type="text" placeholder="e.g. 20min, 1:15" value="'
            + esc(extraDraft.duration) + '"></div>'

            + (metrics
                ? '<div class="field"><label for="extraDistance">Distance <span class="field-unit">(km)</span></label>'
                    + '<input id="extraDistance" type="number" inputmode="decimal" step="any" value="'
                    + esc(extraDraft.distance) + '"></div>'
                    + '<div class="field-row">'
                    + '<div class="field"><label for="extraAvgHr">Avg HR <span class="field-unit">(bpm)</span></label>'
                    + '<input id="extraAvgHr" type="number" inputmode="numeric" value="' + esc(extraDraft.avgHr) + '"></div>'
                    + '<div class="field"><label for="extraEffort">Effort <span class="field-unit">(1-10)</span></label>'
                    + '<input id="extraEffort" type="number" inputmode="numeric" value="' + esc(extraDraft.effort) + '"></div>'
                    + '</div>'
                : '')

            + '<div class="field"><label for="extraIsTraining">Counts as training load</label>'
            + '<select id="extraIsTraining">'
            + '<option value="no"' + (isTraining ? '' : ' selected') + '>No — it does not add load</option>'
            + '<option value="yes"' + (isTraining ? ' selected' : '') + '>Yes — count it as training</option>'
            + '</select>'
            + '<p class="field-hint">Set from what you picked, and yours to change — a four-hour hike is load '
            + 'whatever the app assumes.</p></div>'

            + '<div class="field"><label for="extraNotes">Notes <span class="field-unit">(optional)</span></label>'
            + '<textarea id="extraNotes" placeholder="How it felt, anything worth remembering">'
            + esc(extraDraft.notes) + '</textarea></div>';

        $('extraActivity').addEventListener('change', (event) => {
            collectExtra();
            extraDraft.activity = event.target.value;
            // The default follows the kind until you say otherwise.
            extraDraft.isTraining = AmsExtras.activity(extraDraft.activity).kind === 'training';
            renderExtra();
        });
    }

    function collectExtra() {
        const value = (id) => {
            const node = $(id);
            return node ? String(node.value || '').trim() : '';
        };
        extraDraft.date = value('extraDate') || extraDraft.date;
        extraDraft.what = value('extraWhat');
        extraDraft.duration = value('extraDuration');
        extraDraft.distance = value('extraDistance');
        extraDraft.avgHr = value('extraAvgHr');
        extraDraft.effort = value('extraEffort');
        extraDraft.notes = value('extraNotes');
        const training = $('extraIsTraining');
        if (training) extraDraft.isTraining = training.value === 'yes';
        return extraDraft;
    }

    async function saveExtra() {
        collectExtra();

        const seconds = AmsPlan.parseDuration(extraDraft.duration);
        if (!seconds && !extraDraft.what && !extraDraft.notes) {
            toast('Give it at least a duration or a description.', 'bad');
            return;
        }

        const button = $('saveExtraButton');
        button.disabled = true;
        button.textContent = 'Saving…';

        const toNumber = (text) => {
            if (text === '' || text === undefined) return null;
            const n = parseFloat(String(text).replace(',', '.'));
            return isNaN(n) ? null : n;
        };

        try {
            await AmsSync.logExtra({
                date: extraDraft.date,
                activity: extraDraft.activity,
                what: extraDraft.what,
                minutes: seconds ? Math.round(seconds / 60) : null,
                distance: toNumber(extraDraft.distance),
                avgHr: toNumber(extraDraft.avgHr),
                effort: toNumber(extraDraft.effort),
                isTraining: !!extraDraft.isTraining,
                notes: extraDraft.notes
            });
            const connected = await AmsDropbox.isConnected();
            toast(connected ? 'Saved — writing it to the Extras sheet.' : 'Saved on this phone.', 'good');
            extraDraft = null;
            goBack();
            renderToday();
        } catch (err) {
            toast(err.message || 'That could not be saved.', 'bad');
        } finally {
            button.disabled = false;
            button.textContent = 'Save it';
        }
    }

    /* ---------- rescheduling ---------- */

    let rescheduleTarget = null;

    /*
     * Two ways to move a session, because there are two situations. Either it
     * simply happens on a different day (move it), or you did today's other
     * session instead and the two want exchanging (swap them). A swap keeps the
     * week's shape intact, which is usually what a training plan wants.
     */
    function openReschedule(key) {
        const workout = key ? AmsSync.byKey(key) : currentWorkout;
        if (!workout) return;
        rescheduleTarget = workout;

        const state = AmsSync.getState();
        if (!state.mapping || !state.mapping.columns.date) {
            toast('The date column is not mapped, so sessions cannot be moved.', 'bad');
            return;
        }

        $('rescheduleEyebrow').textContent = workout.discipline.label + ' · ' + shortDay(workout.date);

        // Candidates to swap with: nearby sessions, nearest first.
        const here = Date.parse(workout.dayKey + 'T00:00:00Z');
        const nearby = state.plan
            .filter((w) => w.key !== workout.key && w.discipline.id !== 'rest')
            .map((w) => ({ w: w, gap: Math.round((Date.parse(w.dayKey + 'T00:00:00Z') - here) / 86400000) }))
            .filter((c) => Math.abs(c.gap) <= 10)
            .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap) || a.gap - b.gap)
            .slice(0, 12);

        $('rescheduleBody').innerHTML =
            '<div class="card workout-card" ' + sportStyle(workout) + '>'
            + '<p class="workout-card-sport">' + esc(workout.discipline.label) + '</p>'
            + '<p class="workout-card-title">' + esc(workout.title) + '</p>'
            + '<div class="workout-card-meta"><span class="pill">' + esc(longDay(workout.date)) + '</span></div>'
            + '</div>'

            + '<div class="settings-group"><h2>Move it to</h2>'
            + '<div class="field"><label for="moveToDate">New day</label>'
            + '<input id="moveToDate" type="date" value="' + esc(workout.dayKey) + '"></div>'
            + '<button class="btn btn-primary btn-block" id="doMoveButton">Move the session</button>'
            + '<p class="hint-inline">Only the date is rewritten. The session keeps its place in every weekly '
            + 'total, because your sheet counts by week number and sport, never by date.</p>'
            + '</div>'

            + (nearby.length
                ? '<div class="settings-group"><h2>Or swap it with</h2>'
                    + '<div class="prose"><p>Exchanges the two days — for when you did one session in the '
                    + 'other’s place.</p></div>'
                    + nearby.map((c) =>
                        '<button class="file-option" data-swap="' + esc(c.w.key) + '">'
                        + esc(c.w.discipline.label) + ' — ' + esc(c.w.title.slice(0, 46))
                        + '<small>' + esc(shortDay(c.w.date))
                        + (c.gap === 0 ? ' · same day' : c.gap > 0 ? ' · in ' + c.gap + ' day' + (c.gap === 1 ? '' : 's')
                            : ' · ' + (-c.gap) + ' day' + (c.gap === -1 ? '' : 's') + ' ago')
                        + '</small></button>').join('')
                    + '</div>'
                : '');

        $('doMoveButton').addEventListener('click', doMove);
        showScreen('rescheduleScreen');
    }

    async function doMove() {
        if (!rescheduleTarget) return;
        const value = $('moveToDate').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            toast('Pick a day first.', 'bad');
            return;
        }
        if (value === rescheduleTarget.dayKey) {
            toast('That is the day it is already on.', 'bad');
            return;
        }

        const button = $('doMoveButton');
        button.disabled = true;
        try {
            await AmsSync.rescheduleWorkout(rescheduleTarget, value);
            toast('Moved to ' + longDay(AmsPlan.parseDayKey(value)) + '.', 'good');
            afterReschedule();
        } catch (err) {
            toast(err.message || 'That could not be moved.', 'bad');
        } finally {
            button.disabled = false;
        }
    }

    async function doSwap(otherKey) {
        const other = AmsSync.byKey(otherKey);
        if (!rescheduleTarget || !other) return;

        if (!confirm('Swap these two?\n\n' + rescheduleTarget.discipline.label + ' \u2192 '
            + shortDay(other.date) + '\n' + other.discipline.label + ' \u2192 '
            + shortDay(rescheduleTarget.date))) return;

        try {
            await AmsSync.swapWorkouts(rescheduleTarget, other);
            toast('Swapped.', 'good');
            afterReschedule();
        } catch (err) {
            toast(err.message || 'That could not be swapped.', 'bad');
        }
    }

    function afterReschedule() {
        goBack();
        renderToday();
        renderPlan();
        const active = document.querySelector('.screen.active');
        if (active && active.id === 'workoutScreen' && rescheduleTarget) {
            const refreshed = AmsSync.byKey(rescheduleTarget.key);
            if (refreshed) openWorkout(refreshed.key);
        }
    }

    /* ---------- settings ---------- */

    async function renderSettings() {
        const body = $('settingsBody');
        const state = AmsSync.getState();
        const connected = await AmsDropbox.isConnected();
        const account = await AmsDropbox.account();
        const appKey = await AmsDb.get(AmsDropbox.KEY_APP, '');
        const path = await AmsSync.filePath();
        const name = await AmsDb.get('workbook.name', '');
        const pending = await AmsDb.queueCount();

        const parts = [];
        const hasWorkbook = !!state.workbook;

        /*
         * Ordered by how often a person actually needs the thing, not by how
         * the app is built.
         *
         * What you came to look at goes first — is everything through, what
         * am I reading. What you set once and never touch again is folded away
         * at the bottom, where a mis-tap cannot disconnect Dropbox, rewrite
         * the sheet layout, or wipe the phone’s copy.
         */

        /* --- connecting: first, and only until it is done --- */
        if (!connected) {
            parts.push('<div class="settings-group"><h2>Dropbox</h2>');
            parts.push(
                '<div class="prose">'
                + '<p>The app talks to Dropbox directly from your phone. To allow that, Dropbox needs to know this app exists — a one-off, two-minute job:</p>'
                + '<ol>'
                + '<li>Open <code>dropbox.com/developers/apps</code> and choose <strong>Create app</strong>.</li>'
                + '<li>Pick <strong>Scoped access</strong>, then <strong>Full Dropbox</strong> (or App folder, if you move the workbook into it).</li>'
                + '<li>On the <strong>Permissions</strong> tab tick <code>files.metadata.read</code>, <code>files.content.read</code> and <code>files.content.write</code>, then submit.</li>'
                + '<li>Still on <strong>Settings</strong>, find <strong>OAuth 2 → Redirect URIs</strong>. Paste this in '
                + 'and press the <strong>Add</strong> button beside it — typing it alone does not register it. '
                + 'It has to match exactly, trailing slash included:'
                + '<button type="button" class="copy-field" id="copyRedirect">'
                +   '<code>' + esc(AmsDropbox.redirectUri()) + '</code>'
                +   '<span class="copy-field-hint">Tap to copy</span>'
                + '</button></li>'
                + '<li>Copy the <strong>App key</strong> and paste it below.</li>'
                + '</ol>'
                + '<p>The app key is public by design — there is no secret to leak, and your Dropbox tokens never leave this phone.</p>'
                + '</div>'
                + '<div class="field"><label for="appKeyInput">Dropbox app key</label>'
                + '<input id="appKeyInput" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" '
                + 'placeholder="abcd1234efgh567" value="' + esc(appKey) + '"></div>'
                + '<button class="btn btn-primary btn-block" id="connectDropbox">Connect Dropbox</button>');
            parts.push('</div>');
        }

        /* --- syncing: the thing worth opening this tab to check --- */
        if (hasWorkbook) {
            parts.push('<div class="settings-group"><h2>Syncing</h2>');
            parts.push('<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-title">' + (pending ? pending + ' waiting' : 'Nothing waiting') + '</div>'
                + '<div class="settings-row-sub">'
                + (pending
                    ? 'Logged on this phone but not yet written into the workbook.'
                    : 'Every logged session has reached the workbook.')
                + '</div></div>'
                + '<button class="btn btn-small" id="syncNowButton">Sync now</button></div>');
            if (pending) {
                parts.push('<div class="settings-row"><div class="settings-row-main">'
                    + '<div class="settings-row-title">See what is waiting</div>'
                    + '<div class="settings-row-sub">Inspect each entry, and discard one that will not go through</div>'
                    + '</div><button class="btn btn-small" data-go="queue">Review</button></div>');
            }
            if (state.meta && state.meta.modified) {
                parts.push('<div class="settings-row"><div class="settings-row-main">'
                    + '<div class="settings-row-title">Last read from Dropbox</div>'
                    + '<div class="settings-row-sub">' + esc(new Date(state.meta.modified).toLocaleString()) + '</div>'
                    + '</div></div>');
            }
            parts.push('</div>');
        }

        /*
         * Not at the bottom, where an About section conventionally goes. It is
         * read more often than the workbook is changed, and far more often than
         * anything below it, so it sits where that is true.
         */
        parts.push('<div class="settings-group"><h2>Help and updates</h2>'
            + '<div class="settings-row"><div class="settings-row-main">'
            + '<div class="settings-row-title">How this works</div>'
            + '<div class="settings-row-sub">What the app reads, what it writes, and what it will never touch</div>'
            + '</div><button class="btn btn-small" data-go="guide">Read</button></div>'
            + '<div class="settings-row"><div class="settings-row-main">'
            + '<div class="settings-row-title">Version ' + esc(AmsVersion.CURRENT) + '</div>'
            + '<div class="settings-row-sub">' + esc(AmsVersion.CHANGELOG[0].headline) + '</div>'
            + '</div><button class="btn btn-small" data-go="version">What’s new</button></div></div>');

        /* --- what can be logged outside the plan --- */
        parts.push('<div class="settings-group"><h2>Log something else</h2>'
            + '<div class="settings-row"><div class="settings-row-main">'
            + '<div class="settings-row-title">Activities</div>'
            + '<div class="settings-row-sub">'
            + esc(AmsExtras.getActivities().slice(0, 4).map((a) => a.label).join(', '))
            + ' and ' + (AmsExtras.getActivities().length - 4) + ' more</div>'
            + '</div><button class="btn btn-small" data-go="activities">Edit</button></div></div>');

        /* --- which workbook this is --- */
        parts.push('<div class="settings-group"><h2>Workbook</h2>');
        if (path || name) {
            parts.push('<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-title">' + esc(name || 'Workbook') + '</div>'
                + '<div class="settings-row-sub">' + esc(path || 'Opened from this device') + '</div>'
                + '</div></div>');
        } else {
            parts.push('<p class="hint-inline">Nothing loaded yet.</p>');
        }
        parts.push('<div class="button-row" style="margin-top:0.5rem">'
            // Opening a local file is the whole path in without Dropbox, and a
            // rarity with it — so it sits here until connecting makes it rare.
            + (connected ? '' : '<button class="btn btn-small" id="openLocalButton">Open a file</button>')
            + '<button class="btn btn-small" id="exportButton">Save a copy</button></div>');
        if (!connected) {
            parts.push('<p class="hint-inline">No Dropbox? You can still open a copy from this device — you will just have to save the updated file back yourself.</p>');
        }
        // Always in the page, whether or not its button is: it is invisible,
        // and the button that opens it moves about.
        parts.push('<input type="file" id="localFileInput" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');
        parts.push('</div>');

        /*
         * Everything below is either set once or not to be tapped by accident.
         * Folded shut, and shut again every time Settings is opened.
         */
        parts.push('<div class="settings-group settings-fold' + (settingsFoldOpen ? ' is-open' : '') + '">'
            + '<button type="button" class="settings-fold-head" data-settings-fold'
            + ' aria-expanded="' + (settingsFoldOpen ? 'true' : 'false') + '">'
            + '<span class="settings-fold-text">'
            + '<span class="settings-fold-title">Setup and connection</span>'
            + '<span class="settings-fold-sub">The sheet layout, which file to read, disconnecting</span>'
            + '</span>'
            + '<svg class="icon settings-fold-chevron"><use href="#icon-back"></use></svg>'
            + '</button>');

        if (settingsFoldOpen) {
            parts.push('<div class="settings-fold-body">');

            /* the sheet layout */
            if (hasWorkbook) {
                const mapping = state.mapping;
                const mapped = mapping ? AmsMapping.writableFields(mapping).length : 0;
                parts.push('<div class="settings-row"><div class="settings-row-main">'
                    + '<div class="settings-row-title">'
                    + (AmsMapping.isComplete(mapping) ? esc(mapping.sheets.join(', ')) : 'Not worked out yet')
                    + '</div><div class="settings-row-sub">'
                    + (AmsMapping.isComplete(mapping)
                        ? 'Header on row ' + mapping.headerRow + ' · ' + state.plan.length + ' sessions · '
                            + mapped + ' result column' + (mapped === 1 ? '' : 's')
                        : 'Tell the app which column is which')
                    + '</div></div>'
                    + '<button class="btn btn-small" data-go="setup">Set up</button></div>');
            } else {
                parts.push('<p class="hint-inline">Load a workbook first.</p>');
            }

            /* which file */
            if (connected) {
                parts.push('<div class="button-row" style="margin-top:0.6rem">'
                    + '<button class="btn btn-small" id="pickFileButton">'
                    + (path ? 'Choose a different file' : 'Choose the workbook in Dropbox') + '</button>'
                    + '<button class="btn btn-small" id="openLocalButton">Open a file</button></div>');
                parts.push('<div class="file-list" id="fileList"></div>');

                parts.push('<div class="settings-row" style="margin-top:0.6rem"><div class="settings-row-main">'
                    + '<div class="settings-row-title">Connected</div>'
                    + '<div class="settings-row-sub">'
                    + esc(account && (account.name || account.email) || 'Dropbox account')
                    + '</div></div>'
                    + '<button class="btn btn-small btn-danger" id="disconnectDropbox">Disconnect</button></div>');
            }

            parts.push('<div class="button-row" style="margin-top:0.6rem">'
                + '<button class="btn btn-small btn-danger" id="resetButton">Reset the app</button></div>'
                + '<p class="hint-inline">Resetting clears the Dropbox connection, the cached workbook and the saved layout from this phone. Your workbook in Dropbox is not touched.</p>');

            parts.push('</div>');
        }
        parts.push('</div>');

        body.innerHTML = parts.join('');
        wireSettings();
    }

    function wireSettings() {
        const connect = $('connectDropbox');
        if (connect) {
            connect.addEventListener('click', async () => {
                const key = String($('appKeyInput').value || '').trim();
                if (!key) { toast('Paste your Dropbox app key first.', 'bad'); return; }
                await AmsDb.set(AmsDropbox.KEY_APP, key);
                try {
                    await AmsDropbox.beginAuth();
                } catch (err) {
                    toast(err.message, 'bad');
                }
            });
        }

        // Copying beats retyping: an exact-match redirect URI is the single
        // easiest thing to get wrong in the whole Dropbox setup.
        const copyRedirect = $('copyRedirect');
        if (copyRedirect) {
            copyRedirect.addEventListener('click', async () => {
                const uri = AmsDropbox.redirectUri();
                try {
                    await navigator.clipboard.writeText(uri);
                    toast('Redirect URI copied — paste it into Dropbox and press Add.', 'good');
                } catch (err) {
                    // Clipboard access is refused in some in-app browsers; select
                    // the text instead so it can be copied by hand.
                    const range = document.createRange();
                    range.selectNodeContents(copyRedirect.querySelector('code'));
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    toast('Selected — copy it with a long press.', 'bad');
                }
            });
        }

        const disconnect = $('disconnectDropbox');
        if (disconnect) {
            disconnect.addEventListener('click', async () => {
                // Cheap to undo, but it stops the plan reaching the phone until
                // you have signed in again — worth one question.
                if (!confirm('Disconnect Dropbox? Anything already logged stays on this phone, but nothing will sync until you connect again.')) return;
                await AmsDropbox.disconnect();
                toast('Dropbox disconnected.');
                renderSettings();
            });
        }

        const pick = $('pickFileButton');
        if (pick) {
            pick.addEventListener('click', async () => {
                const list = $('fileList');
                list.innerHTML = '<div class="loading-block"><span class="spinner"></span> Looking for spreadsheets…</div>';
                try {
                    dropboxFiles = await AmsDropbox.findWorkbooks('xlsx');
                    if (!dropboxFiles.length) {
                        list.innerHTML = '<p class="hint-inline">No .xlsx files found in your Dropbox.</p>';
                        return;
                    }
                    const current = await AmsSync.filePath();
                    list.innerHTML = dropboxFiles.map((file, index) =>
                        '<button class="file-option' + (file.path === current ? ' selected' : '')
                        + '" data-file="' + index + '">' + esc(file.name)
                        + '<small>' + esc(file.display || file.path) + '</small></button>').join('');
                } catch (err) {
                    list.innerHTML = '<p class="hint-inline">' + esc(err.message) + '</p>';
                }
            });
        }

        const list = $('fileList');
        if (list) {
            list.addEventListener('click', async (event) => {
                const button = event.target.closest('[data-file]');
                if (!button || !dropboxFiles) return;
                const file = dropboxFiles[parseInt(button.dataset.file, 10)];
                if (!file) return;
                await AmsSync.setFile(file);
                toast('Reading ' + file.name + '…');
                await AmsSync.load();
                renderSettings();
                renderToday();
                renderPlan();
            });
        }

        const openLocal = $('openLocalButton');
        if (openLocal) openLocal.addEventListener('click', () => $('localFileInput').click());

        const input = $('localFileInput');
        if (input) {
            input.addEventListener('change', async (event) => {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                try {
                    await AmsSync.loadFromFile(file);
                    toast('Workbook opened.', 'good');
                    renderSettings();
                    renderToday();
                    renderPlan();
                } catch (err) {
                    toast(err.message, 'bad');
                }
                input.value = '';
            });
        }

        const exportButton = $('exportButton');
        if (exportButton) {
            exportButton.addEventListener('click', async () => {
                try {
                    const result = await AmsSync.exportWorkbook();
                    const url = URL.createObjectURL(result.blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = result.name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                    toast(result.applied
                        ? result.applied + ' logged session' + (result.applied === 1 ? '' : 's') + ' written into the copy.'
                        : 'Copy saved.', 'good');
                } catch (err) {
                    toast(err.message, 'bad');
                }
            });
        }

        const syncNow = $('syncNowButton');
        if (syncNow) syncNow.addEventListener('click', () => runSync(true));

        const reset = $('resetButton');
        if (reset) {
            reset.addEventListener('click', async () => {
                if (!confirm('Clear the Dropbox connection, the cached workbook and the saved layout from this phone?')) return;
                await AmsDb.reset();
                location.reload();
            });
        }
    }

    /* ---------- the activity list ---------- */

    const KIND_LABEL = { training: 'Training', restorative: 'Restorative', everyday: 'Everyday' };

    /*
     * The list of things you can log outside the plan is yours, not mine. What
     * a person actually does — padel, sauna, walking the dog — is not something
     * a default list can know, and a list you cannot change is one you end up
     * working around.
     */
    function renderActivities() {
        const list = AmsExtras.getActivities();

        $('activitiesBody').innerHTML =
            '<div class="prose"><p>These are the choices offered by <strong>Log something else</strong>. '
            + 'The kind decides whether distance and heart rate are asked for, and whether it starts out '
            + 'counting as training load — both still changeable on the form itself.</p></div>'

            + '<div class="settings-group">'
            + list.map((item, index) =>
                '<div class="activity-row" style="--sport: ' + item.color + '">'
                + '<span class="activity-dot"></span>'
                + '<div class="activity-main">'
                + '<div class="activity-label">' + esc(item.label) + '</div>'
                + '<div class="activity-kind">' + esc(KIND_LABEL[item.kind] || item.kind) + '</div>'
                + '</div>'
                + '<button class="activity-move" data-move-activity="up:' + index + '"'
                + (index === 0 ? ' disabled' : '') + ' aria-label="Move up">&#9650;</button>'
                + '<button class="activity-move" data-move-activity="down:' + index + '"'
                + (index === list.length - 1 ? ' disabled' : '') + ' aria-label="Move down">&#9660;</button>'
                + '<button class="activity-delete" data-delete-activity="' + index + '"'
                + ' aria-label="Delete ' + esc(item.label) + '">&times;</button>'
                + '</div>').join('')
            + '</div>'

            + '<div class="settings-group"><h2>Add one</h2>'
            + '<div class="field"><label for="newActivityLabel">Name</label>'
            + '<input id="newActivityLabel" type="text" placeholder="e.g. Padel, Sauna, Dog walk"></div>'
            + '<div class="field"><label for="newActivityKind">Kind</label>'
            + '<select id="newActivityKind">'
            + '<option value="training">Training — counts as load, asks for distance and HR</option>'
            + '<option value="everyday" selected>Everyday — asks for distance and HR, no load by default</option>'
            + '<option value="restorative">Restorative — duration and notes only</option>'
            + '</select></div>'
            + '<button class="btn btn-primary btn-block" id="addActivityButton">Add to the list</button>'
            + '</div>'

            + '<div class="settings-group">'
            + '<button class="btn btn-small btn-danger btn-block" id="resetActivitiesButton">'
            + 'Restore the original list</button>'
            + '<p class="hint-inline">Anything already written to the Extras sheet keeps the name it was '
            + 'logged under — this list only decides what you are offered next time.</p>'
            + '</div>';

        $('addActivityButton').addEventListener('click', addActivity);
        $('resetActivitiesButton').addEventListener('click', async () => {
            if (!confirm('Restore the original list of activities?')) return;
            await AmsExtras.resetActivities();
            toast('Original list restored.');
            renderActivities();
        });
    }

    async function addActivity() {
        const label = String($('newActivityLabel').value || '').trim();
        if (!label) { toast('Give it a name first.', 'bad'); return; }

        const list = AmsExtras.getActivities().slice();
        if (list.some((a) => AmsMapping.normalise(a.label) === AmsMapping.normalise(label))) {
            toast('That is already on the list.', 'bad');
            return;
        }

        list.push({
            id: AmsExtras.idFor(label, list),
            label: label,
            kind: $('newActivityKind').value
        });
        await AmsExtras.saveActivities(list);
        toast('Added ' + label + '.', 'good');
        renderActivities();
    }

    async function moveActivity(instruction) {
        const [direction, indexText] = instruction.split(':');
        const index = parseInt(indexText, 10);
        const list = AmsExtras.getActivities().slice();
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= list.length) return;

        const moved = list.splice(index, 1)[0];
        list.splice(target, 0, moved);
        await AmsExtras.saveActivities(list);
        renderActivities();
    }

    async function deleteActivity(indexText) {
        const index = parseInt(indexText, 10);
        const list = AmsExtras.getActivities().slice();
        const item = list[index];
        if (!item) return;
        if (list.length === 1) { toast('Keep at least one.', 'bad'); return; }
        if (!confirm('Remove "' + item.label + '" from the list?')) return;

        list.splice(index, 1);
        await AmsExtras.saveActivities(list);
        toast('Removed ' + item.label + '.');
        renderActivities();
    }

    /* ---------- what is waiting to sync ---------- */

    /* Say what an entry actually is, in the terms it was created in. */
    function describeEntry(entry) {
        const values = entry.values || {};

        if (entry.extra) {
            const extra = values.extra || {};
            const label = AmsExtras.activity(extra.activity).label;
            return {
                title: label + (extra.what ? ' — ' + extra.what : ''),
                detail: (extra.minutes ? extra.minutes + ' min · ' : '') + (extra.date || '')
            };
        }
        if (values.moveTo) {
            return { title: 'Move: ' + (entry.title || 'a session'), detail: 'to ' + values.moveTo };
        }
        if (values.missed) {
            return { title: 'Missed: ' + (entry.title || 'a session'), detail: entry.dayKey || '' };
        }

        const numbers = Object.keys(values)
            .filter((k) => k !== 'distanceUnit' && values[k] !== '' && values[k] !== null)
            .map((k) => {
                const field = AmsMapping.FIELD_BY_ID.get(k);
                return (field ? field.label : k) + ' ' + values[k];
            });
        return {
            title: 'Logged: ' + (entry.title || 'a session'),
            detail: (entry.dayKey || '') + (numbers.length ? ' · ' + numbers.join(', ') : '')
        };
    }

    async function renderQueue() {
        const queued = await AmsDb.listQueue();
        const body = $('queueBody');

        if (!queued.length) {
            body.innerHTML = emptyState('icon-check', 'Nothing waiting',
                'Everything you have logged has reached the workbook.', '');
            return;
        }

        body.innerHTML =
            '<div class="prose"><p>These are saved on this phone but not yet written into the workbook. '
            + 'They are replayed onto the current file each time the app syncs — nothing is lost by waiting.</p></div>'
            + queued.map((entry) => {
                const described = describeEntry(entry);
                const when = new Date(entry.createdAt);
                return '<div class="card queue-item">'
                    + '<div class="queue-item-main">'
                    + '<p class="workout-card-title">' + esc(described.title) + '</p>'
                    + '<p class="map-row-sub">' + esc(described.detail) + '</p>'
                    + '<p class="map-row-sub">saved ' + esc(when.toLocaleString()) + '</p>'
                    + (entry.attempts
                        ? '<p class="queue-error">Tried ' + entry.attempts + ' time'
                            + (entry.attempts === 1 ? '' : 's')
                            + (entry.lastError ? ': ' + esc(entry.lastError) : '') + '</p>'
                        : '')
                    + '</div>'
                    + '<button class="btn btn-small btn-danger" data-drop="' + esc(entry.id) + '">Discard</button>'
                    + '</div>';
            }).join('');
    }

    async function dropQueued(id) {
        if (!confirm('Discard this entry?\n\nIt will never be written to the workbook. This cannot be undone.')) return;
        await AmsDb.unqueue(id);
        await AmsSync.overlayQueue();
        toast('Discarded.');
        await renderQueue();
        renderToday();
        renderPlan();
        renderSettings();
    }

    /* ---------- the guide, and the version log ---------- */

    function section(title, body) {
        return '<details class="guide-section"><summary>' + esc(title) + '</summary>'
            + '<div class="prose">' + body + '</div></details>';
    }

    function renderGuide() {
        const state = AmsSync.getState();
        const mapping = state.mapping || {};
        const sheet = AmsMapping.isComplete(mapping) ? mapping.sheets.join(', ') : null;
        const units = mapping.units || {};

        $('guideBody').innerHTML =
            '<div class="prose"><p>The short version: your Excel workbook stays the source of truth. '
            + 'This app reads today’s session out of it, and writes what you did back into the same cells '
            + 'your totals and charts already point at. It never keeps a copy of your training anywhere else.</p></div>'

            + section('The three tabs',
                '<p><strong>Today</strong> — what is planned for today, broken into warm-up, intervals, '
                + 'technique and cool-down, plus anything you did that was not planned. The share button on '
                + 'the week card asks which week you mean, and whether to send it as a message or add '
                + 'it to a calendar. A message goes as plain text — a message anyone can read, no app and '
                + 'no workbook needed at the other end. The calendar version is an ordinary .ics file, '
                + 'one event per session, starting at 06:00 and running as long as the session is '
                + 'planned to. Where a day holds two sessions the second follows the first rather than '
                + 'sitting on top of it. No reminders are set: a phone that pinged before every session '
                + 'of a 48-week plan would be silenced inside a week. Rest days go in as all-day entries '
                + '— when you are free is as much use to somebody as when you are training.</p>'
                + '<p><strong>Plan</strong> — the whole schedule, in four lists. <em>Upcoming</em> is what is '
                + 'still to do, and leads with anything from before today that was never recorded. '
                + '<em>Done</em> is what you performed. <em>Missed</em> is what you marked as not done, kept '
                + 'apart from the sessions you did and still open to log if it turns out you did it. '
                + '<em>All</em> is everything.</p>'
                + '<p><strong>Settings</strong> — the Dropbox connection, which workbook to use, and how its '
                + 'columns are read.</p>')

            + section('How it reads your plan',
                '<p>On first use the app looks at your headings and works out which column holds the date, '
                + 'which the sport, which the planned duration, and which are for results. It understands '
                + 'English and German headings, and copes with the heading row being anywhere near the top.</p>'
                + '<p>The guess is shown on <strong>Sheet setup</strong> for you to correct. It is asked once '
                + 'and then remembered.</p>'
                + (sheet ? '<p>Right now it is reading <strong>' + esc(sheet) + '</strong>, heading row '
                    + mapping.headerRow + '.</p>' : ''))

            + section('How it writes — and what it will not touch',
                '<p>An <code>.xlsx</code> is a zip of XML parts. Rather than rebuild your workbook, the app '
                + 'rewrites only the cells you filled in and copies every other part across untouched. In '
                + 'testing, logging a session changed one part of a nineteen-part file.</p>'
                + '<p>So charts, conditional formatting, column widths, number formats and the formulas in '
                + 'columns you are not logging into all survive. A cell you log into that held a formula '
                + 'loses it — a stale formula would recompute over your value — and Excel is asked to '
                + 'recalculate on open, so weekly totals and the figures your charts are drawn from update '
                + 'the moment you open the file.</p>'
                + '<p>Columns your sheet computes for itself are never offered as inputs. A compliance column '
                + 'is a formula; writing a number into it would stop it tracking anything.</p>')

            + section('Units, and the completed marker',
                '<p>Duration columns differ: some hold decimal hours, some minutes, some real Excel times. '
                + 'The app reads the unit from the heading where it says so — “Duration (min)” — and otherwise '
                + 'infers it from what is already in the column. Getting this wrong would corrupt every total, '
                + 'so it is also settable by hand in Sheet setup.</p>'
                + '<p>The same goes for the completed column. A plan that counts its sessions with '
                + '<code>COUNTIFS(…,"✓")</code> needs exactly that character — “Yes” would leave the tally at '
                + 'zero — so the app reads your own formulas to find out what to write.</p>'
                + (units.duration ? '<p>This workbook stores durations in <strong>' + esc(units.duration)
                    + '</strong> and distances in <strong>' + esc(units.distance || 'km') + '</strong>'
                    + (mapping.doneValue ? ', and marks a session complete with <strong>'
                        + esc(mapping.doneValue) + '</strong>' : '') + '.</p>' : ''))

            + section('Logging, missing, moving',
                '<p><strong>Log</strong> asks first for the numbers that suit the sport; every other column '
                + 'your sheet has is one tap away, and once you ask for the full set it keeps showing it. '
                + 'Anything left blank leaves that cell exactly as it was.</p>'
                + '<p><strong>Missed</strong> writes the missed marker and nothing else. Leaving the metric '
                + 'cells empty is what keeps the session out of your actual-hours totals rather than scoring '
                + 'it zero.</p>'
                + '<p><strong>Move</strong> sends a session to another day; <strong>swap</strong> exchanges '
                + 'two sessions’ days, which is what fits doing one in the other’s place. Only the date and '
                + 'weekday cells change.</p>')

            + section('Changing the plan in Excel',
                '<p>Shortening sessions, rewriting a workout, reshaping a week — all safe to do in Excel '
                + 'while you go on using the app. The app never writes to the planned columns. It reads them '
                + 'afresh every time it opens, so there is nothing to set up again afterwards.</p>'

                + '<p><strong>What updates itself.</strong> Everything your workbook computes: weekly totals, '
                + 'per-week and per-sport sums, cumulative hours, planned hours to date, compliance, and the '
                + 'charts drawn from them. Change a planned duration and all of it follows on the next open.</p>'

                + '<p><strong>What you have to change by hand.</strong> Anything written as prose, because no '
                + 'formula reaches it:</p>'
                + '<ul>'
                + '<li>Summary lines that quote hours — an overview saying “~10 h average, peak weeks up to '
                + '~13 h”, or the hour range beside each phase.</li>'
                + '<li>The workout descriptions themselves. Cut a 105-minute ride to 85 and the text still '
                + 'prescribes the old interval set. This is the real work, and nothing automates it.</li>'
                + '<li>Distances'
                + (mapping.columns && !mapping.columns.plannedDistance
                    ? ' — this workbook has no planned-distance column, so distance is written inside the '
                        + 'workout text and is prose like the rest of it'
                    : ' quoted in any text that is not the distance column itself')
                + '.</li>'
                + '</ul>'

                + '<p><strong>One thing changes retroactively.</strong> Compliance is actual ÷ planned, and '
                + 'the sheet recomputes it. Lower a planned duration and every session already logged against '
                + 'it is re-scored: 108 minutes against a 105-minute plan reads 103% today, and 127% if the '
                + 'plan becomes 85. Nothing is lost, but the history re-reads.</p>'

                + '<p><strong>Editing while something is waiting to sync.</strong> A logged session remembers '
                + 'what it was logged against, not just which row it was on. When it reaches the workbook the '
                + 'row is checked first: reword a session or change its duration and the result still lands on '
                + 'it; turn that row into a different sport and nothing is written at all, and the entry is kept '
                + 'with the reason. A session that has moved down the sheet is followed to its new row.</p>'

                + '<p><strong>Adding or removing columns</strong> is noticed too. The app remembers what your '
                + 'headings said when it worked the layout out, and if they no longer line up it reads the '
                + 'layout again rather than writing into whatever now sits at the old column number.</p>'

                + '<p><strong>Numbers are safe. Rows are the sharp edge.</strong> Changing values is fine. '
                + 'Inserting or deleting rows is not automatically fine: weekly totals usually sum a fixed '
                + 'range of rows, and a session logged on this phone but not yet synced points at a row '
                + '<em>number</em>. So sync first — Settings → Syncing should read “Nothing waiting” — then '
                + 'restructure, then check any total whose range you disturbed.</p>'

                + '<p><strong>To cut every session by the same proportion</strong> without destroying those '
                + 'total formulas: put the factor in a spare cell — 0.8 for a 20% cut — and copy it; select '
                + 'the planned-duration column; <strong>Go To Special → Constants → Numbers</strong>, which '
                + 'selects the typed minutes and skips both the total formulas and the blank rest days; then '
                + '<strong>Paste Special → Multiply</strong>. Reopen the app and it reads the new plan.</p>')

            + section('Things the plan did not ask for',
                '<p>An unplanned run, a hike, a meditation goes on a separate <strong>Extras</strong> sheet, '
                + 'created the first time you use it, with a column saying whether it counts as training '
                + 'load.</p>'
                + '<p>They are kept out of the plan on purpose. Compliance means actual training divided by '
                + 'planned training — twenty minutes of meditation is not twenty minutes of training, and '
                + 'folding it in would make the one number the plan exists to produce meaningless.</p>')

            + section('Offline, and how syncing works',
                '<p>Logging never waits for a network. An entry is saved on the phone and shown immediately; '
                + 'syncing then downloads the workbook <em>as it stands now</em>, replays the queue onto that '
                + 'copy, and uploads.</p>'
                + '<p>Replaying rather than uploading a locally edited copy is what stops the app overwriting '
                + 'a change you made in Excel meanwhile. The upload also carries the version marker of the '
                + 'copy it read, so if the file moved on in between, Dropbox refuses the write and the app '
                + 'starts again on the newer version.</p>'
                + '<p>The last workbook read is kept on the phone, so today’s session is readable with no '
                + 'signal at all.</p>')

            + section('Dropbox, and your privacy',
                '<p>The app is a static page with no server behind it, so it signs in to Dropbox using PKCE — '
                + 'a scheme designed for exactly that, where the app key is public by design and there is no '
                + 'secret to leak. Your Dropbox tokens are stored on this phone and nowhere else.</p>'
                + '<p>No account, no analytics, no backend. Your training data lives in your Dropbox and on '
                + 'your phone.</p>')

            + section('If something looks wrong',
                '<p><strong>A logged duration came out wrong</strong> — Sheet setup, “Units in this workbook”. '
                + 'A minutes column written as hours is the usual cause.</p>'
                + '<p><strong>No sessions appear</strong> — Sheet setup: the date and sport columns both need '
                + 'to be mapped.</p>'
                + '<p><strong>Something is stuck on “waiting to sync”</strong> — Settings → Syncing → Sync now. '
                + 'If it refuses, the workbook probably changed in Dropbox; syncing again resolves it.</p>'
                + '<p><strong>An update has not arrived</strong> — close the app fully and reopen it. It caches '
                + 'itself to work offline, so a new version is picked up on the next launch.</p>');
    }

    function renderVersionLog() {
        $('versionEyebrow').textContent = 'Version ' + AmsVersion.CURRENT;
        $('versionBody').innerHTML = AmsVersion.CHANGELOG.map((entry, index) =>
            '<div class="settings-group">'
            + '<h2>' + esc(entry.version) + (index === 0 ? ' · current' : '') + '</h2>'
            + '<div class="card">'
            + '<p class="workout-card-title">' + esc(entry.headline) + '</p>'
            + '<p class="map-row-sub" style="margin-bottom:0.6rem">' + esc(entry.date) + '</p>'
            + '<ul class="change-list">'
            + entry.items.map((item) => '<li>' + esc(item) + '</li>').join('')
            + '</ul></div></div>').join('');
    }

    /* ---------- sheet setup ---------- */

    async function openSetup() {
        const state = AmsSync.getState();
        if (!state.workbook) {
            toast('Load a workbook first.', 'bad');
            return;
        }

        setupDraft = state.mapping
            ? JSON.parse(JSON.stringify(state.mapping))
            : { version: AmsMapping.MAPPING_VERSION, sheets: [state.workbook.sheets[0].name],
                headerRow: 1, firstDataRow: 2, lastDataRow: null, mode: 'section-columns',
                sectionColumn: null, columns: {}, units: { duration: 'hours', distance: 'km', paceIsTime: false } };

        await renderSetup();
        showScreen('setupScreen');
    }

    function headingFor(draft, fieldId) {
        const col = draft.columns[fieldId];
        if (!col || !setupSheet) return 'completed';
        const heading = setupSheet.textAt(draft.headerRow, col);
        return heading ? '"' + heading + '"' : AmsXlsx.indexToCol(col);
    }

    async function renderSetup() {
        const state = AmsSync.getState();
        const workbook = state.workbook;
        const draft = setupDraft;
        setupSheet = await workbook.readSheet(draft.sheets[0]);

        const headings = AmsMapping.headingsFor(setupSheet, draft);

        function columnSelect(fieldId, canAdd) {
            const selected = draft.columns[fieldId] || '';
            const options = ['<option value="">— not in my sheet —</option>'].concat(
                headings.map((h) =>
                    '<option value="' + h.col + '"' + (Number(selected) === h.col ? ' selected' : '') + '>'
                    + esc(h.letter + (h.heading ? ': ' + h.heading : ''))
                    + '</option>'));
            // Offered only where there is nothing to point at yet: picking it
            // appends a single new column rather than all the missing ones.
            if (canAdd && !selected) options.push('<option value="new">＋ add a column for this</option>');
            return '<select data-map="' + fieldId + '">' + options.join('') + '</select>';
        }

        function fieldRow(field) {
            const col = draft.columns[field.id];
            const sample = col ? AmsMapping.sampleValue(setupSheet, draft, col) : '';
            return '<div class="map-row' + (col ? '' : ' unmapped') + '">'
                + '<div><div class="map-row-label">' + esc(field.label) + '</div>'
                + (sample ? '<div class="map-row-sub">e.g. ' + esc(sample) + '</div>'
                          : field.unit ? '<div class="map-row-sub">' + esc(field.unit) + '</div>' : '')
                + '</div>'
                + columnSelect(field.id, field.group === 'result') + '</div>';
        }

        const byGroup = (group) => AmsMapping.FIELDS.filter((f) => f.group === group);

        const sheetOptions = workbook.sheets.map((s) =>
            '<option value="' + esc(s.name) + '"' + (s.name === draft.sheets[0] ? ' selected' : '') + '>'
            + esc(s.name) + '</option>').join('');

        const unmappedResults = AmsMapping.RESULT_FIELDS.filter((id) => !draft.columns[id]);

        $('setupBody').innerHTML =
            '<div class="prose"><p>The app guessed this from your headings. Anything it got wrong, put right here — it is asked once and then remembered.</p></div>'

            + '<div class="settings-group"><h2>Where the plan lives</h2>'
            + '<div class="field"><label for="setupSheet">Sheet</label>'
            + '<select id="setupSheet">' + sheetOptions + '</select></div>'
            + '<div class="field-row">'
            + '<div class="field"><label for="setupHeaderRow">Heading row</label>'
            + '<input id="setupHeaderRow" type="number" inputmode="numeric" min="1" value="' + draft.headerRow + '"></div>'
            + '<div class="field"><label for="setupFirstRow">First workout row</label>'
            + '<input id="setupFirstRow" type="number" inputmode="numeric" min="1" value="' + draft.firstDataRow + '"></div>'
            + '</div>'
            + '<div class="field"><label for="setupMode">Sessions are laid out as</label>'
            + '<select id="setupMode">'
            + '<option value="section-columns"' + (draft.mode === 'section-columns' ? ' selected' : '') + '>One row per session, sections in columns</option>'
            + '<option value="section-rows"' + (draft.mode === 'section-rows' ? ' selected' : '') + '>One row per section</option>'
            + '<option value="simple"' + (draft.mode === 'simple' ? ' selected' : '') + '>One row per session, no sections</option>'
            + '</select></div>'
            + '</div>'

            + '<div class="settings-group"><h2>The plan</h2>' + byGroup('plan').map(fieldRow).join('') + '</div>'
            + '<div class="settings-group"><h2>Sections</h2>' + byGroup('section').map(fieldRow).join('') + '</div>'
            + '<div class="settings-group"><h2>Where results go</h2>'
            + '<div class="prose"><p>These are the cells the app writes into after a session.</p></div>'
            + byGroup('result').map(fieldRow).join('')
            + (unmappedResults.length
                ? '<p class="hint-inline" style="margin-top:0.7rem">To record something your sheet has no column for — '
                    + 'notes, say — pick <strong>＋ add a column for this</strong> above and one is appended, '
                    + 'headed and formatted like your existing columns.</p>'
                    + '<button class="btn btn-small btn-block" id="addColumnsButton" style="margin-top:0.5rem">'
                    + 'Or add all ' + unmappedResults.length + ' missing columns</button>'
                : '')
            + '</div>'

            + '<div class="settings-group"><h2>Units in this workbook</h2>'
            + '<div class="field"><label for="setupDuration">Durations are stored as</label>'
            + '<select id="setupDuration">'
            + '<option value="hours"' + (draft.units.duration === 'hours' ? ' selected' : '') + '>Decimal hours (1.5)</option>'
            + '<option value="minutes"' + (draft.units.duration === 'minutes' ? ' selected' : '') + '>Minutes (90)</option>'
            + '<option value="time"' + (draft.units.duration === 'time' ? ' selected' : '') + '>Excel time (1:30:00)</option>'
            + '</select></div>'
            + '<div class="field"><label for="setupDistance">Distances are stored in</label>'
            + '<select id="setupDistance">'
            + '<option value="km"' + (draft.units.distance === 'km' ? ' selected' : '') + '>Kilometres</option>'
            + '<option value="m"' + (draft.units.distance === 'm' ? ' selected' : '') + '>Metres</option>'
            + '</select></div>'
            + '<p class="hint-inline">Set from what is already in your sheet. If a logged duration comes out wrong, this is the setting to change.</p>'
            + (draft.columns.done
                ? '<div class="field" style="margin-top:0.9rem"><label for="setupDoneValue">Mark a session complete with</label>'
                    + '<input id="setupDoneValue" type="text" autocapitalize="off" spellcheck="false" value="'
                    + esc(draft.doneValue || 'Yes') + '">'
                    + '<p class="field-hint">Written into the ' + esc(headingFor(draft, 'done'))
                    + ' column. If your sheet counts completed sessions, this has to be exactly what those '
                    + 'formulas look for — the app reads them and fills this in for you.</p></div>'
                    + '<div class="field"><label for="setupMissedValue">Mark a session missed with</label>'
                    + '<input id="setupMissedValue" type="text" autocapitalize="off" spellcheck="false" value="'
                    + esc(draft.missedValue || 'Missed') + '">'
                    + '<p class="field-hint">Written to the same column when you mark a session missed.</p></div>'
                : '')
            + '</div>';

        wireSetup();
    }

    let setupWired = false;

    function wireSetup() {
        // #setupBody survives every re-render, so the delegated listener must be
        // attached exactly once or each rebuild would double it up.
        if (!setupWired) {
            setupWired = true;
            $('setupBody').addEventListener('change', onSetupChange);
        }

        const add = $('addColumnsButton');
        if (add) {
            add.addEventListener('click', onAddColumns);
        }
    }

    async function onAddColumns() {
        const missing = AmsMapping.RESULT_FIELDS.filter((id) => !setupDraft.columns[id]);
        await addColumnsFor(missing);
    }

    /*
     * Append columns to the sheet for the given result fields, style their
     * headings like the existing ones and give them a usable width.
     */
    async function addColumnsFor(fieldIds) {
        const state = AmsSync.getState();
        if (!state.workbook || !fieldIds.length) return;

        const result = AmsMapping.appendResultColumns(setupDraft, setupSheet, fieldIds);
        if (!result.edits.length) return;

        try {
            await state.workbook.writeCells(setupDraft.sheets[0], result.edits);
            for (const column of result.added) {
                await state.workbook.setColumnWidth(setupDraft.sheets[0], column.col, column.width);
            }
            const names = result.added
                .map((c) => AmsMapping.FIELD_BY_ID.get(c.id).label + ' (' + AmsXlsx.indexToCol(c.col) + ')');
            toast('Added ' + names.join(', ') + ' — save the layout to keep it.', 'good');
            await renderSetup();
        } catch (err) {
            toast(err.message, 'bad');
        }
    }

    async function onSetupChange(event) {
        const target = event.target;

        if (target.id === 'setupSheet') {
            setupDraft.sheets = [target.value];
            await renderSetup();
            return;
        }
        if (target.id === 'setupHeaderRow') {
            setupDraft.headerRow = Math.max(1, parseInt(target.value, 10) || 1);
            setupDraft.firstDataRow = Math.max(setupDraft.headerRow + 1, setupDraft.firstDataRow);
            await renderSetup();
            return;
        }
        if (target.id === 'setupFirstRow') {
            setupDraft.firstDataRow = Math.max(1, parseInt(target.value, 10) || 1);
            return;
        }
        if (target.id === 'setupMode') { setupDraft.mode = target.value; return; }
        if (target.id === 'setupDuration') { setupDraft.units.duration = target.value; return; }
        if (target.id === 'setupDistance') { setupDraft.units.distance = target.value; return; }
        if (target.id === 'setupDoneValue') {
            setupDraft.doneValue = String(target.value || '').trim() || 'Yes';
            return;
        }
        if (target.id === 'setupMissedValue') {
            setupDraft.missedValue = String(target.value || '').trim() || 'Missed';
            return;
        }

        if (target.dataset.map) {
            if (target.value === 'new') {
                await addColumnsFor([target.dataset.map]);
                return;
            }
            const value = target.value ? parseInt(target.value, 10) : null;
            if (value) setupDraft.columns[target.dataset.map] = value;
            else delete setupDraft.columns[target.dataset.map];
            if (target.dataset.map === 'sectionLabel') setupDraft.sectionColumn = value;
            target.closest('.map-row').classList.toggle('unmapped', !value);
        }
    }

    async function saveSetup() {
        if (!setupDraft) return;
        if (!AmsMapping.isComplete(setupDraft)) {
            toast('The date and discipline columns are both needed.', 'bad');
            return;
        }

        // Two fields on one column is the mistake that costs a workbook: a
        // result written into the column the plan lives in overwrites it.
        const clashes = AmsMapping.collisions(setupDraft);
        if (clashes.length) {
            const first = clashes[0];
            toast(first.fields.join(' and ') + ' are both set to the same column. '
                + 'Logging would write one over the other in your sheet — change one of them.', 'bad');
            return;
        }
        const state = AmsSync.getState();
        setupDraft.sectionColumn = setupDraft.columns.sectionLabel || null;
        setupDraft.lastDataRow = AmsMapping.findLastDataRow(setupSheet, setupDraft.firstDataRow, setupDraft.columns.date);

        await AmsSync.saveMapping(setupDraft);

        // Columns appended by "add missing columns" live only in the workbook
        // held in memory, so they are persisted directly — sync() would start
        // from a fresh download and lose them.
        if (state.workbook && state.workbook.isDirty) {
            const result = await AmsSync.persistWorkbookEdits();
            if (result && result.error) {
                toast(result.error, 'bad');
                return;
            }
            if (result && result.savedLocally) {
                toast('Layout saved. The new columns are in the copy on this phone — use "Save a copy" to keep them.', 'good');
                goBack();
                renderToday();
                renderPlan();
                renderSettings();
                return;
            }
        }

        toast('Layout saved.', 'good');
        goBack();
        renderToday();
        renderPlan();
        renderSettings();
    }

    /* ---------- syncing from the UI ---------- */

    async function runSync(explicit) {
        const button = $('syncButton');
        button.classList.add('spinning');
        try {
            const result = await AmsSync.sync({ force: true });
            if (result.skipped === 'no-file') {
                if (explicit) toast('Choose the workbook in Settings first.', 'bad');
            } else if (result.skipped === 'not-connected') {
                if (explicit) toast('Connect Dropbox in Settings first.', 'bad');
            } else if (result.skipped === 'already-syncing') {
                if (explicit) toast('Already syncing — give it a moment.');
            } else if (result.error) {
                toast(result.error, 'bad');
            } else if (result.written) {
                // Entries that could not be written are now kept and reported
                // rather than taking the whole sync down with them, so the
                // count of them has to be said out loud or it says nothing.
                toast(result.written + ' session' + (result.written === 1 ? '' : 's')
                    + ' written into the workbook.'
                    + (result.failed ? ' ' + result.failed + ' could not be — see Settings, Syncing.' : ''),
                    result.failed ? 'bad' : 'good');
            } else if (result.failed) {
                toast(result.failed + ' entr' + (result.failed === 1 ? 'y' : 'ies')
                    + ' could not be written. Settings → Syncing shows why.', 'bad');
            } else if (explicit) {
                await AmsSync.load();
                toast('Up to date.', 'good');
            }
        } catch (err) {
            toast(err.message || 'Sync failed.', 'bad');
        } finally {
            button.classList.remove('spinning');
            renderToday();
            renderPlan();
            renderSettings();
        }
    }

    /* ---------- wiring ---------- */

    function init() {
        document.querySelectorAll('.tab').forEach((tab) => {
            tab.addEventListener('click', () => openTab(tab.dataset.tab));
        });

        document.querySelectorAll('[data-back]').forEach((button) => {
            button.addEventListener('click', goBack);
        });

        document.body.addEventListener('click', (event) => {
            const card = event.target.closest('[data-workout]');
            if (card && !event.target.closest('[data-log]') && !event.target.closest('[data-missed]')
                && !event.target.closest('[data-move]') && !event.target.closest('[data-swap]')) {
                openWorkout(card.dataset.workout);
                return;
            }
            const log = event.target.closest('[data-log]');
            if (log) { openLog(log.dataset.log); return; }

            const missed = event.target.closest('[data-missed]');
            if (missed) { markMissed(missed.dataset.missed); return; }

            const move = event.target.closest('[data-move]');
            if (move) { openReschedule(move.dataset.move); return; }

            const swap = event.target.closest('[data-swap]');
            if (swap) { doSwap(swap.dataset.swap); return; }

            const drop = event.target.closest('[data-drop]');
            if (drop) { dropQueued(drop.dataset.drop); return; }

            const moveActivityButton = event.target.closest('[data-move-activity]');
            if (moveActivityButton) { moveActivity(moveActivityButton.dataset.moveActivity); return; }

            const deleteActivityButton = event.target.closest('[data-delete-activity]');
            if (deleteActivityButton) { deleteActivity(deleteActivityButton.dataset.deleteActivity); return; }

            const day = event.target.closest('[data-day]');
            if (day) {
                // Tapping the open day closes it again.
                expandedDay = expandedDay === day.dataset.day ? null : day.dataset.day;
                renderToday();
                return;
            }

            if (event.target.closest('[data-sheet-close]')) { closeChoice(); return; }

            if (event.target.closest('[data-share-week]')) { shareWeek(); return; }

            // Anywhere else on the week slate — but not inside an opened day,
            // which is a read-out rather than a control.
            if (event.target.closest('[data-legend]') && !event.target.closest('.week-expanded')) {
                legendOpen = !legendOpen;
                renderToday();
                return;
            }

            if (event.target.closest('[data-extra]')) { openExtra(); return; }

            if (event.target.closest('[data-go-outstanding]')) {
                currentRange = 'upcoming';
                document.querySelectorAll('.segment').forEach((seg) =>
                    seg.classList.toggle('active', seg.dataset.range === 'upcoming'));
                openTab('plan');
                return;
            }

            if (event.target.closest('[data-settings-fold]')) {
                settingsFoldOpen = !settingsFoldOpen;
                renderSettings();
                return;
            }

            const go = event.target.closest('[data-go]');
            if (go) {
                if (go.dataset.go === 'setup') openSetup();
                else if (go.dataset.go === 'guide') { renderGuide(); showScreen('guideScreen'); }
                else if (go.dataset.go === 'version') { renderVersionLog(); showScreen('versionScreen'); }
                else if (go.dataset.go === 'queue') { renderQueue(); showScreen('queueScreen'); }
                else if (go.dataset.go === 'activities') { renderActivities(); showScreen('activitiesScreen'); }
                else openTab(go.dataset.go);
            }
        });

        $('openLogButton').addEventListener('click', () => openLog());
        $('markMissedButton').addEventListener('click', () => markMissed());
        $('saveLogButton').addEventListener('click', saveLog);
        $('saveSetupButton').addEventListener('click', saveSetup);
        $('saveExtraButton').addEventListener('click', saveExtra);
        $('queueSyncButton').addEventListener('click', async () => {
            await runSync(true);
            await renderQueue();
        });
        $('syncButton').addEventListener('click', () => runSync(true));

        document.querySelectorAll('.segment').forEach((segment) => {
            segment.addEventListener('click', () => {
                currentRange = segment.dataset.range;
                document.querySelectorAll('.segment').forEach((s) => s.classList.toggle('active', s === segment));
                renderPlan();
            });
        });

        // Escape closes the question, as it closes anything else asked on top
        // of the screen.
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const sheet = $('actionSheet');
            if (sheet && !sheet.hidden) closeChoice();
        });

        AmsSync.subscribe((event, detail) => {
            if (event === 'plan') {
                renderToday();
                renderPlan();
            }
            if (event === 'sync') renderSyncState();

            // Columns that moved in Excel are worth a word: the app has just
            // re-read the layout by itself, and if it got anything wrong the
            // place to correct it is Sheet setup.
            if (event === 'remapped' && detail && detail.shifted) {
                toast('The columns in your sheet have moved, so the layout was read again. '
                    + 'Check Sheet setup if anything looks wrong.');
            }
        });

        syncTabHighlight('todayScreen');
    }

    return {
        init,
        toast,
        weekFigures,
        __weekCalendar: weekCalendar,   // pure, and exposed so its wording can be tested directly
        renderToday,
        renderPlan,
        renderSettings,
        openTab,
        openSetup,
        showScreen
    };
})();
