# AMS Workout Sync

A mobile-first PWA that reads your training plan straight out of an Excel workbook
in Dropbox, and writes what you log after a session back into that same workbook's
existing cells.

**Live:** https://marsch124.github.io/AMS-Workout-Sync-/

## What it does

- **Today** — the session planned for today, broken into warm-up, intervals,
  technique and cool-down, colour-coded by discipline: swim, bike, run, mobility,
  stretching, strength.
- **Plan** — the whole schedule grouped by day, showing what is still to come and
  what has already been logged.
- **Log** — a form that asks only for the numbers that suit the sport (pace for a
  run, power and cadence for a ride, per-100m pace for a swim, duration and effort
  for mobility) and only for the ones your sheet has a column for.
- **Sheet setup** — the app works out which column is which from your headings, in
  English or German, and lets you correct the guess once.

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
or a real Excel time value — inferred from the data already in the column and
overridable in Sheet setup.

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

## Structure

```
├── index.html          # app shell and the hand-drawn icon set
├── manifest.json       # PWA configuration
├── sw.js               # service worker (offline shell)
├── css/style.css
└── js/
    ├── zip.js          # minimal zip reader/writer (Compression Streams)
    ├── xlsx.js         # xlsx parsing + surgical cell writes
    ├── mapping.js      # works out which column is which
    ├── plan.js         # workouts, disciplines, units, log fields
    ├── dropbox.js      # OAuth PKCE + file download/upload
    ├── sync.js         # the offline queue and replay-on-sync
    ├── db.js           # IndexedDB
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
anywhere else — there is no backend, no analytics and no accounts.
