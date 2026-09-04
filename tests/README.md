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
the same check run there would pass by finding nothing.

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
taps from the day columns.

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
pictures are drawn on a canvas rather than shipped as fixtures.

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

## Fixtures

`make-fixtures.py` writes synthetic workbooks into `tests/fixtures/`. Nobody's
real training plan is in this repository, and none should be: a test that fails
should point at the app, not at data that cannot be replaced.
