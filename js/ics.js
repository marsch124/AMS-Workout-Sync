/*
 * A week of the plan as calendar events.
 *
 * The plan says a session lasts forty minutes. It does not say when — no row
 * in it carries a time of day, and inventing one would put a swim at 07:00 in
 * somebody's calendar on the app's authority rather than on anything real. So
 * these are all-day events: the day is what the plan actually knows, the
 * duration goes in the title where it can be read at a glance, and the whole
 * workout goes in the notes.
 *
 * The format is RFC 5545, which is old and fussy: CRLF line endings, lines
 * folded at 75 octets, and a small set of characters escaped. Getting any of
 * it wrong produces a file that a calendar refuses without saying why.
 */
const AmsIcs = (function () {
    'use strict';

    const PRODID = '-//AMS Workout Sync//Training plan//EN';

    /* Commas, semicolons and backslashes are structural; newlines are written
       as an escape rather than as an actual line break. */
    function escapeText(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\r?\n/g, '\\n');
    }

    /*
     * Folded at 75 octets, not 75 characters. A line of umlauts is twice as
     * long as it looks, and folding by character count would split one down
     * the middle and produce mojibake at the seam.
     */
    function fold(line) {
        const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
        if (!encoder || encoder.encode(line).length <= 75) return line;

        const out = [];
        let current = '';
        let bytes = 0;

        for (const ch of line) {
            const size = encoder.encode(ch).length;
            // Continuation lines start with a space, which counts towards the
            // limit, so they get one octet less of content.
            const limit = out.length ? 74 : 75;
            if (bytes + size > limit) {
                out.push(current);
                current = '';
                bytes = 0;
            }
            current += ch;
            bytes += size;
        }
        if (current) out.push(current);
        return out.join('\r\n ');
    }

    function stamp(date) {
        const iso = date.toISOString();
        return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + 'T'
            + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z';
    }

    function dayStamp(dayKey) {
        return String(dayKey || '').replace(/-/g, '');
    }

    function nextDay(dayKey) {
        const at = Date.parse(dayKey + 'T00:00:00Z');
        if (isNaN(at)) return dayKey;
        return new Date(at + 86400000).toISOString().slice(0, 10);
    }

    /* A stable identifier, so re-importing the same week updates the events a
       calendar already has rather than doubling them. */
    function uidFor(event) {
        const base = (event.key || (event.dayKey + '-' + event.summary))
            .replace(/[^A-Za-z0-9!-]/g, '-')
            .slice(0, 80);
        return base + '@ams-workout-sync';
    }

    /*
     * `events` is a plain list: { key, dayKey, summary, description }.
     * Building the text is kept separate from deciding what goes in it, so the
     * app can decide and this file can stay about the format.
     */
    function build(events, name) {
        const now = stamp(new Date());
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:' + PRODID,
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];

        if (name) {
            lines.push('X-WR-CALNAME:' + escapeText(name));
        }

        events.forEach((event) => {
            if (!event || !event.dayKey) return;
            lines.push('BEGIN:VEVENT');
            lines.push('UID:' + uidFor(event));
            lines.push('DTSTAMP:' + now);
            // An all-day event ends on the following day: DTEND is exclusive,
            // and a calendar given the same date for both draws nothing.
            lines.push('DTSTART;VALUE=DATE:' + dayStamp(event.dayKey));
            lines.push('DTEND;VALUE=DATE:' + dayStamp(nextDay(event.dayKey)));
            lines.push('SUMMARY:' + escapeText(event.summary));
            if (event.description) lines.push('DESCRIPTION:' + escapeText(event.description));
            lines.push('TRANSP:TRANSPARENT');       /* training does not mean busy */
            lines.push('END:VEVENT');
        });

        lines.push('END:VCALENDAR');

        return lines.map(fold).join('\r\n') + '\r\n';
    }

    return {
        build: build,
        escapeText: escapeText,
        fold: fold
    };
})();
