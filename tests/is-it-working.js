/*
 * The three drawings at the top of Progress, once they are on a screen:
 * "Is it working?", the twelve-week chart, and where the hours went.
 *
 * The arithmetic has a test of its own that needs no browser
 * (`tests/trends.js`). What is checked here is the part that only exists once
 * it is drawn — and for this block that is mostly the *wording*, because it is
 * the one screen in the app that makes a claim about the person rather than
 * about the plan.
 *
 * So: the numbers are shown in the units each sport is spoken in, never as the
 * ratio underneath; the caveats are present and not hidden behind anything;
 * and when there is not enough to say, it says how much more is needed rather
 * than going quiet or, worse, guessing.
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
  console.log('THEN AGAINST NOW, IN THE UNITS EACH SPORT IS SPOKEN IN');

  const shown = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 1200));

    const card = [...document.querySelectorAll('#progressBody .stat-card')]
      .find(c => /is it working/i.test(c.textContent));
    if (!card) return { error: 'no "Is it working?" block on Progress' };

    return {
      afterTheRoad: !!(document.querySelector('.road-card')
        && document.querySelector('.road-card').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
      sports: [...card.querySelectorAll('.trend')].map(t => ({
        name: t.querySelector('.trend-sport').textContent,
        then: t.querySelectorAll('.trend-pace')[0].textContent,
        thenHr: t.querySelectorAll('.trend-hr')[0].textContent,
        now: t.querySelectorAll('.trend-pace')[1].textContent,
        nowHr: t.querySelectorAll('.trend-hr')[1].textContent,
        verdict: t.querySelector('.trend-verdict').textContent,
        basis: t.querySelector('.trend-basis').textContent
      })),
      text: card.innerText
    };
  });

  if (shown.error) { errors.push(shown.error); }
  else {
    shown.sports.forEach(s => line(s.name, s.then + ' ' + s.thenHr + '  →  ' + s.now + ' ' + s.nowHr));
    line('it sits after the road', shown.afterTheRoad);

    if (shown.sports.length < 2) errors.push('fewer sports answered than the fixture supports');
    if (!shown.afterTheRoad) errors.push('it is not below the road card');

    const bySport = {};
    shown.sports.forEach(s => { bySport[s.name] = s; });

    // Each sport in the unit it is actually talked about in — the ratio the
    // arithmetic runs on must never be what is put on the screen.
    if (bySport.RUNS && !/\/km$/.test(bySport.RUNS.now)) errors.push('a run is not shown in min/km');
    if (bySport.RIDES && !/km\/h$/.test(bySport.RIDES.now)) errors.push('a ride is not shown in km/h');
    if (bySport.SWIMS && !/\/100m$/.test(bySport.SWIMS.now)) errors.push('a swim is not shown per 100m');
    if (/per beat|perBeat|ratio/i.test(shown.text)) {
      errors.push('the ratio itself is being shown, which nobody thinks in');
    }

    shown.sports.forEach((s) => {
      if (!/\d+ bpm/.test(s.thenHr) || !/\d+ bpm/.test(s.nowHr)) {
        errors.push(s.name + ': a pace is shown without the heart rate that produced it');
      }
      if (!/%/.test(s.verdict)) errors.push(s.name + ': no size given for the change');
      if (!/against the last/.test(s.basis)) errors.push(s.name + ': it does not say what was compared');
    });
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('THE CAVEATS ARE ON THE SCREEN, NOT IN THE CODE');

  const caveats = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#progressBody .stat-card')]
      .find(c => /is it working/i.test(c.textContent));
    const text = card ? card.innerText : '';
    return {
      saysWhatItMeasures: /per heartbeat/i.test(text),
      saysHrIsFickle: /heat|sleep|coffee|stress/i.test(text),
      saysMonthsNotWeeks: /months rather than weeks|over months/i.test(text),
      saysWhatCounts: /distance, a time and an average heart rate/i.test(text),
      saysEasyPreferred: /easy/i.test(text)
    };
  });

  Object.keys(caveats).forEach(k => line(k, caveats[k]));
  if (!caveats.saysWhatItMeasures) errors.push('it does not say what it is measuring');
  if (!caveats.saysHrIsFickle) {
    errors.push('nothing warns that heart rate answers to more than fitness');
  }
  if (!caveats.saysMonthsNotWeeks) errors.push('it does not say to read this over months');
  if (!caveats.saysWhatCounts) errors.push('it does not say which sessions can be counted');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WITH TOO LITTLE LOGGED, IT SAYS SO');

  await load('season.xlsx');       // the same plan, nothing logged at all
  const nothing = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 1100));
    const card = [...document.querySelectorAll('#progressBody .stat-card')]
      .find(c => /is it working/i.test(c.textContent));
    return { drawn: !!card, text: card ? card.innerText.replace(/\n/g, ' ') : null,
             trends: document.querySelectorAll('.trend').length };
  });

  line('with nothing logged', nothing.drawn ? 'still says something' : 'silent');
  if (nothing.text) line('and it says', nothing.text.slice(0, 120));
  if (nothing.trends) errors.push('a verdict was drawn on a plan with nothing logged');

  /*
   * The case that matters most for a person just starting: sessions logged,
   * but with only a duration in them. Silence there would hide the one thing
   * he needs to be told, which is that the heart rate is what is missing.
   */
  const durationsOnly = await page.evaluate(() => {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      rows.push({ sport: 'run', dayKey: '2026-01-' + String(i + 1).padStart(2, '0'),
                  minutes: 50, km: 0, hr: 0, rpe: 0 });
    }
    const t = AmsStats.trends({ rows: rows });
    return { sports: t.sports.length, entry: t.sports[0], any: t.any };
  });
  line('twelve sessions with only a duration',
    durationsOnly.sports + ' entr(y/ies), enough: ' + (durationsOnly.entry || {}).enough);
  if (!durationsOnly.sports) {
    errors.push('a sport logged without heart rates vanishes instead of saying what is missing');
  }
  if (durationsOnly.any) errors.push('it claimed an answer from sessions with no numbers in them');
  if (durationsOnly.entry && durationsOnly.entry.have !== 0) {
    errors.push('it counted unusable sessions as usable');
  }

  await page.evaluate(() => {
    // A handful of complete sessions, still short of what it needs.
    const rows = AmsStats.trends({ rows: [] });
    return rows;
  });

  const few = await page.evaluate(() => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      rows.push({ sport: 'run', dayKey: '2026-0' + (i + 1) + '-01',
                  minutes: 50, km: 9, hr: 140, rpe: 4 });
    }
    const t = AmsStats.trends({ rows: rows });
    return t.sports[0];
  });
  line('five complete sessions', 'enough: ' + few.enough + ', needs ' + few.need);
  if (few.enough) errors.push('five sessions were treated as enough to judge fitness on');
  if (few.need !== 8) errors.push('the threshold moved without the test being told');

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('TWELVE WEEKS, AND WHERE THE HOURS WENT');

  await load('season-underway.xlsx');
  const charts = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="progress"]').click();
    await new Promise(r => setTimeout(r, 1300));

    const cardFor = (re) => [...document.querySelectorAll('#progressBody .stat-card')]
      .find(c => re.test(c.textContent));
    const weeksCard = cardFor(/twelve weeks/i);
    const mixCard = cardFor(/where the hours went/i);
    if (!weeksCard || !mixCard) return { error: 'one of the two charts is missing' };

    const columns = [...weeksCard.querySelectorAll('.wk')];
    const heightOf = (node) => node ? parseFloat(node.style.height) : null;
    const targetOf = (node) => node ? parseFloat(node.style.bottom) : null;

    const rows = [...mixCard.querySelectorAll('.mix-row')].map(r => ({
      text: r.innerText.replace(/\s+/g, ' ').trim(),
      drift: r.querySelector('.mix-drift') ? r.querySelector('.mix-drift').textContent : null
    }));

    return {
      columns: columns.length,
      labelled: columns.filter(c => c.querySelector('.wk-label').textContent.trim()).length,
      nowMarked: weeksCard.querySelectorAll('.wk.is-now').length,
      // A week done short of its target must draw the line above the fill,
      // and a week done past it must draw the line inside — that relation is
      // the whole chart.
      pairs: columns.map(c => ({
        fill: heightOf(c.querySelector('.wk-fill')),
        target: targetOf(c.querySelector('.wk-target'))
      })).filter(p => p.target !== null),
      lede: weeksCard.querySelector('.stat-lede').textContent,
      segments: mixCard.querySelectorAll('.mix-part').length,
      rows: rows,
      mixNote: [...mixCard.querySelectorAll('.stat-note')].map(n => n.textContent).join(' ')
    };
  });

  if (charts.error) { errors.push(charts.error); }
  else {
    line('columns, of which labelled', charts.columns + ' / ' + charts.labelled);
    line('this week marked', charts.nowMarked);
    line('the lede', charts.lede);
    line('mix rows', charts.rows.length + ', bar in ' + charts.segments + ' parts');

    if (charts.columns !== 12) errors.push('the week chart is not twelve weeks wide');
    if (!charts.labelled || charts.labelled > 6) {
      errors.push('the dates under the columns are missing or crowded: ' + charts.labelled);
    }
    if (charts.nowMarked !== 1) errors.push('this week is not picked out exactly once');
    if (!/of .* asked for/.test(charts.lede)) errors.push('the chart does not say done against asked for');

    const short = charts.pairs.filter(p => (p.fill || 0) < p.target - 1);
    const over = charts.pairs.filter(p => (p.fill || 0) > p.target + 1);
    line('weeks under their line / over it', short.length + ' / ' + over.length);
    if (!short.length) {
      errors.push('no week is drawn short of its target on a fixture that is 76% complete');
    }
    if (charts.pairs.some(p => p.target > 100.5 || p.target < 0)) {
      errors.push('a target line is drawn outside the column');
    }

    if (charts.rows.length < 3) errors.push('the sport mix has too few rows to be a mix');
    if (charts.segments < 3) errors.push('the stacked bar has fewer parts than there are sports');
    if (!charts.rows.every(r => /\d+%/.test(r.text) && /plan \d+%/.test(r.text))) {
      errors.push('a sport row is missing either its share or the share the plan asked for');
    }

    /*
     * The badge on a row and the sentence underneath must agree. They are two
     * readings of the same difference, and they disagreed the first time —
     * one rounding the percentages and the other testing the raw ratio.
     */
    const badged = charts.rows.filter(r => r.drift)
      .map(r => r.text.split(' ')[0]);
    const named = badged.filter(name => new RegExp(name, 'i').test(charts.mixNote));
    line('rows badged as drifting', badged.join(', ') || 'none');
    line('and named in the sentence below', named.join(', ') || 'none');
    if (badged.length !== named.length) {
      errors.push('a sport is badged as drifting but not named underneath, or the other way about');
    }
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
