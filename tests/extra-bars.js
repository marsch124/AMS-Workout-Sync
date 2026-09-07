/*
 * The pink bars: everything done outside the plan, drawn in the week strip.
 *
 * The week card already said "· 40m extra" in its figures, which is a sentence
 * you have to read. The drawing above it showed nothing at all, so a week in
 * which he swam twice and walked for an hour looked exactly like a week in
 * which he swam twice. The bars fix that, and this is what has to stay true
 * about them:
 *
 *   1. an extra draws a bar on its own day, whatever else is on that day —
 *      training, nothing, or a planned rest;
 *   2. the pink is a colour no discipline uses, because colour is how the
 *      strip says which sport and this one has to say "not one of them";
 *   3. the height scale takes the extras in. Scaling against the biggest
 *      *planned* day would let a two-hour hike draw a bar taller than the
 *      column that holds it, which is the one way a bar chart can lie without
 *      looking wrong;
 *   4. a rest day he walked on keeps its rest line. Both things happened.
 *
 * plain.xlsx is the fixture because its week has all four kinds of day in it:
 * Monday blank, Wednesday training, Friday rest, and room to add a long extra.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  // A phone, because the strip is seven columns across whatever it is given
  // and the widths only get tight at the bottom of the range.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2600);
  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(700);

  // ---------------------------------------------------------------- 1
  console.log('BEFORE ANY EXTRA');

  const before = await page.evaluate(() => ({
    bars: document.querySelectorAll('.week-bar-seg').length,
    extras: document.querySelectorAll('.week-bar-seg.is-extra').length,
    days: AmsSync.weekDays().map(d => d.extras.length)
  }));
  line('bars in the strip', before.bars);
  line('pink ones', before.extras);
  if (!before.bars) errors.push('the week strip drew nothing at all');
  if (before.extras) errors.push('a pink bar appeared with no extra logged');
  if (before.days.some(n => n !== 0)) errors.push('weekDays() invented extras');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('ONE ON EVERY KIND OF DAY');

  // Monday is blank in this fixture, Wednesday carries two sessions, Friday is
  // the rest day. The Tuesday hike is deliberately longer than anything the
  // week plans, which is what step 4 measures.
  const logged = await page.evaluate(async () => {
    const monday = AmsSync.weekStart(AmsSync.todayKey());
    const shift = (key, n) => {
      const d = AmsPlan.parseDayKey(key);
      d.setUTCDate(d.getUTCDate() + n);
      return AmsXlsx.dayKey(d);
    };
    const put = (offset, activity, minutes) => AmsSync.logExtra({
      date: shift(monday, offset), activity: activity, what: activity,
      minutes: minutes, distance: null, avgHr: null, effort: null,
      isTraining: false, notes: ''
    });
    await put(0, 'walk', 50);        // Monday, nothing planned
    await put(1, 'hike', 120);       // Tuesday, longer than any planned day
    await put(2, 'meditation', 15);  // Wednesday, beside two sessions
    await put(4, 'yoga', 30);        // Friday, the rest day
    await new Promise(r => setTimeout(r, 600));

    const cols = [...document.querySelectorAll('.week-day')];
    return {
      byDay: cols.map(c => ({
        planned: c.querySelectorAll('.week-bar-seg:not(.is-extra)').length,
        extra: c.querySelectorAll('.week-bar-seg.is-extra').length,
        rest: c.querySelectorAll('.week-rest').length,
        label: c.getAttribute('aria-label')
      }))
    };
  });

  const shape = logged.byDay.map(d =>
    (d.rest ? 'R' : '') + '.'.repeat(d.planned) + '#'.repeat(d.extra)).join(' ');
  line('Mon..Sun  (. planned, # extra, R rest)', shape || '(nothing)');

  const extrasPerDay = logged.byDay.map(d => d.extra);
  if (String(extrasPerDay) !== String([1, 1, 1, 0, 1, 0, 0])) {
    errors.push('the pink bars did not land on the days they were logged on: ' + extrasPerDay);
  }
  if (!logged.byDay[4].rest) errors.push('a walk on the rest day took the rest line away with it');
  if (logged.byDay[2].planned !== 2) errors.push('the extra displaced the sessions planned that day');
  if (!/1 extra/.test(logged.byDay[0].label || '')) {
    errors.push('the day button does not say the extra out loud: ' + logged.byDay[0].label);
  }
  line('Monday reads as', logged.byDay[0].label);

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('THE COLOUR BELONGS TO NOTHING ELSE');

  const colours = await page.evaluate(() => {
    const of = (name) => getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    const sports = ['swim', 'bike', 'run', 'strength', 'mobility', 'other', 'rest', 'race']
      .map(id => [id, of('--sport-' + id)]);
    const bar = document.querySelector('.week-bar-seg.is-extra');
    return {
      painted: bar ? getComputedStyle(bar).backgroundColor : null,
      extra: of('--sport-extra'),
      sports: sports
    };
  });
  line('the extras are painted', colours.painted);
  colours.sports.forEach(([id, hex]) => {
    if (hex.toLowerCase() === colours.extra.toLowerCase()) {
      errors.push('the extra colour is the same as ' + id + ': ' + hex);
    }
  });
  line('shared with a discipline', 'no');
  if (!colours.painted || /rgba\(0, 0, 0, 0\)/.test(colours.painted)) {
    errors.push('the extra bar was drawn with no fill at all');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('THE SCALE TAKES THEM IN');

  const heights = await page.evaluate(() => {
    const days = AmsSync.weekDays();
    const box = document.querySelector('.week-day-bars');
    const bars = [...document.querySelectorAll('.week-bar-seg')].map(b => ({
      extra: b.classList.contains('is-extra'),
      pct: +(b.getBoundingClientRect().height / box.getBoundingClientRect().height * 100).toFixed(1)
    }));
    return {
      biggestDay: Math.max(...days.map(d => d.plannedSeconds + d.extraSeconds)),
      biggestPlannedDay: Math.max(...days.map(d => d.plannedSeconds)),
      tallest: Math.max(...bars.map(b => b.pct)),
      tallestIsExtra: bars.filter(b => b.pct === Math.max(...bars.map(x => x.pct)))[0].extra,
      over: bars.filter(b => b.pct > 100.5).length
    };
  });
  line('biggest day, planned only', Math.round(heights.biggestPlannedDay / 60) + 'm');
  line('biggest day, extras counted', Math.round(heights.biggestDay / 60) + 'm');
  line('tallest bar drawn', heights.tallest + '% of the column');
  if (heights.biggestDay <= heights.biggestPlannedDay) {
    errors.push('the 2h hike did not enlarge the week — the fixture is not testing the scale');
  }
  if (heights.over) errors.push(heights.over + ' bar(s) drawn taller than the column that holds them');
  if (!heights.tallestIsExtra) {
    errors.push('the longest thing in the week is an extra, but it is not the tallest bar');
  }

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('THE KEY AND THE OPENED DAY');

  const key = await page.evaluate(async () => {
    document.querySelector('.week-card-head-main[data-legend]').click();
    await new Promise(r => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('.week-legend-shapes li')].map(li => li.innerText.trim());
    const swatch = document.querySelector('.week-legend-swatch .week-bar-seg.is-extra');
    const painted = swatch ? getComputedStyle(swatch).backgroundColor : null;
    document.querySelector('.week-card-head-main[data-legend]').click();
    await new Promise(r => setTimeout(r, 250));

    // Monday: an extra and nothing else. Tapping its bar has to explain it.
    document.querySelectorAll('.week-day')[0].click();
    await new Promise(r => setTimeout(r, 300));
    const opened = document.querySelector('.week-expanded');
    return {
      rows: rows,
      painted: painted,
      opened: opened ? opened.innerText.replace(/\s+/g, ' ').trim() : null,
      extraRows: document.querySelectorAll('.week-expanded-row.is-extra').length
    };
  });
  key.rows.forEach(r => line('key row', r));
  line('the opened Monday says', key.opened);

  if (!key.rows.some(r => /extra/i.test(r))) {
    errors.push('the key explains every mark in the strip except the pink one');
  }
  if (key.painted !== colours.painted) {
    errors.push('the key draws the extra in a different colour from the strip: '
      + key.painted + ' against ' + colours.painted);
  }
  if (key.extraRows !== 1) errors.push('opening a day with only an extra on it showed no extra');
  if (/Nothing planned/.test(key.opened || '')) {
    errors.push('tapping a pink bar answered "Nothing planned"');
  }
  if (!/50m|Walk/i.test(key.opened || '')) {
    errors.push('the opened day does not name the walk or its length: ' + key.opened);
  }

  // ---------------------------------------------------------------- 6
  console.log('');
  console.log('THE KEY IS QUIET AGAIN WITHOUT THEM');

  const quiet = await page.evaluate(async () => {
    await AmsDb.clearQueue();
    await AmsSync.overlayQueue();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector('.week-card-head-main[data-legend]').click();
    await new Promise(r => setTimeout(r, 300));
    return {
      rows: [...document.querySelectorAll('.week-legend-shapes li')].map(li => li.innerText.trim()),
      bars: document.querySelectorAll('.week-bar-seg.is-extra').length
    };
  });
  line('pink bars once the queue is emptied', quiet.bars);
  line('key rows now', quiet.rows.length);
  if (quiet.bars) errors.push('a pink bar outlived the extra it was drawn for');
  if (quiet.rows.some(r => /extra/i.test(r))) {
    errors.push('the key still explains a mark the week no longer has');
  }

  console.log('');
  console.log(errors.length ? 'errors:' : 'errors: none');
  errors.forEach(e => console.log('   ! ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
