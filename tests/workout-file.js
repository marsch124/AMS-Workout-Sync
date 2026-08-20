/*
 * A session exported from Garmin Connect, opened directly.
 *
 * This is the route for phones where Shortcuts cannot read workouts at all:
 * export from Garmin Connect, open the file here, and the numbers arrive on
 * the Today screen like any others — still offered, never written.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(34) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  const openWorkoutFile = async (name) => {
    await page.click('.tab[data-tab="settings"]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#workoutFileInput', { state: 'attached' });
    await page.setInputFiles('#workoutFileInput', SP + '/' + name);
    await page.waitForTimeout(900);
  };

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);

  console.log('A TCX EXPORTED FROM GARMIN CONNECT');
  await openWorkoutFile('garmin-run.tcx');
  line('toast:', (await page.textContent('#toast')).trim());
  const read = await page.evaluate(() => AmsSync.getState().inbox.map(e => ({
    sport: e.sport, discipline: e.discipline.label, day: e.dayKey,
    minutes: e.minutes && Math.round(e.minutes * 10) / 10,
    km: e.km && Math.round(e.km * 1000) / 1000,
    avgHr: e.avgHr, maxHr: e.maxHr, calories: e.calories, name: e.name
  })));
  line('what it read:', JSON.stringify(read[0]));
  console.log('   (two laps: 1200 s + 1338 s = 42.3 min, 3900 m + 4220 m = 8.12 km,');
  console.log('    heart rate averaged by time, not an average of averages)');

  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(700);
  const cards = await page.$$eval('.watch-card', ns => ns.map(n => n.innerText.replace(/\n+/g, ' | ')));
  console.log('\nON THE TODAY SCREEN');
  cards.forEach(c => line('', c));

  const matched = await page.$('[data-watch]');
  if (matched) {
    await matched.click();
    await page.waitForTimeout(900);
    const filled = await page.$$eval('#logBody [data-field]', ns => ns.map(n => n.dataset.field + '=' + JSON.stringify(n.value)));
    console.log('\nTHE LOG FORM, FILLED IN');
    filled.forEach(f => line('', f));
    line('still nothing written:', await page.evaluate(async () => (await AmsDb.listQueue()).length === 0));
    while (await page.$('body.detail-open')) { await page.click('.screen.active [data-back]'); await page.waitForTimeout(250); }
  }

  console.log('\nA GPX WITH HEART-RATE POINTS');
  await openWorkoutFile('garmin-ride.gpx');
  const gpx = await page.evaluate(() => {
    const e = AmsSync.getState().inbox.slice(-1)[0];
    return { sport: e.sport, discipline: e.discipline.label, minutes: Math.round(e.minutes * 10) / 10,
             km: Math.round(e.km * 100) / 100, avgHr: e.avgHr, name: e.name };
  });
  line('worked out from the track:', JSON.stringify(gpx));

  console.log('\nA FILE THAT IS NOT EITHER');
  await openWorkoutFile('plain.xlsx');
  line('said:', (await page.textContent('#toast')).trim());
  line('the app is still alive:', await page.evaluate(() => AmsSync.getState().plan.length + ' sessions'));

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
