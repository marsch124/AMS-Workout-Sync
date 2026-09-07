/*
 * The new ways into the workbook, followed all the way to the file.
 *
 * Two new paths reached the one file that matters this week: one tap, and a
 * spoken sentence. Both are tested where they hand values over — but the thing
 * that would actually hurt is further downstream, in the saved bytes, and
 * neither had been followed that far.
 *
 * So this logs by tap and by voice, saves the workbook for real, opens the
 * saved file again, and asks three questions of it:
 *
 *   1. **Did the right cells get the right values**, in the sheet's own units?
 *   2. **Did anything else move?** Invariant 1 says a logging round trip leaves
 *      the archive otherwise byte-identical. A new writer is exactly the thing
 *      that could quietly break that, and nobody would notice until a chart in
 *      Excel stopped working.
 *   3. **Is the plan itself still intact?** Every planned cell in the file is
 *      compared before and after — 3,272 of them.
 *
 * Run at the size he actually uses, 409 sessions, because a writer that is
 * correct on three rows and wrong on four hundred is the worse of the two.
 *
 *     node tests/new-writes.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && fs.existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);
const gap = () => console.log('');


(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  /* ================================================================ 1 */
  console.log('ONE TAP, AND A SPOKEN SENTENCE, ALL THE WAY TO THE FILE');

  await page.evaluate(() => AmsDb.remove('mapping'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/season.xlsx');
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
      await AmsDb.clearQueue();
      await AmsDb.set('log.showAllFields', true);
      await AmsSync.overlayQueue();
  });

  const sessions = await page.evaluate(() => AmsSync.getState().plan.length);
  line('workbook opened', sessions + ' sessions');
  if (sessions < 300) errors.push('the big fixture did not load');

  const written = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = state.mapping;
    const sheetName = mapping.sheets[0];

    /* A snapshot of every planned cell, to compare against afterwards. */
    const before = await state.workbook.readSheet(sheetName);
    const planColumns = ['date', 'weekday', 'discipline', 'title', 'plannedDuration',
                         'plannedIntensity', 'description', 'phase']
      .map(id => mapping.columns[id]).filter(Boolean);
    let plannedCells = 0;
    const wasText = {};
    for (let row = mapping.firstDataRow || 2; row <= before.maxRow; row++) {
      planColumns.forEach(col => { wasText[row + ':' + col] = before.textAt(row, col); plannedCells++; });
    }

    const today = AmsSync.todayKey();
    const upcoming = state.plan.filter(w => w.discipline.id !== 'rest' && w.dayKey >= today);

    /*
     * Three different rows on purpose. The first draft of this test let the
     * one-tap session and the swim be the same row, logged it twice, and then
     * reported the swim's numbers as a one-tap bug.
     */
    const used = new Set();
    const take = (test) => {
      const found = upcoming.find(w => !used.has(w.key) && test(w));
      if (found) used.add(found.key);
      return found;
    };
    const tapped = take(() => true);
    const spokenOn = take(w => w.discipline.id === 'run');
    const swumOn = take(w => w.discipline.id === 'swim');
    if (!tapped || !spokenOn || !swumOn) return { fatal: 'the fixture has no run or no swim ahead' };

    // One tap.
    await AmsSync.logWorkout(tapped, {
      actualDuration: String(Math.round(AmsPlan.plannedDurationSeconds(tapped, mapping) / 60))
    });

    // A spoken sentence, through the real parser.
    const fields = AmsMapping.writableFields(mapping).map(f => f.id);
    const heard = AmsVoice.parse('8.2 km, 52 minutes, 141 bpm, felt like a 6',
      { sport: spokenOn.discipline.id, fields: fields });
    await AmsSync.logWorkout(spokenOn, heard.values);

    // And a swim said in metres, into a sheet that counts kilometres.
    const swimHeard = AmsVoice.parse('2400 metres, 45 minutes, 138 bpm', { sport: 'swim', fields: fields });
    await AmsSync.logWorkout(swumOn, swimHeard.values);

    const out = await AmsSync.exportWorkbook();
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    const reopened = await AmsXlsx.open(bytes.buffer);
    const after = await reopened.readSheet(sheetName);

    const cell = (row, id) => {
      const col = mapping.columns[id];
      if (!col) return null;
      const c = after.cell(row, col);
      return c ? (typeof c.number === 'number' ? c.number : c.text) : null;
    };

    const changed = [];
    for (let row = mapping.firstDataRow || 2; row <= after.maxRow; row++) {
      planColumns.forEach((col) => {
        const now = after.textAt(row, col);
        if (wasText[row + ':' + col] !== now) {
          changed.push(row + ':' + col + ' "' + wasText[row + ':' + col] + '" -> "' + now + '"');
        }
      });
    }

    return {
      applied: out.applied,
      rowsBefore: before.maxRow,
      rowsAfter: after.maxRow,
      plannedCells: plannedCells,
      planChanged: changed.slice(0, 6),
      tapped: {
        sport: tapped.discipline.id,
        planned: Math.round(AmsPlan.plannedDurationSeconds(tapped, mapping) / 60),
        duration: cell(tapped.row, 'actualDuration'),
        done: cell(tapped.row, 'done'),
        distance: cell(tapped.row, 'actualDistance'),
        hr: cell(tapped.row, 'avgHr'),
        rpe: cell(tapped.row, 'rpe')
      },
      spoken: { heard: heard.values, duration: cell(spokenOn.row, 'actualDuration'),
                distance: cell(spokenOn.row, 'actualDistance'), hr: cell(spokenOn.row, 'avgHr'),
                rpe: cell(spokenOn.row, 'rpe'), done: cell(spokenOn.row, 'done') },
      swim: { heard: swimHeard.values, distance: cell(swumOn.row, 'actualDistance'),
              duration: cell(swumOn.row, 'actualDuration') },
      units: mapping.units,
      doneValue: mapping.doneValue
    };
  });

  if (written.fatal) errors.push(written.fatal);

  line('entries written into the file', written.applied);
  line('rows before and after', written.rowsBefore + ' / ' + written.rowsAfter);
  line('planned cells compared', written.plannedCells);
  line('planned cells that moved', written.planChanged.length ? written.planChanged.join(' | ') : 'none');

  if (written.rowsAfter !== written.rowsBefore) errors.push('the sheet gained or lost rows');
  if (written.planChanged.length) errors.push('THE PLAN ITSELF WAS EDITED: ' + written.planChanged.join(' | '));

  gap();
  line('one tap (' + written.tapped.sport + ') wrote duration',
       written.tapped.duration + ' ' + written.units.duration + ', planned ' + written.tapped.planned);
  line('and the completed marker', JSON.stringify(written.tapped.done));
  line('and touched nothing else',
       'distance ' + JSON.stringify(written.tapped.distance)
       + ' · hr ' + JSON.stringify(written.tapped.hr)
       + ' · effort ' + JSON.stringify(written.tapped.rpe));

  const expectDuration = written.units.duration === 'minutes' ? written.tapped.planned
    : written.units.duration === 'hours' ? written.tapped.planned / 60 : written.tapped.planned / 1440;
  if (Math.abs(written.tapped.duration - expectDuration) > 0.001) {
    errors.push('one tap wrote ' + written.tapped.duration + ' where the plan asked for ' + expectDuration);
  }
  if (written.tapped.done !== written.doneValue) errors.push('one tap did not mark it complete');
  if (written.tapped.distance !== null || written.tapped.hr !== null || written.tapped.rpe !== null) {
    errors.push('one tap wrote into cells it was never given values for');
  }

  gap();
  line('spoken, understood as', JSON.stringify(written.spoken.heard));
  line('reached the sheet as',
       'duration ' + written.spoken.duration + ' · distance ' + written.spoken.distance
       + ' · hr ' + written.spoken.hr + ' · effort ' + written.spoken.rpe);

  const spokenMinutes = written.units.duration === 'minutes' ? 52
    : written.units.duration === 'hours' ? 52 / 60 : 52 / 1440;
  if (Math.abs(written.spoken.duration - spokenMinutes) > 0.001) errors.push('a spoken duration did not reach the cell');
  if (Math.abs(written.spoken.distance - 8.2) > 0.001) errors.push('a spoken distance did not reach the cell: ' + written.spoken.distance);
  if (written.spoken.hr !== 141) errors.push('a spoken heart rate did not reach the cell');
  if (written.spoken.rpe !== 6) errors.push('a spoken effort did not reach the cell');
  if (written.spoken.done !== written.doneValue) errors.push('a spoken session was not marked complete');

  gap();
  line('a swim said in metres', JSON.stringify(written.swim.heard));
  line('landed in a kilometre column as', written.swim.distance + ' ' + written.units.distance);
  const expectSwim = written.units.distance === 'm' ? 2400 : 2.4;
  if (Math.abs(written.swim.distance - expectSwim) > 0.01) {
    errors.push('2400 metres reached the sheet as ' + written.swim.distance + ' rather than ' + expectSwim);
  }

  /* ================================================================ 2 */
  gap();
  console.log('AND THE REST OF THE ARCHIVE IS UNTOUCHED');

  const parts = await page.evaluate(async () => {
    const originalBytes = (await AmsDb.getWorkbook()).bytes;
    const original = await AmsZip.read(new Uint8Array(originalBytes));
    const out = await AmsSync.exportWorkbook();
    const saved = await AmsZip.read(new Uint8Array(await out.blob.arrayBuffer()));

    const names = original.names();
    const differs = [];
    let same = 0;
    for (const name of names) {
      if (!saved.has(name)) { differs.push(name + ' (gone)'); continue; }
      const a = await original.file(name);
      const b = await saved.file(name);
      let identical = a.length === b.length;
      if (identical) for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { identical = false; break; } }
      identical ? same++ : differs.push(name);
    }
    return { total: names.length, same: same, differs: differs,
             added: saved.names().filter(n => names.indexOf(n) === -1) };
  });

  line('parts in the archive', parts.total);
  line('byte-identical after logging', parts.same);
  line('changed', parts.differs.join(', ') || 'none');
  line('added', parts.added.join(', ') || 'none');

  if (!parts.same) errors.push('nothing came through untouched, which cannot be right');
  if (parts.differs.some(n => /\.png|\.jpeg|drawing|chart|theme|styles/.test(n))) {
    errors.push('a part unrelated to cell values was rewritten: ' + parts.differs.join(', '));
  }
  if (parts.differs.filter(n => !/calcChain/.test(n)).length > 3) {
    errors.push('more of the archive was rewritten than logging should touch: ' + parts.differs.join(', '));
  }

  /* ================================================================ 3 */
  gap();
  console.log('A SPOKEN PACE, INTO A COLUMN EXCEL TREATS AS A CLOCK');

  await page.evaluate(() => AmsDb.remove('mapping'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/paced-time.xlsx');
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
      await AmsDb.clearQueue();
      await AmsDb.set('log.showAllFields', true);
      await AmsSync.overlayQueue();
  });

  const paced = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = state.mapping;
    const fields = AmsMapping.writableFields(mapping).map(f => f.id);
    const today = AmsSync.todayKey();

    const swim = state.plan.find(w => w.dayKey === today && w.discipline.id === 'swim');
    const run = state.plan.find(w => w.dayKey === today && w.discipline.id === 'run');
    if (!swim || !run) return { fatal: 'the paced fixture did not load as expected' };

    const swimHeard = AmsVoice.parse('2 km, 45 minutes, 1:52 per hundred, 132 bpm',
      { sport: 'swim', fields: fields });
    const runHeard = AmsVoice.parse('7.5 km, 40 minutes, 5:20 per km, 145 bpm',
      { sport: 'run', fields: fields });

    await AmsSync.logWorkout(swim, swimHeard.values);
    await AmsSync.logWorkout(run, runHeard.values);

    const out = await AmsSync.exportWorkbook();
    const reopened = await AmsXlsx.open(await out.blob.arrayBuffer());
    const after = await reopened.readSheet(mapping.sheets[0]);
    const paceCol = mapping.columns.avgPace;

    const readBack = (row) => {
      const c = after.cell(row, paceCol);
      if (!c) return null;
      return { number: c.number, text: c.text, styled: c.styleIndex >= 0,
               dateStyled: reopened.dateStyles.has(c.styleIndex) };
    };

    return {
      paceIsTime: mapping.units.paceIsTime,
      swimHeard: swimHeard.values, runHeard: runHeard.values,
      swim: readBack(swim.row), run: readBack(run.row),
      // What an existing row in the same column looks like, for comparison.
      existing: readBack(mapping.firstDataRow)
    };
  });

  if (paced.fatal) {
    errors.push(paced.fatal);
  } else {
    line('the app read the column as', paced.paceIsTime ? 'a clock (paceIsTime)' : 'plain text');
    line('"1:52 per hundred" understood as', JSON.stringify(paced.swimHeard.avgPace));
    line('"5:20 per km" understood as', JSON.stringify(paced.runHeard.avgPace));
    line('an existing row in that column', JSON.stringify(paced.existing));
    line('the swim written as', JSON.stringify(paced.swim));
    line('the run written as', JSON.stringify(paced.run));

    if (!paced.swimHeard.avgPace) errors.push('"1:52 per hundred" was not understood as a pace at all');
    if (!paced.runHeard.avgPace) errors.push('"5:20 per km" was not understood as a pace at all');

    if (paced.paceIsTime) {
      /* 1:52 is 112 seconds, and Excel counts a day as 1. */
      const want = 112 / 86400;
      const wantRun = 320 / 86400;
      if (!paced.swim || Math.abs(paced.swim.number - want) > 1e-9) {
        errors.push('1:52 reached a clock column as ' + (paced.swim && paced.swim.number)
          + ' rather than ' + want + ' — Excel will not read that as 1:52');
      }
      if (!paced.run || Math.abs(paced.run.number - wantRun) > 1e-9) {
        errors.push('5:20 reached a clock column as ' + (paced.run && paced.run.number)
          + ' rather than ' + wantRun);
      }
      if (paced.swim && !paced.swim.dateStyled) {
        errors.push('the written pace lost the clock formatting, so Excel will show it as 0.0013');
      }
    } else {
      if (!paced.swim || String(paced.swim.text) !== '1:52') {
        errors.push('a text pace column got ' + JSON.stringify(paced.swim) + ' rather than "1:52"');
      }
    }
  }

  /* ================================================================ 4 */
  gap();
  console.log('A WHOLE DAY OF MIXED ACTIONS, SAVED AT FULL SIZE');

  await page.evaluate(() => AmsDb.remove('mapping'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/season.xlsx');
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
      await AmsDb.clearQueue();
      await AmsSync.overlayQueue();
  });

  const mixed = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = state.mapping;
    const today = AmsSync.todayKey();
    const fields = AmsMapping.writableFields(mapping).map(f => f.id);

    const upcoming = state.plan.filter(w => w.discipline.id !== 'rest' && w.dayKey >= today);
    const used = new Set();
    const take = () => { const w = upcoming.find(x => !used.has(x.key)); used.add(w.key); return w; };

    const tapped = take();
    const spoken = take();
    const photographed = take();
    const moved = take();
    const missed = take();

    const before = await state.workbook.readSheet(mapping.sheets[0]);
    const beforeRows = before.maxRow;

    // One tap.
    await AmsSync.logWorkout(tapped, {
      actualDuration: String(Math.round(AmsPlan.plannedDurationSeconds(tapped, mapping) / 60)) });

    // Spoken.
    const heard = AmsVoice.parse('42 minutes, 9 km, 138 bpm', { sport: spoken.discipline.id, fields: fields });
    await AmsSync.logWorkout(spoken, heard.values);

    // Logged with a photo attached.
    await AmsSync.logWorkout(photographed, { actualDuration: '30', notes: 'with a picture' });
    const blob = await (await fetch('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/'
      + '2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/'
      + 'wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==')).blob();
    await AmsPhotos.add(photographed, new File([blob], 'shot.jpg', { type: 'image/jpeg' }));

    // Moved to another day, then logged there.
    const shifted = AmsPlan.parseDayKey(moved.dayKey);
    shifted.setUTCDate(shifted.getUTCDate() + 2);
    const to = shifted.toISOString().slice(0, 10);
    await AmsSync.rescheduleWorkout(moved, to);

    // Missed.
    await AmsSync.markMissed(missed, 'work');

    // An extra that was never in the plan.
    await AmsSync.logExtra({ date: today, label: 'Walk with the dog', minutes: 35, notes: 'flat' });

    const queued = (await AmsDb.listQueue()).length;
    const out = await AmsSync.exportWorkbook();
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    const reopened = await AmsXlsx.open(bytes.buffer);
    const after = await reopened.readSheet(mapping.sheets[0]);

    const text = (row, id) => {
      const col = mapping.columns[id];
      return col ? after.textAt(row, col) : '';
    };

    const sheetNames = reopened.sheetNames ? reopened.sheetNames() : [];
    const extrasSheet = sheetNames.find(n => /extra/i.test(n));
    let extraRows = 0;
    if (extrasSheet) {
      const es = await reopened.readSheet(extrasSheet);
      extraRows = Math.max(0, es.maxRow - 1);
    }

    return {
      queued: queued, applied: out.applied,
      beforeRows: beforeRows, afterRows: after.maxRow,
      photos: AmsPhotos.all().length,
      tapped: text(tapped.row, 'done'),
      spoken: text(spoken.row, 'actualDistance'),
      hasNotesColumn: !!mapping.columns.notes,
      photographedNote: text(photographed.row, 'notes'),
      photographedDuration: text(photographed.row, 'actualDuration'),
      movedDate: text(moved.row, 'date'),
      movedTo: to,
      movedWeekday: text(moved.row, 'weekday'),
      missedDone: text(missed.row, 'done'),
      missedNote: text(missed.row, 'notes'),
      extrasSheet: extrasSheet || null,
      extraRows: extraRows,
      sizeKb: Math.round(bytes.length / 1024)
    };
  });

  line('actions queued', mixed.queued);
  line('entries applied to the file', mixed.applied);
  line('rows before and after', mixed.beforeRows + ' / ' + mixed.afterRows);
  line('one tap marked done', JSON.stringify(mixed.tapped));
  line('spoken distance in the sheet', JSON.stringify(mixed.spoken));
  line('the photographed session', 'duration ' + JSON.stringify(mixed.photographedDuration)
       + ' · note ' + JSON.stringify(mixed.photographedNote)
       + ' · photos held ' + mixed.photos);
  line('the moved session now reads', JSON.stringify(mixed.movedDate)
       + ' ' + JSON.stringify(mixed.movedWeekday) + ' (asked for ' + mixed.movedTo + ')');
  line('the missed one', 'done ' + JSON.stringify(mixed.missedDone)
       + ' · notes ' + JSON.stringify(mixed.missedNote)
       + (mixed.hasNotesColumn ? '' : ' (this sheet has no notes column)'));
  line('the extra', (mixed.extrasSheet || 'NO SHEET') + ', ' + mixed.extraRows + ' row(s)');
  line('saved file', mixed.sizeKb + ' KB');

  if (mixed.queued !== 6) errors.push('six actions were taken but ' + mixed.queued + ' were queued');
  if (mixed.applied < 6) errors.push('only ' + mixed.applied + ' of six actions reached the file');
  if (mixed.afterRows !== mixed.beforeRows) errors.push('the plan sheet changed length');
  if (!mixed.tapped) errors.push('the tapped session was not marked done in the file');
  if (mixed.spoken !== '9') errors.push('the spoken distance did not survive the mixed save: ' + mixed.spoken);
  if (mixed.photographedDuration !== '30') {
    errors.push('a session logged alongside a photo lost its duration: ' + mixed.photographedDuration);
  }
  /*
   * This fixture has no notes column, and a note with nowhere to go is
   * supposed to be dropped rather than forced somewhere. Only check the note
   * where the sheet has somewhere to put it — the first draft of this test
   * asserted it unconditionally and reported the app's correct behaviour as a
   * bug.
   */
  if (mixed.hasNotesColumn && !/picture/.test(mixed.photographedNote)) {
    errors.push('a session logged alongside a photo lost its note');
  }
  if (!mixed.hasNotesColumn && mixed.photographedNote) {
    errors.push('a note was written into a sheet that has no notes column');
  }
  if (mixed.photos !== 1) errors.push('the photo did not survive the save');
  if (!mixed.movedDate) errors.push('the moved session lost its date');
  if (mixed.movedDate.slice(0, 10) !== mixed.movedTo) {
    errors.push('the moved session landed on ' + mixed.movedDate + ' rather than ' + mixed.movedTo);
  }
  if (!/miss/i.test(mixed.missedDone)) {
    errors.push('the missed session was not marked missed: ' + JSON.stringify(mixed.missedDone));
  }
  if (!mixed.extrasSheet) errors.push('the extra never reached a sheet');
  if (mixed.extraRows < 1) errors.push('the extras sheet has no rows');

  gap();
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
