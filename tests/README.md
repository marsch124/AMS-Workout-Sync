# Tests

These are not unit tests. They drive the real app in a real browser and ask
what it does when things go wrong — which is the only question worth asking of
an app whose job is to write into the one copy of somebody's training plan.

## Running them

```bash
python3 -m http.server 7810          # serve the app from the repo root
python3 tests/make-fixtures.py       # synthetic workbooks (needs openpyxl)

npm install playwright               # once; Chromium comes with it
# CHROME_PATH=/path/to/chrome       # only if Playwright's own build is not wanted
node tests/failure-paths.js
node tests/column-collision.js
node tests/foreign-extras-sheet.js
node tests/edited-workbook.js
node tests/calendar-export.js
node tests/session-share.js
node tests/progress.js
node tests/logging.js
node tests/move-log.js
node tests/leaving-a-form.js
node tests/august-audit.js
node tests/week-wash.js
node tests/rest-day.js
node tests/photos.js
node tests/extra-photos.js
node tests/share-app.js
node tests/screen-wording.js
node tests/plan-overview.js
node tests/as-planned.js
node tests/say-it.js
node tests/road.js
node tests/is-it-working.js
node tests/new-writes.js
node tests/extras-identity.js
node tests/conflict.js
node tests/waiting.js
node tests/extra-bars.js
node tests/correcting.js

node tests/voice.js          # no browser, no server — pure parser
node tests/trends.js         # no browser, no server — pure arithmetic
node tests/load.js           # no browser, no server — pure arithmetic
node tests/rough-input.js    # no browser, no server — parser and arithmetic
```

Each script prints what it found and ends with `errors: none`. Nothing is
asserted automatically — read the output. These are the checks a person would
otherwise have to remember to make by hand, not a gate.

The scripts point at `http://localhost:7810/` and read their workbooks from
their own directory, so run them from the repo root.

## What each one covers

**`failure-paths.js`** — the ways reality attacks the app:

- a file that is not a workbook, and a workbook cut short mid-download
- a corrupt copy already cached on the phone (it must be discarded, not
  re-read on every launch for ever)
- one bad entry in the sync queue, which must not stop the good ones going up
- a workbook the writer produced but cannot read back, which must never be
  uploaded over the good one
- a network that accepts the connection and then says nothing
- what the network layer says out loud when it times out, when there is no
  signal, when Dropbox rate-limits, and when it returns 500 twice
- a workbook whose text is `<img src=x onerror=…>`

**`edited-workbook.js`** — the workbook is rewritten in Excel while a logged
session is still waiting to sync. Same number of rows, different content:

- a session reworded and its duration changed — the result must still land on it
- that row turned into a different sport — nothing may be written there, and the
  entry must be kept with the reason
- the session moved further down the sheet — it must be followed
- a column inserted, shifting every heading right — the layout must be read
  again rather than written into the old column positions

**`calendar-export.js`** — a week handed to the calendar. The file has to
satisfy something old and fussy (RFC 5545) or a calendar refuses it without
saying why: CRLF endings, lines folded at 75 **octets**, commas and semicolons
escaped, and an all-day event whose end date is the day after its start.

**`session-share.js`** — one session sent on its own, by both routes: the
share button on the session, and the picker in the week sheet. Checks the
message, the single-event calendar file, and that the picker offers everything
in this week and next.

**`progress.js`** — the Progress tab, over twelve weeks of history built with
a known shape: Thursday is the day that slips, swim is the sport that runs
behind, the last fortnight is clean. It checks that those are the answers it
finds, that a rest day is never counted as a session it could have kept, that
an unanswered session does not read as a completed one, and that a move is
remembered even though the workbook forgets it.

**`logging.js`** — what you type into the duration field, and what the card
does once the session is answered. A bare `45` must mean forty-five minutes.
The buttons must disappear once a session is logged *or* marked missed,
without stranding it: the card has to open the session, where Log, Missed and
Move all still are — which matters most for a missed session you did after
all. And the exception has to hold: a session moved *to* today keeps its
buttons, because it still needs doing.

It also checks that the one shared pace column asks each sport its own
question — km/h on a bike, min/km on a run, per 100m on a swim — and that the
field stays text rather than number, so a rider recording `168 W` can still
type it. That check needs `paced.xlsx`: `plain.xlsx` has no pace column, so
the same check run there would pass by finding nothing. Since v1.68.0 the same step logs an extra as well and demands **three** distinct edges — done, still-to-do, and extra — plus that the extra's frame is not the activity's own colour. A run logged as an extra is the case that makes the rule: it carries a green bar, so a green frame would read as a planned run completed.

**`move-log.js`** — the one thing this app remembers that the workbook does
not. Rescheduling overwrites the date, so the sheet forgets the move; the app
keeps its own record and the Progress screen leans on it. That makes it a
small database, and it is checked for the ways small databases go wrong:

- it outlives what it points at — a row inserted in Excel slides every session
  onto its neighbour's identity, and a move must not then be read against a
  session it has nothing to do with
- it gets written when the deed failed — a move whose queue write threw must
  leave no record behind
- it comes back from storage in an unexpected shape — strings, arrays, nulls,
  dates that are not dates

**`leaving-a-form.js`** — pressing back with something typed in. Back is the
only way out of a log form, and it discards; the confirm exists so it stops
doing that in silence. Most of this checks when it must *not* appear — on a
form nobody touched, and on the way out after a save — plus the awkward case:
the extras form rebuilds itself when the activity changes and must not forget
it had been typed into.

**`august-audit.js`** — the August quality check's four findings, kept fixed:
storage persistence is requested at boot, the reset confirm counts the queued
sessions it would delete, the sport colours hold contrast in light mode, and
the small controls are tappable at thumb size without their halos stealing
taps from the day columns. Since v1.70.0 the palette is bright in both themes
and the text ink is derived from it (`--sport-ink`, OKLCH lightness clamped
per theme), so the contrast step reads every colour back through a canvas —
`getComputedStyle` reports the derived ink as `oklch(...)`, and a digit
regex over that string measures nothing. It also fails if a label is ever
drawn in the raw fill.

**`week-wash.js`** — the tint that crosses the week card as the week passes.
Driven at three frozen moments of the current week — Monday 00:30, Thursday
noon, Sunday 23:30 — checking the fraction the gradient is built from, that it
is painted as background rather than DOM, and that nothing new can sit on a tap.

**`column-collision.js`** — a mapping that points a results column at a column
the plan lives in. Logging must refuse to write there rather than overwrite the
workout text in the sheet.

**`foreign-extras-sheet.js`** — a workbook that already has a sheet called
`Extras` belonging to somebody else. The app must leave it alone and take
another name.

**`rest-day.js`** — a session moved onto a rest day. The rest card must go from
Today and from the Plan list, the rest *row* must stay in the plan untouched
(nothing is written to the sheet for this), moving the session away again must
bring the rest day back, and a rest day nobody touched must be left alone.
Deliberately weekday-independent: the fixture rests on a Friday, which is only
today one day in seven.

**`photos.js`** — the pictures, which are the only thing the app holds that
exists nowhere else. A photograph goes in shrunk and comes back out as the
bytes that went in; it is shown against the session it was taken against and
never against a row whose sport has changed under it; one that can no longer be
placed is still counted and still exported; `AmsDb.reset()` does not take them;
and the zip the app builds reads back entry for entry, byte for byte. The
pictures are drawn on a canvas rather than shipped as fixtures. Since v1.67.0 it also checks the pictures reach the *card*, not just the session screen: four at 54px and a `+3` for the rest, each one holding an actual image rather than an empty frame. That last part is the whole point — the fault he reported was a thumbnail nobody ever filled in, and a test that only counted the elements would have passed on the version he was complaining about.

**`extra-photos.js`** — photographs on the things the plan did not ask for,
where the difficulty is identity. An extra is a queue entry while it waits and
a sheet row afterwards, and neither survives the other, so this drives one all
the way through: held on the form (and named in the question asked on the way
out), attached on save, and then the same key before and after a real round
trip through saved bytes. Renaming the activity underneath it must not detach
it, and the list of everything logged must be able to show and take one. Step 3
also asserts the orphan check *still fails* without the extras in the owner
list, so it cannot pass for the wrong reason.

**`share-app.js`** — passing the app on, where every possible failure is a
quiet one. A share that sends a localhost link looks exactly like one that
worked, and an `sms:` with the other platform's punctuation opens Messages
empty rather than failing. So: the link follows a move but never leaves the
machine when it cannot be reached from outside it; iOS gets `&body=` and
everyone else `?body=`; the message names the app, says a plan of their own is
needed first, and carries the Add to Home Screen step; and all three routes out
of the sheet do what they say. Needs no workbook.

**`screen-wording.js`** — the parts that are only words, and the layout
decisions that exist because of them. Every one of these was reported by the
person using the app rather than found here, which is the argument for writing
them down: a label that stops matching what it opens, a line that reads as a
caption for the buttons under it, an explanation hidden in a placeholder that
disappears the moment it is answered. Runs at a **phone-sized viewport** on
purpose — on a desktop one, five photographs and a button sit on one line and
the wrapping it checks would pass without ever being exercised. Since v1.65.0
it also measures the extra-activities add: 34px wide and hard against the right
of its heading row, with nothing full-width left behind it and no grey line of
text under it. Both halves matter — a smaller button with the old caption still
above it would be the v1.45.0 misread at a smaller size.

**`plan-overview.js`** — the eight-week card at the top of the Plan tab. Mostly
one assertion, made several ways: **the weeks share one height scale**. A
recovery week is only legible as one if its bars are visibly shorter than its
neighbours', and scaling each row to its own tallest session would flatten the
shape the drawing exists to show — the kind of mistake that leaves a chart
looking perfectly reasonable and saying nothing. Uses `block.xlsx`, eight weeks
with two recovery weeks at roughly half volume. Also checks it sits above the
list, appears on all four segments, and is not drawn as an empty frame when
there is no plan. Since v1.56.0 an extra may set that shared height, so a fifth
step logs one longer than any session in the whole block — the worst case — and
demands the weeks keep their order by ink and the lightest stay under 75% of
the heaviest. Rescaling is linear and the arc survives; what it is watching for
is the short end bunching on the floor height.

**`as-planned.js`** — the one-tap log. Its value is that it is not a form, so
what is guarded is that it stays as truthful as one: the planned duration and
the completed marker reach the sheet and **nothing else does**. An entry
carrying blank fields would put empty strings on top of numbers already in the
row, and a one-tap action that scribbles is worse than a form because nobody
looks. Also when it may be offered — not on a rest day, not without a planned
length, not on something already recorded, but yes on a missed session. Each of
those cases is opened through the "All" list, and the test fails if a case
could not be reached rather than passing on a null.

**`voice.js`** — the spoken-session parser, and the only test here that needs
neither a browser nor a server. That is the point of it: the parser was written
as a pure function so a few hundred phrasings can be thrown at it in a second.
It defends the promise he actually asked for — **order never matters** — by
running every multi-clause case forwards, backwards and shuffled and demanding
the same answer, plus spoken numbers ("forty five minutes", "heart rate one
thirty eight"), the awkward clock readings, and that nothing is invented or
silently dropped.

**`say-it.js`** — the same thing wired to the form. Mostly one assertion: after
reading a sentence in, **the queue is still empty**. It fills fields and never
saves, which is what makes a mishearing harmless. Also the shared
`Avg Pace/Pwr` column, which means km/h on a bike and per-100m in the pool, and
that the box still works with the browser's recogniser taken away — which on
his phone is the likely case.

**`road.js`** — the whole build, at the top of Progress. Everything it shows is
read out of the workbook, so what is guarded is that the reading stays honest:
the race and its date come from a row in the plan, and where there is no race
row the last day is called the last day rather than dressed up as one; the
phase bands are the plan's own shape and add up to the whole road; the marker
sits where today actually falls; the countdown changes unit as the race nears.
And the one that matters daily: **a session dated today is neither due nor
behind**. Uses `season-underway.xlsx`, which starts twenty weeks ago with the
past logged, because day one exercises none of those figures.

**`trends.js`** — the arithmetic behind "Is it working?", in plain node. This
is the only screen in the app that makes a claim about the person rather than
the plan, which puts a different weight on it: saying "you are getting fitter"
on three sessions and a warm afternoon would be worse than saying nothing, and
it would be believed. So most of what is tested is restraint — when it refuses
to answer, the size of the band in which it says "about the same", what it will
not count, and that the split is by count rather than by date so a winter gap
cannot compare a season with a fortnight. It also checks the measure moves for
*both* the reasons fitness moves it: faster at the same heart rate, and the
same speed at a lower one.

**`is-it-working.js`** — the same block once drawn, where what matters is the
wording. Each sport in the unit it is spoken in and never the ratio underneath;
every pace accompanied by the heart rate that produced it; the caveats on the
screen rather than in the comments; and, for somebody who has been logging
durations and nothing else, that it says what is missing instead of quietly
not appearing.

**`load.js`** — the weeks and the sport mix, in plain node. It exists because
the bug it guards has already happened: bucketing by "the last week beginning
on or before this day" is true of a session next March as much as of one this
Thursday, so the rest of an eleven-month plan fell into the current week and
twelve weeks reported three hundred hours. That the window has two ends is the
first thing tested. After it: a Sunday belongs to the week it ends, an
unanswered week looks empty rather than full, and what was done is kept apart
from what was asked for so a drift between them can be seen at all.

**`new-writes.js`** — the two new ways into the workbook, followed all the way
to the file. Both one-tap logging and a spoken sentence were tested where they
hand their values over, which is the easy half; this takes a season of 409
sessions, logs into it, saves, opens the saved file again and asks whether the
right cells got the right values *in the sheet's own units*, whether all 3,272
planned cells are unchanged, and whether the rest of the archive is still byte
for byte identical. A new writer is exactly the thing that quietly breaks
invariant 1, and nobody would notice until a chart in Excel stopped working.

Two of its four parts are there for one risk each. **Pace into a clock column**:
where Excel has decided the pace column is a time, `1:52` has to be stored as
112/86400 and keep its formatting — store 1.52 instead and the cell reads as
half past one in the morning. Both kinds of pace column are covered, and which
kind a sheet has is something the app works out by looking, so the test checks
that it looked correctly. **A whole mixed day**: a tap, a spoken session, a
photo, a move, a missed session and an extra, queued together and saved in one
go, then read back out of the file.

**`rough-input.js`** — fifty-two deliberately broken sentences and a pile of
malformed rows, in plain node, on two rules: never throw, and never invent. The
first rule is obvious. The second is the one that found things — a sentence
with no numbers worth having in it used to produce a plain `0`, and one
arrangement produced a number so small it was not really a number. Both would
have been written into the sheet as though they had been said. It also feeds
impossible rows to the two new statistics screens, where an infinite speed used
to pass a `> 0` check perfectly happily and turn every average downstream into
nothing at all.

**`extras-identity.js`** — the one bug in this round that was real. Extras are
appended rather than written to a known row, so the writer has to recognise what
it has already written; it did that by day, activity and duration, which
recognises a retry perfectly and cannot tell a genuine repeat from one. Two
half-hour walks on one day were one walk, and the second was reported as saved
and dropped from the queue, so nothing was left to retry. Each extra now carries
a reference of its own. The test holds the two halves apart — a repeat is
written, a replay is not — and, because his sheet already has extras in it from
before, checks that rows without a reference are still recognised the old way
and that the column gains its heading when something new is appended.

**`extra-bars.js`** — the pink bars: everything logged outside the plan, drawn
in the week strip on Today and in the eight-week block on Plan. The week card
already said "· 40m extra" in its figures, which is a sentence you have to
read, while the drawing above it showed nothing at all. Four things have to
stay true: an extra draws a bar on its own day whatever else is there; the pink
belongs to no discipline, because colour is how that drawing says which sport;
a rest day walked on keeps its rest line; and — the one that could go wrong
without looking wrong — **the height scale takes the extras in**. Scaling
against the biggest *planned* day lets a two-hour hike draw a bar taller than
the column that holds it, so the test measures it with a 2h extra in a week
whose biggest day is 65m. The same rule on the Plan tab is guarded in
`plan-overview.js`, where a long extra must not flatten the block. Since v1.69.0 a last step follows an extra to the **Plan tab**: it must be listed under Done and under All, under the day heading it belongs to, and on neither Upcoming nor Missed — an extra is logged the moment it exists, so it is never either of those.

**`correcting.js`** — coming back to a log to fix a number you got wrong.
Mostly one assertion, and it is a negative one: **the boxes stay empty**. An
empty box means "leave that cell exactly as it is", which is the entire reason
it is safe to correct one number out of five, and prefilling the boxes with
what is recorded is the obvious improvement that silently retires it — every
save becomes a rewrite of every cell, and a stale value nobody looked at goes
back into the sheet as though it had been confirmed. The current value is shown
*beside* the box instead and goes in only when tapped. Also: the form says
which job it is, every value the session screen shows is offered on the form
with the same text (two readings of one cell being how a hint starts lying),
correcting the duration would write that cell and the completed marker and
nothing else, and a session with nothing recorded gets the original question
and no offers at all. Uses `season-underway.xlsx`, whose past sessions carry
four different values apiece.

**`conflict.js`** — what happens when the workbook changed in Dropbox while the
phone still had logging waiting. Dropbox is stubbed, because the real thing
cannot be made to conflict on demand and this is entirely about behaviour when
it does. Three things that pull against each other: nothing lost when an upload
is refused, nothing written twice when the retry succeeds (extras included,
since those append), and the file left alone when it cannot get through at all.
The path existed and was carefully built; nothing had ever run it.

Its own trap: **logging starts a sync by itself** as soon as Dropbox is
connected, so a test that queues entries against a connected stub finds its
work already uploaded and every explicit `sync()` answering `already-syncing`.
The stub starts disconnected and is switched on once the queue is arranged.

**`waiting.js`** — the warning that logging has not reached the workbook. Most
of what it tests is the silence: nothing with an empty queue, nothing for
something logged seconds ago, and nothing left behind once the queue goes up.
A warning that appears on an ordinary day is one he would learn to ignore, so
it says nothing until something has been stuck for a full day.

## Fixtures

`make-fixtures.py` writes synthetic workbooks into `tests/fixtures/`. Nobody's
real training plan is in this repository, and none should be: a test that fails
should point at the app, not at data that cannot be replaced.

`paced-time.xlsx` is worth a word: its pace column is formatted as a clock and
carries three weeks of real values, because the app decides how to write a pace
by looking at what is already in the column. An empty column tells it nothing,
so a fixture that only has today in it cannot exercise the path at all.

`season-unstarted.xlsx` is `season.xlsx` shifted a week later, so it begins
next Monday. `season.xlsx` starts on *this* week's Monday, which means it is
only a plan that has not started when the suite happens to be run on a Monday —
every other day it has unrecorded sessions behind it and `road.js` failed for
the right reason. Fixtures are dated relative to the day they are written, so
regenerate them before a run.

`legacy-extras.xlsx` is the shape of a sheet this app wrote before extras
carried a reference: ten headings, no eleventh, rows identified only by day,
activity and length. He has one. It is the fixture that proves the change is
safe on the file he already owns rather than only on a new one.
