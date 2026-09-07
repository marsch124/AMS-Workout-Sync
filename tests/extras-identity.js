/*
 * Two dog walks are two dog walks.
 *
 * An extra appends a row rather than writing to a known one, so the writer has to be able
 * to recognise what it has already written — otherwise a retried save adds everything a
 * second time. It used to do that by day, activity and duration, which recognises a replay
 * perfectly and cannot tell a genuine repeat from one: log two thirty-five minute walks on
 * one day and the second was silently swallowed, reported as saved, and dropped from the
 * queue with nothing left to retry.
 *
 * Each extra now carries a reference of its own, made when it is logged. The two things
 * that must both be true, and that pull in opposite directions:
 *
 *   1. **A repeat is written.** Same day, same activity, same length, twice — two rows.
 *   2. **A replay is not.** The same queue entries applied again — no new rows.
 *
 * And the third, which is the reason this could not simply be changed: sheets he already
 * has were written without references, and must keep working.
 *
 *     node tests/extras-identity.js
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

  async function open(fixture) {
    await page.evaluate(() => AmsDb.remove('mapping'));
    await page.click('.tab[data-tab="settings"]');
    await page.waitForSelector('#openLocalButton');
    await page.setInputFiles('#localFileInput', SP + '/' + fixture);
    await page.waitForTimeout(2500);
    await page.evaluate(async () => { await AmsDb.clearQueue(); await AmsSync.overlayQueue(); });
  }

  /* ---------------------------------------------------------------- 1 */
  console.log('THE SAME THING, GENUINELY DONE TWICE IN ONE DAY');
  await open('plain.xlsx');

  const twice = await page.evaluate(async () => {
    const today = AmsSync.todayKey();
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 35 });
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 35 });

    const out = await AmsSync.exportWorkbook();
    const wb = await AmsXlsx.open(await out.blob.arrayBuffer());
    const name = wb.sheetNames().find(n => /extra/i.test(n));
    const sheet = await wb.readSheet(name);
    const C = AmsExtras.COL;

    const rows = [];
    for (let r = 2; r <= sheet.maxRow; r++) {
      if (!sheet.textAt(r, C.date)) continue;
      rows.push({ date: sheet.textAt(r, C.date), what: sheet.textAt(r, C.activity),
                  minutes: sheet.textAt(r, C.duration), ref: sheet.textAt(r, C.ref) });
    }

    // Now apply the very same queue entries again, which is what a save whose confirmation
    // was lost on the way back would do.
    const queued = await AmsDb.listQueue();
    await AmsDb.clearQueue();
    for (const e of queued) await AmsDb.queue({ extra: true, dayKey: e.dayKey, values: e.values });
    const replay = await AmsSync.exportWorkbook();
    const wb2 = await AmsXlsx.open(await replay.blob.arrayBuffer());
    const sheet2 = await wb2.readSheet(name);
    let afterReplay = 0;
    for (let r = 2; r <= sheet2.maxRow; r++) if (sheet2.textAt(r, C.date)) afterReplay++;

    return { heading: sheet.textAt(1, C.ref), rows, afterReplay, applied: out.applied };
  });

  line('heading on the reference column', JSON.stringify(twice.heading));
  line('rows after logging both', twice.rows.length);
  twice.rows.forEach(r => line('', r.date + ' · ' + r.what + ' · ' + r.minutes + ' min · ' + r.ref));
  line('rows after replaying the queue', twice.afterReplay);

  if (twice.rows.length !== 2) {
    errors.push('two genuine extras produced ' + twice.rows.length + ' row(s) — the second was lost');
  }
  if (twice.rows.length === 2 && twice.rows[0].ref === twice.rows[1].ref) {
    errors.push('both extras were given the same reference, so one still hides the other');
  }
  if (twice.rows.some(r => !r.ref)) errors.push('an extra reached the sheet with no reference');
  if (twice.heading !== 'Ref') errors.push('the reference column has no heading');
  if (twice.afterReplay !== twice.rows.length) {
    errors.push('a replay changed the row count from ' + twice.rows.length + ' to ' + twice.afterReplay);
  }

  /* ---------------------------------------------------------------- 2 */
  console.log('');
  console.log('AND THINGS THAT ONLY LOOK ALIKE ARE STILL DIFFERENT');
  await open('plain.xlsx');

  const varied = await page.evaluate(async () => {
    const today = AmsSync.todayKey();
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 35 });
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 20 });
    await AmsSync.logExtra({ date: today, activity: 'yoga', label: 'Yoga', minutes: 35 });
    const out = await AmsSync.exportWorkbook();
    const wb = await AmsXlsx.open(await out.blob.arrayBuffer());
    const name = wb.sheetNames().find(n => /extra/i.test(n));
    const sheet = await wb.readSheet(name);
    const C = AmsExtras.COL;
    let rows = 0;
    const refs = new Set();
    for (let r = 2; r <= sheet.maxRow; r++) {
      if (!sheet.textAt(r, C.date)) continue;
      rows++; refs.add(sheet.textAt(r, C.ref));
    }
    return { rows, refs: refs.size };
  });

  line('three different extras wrote', varied.rows + ' rows, ' + varied.refs + ' distinct references');
  if (varied.rows !== 3) errors.push('three different extras produced ' + varied.rows + ' rows');
  if (varied.refs !== 3) errors.push('references collided across different extras');

  /* ---------------------------------------------------------------- 3 */
  console.log('');
  console.log('A SHEET HE ALREADY HAS, WRITTEN BEFORE REFERENCES EXISTED');
  await open('legacy-extras.xlsx');

  const legacy = await page.evaluate(async () => {
    const wbNow = AmsSync.getState().workbook;
    const name = await AmsExtras.sheetNameFor(wbNow);
    const before = await wbNow.readSheet(name);
    const C = AmsExtras.COL;

    let existing = 0;
    for (let r = 2; r <= before.maxRow; r++) if (before.textAt(r, C.date)) existing++;
    const headingBefore = before.textAt(1, C.ref);

    // The old rows carry no reference. An entry queued before this version does not
    // either — that pair still has to dedupe the old way.
    const old = before.textAt(2, C.date);
    const oldLabel = before.textAt(2, C.activity);
    const oldMinutes = before.cell(2, C.duration);
    const oldEntry = { date: old, activity: 'walk', label: oldLabel,
                       minutes: oldMinutes && oldMinutes.number };
    const recognised = AmsExtras.alreadyRecorded(before, oldEntry);

    // And a new one written into the same sheet gains the heading.
    await AmsSync.logExtra({ date: AmsSync.todayKey(), activity: 'walk', label: 'Walk', minutes: 35 });
    const out = await AmsSync.exportWorkbook();
    const wb = await AmsXlsx.open(await out.blob.arrayBuffer());
    const after = await wb.readSheet(name);
    let now = 0;
    for (let r = 2; r <= after.maxRow; r++) if (after.textAt(r, C.date)) now++;

    return { existing, headingBefore, recognised, now, headingAfter: after.textAt(1, C.ref),
             sheet: name };
  });

  line('the sheet already held', legacy.existing + ' extras, heading '
       + JSON.stringify(legacy.headingBefore));
  line('an old entry is still recognised', legacy.recognised ? 'yes' : 'NO');
  line('after logging one more', legacy.now + ' rows, heading '
       + JSON.stringify(legacy.headingAfter));

  if (!legacy.existing) errors.push('the legacy fixture did not load its existing extras');
  if (!legacy.recognised) {
    errors.push('an extra already in an old sheet is no longer recognised, so syncing would duplicate it');
  }
  if (legacy.now !== legacy.existing + 1) {
    errors.push('logging into an old sheet gave ' + legacy.now + ' rows, expected ' + (legacy.existing + 1));
  }
  if (legacy.headingAfter !== 'Ref') errors.push('the old sheet never gained the reference heading');

  /* ---------------------------------------------------------------- 4 */
  console.log('');
  console.log('AND A PHOTOGRAPH STILL FINDS ITS EXTRA');

  const photos = await page.evaluate(async () => {
    const today = AmsSync.todayKey();
    const extra = { date: today, activity: 'hike', label: 'Hike', minutes: 90 };
    const key = AmsExtras.keyFor(extra);
    // Deliberately unchanged: photographs saved before this release hang on the day, the
    // activity and the length, and changing what an extra is called would orphan them.
    return { key: key, looksLikeAnExtra: AmsExtras.isKey(key),
             stillTheOldShape: key === 'extra:' + today + ':hike:90' };
  });

  line('an extra is still pointed at by', photos.key);
  if (!photos.looksLikeAnExtra) errors.push('an extra key is no longer recognised as one');
  if (!photos.stillTheOldShape) {
    errors.push('the key a photograph hangs on changed shape, which orphans every existing photo');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
