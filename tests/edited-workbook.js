/*
 * The workbook is edited in Excel while the app is using it.
 *
 * Same number of sessions, but the wording changes, the durations change, a
 * sport changes, a column is inserted. The app must land every logged result on
 * the row it was meant for, or refuse and say so — never write it into the row
 * that happens to have that number now.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(38) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  /*
   * Each case starts from nothing: a page that has never synced, a queue that
   * is empty, and the original workbook. Anything left over from the case
   * before would show up as a result written twice.
   */
  const freshStart = async () => {
    await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
    await page.evaluate(() => AmsDb.reset()).catch(() => {});
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.click('.tab[data-tab="settings"]');
    await page.waitForSelector('#openLocalButton');
    await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
    await page.waitForTimeout(2400);
  };

  /*
   * Queue a log against a known session, then hand the sync a workbook whose
   * rows have been rewritten underneath it, and see where the numbers land.
   */
  const run = (edit) => page.evaluate(async (edit) => {
    await AmsDb.clearQueue();

    const state = AmsSync.getState();
    const target = state.plan.find(w => w.discipline.id === 'run');
    await AmsSync.logWorkout(target, { actualDuration: '37', avgHr: '129' });

    // the edited copy Dropbox would hand back
    const bytes = await AmsDb.get('workbook.bytes', null);
    const edited = await AmsXlsx.open(bytes.slice ? bytes.slice() : bytes);
    const mapping = state.mapping;
    const sheet = mapping.sheets[0];
    const cols = mapping.columns;
    const rowOf = target.row;
    const ref = (col, row) => AmsXlsx.makeRef(col, row);

    // A column inserted in Excel cannot be simulated by this app's writer, so
    // the fixture made for it is fetched whole.
    if (edit === 'column-inserted') {
      const response = await fetch('tests/fixtures/column-inserted.xlsx');
      const shifted = new Uint8Array(await response.arrayBuffer());
      let uploaded = null;
      AmsDropbox.isConnected = async () => true;
      AmsDropbox.download = async () => ({ bytes: shifted, rev: 'r1', name: 'w.xlsx', path: '/w.xlsx' });
      AmsDropbox.upload = async (path, blob) => {
        uploaded = new Uint8Array(await blob.arrayBuffer());
        return { rev: 'r2', name: 'w.xlsx' };
      };
      await AmsDb.set('workbook.path', '/w.xlsx');

      const result = await AmsSync.sync();
      const after = uploaded ? await AmsXlsx.open(uploaded) : null;
      const s2 = after ? await after.readSheet(sheet) : null;
      const landed = [];
      if (s2) {
        const headings = {};
        for (let c = 1; c <= s2.maxCol; c++) headings[c] = s2.textAt(1, c);
        for (let r = 2; r <= s2.maxRow; r++) {
          for (let c = 1; c <= s2.maxCol; c++) {
            const cell = s2.cell(r, c);
            if (cell && String(cell.text) === '37') {
              landed.push({ row: r, column: headings[c] || ('column ' + c), actual: cell.text,
                            sport: s2.textAt(r, 5), title: (s2.textAt(r, 6) || '').slice(0, 30) });
            }
          }
        }
      }
      const left = await AmsDb.listQueue();
      return {
        loggedAgainst: { row: target.row, sport: target.discipline.label, title: target.title.slice(0, 34) },
        result: result,
        landed: landed.map(l => ({ row: l.row, sport: l.sport, title: l.column, actual: l.actual })),
        stillQueued: left.map(e => ({ attempts: e.attempts, why: (e.lastError || '').slice(0, 70) }))
      };
    }

    const edits = [];
    if (edit === 'reworded') {
      edits.push({ ref: ref(cols.title, rowOf), kind: 'text',
                   value: 'Easy run, conversational — now with 4x20s strides' });
      edits.push({ ref: ref(cols.plannedDuration, rowOf), kind: 'number', value: 45 });
    }
    if (edit === 'sport-changed') {
      edits.push({ ref: ref(cols.discipline, rowOf), kind: 'text', value: 'Swim' });
      edits.push({ ref: ref(cols.title, rowOf), kind: 'text', value: 'Technique: 8x50 drills' });
    }
    if (edit === 'moved-down') {
      // the same session, further down the sheet: rows inserted above it
      const last = Math.max(...state.plan.map(w => w.row)) + 2;
      Object.keys(cols).forEach((id) => {
        const col = cols[id];
        if (!col) return;
        const cell = target.results && target.results[id];
        void cell;
      });
      edits.push({ ref: ref(cols.date, last), kind: 'text', value: target.dayKey });
      edits.push({ ref: ref(cols.discipline, last), kind: 'text', value: 'Run' });
      edits.push({ ref: ref(cols.title, last), kind: 'text', value: target.title });
      edits.push({ ref: ref(cols.plannedDuration, last), kind: 'number', value: 30 });
      // and the original row becomes something else entirely
      edits.push({ ref: ref(cols.discipline, rowOf), kind: 'text', value: 'Bike' });
      edits.push({ ref: ref(cols.title, rowOf), kind: 'text', value: 'Turbo session, 3x8 min' });
    }
    await edited.writeCells(sheet, edits);
    const editedBytes = new Uint8Array(await (await edited.save()).arrayBuffer());

    let uploadedBytes = null;
    AmsDropbox.isConnected = async () => true;
    AmsDropbox.download = async () => ({ bytes: editedBytes, rev: 'r1', name: 'w.xlsx', path: '/w.xlsx' });
    AmsDropbox.upload = async (path, blob) => {
      uploadedBytes = new Uint8Array(await blob.arrayBuffer());
      return { rev: 'r2', name: 'w.xlsx' };
    };
    await AmsDb.set('workbook.path', '/w.xlsx');

    const result = await AmsSync.sync();
    const left = await AmsDb.listQueue();

    // where did the numbers actually go?
    let landed = [];
    if (uploadedBytes) {
      const after = await AmsXlsx.open(uploadedBytes);
      const s2 = await after.readSheet(sheet);
      for (let r = (mapping.firstDataRow || 2); r <= s2.maxRow; r++) {
        const dur = s2.cell(r, cols.actualDuration);
        if (dur && dur.text) {
          landed.push({
            row: r,
            sport: s2.textAt(r, cols.discipline),
            title: (s2.textAt(r, cols.title) || '').slice(0, 34),
            actual: dur.text
          });
        }
      }
    }
    return {
      loggedAgainst: { row: target.row, sport: target.discipline.label, title: target.title.slice(0, 34) },
      result: result,
      landed: landed,
      stillQueued: left.map(e => ({ attempts: e.attempts, why: (e.lastError || '').slice(0, 70) }))
    };
  }, edit);

  for (const edit of ['reworded', 'sport-changed', 'moved-down', 'column-inserted']) {
    console.log('\n' + edit.toUpperCase().replace('-', ' '));
    await freshStart();
    const out = await run(edit);
    line('logged against:', out.loggedAgainst.sport + ' row ' + out.loggedAgainst.row
      + ' — "' + out.loggedAgainst.title + '"');
    line('sync said:', JSON.stringify(out.result));
    line('the 37 minutes landed on:', out.landed.length
      ? out.landed.map(l => 'row ' + l.row + ' (' + l.sport + ' — "' + l.title + '") = ' + l.actual).join('; ')
      : 'nothing was written');
    if (out.stillQueued.length) line('kept in the queue:', JSON.stringify(out.stillQueued));
  }

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
