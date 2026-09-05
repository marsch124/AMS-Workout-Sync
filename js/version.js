/*
 * What version this is, and what changed in each one.
 *
 * The version is the single source of truth for cache-busting too: the service
 * worker names its cache after it, so shipping a new version retires the old
 * cached copy rather than leaving a phone on last week's code.
 */
const AmsVersion = (function () {
    'use strict';

    const CURRENT = '1.45.0';

    /*
     * Newest first. Written for the person using the app rather than as a
     * mirror of the commit log — several commits often make one release.
     */
    const CHANGELOG = [
        {
            version: '1.45.0',
            date: '2026-09-05',
            headline: 'Settings says what it means',
            items: [
                '**Mobility and strength are both yellow now**, in the week strip and everywhere else. They are the same kind of work and they are read together; telling two gym sessions apart by colour was never the question anybody asks of that drawing.',
                '**The reason so many lines in Settings read wrongly has been found and fixed.** The button in each row was centred against the whole row, so on any row whose description ran to two lines the button ended up level with the *description* rather than with the title above it — and a grey line drawn shoulder to shoulder with a button reads as that button\u2019s label. Every one of the lines you flagged was in that position. Buttons now line up with the title they belong to.',
                '**And every description has been rewritten to say what its button does.** "Read the guide to what this app does to your workbook." "See what changed, in this version and every one before it." "Write them into your workbook now." No more fragments.',
                '**The two lines you asked to have deleted are gone** — under the photo count and under the workbook name. Nothing that could be written there survived being read as a caption for the buttons underneath, and the count and the file name already say what those rows are.',
                '**The question mark now says where your workbook is** as well as what the buttons do, since that was the one useful thing the deleted line had been carrying.',
                '**"Log something else" is now "Extra activities"**, which is what they are. The button says *Log an extra activity*, the list is *Extra activities*, and Settings offers *Everything extra you logged*.',
                '**"Send it to somebody" says what it sends** — *Send this app to somebody* — and has moved to the foot of Settings, which is where the rarest thing on the page belongs.',
                '**The sheet-layout row was titled "Weekly Schedules"**, which is the name of a tab in your Excel file and a heading only if you already knew why it was there. It now says *How your Excel sheet is read*, with the sheet\u2019s name in the line below.',
                '**The whole effort scale, on a question mark beside the box.** All ten, each one explained, and each one tappable — because the line beside the field can only describe the number you already guessed, and choosing well means seeing what 6 and 8 claim before you settle on 7.',
            ]
        },
        {
            version: '1.44.0',
            date: '2026-09-04',
            headline: 'Nine things you asked for',
            items: [
                '**Add sits after the photographs again**, where the next one would go. The strip wraps onto a second row now instead of scrolling sideways, which is what had pushed the button off the screen and made it move to the front in the first place.',
                '**Perceived effort says what the number means.** The box is one character wide and was taking the whole width of the screen; it is now the size of what goes in it, and the room beside it explains the number you just typed — *7: Hard. Single words, and you are watching the clock.* The scale used to be a placeholder, which is the one piece of text that disappears the moment you answer.',
                '**A session shares its photographs with it.** Send one as a message and the pictures go too. Whether they can is the phone\u2019s decision, not the app\u2019s, so the line under the button says which it will be before you tap it rather than after.',
                '**"Everything you logged" is now "Everything else you logged"**, because that is what it is: the things outside the plan.',
                '**Two lines that read as captions for the buttons under them** have been rewritten. "On this phone only" and "Opened from this device" were describing your photographs and your workbook, but sitting directly above a row of buttons they looked like instructions about the buttons.',
                '**A question mark beside those buttons instead**, which is where the explanation belongs. Tap it and it says what *Save a copy* does — it hands you the workbook as it stands, everything logged already in it, as a copy that changes nothing — and the same for the photo buttons.',
                '**Setup and connection has moved inside Workbook.** Everything folded away in there is about the workbook: its columns, which file to read, and the Dropbox account it lives in. Standing on its own at the foot of the screen it looked like a subject of its own.',
                'The top of Settings said **AMS Workout Sync**, which is the one thing nobody opens Settings to find out. Every other tab uses that line to say what the screen is for, and now this one does too.',
            ]
        },
        {
            version: '1.43.0',
            date: '2026-09-04',
            headline: 'Send it to somebody',
            items: [
                '**Settings → Send it to somebody** passes the app on three ways: straight into **Messages** with it already written out, out through the **share sheet** for mail or WhatsApp or AirDrop, or just the **link on the clipboard**.',
                'It sends more than the address. Opened with nothing behind it this app says "No workbook yet", which reads as broken rather than as waiting — so the message says what it does, that they need their own plan as an .xlsx in Dropbox before it is any use, and the step everybody misses on an iPhone, which is that a page becomes an app through Share → Add to Home Screen.',
                'The link is worked out from where the app is actually running, so it follows a move without anything being changed by hand — except when it is running somewhere nobody else can reach, on a laptop or from a file. A link to localhost is not a link, and sending one looks exactly like sending a good one, so in that case it falls back to the published address.',
            ]
        },
        {
            version: '1.42.0',
            date: '2026-09-04',
            headline: 'Photographs on the things the plan did not ask for',
            items: [
                '**A walk, a hike, a meditation takes photographs too.** The strip is on the form while you log it — pick the picture and it goes on when you save — and on the entry itself afterwards, so you can add one later or take one off.',
                '**Everything you logged outside the plan now has a screen of its own.** Until now an extra was only ever visible on the day it happened, which was fine while it was just a row in a sheet, because the sheet was where you went to look at it. A photograph is not in the sheet, so that had to change: Settings → Log something else → *Everything you logged*, or "See all" on Today, lists them newest first with their pictures.',
                '**What a picture is pinned to, and why it stays pinned.** An extra has no row until it syncs and no queue entry afterwards, so neither of those could hold a photograph — it would come unpinned halfway through, quietly, days later. A photo points at an extra the way the app already recognises one it has written: the day, the activity and how long it took. That survives the sync, and it survives renaming an activity afterwards.',
                'Saved photo files fold Swedish letters rather than dropping them, so a walk on the Kolmården ridge comes out of the zip as *Kolmarden-ridge* instead of a row of dashes.',
            ]
        },
        {
            version: '1.41.0',
            date: '2026-09-04',
            headline: 'Photographs, and the end of the false rest day',
            items: [
                '**A session moved onto a rest day ends the rest day.** The rest card used to sit underneath the session you had just moved there, saying there was nothing on today. It was the workbook telling the truth about the plan and the wrong thing about the day. It now comes off Today and off the Plan list as soon as anything lands on that day, and the week strip stops drawing the flat rest line for it.',
                'Nothing is written to the sheet for this. The rest row is exactly where it was, and moving the session away again brings the rest day straight back on the next redraw.',
                '**Any session takes photographs.** Open a session, or its log form, and tap Add in the Photos strip: the camera and your library both come up, and several at once is fine. Tap one to see it full size, save a copy out, or delete it. A camera and a number on a session card is how many it has.',
                'They are not written into your workbook, and they cannot be. That file is the one thing here that matters, and this app changes as little of it as it possibly can — pictures would mean adding drawings, relationships and anchors to your training plan. So a photo lives on this phone beside the plan rather than inside it, and it is not in Dropbox.',
                'Which makes this the only copy, so there is a way out. **Settings → Photos** says how many there are and what they come to, and *Save them all* puts every one into a single zip file named by day and sport. Resetting the app deliberately leaves photos alone: a reset is what you reach for when syncing misbehaves, and losing a season of pictures to a sync fix would be indefensible. Deleting them is its own button.',
                'Every photo is shrunk on the way in, to 1600 pixels on the long edge. That takes one off a phone from three or four megabytes to roughly a quarter of one, still sharper than the screen it is looked at on — so a season of them is tens of megabytes rather than gigabytes.',
            ]
        },
        {
            version: '1.40.0',
            date: '2026-08-28',
            headline: 'Which day slips is gone',
            items: [
                'You said you were not interested and never would be, so it has come off. That was the deal when it went on: a figure nobody wants is not neutral, it is noise dressed as information, and it was taking a fifth of the Progress tab to be ignored in.',
                'Progress now answers three questions instead of four: which sport is running behind, how many sessions in a row you have kept, and how often one was moved rather than lost.',
                'The weekday chart and everything only it used are gone from the app, not merely hidden. What stays is the rule the chart forced into existence: a remembered move is never believed if the row no longer holds the sport it was recorded against. That protects the moved-rather-than-lost count too, so it earns its keep without the chart.',
            ]
        },
        {
            version: '1.39.1',
            date: '2026-08-28',
            headline: 'The wash stops at the line',
            items: [
                'Asked for, and right: the week’s figures now sit on plain ground again. The wash ends exactly at the grey rule under the day columns instead of running on beneath the numbers.',
                'It ends *at the rule wherever the rule is* — open the key or a day and the rule moves down, and the wash’s edge moves with it. The statistics block repaints the card’s own surface over the wash rather than the wash trying to guess where to stop, which is why nothing on screen moved by a pixel.',
            ]
        },
        {
            version: '1.39.0',
            date: '2026-08-28',
            headline: 'The week card wears the week',
            items: [
                'A pale green wash now moves across the This Week card as the week does. Its right edge is the present moment: a sliver on Monday morning, halfway through Thursday lunchtime, the whole card as Sunday ends. Chosen from five candidates, and it was the most beautiful of them.',
                'It is painted as ground rather than drawn as a thing — part of the card’s own background, behind every bar and word, unable to cover anything or catch a tap meant for something else. Both themes mix their own version from the app’s green.',
                'The key behind the **?** explains it, alongside the shapes it already explains.',
                'No numbers changed and none moved. The wash says *where in the week you are standing*; the bars still say what each day asks; the bar below still says how the hours stand. Three different questions, now each with its own voice.',
            ]
        },
        {
            version: '1.38.0',
            date: '2026-08-26',
            headline: 'The audit’s four findings, fixed the same evening',
            items: [
                'A full quality check of the app found four things; all four are in this release.',
                '**The phone is now asked to keep the app’s storage.** Sessions waiting to sync, the Dropbox connection and the cached workbook all live in storage the system may tidy away under pressure; the app now makes the standard request to treat it as worth keeping, every time it starts. One line of insurance against the ugliest kind of surprise.',
                '**“Disconnect & clear” counts what it deletes.** If sessions are still waiting to sync, the confirm now says so — “including 2 sessions not yet written to the workbook” — instead of quietly taking them with the cache.',
                '**Light mode’s sport colours grew up.** The bright dark-theme palette washed out to half the readable-contrast standard on white; every sport now has a deeper light variant, the way Strength always did. Measured after: 6.4–7.6 to 1, against the 4.5 required.',
                '**Small controls are thumb-sized now.** The “This week ?” legend toggle was 15 pixels tall — the most interesting tap on the card and the hardest to land. It, the share button, the plan segments and the small Settings buttons all grew invisible tap halos to 44 pixels or more, without a visible pixel moving. The toggle’s halo grows upward, deliberately: the day columns below are tappable themselves, and an even halo would have stolen the top of every day.',
                'And a new permanent check keeps all four promises kept, so the audit is a ratchet rather than a snapshot.',
            ]
        },
        {
            version: '1.37.0',
            date: '2026-08-26',
            headline: 'The week’s bar shows what it is a share of',
            items: [
                'The bar is now drawn as an outline for the whole week, filled solid as far as you have got. Before, the part you had not done was a grey block, which said nothing; now the outline is the hours the week asked for, and the green is your share of them.',
                'This is the same grammar the day columns already use, and the key explains it there: **solid is what you did, hollow is what is still to do**. The week’s bar had been the one thing on the card not obeying it.',
                'It reads best on a week not yet started — an empty outline beside seven empty columns, all saying the same thing.',
            ]
        },
        {
            version: '1.36.0',
            date: '2026-08-26',
            headline: 'The week’s bar sits with the words it belongs to',
            items: [
                'The green bar used to run directly beneath the seven day columns and at exactly their width, which made it look like part of that chart — something filling up left to right across Monday, Tuesday, Wednesday.',
                'It is nothing of the kind. It is the hours you have done against the hours the week asked for, and it has no more to do with Monday than with Sunday.',
                'So it has moved below the line that says so, with a rule separating both from the days above. The sentence and its bar now read as one thing, and the day columns end where they should.',
            ]
        },
        {
            version: '1.35.0',
            date: '2026-08-26',
            headline: 'It asks before throwing away what you typed',
            items: [
                'Pressing back on a log form has always discarded it, which is right — nothing has been written yet. What was wrong was the silence: four fields filled in, a thumb near the arrow, and it was gone with nothing said.',
                'Now it asks, and only when there is something to lose. A form you opened and did not touch closes as it always did, and so does one you have just saved. In practice it should almost never appear.',
                'This is instead of a **Cancel** button. The back arrow already does exactly what Cancel would, two exits that behave identically is worse than one, and a Cancel beside Save would make the button you press several hundred times a season half as wide.',
                'Both forms are covered — a planned session and **Log something else** — including the moment the second one rebuilds itself because you changed the activity. It does not forget you had already typed something.',
            ]
        },
        {
            version: '1.34.1',
            date: '2026-08-26',
            headline: 'The comma works in “Log something else” too',
            items: [
                'The last release fixed this on the form for a planned session and missed the other one. **Log something else** is built separately and still had the fault: the keypad offered the comma, and pressing it did nothing at all.',
                'Distance, heart rate and effort on that form are now ordinary text fields like the rest. A distance typed *7,5* is written to the Extras sheet as **7.5**.',
                'The two row-number boxes in Sheet setup are still number fields, and that is right — they take whole numbers, so their keypad offers no separator to press in the first place.',
            ]
        },
        {
            version: '1.34.0',
            date: '2026-08-26',
            headline: 'A decimal comma no longer loses the number',
            items: [
                'Found by a question about the phone keypad, and it turned out to be a real fault that had been there from the beginning.',
                '**Typing a distance with a comma lost it silently.** Enter *52,4* on a form where the keypad offers a comma, and the field looked perfectly normal — but nothing was recorded. The duration saved, the distance simply never reached the workbook, and nothing anywhere said so.',
                'The cause: a *number* input hands back only what the browser can parse, and it parses with a full stop. Anything else comes back empty. The app has always read a comma as a decimal point — the value never survived long enough to be read.',
                'No field on the log form is a number input any more. They are ordinary text fields, and the keyboard is chosen with `inputmode`, which is what governs it on a phone regardless. Nothing is discarded before the app sees it.',
                'Distance and speed offer the decimal keypad. Heart rate, effort and cadence offer plain digits, since none of them is ever a fraction — if you see no decimal point on those, that is why.',
                'A speed typed as *32,5* is now written to the sheet as **32.5**. Only a plain number is converted: a running pace of *4:52* is left exactly as typed.',
            ]
        },
        {
            version: '1.33.0',
            date: '2026-08-26',
            headline: 'The pace field asks each sport its own question',
            items: [
                'Your sheet has one column for all three sports — *Avg Pace/Pwr* — but it is not asking them the same thing. The log form used to call it **Pace (min/km)** whatever you were doing, which is a number no cyclist has in their head and the wrong unit for a swimmer.',
                'It now follows the sport: **Average speed (km/h)** on a bike, **Pace (min/km)** on a run, **Pace (per 100m)** on a swim. Still the same single column in the workbook — the app does not get to add columns to your plan — only the question changes.',
                'On a bike the field opens the number keypad, since a speed is digits and a decimal point. It stays a text field underneath, deliberately: the column is named for power as well as pace, so **168 W** must still be typeable. A number-only field would have quietly forbidden half of what the column is for.',
            ]
        },
        {
            version: '1.32.0',
            date: '2026-08-26',
            headline: 'Opening a second workbook reads its columns again',
            items: [
                'Found while rehearsing the switch from Pre-Season to the Ironman plan, which is the one thing coming up that had never been tried end to end.',
                '**Opening a workbook from the phone kept the previous workbook\u2019s column layout, unchecked.** The saved layout belongs to whichever workbook was open last — and two plans built from the same template agree closely enough that nothing looks wrong. In this case the Ironman plan inherited a *Notes* column that only Pre-Season has, so a note would have gone into an empty column off the end of the sheet.',
                'The protection against exactly this already existed — the app records what each heading said and refuses to write when they no longer agree — but the file-from-the-phone path never asked it. Only the Dropbox path did. It now asks too, and if neither the old layout nor a fresh reading fits, it says so and offers Sheet setup rather than writing into guessed columns.',
                'Your September switch was never in danger, because choosing a workbook from Dropbox has always been checked. This was the *Open a file* route, used when the app is not connected.',
                'Rehearsed on the real files afterwards: Pre-Season\u2019s 25 sessions and the Ironman plan\u2019s 419 both read correctly, the layout is worked out fresh each time, a session logged before the switch survives it, and switching back gives an identical layout to the one that was there before.',
            ]
        },
        {
            version: '1.31.0',
            date: '2026-08-26',
            headline: 'Hardening the parts added since the last pass',
            items: [
                'Everything built since the last hardening — the Progress screen, the figures behind it, and the record of what was moved — put under the same treatment as the rest of the app. Two real faults found, both silent, both fixed.',
                '**A move was recorded even when the move failed.** If the phone could not write the reschedule to its queue — no space, storage refusing — the attempt threw, nothing was rescheduled, and the record was written anyway. The Progress screen would then report a session moved and kept that had never moved. The record is now written only after the move itself has succeeded.',
                '**A remembered move could attach itself to the wrong session.** A session is identified by its sheet and row number, so inserting a single row in Excel slides every session below it onto its neighbour\u2019s identity. A move recorded against a Tuesday bike could later be read against whatever now occupies that row — in testing, a rest day. Each record now carries the sport it belonged to, and a move whose sport no longer matches is ignored rather than believed. A confidently wrong answer became a missing one, which is the right trade.',
                'The Progress figures now refresh wherever the rest of the app does. Standing on that tab while a sync landed used to leave the previous numbers on screen.',
                'Anything read back from storage is now treated as though a stranger wrote it — because across a browser or app upgrade that is close enough to true. Records that are not dates, or not objects, or not there at all, are dropped instead of counted.',
                'Also checked and found sound: twenty thousand sessions summarise in nine milliseconds; a workbook full of hostile text reaches the screen as text; and opening the tab twenty-five times in a row does not leave a stale answer or a duplicated screen.',
            ]
        },
        {
            version: '1.30.0',
            date: '2026-08-26',
            headline: 'A missed session settles down too',
            items: [
                'Marking a session missed now clears its buttons the same way logging it does. The card becomes one line — *Marked missed. Tap to see it or change it* — because a session you have answered is answered, whichever answer you gave.',
                'The way back matters more here than it does for a logged session, so it is worth saying plainly: marking something missed in the morning and then doing it that evening is an ordinary thing to happen. Tap the card and **Log this session** is right there, exactly as before. Nothing about the missed marker prevents logging it afterwards; the numbers simply overwrite it.',
                'One deliberate exception. A session **moved to today** keeps all three buttons, because it has not been done — it has been rescheduled, and it still needs doing. Collapsing that card would hide the buttons at the one moment they are most wanted.',
            ]
        },
        {
            version: '1.29.0',
            date: '2026-08-26',
            headline: 'A recorded session gets out of the way',
            items: [
                'Once a session is logged, its three buttons go. There is nothing left to decide about a session you have already recorded, and *Log again*, *Missed* and *Move* sitting there afterwards were three offers to decide it again. The card shrinks to a line — *Recorded. Tap to see it or change it* — which leaves the day shorter and gives **Log something else** room to be seen.',
                'Nothing is lost by it. The card now opens the session itself, where *Log again*, *Missed* and *Move to another day* all still are. Logging again overwrites; nothing is ever written twice.',
                'The duration field now says what it always did. Typing a plain number has always meant minutes — **45** is forty-five minutes, **90** is an hour and a half — but the examples on the field were *45min, 1:15, 1h20*, every one of them carrying a unit, which read as an instruction to include one. It now shows **e.g. 45** and says so underneath. The parsing has not changed: *1:15*, *1h20*, *0.5h*, *1,5h* and *90min* all still work and still mean what they look like.',
                'Both are written up under **How this works** — the duration formats in *Logging, missing, moving*, alongside a note that a colon means hours and minutes, so 1:15 is an hour and a quarter rather than seventy-five seconds.',
                'That section also stopped saying "the three tabs", which it had been saying since Progress arrived and made four of them. Progress is now described there properly, including what it does not count and why.',
            ]
        },
        {
            version: '1.28.0',
            date: '2026-08-26',
            headline: 'A Progress tab: four things the spreadsheet cannot tell you',
            items: [
                'A fourth tab, between Plan and Settings. It reads your workbook and answers four questions about how the training is actually going — nothing is written, nothing is stored in the plan, and your Progress sheet keeps every total and the chart exactly as Excel works them out.',
                '**Which day slips.** Every weekday, with the share of its sessions you kept. There is almost always one that quietly runs behind the others, and it is worth knowing which — a session you keep moving off Thursday might simply belong on Friday.',
                '**Which sport runs behind.** The same question by sport. A discipline can lose a third of its sessions without ever looking like a problem in a week-by-week total.',
                '**Consistency.** How many sessions in a row you have kept, and the longest run so far.',
                '**Missed, or moved.** A session shifted to another day and completed is not a session lost, and the two are worth counting apart.',
                'Why not simply show what the Progress sheet already computes? Because it cannot be read from here. Those cells are formulas, and a formula in a saved file carries the answer Excel worked out last time it had the file open. This app edits only the cell you asked it to edit, so those cached answers sit unchanged until you next open the workbook — reading them would show you a stale number with total confidence. Excel recalculates the instant you open it, which is exactly why the sheet is right and copying it here would be wrong.',
                'Rest days are not counted as sessions. A day off cannot be kept or missed, and counting it as kept would flatter every figure on the screen.',
                'A session you never answered either way counts against you rather than being quietly dropped — a plan you did not reply to is not a plan you kept. Sessions still in the future are not counted at all.',
                'Under about a dozen sessions of history the screen says so plainly before showing anything. A fortnight of training cannot tell you which day you skip; it can only tell you about that fortnight.',
                'One honest limitation, stated on the screen itself: moving a session rewrites its date in the workbook, so the sheet keeps no memory that it ever moved. The app now records its own moves on this phone, which is what makes the fourth figure possible and lets the weekday chart count a session against the day it was *planned* for. Moves made in Excel cannot be seen and are counted on the day they landed.',
            ]
        },
        {
            version: '1.27.0',
            date: '2026-08-20',
            headline: 'The watch experiment, ended and removed',
            items: [
                'Sessions are logged by hand, as they were before. Four numbers and fifteen seconds, which is what the log form was built for.',
                'What was tried, in order, and why each one stopped. **Garmin’s own interface:** their Connect developer programme is open to companies rather than people — you apply as a legal entity, wait weeks for a manual review, and if approved Garmin pushes your data to a web server you are expected to run. This app has no server, which is the reason it costs nothing and keeps your training in your own Dropbox.',
                '**Apple Health, read by a Shortcut.** The watch does put every session into Health, and Shortcuts can write a file. But the Shortcuts action that reads Health offers a list of sample types, and on this phone that list has no Workouts in it at all. The whole route rests on an item that is not there.',
                '**A file exported from the Garmin Connect app.** The app exports no files, in any format. Its share menu offers an image or a link and nothing else, and that is Garmin’s decision rather than a setting to find. Exporting exists only on connect.garmin.com in a browser — six or seven taps to save fifteen seconds of typing, which is not a trade worth making on a Tuesday.',
                '**Strava as a bridge.** Garmin does sync to Strava automatically, and Strava’s API is open to anyone. But completing its sign-in requires a step Strava deliberately refuses to browsers, so it needs a server as well.',
                'Every remaining route needs either a server or a paid third-party app. Both are possible; neither is this app, which is a page and a spreadsheet and nothing else. That property is worth more than the fifteen seconds.',
                'So all of it is gone rather than left lying about: the reader for TCX and GPX files, the module that matched a recorded session to a planned one, the card on the Today screen, the Settings row, the styling, the test, and three attempts at instructions. Nothing about logging by hand changed, because that part was always the part that worked.',
            ]
        },
        {
            version: '1.26.1',
            date: '2026-08-20',
            headline: 'Where the export actually is',
            items: [
                'The Garmin Connect app exports no files in any format — its share menu offers an image or a link, and that is deliberate on Garmin\u2019s part. The instructions said to export from the app, which cannot be done. Exporting is on connect.garmin.com in a browser, and that is what they say now.',
                'They also say, plainly, that this is worth doing for a race or a session you want exactly right and is not worth doing for a Tuesday. Four numbers typed into the log form take fifteen seconds.'
            ]
        },
        {
            version: '1.26.0',
            date: '2026-08-20',
            headline: 'One way in from the watch, not two',
            items: [
                'The Apple Health route is gone, along with everything that served it: the file the app went looking for in Dropbox on every read, the parser for it, the status line about it, and three sections of instructions for a Shortcut that cannot be built on every phone.',
                'What remains is the way that works: Settings → From your watch → Open, and pick a TCX or GPX exported from Garmin Connect. Everything after that — matching, filling the form, leaving the workbook alone until you save — is unchanged, because that part was never the problem.',
                'How this works says it once now, in one section, describing only what the app actually does.'
            ]
        },
        {
            version: '1.25.0',
            date: '2026-08-20',
            headline: 'Open a workout file from Garmin Connect',
            items: [
                'Settings → From your watch → Open a workout file reads a session exported from Garmin Connect as TCX or GPX. It arrives under "From your watch" on the Today screen like anything else: offered, matched to the planned session, written only when you save the form.',
                'This exists because the Shortcuts route does not work on every phone — on some versions of iOS the Find Health Samples action has no Workouts type at all, and no amount of better instructions makes one appear. This way needs no Shortcut, no Apple Health and no Dropbox: export, open, done.',
                'From a TCX it reads duration, distance, calories and heart rate as recorded, added up across laps so an interval session comes out whole. From a GPX it works them out: duration from the first and last point, distance by measuring the line, heart rate from the points.',
                'How this works now leads with the file and treats the Shortcut as the optional automation it is, saying plainly how to tell in one minute whether your phone can do it at all.'
            ]
        },
        {
            version: '1.24.2',
            date: '2026-08-20',
            headline: 'Where Workouts actually is in that list',
            items: [
                'The type list in Find Health Samples is alphabetical and enormous, and Workouts sits near the bottom in the W’s. The instructions said to use a search box that not every version of iOS has, which left the impression there was no Workouts type at all. They now say where it is and how to get there.'
            ]
        },
        {
            version: '1.24.1',
            date: '2026-08-20',
            headline: 'Step two, as the screen actually looks',
            items: [
                'Find Health Samples does not arrive empty: it comes set to Steps, over the last seven days. The instructions now show what does appear, name both blue words that have to change, and say why the date one is not optional — the file carries no dates, so a week of sessions would all arrive as today.'
            ]
        },
        {
            version: '1.24.0',
            date: '2026-08-20',
            headline: 'The watch file is a sentence now, not JSON',
            items: [
                'Asking anyone to assemble JSON by hand in Shortcuts was a mistake — quotation marks around some values but not others, commas between entries, brackets round the lot, and a phone that turns a straight quote into a curly one so that none of it parses. The file is now one line per session in plain words and numbers: "Running, 42 min, 8.12 km, 138 bpm".',
                'Order does not matter, commas are optional, and the pieces are recognised by what they look like. Minutes, hours, a clock like 1:45:00, kilometres, metres, bpm, kcal — all understood. Only the sport or the duration is really needed.',
                'No date needed either: the app takes the day from the file itself, so the hardest part of the Shortcut disappears. A line may still carry a date if it is not today.',
                'The Shortcut instructions are rewritten tap by tap, including the part everyone gets stuck on — putting a variable inside a Text action and choosing which detail of it you want. Start with two values, get it working, add the rest after.',
                'JSON still works if you prefer it, and a file made under the old name is still found.'
            ]
        },
        {
            version: '1.23.1',
            date: '2026-08-20',
            headline: 'The watch bridge, written out in full',
            items: [
                'How this works now explains the Apple Health bridge properly, in two parts: what it is and what it will never do, and then the Shortcut itself — every action to add, the exact line of text to build, which values need quotation marks and which must not have them.',
                'It states the exact filename and folder for your own setup, gives a worked example you can drop in by hand to test the app before building anything, lists every field with its units and its alternative spellings, and ends with what to check when nothing appears.'
            ]
        },
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
