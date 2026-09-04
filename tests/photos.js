/*
 * Photographs attached to a session.
 *
 * These are the only thing the app holds that exists nowhere else. The
 * workbook is a copy of itself in Dropbox and the queue is replayed into the
 * workbook; a photograph is on the phone or it is gone. So the failures worth
 * catching here are all failures of keeping:
 *
 *   1. a picture goes in shrunk, and comes back out as the bytes that went in;
 *   2. it is attributed to the session it was taken against, and to no other —
 *      inserting a row in Excel slides every session below it onto its
 *      neighbour's identity, and the same trick that could misfile a move
 *      could misfile a photograph;
 *   3. a photo whose session can no longer be found is not shown against
 *      anything, but is still counted and still exported. Missing beats wrong,
 *      and silently dropped beats neither;
 *   4. resetting the app does not take them. A reset is what you reach for
 *      when syncing is misbehaving;
 *   5. the zip the app builds is a zip: read back, entry for entry, byte for
 *      byte. It is the only route off the phone, and an export that produces a
 *      corrupt file is worse than no export, because it is discovered later.
 *
 * The pictures are drawn on a canvas rather than shipped as fixtures: real
 * photographs of anybody are not going in this repository, and a gradient
 * compresses like a photograph well enough to prove the resizing.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2600);

  // A photograph maker, installed once and used by every step below.
  await page.evaluate(() => {
    window.__photo = (w, h, hue) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, 'hsl(' + hue + ',65%,55%)');
      grad.addColorStop(1, 'hsl(' + ((hue + 80) % 360) + ',65%,30%)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = 'bold ' + Math.round(h / 6) + 'px sans-serif';
      g.textAlign = 'center';
      g.fillText(w + '/' + h, w / 2, h / 2);
      return new Promise(res => c.toBlob(
        b => res(new File([b], 'IMG.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.95));
    };
    window.__clean = async () => { await AmsPhotos.removeAll(); };
  });

  await page.evaluate(() => window.__clean());

  // ---------------------------------------------------------------- 1
  console.log('ADDING ONE, THE WAY THE APP DOES');

  const added = await page.evaluate(async () => {
    const workout = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');

    // Through the screen, not through the module: open the session, tap Add,
    // and hand the hidden input a file the way the picker would.
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 200));
    const card = [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key);
    card.click();
    await new Promise(r => setTimeout(r, 400));

    const strip = document.querySelector('#workoutBody [data-photo-add]');
    if (!strip) return { error: 'no Add button on the session screen' };
    strip.click();

    const file = await window.__photo(3000, 2000, 200);
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('photoInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));

    const meta = AmsPhotos.all()[0];
    return {
      key: workout.key,
      sport: workout.discipline.id,
      wentIn: file.size,
      stored: meta && meta.bytes,
      size: meta && (meta.width + 'x' + meta.height),
      onSession: AmsPhotos.countFor(workout),
      thumbs: document.querySelectorAll('#workoutBody .photo-thumb').length,
      pill: !!document.querySelector('#workoutBody .photo-thumb')
    };
  });

  if (added.error) errors.push(added.error);
  line('3000x2000 went in at', Math.round(added.wentIn / 1024) + ' KB');
  line('stored as', added.size + ', ' + Math.round(added.stored / 1024) + ' KB');
  line('attached to that session', added.onSession);
  line('thumbnails drawn', added.thumbs);

  if (added.size !== '1600x1067') errors.push('the picture was not resized to 1600 on the long edge: ' + added.size);
  if (!(added.stored < added.wentIn)) errors.push('the stored picture is not smaller than the one chosen');
  if (added.onSession !== 1) errors.push('the photo did not attach to the session it was added from');
  if (added.thumbs !== 1) errors.push('the strip did not redraw with the new photo');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHEN THE ROWS SHIFT UNDER IT');

  const attribution = await page.evaluate((key) => {
    const real = AmsSync.byKey(key);
    // The same row, now holding a different sport — what inserting a row in
    // Excel does to every session below it.
    const impostor = { key: key, discipline: { id: real.discipline.id === 'run' ? 'swim' : 'run' } };
    const same = { key: key, discipline: { id: real.discipline.id } };
    return {
      shownAgainstItsOwn: AmsPhotos.forWorkout(same).length,
      shownAgainstAnotherSport: AmsPhotos.forWorkout(impostor).length,
      stillCounted: AmsPhotos.count(),
      orphanedNow: AmsPhotos.orphans([impostor]).length
    };
  }, added.key);

  line('shown against its own session', attribution.shownAgainstItsOwn);
  line('shown against another sport in that row', attribution.shownAgainstAnotherSport);
  line('still counted in Settings', attribution.stillCounted);
  line('counted as orphaned when the row changes', attribution.orphanedNow);

  if (attribution.shownAgainstItsOwn !== 1) errors.push('a photo stopped being shown against its own session');
  if (attribution.shownAgainstAnotherSport !== 0) errors.push('a photo was shown against a row whose sport no longer matches');
  if (attribution.stillCounted !== 1) errors.push('an unattributable photo was dropped from the count');
  if (attribution.orphanedNow !== 1) errors.push('an unattributable photo was not reported as orphaned');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('OUT OF THE APP AND INTO A ZIP');

  const exported = await page.evaluate(async () => {
    // Two more, so the naming has to cope with a collision.
    const plan = AmsSync.getState().plan.filter(w => w.discipline.id !== 'rest');
    await AmsPhotos.add(plan[0], await window.__photo(800, 600, 40));
    await AmsPhotos.add(plan[1], await window.__photo(640, 480, 120));

    const seen = new Set();
    const files = [];
    const originals = [];
    for (const photo of AmsPhotos.all()) {
      const blob = await AmsPhotos.blob(photo.id);
      files.push({ name: AmsPhotos.fileNameFor(photo, seen), blob: blob });
      originals.push(new Uint8Array(await blob.arrayBuffer()));
    }

    const zip = await AmsZip.build(files);
    const archive = await AmsZip.read(new Uint8Array(await zip.arrayBuffer()));
    const names = archive.names();

    let identical = names.length === files.length;
    for (let i = 0; i < names.length && identical; i++) {
      const back = await archive.file(names[i]);
      if (back.length !== originals[i].length) { identical = false; break; }
      for (let b = 0; b < back.length; b++) {
        if (back[b] !== originals[i][b]) { identical = false; break; }
      }
    }

    return { names: names, unique: new Set(names).size, identical: identical, bytes: zip.size };
  });

  exported.names.forEach(n => line('', n));
  line('every entry byte-identical to what went in', exported.identical);

  if (exported.names.length !== 3) errors.push('the zip does not hold every photo');
  if (exported.unique !== exported.names.length) errors.push('two photos were given the same name inside the zip');
  if (!exported.identical) errors.push('a photo did not survive the round trip through the zip');
  if (!exported.names.every(n => /^\d{4}-\d{2}-\d{2}_/.test(n))) errors.push('a file in the zip is not named by its day');

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('WHAT A RESET TAKES');

  const afterReset = await page.evaluate(async () => {
    const before = AmsPhotos.count();
    await AmsDb.reset();
    const kept = (await AmsDb.listPhotoMeta()).length;
    const blob = await AmsDb.getPhotoBlob(AmsPhotos.all()[0].id);
    return { before: before, kept: kept, pictureStillThere: !!(blob && blob.size) };
  });

  line('photos before the reset', afterReset.before);
  line('photos after it', afterReset.kept);
  line('the picture itself is still readable', afterReset.pictureStillThere);

  if (afterReset.kept !== afterReset.before) errors.push('resetting the app deleted photographs');
  if (!afterReset.pictureStillThere) errors.push('a photo survived the reset as a description with no picture');

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('DELETING THEM, WHICH IS THE BUTTON THAT SHOULD');

  const deleted = await page.evaluate(async () => {
    await AmsPhotos.removeAll();
    return { count: AmsPhotos.count(), meta: (await AmsDb.listPhotoMeta()).length };
  });

  line('after Delete all', deleted.count + ' in memory, ' + deleted.meta + ' in the database');
  if (deleted.count || deleted.meta) errors.push('deleting every photo left some behind');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
