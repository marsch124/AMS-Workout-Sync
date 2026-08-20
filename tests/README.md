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

**`column-collision.js`** — a mapping that points a results column at a column
the plan lives in. Logging must refuse to write there rather than overwrite the
workout text in the sheet.

**`foreign-extras-sheet.js`** — a workbook that already has a sheet called
`Extras` belonging to somebody else. The app must leave it alone and take
another name.

## Fixtures

`make-fixtures.py` writes synthetic workbooks into `tests/fixtures/`. Nobody's
real training plan is in this repository, and none should be: a test that fails
should point at the app, not at data that cannot be replaced.
