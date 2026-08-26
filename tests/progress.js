/*
 * The Progress screen, over twelve weeks of history with a known shape.
 *
 * The fixture is built so the answers are known in advance: Thursday is the
 * day that slips, swim is the sport that runs behind, the last fortnight is
 * clean so there is a streak to find, and some sessions are left unanswered
 * so that "not logged" cannot quietly read as "completed".
 *
 * The one that matters most is the rest days. They must not be counted at
 * all — a day off cannot be kept or missed, and counting it as a kept session
 * would flatter every figure on the screen.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(34) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
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
  console.log('THE FIGURES');
  await page.click('.tab[data-tab="progress"]');
  await page.waitForTimeout(700);

  const stats = await page.evaluate(() => AmsSync.stats());

  line('sessions counted', stats.counted);
  line('completed', stats.done);
  line('missed', stats.missed);
  line('unanswered', stats.unlogged);
  line('current streak', stats.streak.current);
  line('longest streak', stats.streak.longest);

  // 12 weeks x 6 real sessions = 72; the 12 rest days must not be among them.
  if (stats.counted !== 72) errors.push('expected 72 sessions counted, got ' + stats.counted);
  if (stats.done + stats.missed + stats.unlogged !== stats.counted) {
    errors.push('outcomes do not add up to the total');
  }
  if (stats.unlogged === 0) errors.push('unanswered sessions were not counted as such');

  // The last fortnight is clean: 12 sessions, so the streak must reach it.
  if (stats.streak.current < 12) {
    errors.push('expected a streak of at least 12, got ' + stats.streak.current);
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('REST DAYS ARE NOT SESSIONS');
  const rest = await page.evaluate(() =>
    AmsSync.getState().plan.filter(w => w.discipline.id === 'rest').length);
  line('rest days in the plan', rest);
  line('counted in the figures', 'no (72 = 12 x 6 sessions)');
  if (rest === 0) errors.push('fixture has no rest days, so the exclusion is untested');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHICH DAY SLIPS');
  stats.day.rows.forEach(r => {
    if (r.planned) line(r.name, Math.round(r.rate * 100) + '%  (' + r.done + '/' + r.planned + ')');
  });
  line('worst', stats.day.worst ? stats.day.worst.name : '(none)');
  if (!stats.day.worst || stats.day.worst.name !== 'Thursday') {
    errors.push('expected Thursday to be the day that slips, got '
      + (stats.day.worst ? stats.day.worst.name : 'none'));
  }
  // Friday is the rest day: it must have no sessions at all.
  const friday = stats.day.rows.find(r => r.name === 'Friday');
  if (friday && friday.planned !== 0) {
    errors.push('the rest day was counted as ' + friday.planned + ' sessions');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('WHICH SPORT RUNS BEHIND');
  stats.sport.rows.forEach(r =>
    line(r.label, Math.round(r.rate * 100) + '%  (' + r.done + '/' + r.planned + ')'));
  line('worst', stats.sport.worst ? stats.sport.worst.label : '(none)');
  if (!stats.sport.worst || stats.sport.worst.label !== 'Swim') {
    errors.push('expected Swim to be furthest behind, got '
      + (stats.sport.worst ? stats.sport.worst.label : 'none'));
  }
  if (stats.sport.rows.some(r => r.label === 'Rest')) {
    errors.push('Rest appeared as a sport');
  }

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('MISSED, OR MOVED');
  line('missed', stats.moves.missed);
  line('moved and kept', stats.moves.moved);

  // Move a session, and the move must be remembered even though the sheet
  // will have no memory of it once the date is overwritten.
  const moved = await page.evaluate(async () => {
    const plan = AmsSync.getState().plan;
    // A past session: a move only counts once the day it moved to has come.
    const target = plan.find(w => w.discipline.id !== 'rest'
      && w.dayKey < AmsSync.todayKey() && !AmsSync.getState().plan.missed);
    if (!target) return { error: 'no past session to move' };
    const from = target.dayKey;
    const to = new Date(Date.parse(from + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    await AmsSync.rescheduleWorkout(target, to);
    const after = await AmsSync.stats();
    return { from, to, moved: after.moves.moved, since: after.moves.since };
  });

  if (moved.error) { errors.push(moved.error); }
  else {
    line('moved ' + moved.from + ' -> ' + moved.to, 'recorded');
    line('moves now counted', moved.moved);
    line('recording since', moved.since ? moved.since.slice(0, 10) : '(unset)');
    if (moved.moved !== 1) errors.push('the move was not recorded (got ' + moved.moved + ')');
  }

  // ---------------------------------------------------------------- 6
  console.log('');
  console.log('THE SCREEN ITSELF');
  await page.click('.tab[data-tab="plan"]');
  await page.waitForTimeout(200);
  await page.click('.tab[data-tab="progress"]');
  await page.waitForTimeout(700);

  const screen = await page.evaluate(() => {
    const body = document.getElementById('progressBody');
    return {
      blocks: body.querySelectorAll('.stat-block').length,
      bars: body.querySelectorAll('.stat-bar').length,
      rows: body.querySelectorAll('.stat-row').length,
      caution: !!body.querySelector('.stat-caution'),
      text: body.innerText.replace(/\s+/g, ' ').slice(0, 260),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  line('panels drawn', screen.blocks);
  line('weekday bars', screen.bars);
  line('sport rows', screen.rows);
  line('"too early" caution', screen.caution ? 'shown' : 'not shown (enough history)');
  line('page scrolls sideways', screen.overflow ? 'YES' : 'no');
  console.log('   ' + screen.text);

  if (screen.blocks !== 5) errors.push('expected 5 panels, got ' + screen.blocks);
  if (screen.bars !== 7) errors.push('expected 7 weekday bars, got ' + screen.bars);
  if (screen.overflow) errors.push('the page scrolls sideways on a phone-width screen');
  if (screen.caution) errors.push('the "too early" caution showed with 72 sessions of history');

  // ---------------------------------------------------------------- 7
  console.log('');
  console.log('A PLAN WITH NO HISTORY');
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(300);
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);
  await page.click('.tab[data-tab="progress"]');
  await page.waitForTimeout(700);
  const empty = await page.evaluate(() => {
    const body = document.getElementById('progressBody');
    return {
      empty: !!body.querySelector('.empty-state'),
      caution: !!body.querySelector('.stat-caution'),
      text: body.innerText.replace(/\s+/g, ' ').slice(0, 150)
    };
  });
  line('shows an empty state or caution', (empty.empty || empty.caution) ? 'yes' : 'NO');
  console.log('   ' + empty.text);
  if (!empty.empty && !empty.caution) {
    errors.push('a plan with almost no history drew confident figures with no caveat');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
