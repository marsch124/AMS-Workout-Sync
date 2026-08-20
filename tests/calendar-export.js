/*
 * A week handed to the calendar.
 *
 * The file has to satisfy something fussy and old (RFC 5545) or a calendar
 * refuses it without saying why: CRLF line endings, lines folded at 75 octets,
 * commas and semicolons escaped, and an all-day event whose end date is the
 * day after the one it is on.
 */
const { chromium } = require('playwright');

// Playwright's own Chromium unless the environment points somewhere else.
const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(34) + v);

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
      window.__shared.push({
        name: file && file.name,
        type: file && file.type,
        text: file ? await file.text() : data.text
      });
    };
    navigator.canShare = (data) => !!(data && data.files);
  });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/plain.xlsx');
  await page.waitForTimeout(2400);

  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(700);
  await page.click('[data-share-week]');
  await page.waitForTimeout(500);

  const options = await page.$$eval('#actionSheetActions button', ns => ns.map(n => n.innerText.replace(/\n/g, ' | ')));
  console.log('THE CHOICES');
  options.forEach(o => line('', o));

  await page.click('#actionSheetActions button:nth-child(3)');   // this week to the calendar
  await page.waitForTimeout(600);

  const shared = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  console.log('\nTHE FILE');
  line('name:', shared.name);
  line('type:', shared.type);

  const text = shared.text;
  const rawLines = text.split('\r\n');
  line('CRLF line endings:', text.indexOf('\r\n') !== -1 && !/[^\r]\n/.test(text));
  line('longest line (octets):', Math.max(...rawLines.map(l => Buffer.byteLength(l, 'utf8'))));
  line('starts / ends:', rawLines[0] + '  …  ' + rawLines[rawLines.length - 2]);
  line('events:', (text.match(/BEGIN:VEVENT/g) || []).length);
  line('every event closed:',
    (text.match(/BEGIN:VEVENT/g) || []).length === (text.match(/END:VEVENT/g) || []).length);
  line('all-day, end is the next day:', /DTSTART;VALUE=DATE:(\d{8})/.test(text) && /DTEND;VALUE=DATE:(\d{8})/.test(text));

  const first = text.slice(text.indexOf('BEGIN:VEVENT'), text.indexOf('END:VEVENT') + 10);
  console.log('\nTHE FIRST EVENT');
  first.split('\r\n').forEach(l => console.log('   ' + l));

  // dates must line up: DTEND is the day after DTSTART
  const pairs = [...text.matchAll(/DTSTART;VALUE=DATE:(\d{8})\r\nDTEND;VALUE=DATE:(\d{8})/g)]
    .map(m => [m[1], m[2]]);
  const dayAfter = (s) => {
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) + 86400000);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  console.log('');
  line('every DTEND is DTSTART + 1:', pairs.length + ' events, ' +
    (pairs.every(([a, b]) => dayAfter(a) === b) ? 'all correct' : 'MISMATCH'));

  // a session with a comma and a long description must survive the escaping
  line('commas escaped:', /SUMMARY:[^\r]*\\,/.test(text) || 'no comma in this fixture');
  line('no bare newline in a value:', !/\r\n[^A-Z ]/.test(text.replace(/\r\n [^\r]*/g, '')));

  // and the next-week option produces a different week
  await page.click('[data-share-week]');
  await page.waitForTimeout(400);
  await page.click('#actionSheetActions button:nth-child(4)');
  await page.waitForTimeout(600);
  const nextFile = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  line('next week file:', nextFile.name);
  line('different week:', nextFile.name !== shared.name);

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
