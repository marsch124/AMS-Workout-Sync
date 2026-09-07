/*
 * "Say it" on the log form — the wiring, not the parsing.
 *
 * The parser has a test of its own that shouts a few hundred phrasings at it
 * without a browser (`tests/voice.js`). What is checked here is everything
 * that only exists once it is attached to a form:
 *
 *   1. it fills fields and **never saves**. That is the whole safety story: a
 *      mishearing has to be visible and one tap from corrected, not written;
 *   2. it says back what it understood, including what it could not place and
 *      what this workbook has no column for;
 *   3. the shared "Avg Pace/Pwr" column. His sheet has one column that means
 *      km/h on a bike, min/km on a run and per-100m in the pool. A speed said
 *      on a bike belongs in it, and refusing that because no column is called
 *      "speed" would be the app being right about its own field names and
 *      wrong about the workbook;
 *   4. the box works with no recogniser present, because on his phone that is
 *      the likely case — the keyboard's own microphone types into it.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(40) + v);

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
  await page.setInputFiles('#localFileInput', SP + '/paced.xlsx');
  await page.waitForTimeout(2600);
  await page.evaluate(async () => {
    await AmsDb.clearQueue();
    await AmsDb.set('log.showAllFields', true);
    await AmsSync.overlayQueue();
  });

  const openLog = async (sport) => page.evaluate(async (want) => {
    const workout = AmsSync.getState().plan.find(w => w.discipline.id === want);
    if (!workout) return false;
    document.querySelector('.tab[data-tab="plan"]').click();
    await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key);
    if (!card) return false;
    card.click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('openLogButton').click();
    await new Promise(r => setTimeout(r, 700));
    return true;
  }, sport);

  const say = async (text) => page.evaluate(async (phrase) => {
    document.getElementById('sayInput').value = phrase;
    document.getElementById('sayFill').click();
    await new Promise(r => setTimeout(r, 350));
    const read = (id) => (document.getElementById(id) || {}).value;
    return {
      heard: document.getElementById('sayHeard').textContent,
      paceLabel: (document.querySelector('label[for="log-avgPace"]') || {}).textContent,
      values: {
        actualDuration: read('log-actualDuration'), actualDistance: read('log-actualDistance'),
        avgHr: read('log-avgHr'), avgPace: read('log-avgPace'), rpe: read('log-rpe')
      },
      queued: (await AmsDb.listQueue()).length
    };
  }, text);

  // ---------------------------------------------------------------- 1
  console.log('ONE SENTENCE, FOUR FIELDS, NOTHING SAVED');

  if (!await openLog('run')) errors.push('could not open a run to log');
  const run = await say('8.2 km, 45 minutes, 5:30 per km, 138 bpm, felt like a 7');
  line('read in', JSON.stringify(run.values));
  line('it said', run.heard);
  line('entries queued', run.queued);

  if (run.values.actualDistance !== '8.2') errors.push('distance did not arrive');
  if (run.values.actualDuration !== '45') errors.push('duration did not arrive');
  if (run.values.avgHr !== '138') errors.push('heart rate did not arrive');
  if (run.values.avgPace !== '5:30') errors.push('pace did not arrive');
  if (run.values.rpe !== '7') errors.push('effort did not arrive');
  if (run.queued !== 0) errors.push('SAYING IT SAVED SOMETHING — it must only fill the form');
  if (!/Read in/.test(run.heard)) errors.push('it did not say what it understood');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('THE ONE COLUMN THAT MEANS THREE THINGS');

  if (!await openLog('bike')) errors.push('could not open a bike to log');
  const bike = await say('42 km, 80 minutes, 32 km/h, 132 bpm');
  line('the column asks for', (bike.paceLabel || '').trim());
  line('a spoken km/h lands as', bike.values.avgPace);
  line('it said', bike.heard);

  if (bike.values.avgPace !== '32') {
    errors.push('a speed said on a bike did not reach the shared pace column');
  }
  if (/no column for/.test(bike.heard)) {
    errors.push('it claimed there was nowhere to put a speed, on a sheet that has the column');
  }
  if (!/speed/i.test(bike.heard)) errors.push('the read-back does not call the column what the form calls it');

  if (!await openLog('swim')) errors.push('could not open a swim to log');
  const swim = await say('2400 metres, 45 minutes, 1:52 per hundred, 138 bpm');
  line('in the pool, the column asks for', (swim.paceLabel || '').trim());
  line('and a per-100 lands as', swim.values.avgPace);
  if (swim.values.avgPace !== '1:52') errors.push('a swim pace did not reach the shared column');
  if (swim.values.actualDistance !== '2400') errors.push('metres did not stay metres on a swim');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHAT IT CANNOT DO, IT SAYS');

  const odd = await say('620 calories and 47 bananas');
  line('a sheet with no calories column', odd.heard);
  if (!/no column for calories/i.test(odd.heard)) {
    errors.push('a value with nowhere to go was not reported');
  }

  const nothing = await say('it was windy and I felt terrible');
  line('words with no numbers', nothing.heard);
  if (!/could be read as a number/i.test(nothing.heard)) {
    errors.push('a sentence with no numbers in it did not say so');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('WITHOUT A RECOGNISER, WHICH IS THE LIKELY CASE');

  const withoutMic = await page.evaluate(async () => {
    const real = AmsVoice.supported;
    AmsVoice.supported = () => false;
    document.querySelector('#logScreen [data-back]').click();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('openLogButton').click();
    await new Promise(r => setTimeout(r, 600));
    const out = {
      box: !!document.getElementById('sayInput'),
      mic: !!document.getElementById('sayMic'),
      button: !!document.getElementById('sayFill'),
      hint: document.getElementById('sayHeard').textContent
    };
    document.getElementById('sayInput').value = '45 minutes, 138 bpm';
    document.getElementById('sayFill').click();
    await new Promise(r => setTimeout(r, 300));
    out.duration = document.getElementById('log-actualDuration').value;
    AmsVoice.supported = real;
    return out;
  });

  line('the box is still there', withoutMic.box);
  line('the microphone button is not drawn', !withoutMic.mic);
  line('and typing into it still works', withoutMic.duration);
  line('the hint points at the keyboard', /keyboard/i.test(withoutMic.hint));

  if (!withoutMic.box || !withoutMic.button) errors.push('the box disappears without a recogniser');
  if (withoutMic.mic) errors.push('a microphone button is offered that cannot work');
  if (withoutMic.duration !== '45') errors.push('the box does not work without a recogniser');
  if (!/keyboard/i.test(withoutMic.hint)) {
    errors.push('nothing tells him to use the keyboard microphone, which is the reliable route');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
