/*
 * A moved session looks like what it is.
 *
 * Until v1.72.0 a move waiting to sync was a state of its own: drawn dashed,
 * and held in the same `pending` slot as a log, so it replaced whatever the
 * session really was. A done run moved to another day drew as undone, offered
 * its log buttons again, opened "Adjust logged data" empty — then turned solid
 * when the sync finished, which read as "syncing logged it". Martin asked what
 * the dashed outline was for; it went.
 *
 * Checked here, with Dropbox not connected so every entry stays queued:
 *   1. logged (queued) and then moved — still done, still holds the log
 *   2. done in the sheet and then moved — still done
 *   3. moved and then logged — done, and on its new day
 *   4. moved and never logged — still to do, labelled as a move on its way
 *   5. nothing on screen is drawn dashed for a move, and the key has three shapes
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

  const r = await page.evaluate(async () => {
    const plan = AmsSync.getState().plan;
    const days = [...new Set(plan.map(w => w.dayKey))].sort();
    const at = (i, sport) => AmsSync.byKey(plan.find(w => w.dayKey === days[i] && w.discipline.id === sport).key);
    const look = (w) => ({
      recorded: AmsSync.isRecorded ? AmsSync.isRecorded(w) : null,
      logged: !!w.logged,
      pendingIsMove: !!(w.pending && w.pending.values && w.pending.values.moveTo),
      loggedDuration: w.pending && w.pending.values ? w.pending.values.actualDuration || null : null,
      dayKey: w.dayKey
    });

    // 1. queued log, then a move
    const a = at(8, 'run');
    await AmsSync.logWorkout(a, { actualDuration: '41' });
    await AmsSync.rescheduleWorkout(AmsSync.byKey(a.key), days[10]);
    const one = look(AmsSync.byKey(a.key));

    // 2. done in the sheet, then a move
    const b = at(8, 'swim');
    b.loggedInSheet = true;
    b.results = Object.assign({}, b.results, { actualDuration: { text: '0.5', number: 0.5 } });
    await AmsSync.rescheduleWorkout(b, days[11]);
    const two = look(AmsSync.byKey(b.key));

    // 3. a move, then a log
    const c = at(9, 'run');
    await AmsSync.rescheduleWorkout(c, days[12]);
    await AmsSync.logWorkout(AmsSync.byKey(c.key), { actualDuration: '33' });
    const three = look(AmsSync.byKey(c.key));

    // 4. a move alone
    const d = at(9, 'swim');
    await AmsSync.rescheduleWorkout(d, days[13]);
    const four = look(AmsSync.byKey(d.key));

    return { one, two, three, four, days, keys: [a.key, b.key, c.key, d.key] };
  });

  console.log('LOGGED, THEN MOVED');
  line('recorded / logged', r.one.recorded + ' / ' + r.one.logged);
  line('the waiting log still held', r.one.loggedDuration);
  line('on its new day', r.one.dayKey === r.days[10]);
  if (!r.one.logged || !r.one.recorded) errors.push('a queued log was hidden by a later move');
  if (r.one.loggedDuration !== '41') errors.push('the queued log was replaced by the move');
  if (r.one.dayKey !== r.days[10]) errors.push('the move did not show on its new day');

  console.log('');
  console.log('DONE IN THE SHEET, THEN MOVED');
  line('recorded / logged', r.two.recorded + ' / ' + r.two.logged);
  if (!r.two.logged || !r.two.recorded) errors.push('a session done in the sheet reads as undone while its move waits');
  if (r.two.pendingIsMove) errors.push('a move sits where a record belongs');

  console.log('');
  console.log('MOVED, THEN LOGGED');
  line('recorded / on its new day', r.three.recorded + ' / ' + (r.three.dayKey === r.days[12]));
  if (!r.three.logged) errors.push('a log after a move did not count');
  if (r.three.dayKey !== r.days[12]) errors.push('a log after a move took the session back to its old day');

  console.log('');
  console.log('MOVED, NOT LOGGED');
  line('recorded', r.four.recorded);
  if (r.four.logged || r.four.recorded) errors.push('a move alone was counted as a record');

  // ---------------------------------------------------------------- the screen
  console.log('');
  console.log('WHAT THE SCREEN SHOWS');
  const screen = await page.evaluate(async (keys) => {
    const opened = [];
    for (const key of keys) {
      const b = document.createElement('button');
      b.dataset.workout = key;
      document.body.appendChild(b);
      b.click();
      await new Promise(res => setTimeout(res, 300));
      const log = document.getElementById('openLogButton');
      const one = document.getElementById('asPlannedButton');
      opened.push({ log: log ? log.textContent : null, oneTapHidden: one ? one.hidden : null,
                    pill: [...document.querySelectorAll('.pill')].map(p => p.textContent).filter(t => /sync/.test(t)).slice(-1)[0] || '' });
      b.remove();
      await new Promise(res => setTimeout(res, 200));
    }
    AmsUi.renderToday && AmsUi.renderToday();
    AmsUi.renderPlan && AmsUi.renderPlan();
    await new Promise(res => setTimeout(res, 300));
    return {
      opened,
      dashedMoves: document.querySelectorAll('.is-moved').length,
      legendHasMoved: /Moved to another day/.test(document.body.innerHTML)
    };
  }, r.keys);

  const names = ['logged then moved', 'done in sheet then moved', 'moved then logged', 'moved only'];
  screen.opened.forEach((o, i) => line(names[i], (o.log || '?') + (o.oneTapHidden === false ? ' · one-tap offered' : '')));
  line('bars drawn as "moved"', screen.dashedMoves);
  line('"Moved to another day" anywhere', screen.legendHasMoved);
  [0, 1, 2].forEach((i) => {
    if (screen.opened[i].log && screen.opened[i].log !== 'Adjust logged data') {
      errors.push(names[i] + ': the session screen offers "' + screen.opened[i].log + '" on a done session');
    }
    if (screen.opened[i].oneTapHidden === false) errors.push(names[i] + ': one-tap logging offered on a done session');
  });
  if (screen.opened[3].log && screen.opened[3].log !== 'Log details') {
    errors.push('moved only: expected "Log details", got "' + screen.opened[3].log + '"');
  }
  if (screen.dashedMoves) errors.push('something is still drawn as a move');
  if (screen.legendHasMoved) errors.push('the key still lists a moved shape');

  await page.evaluate(() => AmsDb.clearQueue());
  await browser.close();
  console.log('');
  console.log('errors:', errors.length ? '\n - ' + errors.join('\n - ') : 'none');
})();
