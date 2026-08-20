/*
 * Working out what your spreadsheet means.
 *
 * The app has never seen your workbook, so it guesses: it looks for the row
 * that reads like a header, matches each heading against a list of things it
 * might be called, and works out whether your sections (warm-up, intervals,
 * cool-down, technique) live in columns across a row or in rows beneath the
 * workout. The guess is then shown to you on the Sheet setup screen to correct,
 * and once corrected it is remembered and never guessed again.
 *
 * Headings are matched in English and German, because "Datum / Sportart /
 * Aufwärmen" is at least as likely as "Date / Discipline / Warm-up".
 */
const AmsMapping = (function () {
    'use strict';

    /*
     * Bumped whenever detection improves enough that a mapping worked out by
     * the previous version is worth discarding. Without this, the very first
     * guess a phone ever made is kept for ever and none of the later fixes
     * ever reach it.
     */
    const MAPPING_VERSION = 2;

    /*
     * The fields the app understands. `group` decides where a field appears on
     * the setup screen; `write: true` marks the ones the app is allowed to put
     * your logged numbers into.
     */
    const FIELDS = [
        // --- what is planned ---
        { id: 'date', label: 'Date', group: 'plan', required: true,
          synonyms: ['date', 'datum', 'day', 'tag', 'when', 'workout date', 'trainingstag'] },
        // Sits next to the date and repeats it in words. Worth knowing about only
        // so that a rescheduled session does not end up dated Thursday and
        // labelled "Wed".
        // Shown as the heading on Today: which block of the plan you are in is
        // the one piece of orientation nothing else on the screen carries.
        { id: 'phase', label: 'Phase or block', group: 'plan',
          synonyms: ['phase', 'block', 'period', 'mesocycle', 'trainingsphase', 'zyklus',
                     'makrozyklus', 'stage'] },
        { id: 'weekday', label: 'Weekday', group: 'plan',
          synonyms: ['day', 'weekday', 'tag', 'wochentag', 'week day'] },
        { id: 'discipline', label: 'Discipline', group: 'plan', required: true,
          synonyms: ['discipline', 'sport', 'sportart', 'activity', 'aktivitat', 'type', 'art',
                     'workout type', 'trainingsart', 'disziplin'] },
        { id: 'title', label: 'Session name', group: 'plan',
          synonyms: ['session', 'workout', 'title', 'name', 'einheit', 'training', 'session name',
                     'übung', 'ubung', 'beschreibung kurz'] },
        { id: 'plannedDuration', label: 'Planned duration', group: 'plan',
          synonyms: ['planned duration', 'plan duration', 'duration plan', 'target duration',
                     'soll dauer', 'geplante dauer', 'dauer plan', 'planzeit', 'target time',
                     'duration', 'dauer', 'zeit', 'time'] },
        { id: 'plannedDistance', label: 'Planned distance', group: 'plan',
          synonyms: ['planned distance', 'plan distance', 'target distance', 'soll distanz',
                     'geplante distanz', 'distance', 'distanz', 'strecke', 'km', 'meter'] },
        { id: 'description', label: 'Description', group: 'plan',
          // Nothing as generic as "plan" here: it would swallow "Delta vs plan"
          // and any other column that merely mentions the word.
          synonyms: ['description', 'details', 'detail', 'beschreibung', 'inhalt', 'content',
                     'ubung', 'vorgabe', 'aufgabe', 'programm', 'purpose', 'zweck', 'focus'] },
        { id: 'plannedIntensity', label: 'Planned intensity', group: 'plan',
          synonyms: ['intensity', 'intensitat', 'zone', 'target zone', 'zielzone',
                     'belastung', 'target hr', 'ziel puls', 'target', 'ziel', 'pace target'] },

        // --- how the session breaks down ---
        { id: 'warmup', label: 'Warm-up', group: 'section',
          synonyms: ['warm up', 'warmup', 'warm-up', 'aufwarmen', 'aufwarmung', 'einlaufen',
                     'einschwimmen', 'einrollen', 'warming up'] },
        { id: 'intervals', label: 'Intervals / main set', group: 'section',
          synonyms: ['intervals', 'interval', 'intervalle', 'main set', 'mainset', 'main',
                     'hauptteil', 'hauptsatz', 'set', 'sets', 'belastung', 'kernsatz', 'body'] },
        { id: 'cooldown', label: 'Cool-down', group: 'section',
          synonyms: ['cool down', 'cooldown', 'cool-down', 'abwarmen', 'auslaufen',
                     'ausschwimmen', 'ausrollen', 'abkuhlen'] },
        { id: 'technique', label: 'Technique', group: 'section',
          synonyms: ['technique', 'technik', 'drills', 'drill', 'form', 'technikubungen',
                     'skills', 'koordination'] },
        // Deliberately narrow: "Phase" and "Block" name a stretch of the *plan*
        // (Base 1, Build 2), not a section of a single session, and matching
        // them would wrongly put the whole sheet into one-row-per-section mode.
        { id: 'sectionLabel', label: 'Section (one row each)', group: 'section',
          synonyms: ['section', 'abschnitt', 'teil', 'part'] },

        // --- what the app writes back ---
        // `unit` labels the spreadsheet column, not the input box — durations are
        // typed freehand ("45min", "1:15") and converted to whatever the sheet uses.
        { id: 'actualDuration', label: 'Duration', group: 'result', write: true, kind: 'duration',
          unit: 'hours', synonyms: ['actual duration', 'duration actual', 'ist dauer', 'dauer ist',
                     'real duration', 'tatsachliche dauer', 'actual time', 'ist zeit', 'gesamtzeit',
                     'moving time', 'elapsed time',
                     // Plans commonly name the unit rather than the quantity:
                     // "Actual (min)" folds to "actual min".
                     'actual min', 'actual mins', 'actual minutes', 'actual h', 'actual hours',
                     'actual hrs', 'ist min', 'ist minuten'] },
        { id: 'actualDistance', label: 'Distance', group: 'result', write: true, kind: 'number',
          unit: 'km', synonyms: ['actual distance', 'ist distanz', 'distanz ist', 'gelaufen',
                     'real distance', 'tatsachliche distanz', 'actual km'] },
        { id: 'avgHr', label: 'Average heart rate', group: 'result', write: true, kind: 'number',
          unit: 'bpm', synonyms: ['avg hr', 'average hr', 'avg heart rate', 'average heart rate',
                     'hr', 'heart rate', 'puls', 'herzfrequenz', 'durchschnittspuls', 'hf',
                     'mittlere hf', 'ø puls'] },
        { id: 'maxHr', label: 'Max heart rate', group: 'result', write: true, kind: 'number',
          unit: 'bpm', synonyms: ['max hr', 'maximum hr', 'max heart rate', 'maxpuls', 'max puls',
                     'maximalpuls', 'hf max', 'max hf'] },
        { id: 'avgPace', label: 'Pace', group: 'result', write: true, kind: 'text',
          unit: 'min/km', synonyms: ['pace', 'avg pace', 'average pace', 'tempo', 'schnitt',
                     'min/km', 'pace /100m', 'pace per km'] },
        { id: 'avgSpeed', label: 'Speed', group: 'result', write: true, kind: 'number',
          unit: 'km/h', synonyms: ['speed', 'avg speed', 'average speed', 'geschwindigkeit',
                     'km/h', 'schnitt kmh', 'ø geschwindigkeit'] },
        { id: 'avgPower', label: 'Power', group: 'result', write: true, kind: 'number',
          unit: 'watt', synonyms: ['power', 'avg power', 'average power', 'watt', 'watts',
                     'leistung', 'np', 'normalized power'] },
        { id: 'cadence', label: 'Cadence', group: 'result', write: true, kind: 'number',
          unit: 'rpm / spm', synonyms: ['cadence', 'kadenz', 'trittfrequenz', 'schrittfrequenz',
                     'rpm', 'spm'] },
        { id: 'elevation', label: 'Elevation gain', group: 'result', write: true, kind: 'number',
          unit: 'm', synonyms: ['elevation', 'elevation gain', 'ascent', 'hohenmeter', 'hm',
                     'anstieg', 'climb'] },
        { id: 'calories', label: 'Calories', group: 'result', write: true, kind: 'number',
          unit: 'kcal', synonyms: ['calories', 'kalorien', 'kcal', 'energy', 'energie'] },
        { id: 'rpe', label: 'Perceived effort (RPE)', group: 'result', write: true, kind: 'number',
          unit: '1-10', synonyms: ['rpe', 'perceived effort', 'effort', 'anstrengung', 'borg',
                     'empfinden', 'gefuhl', 'feeling'] },
        { id: 'notes', label: 'Notes', group: 'result', write: true, kind: 'text',
          synonyms: ['notes', 'note', 'notizen', 'notiz', 'comment', 'comments', 'kommentar',
                     'bemerkung', 'bemerkungen', 'remarks'] },
        { id: 'done', label: 'Completed', group: 'result', write: true, kind: 'text',
          synonyms: ['done', 'completed', 'complete', 'erledigt', 'fertig', 'status', 'abgehakt',
                     'absolviert', 'ok'] },
        { id: 'completedAt', label: 'Logged on', group: 'result', write: true, kind: 'date',
          synonyms: ['logged', 'logged on', 'completed on', 'completed date', 'erfasst',
                     'eingetragen', 'log date'] }
    ];

    const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

    const SECTION_FIELDS = ['warmup', 'intervals', 'cooldown', 'technique'];
    const RESULT_FIELDS = FIELDS.filter((f) => f.write).map((f) => f.id);

    /* Fold a heading down to something comparable: lower case, umlauts and
       accents flattened, punctuation dropped, whitespace collapsed. */
    function normalise(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9/]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    /* How well a heading matches one field. Exact beats contained, and a longer
       matched phrase beats a shorter one — so "Planned duration" lands on the
       planned field rather than on the bare "duration" of the actual field. */
    function scoreHeading(heading, field) {
        const h = normalise(heading);
        if (!h) return 0;
        let best = 0;
        for (const synonym of field.synonyms) {
            const s = normalise(synonym);
            if (!s) continue;
            if (h === s) {
                best = Math.max(best, 1000 + s.length * 10);
            } else if (h.startsWith(s + ' ') || h.endsWith(' ' + s)) {
                best = Math.max(best, 400 + s.length * 10);
            } else if (h.indexOf(s) !== -1) {
                best = Math.max(best, 200 + s.length * 10);
            }
        }
        return best;
    }

    /* Read a row as a list of { col, text } for the cells that hold text. */
    function readRow(sheet, rowNum) {
        const row = sheet.rows.get(rowNum);
        if (!row) return [];
        const out = [];
        for (const [col, cell] of row) {
            const text = String(cell.text || '').trim();
            if (text) out.push({ col, text });
        }
        return out.sort((a, b) => a.col - b.col);
    }

    /*
     * A row is header-like when several of its cells match known headings and
     * none of them is a date or a bare number. Returns a score plus the field
     * assignment that produced it.
     */
    function scoreHeaderRow(sheet, rowNum) {
        const cells = readRow(sheet, rowNum);
        if (cells.length < 2) return null;

        const row = sheet.rows.get(rowNum);
        for (const [, cell] of row) {
            if (cell.date) return null;   // a row with a real date in it is data
        }

        /*
         * Assign headings to fields by best score overall, rather than letting
         * each heading claim its own favourite and lose.
         *
         * Consider a sheet with both "Intensity" and "Effort": both match the
         * planned-intensity field, "Intensity" more strongly. Claiming per
         * heading meant "Effort" lost that contest and was then dropped
         * altogether — even though it was the obvious match for RPE, which
         * nothing else wanted. Scoring every pairing and taking them in
         * descending order lets it fall through to its next-best field.
         */
        const pairs = [];
        for (const cell of cells) {
            for (const field of FIELDS) {
                const score = scoreHeading(cell.text, field);
                if (score > 0) pairs.push({ col: cell.col, fieldId: field.id, score });
            }
        }
        pairs.sort((a, b) => b.score - a.score);

        const claims = new Map();
        const takenColumns = new Set();
        let total = 0;

        for (const pair of pairs) {
            if (claims.has(pair.fieldId) || takenColumns.has(pair.col)) continue;
            claims.set(pair.fieldId, { col: pair.col, score: pair.score });
            takenColumns.add(pair.col);
            total += pair.score;
        }

        if (!claims.size) return null;
        // A header row is only credible if it names at least a date or a discipline.
        if (!claims.has('date') && !claims.has('discipline')) total = Math.floor(total / 4);

        return { rowNum, total, claims, headings: cells };
    }

    /* A short signature of a header row, used to spot sibling sheets (one tab
       per week, say) that share the same layout. */
    function signatureOf(sheet, headerRow) {
        return readRow(sheet, headerRow).map((c) => normalise(c.text)).join('|');
    }

    /*
     * A heading alone is not enough to believe a column really holds section
     * names — plenty of plans have a column of free text with a section-ish
     * title. Check the values: at least a few of them should actually read as
     * "warm-up", "main set", "cool-down" or "technique".
     */
    function looksLikeSectionColumn(sheet, col, firstDataRow) {
        if (!col) return false;
        const sectionSynonyms = [];
        for (const id of SECTION_FIELDS) {
            for (const synonym of FIELD_BY_ID.get(id).synonyms) sectionSynonyms.push(normalise(synonym));
        }

        let seen = 0;
        let matched = 0;
        const last = Math.min(sheet.maxRow, firstDataRow + 120);
        for (let r = firstDataRow; r <= last; r++) {
            const text = normalise(sheet.textAt(r, col));
            if (!text) continue;
            seen++;
            if (sectionSynonyms.some((s) => s && (text === s || text.indexOf(s) !== -1))) matched++;
        }
        return seen >= 3 && matched >= Math.max(3, seen * 0.4);
    }

    /*
     * Work out whether the sections live across columns or down rows, and how
     * far the data extends.
     */
    function detectMode(claims) {
        if (claims.has('sectionLabel')) return 'section-rows';
        if (SECTION_FIELDS.some((id) => claims.has(id))) return 'section-columns';
        return 'simple';
    }

    function findLastDataRow(sheet, firstDataRow, dateCol) {
        let last = firstDataRow - 1;
        let blanks = 0;
        for (let r = firstDataRow; r <= sheet.maxRow + 5; r++) {
            const row = sheet.rows.get(r);
            const hasAnything = row && Array.from(row.values()).some((c) => String(c.text || '').trim() !== '');
            const hasDate = dateCol && row && row.get(dateCol) && String(row.get(dateCol).text || '').trim() !== '';
            if (hasAnything && (hasDate || !dateCol)) {
                last = r;
                blanks = 0;
            } else if (hasAnything) {
                blanks = 0;      // a continuation row (no date of its own)
                last = r;
            } else {
                blanks++;
                if (blanks >= 12) break;
            }
        }
        return last;
    }

    /*
     * Look at every sheet and return the best guess, or null if nothing in the
     * workbook looks like a training plan.
     */
    async function autoDetect(workbook) {
        let best = null;

        for (const meta of workbook.sheets) {
            if (meta.hidden) continue;
            let sheet;
            try {
                sheet = await workbook.readSheet(meta.name);
            } catch (err) {
                continue;
            }
            const limit = Math.min(sheet.maxRow, 40);
            for (let r = 1; r <= limit; r++) {
                const scored = scoreHeaderRow(sheet, r);
                if (!scored) continue;
                if (!best || scored.total > best.scored.total) {
                    best = { sheetName: meta.name, sheet, scored };
                }
            }
        }

        if (!best) return null;

        const { sheetName, sheet, scored } = best;
        const columns = {};
        for (const [fieldId, claim] of scored.claims) columns[fieldId] = claim.col;

        const headerRow = scored.rowNum;
        const firstDataRow = headerRow + 1;

        // Drop a "section" column whose contents do not bear the heading out.
        if (columns.sectionLabel && !looksLikeSectionColumn(sheet, columns.sectionLabel, firstDataRow)) {
            delete columns.sectionLabel;
            scored.claims.delete('sectionLabel');
        }

        const mode = detectMode(scored.claims);

        // Other tabs with the same headings are part of the same plan.
        const signature = signatureOf(sheet, headerRow);
        const sheets = [sheetName];
        for (const meta of workbook.sheets) {
            if (meta.name === sheetName || meta.hidden) continue;
            try {
                const other = await workbook.readSheet(meta.name);
                if (signatureOf(other, headerRow) === signature) sheets.push(meta.name);
            } catch (err) { /* unreadable sheet — skip */ }
        }

        return {
            version: MAPPING_VERSION,
            sheets,
            headerRow,
            firstDataRow,
            lastDataRow: findLastDataRow(sheet, firstDataRow, columns.date),
            mode,
            sectionColumn: columns.sectionLabel || null,
            columns,
            confidence: scored.total,
            detected: true
        };
    }

    /* Headings as they actually appear, for the setup screen's column list. */
    function headingsFor(sheet, mapping) {
        const out = [];
        const width = Math.max(sheet.maxCol, 1);
        const headerCells = new Map(readRow(sheet, mapping.headerRow).map((c) => [c.col, c.text]));
        for (let col = 1; col <= width; col++) {
            out.push({
                col,
                letter: AmsXlsx.indexToCol(col),
                heading: headerCells.get(col) || '',
                sample: sampleValue(sheet, mapping, col)
            });
        }
        return out;
    }

    /* First non-empty value under a column, shown as a hint on the setup screen. */
    function sampleValue(sheet, mapping, col) {
        const last = Math.min(mapping.lastDataRow || sheet.maxRow, mapping.firstDataRow + 40);
        for (let r = mapping.firstDataRow; r <= last; r++) {
            const cell = sheet.cell(r, col);
            if (cell && String(cell.text || '').trim()) {
                const text = String(cell.text).trim();
                return text.length > 44 ? text.slice(0, 43) + '…' : text;
            }
        }
        return '';
    }

    function isComplete(mapping) {
        return !!(mapping && mapping.columns && mapping.columns.date && mapping.columns.discipline);
    }

    /* Which result fields have somewhere to be written. */
    function writableFields(mapping) {
        if (!mapping || !mapping.columns) return [];
        return RESULT_FIELDS.filter((id) => mapping.columns[id]).map((id) => FIELD_BY_ID.get(id));
    }

    /*
     * Give the unmapped result fields a home by appending new columns to the
     * right of the sheet. Used when a plan has no "actual" columns at all.
     * Returns the cell edits needed to write the new headings.
     */
    /*
     * Give unmapped result fields a home by appending columns to the right of
     * the sheet. The new headings borrow the style of the existing ones, so an
     * added column looks like it was always there rather than like something
     * bolted on.
     *
     * Returns the cell edits, and the columns that were added with the width
     * each wants.
     */
    function appendResultColumns(mapping, sheet, fieldIds) {
        const used = new Set(Object.values(mapping.columns));
        let next = Math.max(sheet.maxCol, ...used, 1) + 1;

        // The look of the rightmost heading, to copy onto the new ones.
        let headerStyle = -1;
        const headerCells = readRow(sheet, mapping.headerRow);
        if (headerCells.length) {
            const last = sheet.cell(mapping.headerRow, headerCells[headerCells.length - 1].col);
            if (last) headerStyle = last.styleIndex;
        }

        const edits = [];
        const added = [];

        for (const id of fieldIds) {
            const field = FIELD_BY_ID.get(id);
            if (!field || mapping.columns[id]) continue;
            mapping.columns[id] = next;
            edits.push({
                ref: AmsXlsx.makeRef(next, mapping.headerRow),
                kind: 'text',
                styleIndex: headerStyle,
                value: field.unit ? field.label + ' (' + field.unit + ')' : field.label
            });
            // Free text needs room; a number does not.
            added.push({ id: id, col: next, width: field.kind === 'text' ? 44 : 14 });
            next++;
        }

        return { edits: edits, added: added };
    }

    return {
        MAPPING_VERSION,
        FIELDS,
        FIELD_BY_ID,
        SECTION_FIELDS,
        RESULT_FIELDS,
        normalise,
        autoDetect,
        headingsFor,
        sampleValue,
        isComplete,
        looksLikeSectionColumn,
        writableFields,
        appendResultColumns,
        findLastDataRow
    };
})();
