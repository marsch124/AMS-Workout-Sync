/*
 * What version this is, and what changed in each one.
 *
 * The version is the single source of truth for cache-busting too: the service
 * worker names its cache after it, so shipping a new version retires the old
 * cached copy rather than leaving a phone on last week's code.
 */
const AmsVersion = (function () {
    'use strict';

    const CURRENT = '1.9.0';

    /*
     * Newest first. Written for the person using the app rather than as a
     * mirror of the commit log — several commits often make one release.
     */
    const CHANGELOG = [
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
                'Each tab has its own colour and carries it through the whole screen — Today green, Plan blue, Settings slate — so the interface tells you where you are before you read a word. A session opened from Plan keeps Plan\u2019s colour, as a thread back to where you came from.',
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
