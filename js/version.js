/*
 * What version this is, and what changed in each one.
 *
 * The version is the single source of truth for cache-busting too: the service
 * worker names its cache after it, so shipping a new version retires the old
 * cached copy rather than leaving a phone on last week's code.
 */
const AmsVersion = (function () {
    'use strict';

    const CURRENT = '1.23.0';

    /*
     * Newest first. Written for the person using the app rather than as a
     * mirror of the commit log — several commits often make one release.
     */
    const CHANGELOG = [
        {
            version: '1.23.0',
            date: '2026-08-20',
            headline: 'Numbers from your watch (a first attempt)',
            items: [
                'Garmin has no interface a personal app may use — their developer programme is for companies and works by pushing data to a server this app deliberately does not have. But your watch already writes every session into Apple Health, and Shortcuts can read Health and write a file. So the bridge is a file.',
                'A Shortcut drops today\u2019s workouts beside your workbook in Dropbox. The app reads them, matches each to a planned session by day and sport, and offers the numbers under "From your watch" on the Today screen. Tapping fills the log form in; what is written to the workbook is still your decision, made by pressing Save.',
                'Anything the watch recorded that nothing planned matches — a walk, an unplanned run — is offered for the Extras sheet instead.',
                'How this works has the recipe for the Shortcut. This is a first attempt: it wants trying before it is trusted.'
            ]
        },
        {
            version: '1.22.0',
            date: '2026-08-20',
            headline: 'One session, on its own',
            items: [
                'A session can now be sent by itself, as a message or as a single calendar event, on the same terms as a week: 06:00, as long as it is planned to be, no reminder.',
                'Two ways to it. A share button at the top of any session sends that one — which is where you already are when you decide to. And the week sheet has gained "One session on its own", which lists everything in this week and next to pick from.',
                'A session sent on its own has room for the whole thing: the warm-up, the intervals, the technique work and the cool-down, each on its own line. In a week that detail would bury everything else, so there it stays in the notes.',
                'If it has been done, the message says so and how long it took.'
            ]
        },
        {
            version: '1.21.0',
            date: '2026-08-20',
            headline: 'Calendar events at six in the morning',
            items: [
                'Exported sessions are no longer all-day entries. Each starts at 06:00 and runs exactly as long as it is planned to — a 45-minute ride is 06:00 to 06:45 — so a week reads as a week rather than as a row of banners.',
                'Where a day holds more than one session they follow each other: a 30-minute swim at 06:00 puts the mobility with it at 06:30. Two events stacked on the same hour would claim the two happen at once.',
                'No reminders. A phone alerting before every session of a 48-week plan gets silenced inside a week, and then the useful alerts go with it.',
                'The times are written without a timezone, which in calendar terms means local time: 06:00 stays 06:00 in a training camp abroad rather than sliding to 04:00.',
                'Rest days stay all-day. They have no hour and no length, and giving them one would be inventing something.'
            ]
        },
        {
            version: '1.20.0',
            date: '2026-08-20',
            headline: 'A week, in your calendar',
            items: [
                'The share button can now put a week in a calendar as well as in a message. It hands over an ordinary .ics file, so it lands in Apple Calendar, Google Calendar or anyone else\u2019s — and it can be sent to somebody who has neither the app nor the workbook.',
                'One all-day event per session, titled with the sport, the duration and what the session is; the purpose, the intensity and the breakdown go in the notes. All-day because your plan says how long a session lasts and never when it happens: putting a swim at seven in the morning would be the app inventing that.',
                'Rest days are included. When you are free is as much use to somebody sharing a diary with you as when you are training.',
                'Each event keeps a stable identity, so importing the same week twice updates what is there rather than doubling it.',
                'A week with nothing planned still shows a line and the share button when the week after it has something, so a plan that starts next month can still be sent ahead.'
            ]
        },
        {
            version: '1.19.0',
            date: '2026-08-20',
            headline: 'This week or next week',
            items: [
                'The share button now asks which one. Each choice says what is in it — "6 sessions · 3h 05m" — so the answer needs no thinking about.',
                'A week that has not started yet is sent as a plan rather than a report: no ticks, no missed marks, and the figure at the end is simply what is planned. Sunday evening is the natural moment to send somebody the week ahead.',
                'Both weeks are written out before the question appears, so answering it goes straight to the share sheet.'
            ]
        },
        {
            version: '1.18.0',
            date: '2026-08-20',
            headline: 'Safe to edit the plan while the app is using it',
            items: [
                'A logged session now remembers what it was logged against, not only which row it sat on. Reword a workout in Excel, or change its duration, and the result still lands on it. Turn that row into a different sport and nothing is written there at all — the entry is kept, with the reason, in Settings → Syncing. Before this, a run logged on Thursday could be written into a swim, silently, because the row number still matched.',
                'A session that has moved down the sheet is followed to its new row rather than lost.',
                'Columns that move are noticed. The app remembers what your headings said when it worked out the layout; if they no longer line up — a column inserted, one deleted, one renamed — it reads the layout again instead of writing into whatever now occupies the old position. It says so when it does.'
            ]
        },
        {
            version: '1.17.0',
            date: '2026-08-20',
            headline: 'Hardened against the things that actually go wrong',
            items: [
                'The workbook the app builds is now opened and re-read before it is uploaded. If it will not open, or the plan has fewer sessions in it than the one that was read, nothing goes to Dropbox and your logging stays queued. The app should never be able to replace a good workbook with a broken one.',
                'A results column that shares a column with part of the plan — a mis-detection, or a hand-made layout — can no longer overwrite it. Sheet setup refuses to save such a layout, and the writer refuses to act on one even if it is already saved.',
                'A workbook that already has a sheet called Extras belonging to something else is left alone; the app takes another name rather than appending rows into somebody else\u2019s columns.',
                'One entry that cannot be written no longer stops the rest of the queue reaching the workbook. It is kept, with the reason, in Settings → Syncing.',
                'Every request to Dropbox now has a clock on it, so a connection that goes quiet ends in a message rather than a spinner that never stops. Rate limits and server errors are retried briefly; being offline says so plainly.',
                'A download is proved to open before it is cached, and a cached copy that will not open is discarded rather than re-read on every launch. A phone with no room left no longer takes the whole load down with it.',
                'Returning to the app re-reads the workbook at most once a minute rather than every single time.',
                'Failures that used to be silent now say something: a start-up that fails explains itself on the screen instead of showing nothing.'
            ]
        },
        {
            version: '1.16.0',
            date: '2026-08-20',
            headline: 'Send the week to somebody',
            items: [
                'A share button on the week card hands the week to the phone’s share sheet — Messages, Mail, WhatsApp, anywhere. It goes as plain text, so whoever receives it needs no app and no access to your workbook.',
                'A day per block, a line per session with its sport, duration and what it is; rest days named as rest days; the week’s figures at the bottom. Sessions already performed carry a tick and missed ones say so, so a week sent on Thursday reads as both plan and progress.',
                'Where there is no share sheet — a desktop browser, say — the week goes to the clipboard instead.'
            ]
        },
        {
            version: '1.15.0',
            date: '2026-08-20',
            headline: 'Missed sessions have their own list',
            items: [
                'The Plan tab gains a fourth list: Upcoming, Done, Missed, All. Done now means performed — a session you marked missed no longer sits among the ones you did, on the tab any more than on the week card.',
                'Nothing is hidden by the split. A missed session is still there to open, and can still be logged if it turns out you did it after all.'
            ]
        },
        {
            version: '1.14.0',
            date: '2026-08-20',
            headline: 'A missed session is not a session done',
            items: [
                '"1 of 6 sessions" now counts only what you actually did. A session marked missed used to be counted there, which said you had done something you had explicitly said you had not. It is named on its own instead: "0 of 6 sessions · 1 missed".',
                'Marking a session missed and then logging it now shows as logged, which is what the workbook ends up saying. Where a session had more than one entry waiting, the app showed the first and the file took the last, so the screen and the file could disagree.',
                'A session marked missed is recognised as missed after it reaches the sheet, even in a workbook whose own formulas never revealed a missed marker.'
            ]
        },
        {
            version: '1.13.0',
            date: '2026-08-20',
            headline: 'Time you spent outside the plan counts too',
            items: [
                'A session logged with "Log something else" now shows on the week card: "0m performed · 3h 05m planned · 15m extra". It was recorded on the Extras sheet and visible under Also today, but nowhere in the week figures — so fifteen minutes you had actually done could read as zero.',
                'It is kept as its own figure rather than added to the performed time. Compliance is actual training over planned training, and folding an unplanned hike or a meditation into it would change what that number means.',
                'Fixed: a workbook opened from this device never read its Extras sheet at all, so anything previously logged outside the plan disappeared from Also today and from the week. The Dropbox path always read it; this one did not.'
            ]
        },
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
