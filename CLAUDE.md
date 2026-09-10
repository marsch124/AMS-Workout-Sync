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
`everyday.xlsx`, which has two sessions every day. 🪤 **Fixtures are dated
relative to the day they are generated, so regenerate them before a run** — a
stale `season.xlsx` fails `new-writes` and `road` with errors that look like
code faults. And a fixture built from `monday_of_this_week()` is only
"unstarted" when the suite is run on a Monday: `road.js` uses
`season-unstarted.xlsx` (`weeks_behind=-1`, so it begins next Monday) for
exactly that reason.

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

**The five-part programme he asked for on 2026-09-07** (all of it, in order):
1 one-tap logging · 2 speak it · 3 the road to Kalmar · 4 do the trends show it
working · 5 charts on Progress. One release each.

- **Stage 0 (done, no change needed).** He switched to the 419-session Ironman
  book. Measured on a 409-session fixture (`season.xlsx`) at 4× CPU throttle:
  open + build the plan 154 ms, `renderToday` 3 ms, `renderPlan` with 409 cards
  68 ms, `visiblePlan()` 0.08 ms a call. The performance worry was unfounded —
  do not "optimise" this on suspicion.
- **v1.47.0 — one tap.** `logAsPlanned()` queues `{ actualDuration: <planned
  minutes as a plain string> }` and nothing else, so `buildEdits` reaches
  exactly two cells. That "and nothing else" is the whole safety property, and
  `tests/as-planned.js` asserts it: an entry carrying blank fields would put
  empty strings over numbers already in the sheet.

- **v1.48.0 — say it.** `js/voice.js` is a **pure** parser (text in, values
  out) precisely so it can be shouted at with hundreds of phrasings by
  `tests/voice.js` with no browser at all; `tests/say-it.js` covers only the
  wiring. Three rules hold it up:
  - **Order never matters** — he asked for that outright. Identification is by
    the words around a number, never by position. Bare numbers fall back to
    Garmin's per-sport order *and* a plausibility range, so 620 does not become
    a swim pace.
  - **It fills the form and never saves.** That is what lets it guess at all.
    `say-it.js` asserts the queue is still empty afterwards.
  - **The box, not the microphone, is the feature.** The keyboard's own
    dictation works on every phone; `SpeechRecognition` is unreliable in a
    home-screen PWA, so the mic button is drawn only when present.
  - 🪤 His sheet has one shared `Avg Pace/Pwr` column meaning km/h on a bike,
    min/km on a run, per-100m in the pool. `readIntoForm()` routes a spoken
    speed into `avgPace` when there is no `avgSpeed` column and the sport's
    pace field asks for km/h.

- **v1.49.0 — the vocabulary, published.** The guide's word list is **generated
  from `AmsVoice.vocabulary()`**, which reads the parser's own `UNITS`/`LABELS`
  tables. A hand-typed list would be wrong the first time a word was added.
  `tests/say-it.js` asserts every known word appears in the rendered guide
  (108 of 108), and `tests/voice.js` asserts every *published example* actually
  parses into the field it is filed under.
  - 🪤 `PHRASES` rewrites text before the numbers are read, and the rules can
    eat each other: `an hour → 60 minutes` destroyed `32 kilometres an hour`
    until the speed rule was put first. `PHRASES_AFTER` runs post-digits, which
    is the only point at which "seven out of ten" is "7 out of 10" and the ten
    can be folded away.

- **v1.50.0 — the road to the race** (`roadCard()`, top of Progress). Read
  wholly from the workbook: the race is a row whose sport reads as `race`, the
  phases are the phase column, the hours are `plannedDurationSeconds`. Nothing
  configured, nothing stored.
  - 🚨 **Today counts as neither due nor behind** — `dayKey < today`, the same
    line `outstanding()` draws. Counting today's session as due would open the
    screen by telling him he is behind on a ride he has not been out on yet.
  - No race row → "the last day of the plan", never an invented race. No phase
    column → no bar, the rest still draws. Both asserted in `tests/road.js`.
  - Fixtures: `season.xlsx` (409 sessions, 49 weeks, a Phase column and a race
    row) and `season-underway.xlsx` (the same started 20 weeks ago with the
    past logged) — the second exists because day one exercises none of the
    interesting figures.
  - 🪤 Testing trap: the dev **service worker caches fixture fetches**. A
    regenerated `.xlsx` kept loading as the old one until the caches were
    cleared. And a saved mapping is reused when the recorded headings still
    hold, so adding a column to a fixture needs `AmsDb.remove('mapping')`.

- **v1.51.0 — colour.** He asked for the Today page to "pop", naming the
  planned-but-not-done sessions. `.week-bar-seg.is-todo` was a bare outline;
  the **light-mode sport colours are deliberately dark** (they carry text
  contrast, guarded by `august-audit`), so an outline of one reads grey. Now
  tinted at 26% inside a full-strength edge — hollow still reads as *not done*.
  Same on `.block-bar.is-todo`. Also: a wash in the empty week-progress track,
  and `.empty-state` padding cut from 2.75rem to 1.8rem because a rest day was
  pushing the one colourful thing on the page (Coming up) below the fold.

- **v1.52.0 — is it working.** `AmsStats.trends()` (pure; `stats.js` now has a
  `module.exports` guard so `tests/trends.js` runs in plain node). Measure:
  speed \u00f7 heart rate, which moves for both of the reasons fitness moves it.
  Fed by `AmsSync.trendRows()` \u2192 `actualsOf()`, which normalises queue and
  sheet to one shape and **derives speed from distance \u00f7 time** rather than
  reading the pace column \u2014 that column is km/h, min/km and per-100m
  depending on the sport, and no average of those three means anything.
  - 🚨 **This is the only screen making a claim about him, not the plan.** The
    restraint is the feature: 8 complete sessions per sport minimum, easy
    (rpe\u22645) preferred when there are enough, a \u00b13% dead band, implausible
    heart rates dropped, and the split is **by count not by date** so a winter
    gap cannot compare a season with a fortnight.
  - The ratio itself is never shown; each sport appears in its own unit. A test
    asserts that, and asserts the caveats are on screen rather than in comments.
  - A sport recorded *without* heart rates still gets an entry, so the block can
    say what is missing instead of vanishing.

- **v1.53.0 — the charts.** `AmsStats.load()` (pure) buckets rows into weeks
  and sports; `weeksChart()` and `sportsChart()` draw them. **This finished the
  five-part programme.**
  - 🚨 `load()` needs `endExclusive` as well as `weekStarts`. "The last week
    beginning on or before this day" is true of a session next March as much as
    of one this Thursday, so without it the whole rest of an eleven-month plan
    fell into the current week and twelve weeks reported 300 hours. Caught by
    the chart looking wrong, now first in `tests/load.js`.
  - 🪤 A row badge and the sentence under it must be computed the same way. The
    badge rounded the percentages, the sentence tested the raw ratio, and swim
    showed "-5" while the sentence said only bike had drifted. `driftOf()` is
    now the single source and `is-it-working.js` asserts the two agree.
  - Hours, not counts, on purpose — that is what separates this from "which
    sport runs behind" lower down the same screen.

**v1.54.0 — the week's work taken apart on purpose.** No screen moved. The
round trip through a real workbook is now followed cell by cell (409 sessions,
3,272 planned cells compared before and after), a pace column Excel treats as a
clock is tested in both forms, 52 deliberately broken sentences are read to the
parser, and both new screens step over an implausible row rather than emptying
themselves on it. `tests/new-writes.js` and `tests/rough-input.js` came out of
it.

**v1.55.0 — two dog walks are two dog walks.** Shipped from another session
while the drawing below was in flight; both were numbered 1.55.0 and this one
reached `main` first, so the drawing became 1.56.0.

- 🚨 **An extra needs an identity of its own.** Extras are appended rather than
  written to a known row, so `alreadyRecorded()` has to recognise what it has
  already written — and it did that by day + activity + duration, which
  recognises a *replay* perfectly and cannot tell a genuine repeat from one.
  Two half-hour walks on one day were one walk: the second was swallowed,
  counted in `applied` and unqueued, so nothing was left to retry. Each extra
  now carries a `ref`, minted in `logExtra()` so it survives the queue → sheet
  handover, written to a new column 11 ("Ref"). `alreadyRecorded()` matches on
  it when present and falls back to the old triple for rows that predate it —
  his sheet has those. `looksLikeOurs()` still reads only columns 1/3/5, so an
  old sheet is unchanged and still ours.
- **`keyFor()` is deliberately NOT changed** — see invariant 9. Photographs
  hang on it, and giving an extra a new identity would orphan every picture
  already taken.
- A warning on Today when logging has been waiting a **full day**, with the
  reason and a button to send it. Silent below a day: an ordinary sync takes
  seconds, and a daily warning is one he stops reading.
- `tests/extras-identity.js`, `tests/conflict.js` (the Dropbox conflict path,
  stubbed — carefully built and never once run), `tests/waiting.js`. Its trap,
  recorded in `tests/README.md`: **logging starts a sync by itself** when
  Dropbox is connected, so a conflict test must queue while the stub is
  disconnected.

**v1.56.0 — the extras, drawn.** Anything logged outside the plan gets a bar in
the week strip, in pink. Asked for in one sentence ("we have bars for planned
workouts. Maybe we could make the same bar, but make it pink"), and the pink
was indeed free.

- `weekDays()` now carries `extras` and `extraSeconds` per day, read through
  `allExtras()` in sync.js — one shape for a queued extra (`date`) and a synced
  one (`dayKey`), because nothing drawing a week cares which side of a sync an
  extra is on. `weekSummary()` reads through it too; it had its own slightly
  different copy of that flattening.
- 🚨 **The height scale counts the extras in** — `plannedSeconds +
  extraSeconds`, not `plannedSeconds`. A two-hour hike measured against the
  biggest *planned* day draws a bar taller than the column that holds it, which
  is the one way a bar chart lies without looking wrong. It does shorten the
  planned bars on a week with a lot outside the plan; that is the truth about
  that week. `tests/extra-bars.js` measures it with a 2h extra in a week whose
  biggest day is 65m.
- **Solid, always.** There is no outstanding extra, so hollow would have
  nothing to mean. And **one pink for every activity**, not the activity's own
  colour: colour is how the strip says which sport, so a colour of its own is
  how it says "not one of them, and not in the plan". `--sport-extra`,
  `#f472b6` dark / `#be185d` light (6.0:1 — it labels a row on the opened day,
  so it carries text).
- **A rest day with an extra on it keeps its rest line.** Deliberately *not*
  the v1.41.0 rule: a session moved onto a rest day ends it because the plan
  now asks for something there; a walk does not change what the plan asked for.
  Both marks, in the same column.
- The opened day lists them, because a pink bar you can tap that then answers
  "Nothing planned" is worse than no panel at all. The key names the pink only
  on a week that has one, exactly as it does the rest day.
- **The block card on Plan draws them too**, same pink, on its own scale — the
  longest single *session* in the eight weeks, because those rows are a third
  the height and only bar-against-bar fits. An extra may set that height. The
  worry was that a long walk would flatten the block; it does not, because
  **rescaling is linear** — every planned bar shrinks by the same factor and
  the arc is exactly as it was, only quieter. What it *could* cost is the short
  end, where the 14% floor stops a bar vanishing: shrink far enough and short
  sessions bunch on the floor. `tests/plan-overview.js` step 5 logs a 6h40m
  extra into a block whose biggest session is about an hour — the worst case,
  not a typical one — and asserts the weeks keep their order by ink and the
  lightest stays under 75% of the heaviest. Only the last week and this one can
  hold an extra, so six rows are unaffected either way.
- The block's foot names the pink only when the block contains one, as the week
  key does. `blockWeeks()` carries `extras` (a count) for that.
- **The guide gained a section, `The week, drawn`**, sitting between *The four
  tabs* and *How it reads your plan*. It explains the whole drawing rather than
  just the new part — the height scale and why the two cards use different
  ones, the four shapes and why hollow is tinted rather than outlined, the rest
  line, the wash, tapping a day, and every decision behind the pink. Martin
  asked for this depth explicitly. New UI on either card belongs in it.

**v1.57.0 — how the plan reaches the app, written down.** No screen moved. The
guide's syncing section only ever described the *write* direction — logging
going out to Dropbox — and said nothing about how a change made in Excel comes
*in*, which is what he asked. It now names the five moments the workbook is
re-read (open, foreground, any sync, the sync button, a signal returning), says
outright that it is the **whole file every time** (an .xlsx is one zip; there
is no fetching only next week), and gives the **60-second foreground floor**
(`REFRESH_FLOOR` in app.js) a reason a reader can see. *A change you made in
Excel is not showing* joins "If something looks wrong".

- The section is renamed `Syncing, and working offline` — it now covers both
  directions, and the old title only promised one.
- 🪤 The editing rules were **not** restated here. `Changing the plan in Excel`
  already has them and is stricter: numbers and text are free, **rows are the
  sharp edge** (weekly totals sum fixed ranges, and an unsynced entry points at
  a row number), so sync before restructuring. The new block points at it
  rather than paraphrasing it — a second, looser copy of a safety rule is worse
  than no copy.

**v1.58.0 — the microphone that never answered.** Reported from his phone with
a screenshot: tap the mic, "Listening…", nothing ever again. Two faults, and
the second is why it read as broken rather than flaky.

- 🚨 **`listening` was only cleared in `onEnd`.** A recogniser that never ends
  left it set for ever, so every later tap took the `if (listening) stop()`
  branch instead of starting — the button was **dead for the rest of the
  session**. `stopListening(message)` now resets the recogniser, the timer, the
  spinner and the note together, and every exit goes through it.
- **Nothing timed out.** `LISTEN_SILENCE` (6s) gives up when nothing at all has
  been heard. The app cannot tell a recogniser that will not run from a person
  who has not spoken, so the way out is the same either way.
- The cause is not fixable here: on iOS `webkitSpeechRecognition` **exists in a
  home-screen app and does not work in one** — `start()` is accepted and no
  result, error or `onend` follows. `AmsVoice.supported()` only tests for the
  constructor, which that satisfies. Deliberately **not** UA-sniffed: the
  failure is now legible and says what to do, and sniffing iOS versions ages
  badly. The resting hint already pointed at the keyboard mic.
- `showScreen()` calls `stopListening()` — a recogniser left running behind a
  screen he has walked away from is a microphone nobody knows is on.
- `tests/say-it.js` step 5 stubs `AmsVoice.listen` with one that accepts
  `start()` and says nothing, which is what his phone does. It asserts the
  screen stops saying "Listening…", the spinner clears, the advice names the
  keyboard, **the second tap starts a new attempt** (the dead-button
  regression), and leaving the form stops it.

**v1.59.0 — changing a number you got wrong.** "Maybe I entered the wrong
numbers." The route already existed — the session screen shows what is recorded
and offers *Log again* — but it opened a blank form headed "How did it go?",
which showed nothing of what he had come to change and read as a request to
retype the session.

- 🚨 **The boxes stay empty. Do not "helpfully" prefill them.** A blank box
  means "leave that cell exactly as it is", and that is the whole reason
  correcting one number out of five is safe. Prefilling turns every save into a
  rewrite of every cell, and a stale value nobody looked at goes back into the
  sheet as though it had been confirmed — the same failure `as-planned.js`
  guards on the one-tap button, arriving by another door. `tests/correcting.js`
  fails if anyone fills them in, and says so.
- The current value is offered *beside* the box (`.field-now`, `recordedValue()`)
  and goes in only when tapped. `recordedValue()` reads from exactly where
  `loggedSummary()` reads — the cell's own display text once synced, the queued
  value while it waits — so the hint and the session screen cannot drift apart
  (the v1.53.0 `driftOf()` lesson). The test compares the captions against the
  panel rather than against a second reading of the cells.
- Only shown when it differs from what the box already holds: with a queued
  entry the box already carries that value and repeating it says nothing.
- Title: "How did it go?" → **"Change what is recorded"** when already recorded.
  Present tense and short deliberately — "Change what *was* recorded" wrapped to
  two lines at 390px and pushed the form down. Measured, not guessed.
- 🪤 **It still cannot empty a cell**, because blank already means "leave it
  alone". A number in the wrong field has to be cleared in Excel. Named in the
  guide and the changelog rather than left to be discovered; it needs its own
  answer (an explicit marker, not an empty box) and did not get one here.

**v1.60.0 — two buttons, asked for.**

- **The one-tap button gained a second line**, *Logs the workout in one press*.
  "Did it — 40m" said what happened and what it would write and never what
  pressing it *does*, so the form it saves you was invisible from outside. The
  number stays on top: it is the reassurance that nothing is invented.
  `didItLabel()` builds it for both places it is drawn — the card on Today and
  the session footer — because two copies of a label drift.
- **The move screen puts the day and the button on one line, half each**
  (`.move-row`). His words: "the green is taking more attention, so I often
  miss the date picker" — which ends with a session moved to the day it was
  already on. Side by side and equally wide, it is one gesture with two steps
  in the order they happen. `align-items: end` lines the button up with the
  *input* rather than its label — the same mistake `.settings-row` was making
  before v1.45.0.
- Both guarded in `tests/screen-wording.js`, which already owns the layout
  decisions that exist because of something he reported. The move check asserts
  the two are within 0.8–1.25× of each other, because "neither dominates" is
  the whole point and a half-undone version would still be on one line.

**v1.61.0 — "Log again" was the whole problem.** He came back from his phone
saying he did not understand what the v1.59.0 screen was *for*. It was not the
screen: it was the button that opened it.

- 🚨 **"Log again" reads as "log another workout."** His words: "in my ears, as
  a non-native English person, *log again* feels as if I would like to log
  another workout, and that's never a use case." It is now **"Adjust logged
  data"** — his phrasing, kept as he gave it. A label that reads clearly to the
  person using the app beats one that reads well to whoever wrote it, and
  CLAUDE.md already said to believe him about his own screen.
- The form it opens is headed the same words, so pressing one label and landing
  under another is not possible. `tests/correcting.js` asserts they match.
- 🪤 **Two tests pinned the literal string** (`as-planned.js`, `logging.js`) and
  broke on the rename. Both now ask for the *meaning* — the button must offer
  adjusting/changing and must not say "again" — so the next wording change does
  not cost two false failures. Assert what a label means, not what it says.
- The lesson generalises: v1.59.0 looked like a feature nobody needed, and the
  feature was fine. Before redesigning something he says is pointless, check
  what the door into it is called.

**v1.62.0 — Adjust logged data, done properly.** The empty-boxes design of
v1.59.0 was wrong and he said so plainly: "everything opens with nothing
entered… this is a very unorthodox way that I don't like. I would like
everything to be pre-filled, obviously." He was right.

- 🚨 **The form opens filled in. The protection moved to save time.** The
  worry that produced the empty boxes was real — writing every box back
  rewrites four cells because one changed, and puts a value the phone read
  *before* the last Excel edit over the newer one. That now lives in
  `openedWith` (a snapshot taken when the form is built, read from the boxes so
  it is the same reading `collectLog()` makes) and `changedOnly()` at save.
  **Do not remove either**: without them the pre-filled form is exactly the
  hazard the empty one was avoiding.
- `.field-now`, `data-use-recorded` and their CSS are gone. `recordedValue()`
  stays — it is what fills the boxes now.
- **The save button counts**: *Save 1 change*, disabled as "Nothing changed
  yet" until something differs. Changed fields get `.is-changed`. Together they
  answer "what is this about to write?" before it is pressed, which is the
  question the whole episode was really about.
- Tapping a filled box selects it (`focus` → `select()`), so typing replaces.
- 🪤 The **show-more-fields** rebuild re-runs `openLog()`, which takes a fresh
  snapshot. `openedWith` is restored afterwards or everything typed before
  asking for more columns counts as unchanged and is silently dropped.
- 🪤 **The lesson of this whole run.** Four releases went into this one screen
  because the *name on the button* was wrong ("Log again" → he read "log
  another workout"), and once inside, the form did not behave like a form. Both
  were reported in plain words and both times the first instinct was to explain
  rather than to change it. When he says he does not understand something, the
  screen is wrong — not the explanation.

**v1.63.0 — done, from across the room.** His words: "when I take a glance at
the details it says Logged, but it's too small. I would like a border as
well." The status pill was right and just small; reading a fortnight of them
meant finding and reading each one.

- `statusClass()` puts `.is-done` / `.is-missed-card` on the card, and is used
  by **both** card renderers (the list card and the Today card) so the two
  cannot drift.
- Border and wash take their colour from `--color-success` /
  `--color-danger-text` — the same tokens `.pill.done` and `.pill.missed` use,
  so the two marks on one card can never disagree. The wash is 5%: it has to
  survive being read beside the sport's own colour bar down the left edge.
- **Missed is bordered too.** Bordering only the done ones would leave missed
  looking exactly like still-to-do. Still-to-do stays plain, because the
  *difference* is what gets read.
- `tests/logging.js` asserts both halves — the done card is edged, the one
  still to do is not, and the two edge colours differ. Bordering everything
  would pass a test that only looked at the done one.
- The pill stays: the border answers "is it done", the pill carries "waiting to
  sync" and why. The test checks the border joined it rather than replaced it.

**v1.64.0 — a tick, and a message home.** Three things from one message.

- **The done border is thicker and stronger** (2px + 1px inset ring, wash 5% →
  11%). He asked for both by eye; drawn, measured, shown.
- **A tick** (`doneTick()`, `.done-tick`) in the corner of a completed session,
  put there because that is where he drew it in a screenshot. Only on
  `kind === 'logged'` — 🚨 a mark that appears on everything congratulates you
  for nothing, and `tests/logging.js` asserts the still-to-do cards carry none.
  `.workout-card.is-done .workout-card-titles` gains right padding so a long
  title wraps before it rather than running under it.
- **Send it to somebody**, on the card the moment a session is logged.
  - 🚨 `doneShareText()` sends **what he did**, not `sessionShareText()`'s
    brief. The brief — intensity, purpose, warm-up, the interval set — is right
    for a training partner and wrong for his wife, which is who this is for.
    Heart rate and effort are left out for the same reason. `tests/send-done.js`
    fails if `Purpose:` or `Intensity:` ever appear in it, which is what falling
    back to the old text would look like.
  - 🪤 **The photographs must be read before the sheet opens.** On iOS a share
    sheet only opens during the tap that asked for it, so `shareDone()` awaits
    `sessionPhotoFiles()` and *then* opens `openChoice`; the option's own tap is
    the fresh gesture that calls `navigator.share`. That is also why the sheet
    exists for what looks like a single action — and it earns the tap, because
    the sub-line can then say how many photos are going, or that this phone
    will not carry them. A message arriving without the picture is the failure
    nobody notices.
  - The Today card's button is caught **before** the `[data-workout]` handler in
    the delegated listener, or pressing it would also open the session beneath.
  - The session screen's share sheet leads with the same option once the
    session is done; the full brief stays under it as "Send the whole session".
  - It sits on a card that deliberately shrank to one line when it was logged
    (v1.40.0). That decision removed three offers to *decide* the session again;
    this is not one of those, and it is kept small — `tests/send-done.js`
    asserts it stays under 75% of the card's width.

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
| `js/voice.js` | a spoken session, read into form values. Pure, and tested as such |
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
- every `?v=` in `index.html` (16 of them)
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
`photos`, `extra-photos`, `share-app`, `screen-wording`, `plan-overview`, `as-planned`, `voice` (no browser), `say-it`, `road`, `trends` (no browser), `load` (no browser), `is-it-working`, `new-writes`, `rough-input` (no browser), `extras-identity`, `conflict`, `waiting`, `extra-bars`, `correcting`, `send-done` — **33 of them**. What each
one covers is written up in `tests/README.md`; keep it current, the run list
included. Fixtures are synthetic and gitignored — **no real
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
