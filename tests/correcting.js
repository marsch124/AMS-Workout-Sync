/*
 * Coming back to a log to fix a number you got wrong.
 *
 * "Maybe I entered the wrong numbers" — and the route was already there: the
 * session screen shows what is in the workbook and offers "Log again". What it
 * then opened was a blank form headed "How did it go?", which told you nothing
 * about the 72 you had come to change into 65, and read as an invitation to
 * type the whole session in again.
 *
 * The load-bearing decision, and the thing this test is really for: **the
 * boxes stay empty**. An empty box means "leave that cell exactly as it is",
 * which is the entire reason it is safe to correct one number out of five.
 * Prefilling the boxes with what is recorded is the obvious improvement and it
 * silently retires that guarantee — every save becomes a rewrite of every
 * cell, and a stale value you never looked at goes back into the sheet as
 * though you had confirmed it. So the current value is shown *beside* the box
 * and goes in only when tapped, and this test fails if anyone fills them in.
 *
 * season-underway.xlsx is the fixture because its past is logged with four
 * different values on one session — duration, distance, heart rate and effort
 * — which is what makes "change one, leave four" a real question.
 */
const { chromium, devices } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage(devices['iPhone 13']);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton', { state: 'visible' });
  await page.setInputFiles('#localFileInput', SP + '/season-underway.xlsx');
  await page.waitForTimeout(4200);

  // ---------------------------------------------------------------- 1
  console.log('THE SESSION SAYS WHAT IS ALREADY THERE');

  await page.click('.tab[data-tab="plan"]');
  await page.waitForTimeout(700);
  await page.click('.segment[data-range="past"]');
  await page.waitForTimeout(800);
  await page.click('#planBody .workout-card');
  await page.waitForTimeout(700);

  const session = await page.evaluate(() => {
    const body = document.querySelector('#workoutScreen .screen-body');
    const panel = [...(body ? body.querySelectorAll('.card') : [])]
      .find(c => /Already in the workbook/i.test(c.textContent));
    return {
      screen: (document.querySelector('.screen.active') || {}).id,
      button: (document.getElementById('openLogButton') || {}).textContent,
      // What the panel says, field by field, so the captions can be compared
      // against it rather than against a second reading of the same cells.
      panel: panel ? [...panel.querySelectorAll('.settings-row')].map(r => ({
        label: r.querySelector('.settings-row-sub').textContent.trim(),
        value: r.querySelector('.settings-row-title').textContent.trim()
      })) : []
    };
  });

  line('opened', session.screen);
  line('the button says', '"' + session.button + '"');
  session.panel.forEach(r => line('  workbook holds', r.label + ' = ' + r.value));

  if (session.screen !== 'workoutScreen') errors.push('tapping a done session did not open it');
  /*
   * It used to say "Log again", which he read as *log another workout* — "and
   * that's never a use case". The button changes what is already recorded; a
   * label that can be read as starting a second one is worse than no label.
   */
  if (/again/i.test(session.button || '')) {
    errors.push('the button says "' + session.button + '" — "again" reads as logging a second '
      + 'workout, which is not what it does');
  }
  if (!/adjust|change|correct|edit/i.test(session.button || '')) {
    errors.push('the button on a recorded session does not say it changes what is there: '
      + session.button);
  }
  if (session.panel.length < 3) {
    errors.push('the fixture session does not carry enough recorded values to test with');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('THE FORM SAYS WHICH JOB IT IS, AND STAYS EMPTY');

  await page.click('#openLogButton');
  await page.waitForTimeout(900);

  const form = await page.evaluate(() => {
    const boxes = {};
    document.querySelectorAll('#logBody input[data-field], #logBody textarea[data-field]')
      .forEach(n => { boxes[n.dataset.field] = n.value; });
    return {
      title: document.getElementById('logTitle').textContent,
      boxes: boxes,
      filled: Object.entries(boxes).filter(([, v]) => String(v).trim() !== '').map(([k]) => k),
      captions: [...document.querySelectorAll('.field-now')].map(n => ({
        field: n.dataset.useRecorded,
        shows: n.dataset.now,
        height: Math.round(n.getBoundingClientRect().height)
      })),
      footer: ([...document.querySelectorAll('#logBody .hint-inline')].pop() || {}).innerText || ''
    };
  });

  line('the title reads', '"' + form.title + '"');
  line('boxes carrying a value', form.filled.length ? form.filled.join(', ') : 'none');
  form.captions.forEach(c => line('  offered beside ' + c.field, '"' + c.shows + '" (' + c.height + 'px)'));

  if (/how did it go/i.test(form.title)) {
    errors.push('the form still asks "how did it go" when the session is already recorded: ' + form.title);
  }
  /*
   * The button and the screen it opens must say the same thing. Pressing one
   * label and landing under another is a small doubt at exactly the moment
   * there should be none, and it is how the two drift apart over time.
   */
  if (form.title.trim().toLowerCase() !== (session.button || '').trim().toLowerCase()) {
    errors.push('the button says "' + session.button + '" but the screen it opens is headed "'
      + form.title + '"');
  }
  /*
   * The one that matters. If this ever fails because somebody prefilled the
   * boxes "helpfully", read the note at the top of this file before changing
   * the test.
   */
  if (form.filled.length) {
    errors.push('the correction form pre-filled ' + form.filled.join(', ')
      + ' — an empty box is what makes "leave the other cells alone" true');
  }
  if (!form.captions.length) {
    errors.push('nothing on the form says what is currently recorded');
  }
  // Every value the session screen showed has to be offered on the form, and
  // with the same text — two readings of one cell are how a hint starts lying.
  session.panel.forEach((row) => {
    if (row.label === 'Completed') return;   // not a field you type into
    if (!form.captions.some(c => c.shows === row.value)) {
      errors.push('the workbook holds ' + row.label + ' = ' + row.value
        + ' but the form does not offer it');
    }
  });
  form.captions.forEach((c) => {
    if (c.height < 43) errors.push('the "' + c.field + '" line is only ' + c.height + 'px to tap');
  });
  if (!/blank/i.test(form.footer)) {
    errors.push('the form does not say what leaving a box blank does: ' + form.footer);
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('TAPPING ONE PUTS IT IN, AND ONLY IT');

  const tapped = await page.evaluate(async () => {
    const cap = [...document.querySelectorAll('.field-now')]
      .find(n => n.dataset.useRecorded === 'actualDuration');
    if (!cap) return { error: 'no offer beside the duration' };
    cap.click();
    await new Promise(r => setTimeout(r, 250));
    const boxes = {};
    document.querySelectorAll('#logBody input[data-field]').forEach(n => { boxes[n.dataset.field] = n.value; });
    return { boxes: boxes, offered: cap.dataset.now };
  });

  if (tapped.error) { errors.push(tapped.error); }
  else {
    const others = Object.entries(tapped.boxes)
      .filter(([k, v]) => k !== 'actualDuration' && String(v).trim() !== '');
    line('duration now holds', '"' + tapped.boxes.actualDuration + '"');
    line('other boxes still empty', others.length ? 'NO — ' + others.map(o => o[0]).join(', ') : 'yes');
    if (tapped.boxes.actualDuration !== tapped.offered) {
      errors.push('tapping the offer did not put it in the box');
    }
    if (others.length) errors.push('tapping one offer filled boxes it had no business filling');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('CORRECTING ONE NUMBER WRITES ONE CELL');

  const saved = await page.evaluate(async () => {
    const box = document.getElementById('log-actualDuration');
    box.value = '65';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('saveLogButton').click();
    await new Promise(r => setTimeout(r, 1600));

    const queued = (await AmsDb.listQueue()).pop();
    const state = AmsSync.getState();
    const workout = state.plan.find(w => w.key === queued.workoutKey);
    return {
      values: queued.values,
      cells: AmsPlan.buildEdits(workout, queued.values, state.mapping)
        .map(e => e.field + ' = ' + e.value)
    };
  });

  line('what was queued', JSON.stringify(saved.values));
  saved.cells.forEach(c => line('  would write', c));

  const fields = saved.cells.map(c => c.split(' = ')[0]).sort();
  /*
   * Exactly the corrected cell and the completed marker. Anything else means a
   * value nobody retyped went back into the sheet — the same failure
   * as-planned.js guards on the one-tap button, arriving by another door.
   */
  if (String(fields) !== String(['actualDuration', 'done'])) {
    errors.push('correcting the duration would write ' + fields.join(' + ')
      + ' — the untouched cells must be left alone');
  }
  if (saved.cells.some(c => /^actualDuration = 65$/.test(c)) === false) {
    errors.push('the corrected duration is not what would be written');
  }

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('AND NOTHING IS OFFERED THAT IS NOT THERE');

  /*
   * The other half of the same rule. A session with nothing recorded must get
   * the original question and no offers at all — a "now:" line under a session
   * you have never logged would be inventing a past for it.
   */
  await page.evaluate(() => document.querySelector('#logScreen [data-back]').click());
  await page.waitForTimeout(400);
  await page.click('.tab[data-tab="plan"]');
  await page.waitForTimeout(600);
  await page.click('.segment[data-range="upcoming"]');
  await page.waitForTimeout(800);
  await page.click('#planBody .workout-card');
  await page.waitForTimeout(700);
  await page.click('#openLogButton');
  await page.waitForTimeout(900);

  const untouched = await page.evaluate(() => {
    const boxes = {};
    document.querySelectorAll('#logBody input[data-field], #logBody textarea[data-field]')
      .forEach(n => { boxes[n.dataset.field] = n.value; });
    return {
      screen: (document.querySelector('.screen.active') || {}).id,
      title: document.getElementById('logTitle').textContent,
      offers: document.querySelectorAll('.field-now').length,
      filled: Object.entries(boxes).filter(([, v]) => String(v).trim() !== '').map(([k]) => k)
    };
  });

  line('a session not yet logged reads', '"' + untouched.title + '"');
  line('offers on it', untouched.offers);

  if (untouched.screen !== 'logScreen') {
    errors.push('could not reach the log form for a session that has not been logged');
  }
  if (!/how did it go/i.test(untouched.title)) {
    errors.push('a session with nothing recorded is headed as though it had been: ' + untouched.title);
  }
  if (untouched.offers) {
    errors.push(untouched.offers + ' "now:" line(s) on a session that has never been logged');
  }
  if (untouched.filled.length) {
    errors.push('a fresh log form arrived with ' + untouched.filled.join(', ') + ' already filled in');
  }

  console.log('');
  console.log(errors.length ? 'errors:' : 'errors: none');
  errors.forEach(e => console.log('   - ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
