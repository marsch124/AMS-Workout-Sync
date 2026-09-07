/*
 * What happens when the workbook changed in Dropbox while the phone had logging waiting.
 *
 * This is the path where a mistake costs a day's training log, and until now nothing had
 * ever run it. The design is careful — every upload carries the revision it was based on,
 * so Dropbox refuses a write built on a copy that has moved on, and the queue only lets go
 * once Dropbox has confirmed — but careful and tested are different things.
 *
 * Three things have to hold, and they are in tension:
 *
 *   1. **Nothing is lost.** A refused upload leaves the queue exactly as it was.
 *   2. **Nothing is doubled.** The retry works from the newer copy and writes each entry
 *      once — including extras, which append and so cannot simply be written again.
 *   3. **Nothing of his is overwritten.** Whatever changed in Excel while the phone was
 *      out of date is still there afterwards.
 *
 * Dropbox is replaced with a stub here. That is the point: the real thing cannot be made
 * to conflict on demand, and this is about how the app behaves when it does.
 *
 *     node tests/conflict.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && fs.existsSync(CHROME) ? { executablePath: CHROME } : {};
const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });

  await page.evaluate(() => AmsDb.remove('mapping'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { await AmsDb.clearQueue(); await AmsSync.overlayQueue(); });

  /*
   * A Dropbox that holds one file, refuses writes based on a stale revision, and can be
   * told to have "someone else" save over it between the download and the upload.
   */
  await page.evaluate(async () => {
    const start = (await AmsDb.getWorkbook()).bytes;
    window.fakeBox = {
      bytes: new Uint8Array(start),
      rev: 'rev1',
      uploads: 0,
      downloads: 0,
      refusals: 0,
      /** Set to a revision to simulate someone saving the file underneath us. */
      bumpBeforeNextUpload: null,
      alwaysRefuse: false
    };

    await AmsDb.set('workbook.path', '/plan.xlsx');
    await AmsDb.set('workbook.name', 'plan.xlsx');

    // Logging kicks off a sync of its own the moment Dropbox is connected. The stub
    // therefore starts disconnected: a test that wants to arrange a conflict has to get
    // its entries queued before anything tries to send them.
    window.fakeBox.connected = false;
    AmsDropbox.isConnected = async () => window.fakeBox.connected;
    AmsDropbox.download = async () => {
      window.fakeBox.downloads++;
      return { bytes: new Uint8Array(window.fakeBox.bytes), rev: window.fakeBox.rev,
               name: 'plan.xlsx', path: '/plan.xlsx', modified: '2026-09-07T10:00:00Z',
               size: window.fakeBox.bytes.length };
    };
    AmsDropbox.upload = async (path, blob, rev) => {
      const box = window.fakeBox;
      if (box.bumpBeforeNextUpload) {
        box.rev = box.bumpBeforeNextUpload;
        box.bumpBeforeNextUpload = null;
      }
      if (box.alwaysRefuse || (rev && rev !== box.rev)) {
        box.refusals++;
        const err = new Error('The workbook changed in Dropbox since the app last read it.');
        err.isConflict = true;
        throw err;
      }
      box.uploads++;
      box.bytes = new Uint8Array(await blob.arrayBuffer());
      box.rev = 'rev' + (box.uploads + 1);
      return { rev: box.rev, name: 'plan.xlsx', path_lower: '/plan.xlsx',
               server_modified: '2026-09-07T11:00:00Z' };
    };
  });

  /** Wait for any sync the app started by itself to finish. */
  const settle = () => page.waitForFunction(() => !AmsSync.getState().syncing, null,
                                            { timeout: 15000 });

  /* ---------------------------------------------------------------- 1 */
  console.log('SOMEBODY SAVED THE FILE WHILE THE PHONE WAS UPLOADING');

  await settle();
  const raced = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = state.mapping;
    const today = AmsSync.todayKey();
    const todays = state.plan.filter(w => w.dayKey === today && w.discipline.id !== 'rest');

    await AmsSync.logWorkout(todays[0], { actualDuration: '44' });
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 35 });
    const queuedBefore = (await AmsDb.listQueue()).length;

    // Now connect, and let the file move underneath us exactly once between the download
    // and the upload.
    window.fakeBox.connected = true;
    window.fakeBox.bumpBeforeNextUpload = 'rev-somebody-else';

    const result = await AmsSync.sync();

    const wb = await AmsXlsx.open(window.fakeBox.bytes.buffer.slice(0));
    const sheet = await wb.readSheet(mapping.sheets[0]);
    const durationCol = mapping.columns.actualDuration;

    const extrasName = wb.sheetNames().find(n => /extra/i.test(n));
    let extraRows = 0;
    if (extrasName) {
      const es = await wb.readSheet(extrasName);
      for (let r = 2; r <= es.maxRow; r++) if (es.textAt(r, AmsExtras.COL.date)) extraRows++;
    }

    return {
      result: result,
      queuedBefore: queuedBefore,
      queuedAfter: (await AmsDb.listQueue()).length,
      refusals: window.fakeBox.refusals,
      downloads: window.fakeBox.downloads,
      uploads: window.fakeBox.uploads,
      duration: sheet.textAt(todays[0].row, durationCol),
      extraRows: extraRows
    };
  });

  line('queued before syncing', raced.queuedBefore);
  line('Dropbox refused the upload', raced.refusals + ' time(s)');
  line('the app downloaded again', raced.downloads + ' download(s) in all');
  line('and uploaded', raced.uploads + ' time(s)');
  line('sync reported', JSON.stringify(raced.result));
  line('queued afterwards', raced.queuedAfter);
  line('the session in the saved file', JSON.stringify(raced.duration));
  line('rows on the Extras sheet', raced.extraRows);

  if (!raced.refusals) errors.push('the stub never refused, so the conflict path did not run at all');
  if (raced.downloads < 2) errors.push('the app did not fetch the newer copy before retrying');
  if (raced.uploads !== 1) errors.push('the app uploaded ' + raced.uploads + ' times, expected exactly one');
  if (raced.queuedAfter !== 0) errors.push(raced.queuedAfter + ' entries were left in the queue after a successful sync');
  if (raced.duration !== '44') errors.push('the logged session did not survive the conflict: ' + raced.duration);
  if (raced.extraRows !== 1) {
    errors.push('the extra appears ' + raced.extraRows + ' times after a conflict — appending was replayed');
  }

  /* ---------------------------------------------------------------- 2 */
  console.log('');
  console.log('AND WHEN IT KEEPS REFUSING, NOTHING IS THROWN AWAY');

  await settle();
  const refused = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const today = AmsSync.todayKey();
    const todays = state.plan.filter(w => w.dayKey === today && w.discipline.id !== 'rest');

    // Disconnected while queueing, so nothing is sent before the refusal is armed.
    window.fakeBox.connected = false;
    await AmsSync.logWorkout(todays[1], { actualDuration: '61' });
    await AmsSync.logExtra({ date: today, activity: 'yoga', label: 'Yoga', minutes: 25 });
    const before = (await AmsDb.listQueue()).length;

    window.fakeBox.connected = true;
    window.fakeBox.alwaysRefuse = true;
    const bytesBefore = window.fakeBox.bytes.length;
    const result = await AmsSync.sync();
    window.fakeBox.alwaysRefuse = false;

    const queue = await AmsDb.listQueue();
    return {
      before: before,
      after: queue.length,
      result: result,
      fileUntouched: window.fakeBox.bytes.length === bytesBefore,
      uploads: window.fakeBox.uploads
    };
  });

  line('waiting before the failed sync', refused.before);
  line('waiting after it', refused.after);
  line('sync reported', JSON.stringify(refused.result).slice(0, 90));
  line('the file in Dropbox', refused.fileUntouched ? 'untouched' : 'CHANGED');

  if (refused.after !== refused.before) {
    errors.push('a refused sync lost ' + (refused.before - refused.after) + ' queued entries');
  }
  if (!refused.result || !refused.result.error) {
    errors.push('a sync that never uploaded did not report an error: ' + JSON.stringify(refused.result));
  }
  if (!refused.fileUntouched) errors.push('a refused sync changed the file anyway');

  /* ---------------------------------------------------------------- 3 */
  console.log('');
  console.log('AND THE SAME LOGGING GOES UP CLEANLY ONCE IT CAN');

  await settle();
  const recovered = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = state.mapping;
    const today = AmsSync.todayKey();
    const todays = state.plan.filter(w => w.dayKey === today && w.discipline.id !== 'rest');

    const result = await AmsSync.sync();
    const wb = await AmsXlsx.open(window.fakeBox.bytes.buffer.slice(0));
    const sheet = await wb.readSheet(mapping.sheets[0]);

    const extrasName = wb.sheetNames().find(n => /extra/i.test(n));
    let extraRows = 0;
    if (extrasName) {
      const es = await wb.readSheet(extrasName);
      for (let r = 2; r <= es.maxRow; r++) if (es.textAt(r, AmsExtras.COL.date)) extraRows++;
    }

    return {
      result: result,
      queued: (await AmsDb.listQueue()).length,
      first: sheet.textAt(todays[0].row, mapping.columns.actualDuration),
      second: sheet.textAt(todays[1].row, mapping.columns.actualDuration),
      extraRows: extraRows
    };
  });

  line('sync reported', JSON.stringify(recovered.result));
  line('still waiting', recovered.queued);
  line('both sessions in the file', JSON.stringify(recovered.first) + ' and ' + JSON.stringify(recovered.second));
  line('extras on the sheet', recovered.extraRows + ' (one walk, one yoga)');

  if (recovered.queued !== 0) errors.push('entries were still waiting after a sync that succeeded');
  if (recovered.first !== '44' || recovered.second !== '61') {
    errors.push('a session logged before the failures did not survive: '
      + recovered.first + ' / ' + recovered.second);
  }
  if (recovered.extraRows !== 2) {
    errors.push('expected two extras after all this, found ' + recovered.extraRows);
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
