/*
 * Failure-path tests. Everything here is a way the app can be attacked by
 * reality: a truncated download, a phone with no room, a queue entry whose row
 * has gone, a network that accepts the connection and then says nothing.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};
const fs = require('fs');
const SP = __dirname + '/fixtures';

const line = (label, value) => console.log('   ' + String(label).padEnd(34) + value);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  const load = async (file) => {
    await page.click('.tab[data-tab="settings"]');
    await page.waitForTimeout(400);
    // with Dropbox connected, opening a local file lives behind the fold
    if (!(await page.$('#openLocalButton'))) {
      const fold = await page.$('[data-settings-fold]');
      if (fold) { await fold.click(); await page.waitForTimeout(400); }
    }
    await page.waitForSelector('#openLocalButton');
    await page.setInputFiles('#localFileInput', SP + '/' + file);
    await page.waitForTimeout(2400);
  };
  const alive = async () => {
    await page.click('.tab[data-tab="today"]');
    await page.waitForTimeout(500);
    return await page.evaluate(() => !!document.querySelector('#todayScreen') && document.body.children.length > 0);
  };

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });

  // ---------------------------------------------------------------- 1
  console.log('\n1. A FILE THAT IS NOT A WORKBOOK');
  fs.writeFileSync(SP + '/rubbish.xlsx', Buffer.from('this is not a zip, it is a sentence'));
  await load('rubbish.xlsx');
  line('toast:', (await page.textContent('#toast')).trim() || '(silent)');
  line('app still usable:', await alive());

  // ---------------------------------------------------------------- 2
  console.log('\n2. A TRUNCATED WORKBOOK (download cut short)');
  const good = fs.readFileSync(SP + '/plain.xlsx');
  fs.writeFileSync(SP + '/truncated.xlsx', good.subarray(0, Math.floor(good.length * 0.6)));
  await load('truncated.xlsx');
  line('toast:', (await page.textContent('#toast')).trim() || '(silent)');
  line('app still usable:', await alive());

  // ---------------------------------------------------------------- 3
  console.log('\n3. A CORRUPT COPY ALREADY CACHED ON THE PHONE');
  await load('plain.xlsx');
  await page.evaluate(async () => {
    // what a half-finished write to storage leaves behind
    await AmsDb.set('workbook.bytes', new Uint8Array([80, 75, 3, 4, 9, 9, 9]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  line('booted:', await alive());
  line('cache discarded:', await page.evaluate(async () => !(await AmsDb.getWorkbook())));
  line('said what happened:', (await page.evaluate(() => (AmsSync.getState().lastError || '(nothing)'))).slice(0, 60));

  // ---------------------------------------------------------------- 4
  console.log('\n4. ONE BAD QUEUE ENTRY MUST NOT JAM THE REST');
  await load('plain.xlsx');
  const jam = await page.evaluate(async () => {
    // two good logs and one entry pointing at a session that no longer exists
    const plan = AmsSync.getState().plan.filter(w => w.discipline.id !== 'rest');
    await AmsSync.logWorkout(plan[0], { actualDuration: '30' });
    await AmsDb.queue({ workoutKey: 'Nowhere!999', dayKey: '1999-01-01',
                        disciplineId: 'swim', sheet: 'Nowhere', values: { actualDuration: '20' } });
    await AmsSync.logWorkout(plan[1], { actualDuration: '40' });

    // a Dropbox that works, so the only failure is the entry itself
    const bytes = await AmsDb.get('workbook.bytes', null);
    let uploaded = null;
    AmsDropbox.isConnected = async () => true;
    AmsDropbox.download = async () => ({ bytes: bytes, rev: 'rev1', name: 'w.xlsx', path: '/w.xlsx' });
    AmsDropbox.upload = async (path, blob) => { uploaded = blob.size; return { rev: 'rev2', name: 'w.xlsx' }; };
    await AmsDb.set('workbook.path', '/w.xlsx');

    const result = await AmsSync.sync();
    const left = await AmsDb.listQueue();
    return { result: result, uploaded: uploaded,
             left: left.map(e => ({ key: e.workoutKey, attempts: e.attempts, error: e.lastError })) };
  });
  line('sync result:', JSON.stringify(jam.result));
  line('uploaded bytes:', jam.uploaded);
  line('still queued:', JSON.stringify(jam.left));

  // ---------------------------------------------------------------- 5
  console.log('\n5. A WORKBOOK THE APP CANNOT READ BACK IS NOT UPLOADED');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await load('plain.xlsx');
  const guard = await page.evaluate(async () => {
    const plan = AmsSync.getState().plan.filter(w => w.discipline.id !== 'rest');
    await AmsSync.logWorkout(plan[0], { actualDuration: '30' });

    const bytes = await AmsDb.get('workbook.bytes', null);
    let uploaded = false;
    AmsDropbox.isConnected = async () => true;
    AmsDropbox.download = async () => ({ bytes: bytes, rev: 'rev1', name: 'w.xlsx', path: '/w.xlsx' });
    AmsDropbox.upload = async () => { uploaded = true; return { rev: 'rev2' }; };
    await AmsDb.set('workbook.path', '/w.xlsx');

    // a writer that produces nonsense, which is the thing being defended against
    const realOpen = AmsXlsx.open;
    AmsXlsx.open = async function (input) {
      const wb = await realOpen.call(AmsXlsx, input);
      const realSave = wb.save.bind(wb);
      wb.save = async () => new Blob([new Uint8Array([1, 2, 3, 4])]);
      wb.__realSave = realSave;
      return wb;
    };
    const result = await AmsSync.sync();
    AmsXlsx.open = realOpen;
    const left = await AmsDb.listQueue();
    return { result: result, uploaded: uploaded, stillQueued: left.length };
  });
  line('sync result:', JSON.stringify(guard.result).slice(0, 130));
  line('did it upload?:', guard.uploaded ? 'YES — BAD' : 'no');
  line('entries kept:', guard.stillQueued);

  // ---------------------------------------------------------------- 6
  console.log('\n6. A NETWORK THAT NEVER ANSWERS');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await load('plain.xlsx');
  const hang = await page.evaluate(async () => {
    const started = Date.now();
    AmsDropbox.isConnected = async () => true;
    AmsDropbox.download = () => new Promise(() => {});      // never settles
    await AmsDb.set('workbook.path', '/w.xlsx');
    const plan = AmsSync.getState().plan.filter(w => w.discipline.id !== 'rest');
    await AmsSync.logWorkout(plan[0], { actualDuration: '30' });

    const race = await Promise.race([
      AmsSync.sync().then(() => 'finished'),
      new Promise(r => setTimeout(() => r('still going'), 1500))
    ]);
    return { race: race, syncingFlag: AmsSync.getState().syncing, ms: Date.now() - started };
  });
  line('after 1.5s the sync is:', hang.race);
  line('the app knows it is busy:', hang.syncingFlag);
  line('second tap is refused:', await page.evaluate(async () => JSON.stringify(await AmsSync.sync())));

  // ---------------------------------------------------------------- 7
  console.log('\n7. A WORKBOOK CARRYING MARKUP IN ITS TEXT');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await load('nasty.xlsx');
  await page.waitForTimeout(600);
  const nasty = await page.evaluate(() => {
    const injected = document.querySelectorAll('#todayBody img, #planBody img, #todayBody script');
    const text = document.getElementById('todayBody').innerText;
    return { injectedNodes: injected.length, showsRawText: /onerror|<img/i.test(text) };
  });
  line('injected elements:', nasty.injectedNodes + (nasty.injectedNodes ? '  <- BAD' : '  <- none'));
  line('shown as plain text:', nasty.showsRawText);
  line('window.hacked:', await page.evaluate(() => String(window.hacked)));

  // ---------------------------------------------------------------- 8
  console.log('\n8. WHAT THE NETWORK LAYER SAYS WHEN IT FAILS');
  const net = await page.evaluate(async () => {
    const real = window.fetch;
    const out = {};
    await AmsDb.set('workbook.path', '/w.xlsx');
    await AmsDb.set('dropbox.refreshToken', 'r');
    await AmsDb.set('dropbox.accessToken', 'a');
    await AmsDb.set('dropbox.expiresAt', Date.now() + 600000);

    window.fetch = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    try { await AmsDropbox.download('/w.xlsx'); } catch (e) { out.timedOut = e.message; }

    window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    try { await AmsDropbox.download('/w.xlsx'); } catch (e) { out.offline = e.message; }

    let calls = 0;
    window.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 429, headers: { 'retry-after': '0' } });
      return new Response(new Uint8Array([1]).buffer, {
        status: 200, headers: { 'dropbox-api-result': JSON.stringify({ rev: 'r2', name: 'w.xlsx' }) } });
    };
    const started = Date.now();
    const file = await AmsDropbox.download('/w.xlsx');
    out.retried = { calls: calls, rev: file.rev, ms: Date.now() - started };

    let serverCalls = 0;
    window.fetch = async () => { serverCalls++; return new Response('boom', { status: 500 }); };
    try { await AmsDropbox.download('/w.xlsx'); } catch (e) { out.server = { calls: serverCalls, message: e.message }; }

    window.fetch = real;
    return out;
  });
  line('a request that times out:', net.timedOut);
  line('a phone with no signal:', net.offline);
  line('429 then 200:', JSON.stringify(net.retried));
  line('500 twice then gives up:', JSON.stringify(net.server));
  await page.evaluate(async () => {
    await AmsDb.remove('dropbox.refreshToken');
    await AmsDb.remove('dropbox.accessToken');
    await AmsDb.remove('dropbox.expiresAt');
  });

  // ---------------------------------------------------------------- 9
  console.log('\n9. HOSTILE TEXT ON THE PLAN SCREEN');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await load('nasty.xlsx');
  await page.click('.tab[data-tab="plan"]');
  await page.waitForTimeout(700);
  const plan = await page.evaluate(() => ({
    imgs: document.querySelectorAll('#planBody img, #planBody script').length,
    titles: [...document.querySelectorAll('#planBody .workout-card-title')].map(n => n.textContent.slice(0, 44)),
    longest: Math.max(0, ...[...document.querySelectorAll('#planBody .workout-card-title')].map(n => n.textContent.length)),
    bodyWiderThanScreen: document.documentElement.scrollWidth > window.innerWidth + 1
  }));
  line('injected elements:', plan.imgs + (plan.imgs ? '  <- BAD' : '  <- none'));
  plan.titles.forEach(t => line('title as shown:', JSON.stringify(t)));
  line('longest title (chars):', plan.longest);
  line('layout still fits:', !plan.bodyWiderThanScreen);
  line('window.hacked:', await page.evaluate(() => String(window.hacked)));

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
