/*
 * Logging a session that went as planned, in one tap.
 *
 * The whole value of the button is that it is not a form, so the thing to
 * guard is that it stays exactly as truthful as the form would have been. It
 * must write the planned duration and the completed marker into the cells the
 * mapping points at, and **nothing else** — no distance, no heart rate, no
 * empty strings landing on top of numbers already in the sheet. A one-tap
 * action that quietly scribbles is far worse than a form, because nobody
 * looks.
 *
 * The rest is about when it may be offered at all: not on a rest day, not on a
 * session the plan gives no length to, and not on one already recorded — but
 * yes on one marked missed, which is exactly when "I did it after all" wants
 * to be one tap.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

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
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2600);
  await page.evaluate(() => AmsDb.clearQueue());

  // ---------------------------------------------------------------- 1
  console.log('WHAT ONE TAP WRITES');

  const written = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="today"]').click();
    AmsUi.renderToday();
    await new Promise(r => setTimeout(r, 500));

    const button = document.querySelector('#todayBody [data-as-planned]');
    if (!button) return { error: 'no one-tap button on a session with a planned length' };

    const workout = AmsSync.byKey(button.dataset.asPlanned);
    const mapping = AmsSync.getState().mapping;
    const plannedSeconds = AmsPlan.plannedDurationSeconds(workout, mapping);

    const label = button.textContent;
    button.click();
    await new Promise(r => setTimeout(r, 1200));

    const queued = (await AmsDb.listQueue()).filter(e => !e.extra);
    const entry = queued[queued.length - 1];
    const edits = AmsPlan.buildEdits(workout, entry.values, mapping);

    const column = {};
    Object.keys(mapping.columns).forEach((field) => { column[mapping.columns[field]] = field; });

    return {
      label: label,
      plannedMinutes: Math.round(plannedSeconds / 60),
      queued: queued.length,
      values: entry.values,
      edits: edits.map(e => ({ field: e.field, value: e.value })),
      doneValue: mapping.doneValue,
      unit: (mapping.units || {}).duration,
      toast: document.getElementById('toast').textContent,
      cardAfter: document.querySelector('#todayBody .workout-card').innerText.replace(/\n+/g, ' ')
    };
  });

  if (written.error) { errors.push(written.error); }
  else {
    line('the button said', written.label);
    line('one entry queued', written.queued);
    line('what it holds', JSON.stringify(written.values));
    line('cells it writes', written.edits.map(e => e.field + '=' + e.value).join(', '));
    line('the toast said', written.toast);

    // The label has to name the number, or a one-tap write is a blind one.
    if (!new RegExp(String(written.plannedMinutes)).test(written.label)
        && !/\dh/.test(written.label)) {
      errors.push('the button does not say how long it is about to log');
    }
    if (written.queued !== 1) errors.push('one tap did not produce exactly one entry');

    // The heart of it: two cells, and only two.
    const fields = written.edits.map(e => e.field).sort();
    if (fields.join(',') !== 'actualDuration,done') {
      errors.push('one tap writes more than the duration and the completed marker: ' + fields.join(', '));
    }
    const duration = written.edits.find(e => e.field === 'actualDuration');
    const expected = written.unit === 'minutes' ? written.plannedMinutes
      : written.unit === 'hours' ? written.plannedMinutes / 60
      : written.plannedMinutes / 1440;
    if (Math.abs(duration.value - expected) > 0.001) {
      errors.push('the duration written (' + duration.value + ') is not the planned one in the sheet’s own unit ('
        + expected + ' ' + written.unit + ')');
    }
    const done = written.edits.find(e => e.field === 'done');
    if (done.value !== written.doneValue) errors.push('the completed marker is not the one this sheet uses');

    // And the screen has to agree that it happened.
    if (!/Recorded/.test(written.cardAfter)) errors.push('the card does not show the session as recorded');
    if (!/logged/i.test(written.toast)) errors.push('nothing was said about what had just been written');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('THE SAME THING THE FORM WOULD HAVE DONE');

  const untouched = await page.evaluate(async () => {
    const mapping = AmsSync.getState().mapping;
    const workout = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
    const entry = (await AmsDb.listQueue()).filter(e => !e.extra)[0];

    /*
     * The real hazard of a one-tap write is scribbling. A session's row may
     * already hold a distance or a heart rate from a previous log, or from
     * Excel; an entry carrying empty strings for those fields would put empty
     * strings on top of them. So: what the tap actually queued, and what a
     * form with everything left blank would build, must both reach only the
     * two cells they mean to.
     */
    const fromTap = AmsPlan.buildEdits(workout, entry.values, mapping);
    const blankForm = AmsPlan.buildEdits(workout, {
      actualDuration: entry.values.actualDuration,
      actualDistance: '', avgHr: '', maxHr: '', rpe: '', avgPace: '', notes: '',
      distanceUnit: 'km'
    }, mapping);

    return {
      tapKeys: Object.keys(entry.values),
      fromTap: fromTap.map(e => e.field).sort(),
      blankForm: blankForm.map(e => e.field).sort()
    };
  });

  line('the entry one tap made holds', untouched.tapKeys.join(', '));
  line('cells it reaches', untouched.fromTap.join(', '));
  line('a form left blank reaches', untouched.blankForm.join(', '));

  if (untouched.tapKeys.join(',') !== 'actualDuration') {
    errors.push('one tap queues more than a duration: ' + untouched.tapKeys.join(', '));
  }
  if (untouched.fromTap.join(',') !== untouched.blankForm.join(',')) {
    errors.push('one tap and a form left blank do not touch the same cells');
  }
  if (untouched.blankForm.indexOf('actualDistance') !== -1 || untouched.blankForm.indexOf('avgHr') !== -1) {
    errors.push('a blank field would be written over whatever the sheet already holds');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHEN IT IS OFFERED, AND WHEN IT IS NOT');

  const offered = await page.evaluate(async () => {
    const out = {};
    const state = AmsSync.getState();

    /*
     * Through the "All" list, not the default one. A session that has been
     * recorded or marked missed leaves Upcoming by design, so opening it from
     * there found nothing and the checks below quietly passed on a null.
     */
    const open = async (workout) => {
      AmsUi.showScreen('planScreen');
      document.querySelector('.segment[data-range="all"]').click();
      await new Promise(r => setTimeout(r, 350));
      const card = [...document.querySelectorAll('#planBody [data-workout]')]
        .find(n => n.dataset.workout === workout.key);
      if (!card) return { missing: true };
      card.click();
      await new Promise(r => setTimeout(r, 450));
      return {
        shown: !document.getElementById('asPlannedButton').hidden,
        says: document.getElementById('asPlannedButton').textContent,
        logSays: document.getElementById('openLogButton').textContent
      };
    };

    const plain = state.plan.find(w => w.discipline.id !== 'rest' && !w.logged && !w.pending);
    out.unlogged = plain ? await open(plain) : null;

    const logged = state.plan.find(w => w.logged || w.pending);
    out.logged = logged ? await open(logged) : null;

    // A session the plan gives no length to has nothing to take as read.
    if (plain) {
      const kept = plain.planned.durationRaw;
      plain.planned.durationRaw = null;
      out.noLength = await open(plain);
      plain.planned.durationRaw = kept;
    }

    // Marked missed: this is exactly when one tap is wanted.
    if (plain) {
      const wasPending = plain.pending;
      plain.pending = { values: { missed: true } };
      out.missed = await open(plain);
      plain.pending = wasPending;
    }
    return out;
  });

  const show = (r) => !r ? 'not tested' : r.missing ? 'COULD NOT OPEN IT' : String(r.shown);
  line('on a session still to do', show(offered.unlogged)
    + (offered.unlogged && offered.unlogged.says ? ' — ' + offered.unlogged.says : ''));
  line('once it has been recorded', show(offered.logged)
    + (offered.logged && offered.logged.logSays ? ' (form says "' + offered.logged.logSays + '")' : ''));
  line('on one with no planned length', show(offered.noLength));
  line('on one marked missed', show(offered.missed));

  // Every case has to have actually been reached, or the rest proves nothing.
  ['unlogged', 'logged', 'noLength', 'missed'].forEach((name) => {
    if (!offered[name] || offered[name].missing) {
      errors.push('the "' + name + '" case could not be opened, so it was never tested');
    }
  });

  if (offered.unlogged && !offered.unlogged.shown) errors.push('not offered on a session that is still to do');
  if (offered.logged && offered.logged.shown) errors.push('still offered on a session already recorded');
  if (offered.logged && offered.logged.logSays && !/again/i.test(offered.logged.logSays)) {
    errors.push('a recorded session does not offer to be logged again');
  }
  if (offered.noLength && offered.noLength.shown) {
    errors.push('offered on a session the plan gives no length to, so it would write nothing');
  }
  if (offered.missed && !offered.missed.shown) {
    errors.push('not offered on a missed session, which is when "I did it after all" is wanted most');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('THE PLANNED LENGTH, TAPPED INTO THE FORM');

  const tapToUse = await page.evaluate(async () => {
    const workout = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest' && !w.logged && !w.pending);
    AmsUi.showScreen('planScreen');
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key).click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('openLogButton').click();
    await new Promise(r => setTimeout(r, 700));

    const line = document.getElementById('complianceLine');
    const field = document.getElementById('log-actualDuration');
    if (!line || !field) return { error: 'no planned line on the log form' };

    const before = field.value;
    const says = line.textContent;
    line.click();
    await new Promise(r => setTimeout(r, 300));
    return { before: before, says: says, after: field.value, thenSays: line.textContent };
  });

  if (tapToUse.error) errors.push(tapToUse.error);
  else {
    line('the line says', tapToUse.says);
    line('the field, before and after', '"' + tapToUse.before + '" then "' + tapToUse.after + '"');
    line('and the line becomes', tapToUse.thenSays);

    if (!/tap to use/i.test(tapToUse.says)) errors.push('the planned line does not say it can be tapped');
    if (tapToUse.before !== '') errors.push('the duration was filled in before it was asked for');
    if (!tapToUse.after) errors.push('tapping the planned line did not fill the duration in');
    if (!/100% of plan/.test(tapToUse.thenSays)) errors.push('the line does not confirm what was filled in');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
