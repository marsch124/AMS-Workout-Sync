# AMS Workout Sync

A mobile-first PWA that reads your training plan straight out of an Excel workbook
in Dropbox, and writes what you log after a session back into that same workbook's
existing cells.

**Live:** https://marsch124.github.io/AMS-Workout-Sync/

## What it does

- **Today** — the session planned for today, broken into warm-up, intervals,
  technique and cool-down, colour-coded by discipline: swim, bike, run, strength,
  mobility (stretching is read as mobility — the same session by another name).
- **Plan** — the whole schedule grouped by day, showing what is still to come and
  what has already been logged.
- **Log** — a form that asks first for the numbers that suit the sport (pace for a
  run, power and cadence for a ride, per-100m pace for a swim, duration and effort
  for mobility), with every other column your sheet has one tap away and the choice
  remembered. Each field says which column it writes to.

  Columns your sheet computes for itself are never offered as inputs. A compliance
  column of the form `=IF(...,$L6/$G6)` is a formula, and writing a number into it
  would replace the formula for that row; instead the log form shows the planned
  duration and, as you type, what percentage of it you are at.
- **Missed** — a session that did not happen is marked as such in one tap, writing
  only the missed marker and leaving every metric cell untouched.
- **This week** — Today opens with the week drawn: a column per day, a bar per
  session, height by planned duration and colour by discipline. Hollow while
  outstanding, solid once recorded, hatched when missed; a rest day is a flat
  line rather than an empty column. Tap a day to see what is on it. Beneath it,
  the same week in words — sessions recorded against sessions planned, time done
  against time planned — computed from the plan already loaded rather than from
  any formula in the sheet.
- **Not recorded** — a session in the past that was never logged or marked missed
  falls through both Upcoming and Done by definition. Today says how many there
  are and Upcoming lists them first, so a forgotten Tuesday does not quietly
  distort the compliance figures.
- **Move** — a session can be moved to another day, or swapped with another one
  when you did the two the other way round. Only the date and weekday cells are
  rewritten, and the weekday is spelled the way your sheet already spells it.
  Moving something onto a rest day ends the rest day: the rest card is the
  workbook saying "nothing today", and once there is something that is no
  longer true. Nothing is written for it — move the session away again and the
  rest day comes back.
- **Photos** — any session takes photographs, from the camera or the library,
  added on the session itself or while logging it, and so does anything logged
  under *something else*. They are shrunk to 1600
  pixels on the long edge, so a season of them is tens of megabytes rather than
  gigabytes. They are **not** written into the workbook and are not in Dropbox:
  an `.xlsx` is the one file that matters here and pictures would mean adding
  drawings, relationships and anchors to it. So they live on the phone, which
  makes the app the only copy — Settings → Photos says how many there are and
  what they come to, and saves every one into a single zip named by day and
  sport. Resetting the app deliberately leaves them alone.
- **Something else** — an unplanned run, a hike, a meditation. The list of
  activities on offer is editable in Settings: add, remove and reorder them to
  match what you actually do. These go on their
  own `Extras` sheet, created on first use, with a column saying whether each one
  counts as training load. They are never written into the plan, so planned-versus-
  actual keeps meaning what it says. Everything logged this way is listed newest
  first, with its photographs, under Settings → Log something else.
- **Sheet setup** — the app works out which column is which from your headings, in
  English or German, and lets you correct the guess once. If you want to record
  something the sheet has no column for, it appends one — headed and formatted like
  the columns already there, and sized to suit what goes in it.

## Version

Current release is recorded in `js/version.js`, which also carries the changelog
shown in the app under Settings → Version → What's new. The service worker names
its cache after the version, so shipping a release retires the previous cached
copy rather than leaving a phone on older code — keep `APP_VERSION` in `sw.js` in
step with `AmsVersion.CURRENT`.

Settings → How this works is a guide to what the app reads, what it writes, and
what it will never touch. It reflects the workbook actually loaded, naming its
sheet, its units and its completed marker.

## Install it

Open the live URL on your phone and add it to the home screen — iOS: Share → Add to
Home Screen; Android: Menu → Install app. It then behaves as its own app, works
offline, and keeps nothing on any server.

## How it writes to Excel

The workbook is edited surgically rather than rebuilt. An `.xlsx` is a zip of XML
parts; the app rewrites only the `<c>` elements for the cells you filled in and
copies every other part across still compressed, byte for byte.

In testing, logging a session changed exactly **one of fourteen parts** in the file.
Charts, conditional formatting, freeze panes, column widths, number formats and
every formula in the columns it did not touch came through untouched.

Three details make that safe:

- A cell that held a formula and is logged into loses that formula — a stale one
  would simply recompute over the value you just entered.
- `xl/calcChain.xml` is dropped when that happens, and Excel rebuilds it on open.
- `fullCalcOnLoad` is set, so weekly totals, averages and the charts drawn from
  them recalculate the moment the file opens.

Durations are converted to whatever the sheet already uses — decimal hours, minutes,
or a real Excel time value — read from the column heading where it says so
("Duration (min)"), otherwise inferred from the data, and overridable in Sheet setup.

The marker written to a completed column is not assumed either. A plan that counts
its own sessions with `=COUNTIFS(...,$K:$K,"✓")` needs exactly that character, and
"Yes" would leave the tally silently at zero — so the workbook's own COUNTIF
criteria are read to discover both the completed and the missed marker. Both are
shown in Sheet setup for correction.

## Connecting Dropbox

The app is a static page, so it uses OAuth with PKCE: no server, no client secret.
You create a Dropbox app once (Settings walks through it step by step and shows the
exact redirect URI to paste), then paste in the public app key. The tokens live only
on your phone.

Uploads carry the `rev` of the copy that was downloaded. If you edited the workbook
on a laptop in the meantime, Dropbox rejects the write and the app replays onto the
newer version rather than burying your changes.

## Offline

Logging never waits on the network — pools and gyms have no signal. An entry is
queued on the phone and shown immediately; syncing then downloads the current
workbook, replays the queue onto it, and uploads. The last workbook read is cached,
so today's session is readable with no connection at all.

Without Dropbox at all, **Open a file** and **Save a copy** do the same job by hand.

Settings → Syncing shows exactly what is waiting, with any error it hit, and lets
you discard an entry that will never go through — a queue that silently refuses to
drain is otherwise indistinguishable from one that is working.

## Structure

```
├── index.html          # app shell and the hand-drawn icon set
├── manifest.json       # PWA configuration
├── sw.js               # service worker (offline shell)
├── css/style.css
└── js/
    ├── zip.js          # minimal zip reader/writer (Compression Streams)
    ├── photos.js       # pictures attached to a session, on this device only
    ├── xlsx.js         # xlsx parsing + surgical cell writes
    ├── mapping.js      # works out which column is which
    ├── plan.js         # workouts, disciplines, units, log fields
    ├── extras.js       # unplanned sessions, on their own sheet
    ├── version.js      # version number and changelog
    ├── dropbox.js      # OAuth PKCE + file download/upload
    ├── sync.js         # the offline queue and replay-on-sync
    ├── db.js           # IndexedDB: settings, queue, photos
    ├── ui.js           # screens and rendering
    └── app.js          # start-up
```

No build step and no dependencies. The zip and xlsx layers are written against the
browser's own Compression Streams, which is why the app works offline and pulls
nothing from a CDN.

## Developing

```bash
python3 -m http.server 7794
```

Then open `http://localhost:7794/`. Dropbox sign-in needs the local address
registered as a redirect URI in the Dropbox App Console; Settings shows you the
exact string to add.

## Privacy

Your training data stays in your Dropbox and on your phone. Nothing is sent
anywhere else — there is no backend, no analytics and no accounts. Photographs
never leave the device at all: they are not uploaded, not synced and not part
of the workbook, which is why the app gives you a way to save them out.
