/*
 * Saying a session out loud, and getting it into the form.
 *
 * Martin dictates almost everything he writes, and typing four numbers into a
 * phone after a ride is the one bit of friction left in this app. So: say it,
 * and the fields fill in.
 *
 * Two rules decide the whole design.
 *
 * **Order does not matter.** He asked for that directly — he cannot remember a
 * fixed order and does not want to. So nothing here is positional if it can be
 * helped: every number is identified by the words around it. "138 bpm" and
 * "heart rate one thirty-eight" and "average heart rate of 138" are the same
 * statement, and so is any of them said first, last or in the middle.
 *
 * **It fills the form; it never saves.** Speech recognition mishears, and a
 * mishearing that wrote itself into a training plan would be the worst thing
 * in this app. Everything below produces values for a form he then looks at
 * and presses Save on himself. That is also why this can afford to guess: a
 * wrong guess is visible and one tap from corrected, rather than silent.
 *
 * The fallback for a number with nothing around it to identify it is the order
 * Garmin Connect shows things in, which is what he reads them off. Per sport,
 * because Garmin's own order differs by sport. It only ever applies to numbers
 * that said nothing about themselves.
 *
 * The parser is pure — text in, values out — so it can be tested against a few
 * hundred phrasings without a browser anywhere near it. `tests/voice.js` does
 * exactly that.
 */
const AmsVoice = (function () {
    'use strict';

    /*
     * The order Garmin Connect puts them in, which is the order he reads them
     * off the watch. Used only for numbers that carried no unit and no label.
     * Runs are deliberately short: Garmin shows a treadmill run and an outdoor
     * run in different orders, and guessing which one this was would be
     * inventing information. The first two agree, so only those are used.
     */
    const SPOKEN_ORDER = {
        swim: ['actualDistance', 'actualDuration', 'avgPace', 'avgHr', 'calories'],
        bike: ['actualDistance', 'actualDuration', 'avgSpeed', 'avgHr', 'calories'],
        run: ['actualDistance', 'actualDuration'],
        strength: ['actualDuration', 'avgHr'],
        mobility: ['actualDuration'],
        brick: ['actualDistance', 'actualDuration', 'avgHr'],
        race: ['actualDistance', 'actualDuration', 'avgHr'],
        other: ['actualDuration', 'actualDistance', 'avgHr']
    };

    /*
     * Words that name a field outright, wherever they sit relative to the
     * number. Longest first, because "max heart rate" must win over "heart
     * rate" and "average pace" must not be read as two separate claims.
     */
    const LABELS = [
        ['max heart rate', 'maxHr'], ['maximum heart rate', 'maxHr'], ['max hr', 'maxHr'],
        ['peak heart rate', 'maxHr'], ['max pulse', 'maxHr'],

        ['average heart rate', 'avgHr'], ['avg heart rate', 'avgHr'], ['mean heart rate', 'avgHr'],
        ['heart rate', 'avgHr'], ['heartrate', 'avgHr'], ['avg hr', 'avgHr'], ['average hr', 'avgHr'],
        ['pulse', 'avgHr'],

        ['average pace', 'avgPace'], ['avg pace', 'avgPace'], ['pace', 'avgPace'],
        ['average speed', 'avgSpeed'], ['avg speed', 'avgSpeed'], ['speed', 'avgSpeed'],
        ['average power', 'avgPower'], ['avg power', 'avgPower'], ['power', 'avgPower'],
        ['average cadence', 'cadence'], ['cadence', 'cadence'],

        ['total calories', 'calories'], ['calories', 'calories'], ['kilocalories', 'calories'],
        ['total time', 'actualDuration'], ['moving time', 'actualDuration'],
        ['elapsed time', 'actualDuration'], ['duration', 'actualDuration'], ['time', 'actualDuration'],
        ['total distance', 'actualDistance'], ['distance', 'actualDistance'],

        ['elevation gain', 'elevation'], ['elevation', 'elevation'], ['climbing', 'elevation'],
        ['ascent', 'elevation'], ['climb', 'elevation'],

        ['perceived effort', 'rpe'], ['felt like a', 'rpe'], ['felt like', 'rpe'],
        ['effort', 'rpe'], ['rpe', 'rpe']
    ];

    /*
     * Units, which identify a number on their own. A unit is stronger evidence
     * than a label because it cannot be a stray word: nobody says "bpm" about
     * anything but a heart rate.
     */
    const UNITS = [
        // Pace and speed first: "per kilometre" contains "kilometre".
        ['per hundred metres', 'avgPace'], ['per hundred meters', 'avgPace'],
        ['per hundred', 'avgPace'], ['per 100', 'avgPace'],
        ['min/km', 'avgPace'], ['minutes per kilometre', 'avgPace'], ['minutes per kilometer', 'avgPace'],
        ['minutes per km', 'avgPace'], ['per kilometre', 'avgPace'], ['per kilometer', 'avgPace'],
        ['per km', 'avgPace'],

        ['kilometres an hour', 'avgSpeed'], ['kilometers an hour', 'avgSpeed'],
        ['kilometres per hour', 'avgSpeed'], ['kilometers per hour', 'avgSpeed'],
        ['km an hour', 'avgSpeed'], ['km per hour', 'avgSpeed'],
        ['km/h', 'avgSpeed'], ['kmh', 'avgSpeed'], ['kph', 'avgSpeed'],

        ['beats per minute', 'avgHr'], ['bpm', 'avgHr'], ['beats', 'avgHr'],
        ['watts', 'avgPower'], ['watt', 'avgPower'],
        ['kcal', 'calories'], ['calories', 'calories'], ['cal', 'calories'],
        ['rpm', 'cadence'], ['spm', 'cadence'], ['strokes per minute', 'cadence'],
        ['steps per minute', 'cadence'],

        ['kilometres', 'actualDistance'], ['kilometers', 'actualDistance'],
        ['kilometre', 'actualDistance'], ['kilometer', 'actualDistance'],
        ['km', 'actualDistance'], ['ks', 'actualDistance'], ['k', 'actualDistance'],
        ['metres', 'actualDistance'], ['meters', 'actualDistance'],
        ['metre', 'actualDistance'], ['meter', 'actualDistance'], ['m', 'actualDistance'],

        ['hours', 'actualDuration'], ['hour', 'actualDuration'],
        ['minutes', 'actualDuration'], ['minute', 'actualDuration'],
        ['mins', 'actualDuration'], ['min', 'actualDuration'],
        ['hrs', 'actualDuration'], ['h', 'actualDuration']
    ];

    /* Spoken numbers, for the recognisers that spell them out. */
    const SMALL = {
        zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
        eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
        fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
    };
    const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
        seventy: 70, eighty: 80, ninety: 90 };

    /*
     * "one hundred and thirty eight" and "a hundred thirty eight" both mean
     * 138; so does "one thirty eight" in the way people read a heart rate off
     * a watch. The last of those is only taken as a hundreds figure when the
     * leading number is 1 or 2 and the rest lands under a hundred, which is
     * the range heart rates and powers actually live in.
     */
    function wordValue(word) {
        const key = String(word || '').replace(/[^a-z-]/g, '');
        if (!key) return null;
        if (SMALL[key] !== undefined) return SMALL[key];
        if (TENS[key] !== undefined) return TENS[key];
        if (key.indexOf('-') !== -1) {
            const [a, b] = key.split('-');
            if (TENS[a] !== undefined && SMALL[b] !== undefined) return TENS[a] + SMALL[b];
        }
        return null;
    }

    /*
     * One spoken number, starting at `i`. Only word forms are read — a figure
     * that arrived as digits is left exactly as it is, because joining digits
     * that merely sat next to each other is how "2400 45" becomes 2445.
     */
    function readNumber(words, i) {
        let total = null;
        let j = i;

        if (/^(a|an)$/.test(words[j] || '') && /^hundreds?$/.test(words[j + 1] || '')) {
            total = 100; j += 2;
        } else {
            const n = wordValue(words[j]);
            if (n === null) return null;
            if (/^hundreds?$/.test(words[j + 1] || '')) { total = n * 100; j += 2; }
            else { total = n; j += 1; }
        }

        if (/^and$/.test(words[j] || '') && total >= 100) j += 1;

        const t = wordValue(words[j]);
        if (t !== null) {
            if (t >= 20 && t < 100) {
                let sub = t;
                let k = j + 1;
                const u = wordValue(words[k]);
                if (u !== null && u < 10) { sub += u; k += 1; }
                if (total >= 100) { total += sub; j = k; }
                else if (total <= 2) { total = total * 100 + sub; j = k; }   // "one thirty eight"
            } else if (t < 20 && total >= 100) {
                total += t; j += 1;
            } else if (t < 10 && total >= 20 && total < 100 && total % 10 === 0) {
                total += t; j += 1;                                          // "forty five"
            }
        }

        // "eight point two"
        if (/^point$/.test(words[j] || '')) {
            let decimals = '';
            let k = j + 1;
            while (k < words.length) {
                const d = wordValue(words[k]);
                if (d === null || d > 9) break;
                decimals += String(d);
                k += 1;
            }
            if (decimals) { total = parseFloat(String(total) + '.' + decimals); j = k; }
        }

        return { text: String(total), next: j };
    }

    function wordsToDigits(text) {
        const words = text.split(/\s+/);
        const out = [];
        let i = 0;
        while (i < words.length) {
            const run = readNumber(words, i);
            if (run) { out.push(run.text); i = run.next; }
            else { out.push(words[i]); i += 1; }
        }
        return out.join(' ');
    }

    function normalise(text) {
        let out = String(text || '').toLowerCase();
        out = out.replace(/[，,](?=\s)/g, ' ');          // a comma used as punctuation
        out = out.replace(/(\d)[,](\d)/g, '$1.$2');      // a comma used as a decimal point
        out = out.replace(/[^\w\s:./-]/g, ' ');
        out = out.replace(/\bhrs?\b/g, ' hours ');
        out = out.replace(/\s+/g, ' ').trim();
        return wordsToDigits(out);
    }

    /* Every number in the text, with where it sits and what shape it has. */
    function numbers(text) {
        const found = [];
        const re = /(\d+):(\d+)(?::(\d+))?|(\d+(?:\.\d+)?)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[1] !== undefined) {
                const a = parseInt(m[1], 10);
                const b = parseInt(m[2], 10);
                const c = m[3] === undefined ? null : parseInt(m[3], 10);
                found.push({
                    kind: 'clock',
                    parts: c === null ? [a, b] : [a, b, c],
                    text: m[0], at: m.index, end: m.index + m[0].length
                });
            } else {
                found.push({
                    kind: 'plain', value: parseFloat(m[4]),
                    text: m[0], at: m.index, end: m.index + m[0].length
                });
            }
        }
        return found;
    }

    /* The words immediately after a number, and immediately before it. */
    function after(text, token) { return text.slice(token.end, token.end + 26).trim(); }
    function before(text, token) { return text.slice(Math.max(0, token.at - 30), token.at).trim(); }

    function matchAt(list, phrase, atStart) {
        for (const [word, field] of list) {
            const re = atStart
                ? new RegExp('^' + word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\b')
                : new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\b\\s*$');
            if (re.test(phrase)) return field;
        }
        return null;
    }

    /*
     * "one hour twenty", "1 h 20", "1 hour 20 minutes" — one duration said as
     * two numbers. Recognised here so the twenty is not taken for something
     * else entirely.
     */
    function hoursAndMinutes(text, token, all) {
        if (token.kind !== 'plain') return null;
        const tail = after(text, token);
        if (!/^(hours?|h)\b/.test(tail)) return null;

        const next = all.find((t) => t.at > token.end && t.at < token.end + 22 && t.kind === 'plain');
        const minutes = next && next.value < 60 ? next.value : 0;
        return { minutes: token.value * 60 + minutes, consumed: minutes ? next : null };
    }

    /*
     * A clock reading is a duration or a pace, and which it is depends on what
     * else was said. Anything with an hours part is a duration. Otherwise: a
     * pace if the sport measures one and the figure is small enough to be one,
     * a duration if there is not one yet, a pace if there is.
     */
    function clockMeaning(token, taken, sport) {
        if (token.parts.length === 3) return 'actualDuration';
        const [a, b] = token.parts;
        const paceLike = a < 15 || (sport === 'swim' && a < 5);
        if (!paceLike) return 'actualDuration';
        if (taken.actualDuration === undefined) return 'actualDuration';
        return 'avgPace';
    }

    /*
     * As a duration, "1:15" is an hour and a quarter and "45:30" is
     * forty-five and a half minutes — the same two digits either side of a
     * colon meaning hours or minutes depending on how big the first one is.
     * Nobody trains for five hours and calls it 5:30, and nobody says 45:30
     * meaning forty-five hours.
     */
    function clockToMinutes(token) {
        const p = token.parts;
        if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
        return p[0] <= 9 ? p[0] * 60 + p[1] : p[0] + p[1] / 60;
    }

    function clockToText(token) {
        const p = token.parts;
        const pad = (n) => (n < 10 ? '0' + n : String(n));
        return p.length === 3 ? p[0] + ':' + pad(p[1]) + ':' + pad(p[2]) : p[0] + ':' + pad(p[1]);
    }

    /*
     * What a number means, from the words around it.
     *
     * A unit sitting right after it is the strongest evidence there is. A
     * label just before it is next. A label a little further back — "average
     * heart rate of 138" — comes after that. Nothing at all leaves it for the
     * spoken-order fallback.
     */
    function meaningOf(text, token) {
        const tail = after(text, token);
        const head = before(text, token);

        const unit = matchAt(UNITS, tail, true);
        if (unit) {
            // "8 km an hour" is a speed, not a distance: keep reading.
            const longer = matchAt(UNITS, tail.slice(0, 24), true);
            return { field: longer || unit, from: 'unit' };
        }

        const labelBefore = matchAt(LABELS, head, false);
        if (labelBefore) return { field: labelBefore, from: 'label' };

        /*
         * A label *after* a number only belongs to it when nothing else is
         * queueing up behind that label. People do say "5:30 pace" — but in
         * "45 heart rate 138" the label plainly belongs to the 138, and
         * reading it backwards would put the duration in the heart rate.
         */
        const labelAfter = matchAt(LABELS, tail, true);
        if (labelAfter && !/\d/.test(tail.slice(0, 20))) {
            return { field: labelAfter, from: 'label' };
        }

        return { field: null, from: null };
    }

    /*
     * What each field can plausibly hold, used only when placing a number that
     * said nothing about itself. Reading three figures off a watch and having
     * the third land in "pace" as 620 is worse than leaving it out: the ranges
     * let an implausible value fall through to the next field in the order,
     * which is how "2400, 45, 620" on a swim finds its way to calories.
     *
     * Distances run to ten thousand because a swim is counted in metres.
     */
    const PLAUSIBLE = {
        actualDistance: [0.1, 10000],
        actualDuration: [1, 1440],
        avgPace: [0.5, 30],
        avgSpeed: [3, 80],
        avgHr: [60, 220],
        maxHr: [80, 230],
        avgPower: [40, 600],
        calories: [30, 8000],
        cadence: [30, 220],
        elevation: [1, 9000],
        rpe: [1, 10]
    };

    function plausible(field, value) {
        const range = PLAUSIBLE[field];
        if (!range) return true;
        return value >= range[0] && value <= range[1];
    }

    /*
     * Metres for a swim are the distance in metres; the form takes what the
     * sport is measured in, so 2400 metres stays 2400 on a swim and becomes
     * 2.4 on anything that counts kilometres.
     */
    function distanceFor(value, text, token, sport) {
        const tail = after(text, token);
        const inMetres = /^(m|metres|meters|metre|meter)\b/.test(tail);
        if (!inMetres) return value;
        if (sport === 'swim') return value;
        return Math.round(value / 10) / 100;
    }

    /*
     * Reads a spoken session into form values.
     *
     * `fields` is the set of field ids the workbook actually has columns for.
     * Anything understood but unwritable is reported rather than dropped: a
     * number said out loud and silently discarded is exactly the kind of thing
     * that makes a person stop trusting a feature.
     */
    function parse(text, options) {
        const opts = options || {};
        const sport = opts.sport || 'other';
        const allowed = opts.fields || null;

        const said = normalise(text);
        const tokens = numbers(said);
        const taken = {};
        const heard = [];
        const spare = [];
        const skip = new Set();

        // First pass: everything that says what it is.
        for (const token of tokens) {
            if (skip.has(token)) continue;

            const hm = hoursAndMinutes(said, token, tokens);
            if (hm) {
                if (hm.consumed) skip.add(hm.consumed);
                if (taken.actualDuration === undefined) {
                    taken.actualDuration = String(Math.round(hm.minutes));
                    heard.push({ field: 'actualDuration', value: taken.actualDuration, said: token.text, from: 'unit' });
                }
                continue;
            }

            if (token.kind === 'clock') {
                const explicit = meaningOf(said, token);
                const field = explicit.field || clockMeaning(token, taken, sport);
                if (taken[field] !== undefined) continue;
                taken[field] = field === 'actualDuration'
                    ? String(Math.round(clockToMinutes(token)))
                    : clockToText(token);
                heard.push({ field: field, value: taken[field], said: token.text,
                             from: explicit.field ? explicit.from : 'shape' });
                continue;
            }

            const meaning = meaningOf(said, token);
            if (!meaning.field) { spare.push(token); continue; }
            if (taken[meaning.field] !== undefined) continue;

            let value = token.value;
            if (meaning.field === 'actualDistance') value = distanceFor(value, said, token, sport);
            if (meaning.field === 'actualDuration' && /^(hours?|h)\b/.test(after(said, token))) {
                value = value * 60;
            }
            taken[meaning.field] = String(value);
            heard.push({ field: meaning.field, value: taken[meaning.field], said: token.text, from: meaning.from });
        }

        // Second pass: the numbers that said nothing about themselves, in the
        // order the watch shows them for this sport.
        const order = (SPOKEN_ORDER[sport] || SPOKEN_ORDER.other)
            .filter((field) => taken[field] === undefined);
        for (const token of spare) {
            // Down the order until something could actually hold this number.
            let field = null;
            while (order.length) {
                const candidate = order.shift();
                if (plausible(candidate, token.value)) { field = candidate; break; }
            }
            if (!field) {
                heard.push({ field: null, value: String(token.value), said: token.text, from: 'spare' });
                continue;
            }
            let value = token.value;
            if (field === 'actualDistance') value = distanceFor(value, said, token, sport);
            taken[field] = String(value);
            heard.push({ field: field, value: taken[field], said: token.text, from: 'order' });
        }

        // Anything the sheet cannot hold is reported, not dropped.
        const values = {};
        const unwritable = [];
        Object.keys(taken).forEach((field) => {
            if (allowed && allowed.indexOf(field) === -1) { unwritable.push(field); return; }
            values[field] = taken[field];
        });

        return { values: values, heard: heard, unwritable: unwritable, normalised: said };
    }

    /* ---------- listening ---------- */

    /*
     * Two ways in, because the reliable one is not the impressive one.
     *
     * The impressive one is the browser's own recogniser, which listens and
     * transcribes without a keyboard. It is not present everywhere, and a PWA
     * launched from the home screen is exactly where it is least dependable.
     *
     * The reliable one is a text box: the keyboard's own microphone types into
     * it, and the same parser reads what comes out. That works on any phone,
     * so it is what the feature is actually built on — the recogniser, where
     * it exists, only saves opening the keyboard.
     */
    function supported() {
        return typeof window !== 'undefined'
            && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    function listen(handlers) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return null;

        const recognition = new Recognition();
        recognition.lang = navigator.language || 'en-GB';
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            let text = '';
            let final = false;
            for (let i = 0; i < event.results.length; i++) {
                text += event.results[i][0].transcript;
                if (event.results[i].isFinal) final = true;
            }
            if (handlers.onText) handlers.onText(text.trim(), final);
        };
        recognition.onerror = (event) => {
            if (handlers.onError) handlers.onError(event.error || 'unknown');
        };
        recognition.onend = () => { if (handlers.onEnd) handlers.onEnd(); };

        try {
            recognition.start();
        } catch (err) {
            if (handlers.onError) handlers.onError('start-failed');
            return null;
        }
        return recognition;
    }

    return {
        parse: parse,
        supported: supported,
        listen: listen,
        SPOKEN_ORDER: SPOKEN_ORDER,
        __normalise: normalise
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AmsVoice;
