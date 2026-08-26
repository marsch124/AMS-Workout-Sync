/*
 * Leaving a form with something typed in it.
 *
 * Back is the only way out of these two screens — the tab bar is hidden while
 * one is open — and it discards, which is right: nothing has been written yet.
 * What was wrong was that it discarded in silence. Four fields filled in, a
 * thumb near the arrow, and it was all gone with nothing said.
 *
 * A confirm is only worth having if it stays quiet the rest of the time, so
 * most of what is checked here is when it must *not* appear: on a form nobody
 * touched, and on the way out after a save. The awkward case is a form that
 * rebuilds itself — the extras form does, whenever the activity changes — and
 * must not forget it had been typed into while doing so.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(44) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage();
  const errors = [];
  let asked = null;
  let answer = 'dismiss';

  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async d => {
    asked = d.message();
    if (answer === 'accept') await d.accept(); else await d.dismiss();
  });

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/paced.xlsx');
  await page.waitForTimeout(2600);

  const openLog = async () => {
    await page.evaluate(() => {
      const t = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
      const btn = document.createElement('button');
      btn.setAttribute('data-log', t.key);
      document.body.appendChild(btn); btn.click(); btn.remove();
    });
    await page.waitForSelector('#log-actualDuration');
    await page.waitForTimeout(300);
  };
  const back = async (screen) => {
    asked = null;
    await page.click('#' + screen + ' [data-back]');
    await page.waitForTimeout(500);
  };
  const where = () => page.evaluate(() => (document.querySelector('.screen.active') || {}).id);

  // ---------------------------------------------------------------- 1
  console.log('A FORM NOBODY TOUCHED');
  await openLog();
  await back('logScreen');
  line('asked anything', asked ? '"' + asked + '"' : 'no');
  line('left the form', (await where()) !== 'logScreen' ? 'yes' : 'NO');
  if (asked) errors.push('it asked about a form nothing was typed into');
  if (await where() === 'logScreen') errors.push('an untouched form would not close');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('SOMETHING TYPED, AND THE ANSWER IS NO');
  await openLog();
  await page.fill('#log-actualDuration', '52');
  await back('logScreen');
  line('asked', asked ? '"' + asked + '"' : 'NOTHING');
  line('still on the form', (await where()) === 'logScreen' ? 'yes' : 'NO');
  line('what was typed is still there',
    await page.evaluate(() => (document.getElementById('log-actualDuration') || {}).value));
  if (!asked) errors.push('typed values were discarded without asking');
  if (await where() !== 'logScreen') errors.push('answering no still left the form');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('SOMETHING TYPED, AND THE ANSWER IS YES');
  answer = 'accept';
  await back('logScreen');
  line('left the form', (await where()) !== 'logScreen' ? 'yes' : 'NO');
  line('written or queued', await page.evaluate(() => AmsDb.queueCount()));
  if (await where() === 'logScreen') errors.push('answering yes did not leave');
  if (await page.evaluate(() => AmsDb.queueCount())) errors.push('leaving a form wrote something');
  answer = 'dismiss';

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('AFTER A SAVE THERE IS NOTHING TO WARN ABOUT');
  await openLog();
  await page.fill('#log-actualDuration', '61');
  asked = null;
  await page.click('#saveLogButton');
  await page.waitForTimeout(1600);
  line('asked on the way out', asked ? '"' + asked + '"' : 'no');
  line('queued', await page.evaluate(() => AmsDb.queueCount()));
  if (asked) errors.push('it asked after a successful save');

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('THE SAME, ON "LOG SOMETHING ELSE"');
  const openExtra = async () => {
    await page.click('.tab[data-tab="today"]');
    await page.waitForTimeout(600);
    await page.click('[data-extra]');
    await page.waitForSelector('#extraDistance');
    await page.waitForTimeout(400);
  };
  await openExtra();
  await back('extraScreen');
  line('untouched — asked', asked ? 'YES' : 'no');
  if (asked) errors.push('extras asked about an untouched form');

  await openExtra();
  await page.fill('#extraDistance', '7,5');
  await back('extraScreen');
  line('typed — asked', asked ? '"' + asked + '"' : 'NOTHING');
  line('still on the form', (await where()) === 'extraScreen' ? 'yes' : 'NO');
  if (!asked) errors.push('extras discarded typing without asking');

  // ---------------------------------------------------------------- 6
  console.log('');
  console.log('A FORM THAT REBUILDS ITSELF MUST REMEMBER IT WAS TOUCHED');
  const changed = await page.evaluate(() => {
    const sel = document.getElementById('extraActivity');
    if (!sel || sel.options.length < 2) return false;
    sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(500);
  if (!changed) {
    line('no activity picker to change', 'skipped');
  } else {
    await back('extraScreen');
    line('asked after the rebuild', asked ? 'yes' : 'NO');
    if (!asked) errors.push('a rebuilt extras form forgot it had been touched');
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
