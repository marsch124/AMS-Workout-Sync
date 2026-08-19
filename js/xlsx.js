/*
 * Reading and writing .xlsx, with a bias towards not breaking your workbook.
 *
 * Reading is ordinary: shared strings, styles (so we can tell a date from the
 * number 45000), and a sheet's cells.
 *
 * Writing is the careful half. `writeCells` rebuilds only the <c> elements you
 * name. Every other cell, row, sheet and part of the archive is passed through
 * untouched — so formatting, charts, data validation and the formulas in the
 * columns you are *not* logging into all survive. Three details matter:
 *
 *   - A cell we overwrite loses its <f>, because a stale formula would simply
 *     recompute over the value you just entered.
 *   - Dropping a formula makes xl/calcChain.xml stale, so it is deleted; Excel
 *     rebuilds it silently on open.
 *   - fullCalcOnLoad is set, so anything that depends on the cells we touched —
 *     weekly totals, averages, the charts drawn from them — is recalculated the
 *     moment you open the file.
 */
const AmsXlsx = (function () {
    'use strict';

    const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
    const DAYS_1904_OFFSET = 1462;

    /* ---------- references ---------- */

    function colToIndex(letters) {
        let n = 0;
        for (let i = 0; i < letters.length; i++) {
            n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
        }
        return n;
    }

    function indexToCol(index) {
        let s = '';
        let n = index;
        while (n > 0) {
            const rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function parseRef(ref) {
        const m = /^([A-Za-z]+)(\d+)$/.exec(String(ref).trim());
        if (!m) return null;
        return { col: colToIndex(m[1]), row: parseInt(m[2], 10), letters: m[1].toUpperCase() };
    }

    function makeRef(col, row) {
        return indexToCol(col) + row;
    }

    /* ---------- xml helpers ---------- */

    function unescapeXml(text) {
        if (text.indexOf('&') === -1) return text;
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
            .replace(/&amp;/g, '&');
    }

    function escapeXml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            // Control characters are illegal in XML 1.0 and make Excel refuse
            // the file outright; drop them rather than produce a broken sheet.
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }

    function attr(attrsText, name) {
        const re = new RegExp('\\s' + name + '="([^"]*)"');
        const m = re.exec(' ' + attrsText);
        return m ? m[1] : null;
    }

    /* Concatenate every <t> in a fragment — rich text is split across runs. */
    function joinText(fragment) {
        let out = '';
        const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
        let m;
        while ((m = re.exec(fragment))) out += m[1] ? unescapeXml(m[1]) : '';
        return out;
    }

    /* ---------- dates ---------- */

    function isDateFormatCode(code) {
        if (!code) return false;
        // Strip quoted literals and colour/condition prefixes so that, say,
        // the "m" in [Red]0.00"m" is not mistaken for a month token.
        const stripped = code
            .replace(/"[^"]*"/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\\./g, '');
        return /[ymdhs]/i.test(stripped);
    }

    function serialToDate(serial, date1904) {
        const n = date1904 ? serial + DAYS_1904_OFFSET : serial;
        return new Date(Math.round((n - 25569) * 86400000));
    }

    function dateToSerial(date, date1904) {
        const serial = date.getTime() / 86400000 + 25569;
        return date1904 ? serial - DAYS_1904_OFFSET : serial;
    }

    /* A date-only key (YYYY-MM-DD) read in UTC, so a workbook opened in one
       timezone never slides a workout onto the day before. */
    function dayKey(date) {
        if (!(date instanceof Date) || isNaN(date)) return null;
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    /* ---------- workbook ---------- */

    class Workbook {
        constructor(archive) {
            this.archive = archive;
            this.sheets = [];
            this.sharedStrings = [];
            this.dateStyles = new Set();
            this.date1904 = false;
            this.sheetCache = new Map();
            this.dirtySheets = new Set();
            this.formulaDropped = false;
        }

        async load() {
            await this.loadWorkbook();
            await this.loadSharedStrings();
            await this.loadStyles();
            return this;
        }

        async loadWorkbook() {
            const xml = await this.archive.text('xl/workbook.xml');
            if (!xml) throw new Error('This file is not a workbook — xl/workbook.xml is missing.');

            this.date1904 = /date1904="(1|true)"/.test(xml);

            const relsXml = (await this.archive.text('xl/_rels/workbook.xml.rels')) || '';
            const rels = new Map();
            const relRe = /<Relationship\s([^>]*)\/?>/g;
            let m;
            while ((m = relRe.exec(relsXml))) {
                const id = attr(m[1], 'Id');
                let target = attr(m[1], 'Target');
                if (!id || !target) continue;
                target = target.replace(/^\/xl\//, '').replace(/^\.\//, '');
                rels.set(id, target.startsWith('xl/') ? target : 'xl/' + target);
            }

            const sheetRe = /<sheet\s([^>]*)\/?>/g;
            while ((m = sheetRe.exec(xml))) {
                const name = unescapeXml(attr(m[1], 'name') || '');
                const rid = attr(m[1], 'r:id') || attr(m[1], 'relationshipId');
                const state = attr(m[1], 'state');
                const path = rels.get(rid);
                if (name && path) {
                    this.sheets.push({ name, path, hidden: state === 'hidden' || state === 'veryHidden' });
                }
            }

            if (!this.sheets.length) throw new Error('This workbook has no readable sheets.');
        }

        async loadSharedStrings() {
            const xml = await this.archive.text('xl/sharedStrings.xml');
            if (!xml) return;
            const re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g;
            let m;
            while ((m = re.exec(xml))) {
                this.sharedStrings.push(m[1] ? joinText(m[1]) : '');
            }
        }

        async loadStyles() {
            const xml = await this.archive.text('xl/styles.xml');
            if (!xml) return;

            const customFormats = new Map();
            const fmtRe = /<numFmt\s([^>]*)\/?>/g;
            let m;
            while ((m = fmtRe.exec(xml))) {
                const id = parseInt(attr(m[1], 'numFmtId'), 10);
                const code = unescapeXml(attr(m[1], 'formatCode') || '');
                if (!isNaN(id)) customFormats.set(id, code);
            }

            // Only <cellXfs> maps a cell's s="" index; <cellStyleXfs> is a
            // different table and must not be counted.
            const start = xml.indexOf('<cellXfs');
            if (start === -1) return;
            const end = xml.indexOf('</cellXfs>', start);
            const block = xml.slice(start, end === -1 ? xml.length : end);

            const xfRe = /<xf\s([^>]*?)\/?>/g;
            let index = 0;
            let first = true;
            while ((m = xfRe.exec(block))) {
                if (first) { first = false; }  // the <cellXfs ...> tag itself is not matched by <xf
                const numFmtId = parseInt(attr(m[1], 'numFmtId') || '0', 10);
                if (BUILTIN_DATE_FORMATS.has(numFmtId) || isDateFormatCode(customFormats.get(numFmtId))) {
                    this.dateStyles.add(index);
                }
                index++;
            }
        }

        sheetNames() {
            return this.sheets.map((s) => s.name);
        }

        findSheet(name) {
            return this.sheets.find((s) => s.name === name) || null;
        }

        /* Read one sheet into a grid of cell objects. Cached — sheets are read
           repeatedly while auto-detecting a layout. */
        async readSheet(name) {
            if (this.sheetCache.has(name)) return this.sheetCache.get(name);
            const meta = this.findSheet(name);
            if (!meta) throw new Error('No sheet named "' + name + '" in this workbook.');
            const xml = await this.archive.text(meta.path);
            if (xml === null) throw new Error('Sheet "' + name + '" could not be read.');

            const sheet = this.parseSheet(name, xml);
            this.sheetCache.set(name, sheet);
            return sheet;
        }

        parseSheet(name, xml) {
            const rows = new Map();
            let maxRow = 0;
            let maxCol = 0;

            const bodyStart = xml.indexOf('<sheetData');
            const bodyEnd = xml.indexOf('</sheetData>');
            const body = bodyStart === -1 ? '' : xml.slice(bodyStart, bodyEnd === -1 ? xml.length : bodyEnd);

            const cellRe = /<c\s([^>]*?)(\/?)>/g;
            let m;
            while ((m = cellRe.exec(body))) {
                const attrs = m[1];
                const selfClosing = m[2] === '/';
                let content = '';
                if (!selfClosing) {
                    const close = body.indexOf('</c>', cellRe.lastIndex);
                    if (close === -1) break;
                    content = body.slice(cellRe.lastIndex, close);
                    cellRe.lastIndex = close + 4;
                }

                const ref = attr(attrs, 'r');
                const pos = ref ? parseRef(ref) : null;
                if (!pos) continue;

                const styleIndex = parseInt(attr(attrs, 's') || '-1', 10);
                const type = attr(attrs, 't') || 'n';
                const hasFormula = content.indexOf('<f') !== -1;
                // The formula text is kept, not just its presence: a plan's own
                // COUNTIFS are the best evidence of what its "done" column
                // expects to be filled in with.
                const fMatch = hasFormula ? /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(content) : null;

                const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(content);
                const rawValue = vMatch ? unescapeXml(vMatch[1]) : '';

                const cell = {
                    ref: ref.toUpperCase(),
                    row: pos.row,
                    col: pos.col,
                    styleIndex,
                    hasFormula,
                    formula: fMatch ? unescapeXml(fMatch[1]) : '',
                    type,
                    text: '',
                    number: null,
                    date: null
                };

                if (type === 's') {
                    const idx = parseInt(rawValue, 10);
                    cell.text = this.sharedStrings[idx] != null ? this.sharedStrings[idx] : '';
                } else if (type === 'inlineStr') {
                    cell.text = joinText(content);
                } else if (type === 'str') {
                    cell.text = rawValue;
                } else if (type === 'b') {
                    cell.text = rawValue === '1' ? 'TRUE' : 'FALSE';
                } else if (type === 'e') {
                    cell.text = rawValue;
                } else if (rawValue !== '') {
                    const num = Number(rawValue);
                    if (!isNaN(num)) {
                        cell.number = num;
                        if (this.dateStyles.has(styleIndex)) {
                            cell.date = serialToDate(num, this.date1904);
                            cell.text = dayKey(cell.date) || String(num);
                        } else {
                            cell.text = String(num);
                        }
                    } else {
                        cell.text = rawValue;
                    }
                }

                if (!rows.has(cell.row)) rows.set(cell.row, new Map());
                rows.get(cell.row).set(cell.col, cell);
                if (cell.row > maxRow) maxRow = cell.row;
                if (cell.col > maxCol) maxCol = cell.col;
            }

            return {
                name,
                rows,
                maxRow,
                maxCol,
                cell(row, col) {
                    const r = rows.get(row);
                    return r ? r.get(col) || null : null;
                },
                textAt(row, col) {
                    const c = this.cell(row, col);
                    return c ? String(c.text || '').trim() : '';
                }
            };
        }

        /*
         * Queue edits for a sheet. Each edit is { ref, kind, value } where kind
         * is 'number' | 'text' | 'date' | 'blank'. Nothing is written to the
         * archive until save().
         */
        async writeCells(sheetName, edits) {
            const meta = this.findSheet(sheetName);
            if (!meta) throw new Error('No sheet named "' + sheetName + '" in this workbook.');
            if (!edits || !edits.length) return;

            const sheet = await this.readSheet(sheetName);
            let xml = await this.archive.text(meta.path);

            // row -> col -> cell xml
            const byRow = new Map();
            let newMaxRow = sheet.maxRow;
            let newMaxCol = sheet.maxCol;

            for (const edit of edits) {
                const pos = parseRef(edit.ref);
                if (!pos) continue;
                const existing = sheet.cell(pos.row, pos.col);
                if (existing && existing.hasFormula) this.formulaDropped = true;

                const built = this.buildCell(pos, edit, existing);
                if (!byRow.has(pos.row)) byRow.set(pos.row, new Map());
                byRow.get(pos.row).set(pos.col, built);

                if (pos.row > newMaxRow) newMaxRow = pos.row;
                if (pos.col > newMaxCol) newMaxCol = pos.col;
            }

            xml = this.spliceSheetData(xml, byRow);
            xml = this.widenDimension(xml, newMaxRow, newMaxCol);

            this.archive.set(meta.path, xml);
            this.dirtySheets.add(sheetName);
            this.sheetCache.delete(sheetName);
        }

        buildCell(pos, edit, existing) {
            const ref = makeRef(pos.col, pos.row);
            // Keep whatever formatting the cell already carried, so a value
            // typed into a "1:23:45" column still shows as a duration. A cell
            // that does not exist yet can be given one — that is how an
            // appended column gets a header that matches the others.
            const styleIndex = existing && existing.styleIndex >= 0
                ? existing.styleIndex
                : (typeof edit.styleIndex === 'number' && edit.styleIndex >= 0 ? edit.styleIndex : -1);
            const s = styleIndex >= 0 ? ' s="' + styleIndex + '"' : '';

            if (edit.kind === 'blank' || edit.value === null || edit.value === undefined || edit.value === '') {
                return '<c r="' + ref + '"' + s + '/>';
            }

            if (edit.kind === 'number') {
                const num = Number(edit.value);
                if (isNaN(num)) return '<c r="' + ref + '"' + s + '/>';
                return '<c r="' + ref + '"' + s + '><v>' + num + '</v></c>';
            }

            if (edit.kind === 'date') {
                const date = edit.value instanceof Date ? edit.value : new Date(edit.value);
                if (isNaN(date)) return '<c r="' + ref + '"' + s + '/>';
                // Only write a bare serial if the cell is already formatted as a
                // date — otherwise it would show up as 45871 and look broken.
                if (styleIndex >= 0 && this.dateStyles.has(styleIndex)) {
                    return '<c r="' + ref + '"' + s + '><v>' + dateToSerial(date, this.date1904) + '</v></c>';
                }
                return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t>' + escapeXml(dayKey(date)) + '</t></is></c>';
            }

            return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">'
                + escapeXml(edit.value) + '</t></is></c>';
        }

        /*
         * Walk <sheetData> once, merging the queued cells into it. Rows and
         * cells that are not being edited are copied across as the exact
         * substrings they already were.
         */
        spliceSheetData(xml, byRow) {
            const openIdx = xml.indexOf('<sheetData');
            if (openIdx === -1) return xml;

            const openEnd = xml.indexOf('>', openIdx);
            const selfClosed = xml[openEnd - 1] === '/';
            const closeIdx = selfClosed ? openEnd + 1 : xml.indexOf('</sheetData>');
            const body = selfClosed ? '' : xml.slice(openEnd + 1, closeIdx);

            const pending = new Map(byRow);
            const out = [];
            let cursor = 0;

            const rowRe = /<row\s([^>]*?)(\/?)>/g;
            let m;
            while ((m = rowRe.exec(body))) {
                const attrs = m[1];
                const selfClosingRow = m[2] === '/';
                const rowStart = m.index;
                let rowEnd;
                let content = '';
                if (selfClosingRow) {
                    rowEnd = rowRe.lastIndex;
                } else {
                    const close = body.indexOf('</row>', rowRe.lastIndex);
                    if (close === -1) break;
                    content = body.slice(rowRe.lastIndex, close);
                    rowEnd = close + 6;
                    rowRe.lastIndex = rowEnd;
                }

                const rowNum = parseInt(attr(attrs, 'r') || '0', 10);

                // Any queued rows that sort before this one are new rows and
                // have to be inserted here to keep <row r=""> ascending.
                const inserted = [];
                for (const [num] of pending) {
                    if (rowNum && num < rowNum) inserted.push(num);
                }
                inserted.sort((a, b) => a - b);

                out.push(body.slice(cursor, rowStart));
                for (const num of inserted) {
                    out.push(this.buildRow(num, pending.get(num), null));
                    pending.delete(num);
                }

                if (pending.has(rowNum)) {
                    out.push(this.buildRow(rowNum, pending.get(rowNum), { attrs, content }));
                    pending.delete(rowNum);
                } else {
                    out.push(body.slice(rowStart, rowEnd));
                }
                cursor = rowEnd;
            }

            out.push(body.slice(cursor));

            const trailing = Array.from(pending.keys()).sort((a, b) => a - b);
            for (const num of trailing) {
                out.push(this.buildRow(num, pending.get(num), null));
            }

            const newBody = out.join('');
            if (selfClosed) {
                const openTag = xml.slice(openIdx, openEnd - 1).trimEnd() + '>';
                return xml.slice(0, openIdx) + openTag + newBody + '</sheetData>' + xml.slice(openEnd + 1);
            }
            return xml.slice(0, openEnd + 1) + newBody + xml.slice(closeIdx);
        }

        buildRow(rowNum, cellsByCol, existing) {
            const kept = new Map();

            if (existing) {
                const cellRe = /<c\s([^>]*?)(\/?)>/g;
                let m;
                while ((m = cellRe.exec(existing.content))) {
                    const start = m.index;
                    let end;
                    if (m[2] === '/') {
                        end = cellRe.lastIndex;
                    } else {
                        const close = existing.content.indexOf('</c>', cellRe.lastIndex);
                        if (close === -1) break;
                        end = close + 4;
                        cellRe.lastIndex = end;
                    }
                    const pos = parseRef(attr(m[1], 'r') || '');
                    if (pos) kept.set(pos.col, existing.content.slice(start, end));
                }
            }

            for (const [col, xmlText] of cellsByCol) kept.set(col, xmlText);

            const cols = Array.from(kept.keys()).sort((a, b) => a - b);
            const inner = cols.map((c) => kept.get(c)).join('');

            let attrs;
            if (existing) {
                // Drop the old spans hint rather than leave a wrong one behind.
                attrs = existing.attrs.replace(/\sspans="[^"]*"/, '').replace(/\/$/, '').trim();
            } else {
                attrs = 'r="' + rowNum + '"';
            }
            if (cols.length) {
                attrs += ' spans="' + cols[0] + ':' + cols[cols.length - 1] + '"';
            }
            return '<row ' + attrs + '>' + inner + '</row>';
        }

        widenDimension(xml, maxRow, maxCol) {
            const m = /<dimension\s+ref="([^"]*)"\s*\/>/.exec(xml);
            if (!m) return xml;
            const parts = m[1].split(':');
            const end = parseRef(parts[parts.length - 1]);
            if (!end) return xml;
            if (end.row >= maxRow && end.col >= maxCol) return xml;
            const start = parts.length > 1 ? parts[0] : 'A1';
            const widened = start + ':' + makeRef(Math.max(end.col, maxCol), Math.max(end.row, maxRow));
            return xml.replace(m[0], '<dimension ref="' + widened + '"/>');
        }

        /*
         * Give a column an explicit width. A notes column left at the default
         * eight characters is not much use for notes.
         */
        async setColumnWidth(sheetName, col, width) {
            const meta = this.findSheet(sheetName);
            if (!meta) return;
            let xml = await this.archive.text(meta.path);
            if (!xml) return;

            const entry = '<col min="' + col + '" max="' + col + '" width="' + width + '" customWidth="1"/>';
            const openIdx = xml.indexOf('<cols');

            if (openIdx === -1) {
                // No <cols> block at all: it must sit between sheetFormatPr and
                // sheetData, or Excel rejects the file.
                const at = xml.indexOf('<sheetData');
                if (at === -1) return;
                xml = xml.slice(0, at) + '<cols>' + entry + '</cols>' + xml.slice(at);
            } else {
                const existing = new RegExp('<col[^>]*\\smin="' + col + '"[^>]*/>');
                if (existing.test(xml)) {
                    xml = xml.replace(existing, entry);
                } else {
                    const openEnd = xml.indexOf('>', openIdx);
                    if (xml[openEnd - 1] === '/') {
                        xml = xml.slice(0, openEnd - 1) + '>' + entry + '</cols>' + xml.slice(openEnd + 1);
                    } else {
                        xml = xml.slice(0, openEnd + 1) + entry + xml.slice(openEnd + 1);
                    }
                }
            }

            this.archive.set(meta.path, xml);
            this.dirtySheets.add(sheetName);
            this.sheetCache.delete(sheetName);
        }

        /*
         * Add a worksheet to the workbook.
         *
         * Four parts have to agree for Excel to accept a new sheet: the sheet
         * XML itself, an entry in [Content_Types].xml so the part is recognised,
         * a relationship in the workbook's rels, and a <sheet> in workbook.xml
         * pointing at that relationship. Miss any one and Excel reports the
         * file as corrupt rather than telling you which.
         */
        async createSheet(name, headers) {
            if (this.findSheet(name)) return this.findSheet(name);

            // A part name and a relationship id nobody is using.
            let index = 1;
            while (this.archive.has('xl/worksheets/sheet' + index + '.xml')) index++;
            const path = 'xl/worksheets/sheet' + index + '.xml';

            const relsPath = 'xl/_rels/workbook.xml.rels';
            let rels = await this.archive.text(relsPath);
            if (!rels) throw new Error('This workbook has no relationships part, so a sheet cannot be added.');
            let relIndex = 1;
            while (rels.indexOf('Id="rId' + relIndex + '"') !== -1) relIndex++;
            const relId = 'rId' + relIndex;

            const header = (headers || []).map((text, i) =>
                '<c r="' + makeRef(i + 1, 1) + '" t="inlineStr"><is><t>' + escapeXml(text) + '</t></is></c>'
            ).join('');

            const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                + '<dimension ref="A1:' + makeRef(Math.max((headers || []).length, 1), 1) + '"/>'
                + '<sheetViews><sheetView workbookViewId="0">'
                + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                + '</sheetView></sheetViews>'
                + '<sheetFormatPr defaultRowHeight="15"/>'
                + '<sheetData>' + (header ? '<row r="1">' + header + '</row>' : '') + '</sheetData>'
                + '</worksheet>';
            this.archive.set(path, sheetXml);

            let types = await this.archive.text('[Content_Types].xml');
            if (types && types.indexOf('/' + path) === -1) {
                types = types.replace('</Types>',
                    '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-'
                    + 'officedocument.spreadsheetml.worksheet+xml"/></Types>');
                this.archive.set('[Content_Types].xml', types);
            }

            rels = rels.replace('</Relationships>',
                '<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/'
                + '2006/relationships/worksheet" Target="worksheets/sheet' + index + '.xml"/></Relationships>');
            this.archive.set(relsPath, rels);

            let workbookXml = await this.archive.text('xl/workbook.xml');
            let sheetId = 1;
            while (workbookXml.indexOf('sheetId="' + sheetId + '"') !== -1) sheetId++;
            const entry = '<sheet name="' + escapeXml(name) + '" sheetId="' + sheetId
                + '" r:id="' + relId + '"/>';
            if (workbookXml.indexOf('</sheets>') !== -1) {
                workbookXml = workbookXml.replace('</sheets>', entry + '</sheets>');
            } else {
                workbookXml = workbookXml.replace('<sheets/>', '<sheets>' + entry + '</sheets>');
            }
            this.archive.set('xl/workbook.xml', workbookXml);

            const meta = { name: name, path: path, hidden: false };
            this.sheets.push(meta);
            this.dirtySheets.add(name);
            this.sheetCache.delete(name);
            return meta;
        }

        get isDirty() {
            return this.dirtySheets.size > 0;
        }

        /* Emit the edited workbook. */
        async save() {
            if (this.formulaDropped && this.archive.has('xl/calcChain.xml')) {
                this.archive.remove('xl/calcChain.xml');
            }
            if (this.dirtySheets.size) {
                await this.forceRecalcOnLoad();
            }
            return this.archive.toBlob();
        }

        /* Make Excel recompute dependents — weekly totals, averages, charts. */
        async forceRecalcOnLoad() {
            let xml = await this.archive.text('xl/workbook.xml');
            if (!xml) return;
            if (/<calcPr\b/.test(xml)) {
                if (/fullCalcOnLoad="1"/.test(xml)) return;
                xml = xml.replace(/<calcPr\b([^>]*?)\/?>/, (full, attrs) => {
                    const cleaned = attrs.replace(/\sfullCalcOnLoad="[^"]*"/, '').replace(/\/$/, '');
                    return '<calcPr' + cleaned + ' fullCalcOnLoad="1"/>';
                });
            } else {
                xml = xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
            }
            this.archive.set('xl/workbook.xml', xml);
        }
    }

    async function open(buffer) {
        const archive = await AmsZip.read(buffer);
        if (!archive.has('xl/workbook.xml') && !archive.has('[Content_Types].xml')) {
            throw new Error("That file isn't an Excel workbook.");
        }
        return new Workbook(archive).load();
    }

    return {
        open,
        colToIndex,
        indexToCol,
        parseRef,
        makeRef,
        serialToDate,
        dateToSerial,
        dayKey,
        escapeXml
    };
})();
