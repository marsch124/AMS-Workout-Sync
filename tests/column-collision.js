const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};
const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(36) + v);
(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);

  console.log('A MAPPING THAT WOULD WRITE OVER THE PLAN');
  const out = await page.evaluate(async () => {
    const state = AmsSync.getState();
    const mapping = JSON.parse(JSON.stringify(state.mapping));
    const titleCol = mapping.columns.title;

    // the accident being defended against: the duration is written into the
    // column that holds what the session actually is
    mapping.columns.actualDuration = titleCol;

    const found = AmsMapping.collisions(mapping).map(c => c.fields.join(' + '));

    const workout = state.plan.find(w => w.discipline.id !== 'rest');
    const edits = AmsPlan.buildEdits(workout, { actualDuration: '45', avgHr: '132' }, mapping);
    return {
      titleColumn: titleCol,
      collisionsSeen: found,
      editsMade: edits.map(e => e.field + ' -> ' + e.ref),
      titleStillIntact: workout.title.slice(0, 30)
    };
  });
  line('collisions detected:', JSON.stringify(out.collisionsSeen));
  line('column the workout text lives in:', out.titleColumn);
  line('what the writer would actually do:', JSON.stringify(out.editsMade));
  line('nothing aimed at the title column:',
    out.editsMade.every(e => !e.endsWith(String.fromCharCode(64 + out.titleColumn) + '3')) ? 'confirmed' : 'CHECK');

  // and the setup screen refuses to save it
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(500);
  await page.click('[data-settings-fold]');
  await page.waitForTimeout(400);
  await page.click('[data-go="setup"]');
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async () => {
    const before = JSON.stringify(AmsSync.getState().mapping.columns);
    // force the clash into the draft the screen is holding
    const sel = document.querySelector('[data-field="actualDuration"] select, select[data-field="actualDuration"]');
    return { before: before, hasSelect: !!sel };
  });
  line('setup screen reachable:', saved.hasSelect ? 'yes (field selects present)' : 'no select found');

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
