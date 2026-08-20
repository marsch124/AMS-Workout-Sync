const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};
const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(34) + v);
(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/foreign-extras.xlsx');
  await page.waitForTimeout(2600);

  console.log('A WORKBOOK THAT ALREADY HAS AN "EXTRAS" SHEET');
  line('read as our extras:', JSON.stringify(await page.evaluate(() => AmsSync.getState().extras)));
  line('name the app will use:', await page.evaluate(async () =>
    AmsExtras.sheetNameFor(AmsSync.getState().workbook)));

  // log an unplanned session and write it into the file
  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(600);
  await page.click('[data-extra]');
  await page.waitForTimeout(800);
  await page.selectOption('#extraActivity', { label: 'Walk' });
  await page.fill('#extraWhat', 'Evening walk');
  await page.fill('#extraDuration', '40');
  await page.click('#saveExtraButton');
  await page.waitForTimeout(1300);
  while (await page.$('body.detail-open')) { await page.click('.screen.active [data-back]'); await page.waitForTimeout(250); }

  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(600);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportButton')]);
  await dl.saveAs(SP + '/foreign-out.xlsx');
  line('saved a copy:', 'yes');
  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
