/*
 * "This is still only on your phone."
 *
 * Everything logged is written to the phone first and sent afterwards, which is what makes
 * it work in a pool car park with no signal. The cost is that until it is sent it exists in
 * one place only, and iOS is allowed to clear that storage to reclaim space without asking.
 *
 * So the app now says so — but the hard part is saying nothing the rest of the time. A sync
 * runs by itself the moment anything is logged, so on an ordinary day the queue is empty
 * seconds later, and a warning that appears then would be noise he learns to ignore. It
 * waits a full day before speaking.
 *
 * What is tested is mostly the silence.
 *
 *     node tests/waiting.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && fs.existsSync(CHROME) ? { executablePath: CHROME } : {};
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

  await page.evaluate(() => AmsDb.remove('mapping'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { await AmsDb.clearQueue(); await AmsSync.overlayQueue(); });

  const showWarning = async () => {
    await page.click('.tab[data-tab="today"]');
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const el = document.querySelector('.waiting-warn');
      if (!el) return null;
      return { title: el.querySelector('.waiting-warn-title').textContent.trim(),
               body: el.querySelector('.waiting-warn-body').textContent.trim(),
               button: (el.querySelector('button') || {}).textContent };
    });
  };

  /* ---- nothing waiting ---- */
  console.log('WHEN THERE IS NOTHING WAITING, IT SAYS NOTHING');
  let warning = await showWarning();
  line('warning on screen', warning ? 'SHOWN' : 'none');
  if (warning) errors.push('the warning appeared with an empty queue');

  /* ---- just logged ---- */
  console.log('');
  console.log('AND WHEN SOMETHING WAS JUST LOGGED, STILL NOTHING');
  await page.evaluate(async () => {
    const today = AmsSync.todayKey();
    const w = AmsSync.getState().plan.find(x => x.dayKey === today && x.discipline.id !== 'rest');
    await AmsSync.logWorkout(w, { actualDuration: '40' });
    await AmsSync.logExtra({ date: today, activity: 'walk', label: 'Walk', minutes: 30 });
  });
  warning = await showWarning();
  const queued = await page.evaluate(() => AmsDb.queueCount());
  line('entries waiting', queued);
  line('warning on screen', warning ? 'SHOWN' : 'none');
  if (warning) {
    errors.push('the warning appeared for logging that is seconds old — it would be there every day');
  }

  /* ---- waiting since yesterday ---- */
  console.log('');
  console.log('BUT AFTER A DAY, IT SPEAKS UP');
  await page.evaluate(async () => {
    // Age the queue rather than wait a day.
    const queued = await AmsDb.listQueue();
    for (const entry of queued) {
      entry.createdAt = Date.now() - 30 * 60 * 60 * 1000;   // thirty hours
      await AmsDb.updateQueued(entry);
    }
  });
  warning = await showWarning();
  line('warning on screen', warning ? 'SHOWN' : 'NONE');
  if (warning) {
    line('it says', warning.title);
    line('and explains', warning.body);
    line('and offers', JSON.stringify(warning.button));
  }

  if (!warning) {
    errors.push('logging thirty hours old produced no warning at all');
  } else {
    if (!/2 things/.test(warning.title)) {
      errors.push('the warning does not say how much is waiting: ' + warning.title);
    }
    if (!/yesterday|day/.test(warning.body)) {
      errors.push('the warning does not say how long it has been waiting');
    }
    if (!/phone|nowhere else/i.test(warning.body)) {
      errors.push('the warning does not say why it matters');
    }
    if (!warning.button || !/send/i.test(warning.button)) {
      errors.push('the warning offers no way to act on it');
    }
  }

  /* ---- and it goes once the queue clears ---- */
  console.log('');
  console.log('AND IT GOES AWAY WHEN THE QUEUE DOES');
  await page.evaluate(() => AmsDb.clearQueue());
  warning = await showWarning();
  line('warning on screen', warning ? 'STILL SHOWN' : 'none');
  if (warning) errors.push('the warning stayed after the queue was emptied');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
