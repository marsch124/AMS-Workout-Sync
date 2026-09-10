/*
 * Telling somebody you are back.
 *
 * "When I have logged my workout, I would like the opportunity within the
 * workflow to send the workout with a nice greeting to my wife via messages.
 * Including the photos that I have attached sometimes."
 *
 * Two things had to be true and neither was. The offer has to be *there* the
 * moment the session is logged rather than behind the share button on another
 * screen — and what it sends has to be what he did, not the brief. The app
 * could already forward a session, but it forwarded the *plan*: intensity,
 * purpose, the warm-up, the interval set. That is the right thing to send a
 * training partner and entirely the wrong thing to send your wife.
 *
 * So this holds two lines. The message says what was done and does not carry
 * the brief, and the photographs go with it.
 */
const { chromium, devices } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(44) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage(devices['iPhone 13']);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton', { state: 'visible' });
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2800);

  // A share sheet that records rather than opens, and a phone that accepts
  // files — the real one is the platform's decision and cannot be driven here.
  await page.evaluate(() => {
    window.__shared = [];
    navigator.share = async (payload) => {
      window.__shared.push({
        text: payload.text,
        files: (payload.files || []).map(f => f.name)
      });
    };
    navigator.canShare = (payload) => !!(payload && payload.files && payload.files.length);
    window.__photo = () => {
      const c = document.createElement('canvas');
      c.width = 600; c.height = 400;
      const g = c.getContext('2d');
      g.fillStyle = '#2a6'; g.fillRect(0, 0, 600, 400);
      return new Promise(res => c.toBlob(
        b => res(new File([b], 'IMG.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9));
    };
  });

  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(800);

  // ---------------------------------------------------------------- 1
  console.log('NOTHING TO SEND UNTIL IT IS DONE');

  const before = await page.evaluate(() => ({
    offers: document.querySelectorAll('#todayBody [data-share-done]').length,
    cards: document.querySelectorAll('#todayBody .workout-card').length
  }));
  line('sessions on Today', before.cards);
  line('offers to send', before.offers);
  if (before.offers) {
    errors.push('a session nobody has done yet already offers to be sent');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('LOGGED, AND THE OFFER IS RIGHT THERE');

  await page.click('#todayBody [data-as-planned]');
  await page.waitForTimeout(1700);

  const offered = await page.evaluate(() => {
    const btn = document.querySelector('#todayBody [data-share-done]');
    return {
      present: !!btn,
      label: btn ? btn.textContent.trim() : null,
      onTheDoneCard: !!(btn && btn.closest('.workout-card.is-done')),
      // it must not be the biggest thing on a card that shrank to a line
      width: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
      cardWidth: btn ? Math.round(btn.closest('.workout-card').getBoundingClientRect().width) : 0
    };
  });

  line('the offer says', '"' + offered.label + '"');
  line('it sits on the card that was just done', offered.onTheDoneCard);
  line('its width against the card', offered.width + 'px of ' + offered.cardWidth + 'px');

  if (!offered.present) errors.push('logging a session did not offer to send it anywhere');
  if (!offered.onTheDoneCard) errors.push('the offer is not on the session that was logged');
  if (offered.width > offered.cardWidth * 0.75) {
    errors.push('the offer is nearly the width of the card — it is meant to be secondary to it');
  }

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHAT IT SENDS IS WHAT HE DID, NOT THE BRIEF');

  await page.click('#todayBody [data-share-done]');
  await page.waitForTimeout(600);
  const sheet = await page.evaluate(() => ({
    title: (document.getElementById('actionSheetTitle') || {}).textContent,
    options: [...document.querySelectorAll('#actionSheetActions button')].length,
    screen: (document.querySelector('.screen.active') || {}).id
  }));
  /*
   * Pressing it must not also open the session under it. The button sits
   * inside a card that is itself tappable, so the click has to be caught
   * before the card's own handler sees it.
   */
  if (sheet.screen !== 'todayScreen') {
    errors.push('pressing the offer opened the session instead of the sheet');
  }

  await page.click('#actionSheetActions button');
  await page.waitForTimeout(800);

  const sent = await page.evaluate(() => window.__shared[window.__shared.length - 1] || null);
  if (!sent) { errors.push('nothing was handed to the share sheet'); }
  else {
    console.log('   the message reads:');
    sent.text.split('\n').forEach(l => console.log('      ' + l));

    if (!/finish|done/i.test(sent.text)) {
      errors.push('the message does not say the session is done: ' + sent.text);
    }
    if (!/\d/.test(sent.text)) {
      errors.push('the message carries no figure at all: ' + sent.text);
    }
    /*
     * The brief is the thing this exists *not* to send. If these ever come
     * back it means it fell through to sessionShareText(), which forwards the
     * plan.
     */
    if (/Purpose:|Intensity:|Warm-?up:/i.test(sent.text)) {
      errors.push('the plan brief went out with it: ' + sent.text);
    }
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('AND THE PHOTOGRAPHS GO WITH IT');

  const withPhoto = await page.evaluate(async () => {
    // Attach a picture to the session that was just logged, the way the
    // session screen does.
    const key = document.querySelector('#todayBody [data-share-done]').dataset.shareDone;
    const workout = AmsSync.byKey(key);
    await AmsPhotos.add(workout, await window.__photo());
    AmsUi.renderToday();
    await new Promise(r => setTimeout(r, 400));

    document.querySelector('#todayBody [data-share-done]').click();
    await new Promise(r => setTimeout(r, 500));
    const sub = document.querySelector('#actionSheetActions button').innerText;
    document.querySelector('#actionSheetActions button').click();
    await new Promise(r => setTimeout(r, 600));
    return { sub: sub.replace(/\n/g, ' / '), last: window.__shared[window.__shared.length - 1] };
  });

  line('the option now reads', '"' + withPhoto.sub + '"');
  line('files handed over', (withPhoto.last.files || []).join(', ') || 'none');

  if (!withPhoto.last.files || !withPhoto.last.files.length) {
    errors.push('the photograph did not go with the message');
  }
  if (!/photo/i.test(withPhoto.sub)) {
    errors.push('the sheet does not say the photo is going, so a message that arrives without '
      + 'one would be a silent failure: ' + withPhoto.sub);
  }
  if (!/finish|done/i.test(withPhoto.last.text || '')) {
    errors.push('the words were lost when the photo was attached');
  }

  console.log('');
  console.log(errors.length ? 'errors:' : 'errors: none');
  errors.forEach(e => console.log('   - ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
