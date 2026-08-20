/*
 * What version this is, and what changed in each one.
 *
 * The version is the single source of truth for cache-busting too: the service
 * worker names its cache after it, so shipping a new version retires the old
 * cached copy rather than leaving a phone on last week's code.
 */
const AmsVersion = (function () {
    'use strict';

    const CURRENT = '1.12.1';

    /*
     * Newest first. Written for the person using the app rather than as a
     * mirror of the commit log — several commits often make one release.
     */
    const CHANGELOG = [
        {
            version: '1.12.1',
            date: '2026-08-20',
            headline: 'Performed, beside planned',
            items: [
                'The week card now reads "31m performed · 3h 05m planned" — both figures, every week, in that order. The planned total used to disappear as soon as anything was recorded, replaced by how much was left to go; now the two sit side by side, the way the session count above them does.',
                'Meeting the week still says so outright.'
            ]
        },
        {
            version: '1.12.0',
            date: '2026-08-20',
            headline: 'Time logged, always on the card',
            items: [
                'The week card now says how much you have logged in every state, including none. It used to drop the figure whenever the total was zero, so a week could show a session recorded and no minutes anywhere — which reads as a fault, and is the one number you opened the card to see. It now reads "0m logged · 3h 05m planned" until something is banked, then leads with what you did.',
                'A new part of How this works: Changing the plan in Excel. What recalculates on its own, what you have to rewrite by hand, how compliance re-scores sessions you already logged when you change a planned duration, why rows are riskier to touch than numbers, and how to cut every session by the same proportion without destroying the weekly-total formulas.'
            ]
        },
        {
            version: '1.11.0',
            date: '2026-08-20',
            headline: 'Settings in the order a person needs it',
            items: [
                'Settings is now ordered by how often you actually need something. Syncing first, then How this works and What’s new, then your activity list, then which workbook you are on.',
                'Everything set once or best not tapped by accident — the sheet layout, choosing a different file, disconnecting Dropbox, resetting the app — is folded away under "Setup and connection" at the bottom. One press opens it, and it shuts itself again whenever you come back to Settings.',
                'Disconnecting Dropbox now asks first, as resetting always did. It used to happen on a single tap of a button that sat at the very top of the screen.',
                'The Dropbox setup instructions only appear while there is no connection, instead of taking the top of the tab for ever.'
            ]
        },
        {
            version: '1.10.2',
            date: '2026-08-20',
            headline: 'New versions arrive on their own',
            items: [
                'The app now reloads itself once when a new version has been fetched, instead of running the old code until you happen to close and reopen it. It waits if you are in the middle of a session or a form, and tells you it will apply next time.',
                'Coming back to the app also checks whether there is a newer version to have.',
                'The empty sync strip is hidden by the code as well as by the styling now, so it stays gone even on a phone still holding an older copy of the stylesheet.'
            ]
        },
        {
            version: '1.10.1',
            date: '2026-08-20',
            headline: 'Things that were hidden are now hidden',
            items: [
                'The empty bar above "This week" is gone. It is the strip that explains a sync problem, and it was meant to appear only when there is something to explain — but the styling was beating the instruction to hide it, so it sat there empty most of the time.',
                'The same fault was offering "Log this session" and "Missed" on a rest day, on a screen that had already decided there was nothing to log. Both are fixed by the same one line.'
            ]
        },
        {
            version: '1.10.0',
            date: '2026-08-20',
            headline: 'Five disciplines, in training order',
            items: [
                'Stretching and mobility are one discipline now, called Mobility. They were the same session on the same mat, and keeping them apart bought two thin categories that then had to be explained apart.',
                'The five are listed everywhere in the order you train them: Swim, Bike, Run, Strength, Mobility. The week’s colour key now shows all five every week rather than only the ones that week happens to contain — a key that changes shape from week to week is not much of a key.',
                'A row your sheet calls "Stretching" now reads as Mobility in the app. Nothing in the workbook is rewritten: the word in your sheet stays the word in your sheet, and every total that counts it goes on counting it.',
                'If you have already edited your own activity list, it is left exactly as you made it — this changes what the app starts from, not what you chose.'
            ]
        },
        {
            version: '1.9.0',
            date: '2026-08-20',
            headline: 'The week explains itself',
            items: [
                'Tap the "This week" slate and it tells you how to read its own drawing: solid is recorded, hollow is still to do, dashed is moved to another day, hatched is marked missed, and a flat line is a rest day. Tap again and it goes away.',
                'The colours are listed with it — only the sports this week actually contains, so the key is about your week rather than about the app.',
                'Tapping a single day still opens that day, as before.'
            ]
        },
        {
            version: '1.8.0',
            date: '2026-08-20',
            headline: 'Your list, and a colour per tab',
            items: [
                'The activities offered by "Log something else" are now yours to edit in Settings: add your own, remove what you never do, and put them in the order you actually reach for. What is already written to the Extras sheet keeps the name it was logged under.',
                'Each tab has its own colour and carries it through the whole screen — Today green, Plan blue, Settings slate — so the interface tells you where you are before you read a word. A session opened from Plan keeps Plan’s colour, as a thread back to where you came from.',
                'Sport colours are untouched by this: a swim is cyan on every screen.'
            ]
        },
        {
            version: '1.7.0',
            date: '2026-08-20',
            headline: 'A quieter top of the screen',
            items: [
                'The date no longer takes the largest line in the app to repeat what your phone already says. It moves to the small line above, and the heading now names the block of the plan you are in — "Base 1 — Foundation" — which is the one piece of orientation nothing else on the screen carries.',
                'The sync button says how things stand instead of a banner beneath it repeating the button: green when everything is through, amber with a count when something is waiting, red when a sync failed. The strip below is kept for the cases that genuinely need words.',
                'A layout worked out by an older version of the app is now re-read rather than trusted for ever, so improvements to how sheets are understood reach phones that were set up before them.'
            ]
        },
        {
            version: '1.6.0',
            date: '2026-08-20',
            headline: 'The week, drawn',
            items: [
                '"This week" now shows the week itself: a column per day, a bar per session, height by planned duration and colour by discipline. Where the long ride sits, which evening is free, whether Friday is genuinely clear — the shape you plan around.',
                'A bar is hollow while the session is outstanding, solid once recorded, and hatched when marked missed, so the state of the week reads without any text.',
                'A rest day is a flat line rather than an empty column: planned nothing and nothing planned are different things.',
                'Tap any day to see what is on it, without leaving the Today screen.'
            ]
        },
        {
            version: '1.5.1',
            date: '2026-08-20',
            headline: 'The week reads as encouragement, not arrears',
            items: [
                '"This week" no longer opens the week by reporting a shortfall. Before anything is done it states the target; once something is banked it leads with that and points at what is left; when the week is met it says so.'
            ]
        },
        {
            version: '1.5.0',
            date: '2026-08-19',
            headline: 'Nothing falls through the cracks',
            items: [
                'A session in the past that was never recorded no longer disappears between Upcoming and Done. Today says how many there are, and Upcoming lists them first.',
                'Today opens with how the week stands — sessions recorded against sessions planned, and time done against time planned.',
                'Settings → Syncing can now show exactly what is waiting to reach the workbook, with any error, and lets you discard an entry that will never go through.',
                'How far the plan runs is worked out afresh on every read, so extending the plan in Excel no longer leaves the new rows invisible.'
            ]
        },
        {
            version: '1.4.0',
            date: '2026-08-19',
            headline: 'Everything reachable, and the tabs mean what they say',
            items: [
                'Unplanned sessions — a hike, a meditation, an extra run — can be recorded from the Today screen. They go on their own Extras sheet with a "Counts as training" column, never into the plan, so planned-versus-actual keeps meaning what it says.',
                'Every results column your sheet has is now reachable on every session. The sport decides what is asked for first, not what is allowed; the rest is one tap away and the choice is remembered.',
                'Upcoming lists what is still to do. A session you have logged or marked missed drops out of it.',
                'Done lists what you actually recorded, rather than everything dated before today.',
                'The log form shows the planned duration and, as you type, what percentage of it you are at. Compliance is left to the sheet, which computes it.',
                'This screen, and a How this works guide in Settings.'
            ]
        },
        {
            version: '1.3.0',
            date: '2026-08-19',
            headline: 'Moving sessions between days',
            items: [
                'A session can be moved to another day, or swapped with another session when you did the two the other way round.',
                'Only the date and weekday cells are rewritten. Nothing in a plan of this shape keys on the date, so a moved session keeps its place in every total that already counted it.',
                'The weekday is spelled the way your sheet already spells it, learned from the sheet rather than guessed from the phone.'
            ]
        },
        {
            version: '1.2.0',
            date: '2026-08-19',
            headline: 'Missed sessions, and columns that were not there',
            items: [
                'A session that did not happen can be marked missed. It writes the missed marker and nothing else, so the row stays out of your actual-hours totals instead of scoring zero.',
                'A results field with no column can be given one, appended with a heading styled like the rest of your sheet and a width to suit what goes in it.',
                'Columns appended this way are now actually saved back — previously the setup screen said it had added them and had not.'
            ]
        },
        {
            version: '1.1.0',
            date: '2026-08-19',
            headline: 'Tuned to a real 48-week plan',
            items: [
                'Durations are read from the column heading where it states the unit, so a plan counting minutes is no longer written to in hours.',
                'The completed marker is discovered from the workbook’s own COUNTIF formulas — a plan that counts "✓" is no longer filled in with "Yes", which would have left its tally at zero.',
                'Rest days are recognised and not offered for logging; brick and race sessions are recognised as themselves.',
                'Rows that carry text but are not sessions — weekly totals, phase banners — are no longer read as phantom workouts.',
                'The Dropbox redirect URI can be copied rather than retyped.'
            ]
        },
        {
            version: '1.0.0',
            date: '2026-08-19',
            headline: 'First release',
            items: [
                'Reads a training plan from an Excel workbook in Dropbox and shows today’s session, broken into warm-up, intervals, technique and cool-down.',
                'Logs what you actually did back into the workbook’s existing cells, rewriting only those cells and leaving charts, formatting and formulas untouched.',
                'Works offline: logging queues on the phone and is replayed onto the current workbook when there is a connection.'
            ]
        }
    ];

    return {
        CURRENT: CURRENT,
        CHANGELOG: CHANGELOG,
        entry: function (version) {
            return CHANGELOG.find(function (e) { return e.version === version; }) || null;
        }
    };
})();
