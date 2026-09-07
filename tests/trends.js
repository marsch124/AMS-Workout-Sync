/*
 * "Is it working?" — the arithmetic, with no browser anywhere near it.
 *
 * This is the only screen in the app that makes a claim about the person
 * rather than about the plan, which puts a different weight on it. Saying "you
 * are getting fitter" on the strength of three sessions and a warm afternoon
 * would be worse than saying nothing, and it would be believed. So what is
 * tested here is mostly restraint: the conditions under which it refuses to
 * answer, and the size of the band in which it says "about the same".
 *
 * The measure is speed per heartbeat, which is the plainest thing buildable
 * from the three figures actually recorded. It has to move for both of the
 * reasons fitness moves it — faster at the same heart rate, and the same speed
 * at a lower one — and for neither of the reasons it should not.
 *
 *     node tests/trends.js
 */
const AmsStats = require('../js/stats.js');

let failures = 0;
const line = (l, v) => console.log('   ' + String(l).padEnd(50) + v);
function check(label, ok, detail) {
  if (!ok) { failures++; console.log('   FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

/* n sessions of one sport, from `from` km/h to `to` km/h, at `hr` beats. */
function runOf(n, opts) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const speed = (opts.from + (opts.to - opts.from) * t);
    const hrNow = (opts.hr + ((opts.hrTo === undefined ? opts.hr : opts.hrTo) - opts.hr) * t);
    const minutes = opts.minutes || 60;
    rows.push({
      sport: opts.sport || 'run',
      dayKey: day(i * 7),
      minutes: minutes,
      km: speed * minutes / 60,
      hr: hrNow,
      rpe: opts.rpe === undefined ? 4 : opts.rpe
    });
  }
  return rows;
}

const only = (result, sport) => result.sports.find(s => s.sport === (sport || 'run'));

console.log('THE TWO WAYS FITNESS SHOWS');

const faster = only(AmsStats.trends({ rows: runOf(12, { from: 10, to: 11.5, hr: 140 }) }));
line('faster at the same heart rate', (faster.change * 100).toFixed(1) + '% — ' + faster.verdict);
check('faster at the same HR reads as better', faster.verdict === 'better');
check('and the heart rate is reported unchanged',
  Math.round(faster.then.hr) === Math.round(faster.now.hr));

const easier = only(AmsStats.trends({ rows: runOf(12, { from: 11, to: 11, hr: 150, hrTo: 138 }) }));
line('same speed at a lower heart rate', (easier.change * 100).toFixed(1) + '% — ' + easier.verdict);
check('the same speed for fewer beats reads as better', easier.verdict === 'better');
check('and the speed is reported unchanged',
  Math.abs(easier.then.speed - easier.now.speed) < 0.01);

const worse = only(AmsStats.trends({ rows: runOf(12, { from: 11.5, to: 10, hr: 140 }) }));
line('slower at the same heart rate', (worse.change * 100).toFixed(1) + '% — ' + worse.verdict);
check('going backwards is not dressed up', worse.verdict === 'down');

console.log('');
console.log('AND THE BAND WHERE IT SAYS NOTHING HAPPENED');

const noise = only(AmsStats.trends({ rows: runOf(12, { from: 11, to: 11.15, hr: 140 }) }));
line('a 1.4% drift', (noise.change * 100).toFixed(1) + '% — ' + noise.verdict);
check('ordinary noise is not announced as progress', noise.verdict === 'level');

const edge = only(AmsStats.trends({ rows: runOf(12, { from: 11, to: 11.9, hr: 140 }) }));
line('a 4%-ish move', (edge.change * 100).toFixed(1) + '% — ' + edge.verdict);
check('a real move is not buried in the band', edge.verdict === 'better');

console.log('');
console.log('WHEN IT REFUSES TO ANSWER');

const thin = AmsStats.trends({ rows: runOf(7, { from: 10, to: 11, hr: 140 }) });
line('seven sessions', JSON.stringify(only(thin)));
check('seven is not enough to draw a line through', only(thin).enough === false);
check('and it says how many are needed', only(thin).need === 8 && only(thin).have === 7);
check('nothing claims to be answerable', thin.any === false);

const eight = AmsStats.trends({ rows: runOf(8, { from: 10, to: 11, hr: 140 }) });
line('eight sessions', only(eight).enough ? 'answered' : 'still refused');
check('eight is enough', only(eight).enough === true);

console.log('');
console.log('WHAT IT WILL NOT COUNT');

const missing = runOf(12, { from: 10, to: 11.5, hr: 140 });
missing[0].hr = 0;            // no heart rate
missing[1].km = 0;            // no distance
missing[2].minutes = 0;       // no time
missing[3].hr = 35;           // a heart rate nobody trained at
missing[4].hr = 260;          // nor that
const filtered = only(AmsStats.trends({ rows: missing }));
line('five of twelve rows spoiled', filtered.enough ? filtered.sessions + ' counted' : 'refused');
check('rows missing any of the three are dropped', filtered.sessions === 7 || !filtered.enough,
  JSON.stringify(filtered));

const mixed = AmsStats.trends({
  rows: runOf(12, { from: 10, to: 11.5, hr: 140, sport: 'run' })
    .concat(runOf(12, { from: 26, to: 24, hr: 135, sport: 'bike' }))
});
line('a run block and a ride block together',
  mixed.sports.filter(s => s.enough).map(s => s.sport + ' ' + s.verdict).join(', '));
check('the sports are answered separately',
  only(mixed, 'run').verdict === 'better' && only(mixed, 'bike').verdict === 'down');
check('and a ride cannot drag a run about',
  Math.abs(only(mixed, 'run').change - faster.change) < 0.0001);

console.log('');
console.log('EASY SESSIONS ARE PREFERRED, WHERE THERE ARE ENOUGH');

// Ten easy sessions creeping up, plus four hard ones that are much faster.
// The hard ones must not be allowed to make the trend look like progress.
const withHard = runOf(10, { from: 10, to: 10.2, hr: 140, rpe: 4 })
  .concat(runOf(4, { from: 15, to: 15, hr: 175, rpe: 9 }).map((r, i) => {
    r.dayKey = day(70 + i * 7);
    return r;
  }));
const preferred = only(AmsStats.trends({ rows: withHard }));
line('ten easy plus four hard', preferred.sessions + ' counted, easyOnly ' + preferred.easyOnly);
check('the hard ones are left out', preferred.easyOnly === true && preferred.sessions === 10);
check('so a set of intervals is not read as fitness', preferred.verdict === 'level',
  (preferred.change * 100).toFixed(1) + '%');

// With too few easy ones to stand alone, everything is used — and it says so.
const mostlyHard = runOf(3, { from: 10, to: 10, hr: 140, rpe: 4 })
  .concat(runOf(9, { from: 11, to: 12, hr: 150, rpe: 8 }).map((r, i) => {
    r.dayKey = day(30 + i * 7);
    return r;
  }));
const fallback = only(AmsStats.trends({ rows: mostlyHard }));
line('three easy, nine hard', fallback.sessions + ' counted, easyOnly ' + fallback.easyOnly);
check('it falls back to everything rather than refusing', fallback.enough === true);
check('and admits the sessions are of every kind', fallback.easyOnly === false);

console.log('');
console.log('THE SPLIT IS BY COUNT, NOT BY THE CALENDAR');

// Ten sessions close together, then a long winter gap, then two. Splitting on
// the midpoint date would put twelve on one side and nothing on the other.
const gappy = runOf(12, { from: 10, to: 11.5, hr: 140 });
gappy.forEach((r, i) => { r.dayKey = day(i < 10 ? i * 3 : 200 + i * 3); });
const split = only(AmsStats.trends({ rows: gappy }));
line('ten sessions, a gap, then two',
  split.then.sessions + ' against ' + split.now.sessions);
check('both halves have the same number in them',
  split.then.sessions === split.now.sessions && split.then.sessions === 6);

console.log('');
console.log('AND NOTHING AT ALL IS FINE');

const nothing = AmsStats.trends({ rows: [] });
check('no rows produces no claim', nothing.any === false && nothing.sports.length === 0);
const strengthOnly = AmsStats.trends({
  rows: runOf(12, { from: 0, to: 0, hr: 140, sport: 'strength' })
});
check('a sport with no distance is not invented into one',
  strengthOnly.sports.length === 0, JSON.stringify(strengthOnly.sports));

console.log('');
console.log(failures ? 'errors: ' + failures + ' check(s) failed' : 'errors: none');
process.exit(failures ? 1 : 0);
