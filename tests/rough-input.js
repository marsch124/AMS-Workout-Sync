/*
 * The new modules, fed rubbish.
 *
 * Seven releases landed in a day, and three of them added pure functions that
 * sit between a person and a workbook: the spoken-session parser, the fitness
 * trend, and the twelve-week load. Their happy paths are well covered. This
 * covers the rest of the world.
 *
 * Two rules, and they are the same two for all three:
 *
 *   1. **Never throw.** These run inside a render. A parser that raises on an
 *      odd sentence does not produce a wrong number, it produces a blank
 *      screen, and a blank screen after a two-hour ride is the moment somebody
 *      stops trusting the app.
 *   2. **Never invent.** Out comes a finite number that was in the input, or
 *      nothing comes out. No NaN, no Infinity, no undefined dressed as a
 *      value — those are the things that reach a cell and sit there looking
 *      like data.
 *
 *     node tests/rough-input.js
 */
const AmsVoice = require('../js/voice.js');
const AmsStats = require('../js/stats.js');

let failures = 0;
let checks = 0;
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);
function check(label, ok, detail) {
  checks++;
  if (!ok) { failures++; console.log('   FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

/* Every number that comes out has to be a real one. */
function sane(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return isFinite(value);
  if (typeof value === 'string') {
    if (value === '') return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return isFinite(parseFloat(value));
    if (/^\d+:\d{2}(:\d{2})?$/.test(value)) return true;   // a clock reading
    return false;                                          // anything else is not a value
  }
  return false;
}

console.log('THE SPOKEN-SESSION PARSER, GIVEN ANYTHING AT ALL');

const nonsense = [
  '', ' ', null, undefined, 0, 123, {}, [],
  'NaN', 'Infinity', '-Infinity', 'null', 'undefined',
  '.', '..', '...', ':', '::', ':::', '-', '--', '/', '//',
  '0', '000000', '-5 km', '-45 minutes', '1e9 km', '1E400 bpm',
  '99999999999999999999 km', '0.000000001 km', '1/0 minutes',
  ':::30 minutes:::', '45::30', '1:2:3:4:5', '::bpm',
  'km km km km', 'bpm bpm bpm', 'per per per',
  'heart rate heart rate 138 heart rate',
  'minutes minutes 45 minutes minutes',
  'a hundred hundred hundred',
  'point point point', 'one point point two',
  'felt felt felt hard hard',
  'out of ten out of ten',
  '🏊 2400 metres 🚴 45 minutes',
  'Sjön var kall, 2400 meter på 45 minuter',
  'zzzzz'.repeat(500),
  '9 '.repeat(400),
  'km '.repeat(400),
  '1:52 '.repeat(200)
];

nonsense.forEach((input) => {
  let result;
  try {
    result = AmsVoice.parse(input, { sport: 'run' });
  } catch (err) {
    check('parse did not throw on ' + JSON.stringify(String(input)).slice(0, 40), false, err.message);
    return;
  }
  const label = JSON.stringify(String(input)).slice(0, 44);
  check('shape survives ' + label,
    result && result.values && Array.isArray(result.heard) && Array.isArray(result.unwritable));
  Object.keys(result.values || {}).forEach((field) => {
    check('a real value from ' + label,
      sane(result.values[field]), field + ' = ' + JSON.stringify(result.values[field]));
  });
});
line('phrases thrown at it', nonsense.length);

// A negative or absurd figure must not reach a field at all.
['-5 km, -45 minutes, -138 bpm', '0 km 0 minutes 0 bpm'].forEach((text) => {
  const got = AmsVoice.parse(text, { sport: 'run' }).values;
  line('"' + text + '"', JSON.stringify(got));
  Object.keys(got).forEach((f) => {
    check('nothing negative or zero is offered as a value from "' + text + '"',
      parseFloat(got[f]) > 0, f + ' = ' + got[f]);
  });
});

// And every sport, so one of them is not quietly missing from a table.
['swim', 'bike', 'run', 'strength', 'mobility', 'brick', 'race', 'other', 'rest', ''].forEach((sport) => {
  try {
    const got = AmsVoice.parse('8 km, 45 minutes, 138 bpm', { sport: sport });
    check('sport "' + sport + '" parses', !!got.values.actualDuration);
  } catch (err) {
    check('sport "' + sport + '" parses', false, err.message);
  }
});

console.log('');
console.log('THE FITNESS TREND, GIVEN BROKEN ROWS');

const brokenRows = [
  { sport: 'run', dayKey: '2026-01-01', minutes: NaN, km: 9, hr: 140, rpe: 4 },
  { sport: 'run', dayKey: '2026-01-08', minutes: 50, km: Infinity, hr: 140, rpe: 4 },
  { sport: 'run', dayKey: '2026-01-15', minutes: 50, km: 9, hr: -140, rpe: 4 },
  { sport: 'run', dayKey: null, minutes: 50, km: 9, hr: 140, rpe: 4 },
  { sport: null, dayKey: '2026-01-22', minutes: 50, km: 9, hr: 140, rpe: 4 },
  { sport: 'run', dayKey: '2026-01-29', minutes: 0, km: 0, hr: 0, rpe: 0 },
  { sport: 'run' },
  {},
  null,
  undefined
];

let trendResult;
try {
  trendResult = AmsStats.trends({ rows: brokenRows.filter(Boolean) });
  check('trends survives broken rows', true);
} catch (err) {
  check('trends survives broken rows', false, err.message);
}
if (trendResult) {
  line('what came back', JSON.stringify(trendResult.sports.map(s => s.sport + ':' + s.enough)));
  check('nothing was judged on broken rows', trendResult.any === false);
  trendResult.sports.forEach((s) => {
    check('no NaN in the ' + s.sport + ' entry',
      !JSON.stringify(s).includes('null') || s.enough === false, JSON.stringify(s));
  });
}

// Missing input altogether.
[{}, { rows: null }, { rows: undefined }, { rows: [] }].forEach((input, i) => {
  try {
    const got = AmsStats.trends(input);
    check('trends copes with input shape ' + i, got && Array.isArray(got.sports));
  } catch (err) {
    check('trends copes with input shape ' + i, false, err.message);
  }
});

// A run of identical sessions: no change at all must be "level", not a
// division by zero dressed as an improvement.
const flat = [];
for (let i = 0; i < 12; i++) {
  flat.push({ sport: 'run', dayKey: '2026-02-' + String(i + 1).padStart(2, '0'),
              minutes: 50, km: 9, hr: 140, rpe: 4 });
}
const flatOut = AmsStats.trends({ rows: flat }).sports[0];
line('twelve identical sessions', (flatOut.change * 100).toFixed(2) + '% — ' + flatOut.verdict);
check('no change is no change', flatOut.verdict === 'level' && isFinite(flatOut.change));
check('and the figures are finite',
  isFinite(flatOut.then.speed) && isFinite(flatOut.now.hr) && isFinite(flatOut.then.paceSeconds));

console.log('');
console.log('THE TWELVE-WEEK LOAD, GIVEN BROKEN ROWS');

const day = (n) => new Date(Date.UTC(2026, 0, 5 + n)).toISOString().slice(0, 10);
const badLoad = [
  { sport: 'run', dayKey: day(1), planned: NaN, actual: 3600 },
  { sport: 'bike', dayKey: day(2), planned: 3600, actual: Infinity },
  { sport: 'swim', dayKey: 'not-a-date', planned: 3600, actual: 3600 },
  { sport: 'run', dayKey: null, planned: 3600, actual: 3600 },
  { sport: 'run', dayKey: day(3) },
  {}
];

let loadOut;
try {
  loadOut = AmsStats.load({ rows: badLoad, weekStarts: [day(0), day(7)], endExclusive: day(14) });
  check('load survives broken rows', true);
} catch (err) {
  check('load survives broken rows', false, err.message);
}
if (loadOut) {
  line('totals', 'planned ' + loadOut.planned + ', actual ' + loadOut.actual);
  check('the totals are real numbers',
    isFinite(loadOut.planned) && isFinite(loadOut.actual),
    JSON.stringify({ planned: loadOut.planned, actual: loadOut.actual }));
  loadOut.weeks.forEach((w) => {
    check('week ' + w.start + ' holds real numbers',
      isFinite(w.planned) && isFinite(w.actual) && isFinite(w.sessions));
  });
  loadOut.sports.forEach((s) => {
    check(s.sport + ' shares are between nothing and everything',
      isFinite(s.shareActual) && s.shareActual >= 0 && s.shareActual <= 1
      && isFinite(s.sharePlanned) && s.sharePlanned >= 0 && s.sharePlanned <= 1,
      JSON.stringify(s));
  });
}

[{}, { rows: [] }, { weekStarts: [] }, { rows: null, weekStarts: null }].forEach((input, i) => {
  try {
    const got = AmsStats.load(input);
    check('load copes with input shape ' + i,
      got && Array.isArray(got.weeks) && Array.isArray(got.sports)
      && isFinite(got.planned) && isFinite(got.actual));
  } catch (err) {
    check('load copes with input shape ' + i, false, err.message);
  }
});

// Week starts handed over out of order — the caller's job, but not a reason
// to produce nonsense.
try {
  const jumbled = AmsStats.load({
    weekStarts: [day(7), day(0), day(14)],
    endExclusive: day(21),
    rows: [{ sport: 'run', dayKey: day(3), planned: 3600, actual: 3600 }]
  });
  check('jumbled week starts do not lose the hours',
    isFinite(jumbled.planned) && jumbled.planned === 3600, JSON.stringify(jumbled.weeks));
} catch (err) {
  check('jumbled week starts do not throw', false, err.message);
}

console.log('');
line('checks made', checks);
console.log(failures ? 'errors: ' + failures + ' check(s) failed' : 'errors: none');
process.exit(failures ? 1 : 0);
