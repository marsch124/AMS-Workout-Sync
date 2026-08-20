/*
 * The Apple Health bridge: a file left beside the workbook by a Shortcut.
 *
 * The app must read it, match what it can to planned sessions, offer the rest
 * as unplanned — and write nothing at all until somebody saves a form.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(36) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);

  // Stand in for Dropbox holding the file a Shortcut wrote.
  const setInbox = (json) => page.evaluate(async (json) => {
    const bytes = new TextEncoder().encode(json);
    AmsDropbox.isConnected = async () => true;
    AmsDropbox.download = async (path) => {
      if (/ams-health-inbox\.json$/.test(path)) {
        return { bytes: bytes, rev: 'r1', name: 'ams-health-inbox.json', path: path };
      }
      throw new Error('That file is no longer in Dropbox at the saved path.');
    };
    await AmsDb.set('workbook.path', '/Training/plan.xlsx');
    await AmsSync.readInbox();
    return AmsSync.getState().inbox;
  }, json);

  const today = await page.evaluate(() => AmsSync.todayKey());
  const plannedRun = await page.evaluate(() =>
    (AmsSync.getState().plan.find(w => w.discipline.id === 'run' && w.dayKey === AmsSync.todayKey()) || {}).title || null);

  console.log('THE FILE A SHORTCUT WOULD WRITE');
  const file = JSON.stringify([
    { date: today, sport: 'Running', minutes: 32.4, km: 6.15, avgHr: 141, calories: 402, name: 'Morning Run' },
    { date: today, sport: 'Walking', minutes: 55, km: 4.2, avgHr: 96, name: 'Evening walk with Anna' }
  ]);
  console.log('   ' + file);

  const parsed = await setInbox(file);
  line('entries read:', parsed.length);
  parsed.forEach(e => line('', e.discipline.label + '  ' + e.minutes + ' min, ' + e.km + ' km, ' + e.avgHr + ' bpm'));
  line("today's planned run:", plannedRun || '(none today)');

  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(800);
  const cards = await page.$$eval('.watch-card', ns => ns.map(n => n.innerText.replace(/\n+/g, ' | ')));
  console.log('\nON THE TODAY SCREEN');
  cards.forEach(c => line('', c));
  await page.screenshot({ path: SP + '/watch-today.png', fullPage: true }).catch(() => {});

  // the matched one fills the log form
  const matched = await page.$('[data-watch]');
  console.log('\nTAPPING "LOG THIS SESSION WITH THESE"');
  if (matched) {
    await matched.click();
    await page.waitForTimeout(900);
    const filled = await page.$$eval('#logBody [data-field]', ns => ns.map(n => n.dataset.field + '=' + JSON.stringify(n.value)));
    filled.forEach(f => line('', f));
    line('nothing written yet:', await page.evaluate(async () => (await AmsDb.listQueue()).length === 0));
  } else {
    line('', 'no matched entry (is there a run planned today?)');
  }

  // and the unmatched one goes to the extras form
  while (await page.$('body.detail-open')) { await page.click('.screen.active [data-back]'); await page.waitForTimeout(250); }
  const unmatched = await page.$('[data-watch-extra]');
  console.log('\nTAPPING "RECORD IT AS SOMETHING ELSE"');
  if (unmatched) {
    await unmatched.click();
    await page.waitForTimeout(900);
    const extra = await page.evaluate(() => ({
      activity: document.getElementById('extraActivity') && document.getElementById('extraActivity').value,
      what: document.getElementById('extraWhat') && document.getElementById('extraWhat').value,
      duration: document.getElementById('extraDuration') && document.getElementById('extraDuration').value,
      distance: document.getElementById('extraDistance') && document.getElementById('extraDistance').value,
      avgHr: document.getElementById('extraAvgHr') && document.getElementById('extraAvgHr').value
    }));
    line('', JSON.stringify(extra));
  } else {
    line('', 'no unmatched entry');
  }

  // a broken file must not take anything down
  while (await page.$('body.detail-open')) { await page.click('.screen.active [data-back]'); await page.waitForTimeout(250); }
  console.log('\nA FILE THAT IS NOT JSON');
  await setInbox('{ this is not json at all');
  const state = await page.evaluate(() => ({
    error: AmsSync.getState().inboxError,
    entries: AmsSync.getState().inbox.length,
    planStillThere: AmsSync.getState().plan.length
  }));
  line('said:', state.error);
  line('entries:', state.entries);
  line('the plan is untouched:', state.planStillThere + ' sessions');

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
