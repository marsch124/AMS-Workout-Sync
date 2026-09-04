/*
 * A rest day that is no longer a rest day.
 *
 * The workbook states rest as a row like any other, which makes it a thing
 * that happens on a day rather than a statement about the day. Move a session
 * onto it and both are shown, one under the other, the second contradicting
 * the first: a card saying "nothing to log today" beneath the run you just
 * moved there.
 *
 * The reading changes and the sheet does not, which is the part worth
 * guarding. Three things have to hold together, and it is easy to fix the
 * first and quietly break the other two:
 *
 *   1. the rest card goes, on Today and on the Plan list, as soon as anything
 *      lands on that day;
 *   2. the row is still in the plan, untouched, so nothing is written and
 *      moving the session away brings the rest day back;
 *   3. a rest day nobody touched is left exactly as it was.
 *
 * Deliberately weekday-independent. The fixture rests on a Friday, which is
 * only today's session one day in seven; the test finds its rest day rather
 * than assuming it is now.
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
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2600);

  // ---------------------------------------------------------------- 1
  console.log('A REST DAY WITH A SESSION MOVED ONTO IT');

  const moved = await page.evaluate(async () => {
    const plan = AmsSync.getState().plan;
    const rest = plan.find(w => w.discipline.id === 'rest');
    // Anything that is not on the rest day already, so the move is a real one.
    const session = plan.find(w => w.discipline.id !== 'rest' && w.dayKey !== rest.dayKey);

    const before = {
      shown: AmsSync.forDay(rest.dayKey).map(w => w.discipline.id),
      inPlan: plan.filter(w => w.dayKey === rest.dayKey).length
    };

    await AmsSync.rescheduleWorkout(session, rest.dayKey);

    const after = {
      shown: AmsSync.forDay(rest.dayKey).map(w => w.discipline.id),
      // The row itself must still be there: the sheet was not written to.
      inPlan: AmsSync.getState().plan.filter(w => w.dayKey === rest.dayKey).map(w => w.discipline.id),
      // And the whole-plan reading agrees with the per-day one.
      visibleHasRestThere: AmsSync.visiblePlan()
        .some(w => w.dayKey === rest.dayKey && w.discipline.id === 'rest')
    };

    return { restDay: rest.dayKey, sessionKey: session.key, sport: session.discipline.id, before, after };
  });

  line('before the move, the day showed', moved.before.shown.join(', '));
  line('after it, the day shows', moved.after.shown.join(', '));
  line('rows still in the plan for that day', moved.after.inPlan.join(', '));

  if (moved.before.shown.join() !== 'rest') errors.push('the fixture day did not start as a rest day');
  if (moved.after.shown.indexOf('rest') !== -1) errors.push('the rest card survived a session being moved onto its day');
  if (moved.after.shown.indexOf(moved.sport) === -1) errors.push('the moved session is not shown on the day it moved to');
  if (moved.after.inPlan.indexOf('rest') === -1) errors.push('the rest row was removed from the plan — only the reading should change');
  if (moved.after.visibleHasRestThere) errors.push('visiblePlan still carries the superseded rest row');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHAT THE SCREENS SHOW');

  const screens = await page.evaluate(async (restDay) => {
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 200));
    // The Plan list groups by day, so find that day's heading and read the
    // cards under it rather than the whole list.
    const dayText = (() => {
      const headings = [...document.querySelectorAll('#planBody .day-heading')];
      const target = headings.find(h => {
        const label = h.querySelector('h2').textContent;
        const d = AmsPlan.parseDayKey(restDay);
        return label.indexOf(String(d.getUTCDate())) !== -1;
      });
      if (!target) return null;
      const sports = [];
      let node = target.nextElementSibling;
      while (node && !node.classList.contains('day-heading')) {
        const sport = node.querySelector('.workout-card-sport');
        if (sport) sports.push(sport.textContent.trim());
        node = node.nextElementSibling;
      }
      return sports;
    })();

    return { planDay: dayText };
  }, moved.restDay);

  line('the Plan list for that day', (screens.planDay || []).join(', ') || '(day not in this list)');
  if (screens.planDay && screens.planDay.indexOf('Rest') !== -1) {
    errors.push('the Plan list still shows a rest card on a day that has a session');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('MOVING IT AWAY AGAIN');

  const back = await page.evaluate(async (info) => {
    const session = AmsSync.byKey(info.sessionKey);
    // Somewhere that is not the rest day and not already busy is not needed:
    // any other day will do, because the question is only whether the rest
    // day comes back.
    const elsewhere = AmsSync.getState().plan
      .find(w => w.dayKey !== info.restDay && w.discipline.id !== 'rest');
    await AmsSync.rescheduleWorkout(session, elsewhere.dayKey);
    return AmsSync.forDay(info.restDay).map(w => w.discipline.id);
  }, moved);

  line('the day shows again', back.join(', '));
  if (back.join() !== 'rest') errors.push('the rest day did not come back once the session left it');

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('A REST DAY NOBODY TOUCHED');

  const untouched = await page.evaluate(() => {
    // The fixture has a second rest day a week later with nothing else on it.
    const rests = AmsSync.getState().plan.filter(w => w.discipline.id === 'rest');
    return rests.map(r => ({
      day: r.dayKey,
      shown: AmsSync.forDay(r.dayKey).map(w => w.discipline.id).join(', ')
    }));
  });

  untouched.forEach(r => line(r.day, r.shown));
  if (untouched.some(r => r.shown.indexOf('rest') === -1)) {
    errors.push('a rest day with nothing on it stopped being shown');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
