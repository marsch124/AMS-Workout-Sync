/*
 * A waiting log whose row changed in Excel may follow its session a few days,
 * never weeks.
 *
 * A plan repeats sessions word for word. When a logged row was turned into
 * another sport before the sync, findWorkoutFor went looking for "the same
 * session" by its wording and found the next one with that wording — in his
 * plan the LTHR test seven weeks later — and wrote the log there. Found
 * 2026-09-14 by the iPhone app's sync test. The fix: a match elsewhere must be
 * within a week of the day the log was made against.
 *
 * everyday.xlsx has a "Run session" on each of fourteen days. The test turns
 * the logged run into a swim, then rewords the other runs so that the only
 * matching wording is (A) more than a week away, or (B) three days away.
 *
 *     node tests/far-title.js
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

  await page.evaluate(async () => {
    window.original = new Uint8Array((await AmsDb.getWorkbook()).bytes);
    await AmsDb.set('workbook.path', '/plan.xlsx');
    await AmsDb.set('workbook.name', 'plan.xlsx');
    window.box = { connected: false };
    AmsDropbox.isConnected = async () => window.box.connected;
    AmsDropbox.download = async () => ({ bytes: new Uint8Array(window.box.bytes), rev: window.box.rev,
      name: 'plan.xlsx', path: '/plan.xlsx', modified: '', size: window.box.bytes.length });
    AmsDropbox.upload = async (path, blob, rev) => {
      if (rev !== window.box.rev) { const e = new Error('conflict'); e.isConflict = true; throw e; }
      window.box.uploads++;
      window.box.bytes = new Uint8Array(await blob.arrayBuffer());
      window.box.rev = 'r' + (window.box.uploads + 1);
      return { rev: window.box.rev, name: 'plan.xlsx', path_lower: '/plan.xlsx' };
    };

    /* Log day 0's run, then play Excel: it becomes a swim, and every other run is
       reworded except those on the days in `keep`. Returns where the log went. */
    window.runCase = async (keepOffsets) => {
      await AmsDb.clearQueue();
      window.box = Object.assign(window.box, { bytes: new Uint8Array(window.original), rev: 'r1', uploads: 0, connected: false });
      await AmsSync.loadFromFile(new File([window.original], 'plan.xlsx'));
      const state = AmsSync.getState();
      const m = state.mapping;
      const runs = state.plan.filter(w => w.discipline.id === 'run');
      const target = runs[0];
      await AmsSync.logWorkout(target, { actualDuration: '33' });

      const wb = await AmsXlsx.open(window.box.bytes);
      const edits = [{ ref: AmsXlsx.makeRef(m.columns.discipline, target.row), kind: 'text', value: 'Swim', field: 'discipline' }];
      runs.slice(1).forEach((w) => {
        const offset = Math.round((AmsPlan.parseDayKey(w.dayKey) - AmsPlan.parseDayKey(target.dayKey)) / 86400000);
        if (keepOffsets.indexOf(offset) === -1) {
          edits.push({ ref: AmsXlsx.makeRef(m.columns.title, w.row), kind: 'text', value: 'Hill repeats', field: 'title' });
        }
      });
      await wb.writeCells(target.sheet, edits);
      window.box.bytes = new Uint8Array(await (await wb.save()).arrayBuffer());

      window.box.connected = true;
      const result = await AmsSync.sync();
      const after = await AmsPlan.build(await AmsXlsx.open(window.box.bytes), m);
      const landed = after.filter(w => w.results.actualDuration && w.results.actualDuration.text === '33')
        .map(w => Math.round((AmsPlan.parseDayKey(w.dayKey) - AmsPlan.parseDayKey(target.dayKey)) / 86400000));
      const queue = await AmsDb.listQueue();
      return { result, uploads: window.box.uploads, landed, waiting: queue.length,
               reason: queue[0] && queue[0].lastError ? queue[0].lastError.slice(0, 70) : '' };
    };
  });

  console.log('THE ONLY MATCHING WORDING IS EIGHT DAYS AWAY OR MORE');
  const far = await page.evaluate(() => window.runCase([8, 9, 10, 11, 12, 13]));
  line('written / failed', far.result.written + ' / ' + far.result.failed);
  line('uploads', far.uploads);
  line('log landed on day offset', far.landed.length ? far.landed.join(', ') : 'nowhere');
  line('still waiting, with a reason', far.waiting + ' — ' + far.reason);
  if (far.landed.length) errors.push('a log was written into a session more than a week away (offset ' + far.landed.join(', ') + ')');
  if (far.waiting !== 1 || !far.reason) errors.push('the log should stay waiting with a reason');

  console.log('');
  console.log('A MATCHING SESSION THREE DAYS AWAY');
  const near = await page.evaluate(() => window.runCase([3, 10]));
  line('written / failed', near.result.written + ' / ' + near.result.failed);
  line('log landed on day offset', near.landed.length ? near.landed.join(', ') : 'nowhere');
  line('still waiting', near.waiting);
  if (near.landed.join() !== '3') errors.push('a session moved three days in Excel should still take its log (landed ' + near.landed.join(', ') + ')');

  await page.evaluate(() => AmsDb.clearQueue());
  await browser.close();
  console.log('');
  console.log('errors:', errors.length ? '\n - ' + errors.join('\n - ') : 'none');
})();
