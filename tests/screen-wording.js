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
      eyebrow: (document.querySelector('#settingsScreen .app-eyebrow') || {}).textContent || null,
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

  line('the line above "Settings"', settings.eyebrow === null ? '(none)' : settings.eyebrow);
  line('the extras group', (settings.extrasRow || '').slice(0, 80));
  line('the sheet-layout row is called', settings.sheetRow);
  line('the last group on the page', settings.sharingLast + ' — ' + settings.sharingRow);
  line('rows whose button is level with its title', (settings.rowAlignment.length - misaligned.length)
    + ' of ' + settings.rowAlignment.length);
  line('Setup and connection is inside Workbook', settings.foldInsideWorkbook);

  if (settings.eyebrow !== null) errors.push('Settings has an eyebrow again, and there was nothing relevant to put in it');
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

  const anyRule = await page.evaluate(() =>
    [...document.querySelectorAll('#settingsBody .settings-row, #settingsBody .settings-fold-body')]
      .filter((n) => {
        const st = getComputedStyle(n);
        return parseFloat(st.borderBottomWidth) > 0 || parseFloat(st.borderTopWidth) > 0;
      }).length);
  line('rules drawn between rows', anyRule);
  if (anyRule) errors.push('the settings page still draws lines between its rows');

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
    for (const topic of ['workbook', 'photoButtons']) {
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

  const workbookNote = help.notes.find(n => n.topic === 'workbook');
  const photoNote = help.notes.find(n => n.topic === 'photoButtons');
  if (!/workbook/i.test(workbookNote.title)) errors.push('the workbook question mark does not say what it is about');
  if (!/You are reading/.test(workbookNote.text)) errors.push('the explanation no longer says which file is open');
  if (/Save a copy/.test(workbookNote.text)) errors.push('the explanation still offers a button that was removed');
  if (!/no undoing it/.test(photoNote.text)) errors.push('Delete all is explained without saying it cannot be undone');
  if (help.notes.some(n => !n.noButtons)) errors.push('an explanation came with choices to make');
  if (help.notes.some(n => n.closeSays !== 'Close')) errors.push('an explanation offers Cancel, which is not what it does');
  if (!help.after.noteHidden) errors.push('the explanation stayed behind when the sheet was next used to ask something');
  if (help.after.cancelSays !== 'Cancel') errors.push('the sheet still says Close when it is asking a question');

  // ----------------------------------------------------------------
  console.log('');
  console.log('THE ONE-TAP BUTTON SAYS WHAT PRESSING IT DOES');

  /*
   * "Did it — 40m" says what happened and what it will write, which is the
   * half that matters once you know the button. It never said what pressing it
   * *does*, so the thing it saves you — a whole form — was invisible from
   * outside. The second line says so, in both places the button is drawn: the
   * card on Today and the footer of the session screen. They are built by one
   * function so they cannot drift, and this checks both rather than trusting
   * that.
   */
  const oneTap = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="today"]').click();
    await new Promise(r => setTimeout(r, 700));
    const card = document.querySelector('#todayBody [data-as-planned]');
    const read = (n) => n ? {
      main: (n.querySelector('.btn-stack-main') || {}).textContent || '',
      sub: (n.querySelector('.btn-stack-sub') || {}).textContent || '',
      height: Math.round(n.getBoundingClientRect().height)
    } : null;
    const onCard = read(card);

    // The footer version. An unanswered card on Today carries its own buttons
    // and does not open a screen, so the Plan list is the way in.
    document.querySelector('.tab[data-tab="plan"]').click();
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('.segment[data-range="upcoming"]').click();
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('#planBody .workout-card').click();
    await new Promise(r => setTimeout(r, 700));
    const footer = document.getElementById('asPlannedButton');
    return { onCard: onCard, onSession: footer.hidden ? null : read(footer) };
  });

  [['on the card', oneTap.onCard], ['on the session', oneTap.onSession]].forEach(([where, b]) => {
    if (!b) { errors.push('the one-tap button is missing ' + where); return; }
    line(where, '"' + b.main + '" / "' + b.sub + '" (' + b.height + 'px)');
    if (!/Did it/.test(b.main)) errors.push('the button ' + where + ' no longer says what happened');
    if (!/\dm|\dh/.test(b.main)) {
      errors.push('the button ' + where + ' no longer names the length it will write: ' + b.main);
    }
    if (!/log/i.test(b.sub)) {
      errors.push('the button ' + where + ' does not say that pressing it logs the workout: "' + b.sub + '"');
    }
  });
  if (oneTap.onCard && oneTap.onSession && oneTap.onCard.sub !== oneTap.onSession.sub) {
    errors.push('the two one-tap buttons say different things: "' + oneTap.onCard.sub
      + '" against "' + oneTap.onSession.sub + '"');
  }

  // ----------------------------------------------------------------
  console.log('');
  console.log('THE DAY AND THE MOVE BUTTON SHARE A LINE');

  /*
   * Reported from his phone: "the green is taking more attention, so I often
   * miss the date picker." Full width, the button was the only thing on the
   * screen with any weight and the date above it read as a caption — which
   * ends with a session moved to the day it was already on.
   *
   * Side by side and equally wide, it is one gesture with two steps in the
   * order they happen. Both halves of that are asserted: same line, and
   * neither noticeably bigger than the other.
   */
  const moveRow = await page.evaluate(async () => {
    const back = document.querySelector('#workoutScreen [data-back]');
    if (back) back.click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('#planBody .workout-card').click();
    await new Promise(r => setTimeout(r, 600));
    const move = document.querySelector('#moveButton, [data-move]');
    if (!move) return { error: 'no way through to the move screen' };
    move.click();
    await new Promise(r => setTimeout(r, 700));

    const input = document.getElementById('moveToDate');
    const button = document.getElementById('doMoveButton');
    if (!input || !button) return { error: 'the move screen has no date or no button' };
    const a = input.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    return {
      sameLine: Math.abs(a.bottom - b.bottom) < 8,
      dateFirst: a.left < b.left,
      dateWidth: Math.round(a.width),
      buttonWidth: Math.round(b.width),
      buttonHeight: Math.round(b.height),
      overlap: a.right > b.left + 1
    };
  });

  if (moveRow.error) { errors.push(moveRow.error); }
  else {
    line('date and button on one line', moveRow.sameLine);
    line('widths', moveRow.dateWidth + 'px date, ' + moveRow.buttonWidth + 'px button');
    line('the date comes first', moveRow.dateFirst);

    if (!moveRow.sameLine) {
      errors.push('the date and the move button are not on the same line');
    }
    if (!moveRow.dateFirst) {
      errors.push('the move button comes before the date, which is the wrong way round');
    }
    if (moveRow.overlap) errors.push('the date and the button overlap');
    // Neither may dominate: that is the whole complaint this answers.
    const ratio = moveRow.buttonWidth / moveRow.dateWidth;
    if (ratio < 0.8 || ratio > 1.25) {
      errors.push('the move button is ' + ratio.toFixed(2) + '× the width of the date — they are '
        + 'meant to carry the same weight');
    }
    if (moveRow.buttonHeight < 43) {
      errors.push('the move button is only ' + moveRow.buttonHeight + 'px tall');
    }
  }

  // ----------------------------------------------------------------
  console.log('');
  console.log('THE EXTRAS ADD IS SMALL, AND ON THE RIGHT');

  /*
   * "I'd like the Log an Extra Activity button to be much, much smaller, just
   * on the right side somewhere, maybe a round button as well. It should be
   * very unintrusive because I don't use it that much."
   *
   * It was a full-width button under a two-line paragraph — the loudest thing
   * at the bottom of Today, for the thing he does least. Each half of what he
   * asked for is checked, because a change that only did one of them would
   * look done: small but centred, or on the right but still full width.
   */
  const extras = await page.evaluate(async () => {
    document.querySelector('.tab[data-tab="today"]').click();
    await new Promise(r => setTimeout(r, 700));
    const add = document.querySelector('#todayBody .extras-add');
    const row = document.querySelector('#todayBody .extras-heading');
    if (!add || !row) return { error: 'no extras row on Today' };
    const a = add.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      width: Math.round(a.width),
      height: Math.round(a.height),
      round: getComputedStyle(add).borderRadius,
      gapFromRightEdge: Math.round(r.right - a.right),
      heading: (row.querySelector('h2') || {}).textContent,
      // the shapes it must no longer be
      fullWidthButton: document.querySelectorAll('#todayBody .btn-block[data-extra]').length,
      hintAfterRow: !!(row.nextElementSibling
        && row.nextElementSibling.classList.contains('hint-inline')),
      // and it must still be reachable by a screen reader
      spokenAs: add.getAttribute('aria-label')
    };
  });

  if (extras.error) { errors.push(extras.error); }
  else {
    line('the add is', extras.width + 'x' + extras.height + 'px, radius ' + extras.round);
    line('from the right edge of the row', extras.gapFromRightEdge + 'px');
    line('the heading beside it', '"' + extras.heading + '"');
    line('spoken as', '"' + extras.spokenAs + '"');

    if (extras.width > 40) {
      errors.push('the extras add is ' + extras.width + 'px wide — it was meant to get much smaller');
    }
    if (extras.gapFromRightEdge > 20) {
      errors.push('the extras add is ' + extras.gapFromRightEdge + 'px from the right edge, so it is '
        + 'not on the right side');
    }
    if (extras.fullWidthButton) {
      errors.push('the full-width extras button is still on Today');
    }
    if (extras.hintAfterRow) {
      errors.push('the explanatory paragraph came back under the row — a grey line above a control '
        + 'is what v1.45.0 found he reads as that control\u2019s label');
    }
    /*
     * The label is the heading, not the button, so losing the heading would
     * leave a bare circle nobody can name three weeks later.
     */
    if (!/extra/i.test(extras.heading || '')) {
      errors.push('nothing beside the add says what it adds: ' + extras.heading);
    }
    if (!/extra/i.test(extras.spokenAs || '')) {
      errors.push('the add has no useful spoken label: ' + extras.spokenAs);
    }
  }

  console.log('');
  console.log('errors: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : 'none'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
