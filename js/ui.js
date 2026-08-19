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

    const DETAIL_SCREENS = new Set(['workoutScreen', 'logScreen', 'setupScreen']);
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
        if (tab === 'settings') renderSettings();
        if (tab === 'today') renderToday();
    }

    /* ---------- rendering pieces ---------- */

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
        if (workout.pending) {
            pills.push('<span class="pill pending">Waiting to sync</span>');
        } else if (workout.logged) {
            pills.push('<span class="pill done">Logged</span>');
        }
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
        $('todayDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
        $('todayEyebrow').textContent = 'Today';

        renderStatusStrip();

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

        const todays = AmsSync.today();

        if (!todays.length) {
            const next = AmsSync.upcoming(3);
            body.innerHTML = emptyState('icon-check', 'Rest day',
                'Nothing is scheduled for today in the workbook.',
                '')
                + (next.length
                    ? '<div class="day-heading"><h2>Coming up</h2></div>'
                        + next.map((w) => workoutCard(w, { showDate: true })).join('')
                    : '');
            return;
        }

        body.innerHTML = todays.map((workout) => {
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
                +   (workout.pending ? '<span class="pill pending">Waiting to sync</span>'
                        : workout.logged ? '<span class="pill done">Logged</span>' : '')
                + '</div>'
                + '<div style="margin-top:0.9rem">' + sectionsHtml(workout) + '</div>'
                + '<div class="button-row" style="margin-top:0.4rem">'
                +   '<button class="btn btn-primary" data-log="' + esc(workout.key) + '">'
                +     (workout.logged ? 'Log again' : 'Log this session') + '</button>'
                + '</div>'
                + '</div>';
        }).join('');
    }

    function emptyState(icon, title, text, action) {
        return '<div class="empty-state">'
            + '<svg class="icon"><use href="#' + icon + '"></use></svg>'
            + '<h2>' + esc(title) + '</h2>'
            + '<p>' + esc(text) + '</p>'
            + (action || '')
            + '</div>';
    }

    async function renderStatusStrip() {
        const strip = $('statusStrip');
        const state = AmsSync.getState();
        const pending = await AmsDb.queueCount();
        const connected = await AmsDropbox.isConnected();

        let message = '';
        let tone = '';

        if (pending > 0) {
            message = pending + ' session' + (pending === 1 ? '' : 's') + ' waiting to reach Dropbox';
            tone = 'warn';
        } else if (state.source === 'cache' && connected) {
            message = 'Showing the last copy saved on this phone';
            tone = 'warn';
        } else if (state.source === 'file') {
            message = 'Reading a file from this device — not connected to Dropbox';
            tone = 'warn';
        } else if (state.lastError) {
            message = state.lastError;
            tone = 'bad';
        } else if (state.meta && state.meta.modified) {
            message = 'In step with Dropbox';
        }

        if (!message) { strip.hidden = true; return; }
        strip.hidden = false;
        strip.className = 'status-strip' + (tone ? ' ' + tone : '');
        strip.innerHTML = '<svg class="icon"><use href="#icon-'
            + (tone ? 'clock' : 'check') + '"></use></svg><span>' + esc(message) + '</span>';
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
        if (currentRange === 'upcoming') {
            const today = AmsSync.todayKey();
            workouts = state.plan.filter((w) => w.dayKey >= today);
        } else if (currentRange === 'past') {
            const today = AmsSync.todayKey();
            workouts = state.plan.filter((w) => w.dayKey < today).reverse();
        } else {
            workouts = state.plan.slice();
        }

        if (!workouts.length) {
            body.innerHTML = emptyState('icon-today', 'Nothing here',
                currentRange === 'upcoming'
                    ? 'There are no sessions dated from today onwards in the workbook.'
                    : 'No past sessions in the workbook.', '');
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
        body.innerHTML = groups.map((group) => {
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
            + (workout.planned && workout.planned.description
                ? '<div class="card"><p class="section-label">Notes on the plan</p><p class="section-text">'
                    + esc(workout.planned.description) + '</p></div>'
                : '')
            + logged
            + '<p class="hint-inline">From <strong>' + esc(workout.sheet) + '</strong>, row ' + workout.row + '.</p>'
            + '</div>';

        $('openLogButton').textContent = workout.logged ? 'Log again' : 'Log this session';
        showScreen('workoutScreen');
    }

    function loggedSummary(workout) {
        const rows = [];
        const state = AmsSync.getState();

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

    function openLog(key) {
        const workout = key ? AmsSync.byKey(key) : currentWorkout;
        if (!workout) return;
        currentWorkout = workout;

        const state = AmsSync.getState();
        const fields = AmsPlan.formFields(workout, state.mapping || {});

        $('logEyebrow').textContent = workout.discipline.label + ' · ' + shortDay(workout.date);

        if (!fields.length) {
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
            return '<div class="field">' + label
                + '<input id="log-' + field.id + '" data-field="' + field.id + '"'
                + ' type="' + config.type + '"' + (config.mode ? ' inputmode="' + config.mode + '"' : '')
                + (config.step ? ' step="' + config.step + '"' : '')
                + ' placeholder="' + esc(config.placeholder) + '" value="' + esc(value) + '">'
                + (config.hint ? '<p class="field-hint">' + esc(config.hint) + '</p>' : '')
                + '</div>';
        }).join('');

        $('logBody').innerHTML =
            '<div class="card" ' + sportStyle(workout) + '>'
            + '<p class="workout-card-sport">' + esc(workout.discipline.label) + '</p>'
            + '<p class="workout-card-title">' + esc(workout.title) + '</p>'
            + '</div>'
            + html
            + '<input type="hidden" id="log-distanceUnit" value="' + esc(distanceUnit) + '">'
            + '<p class="hint-inline">Saved into <strong>' + esc(workout.sheet) + '</strong> row ' + workout.row
            + '. Leave anything blank and that cell is left exactly as it is.</p>';

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
            renderToday();
            renderPlan();
        } catch (err) {
            toast(err.message || 'That could not be saved.', 'bad');
        } finally {
            button.disabled = false;
            button.textContent = 'Save to the workbook';
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

        /* --- Dropbox --- */
        parts.push('<div class="settings-group"><h2>Dropbox</h2>');

        if (!connected) {
            parts.push(
                '<div class="prose">'
                + '<p>The app talks to Dropbox directly from your phone. To allow that, Dropbox needs to know this app exists — a one-off, two-minute job:</p>'
                + '<ol>'
                + '<li>Open <code>dropbox.com/developers/apps</code> and choose <strong>Create app</strong>.</li>'
                + '<li>Pick <strong>Scoped access</strong>, then <strong>Full Dropbox</strong> (or App folder, if you move the workbook into it).</li>'
                + '<li>On the <strong>Permissions</strong> tab tick <code>files.metadata.read</code>, <code>files.content.read</code> and <code>files.content.write</code>, then submit.</li>'
                + '<li>On <strong>Settings</strong>, add this exact redirect URI:<br><code>' + esc(AmsDropbox.redirectUri()) + '</code></li>'
                + '<li>Copy the <strong>App key</strong> and paste it below.</li>'
                + '</ol>'
                + '<p>The app key is public by design — there is no secret to leak, and your Dropbox tokens never leave this phone.</p>'
                + '</div>'
                + '<div class="field"><label for="appKeyInput">Dropbox app key</label>'
                + '<input id="appKeyInput" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" '
                + 'placeholder="abcd1234efgh567" value="' + esc(appKey) + '"></div>'
                + '<button class="btn btn-primary btn-block" id="connectDropbox">Connect Dropbox</button>');
        } else {
            parts.push(
                '<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-title">Connected</div>'
                + '<div class="settings-row-sub">' + esc(account && (account.name || account.email) || 'Dropbox account') + '</div>'
                + '</div><button class="btn btn-small btn-danger" id="disconnectDropbox">Disconnect</button></div>');
        }
        parts.push('</div>');

        /* --- the workbook --- */
        parts.push('<div class="settings-group"><h2>Workbook</h2>');
        if (path) {
            parts.push(
                '<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-title">' + esc(name || 'Workbook') + '</div>'
                + '<div class="settings-row-sub">' + esc(path) + '</div>'
                + '</div></div>');
        }
        if (connected) {
            parts.push('<button class="btn btn-block" id="pickFileButton">'
                + (path ? 'Choose a different file' : 'Choose the workbook in Dropbox') + '</button>');
            parts.push('<div class="file-list" id="fileList"></div>');
        }
        parts.push('<p class="hint-inline">No Dropbox? You can still open a copy from this device — you will just have to save the updated file back yourself.</p>');
        parts.push('<div class="button-row" style="margin-top:0.5rem">'
            + '<button class="btn btn-small" id="openLocalButton">Open a file</button>'
            + '<button class="btn btn-small" id="exportButton">Save a copy</button></div>');
        parts.push('<input type="file" id="localFileInput" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');
        parts.push('</div>');

        /* --- layout --- */
        parts.push('<div class="settings-group"><h2>Sheet layout</h2>');
        if (state.workbook) {
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
        parts.push('</div>');

        /* --- syncing --- */
        parts.push('<div class="settings-group"><h2>Syncing</h2>');
        parts.push('<div class="settings-row"><div class="settings-row-main">'
            + '<div class="settings-row-title">' + (pending ? pending + ' waiting' : 'Nothing waiting') + '</div>'
            + '<div class="settings-row-sub">'
            + (pending
                ? 'Logged on this phone but not yet written into the workbook.'
                : 'Every logged session has reached the workbook.')
            + '</div></div>'
            + '<button class="btn btn-small" id="syncNowButton">Sync now</button></div>');
        if (state.meta && state.meta.modified) {
            parts.push('<div class="settings-row"><div class="settings-row-main">'
                + '<div class="settings-row-title">Last read from Dropbox</div>'
                + '<div class="settings-row-sub">' + esc(new Date(state.meta.modified).toLocaleString()) + '</div>'
                + '</div></div>');
        }
        parts.push('</div>');

        /* --- about --- */
        parts.push('<div class="settings-group"><h2>About</h2>'
            + '<div class="prose">'
            + '<p>AMS Workout Sync reads your training plan straight out of the Excel file in Dropbox and writes what you log back into the same cells — the ones your totals and charts already point at.</p>'
            + '<p>It only ever rewrites the cells you fill in. Formulas, formatting, charts and every other sheet are passed through untouched.</p>'
            + '</div>'
            + '<div class="button-row" style="margin-top:0.6rem">'
            + '<button class="btn btn-small btn-danger" id="resetButton">Reset the app</button></div>'
            + '<p class="hint-inline">Resetting clears the Dropbox connection, the cached workbook and the saved layout from this phone. Your workbook in Dropbox is not touched.</p>'
            + '</div>');

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

        const disconnect = $('disconnectDropbox');
        if (disconnect) {
            disconnect.addEventListener('click', async () => {
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

    async function renderSetup() {
        const state = AmsSync.getState();
        const workbook = state.workbook;
        const draft = setupDraft;
        setupSheet = await workbook.readSheet(draft.sheets[0]);

        const headings = AmsMapping.headingsFor(setupSheet, draft);

        function columnSelect(fieldId) {
            const selected = draft.columns[fieldId] || '';
            const options = ['<option value="">— not in my sheet —</option>'].concat(
                headings.map((h) =>
                    '<option value="' + h.col + '"' + (Number(selected) === h.col ? ' selected' : '') + '>'
                    + esc(h.letter + (h.heading ? ': ' + h.heading : ''))
                    + '</option>'));
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
                + columnSelect(field.id) + '</div>';
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
                ? '<button class="btn btn-small btn-block" id="addColumnsButton" style="margin-top:0.7rem">'
                    + 'Add ' + unmappedResults.length + ' missing column' + (unmappedResults.length === 1 ? '' : 's') + ' to the sheet</button>'
                    + '<p class="hint-inline">Appends new headed columns to the right of your sheet for the results that have nowhere to go.</p>'
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
        const state = AmsSync.getState();
        const missing = AmsMapping.RESULT_FIELDS.filter((id) => !setupDraft.columns[id]);
        const edits = AmsMapping.appendResultColumns(setupDraft, setupSheet, missing);
        if (!edits.length) return;
        try {
            await state.workbook.writeCells(setupDraft.sheets[0], edits);
            toast('Columns added — save the layout to keep them.', 'good');
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

        if (target.dataset.map) {
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
        const state = AmsSync.getState();
        setupDraft.sectionColumn = setupDraft.columns.sectionLabel || null;
        setupDraft.lastDataRow = AmsMapping.findLastDataRow(setupSheet, setupDraft.firstDataRow, setupDraft.columns.date);

        await AmsSync.saveMapping(setupDraft);

        // If columns were appended, the workbook in memory has unsaved edits.
        if (state.workbook && state.workbook.isDirty) {
            const result = await AmsSync.sync({ force: true });
            if (result && result.error) toast(result.error, 'bad');
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
            } else if (result.error) {
                toast(result.error, 'bad');
            } else if (result.written) {
                toast(result.written + ' session' + (result.written === 1 ? '' : 's') + ' written into the workbook.', 'good');
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
            if (card && !event.target.closest('[data-log]')) {
                openWorkout(card.dataset.workout);
                return;
            }
            const log = event.target.closest('[data-log]');
            if (log) { openLog(log.dataset.log); return; }

            const go = event.target.closest('[data-go]');
            if (go) {
                if (go.dataset.go === 'setup') openSetup();
                else openTab(go.dataset.go);
            }
        });

        $('openLogButton').addEventListener('click', () => openLog());
        $('saveLogButton').addEventListener('click', saveLog);
        $('saveSetupButton').addEventListener('click', saveSetup);
        $('syncButton').addEventListener('click', () => runSync(true));

        document.querySelectorAll('.segment').forEach((segment) => {
            segment.addEventListener('click', () => {
                currentRange = segment.dataset.range;
                document.querySelectorAll('.segment').forEach((s) => s.classList.toggle('active', s === segment));
                renderPlan();
            });
        });

        AmsSync.subscribe((event) => {
            if (event === 'plan') {
                renderToday();
                renderPlan();
            }
            if (event === 'sync') renderStatusStrip();
        });

        syncTabHighlight('todayScreen');
    }

    return {
        init,
        toast,
        renderToday,
        renderPlan,
        renderSettings,
        openTab,
        openSetup,
        showScreen
    };
})();
