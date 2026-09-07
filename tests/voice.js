/*
 * Reading a spoken session into form values.
 *
 * No browser here: the parser is pure text in, values out, which means it can
 * be shouted at with a few hundred phrasings in a second rather than driven
 * through a microphone one sentence at a time. That is the whole reason it was
 * written as a separate pure function.
 *
 * What is being defended:
 *
 *   1. **Order does not matter.** He asked for that in as many words — he
 *      cannot remember a fixed order and will not use one. Every case below
 *      that has a label or a unit is also run in reverse and in a shuffled
 *      order, and must give the same answer.
 *   2. **A number that says what it is beats any guess.** "138 bpm" is a heart
 *      rate wherever it lands in the sentence.
 *   3. **Only numbers that say nothing fall back to Garmin's order**, per
 *      sport, because that is the order he reads them off the watch.
 *   4. **Nothing is silently dropped.** A value the workbook has no column for
 *      is reported, not discarded.
 *
 *     node tests/voice.js
 */
const AmsVoice = require('../js/voice.js');

let failures = 0;
const line = (l, v) => console.log('   ' + String(l).padEnd(52) + v);

function check(label, condition, detail) {
  if (!condition) { failures++; console.log('   FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

/* Every ordering of the clauses must give the same answer. */
function shuffles(clauses) {
  const out = [clauses.join(', '), clauses.slice().reverse().join(', ')];
  if (clauses.length > 2) {
    const rotated = clauses.slice(1).concat(clauses.slice(0, 1));
    out.push(rotated.join(' '));
    out.push(clauses.join(' and '));
  }
  return out;
}

function sameEverywhere(name, clauses, sport, expected) {
  const seen = [];
  shuffles(clauses).forEach((text) => {
    const got = AmsVoice.parse(text, { sport: sport }).values;
    // Sorted, because two objects holding the same pairs in a different
    // insertion order are the same answer and JSON.stringify disagrees.
    seen.push(Object.keys(got).sort().map(k => k + '=' + got[k]).join(' '));
    Object.keys(expected).forEach((field) => {
      check(name + ' [' + text + '] ' + field, got[field] === expected[field],
        'wanted ' + expected[field] + ', got ' + got[field]);
    });
  });
  const distinct = new Set(seen);
  check(name + ' — same answer whatever the order', distinct.size === 1,
    [...distinct].join('  vs  '));
  return seen[0];
}

console.log('WHAT HE ACTUALLY SAYS, IN ANY ORDER');

line('swim, the Garmin way, spelled out',
  sameEverywhere('swim', [
    '2400 metres', '45 minutes', '1:52 per hundred', 'heart rate 138', '620 calories'
  ], 'swim', {
    actualDistance: '2400', actualDuration: '45', avgPace: '1:52', avgHr: '138', calories: '620'
  }));

line('outdoor run, mixed units and labels',
  sameEverywhere('run', [
    '8.2 km', '45 minutes', '138 bpm', '5:30 per km'
  ], 'run', {
    actualDistance: '8.2', actualDuration: '45', avgHr: '138', avgPace: '5:30'
  }));

line('bike, speed rather than pace',
  sameEverywhere('bike', [
    '42.5 km', '1 hour 20', '32 km/h', 'average heart rate 132'
  ], 'bike', {
    actualDistance: '42.5', actualDuration: '80', avgSpeed: '32', avgHr: '132'
  }));

line('treadmill, the indoor order',
  sameEverywhere('run', [
    '6 km', 'average heart rate 141', 'pace 5:45', 'time 35 minutes'
  ], 'run', {
    actualDistance: '6', avgHr: '141', avgPace: '5:45', actualDuration: '35'
  }));

console.log('');
console.log('SPOKEN NUMBERS, NOT DIGITS');

[
  ['forty five minutes', 'run', 'actualDuration', '45'],
  ['heart rate one thirty eight', 'run', 'avgHr', '138'],
  ['a hundred and thirty eight bpm', 'run', 'avgHr', '138'],
  ['one hundred and forty two beats per minute', 'bike', 'avgHr', '142'],
  ['eight point two kilometres', 'run', 'actualDistance', '8.2'],
  ['twenty two minutes', 'run', 'actualDuration', '22'],
  ['two hundred and ten watts', 'bike', 'avgPower', '210'],
  ['felt like a seven', 'run', 'rpe', '7']
].forEach(([text, sport, field, want]) => {
  const got = AmsVoice.parse(text, { sport: sport }).values[field];
  line('"' + text + '"', field + ' = ' + got);
  check('spoken: ' + text, got === want, 'wanted ' + want + ', got ' + got);
});

console.log('');
console.log('A NUMBER THAT SAYS WHAT IT IS BEATS THE ORDER');

// Garmin's swim order starts with distance; saying "heart rate" first must not
// put 138 into the distance field.
const labelWins = AmsVoice.parse('heart rate 138, 2400 metres, 45 minutes', { sport: 'swim' }).values;
line('heart rate said first, on a swim', JSON.stringify(labelWins));
check('the labelled number is not taken for the distance', labelWins.avgHr === '138');
check('the unlabelled ones still land in order', labelWins.actualDistance === '2400'
  && labelWins.actualDuration === '45');

console.log('');
console.log('BARE NUMBERS FALL BACK TO THE WATCH ORDER');

const bareSwim = AmsVoice.parse('2400 45 620', { sport: 'swim' }).values;
line('swim: "2400 45 620"', JSON.stringify(bareSwim));
// Distance, then time — and 620 is not a pace anybody has ever swum, so it
// falls down the order to the next field that could hold it.
check('swim bare numbers go distance, time, then somewhere plausible',
  bareSwim.actualDistance === '2400' && bareSwim.actualDuration === '45'
  && bareSwim.avgPace === undefined && bareSwim.calories === '620');

const bareBike = AmsVoice.parse('42 80', { sport: 'bike' }).values;
line('bike: "42 80"', JSON.stringify(bareBike));
check('bike bare order is distance then time',
  bareBike.actualDistance === '42' && bareBike.actualDuration === '80');

// A run is where Garmin's own orders disagree between treadmill and outdoors,
// so only the two they agree on are guessed at. A third bare number must be
// left alone rather than invented into a field.
const bareRun = AmsVoice.parse('8 45 138', { sport: 'run' });
line('run: "8 45 138"', JSON.stringify(bareRun.values));
check('run guesses only the two orders agree on',
  bareRun.values.actualDistance === '8' && bareRun.values.actualDuration === '45'
  && bareRun.values.avgHr === undefined);
check('and says it could not place the third',
  bareRun.heard.some(h => h.field === null && h.said === '138'));

console.log('');
console.log('THE AWKWARD ONES');

const cases = [
  ['1:15', 'run', { actualDuration: '75' }, 'a bare clock reading is the duration'],
  ['45 minutes at 5:30', 'run', { actualDuration: '45', avgPace: '5:30' }, 'a second clock reading is the pace'],
  ['1:02:30', 'bike', { actualDuration: '63' }, 'hours, minutes and seconds'],
  ['2.4 k', 'swim', { actualDistance: '2.4' }, '"k" for kilometres'],
  ['2400 m', 'swim', { actualDistance: '2400' }, 'metres stay metres on a swim'],
  ['2400 metres', 'bike', { actualDistance: '2.4' }, 'metres become km where km are counted'],
  ['32 kilometres an hour', 'bike', { avgSpeed: '32' }, 'an hour makes it a speed, not a distance'],
  ['8 km, 32 km/h', 'bike', { actualDistance: '8', avgSpeed: '32' }, 'both in one breath'],
  ['effort 8', 'run', { rpe: '8' }, 'effort'],
  ['620 kcal', 'run', { calories: '620' }, 'kcal'],
  ['max heart rate 171', 'run', { maxHr: '171' }, 'max beats average'],
  ['1 h 20', 'bike', { actualDuration: '80' }, 'an hour and twenty'],
  ['90 minutes', 'bike', { actualDuration: '90' }, 'plain minutes'],
  ['1.5 hours', 'bike', { actualDuration: '90' }, 'decimal hours']
];

cases.forEach(([text, sport, want, why]) => {
  const got = AmsVoice.parse(text, { sport: sport }).values;
  line('"' + text + '" — ' + why, JSON.stringify(got));
  Object.keys(want).forEach((field) => {
    check(why + ' [' + text + ']', got[field] === want[field],
      field + ': wanted ' + want[field] + ', got ' + got[field]);
  });
});

console.log('');
console.log('THINGS THAT MEAN A NUMBER WITHOUT BEING ONE');

[
  ['half an hour', 'run', { actualDuration: '30' }],
  ['an hour', 'bike', { actualDuration: '60' }],
  ['an hour and a half', 'bike', { actualDuration: '90' }],
  ['a quarter of an hour', 'run', { actualDuration: '15' }],
  ['42 km in an hour and a half', 'bike', { actualDistance: '42', actualDuration: '90' }],
  ['felt easy', 'run', { rpe: '3' }],
  ['felt steady', 'run', { rpe: '4' }],
  ['felt hard', 'run', { rpe: '7' }],
  ['felt very hard', 'run', { rpe: '8' }],
  ['felt flat out', 'run', { rpe: '10' }],
  ['seven out of ten', 'run', { rpe: '7' }],
  ['45 minutes and it felt easy', 'run', { actualDuration: '45', rpe: '3' }],
  ['300 metres of climbing', 'bike', { elevation: '300' }],
  ['8 km, 300 metres of climbing, 1 hour 20', 'bike',
    { actualDistance: '8', elevation: '300', actualDuration: '80' }],
  ['pulse 142', 'run', { avgHr: '142' }],
  ['rpe of 6', 'run', { rpe: '6' }],
  ['88 rpm', 'bike', { cadence: '88' }]
].forEach(([text, sport, want]) => {
  const got = AmsVoice.parse(text, { sport: sport }).values;
  line('"' + text + '"', JSON.stringify(got));
  Object.keys(want).forEach((field) => {
    check('phrase: ' + text, got[field] === want[field],
      field + ': wanted ' + want[field] + ', got ' + got[field]);
  });
  // "seven out of ten" must not leave the ten behind looking for a home.
  check('phrase leaves nothing stray: ' + text,
    Object.keys(got).length === Object.keys(want).length,
    'got ' + JSON.stringify(got));
});

// The one that caught itself: "an hour" becomes sixty minutes, and must not
// do so inside "kilometres an hour".
console.log('');
console.log('AND THE RULES DO NOT EAT EACH OTHER');
[
  ['32 kilometres an hour', 'bike', { avgSpeed: '32' }],
  ['32 km per hour', 'bike', { avgSpeed: '32' }]
].forEach(([text, sport, want]) => {
  const got = AmsVoice.parse(text, { sport: sport }).values;
  line('"' + text + '"', JSON.stringify(got));
  Object.keys(want).forEach((field) => {
    check('no rule eaten: ' + text, got[field] === want[field],
      field + ': wanted ' + want[field] + ', got ' + got[field]);
  });
});

console.log('');
console.log('THE VOCABULARY IT PUBLISHES IS THE ONE IT USES');

const vocab = AmsVoice.vocabulary();
line('groups', vocab.map(f => f.name).join(', '));
line('words in all', vocab.reduce((n, f) => n + f.units.length + f.labels.length, 0));
check('every group has words', vocab.every(f => f.units.length + f.labels.length > 0));
check('every group has an example', vocab.every(f => f.examples.length > 0));

// Every published example must actually parse into the field it is filed
// under — a reference full of phrasings that do not work is worse than none.
vocab.forEach((field) => {
  field.examples.forEach((example) => {
    const sport = field.id === 'avgSpeed' ? 'bike' : field.id === 'avgPace' ? 'run' : 'run';
    const got = AmsVoice.parse(example, { sport: sport }).values;
    check('the published example "' + example + '" gives ' + field.id,
      got[field.id] !== undefined, JSON.stringify(got));
  });
});

console.log('');
console.log('NOTHING IS DROPPED IN SILENCE');

const limited = AmsVoice.parse('45 minutes, 620 calories, 138 bpm', {
  sport: 'run',
  fields: ['actualDuration', 'avgHr']       // this sheet has no calories column
});
line('a sheet with no calories column', JSON.stringify(limited.values));
line('reported as unwritable', limited.unwritable.join(', '));
check('the writable ones still arrive',
  limited.values.actualDuration === '45' && limited.values.avgHr === '138');
check('calories did not sneak in', limited.values.calories === undefined);
check('and it says calories had nowhere to go', limited.unwritable.indexOf('calories') !== -1);

console.log('');
console.log('AND IT NEVER INVENTS ANYTHING');

const empty = AmsVoice.parse('', { sport: 'run' });
check('silence produces nothing', Object.keys(empty.values).length === 0);

const waffle = AmsVoice.parse('it was quite hard going into the wind', { sport: 'run' });
line('"it was quite hard going into the wind"', JSON.stringify(waffle.values));
check('words with no numbers produce nothing', Object.keys(waffle.values).length === 0);

const twice = AmsVoice.parse('45 minutes, 50 minutes', { sport: 'run' }).values;
line('two durations in one sentence', JSON.stringify(twice));
check('the first one wins rather than the last', twice.actualDuration === '45');

console.log('');
console.log(failures ? 'errors: ' + failures + ' check(s) failed' : 'errors: none');
process.exit(failures ? 1 : 0);
