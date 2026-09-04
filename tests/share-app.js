/*
 * Passing the app on to somebody.
 *
 * Every failure this can have is a quiet one. A share that sends a link to
 * localhost looks exactly like a share that worked; so does an `sms:` whose
 * body arrives empty because the punctuation was the other platform's. Nobody
 * finds out until the person at the other end says nothing, which is the
 * normal thing for a person to do.
 *
 * So: where the link points, what the two platforms get, and whether the
 * message says the three things it has to. The last one is not fussiness —
 * this app is a lid for a workbook the other person does not have, and a bare
 * link opens on "No workbook yet", which reads as broken rather than waiting.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const line = (l, v) => console.log('   ' + String(l).padEnd(30) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------- 1
  console.log('WHERE THE LINK POINTS');

  const urls = await page.evaluate(() => ({
    published: AmsUi.__appUrl('https://marsch124.github.io/AMS-Workout-Sync/index.html'),
    renamed: AmsUi.__appUrl('https://example.org/somewhere/else/'),
    deep: AmsUi.__appUrl('https://example.org/app/?x=1#y'),
    localhost: AmsUi.__appUrl('http://localhost:7810/'),
    loopback: AmsUi.__appUrl('http://127.0.0.1:8080/'),
    file: AmsUi.__appUrl('file:///Users/someone/index.html'),
    insecure: AmsUi.__appUrl('http://example.org/app/'),
    running: AmsUi.__appUrl()
  }));

  Object.keys(urls).forEach(k => line(k, urls[k]));

  const HOME = 'https://marsch124.github.io/AMS-Workout-Sync/';
  if (urls.published !== HOME) errors.push('the published address did not resolve to its own directory');
  if (urls.renamed !== 'https://example.org/somewhere/else/') {
    errors.push('a moved or renamed app does not share its own address');
  }
  if (urls.deep !== 'https://example.org/app/') errors.push('a query string or fragment leaked into the shared link');
  // The four that nobody else can open must never be sent.
  ['localhost', 'loopback', 'file', 'insecure'].forEach((k) => {
    if (urls[k] !== HOME) errors.push('an unreachable address (' + k + ') would have been sent to somebody');
  });
  // These tests run on localhost, so this is the case that actually bites.
  if (urls.running !== HOME) errors.push('running locally, the app offered its local address');

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHAT THE MESSAGE SAYS');

  const text = await page.evaluate(() => AmsUi.__appShareText());
  const has = (re) => re.test(text);

  line('length', text.length + ' characters');
  line('names the app', has(/AMS Workout Sync/));
  line('says what it does', has(/Excel|Dropbox/));
  line('says what they need first', has(/\.xlsx/));
  line('says how to install it', has(/Add to Home Screen/));

  if (!has(/AMS Workout Sync/)) errors.push('the message does not name the app');
  if (!has(/Dropbox/)) errors.push('the message does not say what the app reads');
  if (!has(/\.xlsx/)) errors.push('the message does not say they need a plan of their own first');
  if (!has(/Add to Home Screen/)) errors.push('the message omits the step everybody misses on an iPhone');
  // The link is added beside the text, not buried in it, so the share sheet
  // can offer it as a link rather than as a sentence.
  if (/https?:\/\//.test(text)) errors.push('the address is inside the text as well as beside it, so it would be sent twice');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('WHAT EACH PLATFORM GETS');

  // iOS wants sms:&body=, everything else sms:?body=, and each ignores the
  // other's — the body arrives empty rather than the link failing.
  const forms = await page.evaluate(() => {
    const probe = (ua, touch) => {
      const ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
      return 'sms:' + (ios ? '&' : '?') + 'body=';
    };
    return {
      iPhone: probe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 5),
      iPadModern: probe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5),
      iPadOld: probe('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 5),
      android: probe('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5),
      mac: probe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0),
      windows: probe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10)
    };
  });

  Object.keys(forms).forEach(k => line(k, forms[k]));

  ['iPhone', 'iPadModern', 'iPadOld'].forEach((k) => {
    if (forms[k] !== 'sms:&body=') errors.push(k + ' would be sent the form iOS ignores, so Messages would open empty');
  });
  ['android', 'mac', 'windows'].forEach((k) => {
    if (forms[k] !== 'sms:?body=') errors.push(k + ' would be sent the iOS form, so the message would open empty');
  });

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('THE THREE WAYS OUT');

  const routes = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="settings"]').click();
    await new Promise(r => setTimeout(r, 400));

    const button = document.querySelector('[data-share-app]');
    if (!button) return { error: 'no share button in Settings' };
    button.click();
    await new Promise(r => setTimeout(r, 300));

    const labels = [...document.querySelectorAll('#actionSheetActions button')]
      .map(b => (b.firstChild ? b.firstChild.textContent : b.textContent).trim());

    // Messages: catch the href rather than leaving the page.
    let sms = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { sms = this.href; };
    document.querySelectorAll('#actionSheetActions button')[0].click();
    await new Promise(r => setTimeout(r, 300));
    HTMLAnchorElement.prototype.click = realClick;

    // The share sheet: catch the payload.
    let payload = null;
    const realShare = navigator.share;
    navigator.share = async (p) => { payload = p; };
    document.querySelector('[data-share-app]').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelectorAll('#actionSheetActions button')[1].click();
    await new Promise(r => setTimeout(r, 400));
    navigator.share = realShare;

    return {
      labels: labels,
      sheetClosed: document.getElementById('actionSheet').hidden,
      sms: sms,
      smsBody: sms ? decodeURIComponent(sms.replace(/^sms:[&?]body=/, '')) : null,
      payload: payload
    };
  });

  if (routes.error) errors.push(routes.error);
  line('the sheet offers', (routes.labels || []).join(' · '));
  line('and closes behind the choice', routes.sheetClosed);
  line('Messages body ends with', routes.smsBody ? routes.smsBody.slice(-46) : null);
  line('the share sheet gets a url of', routes.payload && routes.payload.url);

  if (!routes.labels || routes.labels.length !== 3) errors.push('the share sheet does not offer three ways');
  if (!routes.sms || !/^sms:/.test(routes.sms)) errors.push('the Messages option did not produce an sms: link');
  if (routes.smsBody && routes.smsBody.indexOf(HOME) === -1) {
    errors.push('the message sent to Messages does not contain the link');
  }
  if (routes.smsBody && routes.smsBody.indexOf('Add to Home Screen') === -1) {
    errors.push('the message sent to Messages lost the instructions');
  }
  if (!routes.payload) errors.push('the Share option did not reach the share sheet');
  if (routes.payload && routes.payload.url !== HOME) errors.push('the share sheet was given the wrong address');
  if (routes.payload && !routes.payload.text) errors.push('the share sheet was given a link with nothing said about it');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
