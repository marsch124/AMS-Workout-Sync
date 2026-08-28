/*
 * The wash on the week card — the week itself, painted as ground.
 *
 * The tint's right edge is the present moment. That is only true if the
 * fraction is computed from the clock at render time, so this drives the app
 * at three fixed moments of the current week — Monday just after midnight,
 * midweek, and Sunday evening — and reads the custom property the gradient is
 * built from. It also checks the wash is a background layer: nothing new in
 * the DOM, nothing that could sit on a tap.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};
const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(40) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const errors = [];

  // Moments inside the *current real* week, because the fixture is generated
  // around it — faking a different week would empty the card.
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 30, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 30, 0, 0);
  const midweek = new Date(monday);
  midweek.setDate(monday.getDate() + 3);
  midweek.setHours(12, 0, 0, 0);

  const moments = [
    ['Monday 00:30', monday, 0.3],
    ['Thursday noon', midweek, 50.0],
    ['Sunday 23:30', sunday, 99.7]
  ];

  for (const [label, when, expected] of moments) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(`{
      const fixed = ${when.getTime()};
      const RealDate = Date;
      // Only "now" is frozen; explicit constructions still work, which is all
      // the rest of the app uses dates for.
      window.Date = class extends RealDate {
        constructor(...args) { args.length ? super(...args) : super(fixed); }
        static now() { return fixed; }
      };
    }`);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('dialog', d => d.accept());
    await p.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
    await p.click('.tab[data-tab="settings"]');
    await p.waitForSelector('#openLocalButton');
    await p.setInputFiles('#localFileInput', SP + '/plain.xlsx');
    await p.waitForTimeout(2500);
    await p.click('.tab[data-tab="today"]');
    await p.waitForTimeout(600);

    const r = await p.evaluate(() => {
      const card = document.querySelector('.week-card');
      if (!card) return null;
      return {
        f: parseFloat(card.style.getPropertyValue('--week-f')),
        hasGradient: getComputedStyle(card).backgroundImage.includes('gradient'),
        extraNodes: card.querySelectorAll('.wash, [class*=wash]').length
      };
    });
    if (!r) { errors.push(label + ': no week card'); await ctx.close(); continue; }
    line(label, '--week-f: ' + r.f + '%  (expected ~' + expected + '%)  gradient: '
      + (r.hasGradient ? 'painted' : 'MISSING'));
    if (Math.abs(r.f - expected) > 1.5) {
      errors.push(label + ': fraction ' + r.f + '% is not ~' + expected + '%');
    }
    if (!r.hasGradient) errors.push(label + ': the gradient is not painted');
    if (r.extraNodes) errors.push(label + ': the wash added DOM nodes');
    await ctx.close();
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
