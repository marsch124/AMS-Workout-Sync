/*
 * The record of what was moved — the only thing this app remembers that its
 * workbook does not.
 *
 * Rescheduling writes the new date over the old one, so the sheet keeps no
 * memory of a move. The app keeps its own, on the phone, and the Progress
 * screen leans on it for two figures: how often a session was moved rather
 * than lost, and which weekday a session was *planned* for.
 *
 * That makes it a small database, and small databases go wrong in the usual
 * ways: they outlive the thing they point at, they get written when the deed
 * failed, and they come back from storage in a shape nobody expected. All
 * three are checked here, because a wrong statistic that looks right is worse
 * than no statistic at all.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(38) + v);

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
  await page.setInputFiles('#localFileInput', SP + '/history.xlsx');
  await page.waitForTimeout(2600);

  // ---------------------------------------------------------------- 1
  // A key is "sheet name + row number". Insert one row in Excel and every
  // session below slides onto its neighbour's identity. A remembered move
  // must not then be read against a session it has nothing to do with.
  console.log('WHEN THE ROWS SHIFT UNDER IT');
  const attribution = await page.evaluate(() => {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const bike = { id: 'bike', label: 'Bike' };
    const run = { id: 'run', label: 'Run' };
    const workout = (key, disc, dayKey) => ({
      key, dayKey, discipline: disc, planned: {}, results: {}, logged: true
    });

    const run_ = (moveDiscipline) => AmsStats.summarise({
      workouts: [workout('S!6', bike, day(3))],
      moves: { 'S!6': { from: day(6), to: day(3), disciplineId: moveDiscipline } },
      todayKey: day(0),
      isMissed: () => false,
      isRecorded: () => true,
      orderOf: () => 0,
      plannedSecondsOf: () => 3600
    });

    const same = run_('bike');     // the row still holds what it held
    const other = run_('run');     // a row insert put a different sport here
    return { honouredMoved: same.moves.moved, ignoredMoved: other.moves.moved };
  });

  line('sport still matches — counted as moved', attribution.honouredMoved);
  line('sport no longer matches — counted as moved', attribution.ignoredMoved);

  if (attribution.honouredMoved !== 1) errors.push('a valid move was not counted');
  if (attribution.ignoredMoved !== 0) {
    errors.push('a stale move was counted as moved-and-kept');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHEN THE MOVE ITSELF FAILS');
  const failed = await page.evaluate(async () => {
    await AmsDb.set('moveLog', { since: null, moves: {} });
    const target = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
    const realQueue = AmsDb.queue;
    AmsDb.queue = async () => { throw new Error('disk full'); };
    let threw = null;
    try { await AmsSync.rescheduleWorkout(target, '2027-01-01'); } catch (e) { threw = e.message; }
    AmsDb.queue = realQueue;
    const log = await AmsDb.get('moveLog');
    return { threw: threw, recorded: Object.keys((log && log.moves) || {}).length };
  });
  line('queueing refused with', '"' + failed.threw + '"');
  line('moves recorded anyway', failed.recorded);
  if (!failed.threw) errors.push('the failure was swallowed rather than raised');
  if (failed.recorded !== 0) {
    errors.push('a move was recorded although the move never happened');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHEN STORAGE HANDS BACK SOMETHING ODD');
  const shapes = [
    ['a bare string', 'not an object at all'],
    ['an array', ['a', 'b']],
    ['moves as a string', { since: null, moves: 'nonsense' }],
    ['moves as an array', { since: null, moves: ['x'] }],
    ['a null record', { since: null, moves: { 'Weekly Schedules!5': null } }],
    ['from is a number', { since: null, moves: { 'Weekly Schedules!5': { from: 20260101, to: 'x', at: 'y' } } }],
    ['from is not a date', { since: null, moves: { 'Weekly Schedules!5': { from: 'yesterday', to: 'today', at: 'z' } } }],
    ['nested objects', { since: null, moves: { 'Weekly Schedules!5': { from: {}, to: [], at: {} } } }],
    ['since is an object', { since: {}, moves: {} }]
  ];
  for (const [label, value] of shapes) {
    const r = await page.evaluate(async (v) => {
      await AmsDb.set('moveLog', v);
      try {
        const s = await AmsSync.stats();
        return { ok: true, counted: s.counted, moved: s.moves.moved };
      } catch (e) { return { ok: false, err: e.message }; }
    }, value);
    line(label, r.ok ? 'survived — ' + r.counted + ' sessions, ' + r.moved + ' moved'
                     : 'THREW: ' + r.err);
    if (!r.ok) errors.push(label + ' threw');
    if (r.ok && r.moved !== 0) errors.push(label + ' was counted as a real move');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('AND THE SCREEN STILL DRAWS');
  await page.click('.tab[data-tab="progress"]');
  await page.waitForTimeout(800);
  const drawn = await page.evaluate(() => {
    const b = document.getElementById('progressBody');
    return { blocks: b.querySelectorAll('.stat-block').length,
             empty: !!b.querySelector('.empty-state'),
             text: b.innerText.replace(/\s+/g, ' ').slice(0, 90) };
  });
  line('panels', drawn.blocks || (drawn.empty ? 'empty state' : 'NOTHING'));
  console.log('   ' + drawn.text);
  if (!drawn.blocks && !drawn.empty) errors.push('the Progress screen drew nothing at all');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
