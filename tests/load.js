/*
 * Where the hours went — the arithmetic, in plain node.
 *
 * Two questions live here: how each week came out against what it asked for,
 * and how the hours divide between the sports. Both are hours rather than
 * counts, which is what makes them a different question from "which sport runs
 * behind" further down that screen. A twenty-minute swim kept and a two-hour
 * ride skipped are one apiece there and nothing like each other here.
 *
 * The bug this exists to prevent has already happened once: bucketing by "the
 * last week beginning on or before this day" is true of a session next March
 * as much as of one this Thursday, so the whole rest of an eleven-month plan
 * fell into the current week and twelve weeks reported three hundred hours.
 * The window has an end for that reason and it is tested first.
 *
 *     node tests/load.js
 */
const AmsStats = require('../js/stats.js');

let failures = 0;
const line = (l, v) => console.log('   ' + String(l).padEnd(46) + v);
function check(label, ok, detail) {
  if (!ok) { failures++; console.log('   FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

/* Mondays from 5 January 2026, which is one. */
const day = (n) => new Date(Date.UTC(2026, 0, 5 + n)).toISOString().slice(0, 10);
const weeks = (n) => Array.from({ length: n }, (_, i) => day(i * 7));
const hours = (h) => h * 3600;

console.log('THE WINDOW HAS TWO ENDS');

const spanning = AmsStats.load({
  weekStarts: weeks(4),
  endExclusive: day(28),
  rows: [
    { sport: 'run', dayKey: day(-3), planned: hours(9), actual: hours(9) },   // before it
    { sport: 'run', dayKey: day(1), planned: hours(1), actual: hours(1) },
    { sport: 'bike', dayKey: day(22), planned: hours(2), actual: hours(2) },
    { sport: 'run', dayKey: day(200), planned: hours(99), actual: 0 }         // long after it
  ]
});
line('four weeks, with rows either side', AmsStats ? spanning.planned / 3600 + 'h planned' : '');
line('per week', spanning.weeks.map(w => w.planned / 3600 + '/' + w.actual / 3600).join(' '));
check('a session before the window is left out', spanning.planned === hours(3),
  spanning.planned / 3600 + 'h');
check('and a session long after it does not land in the last week',
  spanning.weeks[3].planned === hours(2), spanning.weeks[3].planned / 3600 + 'h');
check('every week is present even when empty', spanning.weeks.length === 4);

console.log('');
console.log('A WEEK IS WHAT FELL IN IT');

const bucketed = AmsStats.load({
  weekStarts: weeks(3),
  endExclusive: day(21),
  rows: [
    { sport: 'run', dayKey: day(0), planned: hours(1), actual: hours(1) },     // Monday
    { sport: 'run', dayKey: day(6), planned: hours(1), actual: 0 },            // Sunday
    { sport: 'bike', dayKey: day(7), planned: hours(3), actual: hours(2) }     // next Monday
  ]
});
line('two on week one, one on week two',
  bucketed.weeks.map(w => w.start + ':' + w.planned / 3600 + 'h').join(' '));
check('Sunday belongs to the week it ends', bucketed.weeks[0].planned === hours(2));
check('and Monday starts the next one', bucketed.weeks[1].planned === hours(3));
check('sessions logged are counted', bucketed.weeks[0].sessions === 1);

console.log('');
console.log('AN UNANSWERED WEEK LOOKS EMPTY, NOT FULL');

const unanswered = AmsStats.load({
  weekStarts: weeks(2),
  endExclusive: day(14),
  rows: [
    { sport: 'run', dayKey: day(1), planned: hours(2), actual: 0 },
    { sport: 'bike', dayKey: day(8), planned: hours(3), actual: hours(3) }
  ]
});
line('week one planned but never logged',
  unanswered.weeks[0].planned / 3600 + 'h asked, ' + unanswered.weeks[0].actual / 3600 + 'h done');
check('nothing done is nothing done', unanswered.weeks[0].actual === 0);
check('and the total only counts what was done', unanswered.actual === hours(3));

console.log('');
console.log('THE MIX IS OF HOURS, AND OF BOTH KINDS OF SHARE');

const mix = AmsStats.load({
  weekStarts: weeks(2),
  endExclusive: day(14),
  rows: [
    // Five short swims kept, one long ride skipped: obedient by count,
    // lopsided by hours, and this is the screen that has to show the second.
    { sport: 'swim', dayKey: day(0), planned: hours(0.5), actual: hours(0.5) },
    { sport: 'swim', dayKey: day(1), planned: hours(0.5), actual: hours(0.5) },
    { sport: 'swim', dayKey: day(2), planned: hours(0.5), actual: hours(0.5) },
    { sport: 'swim', dayKey: day(3), planned: hours(0.5), actual: hours(0.5) },
    { sport: 'bike', dayKey: day(5), planned: hours(6), actual: 0 },
    { sport: 'bike', dayKey: day(8), planned: hours(2), actual: hours(2) }
  ]
});
mix.sports.forEach(s => line(s.sport,
  (s.actual / 3600) + 'h — ' + Math.round(s.shareActual * 100) + '% done, '
  + Math.round(s.sharePlanned * 100) + '% asked for'));

const swim = mix.sports.find(s => s.sport === 'swim');
const bike = mix.sports.find(s => s.sport === 'bike');
check('the biggest share of hours leads', mix.sports[0].sport === 'bike', mix.sports[0].sport);
check('what was done and what was asked for are kept apart',
  Math.round(swim.shareActual * 100) === 50 && Math.round(swim.sharePlanned * 100) === 20,
  JSON.stringify({ did: swim.shareActual, asked: swim.sharePlanned }));
check('so a drift is visible at all', Math.abs(bike.shareActual - bike.sharePlanned) > 0.25);

console.log('');
console.log('AND IT SURVIVES AN EMPTY PLAN');

const nothing = AmsStats.load({ weekStarts: [], rows: [] });
check('no weeks asked for, nothing returned',
  nothing.weeks.length === 0 && nothing.sports.length === 0 && nothing.planned === 0);

const noRows = AmsStats.load({ weekStarts: weeks(4), endExclusive: day(28), rows: [] });
line('four weeks, no sessions', noRows.weeks.length + ' weeks, ' + noRows.sports.length + ' sports');
check('the weeks are still there to draw', noRows.weeks.length === 4);
check('and no sport is invented', noRows.sports.length === 0);

const noPlan = AmsStats.load({
  weekStarts: weeks(2), endExclusive: day(14),
  rows: [{ sport: 'run', dayKey: day(1), planned: 0, actual: hours(1) }]
});
line('something done that was never planned',
  noPlan.actual / 3600 + 'h done of ' + noPlan.planned / 3600 + 'h');
check('it is counted rather than divided by zero',
  noPlan.actual === hours(1) && noPlan.sports[0].shareActual === 1
  && noPlan.sports[0].sharePlanned === 0);

console.log('');
console.log(failures ? 'errors: ' + failures + ' check(s) failed' : 'errors: none');
process.exit(failures ? 1 : 0);
