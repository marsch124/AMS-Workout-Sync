/*
 * The parts of the app that are only words, and the layout decisions that
 * exist because of them.
 *
 * None of this is arithmetic, so none of it can be wrong in a way that throws.
 * It goes wrong by drifting: a label that stops matching what it opens, a line
 * that reads as a caption for the buttons under it, an explanation put back
 * into a placeholder where it disappears the moment it is answered. Every one
 * of those was reported by the person using the app rather than found here,
 * which is the argument for writing them down.
 *
 * So this checks the shape of the screens as much as the sentences:
 *
 *   1. the effort field is short and its meaning is beside it, live;
 *   2. Add comes after the photographs, and the strip wraps so it cannot be
 *      pushed off the edge — those two only work together;
 *   3. a session's photographs go with it when it is sent as a message, and
 *      the button says so honestly beforehand either way;
 *   4. Settings says what each thing is, and Setup and connection sits inside
 *      Workbook rather than beside it;
 *   5. the question marks open something that explains the buttons they are
 *      next to.
 */
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || '';
const LAUNCH = CHROME && require('fs').existsSync(CHROME) ? { executablePath: CHROME } : {};

const SP = __dirname + '/fixtures';
const line = (l, v) => console.log('   ' + String(l).padEnd(44) + v);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  // Phone-sized on purpose. On a desktop viewport five photographs and a
  // button sit happily on one line, and the wrapping this checks for would
  // pass without ever having been exercised.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:7810/', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#openLocalButton');
  await page.setInputFiles('#localFileInput', SP + '/everyday.xlsx');
  await page.waitForTimeout(2600);

  await page.evaluate(async () => {
    await AmsDb.set('log.showAllFields', true);
    await AmsPhotos.removeAll();
    window.__photo = (w, h, hue) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + hue + ',60%,45%)';
      g.fillRect(0, 0, w, h);
      return new Promise(res => c.toBlob(
        b => res(new File([b], 'IMG.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9));
    };
  });

  // ---------------------------------------------------------------- 1
  console.log('THE EFFORT FIELD, AND THE ROOM BESIDE IT');

  const effort = await page.evaluate(async () => {
    const workout = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 200));
    [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key).click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('openLogButton').click();
    await new Promise(r => setTimeout(r, 700));

    const input = document.getElementById('log-rpe');
    const note = document.getElementById('log-rpe-note');
    if (!input || !note) return { error: 'the effort field has no words beside it' };

    const said = {};
    said.empty = note.textContent;
    for (const v of ['1', '4', '6', '7', '10', '6.5', '0', '99', 'x']) {
      input.value = v;
      input.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 30));
      said[v] = note.textContent;
    }

    // The point of the change: the box is short and the words are wide.
    const boxWidth = input.getBoundingClientRect().width;
    const noteWidth = note.getBoundingClientRect().width;
    const sameLine = Math.abs(input.getBoundingClientRect().top - note.getBoundingClientRect().top) < 24;

    return { said: said, boxWidth: Math.round(boxWidth), noteWidth: Math.round(noteWidth), sameLine: sameLine,
             placeholder: input.getAttribute('placeholder') };
  });

  if (effort.error) errors.push(effort.error);
  else {
    line('with nothing typed', effort.said.empty);
    line('at 4', effort.said['4']);
    line('at 7', effort.said['7']);
    line('at 6.5 (a feeling, read down)', effort.said['6.5']);
    line('at 99', effort.said['99']);
    line('box vs words', effort.boxWidth + 'px vs ' + effort.noteWidth + 'px, same line: ' + effort.sameLine);

    if (!effort.sameLine) errors.push('the explanation is not beside the field');
    if (!(effort.boxWidth < effort.noteWidth)) {
      errors.push('the box is not narrower than the words beside it, so the space is still going to waste');
    }
    if (effort.said['4'] === effort.said['7']) errors.push('every number is described the same way');
    if (effort.said['6.5'] !== effort.said['6']) errors.push('a half step is not read down to the number below');
    if (!/1\D+10/.test(effort.said['99'])) errors.push('a number outside the scale is not called out');
    if (effort.said['0'] === effort.said['1']) errors.push('0 is being described as if it were on the scale');
    if (effort.said.empty === effort.said['7']) errors.push('the empty state does not show the scale');
  }

  // ---------------------------------------------------------------- 2
  console.log('');
  console.log('WHERE ADD SITS, AND WHY IT CAN');

  const strip = await page.evaluate(async () => {
    const workout = AmsSync.byKey(document.querySelector('#logBody') && AmsSync.getState().plan
      .find(w => w.discipline.id !== 'rest').key);
    for (let i = 0; i < 5; i++) await AmsPhotos.add(workout, await window.__photo(600, 400, i * 60));

    document.querySelector('#logScreen [data-back]').click();
    await new Promise(r => setTimeout(r, 300));
    AmsUi.showScreen('planScreen');
    [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key).click();
    await new Promise(r => setTimeout(r, 600));

    const strip = document.querySelector('#workoutBody .photo-strip');
    const add = strip.querySelector('.photo-add');
    const thumbs = [...strip.querySelectorAll('.photo-thumb')];

    const box = strip.getBoundingClientRect();
    const addBox = add.getBoundingClientRect();
    const rows = new Set(thumbs.concat([add]).map(n => Math.round(n.getBoundingClientRect().top)));

    return {
      addIsLastChild: strip.lastElementChild === add,
      thumbs: thumbs.length,
      rows: rows.size,
      // The reason Add can live at the end: nothing is off the edge.
      addFullyVisible: addBox.right <= box.right + 1 && addBox.left >= box.left - 1,
      scrolls: strip.scrollWidth > strip.clientWidth + 1
    };
  });

  line('Add is the last thing in the strip', strip.addIsLastChild);
  line('photographs, laid out in rows', strip.thumbs + ' in ' + strip.rows + ' rows');
  line('Add is fully on screen', strip.addFullyVisible);
  line('the strip scrolls sideways', strip.scrolls);

  if (!strip.addIsLastChild) errors.push('Add is not after the photographs');
  if (strip.rows < 2) errors.push('five photos and a button did not wrap, so this proves nothing');
  if (!strip.addFullyVisible) errors.push('Add is off the edge of the strip — the reason it was moved to the front');
  if (strip.scrolls) errors.push('the strip still scrolls sideways, which is what hid the button');

  // ---------------------------------------------------------------- 3
  console.log('');
  console.log('SENDING A SESSION WITH ITS PHOTOGRAPHS');

  const shared = await page.evaluate(async () => {
    const out = {};

    // A phone that will take files.
    const realCanShare = navigator.canShare;
    const realShare = navigator.share;
    navigator.canShare = (p) => !!(p && p.files && p.files.length);
    let payload = null;
    navigator.share = async (p) => { payload = p; };

    document.getElementById('shareWorkoutButton').click();
    await new Promise(r => setTimeout(r, 800));
    out.labelWithPhotos = document.querySelectorAll('#actionSheetActions button')[0].innerText.replace(/\n/g, ' — ');
    document.querySelectorAll('#actionSheetActions button')[0].click();
    await new Promise(r => setTimeout(r, 800));
    out.files = payload ? payload.files.length : 0;
    out.hasText = !!(payload && payload.text);

    // A phone that will not.
    navigator.canShare = () => false;
    document.getElementById('shareWorkoutButton').click();
    await new Promise(r => setTimeout(r, 800));
    out.labelWithout = document.querySelectorAll('#actionSheetActions button')[0].innerText.replace(/\n/g, ' — ');
    document.querySelector('[data-sheet-close]').click();

    navigator.canShare = realCanShare;
    navigator.share = realShare;
    return out;
  });

  line('when the phone will take files', shared.labelWithPhotos);
  line('files actually sent', shared.files + (shared.hasText ? ' + the words' : ' with no words'));
  line('when it will not', shared.labelWithout);

  if (shared.files !== 5) errors.push('the session went without its photographs');
  if (!shared.hasText) errors.push('the photographs went without the session');
  if (!/5 photos/.test(shared.labelWithPhotos)) errors.push('the button does not say the photos are going');
  if (!/cannot be attached/.test(shared.labelWithout)) {
    errors.push('a phone that cannot attach photos is not told so before tapping');
  }

  // ---------------------------------------------------------------- 4
  console.log('');
  console.log('WHAT SETTINGS CALLS THINGS');

  const settings = await page.evaluate(async () => {
    // The row only appears once there is something in it, so put something
    // there — otherwise this checks the wording of a row that is not drawn.
    await AmsSync.logExtra({ date: AmsSync.todayKey(), activity: 'walk', what: 'A walk',
      minutes: 30, isTraining: false, notes: '' });
    await new Promise(r => setTimeout(r, 400));

    document.querySelector('.tab[data-tab="settings"]').click();
    await new Promise(r => setTimeout(r, 600));

    // The sheet-layout row lives in the fold, which opens shut every time.
    document.querySelector('[data-settings-fold]').click();
    await new Promise(r => setTimeout(r, 400));

    const groups = [...document.querySelectorAll('#settingsBody .settings-group')];
    const find = (h) => groups.find(g => g.querySelector('h2') && g.querySelector('h2').textContent === h);
    const workbook = find('Workbook');
    const photos = find('Photos');
    const extras = find('Extra activities');

    /*
     * Where the button sits is the point. Five descriptions in Settings were
     * reported as misleading and every one of them was level with a button
     * because the row centred its contents — so the grey line under a title
     * was drawn shoulder to shoulder with the button, and read as its label.
     */
    const rowAlignment = [...document.querySelectorAll('#settingsBody .settings-row')]
      .map((row) => {
        const title = row.querySelector('.settings-row-title');
        const sub = row.querySelector('.settings-row-sub');
        const button = row.querySelector('.btn');
        if (!title || !sub || !button) return null;
        const t = title.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        const u = sub.getBoundingClientRect();
        return {
          text: title.textContent,
          // Positive when the button's middle is nearer the title's middle
          // than the description's, which is the whole fix.
          nearerTitle: Math.abs(b.top + b.height / 2 - (t.top + t.height / 2))
                     < Math.abs(b.top + b.height / 2 - (u.top + u.height / 2))
        };
      }).filter(Boolean);

    return {
      eyebrow: document.querySelector('#settingsScreen .app-eyebrow').textContent,
      extrasRow: extras ? extras.innerText.replace(/\n/g, ' | ') : null,
      photosSubs: photos ? photos.querySelectorAll('.settings-row-sub').length : null,
      // The group's own row, not the ones inside the fold — those are
      // supposed to have descriptions.
      workbookSubs: workbook
        ? !![...workbook.querySelectorAll('.settings-row')]
            .filter(r => !r.closest('.settings-fold'))
            .find(r => r.querySelector('.settings-row-sub'))
        : null,
      sharingLast: (() => {
        const last = [...document.querySelectorAll('#settingsBody .settings-group h2')].pop();
        return last ? last.textContent : null;
      })(),
      sharingRow: [...document.querySelectorAll('#settingsBody .settings-row-title')]
        .map(n => n.textContent).filter(t => /Send/.test(t))[0] || null,
      sheetRow: [...document.querySelectorAll('#settingsBody .settings-row-title')]
        .map(n => n.textContent).find(t => /sheet is read/.test(t)) || null,
      rowAlignment: rowAlignment,
      foldInsideWorkbook: !!(workbook && workbook.querySelector('.settings-fold')),
      foldElsewhere: !!document.querySelector('#settingsBody > .settings-fold'),
      helpDots: document.querySelectorAll('#settingsBody .help-dot').length
    };
  });

  const misaligned = settings.rowAlignment.filter(r => !r.nearerTitle);

  line('the line at the top', settings.eyebrow);
  line('the extras group', (settings.extrasRow || '').slice(0, 80));
  line('the sheet-layout row is called', settings.sheetRow);
  line('the last group on the page', settings.sharingLast + ' — ' + settings.sharingRow);
  line('rows whose button is level with its title', (settings.rowAlignment.length - misaligned.length)
    + ' of ' + settings.rowAlignment.length);
  line('Setup and connection is inside Workbook', settings.foldInsideWorkbook);

  if (/AMS Workout Sync/.test(settings.eyebrow)) errors.push('Settings still announces the name of the app you are in');
  if (!/Everything extra you logged/.test(settings.extrasRow || '')) {
    errors.push('the extras row does not say these are the extra ones');
  }
  if (/Log something else/.test(settings.extrasRow || '')) errors.push('"something else" is back as a heading');

  // He asked for these two to go, not to be reworded again.
  if (settings.photosSubs !== 0) errors.push('the photo count has a description under it again');
  if (settings.workbookSubs) errors.push('the workbook name has a description under it again');

  if (!/sheet is read/.test(settings.sheetRow || '')) {
    errors.push('the sheet-layout row is still titled with the name of the sheet');
  }
  if (settings.sharingLast !== 'Sharing') errors.push('sharing is not the last thing on the page');
  if (!/this app/.test(settings.sharingRow || '')) errors.push('the share row still says "it" rather than what it sends');

  if (misaligned.length) {
    errors.push('a button is level with the description rather than the title on: '
      + misaligned.map(r => r.text).join(', '));
  }
  if (!settings.foldInsideWorkbook) errors.push('Setup and connection is not inside Workbook');
  if (settings.foldElsewhere) errors.push('Setup and connection is still standing on its own as well');
  if (settings.helpDots !== 2) errors.push('the question marks are not beside both button rows');

  // ---------------------------------------------------------------- 4b
  console.log('');
  console.log('THE WHOLE EFFORT SCALE');

  const scale = await page.evaluate(async () => {
    const workout = AmsSync.getState().plan.find(w => w.discipline.id !== 'rest');
    AmsUi.renderPlan();
    await new Promise(r => setTimeout(r, 200));
    [...document.querySelectorAll('#planBody [data-workout]')]
      .find(n => n.dataset.workout === workout.key).click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('openLogButton').click();
    await new Promise(r => setTimeout(r, 700));

    const opener = document.querySelector('[data-rpe-scale]');
    if (!opener) return { error: 'no way to see the whole scale from the effort field' };

    // Opened and closed several times before picking. A listener added to the
    // note each time would fire once per open, which is the bug this catches.
    let events = 0;
    document.getElementById('log-rpe').addEventListener('input', () => { events++; });
    for (let i = 0; i < 4; i++) {
      opener.click();
      await new Promise(r => setTimeout(r, 120));
      document.querySelector('[data-sheet-close]').click();
      await new Promise(r => setTimeout(r, 100));
    }

    opener.click();
    await new Promise(r => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('.rpe-row')];
    const numbers = rows.map(r => r.querySelector('.rpe-row-n').textContent);
    const described = rows.every(r => r.querySelector('.rpe-row-text').textContent.trim().length > 12);
    const unique = new Set(rows.map(r => r.querySelector('.rpe-row-text').textContent)).size;

    rows.find(r => r.dataset.rpePick === '8').click();
    await new Promise(r => setTimeout(r, 300));

    return {
      rows: rows.length,
      numbers: numbers.join(''),
      described: described,
      unique: unique,
      chosen: document.getElementById('log-rpe').value,
      besideTheBox: document.getElementById('log-rpe-note').textContent,
      closed: document.getElementById('actionSheet').hidden,
      inputEvents: events
    };
  });

  if (scale.error) errors.push(scale.error);
  else {
    line('rungs on the scale', scale.rows + ' (' + scale.numbers + ')');
    line('all described, and all differently', scale.described + ', ' + scale.unique + ' distinct');
    line('tapping 8 sets the field to', scale.chosen + ' — ' + scale.besideTheBox);
    line('input events after five opens, one pick', scale.inputEvents);

    if (scale.rows !== 10) errors.push('the scale does not show all ten');
    if (scale.numbers !== '12345678910') errors.push('the scale is not 1 to 10 in order');
    if (!scale.described) errors.push('a rung on the scale has no explanation');
    if (scale.unique !== 10) errors.push('two rungs are described the same way');
    if (scale.chosen !== '8') errors.push('tapping a rung did not choose it');
    if (!scale.closed) errors.push('choosing from the scale left it open');
    if (scale.inputEvents !== 1) errors.push('the scale stacks a listener every time it is opened');
  }

  // ---------------------------------------------------------------- 5
  console.log('');
  console.log('WHAT THE QUESTION MARKS SAY');

  const help = await page.evaluate(async () => {
    const out = [];
    for (const topic of ['workbookButtons', 'photoButtons']) {
      document.querySelector('[data-help="' + topic + '"]').click();
      await new Promise(r => setTimeout(r, 300));
      out.push({
        topic: topic,
        title: document.getElementById('actionSheetTitle').textContent,
        words: document.getElementById('actionSheetNote').innerText.length,
        noButtons: document.getElementById('actionSheetActions').children.length === 0,
        closeSays: document.getElementById('actionSheetCancel').textContent,
        text: document.getElementById('actionSheetNote').innerText
      });
      document.querySelector('[data-sheet-close]').click();
      await new Promise(r => setTimeout(r, 200));
    }
    // And the sheet must go back to asking rather than explaining.
    AmsUi.__openChoice('Pick one', [{ label: 'A', act: () => {} }]);
    await new Promise(r => setTimeout(r, 200));
    const after = {
      noteHidden: document.getElementById('actionSheetNote').hidden,
      cancelSays: document.getElementById('actionSheetCancel').textContent
    };
    document.querySelector('[data-sheet-close]').click();
    return { notes: out, after: after };
  });

  help.notes.forEach(n => line(n.title, n.words + ' characters, Close button: ' + n.closeSays));

  const workbookNote = help.notes.find(n => n.topic === 'workbookButtons');
  const photoNote = help.notes.find(n => n.topic === 'photoButtons');
  if (!/Save a copy/.test(workbookNote.title)) errors.push('the workbook question mark does not name Save a copy');
  if (!/copy, not a move/.test(workbookNote.text)) errors.push('the explanation does not say the workbook is left alone');
  if (!/no undoing it/.test(photoNote.text)) errors.push('Delete all is explained without saying it cannot be undone');
  if (help.notes.some(n => !n.noButtons)) errors.push('an explanation came with choices to make');
  if (help.notes.some(n => n.closeSays !== 'Close')) errors.push('an explanation offers Cancel, which is not what it does');
  if (!help.after.noteHidden) errors.push('the explanation stayed behind when the sheet was next used to ask something');
  if (help.after.cancelSays !== 'Cancel') errors.push('the sheet still says Close when it is asking a question');

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
