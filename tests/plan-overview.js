/*
 * The block at a glance, at the top of the Plan tab.
 *
 * The tab was a list, and a list answers "what is next" and not "what does the
 * next month look like" — which on a 48-week build is the question the plan
 * exists to answer. This draws eight weeks at once in the same alphabet as the
 * week strip on Today.
 *
 * The load-bearing decision, and the thing this test is really for: **one
 * height scale across every week**, not one per week. A recovery week is only
 * legible as a recovery week if its bars are visibly shorter than the weeks
 * either side of it, and scaling each row to its own tallest session would
 * flatten exactly the shape the drawing exists to show. It is the kind of
 * mistake that leaves a chart looking perfectly reasonable and saying nothing,
 * so it is asserted rather than eyeballed.
 *
 * The fixture is eight weeks with two recovery weeks in it, at roughly half
 * the volume of their neighbours.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(44) + v);

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
  await page.setInputFiles('#localFileInput', SP + '/block.xlsx');
  await page.waitForTimeout(2600);

  // ---------------------------------------------------------------- 1
  console.log('EIGHT WEEKS, IN ORDER');

  const shape = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="plan"]').click();
    await new Promise(r => setTimeout(r, 700));

    const card = document.querySelector('#planBody .block-card');
    if (!card) return { error: 'no overview at the top of the Plan tab' };

    // It has to be above the list, not tucked underneath it.
    const firstDay = document.querySelector('#planBody .day-heading, #planBody .workout-card');
    const aboveTheList = !firstDay
      || card.getBoundingClientRect().top < firstDay.getBoundingClientRect().top;

    const weeks = [...card.querySelectorAll('.block-week')].filter(w => !w.classList.contains('block-letters'));

    return {
      aboveTheList: aboveTheList,
      title: card.querySelector('.block-title').textContent,
      weeks: weeks.length,
      labels: weeks.map(w => w.querySelector('.block-week-label').textContent),
      hours: weeks.map(w => w.querySelector('.block-week-hours').textContent),
      nowRows: weeks.filter(w => w.classList.contains('is-now')).length,
      pastRows: weeks.filter(w => w.classList.contains('is-past')).length,
      letters: [...card.querySelectorAll('.block-letters .block-week-days span')].map(n => n.textContent).join(''),
      todayColumns: card.querySelectorAll('.block-day.is-today').length
    };
  });

  if (shape.error) { errors.push(shape.error); }
  else {
    line('sits above the list', shape.aboveTheList);
    line('the block it names', shape.title);
    line('weeks drawn', shape.weeks);
    line('labelled', shape.labels.join(' · '));
    line('weekday letters', shape.letters);
    line('this week marked, past weeks faded', shape.nowRows + ' now, ' + shape.pastRows + ' past');

    if (!shape.aboveTheList) errors.push('the overview is below the list rather than above it');
    if (shape.weeks < 6) errors.push('the overview draws fewer weeks than the fixture has');
    if (shape.letters !== 'MTWTFSS') errors.push('the weekday letters are missing or in the wrong order');
    if (shape.nowRows !== 1) errors.push('this week is not marked exactly once');
    if (!shape.pastRows) errors.push('the week behind is not shown as past');
    if (shape.labels[0] !== 'Last week') errors.push('the first row is not last week');
    if (shape.labels.indexOf('This week') === -1) errors.push('this week is not labelled');
    if (shape.labels.indexOf('Next week') === -1) errors.push('next week is not labelled');
    if (shape.todayColumns !== 1) errors.push('today is not picked out exactly once');
    if (shape.hours.filter(Boolean).length < shape.weeks) errors.push('a week is drawn without its hours');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('ONE SCALE ACROSS THE WHOLE CARD');

  const scale = await page.evaluate(() => {
    const weeks = [...document.querySelectorAll('#planBody .block-week')]
      .filter(w => !w.classList.contains('block-letters'));

    const perWeek = weeks.map((week) => {
      const bars = [...week.querySelectorAll('.block-bar')];
      const tallest = Math.max(0, ...bars.map(b => b.getBoundingClientRect().height));
      const total = bars.reduce((n, b) => n + b.getBoundingClientRect().height, 0);
      return {
        label: week.querySelector('.block-week-label').textContent,
        hours: week.querySelector('.block-week-hours').textContent,
        tallest: Math.round(tallest),
        total: Math.round(total),
        bars: bars.length
      };
    });

    return {
      perWeek: perWeek,
      // The recovery weeks in the fixture are the two shortest by planned time.
      distinctTallest: new Set(perWeek.map(w => w.tallest)).size
    };
  });

  scale.perWeek.forEach(w => line(w.label + ' (' + w.hours + ')',
    w.bars + ' bars, tallest ' + w.tallest + 'px, ink ' + w.total + 'px'));

  const byHours = scale.perWeek
    .map(w => ({ w: w, minutes: (parseInt((w.hours.match(/(\d+)h/) || [0, 0])[1], 10) * 60)
                              + parseInt((w.hours.match(/(\d+)m/) || [0, 0])[1], 10) }))
    .filter(x => x.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (byHours.length > 2) {
    const lightest = byHours[0].w;
    const heaviest = byHours[byHours.length - 1].w;
    line('lightest vs heaviest week', lightest.label + ' ' + lightest.total + 'px vs '
      + heaviest.label + ' ' + heaviest.total + 'px');

    // If every row were scaled to itself, a recovery week would carry the same
    // amount of ink as a peak week and the drawing would say nothing.
    if (!(lightest.total < heaviest.total * 0.75)) {
      errors.push('a light week is drawn nearly as tall as a heavy one — the rows are scaled '
        + 'to themselves rather than to one shared height');
    }
    if (!(lightest.tallest < heaviest.tallest)) {
      errors.push('the tallest bar of a light week matches a heavy week, so the scale is per-row');
    }
    if (scale.distinctTallest < 3) {
      errors.push('nearly every week peaks at the same height, which is what a per-row scale looks like');
    }
  } else {
    errors.push('not enough weeks with hours to test the scaling');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('THE SAME ALPHABET AS THE WEEK STRIP');

  const alphabet = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('#planBody .block-bar')];
    const hollow = bars.filter(b => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)');
    const solid = bars.filter(b => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)');
    return {
      bars: bars.length,
      hollow: hollow.length,
      solid: solid.length,
      restLines: document.querySelectorAll('#planBody .block-rest').length,
      // Every bar takes its colour from the sport, as on Today.
      coloured: new Set(bars.map(b => getComputedStyle(b).getPropertyValue('--sport').trim())).size
    };
  });

  line('bars', alphabet.bars + ' — ' + alphabet.hollow + ' still to do, ' + alphabet.solid + ' filled');
  line('rest days drawn as a flat line', alphabet.restLines);
  line('distinct sport colours', alphabet.coloured);

  if (!alphabet.bars) errors.push('no bars were drawn at all');
  if (!alphabet.hollow) errors.push('nothing is drawn hollow, so still-to-do reads as done');
  if (!alphabet.restLines) errors.push('rest days are drawn as empty columns rather than flat lines');
  if (alphabet.coloured < 3) errors.push('the bars are not taking their colour from the sport');

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('ON EVERY LIST, AND ON NONE OF THEM WHEN THERE IS NOTHING');

  const segments = await page.evaluate(async () => {
    const out = {};
    for (const range of ['upcoming', 'past', 'missed', 'all']) {
      document.querySelector('.segment[data-range="' + range + '"]').click();
      await new Promise(r => setTimeout(r, 400));
      out[range] = !!document.querySelector('#planBody .block-card');
    }
    document.querySelector('.segment[data-range="upcoming"]').click();
    await new Promise(r => setTimeout(r, 300));

    // With no plan at all there is nothing to draw, and it must not draw an
    // empty frame around it.
    const kept = AmsSync.getState().plan.slice();
    AmsSync.getState().plan.length = 0;
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 300));
    out.withNoPlan = !!document.querySelector('#planBody .block-card');
    kept.forEach(w => AmsSync.getState().plan.push(w));
    AmsUi.renderPlan();
    return out;
  });

  line('shown on', Object.keys(segments).filter(k => k !== 'withNoPlan' && segments[k]).join(', '));
  line('shown when there is no plan', segments.withNoPlan);

  ['upcoming', 'past', 'missed', 'all'].forEach((range) => {
    if (!segments[range]) errors.push('the overview disappears on the "' + range + '" list');
  });
  if (segments.withNoPlan) errors.push('an empty overview is drawn when there is no plan to draw');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
