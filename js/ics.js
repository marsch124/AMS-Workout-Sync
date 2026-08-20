/*
 * A week of the plan as calendar events.
 *
 * A session has a day and a length; the workbook has no column for the hour.
 * The hour therefore comes from the app's settings rather than from the plan —
 * an early start, and each session as long as it is planned to be.
 *
 * The times are written as local time with no zone attached, which iCalendar
 * calls a floating time. Six in the morning then means six in the morning
 * wherever the phone happens to be, which is the right answer for training:
 * a swim booked at 06:00 in Sweden should not become 04:00 in a calendar
 * carried to another country.
 *
 * A rest day stays an all-day event. It has no hour and no length, and giving
 * it one would be inventing something.
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

    /*
     * A local time with no zone marker: "20260909T060000", not "…Z". The date
     * arithmetic is done in UTC purely so that a session running past midnight
     * rolls the day over correctly; the Z is then deliberately not written.
     */
    function localStamp(dayKey, secondsFromMidnight) {
        const base = Date.parse(String(dayKey) + 'T00:00:00Z');
        if (isNaN(base)) return dayStamp(dayKey) + 'T000000';
        const at = new Date(base + (secondsFromMidnight || 0) * 1000).toISOString();
        return at.slice(0, 4) + at.slice(5, 7) + at.slice(8, 10)
            + 'T' + at.slice(11, 13) + at.slice(14, 16) + at.slice(17, 19);
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
            const timed = event.durationSeconds > 0;

            lines.push('BEGIN:VEVENT');
            lines.push('UID:' + uidFor(event));
            lines.push('DTSTAMP:' + now);

            if (timed) {
                const start = event.startSeconds || 0;
                lines.push('DTSTART:' + localStamp(event.dayKey, start));
                lines.push('DTEND:' + localStamp(event.dayKey, start + event.durationSeconds));
                // An hour set aside for training is an hour taken, and a shared
                // calendar should be able to say so.
                lines.push('TRANSP:OPAQUE');
            } else {
                // An all-day event ends on the following day: DTEND is
                // exclusive, and a calendar given the same date for both
                // draws nothing.
                lines.push('DTSTART;VALUE=DATE:' + dayStamp(event.dayKey));
                lines.push('DTEND;VALUE=DATE:' + dayStamp(nextDay(event.dayKey)));
                lines.push('TRANSP:TRANSPARENT');
            }

            lines.push('SUMMARY:' + escapeText(event.summary));
            if (event.description) lines.push('DESCRIPTION:' + escapeText(event.description));

            /*
             * No VALARM, on purpose. An event with no alarm block is an event
             * with no reminder; a phone that pinged at 05:45 for every session
             * of a 48-week plan would be turned off inside a week.
             */
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
