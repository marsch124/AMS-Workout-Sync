/*
 * Logging a session: what you type, and what the card does afterwards.
 *
 * Two things that are easy to break and easy not to notice:
 *
 *   - a bare number in the duration field means minutes. It always has, but
 *     the field used to show three examples that all carried a unit, which
 *     read as though a unit were required.
 *   - once a session is recorded its buttons go away, because there is
 *     nothing left to decide. That is only safe while the card itself opens
 *     the session, where all three actions still live — otherwise a mistaken
 *     log would be uncorrectable from the Today screen.
 */
const { chromium } = require('playwright');
const errs = [];
const line = (l, v) => console.log('   ' + String(l).padEnd(38) + v);
(async () => {
  const b = await chromium.launch({ ...(process.env.CHROME_PATH && require('fs').existsSync(process.env.CHROME_PATH)
      ? { executablePath: process.env.CHROME_PATH } : {}) });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await p.click('.tab[data-tab="settings"]');
  await p.waitForSelector('#openLocalButton');
  await p.setInputFiles('#localFileInput', __dirname + '/fixtures/everyday.xlsx');
  await p.waitForTimeout(2500);
  await p.click('.tab[data-tab="today"]');
  await p.waitForTimeout(600);

  const before = await p.evaluate(() => {
    const c = document.querySelector('#todayBody .workout-card');
    return { log: !!c.querySelector('[data-log]'), missed: !!c.querySelector('[data-missed]'),
             move: !!c.querySelector('[data-move]'), tappable: c.classList.contains('card-tappable'),
             label: (c.querySelector('[data-log]')||{}).textContent };
  });
  console.log('BEFORE LOGGING');
  line('Log button', before.log ? '"' + before.label + '"' : 'absent');
  line('Missed / Move', (before.missed ? 'yes' : 'no') + ' / ' + (before.move ? 'yes' : 'no'));
  if (!before.log || !before.missed || !before.move) errs.push('buttons missing before logging');

  // The field itself, and a bare number through the real form.
  await p.click('#todayBody .workout-card [data-log]');
  await p.waitForSelector('#log-actualDuration');
  const field = await p.evaluate(() => {
    const i = document.getElementById('log-actualDuration');
    return { placeholder: i.placeholder,
             hint: (i.closest('.field')||i.parentElement).innerText.replace(/\s+/g,' ').slice(0,150) };
  });
  console.log('');
  console.log('THE DURATION FIELD');
  line('placeholder', field.placeholder);
  console.log('   ' + field.hint);
  if (!/^e\.g\. 45$/.test(field.placeholder)) errs.push('placeholder still implies a unit is needed');

  await p.fill('#log-actualDuration', '45');
  const shown = await p.evaluate(() => (document.getElementById('complianceLine')||{}).textContent || '');
  line('typing "45" reads as', shown || '(no planned line)');
  await p.click('#saveLogButton');
  await p.waitForTimeout(1500);

  const written = await p.evaluate(async () => {
    const q = await AmsDb.listQueue();
    return q.length ? q[q.length-1].values.actualDuration : null;
  });
  line('stored from "45"', JSON.stringify(written));
  const secs = await p.evaluate(v => AmsPlan.parseDuration(v), written);
  line('which parses to', secs + 's = ' + Math.round(secs/60) + ' min');
  if (secs !== 2700) errs.push('a bare 45 did not become 45 minutes (got ' + secs + 's)');

  await p.click('.tab[data-tab="today"]');
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => {
    const c = document.querySelector('#todayBody .workout-card');
    return { log: !!c.querySelector('[data-log]'), missed: !!c.querySelector('[data-missed]'),
             move: !!c.querySelector('[data-move]'), tappable: c.classList.contains('card-tappable'),
             workout: c.getAttribute('data-workout'), text: c.innerText.replace(/\s+/g,' ').slice(-70) };
  });
  console.log('');
  console.log('AFTER LOGGING');
  line('Log again / Missed / Move', [after.log, after.missed, after.move].map(x => x?'yes':'no').join(' / '));
  line('card is tappable', after.tappable && after.workout ? 'yes' : 'NO');
  console.log('   ...' + after.text);
  if (after.log || after.missed || after.move) errs.push('buttons still present after logging');
  if (!after.tappable || !after.workout) errs.push('logged card is not tappable — no way back to correct it');

  // And that tapping really does reach the session, where the actions live.
  await p.click('#todayBody .workout-card');
  await p.waitForTimeout(600);
  const detail = await p.evaluate(() => ({
    screen: document.querySelector('.screen.active') ? document.querySelector('.screen.active').id : '?',
    log: (document.getElementById('openLogButton')||{}).textContent,
    logHidden: (document.getElementById('openLogButton')||{}).hidden,
    missed: (document.getElementById('markMissedButton')||{}).textContent,
    move: !!document.querySelector('#workoutScreen [data-move]')
  }));
  console.log('');
  console.log('TAPPING THE CARD');
  line('opens', detail.screen);
  line('offers', (detail.log || '(nothing)').trim() + (detail.logHidden ? ' (HIDDEN)' : '')
      + ' / ' + (detail.missed||'').trim() + ' / ' + (detail.move ? 'Move' : 'no move'));
  if (!detail.log || detail.logHidden) errs.push('no way to log again from the session screen');
  if (detail.log.trim() !== 'Log again') errs.push('expected "Log again", got "' + detail.log + '"');
  if (!detail.move) errs.push('no way to move from the session screen');
  if (detail.screen !== 'workoutScreen') errs.push('tapping a logged card did not open the session');

  // ---------------------------------------------------------------- 
  // A missed session is answered too, so it collapses the same way — but the
  // way back matters more here: marking missed in the morning and doing it
  // that evening is a real thing, and it must still be one tap.
  console.log('');
  console.log('A SESSION MARKED MISSED');
  // We are on the session screen from the step above, where the tab bar is
  // hidden; come back out before reaching for it.
  await p.click('#workoutScreen [data-back]');
  await p.waitForTimeout(600);
  const beforeMiss = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#todayBody .workout-card')];
    const c = cards.find(x => x.querySelector('[data-missed]'));
    return c ? { key: c.querySelector('[data-missed]').dataset.missed } : null;
  });
  if (!beforeMiss) { errs.push('no un-answered session left to mark missed'); }
  else {
    await p.click('#todayBody .workout-card [data-missed]');
    await p.waitForTimeout(1400);
    await p.click('.tab[data-tab="today"]');
    await p.waitForTimeout(700);
    const missedCard = await p.evaluate((key) => {
      const c = document.querySelector('#todayBody [data-workout="' + key + '"]')
        || [...document.querySelectorAll('#todayBody .workout-card')]
             .find(x => /missed/i.test(x.innerText));
      if (!c) return null;
      return { log: !!c.querySelector('[data-log]'), missed: !!c.querySelector('[data-missed]'),
               move: !!c.querySelector('[data-move]'),
               tappable: c.classList.contains('card-tappable'),
               workout: c.getAttribute('data-workout'),
               text: c.innerText.replace(/\s+/g, ' ').slice(-60) };
    }, beforeMiss.key);
    if (!missedCard) { errs.push('could not find the card after marking it missed'); }
    else {
      line('Log / Missed / Move', [missedCard.log, missedCard.missed, missedCard.move]
        .map(x => x ? 'yes' : 'no').join(' / '));
      line('card is tappable', missedCard.tappable && missedCard.workout ? 'yes' : 'NO');
      console.log('   ...' + missedCard.text);
      if (missedCard.log || missedCard.missed || missedCard.move) {
        errs.push('a missed session still shows buttons');
      }
      if (!missedCard.tappable || !missedCard.workout) {
        errs.push('missed card is not tappable — no way to log it if you did it after all');
      }
      await p.click('#todayBody [data-workout="' + missedCard.workout + '"]');
      await p.waitForTimeout(600);
      const back = await p.evaluate(() => ({
        screen: (document.querySelector('.screen.active') || {}).id,
        log: (document.getElementById('openLogButton') || {}).textContent,
        hidden: (document.getElementById('openLogButton') || {}).hidden
      }));
      line('tapping it opens', back.screen + ' — offers "' + (back.log || '').trim() + '"');
      if (back.screen !== 'workoutScreen' || back.hidden || !/Log this session/.test(back.log || '')) {
        errs.push('a missed session cannot be logged from its own screen');
      }
    }
  }

  // ----------------------------------------------------------------
  // The deliberate exception: a session moved *to* today has not been done,
  // it has been rescheduled. Collapsing it would hide the buttons at exactly
  // the moment they are wanted.
  console.log('');
  console.log('A SESSION MOVED TO TODAY');
  await p.click('#workoutScreen [data-back]');
  await p.waitForTimeout(500);
  const movedIn = await p.evaluate(async () => {
    const plan = AmsSync.getState().plan;
    const today = AmsSync.todayKey();
    const target = plan.find(w => w.discipline.id !== 'rest' && w.dayKey > today && !w.logged);
    if (!target) return { error: 'no future session available to move' };
    await AmsSync.rescheduleWorkout(target, today);
    return { key: target.key, from: target.dayKey };
  });
  if (movedIn.error) { console.log('   ' + movedIn.error + ' — skipped'); }
  else {
    await p.click('.tab[data-tab="plan"]');
    await p.waitForTimeout(200);
    await p.click('.tab[data-tab="today"]');
    await p.waitForTimeout(700);
    const card = await p.evaluate((key) => {
      const c = [...document.querySelectorAll('#todayBody .workout-card')]
        .find(x => x.querySelector('[data-log][data-log="' + key + '"], [data-workout="' + key + '"]'))
        || [...document.querySelectorAll('#todayBody .workout-card')]
             .find(x => /moved/i.test(x.innerText));
      if (!c) return null;
      return { log: !!c.querySelector('[data-log]'), missed: !!c.querySelector('[data-missed]'),
               move: !!c.querySelector('[data-move]'),
               text: c.innerText.replace(/\s+/g, ' ').slice(-70) };
    }, movedIn.key);
    if (!card) { errs.push('the session moved to today did not appear on Today'); }
    else {
      line('Log / Missed / Move', [card.log, card.missed, card.move]
        .map(x => x ? 'yes' : 'no').join(' / '));
      console.log('   ...' + card.text);
      if (!card.log || !card.missed || !card.move) {
        errs.push('a session moved to today lost its buttons — it still needs doing');
      }
    }
  }

  // ----------------------------------------------------------------
  // One column, three sports. A sheet with a single "Avg Pace/Pwr" column is
  // asking something different of each: minutes per kilometre of a runner,
  // minutes per hundred metres of a swimmer, and km/h of anybody on a bike,
  // who does not think in pace at all.
  console.log('');
  console.log('WHAT THAT ONE COLUMN IS CALLED');
  // A workbook whose sheet actually has that column, and all three sports on
  // one day. plain.xlsx has no pace column at all, so testing it there would
  // pass by finding nothing.
  await p.click('.tab[data-tab="settings"]');
  await p.waitForTimeout(300);
  await p.setInputFiles('#localFileInput', __dirname + '/fixtures/paced.xlsx');
  await p.waitForTimeout(2600);
  const paceFor = async (sportId) => {
    const opened = await p.evaluate((id) => {
      const t = AmsSync.getState().plan.find(w => w.discipline.id === id);
      if (!t) return false;
      const btn = document.createElement('button');
      btn.setAttribute('data-log', t.key);
      document.body.appendChild(btn); btn.click(); btn.remove();
      return true;
    }, sportId);
    if (!opened) return null;
    await p.waitForSelector('#log-actualDuration');
    await p.waitForTimeout(250);
    const out = await p.evaluate(() => {
      const i = document.getElementById('log-avgPace');
      if (!i) return null;
      return { label: i.closest('.field').querySelector('label').innerText.replace(/\s+/g, ' ').trim(),
               type: i.type, mode: i.getAttribute('inputmode') || '-' };
    });
    await p.click('#logScreen [data-back]');
    await p.waitForTimeout(350);
    return out;
  };

  const expected = { bike: /km\/h/, run: /min\/km/, swim: /100m/ };
  for (const sport of ['bike', 'run', 'swim']) {
    const r = await paceFor(sport);
    if (!r) { line(sport, 'no pace column in this workbook — skipped'); continue; }
    line(sport, r.label + '   [' + r.type + ', keypad: ' + r.mode + ']');
    if (!expected[sport].test(r.label)) {
      errs.push(sport + ' pace field reads "' + r.label + '"');
    }
    if (sport === 'bike' && r.mode !== 'decimal') {
      errs.push('a speed in km/h should open the digits, not "' + r.mode + '"');
    }
    // The column is "Avg Pace/Pwr": a number field would forbid "168 W", which
    // is half of what the column is named for.
    if (r.type !== 'text') {
      errs.push(sport + ' pace field is type=' + r.type + ', so a unit cannot be typed');
    }
  }

  // ----------------------------------------------------------------
  // A decimal comma. Half the world types one, and a phone gives whichever
  // separator it was set up with. A type="number" input parses with a full
  // stop and reports an empty value for anything else — so the field looks
  // filled in, and the number never reaches the workbook.
  console.log('');
  console.log('A DECIMAL COMMA');
  const comma = await p.evaluate(async () => {
    const t = AmsSync.getState().plan.find(w => w.discipline.id === 'bike')
           || AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
    await AmsDb.clearQueue();
    const btn = document.createElement('button');
    btn.setAttribute('data-log', t.key);
    document.body.appendChild(btn); btn.click(); btn.remove();
    await new Promise(r => setTimeout(r, 500));

    const set = (id, v) => { const n = document.getElementById(id); if (n) n.value = v; };
    set('log-actualDuration', '105');
    set('log-actualDistance', '52,4');
    set('log-avgPace', '32,5');
    document.getElementById('saveLogButton').click();
    await new Promise(r => setTimeout(r, 1400));

    const q = await AmsDb.listQueue();
    const out = await AmsSync.exportWorkbook();
    const wb = await AmsXlsx.open(new Uint8Array(await out.blob.arrayBuffer()));
    const sh = await wb.readSheet(t.sheet);
    const m = AmsSync.getState().mapping;
    return {
      queued: q.length ? q[0].values : null,
      distance: sh.textAt(t.row, m.columns.actualDistance),
      pace: m.columns.avgPace ? sh.textAt(t.row, m.columns.avgPace) : '(no column)'
    };
  });
  line('typed 52,4 — queued as', comma.queued ? comma.queued.actualDistance : '(nothing)');
  line('reaches the sheet as', comma.distance);
  line('typed 32,5 in pace — sheet', comma.pace);
  if (!comma.queued || comma.queued.actualDistance === undefined) {
    errs.push('a distance typed with a comma never reached the queue');
  }
  if (!/52[.,]4/.test(String(comma.distance))) {
    errs.push('a distance typed with a comma reached the sheet as "' + comma.distance + '"');
  }
  if (comma.pace !== '(no column)' && comma.pace !== '32.5') {
    errs.push('a speed typed with a comma should be normalised to 32.5, got "' + comma.pace + '"');
  }

  // No field on this form may be type=number, for the reason above.
  const numeric = await p.evaluate(() =>
    [...document.querySelectorAll('#logBody input')].filter(n => n.type === 'number')
      .map(n => n.id));
  line('fields still type=number', numeric.length ? numeric.join(', ') : 'none');
  if (numeric.length) errs.push('type=number fields remain: ' + numeric.join(', '));

  // ----------------------------------------------------------------
  // "Log something else" is a separate form with its own inputs, and it had
  // the same fault. On a phone the keypad shows the comma; a number input
  // then refuses the key, so pressing it does nothing at all.
  console.log('');
  console.log('A COMMA IN "LOG SOMETHING ELSE"');
  await p.click('.tab[data-tab="today"]');
  await p.waitForTimeout(600);
  await p.click('[data-extra]');
  await p.waitForSelector('#extraDistance');
  await p.waitForTimeout(400);

  const kinds = await p.evaluate(() =>
    ['extraDistance', 'extraAvgHr', 'extraEffort']
      .map(id => { const n = document.getElementById(id); return n ? n.type : 'missing'; }));
  line('input types', kinds.join(', '));
  if (kinds.some(k => k === 'number')) {
    errs.push('an extras field is still type=number, so its keypad comma does nothing');
  }

  await p.fill('#extraDistance', '7,5');
  const held = await p.evaluate(() => document.getElementById('extraDistance').value);
  line('typed "7,5", field holds', '"' + held + '"');
  if (held !== '7,5') errs.push('the comma will not go into the extras distance field');

  const extraOut = await p.evaluate(async () => {
    const dur = document.getElementById('extraDuration');
    if (dur) dur.value = '40';
    document.getElementById('saveExtraButton').click();
    await new Promise(r => setTimeout(r, 1500));
    const out = await AmsSync.exportWorkbook();
    const wb = await AmsXlsx.open(new Uint8Array(await out.blob.arrayBuffer()));
    const name = wb.sheets.map(s => s.name).find(n => /extra/i.test(n));
    if (!name) return null;
    const sh = await wb.readSheet(name);
    for (let r = 2; r <= 40; r++) {
      if (sh.textAt(r, 6)) return { sheet: name, distance: sh.textAt(r, 6) };
    }
    return { sheet: name, distance: null };
  });
  line('reaches the sheet as', extraOut ? String(extraOut.distance) : '(no Extras sheet)');
  if (!extraOut || String(extraOut.distance) !== '7.5') {
    errs.push('an extra distance typed "7,5" reached the sheet as '
      + JSON.stringify(extraOut && extraOut.distance));
  }

  console.log('');
  console.log('errors: ' + (errs.length ? '\n  - ' + errs.join('\n  - ') : 'none'));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
