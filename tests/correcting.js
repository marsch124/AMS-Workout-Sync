/*
 * Coming back to a log to fix a number you got wrong.
 *
 * "Maybe I entered the wrong numbers" — and the route was already there: the
 * session screen shows what is in the workbook and offers "Log again". What it
 * then opened was a blank form headed "How did it go?", which told you nothing
 * about the 72 you had come to change into 65, and read as an invitation to
 * type the whole session in again.
 *
 * The load-bearing decision, and the thing this test is really for: **saving
 * writes only the boxes you actually changed**.
 *
 * The form opens filled in with what is recorded, which is how an edit form
 * behaves everywhere else and what he asked for in those words. The first
 * attempt left the boxes empty with the value offered beside them, to protect
 * exactly one thing: that correcting one number must not rewrite five cells —
 * and in particular must not put a value the phone read *before* the workbook
 * was last edited in Excel back over the newer one. That was the right worry
 * and the wrong answer: he found the form unreadable, and said so plainly.
 *
 * The protection moved to save time instead. The form remembers what it opened
 * showing and sends only the fields that differ. So the form can look ordinary
 * and still touch one cell, and this test holds both halves: filled in when you
 * arrive, one cell written when you leave.
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
  console.log('THE FORM SAYS WHICH JOB IT IS, AND OPENS FILLED IN');

  await page.click('#openLogButton');
  await page.waitForTimeout(900);

  const form = await page.evaluate(() => {
    const boxes = {};
    document.querySelectorAll('#logBody input[data-field], #logBody textarea[data-field]')
      .forEach(n => { boxes[n.dataset.field] = n.value; });
    const save = document.getElementById('saveLogButton');
    return {
      title: document.getElementById('logTitle').textContent,
      boxes: boxes,
      empty: Object.entries(boxes).filter(([, v]) => String(v).trim() === '').map(([k]) => k),
      save: save.textContent,
      saveDisabled: save.disabled,
      marked: document.querySelectorAll('#logBody .field.is-changed').length,
      footer: ([...document.querySelectorAll('#logBody .hint-inline')].pop() || {}).innerText || ''
    };
  });

  line('the title reads', '"' + form.title + '"');
  line('boxes on opening', JSON.stringify(form.boxes));
  line('the save button says', '"' + form.save + '" (disabled: ' + form.saveDisabled + ')');

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

  // Every value the session screen showed has to be in its box.
  session.panel.forEach((row) => {
    if (row.label === 'Completed') return;   // not a field you type into
    if (!Object.values(form.boxes).some(v => String(v) === row.value)) {
      errors.push('the workbook holds ' + row.label + ' = ' + row.value
        + ' but no box on the form is showing it');
    }
  });
  if (form.empty.length) {
    errors.push('opened with ' + form.empty.join(', ') + ' empty — a form you came back to correct '
      + 'should show what is there');
  }
  /*
   * Nothing has been touched yet, so there is nothing to write. The button
   * says so rather than offering a save that would do nothing.
   */
  if (!form.saveDisabled) {
    errors.push('the save button is live before anything has been changed');
  }
  if (form.marked) {
    errors.push(form.marked + ' field(s) marked as changed on a form nobody has touched');
  }
  if (!/blank|change/i.test(form.footer)) {
    errors.push('the form does not say what saving will write: ' + form.footer);
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('CHANGING ONE SAYS SO, BEFORE YOU PRESS ANYTHING');

  const typed = await page.evaluate(async () => {
    const box = document.getElementById('log-actualDuration');
    /*
     * Tapping a filled box selects it, so typing replaces rather than appends.
     * On a phone the alternative is tap, move the cursor, delete two digits,
     * type two — for a box you opened this screen specifically to overwrite.
     */
    box.focus();
    await new Promise(r => setTimeout(r, 120));
    const selectsAll = box.selectionStart === 0 && box.selectionEnd === box.value.length;

    box.value = '65';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));

    const save = document.getElementById('saveLogButton');
    return {
      selectsAll: selectsAll,
      save: save.textContent,
      disabled: save.disabled,
      marked: [...document.querySelectorAll('#logBody .field.is-changed [data-field]')]
        .map(n => n.dataset.field)
    };
  });

  line('tapping a filled box selects it', typed.selectsAll);
  line('the save button now says', '"' + typed.save + '"');
  line('fields marked as changed', typed.marked.join(', ') || 'none');

  if (!typed.selectsAll) {
    errors.push('tapping a filled box does not select it, so correcting means deleting first');
  }
  if (typed.disabled) errors.push('the save button is still dead after a change was made');
  if (!/1 change/.test(typed.save)) {
    errors.push('the save button does not say how much it will write: ' + typed.save);
  }
  if (String(typed.marked) !== String(['actualDuration'])) {
    errors.push('the changed field is marked as ' + (typed.marked.join(', ') || 'nothing')
      + ' — it should be the duration and nothing else');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('CORRECTING ONE NUMBER WRITES ONE CELL');

  const saved = await page.evaluate(async () => {
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
  console.log('A SESSION NEVER LOGGED IS THE ORDINARY FORM');

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
      save: document.getElementById('saveLogButton').textContent,
      saveDisabled: document.getElementById('saveLogButton').disabled,
      filled: Object.entries(boxes).filter(([, v]) => String(v).trim() !== '').map(([k]) => k)
    };
  });

  line('a session not yet logged reads', '"' + untouched.title + '"');
  line('its save button says', '"' + untouched.save + '"');

  if (untouched.screen !== 'logScreen') {
    errors.push('could not reach the log form for a session that has not been logged');
  }
  if (!/how did it go/i.test(untouched.title)) {
    errors.push('a session with nothing recorded is headed as though it had been: ' + untouched.title);
  }
  if (untouched.filled.length) {
    errors.push('a fresh log form arrived with ' + untouched.filled.join(', ') + ' already filled in');
  }
  // Nothing is recorded, so there is nothing to count changes against: the
  // button is the ordinary one it has always been.
  if (untouched.saveDisabled) {
    errors.push('the save button is dead on a session that has never been logged');
  }
  if (/change/i.test(untouched.save)) {
    errors.push('a first log counts changes rather than just saving: ' + untouched.save);
  }

  console.log('');
  console.log(errors.length ? 'errors:' : 'errors: none');
  errors.forEach(e => console.log('   - ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
