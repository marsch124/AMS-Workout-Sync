/*
 * The road to the race, at the top of Progress.
 *
 * Today shows this week and the Plan tab shows eight. Neither can show the
 * shape of an eleven-month build or how far along it you are — which is the
 * question the plan is an answer to.
 *
 * Everything here is read out of the workbook: the race is a row in it, the
 * phases are a column in it, the hours are the ones already being summed
 * elsewhere. Nothing is configured and nothing is stored, so what this test
 * really guards is that the reading stays honest:
 *
 *   1. the race and its date come from the plan, and where there is no race
 *      row the last day is called the last day rather than dressed up as one;
 *   2. a session dated *today* is neither due nor behind. Opening the screen
 *      at eight in the morning to be told you are behind on a ride you are
 *      about to go out on would be the app being wrong on purpose;
 *   3. the phase bands are the plan's own shape, as wide as the days they
 *      cover, with the marker where today actually falls;
 *   4. the countdown changes unit as the race comes closer, because eleven
 *      months in days is a number nobody can hold.
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

  const load = async (name) => {
    await page.evaluate(() => AmsDb.remove('mapping'));
    await page.click('.tab[data-tab="settings"]');
    await page.waitForSelector('#openLocalButton');
    await page.setInputFiles('#localFileInput', SP + '/' + name);
    await page.waitForTimeout(2800);
    await page.evaluate(async () => { await AmsDb.clearQueue(); await AmsSync.overlayQueue(); });
  };

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await load('season-underway.xlsx');

  // ---------------------------------------------------------------- 1
  console.log('A BUILD ALREADY UNDER WAY');

  const road = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 1000));
    const card = document.querySelector('#progressBody .road-card');
    if (!card) return { error: 'no road card on the Progress tab' };

    const figures = AmsUi.__roadFigures();
    const bands = [...card.querySelectorAll('.road-band')];
    return {
      isFirst: document.querySelector('#progressBody > *') === card,
      count: card.querySelector('.road-count').textContent,
      unit: card.querySelector('.road-unit').textContent,
      race: card.querySelector('.road-race').textContent,
      when: card.querySelector('.road-when').textContent,
      bands: bands.map(b => ({
        name: b.textContent.trim(),
        width: parseFloat(b.style.width),
        now: b.classList.contains('is-now'),
        done: b.classList.contains('is-done')
      })),
      marker: parseFloat((card.querySelector('.road-now') || {}).style?.left || 'NaN'),
      figures: figures,
      phaseLine: (card.querySelector('.road-phase') || {}).textContent,
      note: (card.querySelector('.road-note') || {}).textContent
    };
  });

  if (road.error) { errors.push(road.error); }
  else {
    line('it is the first thing on the tab', road.isFirst);
    line('countdown', road.count + ' ' + road.unit);
    line('the race', road.race + ' — ' + road.when);
    line('phases', road.bands.map(b => b.name + ' ' + Math.round(b.width) + '%').join(' · '));
    line('the one you are in', road.bands.filter(b => b.now).map(b => b.name).join(', '));
    line('behind you', road.bands.filter(b => b.done).length + ' phase(s) faded');
    line('today falls at', road.marker.toFixed(1) + '% along');
    line('sessions', road.figures.done + ' of ' + road.figures.sessions
      + ', ' + road.figures.behind + ' never recorded');

    if (!road.isFirst) errors.push('the road is not the first thing on Progress');
    if (!/weeks to go/.test(road.unit)) errors.push('a race months away is not counted in weeks');
    if (!road.race || /^\s*$/.test(road.race)) errors.push('the race has no name');
    if (!road.when) errors.push('the race has no date');

    if (road.bands.length < 4) errors.push('the phases were not read out of the plan');
    if (road.bands.filter(b => b.now).length !== 1) errors.push('exactly one phase should be the current one');
    if (!road.bands.filter(b => b.done).length) errors.push('the phases already behind are not shown as behind');
    const widths = road.bands.reduce((n, b) => n + b.width, 0);
    if (Math.abs(widths - 100) > 2) errors.push('the phase widths do not add up to the whole road: ' + widths);
    // The bands are in plan order, so the current one cannot precede a faded one.
    const lastDone = road.bands.map(b => b.done).lastIndexOf(true);
    const nowAt = road.bands.findIndex(b => b.now);
    if (nowAt < lastDone) errors.push('the phases are out of order');

    if (!(road.marker > 0 && road.marker < 100)) errors.push('the marker is not somewhere along the road');
    if (!road.figures.done) errors.push('nothing counted as done on a fixture with 114 logged sessions');
    if (!/Build/.test(road.phaseLine || '')) errors.push('it does not say which phase you are in');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('TODAY IS NEITHER DUE NOR BEHIND');

  const boundary = await page.evaluate(() => {
    const today = AmsSync.todayKey();
    const figures = AmsUi.__roadFigures();
    const plan = AmsSync.visiblePlan().filter(w => w.discipline.id !== 'rest');
    const mapping = AmsSync.getState().mapping;

    const todays = plan.filter(w => w.dayKey === today);
    const dueBefore = plan.filter(w => w.dayKey < today)
      .reduce((n, w) => n + (AmsPlan.plannedDurationSeconds(w, mapping) || 0), 0);
    const dueIncludingToday = dueBefore + todays
      .reduce((n, w) => n + (AmsPlan.plannedDurationSeconds(w, mapping) || 0), 0);

    return {
      todaysSessions: todays.length,
      due: figures.plannedSoFar,
      dueBefore: dueBefore,
      dueIncludingToday: dueIncludingToday,
      behind: figures.behind,
      unrecordedBefore: plan.filter(w => w.dayKey < today && !AmsSync.isRecorded(w)).length
    };
  });

  line('sessions dated today', boundary.todaysSessions);
  line('hours counted as due', Math.round(boundary.due / 60) + 'm');
  line('hours due before today', Math.round(boundary.dueBefore / 60) + 'm');
  line('behind vs unrecorded before today', boundary.behind + ' vs ' + boundary.unrecordedBefore);

  if (boundary.todaysSessions === 0) {
    errors.push('the fixture has nothing dated today, so this proves nothing');
  }
  if (boundary.due !== boundary.dueBefore) {
    errors.push("today's sessions are being counted as already due");
  }
  if (boundary.behind !== boundary.unrecordedBefore) {
    errors.push('the "behind" count does not match what is actually unrecorded before today');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('THE COUNTDOWN CHANGES UNIT AS IT COMES CLOSER');

  const clocks = await page.evaluate(() => {
    const at = (days) => AmsUi.__countdown({ daysToGo: days, weeksToGo: Math.ceil(days / 7),
                                             race: { isRace: true } });
    return [0, 1, 5, 21, 22, 60, 336].map(d => ({ days: d, said: at(d) }));
  });
  clocks.forEach(c => line(c.days + ' days out', c.said.number + ' ' + c.said.unit));

  const said = (d) => clocks.find(c => c.days === d).said;
  if (said(0).number !== 'Today') errors.push('race day does not say Today');
  if (!/day to go/.test(said(1).unit)) errors.push('one day out is not singular');
  if (!/days to go/.test(said(5).unit)) errors.push('a few days out is not counted in days');
  if (!/weeks/.test(said(60).unit)) errors.push('two months out is not counted in weeks');
  if (said(21).unit === said(22).unit) errors.push('the unit never changes, so it is not adapting at all');

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('A PLAN THAT HAS NOT STARTED, AND ONE WITH NO PHASES');

  /*
   * A build that starts next Monday. This used to load season.xlsx, which
   * starts on *this* week's Monday — so the step only tested what it claimed
   * to on a Monday, and on the other six days it failed for the right reason:
   * the plan had sessions behind it and the card was correct to say so.
   */
  await load('season-unstarted.xlsx');
  const dayOne = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 900));
    const card = document.querySelector('#progressBody .road-card');
    return {
      drawn: !!card,
      note: !!(card && card.querySelector('.road-note')),
      banked: card && card.querySelectorAll('.road-figure-n')[1].textContent,
      bands: card ? card.querySelectorAll('.road-band').length : 0
    };
  });
  line('drawn on day one, before anything is logged', dayOne.drawn);
  line('phases still read', dayOne.bands);
  line('banked', dayOne.banked);
  line('and it does not claim you are behind', !dayOne.note);

  if (!dayOne.drawn) errors.push('the road is not drawn before anything has been logged');
  if (!dayOne.bands) errors.push('the phases were not read on the unstarted plan');
  if (dayOne.note) errors.push('it says he is behind on the first day of the plan');
  if (dayOne.banked !== '0m') errors.push('banked reads "' + dayOne.banked + '" rather than 0m');

  await load('plain.xlsx');
  const noPhases = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 900));
    const card = document.querySelector('#progressBody .road-card');
    return {
      drawn: !!card,
      bands: card ? card.querySelectorAll('.road-band').length : 0,
      race: card && card.querySelector('.road-race').textContent,
      figures: card ? card.querySelectorAll('.road-figure').length : 0
    };
  });
  line('a workbook with no phase column', noPhases.drawn ? 'still drawn' : 'MISSING');
  line('bands', noPhases.bands);
  line('and it calls the end', noPhases.race);

  if (!noPhases.drawn) errors.push('a plan without phases gets no road at all');
  if (noPhases.bands) errors.push('bands were drawn for a workbook with no phase column');
  if (noPhases.figures !== 3) errors.push('the figures went missing without phases');
  // No race row in this one, so it must not pretend there is one.
  if (/race/i.test(noPhases.race || '')) {
    errors.push('a plan with no race row was given one: "' + noPhases.race + '"');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
