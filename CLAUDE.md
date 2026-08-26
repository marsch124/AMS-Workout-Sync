# AMS Workout Sync

A zero-dependency vanilla-JS PWA that reads Martin's Excel training plan from
Dropbox and writes results back into the cells that are already there. No build
step, no framework, no server. Live at
<https://marsch124.github.io/AMS-Workout-Sync/>, served straight off `main` —
**every push to `main` publishes**, there is no workflow and no deploy step.

## Where things stand

Nothing outstanding. Shipped and confirmed working on his phone up to **v1.37.0**.

The last run of work came from the input page and from screenshots:

- the shared `Avg Pace/Pwr` column now asks each sport its own question (1.33.0)
- a decimal comma no longer loses the number — see invariant 5, which is the
  general rule that fell out of it (1.34.0, and 1.34.1 for the second form,
  which was missed the first time)
- back asks before discarding a form with typing in it (1.35.0). A Cancel
  button was considered and rejected: back already is Cancel, two identical
  exits is worse than one, and splitting the footer would shrink Save, which is
  pressed hundreds of times a season. Guarded screens are in `GUARDED_FORMS`;
  dirtiness is tracked by a captured listener on the document, because both
  forms rebuild themselves and per-field listeners would go with the old inputs
- the week card's bar moved below the line it measures, with a rule closing off
  the day columns (1.36.0), and is now drawn hollow-for-planned, solid-for-done
  like everything else on that card (1.37.0)

The open question is for Martin, not the code: after a month of real training,
is **which day slips** on the Progress tab worth keeping, or does he already
know the answer? If the latter it should come off rather than sit there looking
informative.

## How it is put together

`index.html` loads every module as a plain script, in order. No bundler.

| file | what it owns |
|---|---|
| `js/db.js` | IndexedDB: `kv` store, `queue` store |
| `js/zip.js` / `js/xlsx.js` | reading and writing `.xlsx` by hand |
| `js/mapping.js` | which column is which; heading signatures; collisions |
| `js/plan.js` | disciplines, parsing, `buildEdits` — what gets written |
| `js/extras.js` | the Extras sheet (things the plan did not ask for) |
| `js/ics.js` | calendar export (RFC 5545) |
| `js/stats.js` | the Progress tab's four figures. Pure, derives nothing stored |
| `js/dropbox.js` | OAuth 2 PKCE, retries, timeouts |
| `js/sync.js` | state, the queue, load/sync, the move log |
| `js/ui.js` | every screen (~3,000 lines) |
| `js/version.js` | `CURRENT` + the changelog shown in-app |

## Invariants — do not break these

1. **Only the cells asked for are written.** Other parts of the archive are
   copied through still-compressed, with their original CRC. A logging round
   trip leaves 17 of 19 parts byte-identical. Tests assert this.
2. **Never write into a plan column.** `protectPlanColumns()` and
   `collisions()` exist because writing a duration over the workout text is
   unrecoverable.
3. **A saved layout is checked against the workbook in hand** before writing —
   `mappingForWorkbook()` / `headingsHold()`. Both `load()` *and*
   `loadFromFile()` must call it. (v1.32.0 fixed a hole where the local-file
   path did not.)
4. **The Progress sheet is never read.** Its cells are formulas, and a saved
   file carries the answer Excel last computed. After the app writes,
   `Progress!E15` still caches the old value. Everything in `js/stats.js` is
   derived from the session rows instead.
5. **No `type="number"` on any logging form.** A number input reports `""` for
   anything it cannot parse with a full stop, so a decimal comma is silently
   discarded — the field looks filled and the value never arrives. Use
   `type="text"` with `inputmode` (`decimal` for fractions, `numeric` for whole
   numbers). Every writer downstream already does `.replace(',', '.')`.
   The two row-number boxes in Sheet setup may stay `number`: whole numbers, and
   `inputmode="numeric"` offers no separator to press.
6. **Nothing reaches the workbook until Save.** The queue is the boundary.

## Releasing

Four things move together, or the app ships stale on a phone:

- `CURRENT` in `js/version.js` + a changelog entry (newest first)
- `APP_VERSION` in `sw.js`
- every `?v=` in `index.html` (14 of them)
- commit, then `git push -u origin main`

The changelog is written for Martin, not as a commit log — say what changed and
why it mattered, in plain sentences.

## Testing

Real browser, real workbooks, no assertions library. Each script prints what it
found and ends with `errors: none`.

```bash
python3 -m http.server 7810          # from the repo root
python3 tests/make-fixtures.py       # needs openpyxl
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
export NODE_PATH=<scratchpad>/node_modules       # playwright lives there
node tests/failure-paths.js          # and the rest
```

Repo tests: `failure-paths`, `column-collision`, `foreign-extras-sheet`,
`edited-workbook`, `calendar-export`, `session-share`, `progress`, `logging`,
`move-log`, `leaving-a-form`. Fixtures are synthetic and gitignored — **no real
training data in this repository**.

Extra scripts live in the session scratchpad and drive Martin's *real*
workbooks (`ironman.xlsx`, `Pre-Season 2026.xlsx`): `e2e-iron.js`,
`e2e-guide.js`, `t-legend.js`, `t-settings.js`, `t-missed-count.js`,
`t-roundtrip.js`. Run these too before shipping — `e2e-iron` has caught real
regressions the fixtures could not.

## The workbooks

Martin is on **Pre-Season 2026** (25 sessions) until the **Ironman 2027** plan
starts **7 September 2026** — 419 sessions, race at Kalmar **8 August 2027**.
Switching workbook is done in Settings → Workbook; the layout is re-read then.

Both share a layout except Pre-Season has a `Notes` column at R. The Ironman
book needs `Notes` typed into R1 by hand (offered, his call, may be done by now).

The sheet's `Avg Pace/Pwr` column asks a different question per sport, so the
form follows it: **km/h** on a bike, **min/km** on a run, **per 100m** on a
swim. He does not want to enter power.

## House style

Comments explain **why**, not what — the reasoning that would otherwise be lost,
including what was tried and rejected. Full sentences. No decoration, no
hedging, no exclamation marks. The same voice in the changelog and in the app's
own prose. When something cannot be done, say so plainly and say what is
possible instead.

Believe Martin about what is on his screen. A screenshot beats any
documentation, and re-asserting against it has gone badly before.
