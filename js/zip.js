/*
 * A very small ZIP reader/writer — just enough of the format to open an .xlsx,
 * change a few bytes inside it, and put it back together again.
 *
 * Why not a library? Because of what this app does to your workbook. An .xlsx
 * is a zip of XML files, and the whole point here is *surgery*: we open the
 * archive, rewrite the handful of cells you logged, and leave every other byte
 * exactly as Excel wrote it. Entries we don't touch are copied across still
 * compressed, with their original CRC — so your charts, conditional formatting,
 * pivot tables, macros and column widths come through untouched, because we
 * never decode them in the first place. A general-purpose spreadsheet library
 * would rebuild the file from its own model and quietly drop what it didn't
 * understand.
 *
 * Compression is done by the browser's own Compression Streams. That keeps the
 * app dependency-free and working offline.
 */
const AmsZip = (function () {
    'use strict';

    const SIG_LOCAL = 0x04034b50;
    const SIG_CENTRAL = 0x02014b50;
    const SIG_EOCD = 0x06054b50;
    const SIG_EOCD64 = 0x06064b50;
    const SIG_EOCD64_LOCATOR = 0x07064b50;

    const canDeflate = typeof CompressionStream === 'function';
    const canInflate = typeof DecompressionStream === 'function';

    const CRC_TABLE = (function () {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let bit = 0; bit < 8; bit++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    async function pump(bytes, stream) {
        const source = new Blob([bytes]).stream().pipeThrough(stream);
        const buffer = await new Response(source).arrayBuffer();
        return new Uint8Array(buffer);
    }

    function inflateRaw(bytes) {
        if (!canInflate) {
            throw new Error('This browser cannot unpack .xlsx files (no DecompressionStream). Safari 16.4 or newer is needed.');
        }
        return pump(bytes, new DecompressionStream('deflate-raw'));
    }

    function deflateRaw(bytes) {
        return pump(bytes, new CompressionStream('deflate-raw'));
    }

    const utf8Decoder = new TextDecoder('utf-8');
    const utf8Encoder = new TextEncoder();

    /*
     * An opened archive. `order` keeps the original entry order — Excel is not
     * fussy about it, but keeping it means a workbook that round-trips without
     * edits comes out very nearly byte-identical to the one that went in.
     */
    class Archive {
        constructor(bytes, entries, order) {
            this.bytes = bytes;
            this.entries = entries;   // name -> { method, crc, compSize, uncompSize, dataStart }
            this.order = order;
            this.overrides = new Map();
            this.removed = new Set();
            this.plainCache = new Map();
        }

        has(name) {
            return (this.entries.has(name) || this.overrides.has(name)) && !this.removed.has(name);
        }

        names() {
            return this.order.filter((name) => !this.removed.has(name));
        }

        /* Raw bytes of one entry, inflating on first use and caching after. */
        async file(name) {
            if (this.removed.has(name)) return null;
            if (this.overrides.has(name)) return this.overrides.get(name);
            if (this.plainCache.has(name)) return this.plainCache.get(name);

            const entry = this.entries.get(name);
            if (!entry) return null;

            const raw = this.bytes.subarray(entry.dataStart, entry.dataStart + entry.compSize);
            const plain = entry.method === 0 ? raw.slice() : await inflateRaw(raw);
            this.plainCache.set(name, plain);
            return plain;
        }

        async text(name) {
            const bytes = await this.file(name);
            return bytes ? utf8Decoder.decode(bytes) : null;
        }

        set(name, text) {
            const bytes = typeof text === 'string' ? utf8Encoder.encode(text) : text;
            this.overrides.set(name, bytes);
            this.removed.delete(name);
            if (!this.order.includes(name)) this.order.push(name);
        }

        remove(name) {
            this.removed.add(name);
        }

        /*
         * Re-emit the archive. Entries you never touched are written back in
         * their original compressed form — same bytes, same CRC — so nothing
         * can be lost in a decode/encode round trip.
         */
        async toBlob() {
            const chunks = [];
            const central = [];
            let offset = 0;

            for (const name of this.order) {
                if (this.removed.has(name)) continue;

                let method, crc, compSize, uncompSize, data;

                if (this.overrides.has(name)) {
                    const plain = this.overrides.get(name);
                    crc = crc32(plain);
                    uncompSize = plain.length;
                    if (canDeflate && plain.length > 0) {
                        data = await deflateRaw(plain);
                        method = 8;
                    } else {
                        data = plain;
                        method = 0;
                    }
                    compSize = data.length;
                } else {
                    const entry = this.entries.get(name);
                    if (!entry) continue;
                    method = entry.method;
                    crc = entry.crc;
                    compSize = entry.compSize;
                    uncompSize = entry.uncompSize;
                    data = this.bytes.subarray(entry.dataStart, entry.dataStart + entry.compSize);
                }

                const nameBytes = utf8Encoder.encode(name);
                const local = new Uint8Array(30 + nameBytes.length);
                const lv = new DataView(local.buffer);
                lv.setUint32(0, SIG_LOCAL, true);
                lv.setUint16(4, 20, true);        // version needed
                lv.setUint16(6, 0x0800, true);    // UTF-8 names
                lv.setUint16(8, method, true);
                lv.setUint16(10, 0, true);        // mod time
                lv.setUint16(12, 0x21, true);     // mod date (1996-01-01, fixed for reproducibility)
                lv.setUint32(14, crc, true);
                lv.setUint32(18, compSize, true);
                lv.setUint32(22, uncompSize, true);
                lv.setUint16(26, nameBytes.length, true);
                lv.setUint16(28, 0, true);        // extra length
                local.set(nameBytes, 30);

                chunks.push(local, data);
                central.push({ nameBytes, method, crc, compSize, uncompSize, offset });
                offset += local.length + data.length;
            }

            const centralStart = offset;
            for (const item of central) {
                const record = new Uint8Array(46 + item.nameBytes.length);
                const cv = new DataView(record.buffer);
                cv.setUint32(0, SIG_CENTRAL, true);
                cv.setUint16(4, 20, true);        // version made by
                cv.setUint16(6, 20, true);        // version needed
                cv.setUint16(8, 0x0800, true);    // UTF-8 names
                cv.setUint16(10, item.method, true);
                cv.setUint16(12, 0, true);
                cv.setUint16(14, 0x21, true);
                cv.setUint32(16, item.crc, true);
                cv.setUint32(20, item.compSize, true);
                cv.setUint32(24, item.uncompSize, true);
                cv.setUint16(28, item.nameBytes.length, true);
                cv.setUint16(30, 0, true);        // extra
                cv.setUint16(32, 0, true);        // comment
                cv.setUint16(34, 0, true);        // disk
                cv.setUint16(36, 0, true);        // internal attrs
                cv.setUint32(38, 0, true);        // external attrs
                cv.setUint32(42, item.offset, true);
                record.set(item.nameBytes, 46);
                chunks.push(record);
                offset += record.length;
            }

            const eocd = new Uint8Array(22);
            const ev = new DataView(eocd.buffer);
            ev.setUint32(0, SIG_EOCD, true);
            ev.setUint16(4, 0, true);
            ev.setUint16(6, 0, true);
            ev.setUint16(8, central.length, true);
            ev.setUint16(10, central.length, true);
            ev.setUint32(12, offset - centralStart, true);
            ev.setUint32(16, centralStart, true);
            ev.setUint16(20, 0, true);
            chunks.push(eocd);

            return new Blob(chunks, {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        }
    }

    async function read(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        // The end-of-central-directory record sits at the very end, but a zip
        // comment can follow it, so scan backwards for the signature.
        let eocd = -1;
        const floor = Math.max(0, bytes.length - 66000);
        for (let i = bytes.length - 22; i >= floor; i--) {
            if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("That doesn't look like an .xlsx file — no zip directory found.");

        let count = view.getUint16(eocd + 10, true);
        let centralOffset = view.getUint32(eocd + 16, true);

        if (centralOffset === 0xFFFFFFFF || count === 0xFFFF) {
            const locator = eocd - 20;
            if (locator < 0 || view.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) {
                throw new Error('This workbook uses a zip layout the app cannot read.');
            }
            const eocd64 = Number(view.getBigUint64(locator + 8, true));
            if (view.getUint32(eocd64, true) !== SIG_EOCD64) {
                throw new Error('This workbook uses a zip layout the app cannot read.');
            }
            count = Number(view.getBigUint64(eocd64 + 32, true));
            centralOffset = Number(view.getBigUint64(eocd64 + 48, true));
        }

        const entries = new Map();
        const order = [];
        let p = centralOffset;

        for (let n = 0; n < count; n++) {
            if (view.getUint32(p, true) !== SIG_CENTRAL) break;
            const method = view.getUint16(p + 10, true);
            const crc = view.getUint32(p + 16, true);
            const compSize = view.getUint32(p + 20, true);
            const uncompSize = view.getUint32(p + 24, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const localOffset = view.getUint32(p + 42, true);
            const name = utf8Decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

            if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
                throw new Error('This workbook is stored in ZIP64 form, which the app cannot read yet.');
            }

            // The local header repeats the name and may carry a different extra
            // field, so the data offset has to be read from there, not here.
            const localNameLen = view.getUint16(localOffset + 26, true);
            const localExtraLen = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLen + localExtraLen;

            entries.set(name, { method, crc, compSize, uncompSize, dataStart });
            order.push(name);
            p += 46 + nameLen + extraLen + commentLen;
        }

        return new Archive(bytes, entries, order);
    }

    return { read, crc32, canInflate, canDeflate };
})();
