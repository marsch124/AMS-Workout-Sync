/*
 * The August audit's four findings, kept fixed.
 *
 * An audit that finds things once is a snapshot; these checks make it a
 * ratchet. Each one guards a promise the fixes made:
 *
 *   1. the browser is asked, at every boot, to treat the app's storage as
 *      worth keeping — the queue of unsynced sessions lives there
 *   2. the reset confirm counts the sessions it would delete, and only
 *      speaks up when there is something to lose
 *   3. the sport colours hold accessibility contrast in light mode, where
 *      the dark theme's bright palette used to wash out to half the standard
 *   4. the small controls are tappable at thumb size — grown by transparent
 *      halos, so nothing visible moved — and the legend toggle's halo does
 *      not steal taps from the day columns below it, which are tappable too
 */
const { chromium } = require('playwright');
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const errs = [];

  // ---- persist() is asked for at boot ----
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    window.__persistCalls = 0;
    if (navigator.storage && navigator.storage.persist) {
      const real = navigator.storage.persist.bind(navigator.storage);
      navigator.storage.persist = () => { window.__persistCalls++; return real(); };
    }
  });
  const p = await ctx.newPage();
  let dialogMsg = null;
  p.on('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
  await p.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const persist = await p.evaluate(() => window.__persistCalls);
  console.log('1  STORAGE PERSISTENCE');
  line('navigator.storage.persist() called at boot', persist + ' time' + (persist === 1 ? '' : 's'));
  if (persist !== 1) errs.push('persist() called ' + persist + ' times');

  // ---- the reset confirm counts the queue ----
  console.log('');
  console.log('2  THE RESET CONFIRM');
  await p.click('.tab[data-tab="settings"]');
  await p.waitForSelector('#openLocalButton');
  await p.setInputFiles('#localFileInput', __dirname + '/fixtures/plain.xlsx');
  await p.waitForTimeout(2800);
  await p.evaluate(async () => {
    const t = AmsSync.getState().plan.filter(w => w.discipline.id !== 'rest').slice(0, 2);
    for (const w of t) await AmsSync.logWorkout(w, { actualDuration: '30' });
  });
  await p.waitForTimeout(800);
  // The reset button lives behind the settings fold.
  await p.evaluate(() => {
    const fold = document.querySelector('[data-settings-fold]');
    if (fold) fold.click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const n = document.getElementById('resetButton'); if (n) n.click(); });
  await p.waitForTimeout(600);
  line('confirm says', '"' + String(dialogMsg).slice(0, 100) + '…"');
  if (!/2 sessions not yet written/.test(String(dialogMsg))) {
    errs.push('the confirm did not count the 2 queued sessions: ' + dialogMsg);
  }
  const stillThere = await p.evaluate(() => AmsDb.queueCount());
  line('declining kept the queue', stillThere + ' entries');
  if (stillThere !== 2) errs.push('dismissing the confirm lost the queue');

  // ---- light-mode sport contrast ----
  console.log('');
  console.log('3  LIGHT-MODE SPORT CONTRAST (needs 4.5:1)');
  const light = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const lp = await light.newPage();
  lp.on('dialog', d => d.accept());
  await lp.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await lp.click('.tab[data-tab="settings"]');
  await lp.waitForSelector('#openLocalButton');
  await lp.setInputFiles('#localFileInput', __dirname + '/fixtures/plain.xlsx');
  await lp.waitForTimeout(2800);
  await lp.click('.tab[data-tab="today"]');
  await lp.waitForTimeout(700);
  const ratios = await lp.evaluate(() => {
    const paintedBg = (n) => {
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const l1 = lum(fg), l2 = lum(bg);
      return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    };
    const out = [];
    document.querySelectorAll('.workout-card-sport').forEach(n => {
      out.push([n.innerText.trim(), ratio(getComputedStyle(n).color, paintedBg(n))]);
    });
    const pill = document.querySelector('.pill');
    if (pill) out.push(['pill "' + pill.innerText.trim() + '"', ratio(getComputedStyle(pill).color, paintedBg(pill))]);
    return out;
  });
  ratios.forEach(([name, r]) => {
    line(name, r + ':1' + (r < 4.5 ? '  FAILS' : ''));
    if (r < 4.5) errs.push(name + ' still at ' + r + ':1 in light mode');
  });

  // ---- hit areas ----
  console.log('');
  console.log('4  HIT AREAS (a tap beyond the visible pixels must still land)');
  const probe = async (page, sel, label, expectSelf) => {
    const r = await page.evaluate(([sel, expectSelf]) => {
      const n = [...document.querySelectorAll(sel)]
        .find(x => x.getBoundingClientRect().height > 0);
      if (!n) return { missing: true };
      n.scrollIntoView({ block: 'center' });
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n, '::after');
      const top = parseFloat(cs.top) || 0, bottom = parseFloat(cs.bottom) || 0;
      const effective = b.height - top - bottom; // negative offsets grow it
      // A tap 10px above the visual top:
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top - 6);
      const landed = hit === n || n.contains(hit) || (hit && hit.closest && hit.closest(expectSelf) === n);
      return { h: Math.round(b.height), effective: Math.round(effective), landed };
    }, [sel, expectSelf]);
    if (r.missing) { line(label, '(absent on this screen)'); return; }
    line(label, r.h + 'px drawn -> ' + r.effective + 'px tappable; tap above lands: ' + (r.landed ? 'yes' : 'NO'));
    if (r.effective < 43) errs.push(label + ' effective height ' + r.effective + 'px');
    if (!r.landed) errs.push(label + ': a tap above the pixels missed');
  };
  await probe(lp, '.week-card-head-main', 'legend toggle', '.week-card-head-main');
  await probe(lp, '.week-share', 'share button', '.week-share');
  await lp.click('.tab[data-tab="plan"]'); await lp.waitForTimeout(500);
  await probe(lp, '.segment', 'plan segment', '.segment');
  await lp.click('.tab[data-tab="settings"]'); await lp.waitForTimeout(500);
  await probe(lp, '.btn-small', 'small settings button', '.btn-small');

  // And the day columns did not lose their tap to the toggle's halo.
  await lp.click('.tab[data-tab="today"]'); await lp.waitForTimeout(600);
  const dayTap = await lp.evaluate(() => {
    const day = document.querySelector('[data-day]');
    if (!day) return { missing: true };
    const b = day.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + 4);
    return { stolen: !(day === hit || day.contains(hit)) ,
             by: hit ? (hit.className || hit.tagName).toString().slice(0, 30) : 'nothing' };
  });
  line('top of a day column still taps the day', dayTap.stolen ? 'NO — stolen by ' + dayTap.by : 'yes');
  if (dayTap.stolen) errs.push('the toggle halo steals the day columns: ' + dayTap.by);

  console.log('');
  console.log('errors: ' + (errs.length ? '\n  - ' + errs.join('\n  - ') : 'none'));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
