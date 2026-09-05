# AMS Workout Sync

A zero-dependency vanilla-JS PWA that reads Martin's Excel training plan from
Dropbox and writes results back into the cells that are already there. No build
step, no framework, no server. Live at
<https://marsch124.github.io/AMS-Workout-Sync/>, served straight off `main` —
**every push to `main` publishes**, there is no workflow and no deploy step.

## Where things stand

Nothing outstanding. Shipped and confirmed working on his phone up to **v1.37.0**;
v1.38.0 then fixed all four findings of a full audit (persist() at boot, the
reset confirm counts the queue, darker light-mode sport palette, 44px tap halos
— guarded permanently by `tests/august-audit.js`). The audit itself is published
as an artifact ("The August Audit"). v1.39.0 added the *wash*: the week card's
background tints left-to-right with the week's passage (chosen from five
mocked variants; `weekFraction()` in ui.js, gradient on `.week-card`, guarded
by `tests/week-wash.js`; since 1.39.1 it ends at the grey rule — `.week-total` repaints the surface over it, so the edge follows the rule wherever the card's height puts it). Note for tests: `plain.xlsx` starts its week on
Wednesday and rests on Friday by design — tests that need *today* loggable use
`everyday.xlsx`, which has two sessions every day.

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

**v1.41.0** did two things Martin asked for in one message:

- *A session moved onto a rest day ends the rest day.* The rest card used to
  sit under the session he had just moved there. `visiblePlan()` in sync.js
  drops a rest row from any day that also holds training, and `forDay()`,
  `upcoming()`, `recent()` and the Plan tab all read through it. Nothing is
  written: the row is untouched and moving the session away brings the rest day
  back. `weekDays().isRest` was already `every(rest)` rather than `some(rest)`,
  so the week strip and the calendar export needed no change. Guarded by
  `tests/rest-day.js`.
- *Photographs on a session* — `js/photos.js`, two new IndexedDB stores, and a
  strip on both the session screen and the log form. They do not go in the
  workbook and cannot; see the note at the top of that file. Guarded by
  `tests/photos.js`. `AmsZip.build()` was added for the export, and is the
  only zip writer in the app that does not start from an existing archive.

**v1.42.0** put photographs on extras too, which he asked for as soon as he saw
1.41.0. The hard part was identity, and the answer is worth keeping:

- An extra is a queue entry while it waits and a row on the Extras sheet after
  it syncs, and **neither survives the other** — so neither can be what a
  photograph hangs on. `AmsExtras.keyFor()` names one by day + activity label +
  minutes, which is exactly the triple `alreadyRecorded()` already uses to
  recognise an extra it has written. The label rather than the id, because the
  label is what goes into the sheet and comes back out of it, so renaming an
  activity does not detach pictures from rows written months ago.
- `AmsPhotos.belongsTo()` skips the sport guard for an extra key. The guard
  exists for sheet+row identity, which extras do not have; applying it anyway
  meant double jeopardy every time the activity list was edited.
- Photos on the **new**-extra form are held, not stored — there is no owner
  until Save. `heldExtraPhotos` in ui.js, attached in `saveExtra()` *after* the
  log succeeds. They make the form dirty on purpose, and `mayLeaveForm()` names
  them.
- **Extras got a screen** (`extrasScreen`, `renderExtrasList()`). They used to
  be visible only on the day they happened, which was fine while an extra was
  just a row in a sheet. A photograph is not in the sheet, so a view that
  expires at midnight was no longer good enough.
- Guarded by `tests/extra-photos.js`. Note its step 3 asserts the orphan check
  *still fails* without extras in the owner list — otherwise the test would
  pass for the wrong reason.

**v1.43.0** added *Settings → Send it to somebody*: Messages, the share sheet,
or the link on the clipboard. Two things in it are load-bearing:

- `appUrl()` derives the link from where the app is running, **except** on
  localhost, a loopback address, `file:`, or plain http, where it falls back to
  the published address. Sending a localhost link looks exactly like sending a
  good one, which is the whole reason for the guard.
- The `sms:` body form differs by platform — iOS `sms:&body=`, everyone else
  `sms:?body=` — and each ignores the other's, so the wrong one opens Messages
  **empty** rather than failing. The iPad case (UA says "Macintosh") must be
  read together with the UA, not beside it: `platform === 'MacIntel'` alone
  called an emulated Android phone an iPad.

The message deliberately carries more than the link: opened with nothing behind
it the app says "No workbook yet", which reads as broken. Guarded by
`tests/share-app.js`, whose failures would otherwise all be silent ones.

**v1.44.0** is nine things he asked for in one message, mostly wording and
layout. The ones with a reason behind them:

- **Add moved back after the photographs** — it had been put first in 1.41.0
  because the strip scrolled sideways and the button fell off the end. The
  strip now *wraps* instead, which is what makes his placement possible. Those
  two changes only work together; `tests/screen-wording.js` asserts both, at a
  phone-sized viewport, or the wrap test passes without wrapping.
- **Perceived effort** is a narrow box with a live description beside it
  (`RPE_SCALE`, `rpeNote()`, `wireRpe()`). Half-steps read *down*, and the
  number is not repeated in the words — it is an inch to the left.
- **`openNote()`** reuses the action sheet to explain rather than to ask: no
  actions, a note body, and Cancel becomes Close. `closeChoice()` and
  `openChoice()` both reset it, or the next question inherits the explanation.
  Topics live in `HELP_NOTES`, reached by `helpButton(topic)`.
- **Two sub-lines were reworded** because they sat directly above a row of
  buttons and read as captions for them ("On this phone only", "Opened from
  this device"). Anything placed there has to name what it describes.
- **The Setup and connection fold moved inside the Workbook group**, which
  meant reordering Photos to come *before* Workbook — the fold now closes the
  group, so anything emitted between them would nest inside it.

**v1.45.0** found the cause of a complaint he had made five separate times, in
five different places, and it was not the wording:

- 🚨 **`.settings-row` centred its contents.** On any row whose description ran
  to two lines, that put the button level with the *description* instead of the
  title — so the grey line under a title was drawn shoulder to shoulder with a
  button and read as that button's label. Every "that line is misleading" he
  reported was a row in that state. `align-items: flex-start` fixes the class of
  bug; `tests/screen-wording.js` now measures it, row by row.
- Every settings description was rewritten to say **what its button does**, and
  the two he asked to have *deleted* (under the photo count, under the workbook
  name) are gone — nothing that could go there survived being read as a caption.
  The one useful thing the workbook line carried, where the file is, moved into
  the question mark (`whereTheWorkbookIs()`, and `HELP_NOTES` entries may set
  `where: true` to have it prepended).
- Mobility joined strength at `#eab308` / `#854d0e`. The light variant is
  chosen for the 4.5:1 the august audit enforces — do not "brighten" it.
- "Log something else" is **Extra activities** throughout. The activity *called*
  "Something else" in `DEFAULT_ACTIVITIES` was deliberately left alone: its
  label goes into the Extras sheet and into `AmsExtras.keyFor()`, so renaming it
  would detach photographs from rows already written.
- The effort scale opens all ten from a `?` beside the field, each tappable.
  The picker's target is held in `rpeScaleTarget` and handled by the delegated
  body listener — `openNote()` replaces the note's *contents*, not the element,
  so a listener attached there stacks up one per open.

**v1.46.0** — the Plan tab opens with `blockCard()`: eight weeks as eight rows,
same alphabet as the week strip on Today.

- 🚨 **One height scale across every week, never per row.** A recovery week is
  only legible as one if its bars are short beside its neighbours; scaling each
  row to its own tallest session flattens exactly the shape the drawing exists
  to show, and leaves a chart that looks fine and says nothing.
  `tests/plan-overview.js` asserts it against `block.xlsx`, an eight-week
  fixture with two recovery weeks in it.
- It sits at the **top** of the tab, on every segment, rather than filling the
  space under a short list — a panel that only appears when a list happens to
  be short is one you cannot rely on.
- Also: no rules between settings rows (he asked); **Save a copy removed** from
  the UI — but `AmsSync.exportWorkbook()` **stays**, because it is how
  `logging.js` and `foreign-extras-sheet.js` get the written workbook back to
  check it, which is the guard on his real file; and Settings has no eyebrow.

**Answered and done:** *which day slips* is gone (v1.40.0) — Martin said he was
not interested and never would be, so it came off rather than sit there looking
informative. Progress answers three questions now. Do not propose it again. The
attribution rule it forced (never believe a move whose sport no longer matches
its row) stays, because the moved-rather-than-lost count needs it too.

## How it is put together

`index.html` loads every module as a plain script, in order. No bundler.

| file | what it owns |
|---|---|
| `js/db.js` | IndexedDB: `kv`, `queue`, `photos`, `photoBlobs` |
| `js/photos.js` | pictures on a session or an extra: shrink, store, attribute |
| `js/zip.js` / `js/xlsx.js` | reading and writing `.xlsx` by hand |
| `js/mapping.js` | which column is which; heading signatures; collisions |
| `js/plan.js` | disciplines, parsing, `buildEdits` — what gets written |
| `js/extras.js` | the Extras sheet (things the plan did not ask for) |
| `js/ics.js` | calendar export (RFC 5545) |
| `js/stats.js` | the Progress tab's three figures. Pure, derives nothing stored |
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
7. **A photograph is the only copy.** It is not in the workbook, not in
   Dropbox, and not synced. So `AmsDb.reset()` deliberately leaves the photo
   stores alone, the export must stay working, and anything that deletes
   photographs asks first. Two stores rather than one, because the metadata is
   read whole at every boot and the pictures must not come with it.
8. **Never show a photo against a session whose sport no longer matches.** Same
   rule as the move log, same reason: sheet + row is not a stable identity, and
   a picture filed against the wrong session is worse than one shown nowhere.
   `AmsPhotos.orphans()` is what stops "shown nowhere" becoming "lost". It takes
   *owners* — the plan plus every extra — so a picture on a walk is not counted
   as adrift.
9. **Anything that points at an extra points at it the way the writer does.**
   `AmsExtras.keyFor()`, which mirrors `alreadyRecorded()`. If those two ever
   disagree, photographs come off their extras silently at the next sync.

## Releasing

Four things move together, or the app ships stale on a phone:

- `CURRENT` in `js/version.js` + a changelog entry (newest first)
- `APP_VERSION` in `sw.js`
- every `?v=` in `index.html` (15 of them)
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
`move-log`, `leaving-a-form`, `week-wash`, `august-audit`, `rest-day`,
`photos`, `extra-photos`, `share-app`, `screen-wording`, `plan-overview`. Fixtures are synthetic and gitignored — **no real
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
book needs `Notes` typed into the header cell right of *Compliance* by hand
(offered, his call, may be done by now).

**Do not name his Dropbox files.** `ironman.xlsx` and `Pre-Season 2026.xlsx` are
the names of the *local copies* in the scratchpad; nobody here knows what they
are called in his Dropbox. Say "your Ironman plan" and let the file picker
show him his own names.

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
