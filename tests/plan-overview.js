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
 *
 * Since v1.55.0 the card also draws extras, and they are allowed to set that
 * shared height — a walk longer than any session in the block would otherwise
 * be drawn taller than the row holding it. Rescaling is linear, so the arc of
 * the block survives it; step 5 proves that rather than assuming it, because
 * "one scale" quietly becoming "one scale, mostly" is the same failure this
 * whole file exists to catch.
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

    /*
     * "Still to do" used to mean a bare outline, and this asked whether the
     * background was fully transparent. Since v1.51.0 it is tinted instead —
     * he asked for colour, and an outline of a light-mode sport colour reads
     * as grey. So what is checked is the property that actually matters and
     * always did: a session still to do must not be drawn the same as a
     * session that is done. It carries a ring, and it is not filled solid.
     */
    /*
     * Two shapes come back from getComputedStyle, and reading only one of them
     * is how this test first reported a tinted bar as solid: a plain colour
     * gives "rgba(r, g, b, a)", while anything built with color-mix gives
     * "color(srgb r g b / a)".
     */
    const alphaOf = (node) => {
      const value = getComputedStyle(node).backgroundColor;
      if (/transparent/.test(value)) return 0;
      const slashed = value.match(/\/\s*([\d.]+)\s*\)/);
      if (slashed) return parseFloat(slashed[1]);
      const rgba = value.match(/rgba?\(([^)]+)\)/);
      if (rgba) {
        const parts = rgba[1].split(',').map(n => parseFloat(n));
        return parts.length > 3 ? parts[3] : 1;
      }
      return 1;
    };

    const todo = bars.filter(b => b.classList.contains('is-todo'));
    return {
      bars: bars.length,
      todo: todo.length,
      ringed: todo.filter(b => /inset/.test(getComputedStyle(b).boxShadow)).length,
      solidLooking: todo.filter(b => alphaOf(b) > 0.9).length,
      invisible: todo.filter(b => alphaOf(b) < 0.05
        && !/inset/.test(getComputedStyle(b).boxShadow)).length,
      restLines: document.querySelectorAll('#planBody .block-rest').length,
      // Every bar takes its colour from the sport, as on Today.
      coloured: new Set(bars.map(b => getComputedStyle(b).getPropertyValue('--sport').trim())).size
    };
  });

  line('bars', alphabet.bars + ', of which ' + alphabet.todo + ' still to do');
  line('still-to-do bars carrying a ring', alphabet.ringed + ' of ' + alphabet.todo);
  line('any of them filled solid', alphabet.solidLooking);
  line('rest days drawn as a flat line', alphabet.restLines);
  line('distinct sport colours', alphabet.coloured);

  if (!alphabet.bars) errors.push('no bars were drawn at all');
  if (!alphabet.todo) errors.push('no still-to-do bars in a plan that is entirely ahead of today');
  if (alphabet.ringed !== alphabet.todo) {
    errors.push('a still-to-do bar has no ring, so it cannot be told from a finished one');
  }
  if (alphabet.solidLooking) {
    errors.push(alphabet.solidLooking + ' still-to-do bars are filled solid, which is what done looks like');
  }
  if (alphabet.invisible) errors.push('a still-to-do bar is neither tinted nor ringed, so it is invisible');
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

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('A LONG EXTRA DOES NOT FLATTEN THE BLOCK');

  const survived = await page.evaluate(async () => {
    const ink = () => [...document.querySelectorAll('#planBody .block-week')]
      .filter(w => !w.classList.contains('block-letters'))
      .map(w => ({
        label: w.querySelector('.block-week-label').textContent,
        // Planned bars only: the pink one is new ink and would mask the very
        // flattening this is looking for.
        ink: Math.round([...w.querySelectorAll('.block-bar:not(.is-extra)')]
          .reduce((n, b) => n + b.getBoundingClientRect().height, 0))
      }));

    const before = ink();

    // Longer than anything in an eight-week block: the worst case for the
    // shared scale, not a typical one.
    await AmsSync.logExtra({
      date: AmsSync.todayKey(), activity: 'hike', what: 'A very long walk',
      minutes: 400, distance: null, avgHr: null, effort: null,
      isTraining: false, notes: ''
    });
    await new Promise(r => setTimeout(r, 700));
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 400));

    const after = ink();
    // A real week row, not the row of weekday letters at the top — that one
    // is auto-height and measuring against it calls every bar an overflow.
    const rowHeight = document
      .querySelector('#planBody .block-week:not(.block-letters) .block-week-days')
      .getBoundingClientRect().height;

    return {
      before: before,
      after: after,
      pink: document.querySelectorAll('#planBody .block-bar.is-extra').length,
      overflowing: [...document.querySelectorAll('#planBody .block-bar')]
        .filter(b => b.getBoundingClientRect().height > rowHeight + 0.5).length
    };
  });

  const order = (rows) => rows.slice().sort((a, b) => a.ink - b.ink).map(r => r.label).join(' < ');
  line('weeks by ink, before', order(survived.before));
  line('weeks by ink, after', order(survived.after));
  line('pink bars drawn', survived.pink);

  if (!survived.pink) errors.push('the block card did not draw the extra at all');
  if (survived.overflowing) {
    errors.push(survived.overflowing + ' bar(s) taller than the row holding them — the extra was not '
      + 'counted into the shared height');
  }
  if (order(survived.before) !== order(survived.after)) {
    errors.push('a long extra reordered the weeks by volume, so the rescale was not linear');
  }

  // The light week must still be visibly lighter than the heavy one, which is
  // the property a floored bar height could quietly destroy.
  const sorted = survived.after.filter(w => w.ink > 0).sort((a, b) => a.ink - b.ink);
  if (sorted.length > 2) {
    const lightest = sorted[0];
    const heaviest = sorted[sorted.length - 1];
    line('lightest vs heaviest, after', lightest.label + ' ' + lightest.ink + 'px vs '
      + heaviest.label + ' ' + heaviest.ink + 'px');
    if (!(lightest.ink < heaviest.ink * 0.75)) {
      errors.push('after the long extra a recovery week is drawn nearly as heavy as a peak week — '
        + 'the short bars have bunched on the floor height');
    }
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
