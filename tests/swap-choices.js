/*
 * What "Or swap it with" offers.
 *
 * A swap exchanges two rows' dates, and a row carries its results with it. On
 * 14 September 2026 Martin swapped today's swim with what he took to be
 * Wednesday's run. The list put Saturday's long run first — already done, two
 * days back, the same distance away as Wednesday — and that is the one that
 * moved. After the sync the done run sat on today with its figures, the swim
 * sat in last week, and it looked as though the app had logged a run for him.
 *
 * So: a session that already carries a result is never in the list, whether
 * the result is in the sheet or still waiting to sync, and where two sessions
 * are equally far away the one still to come is offered first.
 *
 * everyday.xlsx has a run and a swim on each of fourteen days from this week's
 * Monday, so the scene is set around next Monday and the test means the same
 * on whichever day it is run.
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
  console.log('THE SCENE OF 14 SEPTEMBER');

  const scene = await page.evaluate(async () => {
    const plan = AmsSync.getState().plan;
    const days = [...new Set(plan.map(w => w.dayKey))].sort();
    const at = (i, sport) => plan.find(w => w.dayKey === days[i] && w.discipline.id === sport);

    // Next Monday's swim is "today's swim". Saturday's run is done; the
    // Wednesday run is the one he meant.
    const swim = at(7, 'swim');
    const doneRun = at(5, 'run');
    const meantRun = at(9, 'run');
    if (!swim || !doneRun || !meantRun) return { error: 'everyday.xlsx is not the shape this test expects' };

    // Saturday's run in the sheet already, and Sunday's swim logged but not yet synced.
    doneRun.loggedInSheet = true;
    doneRun.results = { actualDuration: { text: '50', number: 50 } };
    const waitingSwim = at(6, 'swim');
    await AmsSync.logWorkout(waitingSwim, { actualDuration: '30' });

    const candidates = AmsSync.swapCandidates(AmsSync.byKey(swim.key));
    return {
      swimKey: swim.key,
      doneRunKey: doneRun.key,
      waitingSwimKey: waitingSwim.key,
      meantRunKey: meantRun.key,
      keys: candidates.map(c => c.w.key),
      gaps: candidates.map(c => c.gap)
    };
  });

  if (scene.error) {
    errors.push(scene.error);
  } else {
    line('offered', scene.keys.length + ' sessions');
    line('gaps, in order', scene.gaps.join(' '));
    line('done run from Saturday offered', scene.keys.includes(scene.doneRunKey));
    line('swim waiting to sync offered', scene.keys.includes(scene.waitingSwimKey));
    line('the run he meant offered', scene.keys.includes(scene.meantRunKey));

    if (scene.keys.includes(scene.doneRunKey)) errors.push('a session done in the sheet is offered to swap');
    if (scene.keys.includes(scene.waitingSwimKey)) errors.push('a session logged and waiting to sync is offered to swap');
    if (!scene.keys.includes(scene.meantRunKey)) errors.push('an undone session two days ahead is not offered');
    if (scene.keys.includes(scene.swimKey)) errors.push('a session is offered to swap with itself');

    // Equal distance: the future one first.
    for (let i = 1; i < scene.gaps.length; i++) {
      const a = scene.gaps[i - 1];
      const b = scene.gaps[i];
      if (Math.abs(a) > Math.abs(b)) errors.push('not nearest first at position ' + i);
      if (Math.abs(a) === Math.abs(b) && a < b) errors.push('a past session is offered before an equally near future one');
    }
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHAT THE SCREEN SHOWS');

  if (!scene.error) {
    const shown = await page.evaluate(async (s) => {
      const button = document.createElement('button');
      button.dataset.move = s.swimKey;
      document.body.appendChild(button);
      button.click();
      await new Promise(r => setTimeout(r, 400));
      const keys = [...document.querySelectorAll('#rescheduleBody [data-swap]')].map(b => b.dataset.swap);
      button.remove();
      return keys;
    }, scene);

    line('buttons on the screen', shown.length);
    line('same list, same order', JSON.stringify(shown) === JSON.stringify(scene.keys));
    if (JSON.stringify(shown) !== JSON.stringify(scene.keys)) {
      errors.push('the screen does not show what swapCandidates() offers');
    }
  }

  await page.evaluate(() => AmsDb.clearQueue());
  await browser.close();
  console.log('');
  console.log('errors:', errors.length ? '\n - ' + errors.join('\n - ') : 'none');
})();
