/*
 * Photographs on the things the plan did not ask for.
 *
 * A planned session has an identity the moment the workbook is read: sheet
 * plus row. An extra has nothing of the kind. It is a queue entry with an id
 * while it waits, a row on the Extras sheet once it syncs, and neither of
 * those survives the other — so a photograph pinned to either would come
 * unpinned halfway through the extra's life, silently, days later.
 *
 * The answer is that a photo points at an extra the same way the *writer*
 * does: `AmsExtras.keyFor()` names it by the day, the activity and the length,
 * which is exactly the triple `alreadyRecorded()` uses to recognise an extra
 * it has already written. If that ever stops being true this test fails, and
 * it should, because the alternative is a picture that quietly detaches.
 *
 * Also here: the one place in the app where a picture cannot be stored when it
 * is chosen. On the form for a *new* extra there is nothing to attach it to
 * yet, so it is held and attached on save — which means leaving that form has
 * to say what is about to be thrown away.
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

  // Answered per-test; the default is "yes, leave", which no step below wants
  // by accident, so each one installs its own.
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2600);

  await page.evaluate(() => {
    window.__photo = (w, h, hue, label) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + hue + ',60%,45%)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = 'bold ' + Math.round(h / 8) + 'px sans-serif';
      g.textAlign = 'center';
      g.fillText(label, w / 2, h / 2);
      return new Promise(res => c.toBlob(
        b => res(new File([b], 'IMG.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.95));
    };
    window.__pick = async (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('photoInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });

  await page.evaluate(() => AmsPhotos.removeAll());

  // ---------------------------------------------------------------- 1
  console.log('LEAVING THE FORM WITH A PICTURE ON IT');

  const leaving = await page.evaluate(async () => {
    document.querySelector('#todayBody [data-extra]').click();
    await new Promise(r => setTimeout(r, 400));

    const strip = document.querySelector('#extraBody [data-photo-add]');
    if (!strip) return { error: 'no Add button on the extras form' };
    strip.click();
    await window.__pick(await window.__photo(1200, 900, 20, 'held'));
    await new Promise(r => setTimeout(r, 700));

    const held = document.querySelectorAll('#extraBody .photo-thumb.is-held').length;
    const storedWhileHeld = AmsPhotos.count();

    // Say "stay", which must leave the form and the picture exactly as they are.
    let asked = null;
    const real = window.confirm;
    window.confirm = (q) => { asked = q; return false; };
    document.querySelector('#extraScreen [data-back]').click();
    await new Promise(r => setTimeout(r, 300));
    const stayed = document.querySelector('.screen.active').id;
    window.confirm = real;

    return {
      held: held,
      storedWhileHeld: storedWhileHeld,
      asked: asked,
      stayed: stayed,
      stillHeld: document.querySelectorAll('#extraBody .photo-thumb.is-held').length
    };
  });

  if (leaving.error) errors.push(leaving.error);
  line('pictures waiting on the form', leaving.held);
  line('stored in the database yet', leaving.storedWhileHeld);
  line('the question asked on the way out', leaving.asked);
  line('after saying stay, still on', leaving.stayed + ', ' + leaving.stillHeld + ' waiting');

  if (leaving.held !== 1) errors.push('a picture chosen on the extras form did not appear on it');
  if (leaving.storedWhileHeld !== 0) errors.push('a picture was stored before the extra it belongs to existed');
  if (!leaving.asked) errors.push('leaving a form holding a photo did not ask');
  if (leaving.asked && !/photo/i.test(leaving.asked)) errors.push('the question does not mention the photo it is about to drop');
  if (leaving.stayed !== 'extraScreen') errors.push('saying "stay" left the form anyway');
  if (leaving.stillHeld !== 1) errors.push('saying "stay" dropped the picture anyway');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('SAVING IT');

  const saved = await page.evaluate(async () => {
    document.getElementById('extraWhat').value = 'Walk in the woods';
    document.getElementById('extraDuration').value = '40min';
    document.getElementById('saveExtraButton').click();
    await new Promise(r => setTimeout(r, 1600));

    const queued = (await AmsDb.listQueue()).filter(e => e.extra);
    const photo = AmsPhotos.all()[0];
    return {
      screen: document.querySelector('.screen.active').id,
      queued: queued.length,
      photos: AmsPhotos.count(),
      photoKey: photo && photo.workoutKey,
      keyOfQueued: queued.length ? AmsExtras.keyFor(queued[0].values.extra) : null,
      kind: photo && photo.kind,
      stillHeldSomewhere: document.querySelectorAll('.photo-thumb.is-held').length
    };
  });

  line('extras waiting to sync', saved.queued);
  line('photographs stored', saved.photos);
  line('the photo points at', saved.photoKey);
  line('the queued extra answers to', saved.keyOfQueued);

  if (saved.queued !== 1) errors.push('the extra was not queued');
  if (saved.photos !== 1) errors.push('the held picture was not attached when the extra was saved');
  if (saved.photoKey !== saved.keyOfQueued) errors.push('the photo does not point at the extra it was added to');
  if (saved.kind !== 'extra') errors.push('the photo was not recorded as belonging to an extra');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHEN IT SYNCS AND STOPS BEING A QUEUE ENTRY');

  const survived = await page.evaluate(async () => {
    // Exactly what applyExtra does to the sheet, then a real round trip
    // through saved bytes and a fresh read — the queue entry's whole life.
    const state = AmsSync.getState();
    const value = (await AmsDb.listQueue()).filter(e => e.extra)[0].values.extra;
    const before = AmsExtras.keyFor(value);

    const name = await AmsExtras.ensureSheet(state.workbook);
    const sheet = await state.workbook.readSheet(name);
    const built = AmsExtras.buildEdits(sheet, value, {});
    await state.workbook.writeCells(name, built.edits);

    const bytes = new Uint8Array(await (await state.workbook.save()).arrayBuffer());
    const reopened = await AmsXlsx.open(bytes.buffer);
    const rows = await AmsExtras.read(reopened);
    const fromSheet = rows[0];

    const after = AmsExtras.keyFor(fromSheet);
    const owner = { key: after, discipline: { id: fromSheet.activity } };

    return {
      before: before,
      after: after,
      row: fromSheet.row,
      shownAgainstIt: AmsPhotos.forWorkout(owner).length,
      orphanedAgainstOwners: AmsPhotos.orphans([owner]).length,
      orphanedAgainstPlanOnly: AmsPhotos.orphans(state.plan).length
    };
  });

  line('key while it was queued', survived.before);
  line('key once it is row ' + survived.row + ' of the sheet', survived.after);
  line('the photo is shown against it', survived.shownAgainstIt);

  if (survived.before !== survived.after) {
    errors.push('an extra changed identity when it synced, so its photographs came unpinned');
  }
  if (survived.shownAgainstIt !== 1) errors.push('the photo is not shown against the synced extra');
  if (survived.orphanedAgainstOwners !== 0) errors.push('a photo on a live extra was reported as orphaned');
  // And the guard on the guard: it must be the extras that rescue it, not luck.
  if (survived.orphanedAgainstPlanOnly !== 1) {
    errors.push('the orphan check no longer needs the extras, which means it is not testing anything');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('THE ACTIVITY LIST BEING EDITED UNDERNEATH IT');

  const renamed = await page.evaluate(async () => {
    const photo = AmsPhotos.all()[0];
    // Rename Walk. The sheet still says "Walk" on the row that was written, so
    // the key made from the sheet is unchanged and the picture stays put. The
    // activity *id* is what a session-style guard would have compared, which
    // is why extras do not use one.
    const list = AmsExtras.getActivities().map(a =>
      a.id === 'walk' ? { id: a.id, label: 'Walking', kind: a.kind } : { id: a.id, label: a.label, kind: a.kind });
    await AmsExtras.saveActivities(list);

    const asSheetRow = { date: '2026-01-01', label: 'Walk', activity: 'walk', minutes: 40 };
    // Same shape as the row that was written, but on the photo's own day.
    asSheetRow.date = photo.dayKey;
    const owner = { key: AmsExtras.keyFor(asSheetRow), discipline: { id: 'other' } };

    const out = {
      key: owner.key,
      matchesPhoto: owner.key === photo.workoutKey,
      shown: AmsPhotos.forWorkout(owner).length
    };
    await AmsExtras.resetActivities();
    return out;
  });

  line('after renaming Walk, the sheet row keys to', renamed.key);
  line('the photo is still shown against it', renamed.shown);

  if (!renamed.matchesPhoto) errors.push('renaming an activity changed the key of an extra already written');
  if (renamed.shown !== 1) errors.push('renaming an activity hid a photograph attached to an old extra');

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('WHERE IT CAN BE FOUND AFTERWARDS');

  const findable = await page.evaluate(async () => {
    // Extras used to be visible only on the day they happened. A photograph
    // that can only be seen until midnight is not somewhere to keep one.
    await AmsSync.logExtra({ date: '2026-01-04', activity: 'hike', what: 'An old walk',
      minutes: 90, isTraining: true, notes: '' });
    await new Promise(r => setTimeout(r, 400));

    AmsUi.renderToday();
    await new Promise(r => setTimeout(r, 300));
    const link = document.querySelector('[data-extras-all]');
    if (!link) return { error: 'no way through to everything logged' };
    link.click();
    await new Promise(r => setTimeout(r, 600));

    return {
      screen: document.querySelector('.screen.active').id,
      days: [...document.querySelectorAll('#extrasBody .day-heading h2')].map(n => n.textContent),
      cards: document.querySelectorAll('#extrasBody .workout-card').length,
      addButtons: document.querySelectorAll('#extrasBody [data-photo-add]').length
    };
  });

  if (findable.error) errors.push(findable.error);
  line('the list shows', (findable.days || []).join(' · '));
  line('cards, each able to take a photo', findable.cards + ', ' + findable.addButtons + ' Add buttons');

  if (findable.screen !== 'extrasScreen') errors.push('"see all" did not open the list of everything logged');
  if (!findable.cards || findable.cards < 2) errors.push('the list does not show extras from other days');
  if (findable.addButtons !== findable.cards) errors.push('not every extra in the list can be given a photo');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
