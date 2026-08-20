/*
 * One session, sent on its own — as a message and as a calendar event.
 *
 * Two ways in: the share button on the session itself, and the picker in the
 * week sheet, which offers everything in this week and next.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(32) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__shared = [];
    navigator.share = async (data) => {
      const file = data.files && data.files[0];
      window.__shared.push({ name: file && file.name, text: file ? await file.text() : data.text });
    };
    navigator.canShare = (data) => !!(data && data.files);
  });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);

  // ---------------------------------------------------------------- 1
  console.log('FROM THE SESSION ITSELF');
  await page.click('.tab[data-tab="plan"]');
  await page.waitForTimeout(600);
  const cards = await page.$$('#planBody .workout-card');
  await cards[0].click();
  await page.waitForTimeout(700);
  line('share button on the screen:', !!(await page.$('#shareWorkoutButton')));
  await page.click('#shareWorkoutButton');
  await page.waitForTimeout(500);
  line('asks:', (await page.textContent('#actionSheetTitle')).trim());
  const options = await page.$$eval('#actionSheetActions button', ns => ns.map(n => n.innerText.replace(/\n/g, ' | ')));
  options.forEach(o => line('option:', o));

  await page.click('#actionSheetActions button:nth-child(1)');
  await page.waitForTimeout(500);
  const asMessage = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  console.log('\nAS A MESSAGE\n' + asMessage.text.split('\n').map(l => '   ' + l).join('\n'));

  await page.click('#shareWorkoutButton');
  await page.waitForTimeout(400);
  await page.click('#actionSheetActions button:nth-child(2)');
  await page.waitForTimeout(500);
  const asEvent = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  console.log('\nAS A CALENDAR EVENT');
  line('file:', asEvent.name);
  line('events in it:', (asEvent.text.match(/BEGIN:VEVENT/g) || []).length);
  asEvent.text.split('\r\n')
    .filter(l => /^(DTSTART|DTEND|SUMMARY|TRANSP)/.test(l))
    .forEach(l => line('', l));
  line('no reminder:', asEvent.text.indexOf('VALARM') === -1);

  // ---------------------------------------------------------------- 2
  console.log('\nFROM THE WEEK SHEET');
  // the tab bar is hidden while a session is open, so come back out first
  while (await page.$('body.detail-open')) {
    await page.click('.screen.active [data-back]');
    await page.waitForTimeout(300);
  }
  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(700);
  await page.click('[data-share-week]');
  await page.waitForTimeout(450);
  const weekOptions = await page.$$eval('#actionSheetActions button', ns => ns.map(n => n.innerText.split('\n')[0]));
  line('the week sheet offers:', weekOptions.join(' / '));

  await page.click('#actionSheetActions button:nth-child(5)');   // one session on its own
  await page.waitForTimeout(500);
  line('picker title:', (await page.textContent('#actionSheetTitle')).trim());
  const sessions = await page.$$eval('#actionSheetActions button', ns => ns.map(n => n.innerText.replace(/\n/g, ' — ')));
  console.log('   sessions offered (' + sessions.length + '):');
  sessions.forEach(s => console.log('      ' + s));
  line('scrolls rather than overflows:',
    await page.$eval('#actionSheetActions', n => n.scrollHeight > n.clientHeight ? 'yes, it scrolls' : 'fits as it is'));

  // pick one from next week and send it
  const nextWeekIndex = sessions.findIndex((s, i) => i > 0 && s !== sessions[0]);
  await page.click('#actionSheetActions button:nth-child(' + (sessions.length) + ')');
  await page.waitForTimeout(450);
  line('then asks:', (await page.textContent('#actionSheetTitle')).trim());
  await page.click('#actionSheetActions button:nth-child(1)');
  await page.waitForTimeout(500);
  const picked = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  console.log('\nTHE LAST SESSION OF NEXT WEEK, AS A MESSAGE');
  console.log(picked.text.split('\n').map(l => '   ' + l).join('\n'));
  void nextWeekIndex;

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
