// Pulling the text out of a PDF, with no dependency.
//
// This exists so an admin can drop a signed contract onto the account snapshot
// and get its deliverables read back. It is deliberately not a general PDF
// renderer: it handles the kind of file a contract actually is — text laid out
// by Word, Google Docs, PandaDoc, or DocuSign — and reports honestly when it
// cannot, because a paste-the-text fallback is always offered alongside it.
//
// How it works:
//
//   1. Find every `N G obj ... endobj` in the file and index it. PDFs are meant
//      to be read through their xref table, but a linearised or incrementally
//      saved file has several, and scanning is both simpler and more tolerant of
//      the slightly-malformed files that real signing tools emit.
//   2. Inflate the FlateDecode streams. Everything else (DCTDecode images,
//      embedded fonts) is skipped.
//   3. Read the text-showing operators out of the content streams and decode the
//      bytes through each font's ToUnicode CMap where one is present.
//
// What it does not do: OCR. A contract that was printed and scanned is an image,
// and the honest answer for one is "type or paste the scope of work instead",
// which is what `extractPdfText` reports via `looksScanned`.

import { inflateSync, unzipSync } from "node:zlib";

/* ------------------------------------------------------------- objects */

interface PdfObject {
  num: number;
  /** The dictionary/body text between `obj` and `stream` or `endobj`. */
  head: string;
  /** Raw stream bytes, before any filter is applied. */
  stream: Buffer | null;
}

// Latin-1 keeps a byte a byte, which matters: searching a PDF as UTF-8 corrupts
// every offset the moment a binary stream contains a high byte.
function toLatin1(buf: Buffer): string {
  return buf.toString("latin1");
}

function indexObjects(buf: Buffer): Map<number, PdfObject> {
  const src = toLatin1(buf);
  const out = new Map<number, PdfObject>();
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;

  while ((m = objRe.exec(src)) !== null) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    // `endobj` can be missing on a truncated file; fall back to the next `obj`.
    const endObj = src.indexOf("endobj", bodyStart);
    const nextObj = objRe.lastIndex;
    const limit = endObj === -1 ? src.length : endObj;

    const streamAt = src.indexOf("stream", bodyStart);
    let head: string;
    let stream: Buffer | null = null;

    if (streamAt !== -1 && streamAt < limit) {
      head = src.slice(bodyStart, streamAt);
      // The spec allows CRLF or a bare LF after the `stream` keyword.
      let dataStart = streamAt + "stream".length;
      if (src[dataStart] === "\r") dataStart++;
      if (src[dataStart] === "\n") dataStart++;

      // Prefer the declared /Length; fall back to searching for `endstream`,
      // which is what an indirect length reference leaves us with.
      const lengthMatch = head.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      let dataEnd = -1;
      if (lengthMatch) {
        const declared = dataStart + Number(lengthMatch[1]);
        // Trust it only if `endstream` really is where it says it is.
        if (src.slice(declared, declared + 20).includes("endstream")) dataEnd = declared;
      }
      if (dataEnd === -1) {
        const endStream = src.indexOf("endstream", dataStart);
        dataEnd = endStream === -1 ? src.length : endStream;
      }
      stream = buf.subarray(dataStart, dataEnd);
    } else {
      head = src.slice(bodyStart, limit);
    }

    out.set(num, { num, head, stream });
    // Keep scanning from where this object's header ended, not from inside its
    // stream, or binary data gets mistaken for object headers.
    objRe.lastIndex = Math.max(nextObj, bodyStart);
  }

  expandObjectStreams(out);
  return out;
}

/**
 * Unpack PDF 1.5 compressed object streams.
 *
 * Anything written this century puts its dictionaries — page resources, font
 * descriptors, the ToUnicode references — inside `/Type /ObjStm` streams rather
 * than as top-level objects. Skipping this step is the difference between
 * reading a document's text and reading its glyph ids, so it is not optional.
 *
 * Layout of a decoded ObjStm: `/First` bytes of "objnum offset" pairs, `/N` of
 * them, then the object bodies at those offsets.
 */
function expandObjectStreams(objects: Map<number, PdfObject>): void {
  // Snapshot first: the loop adds to the map it is reading from.
  for (const obj of Array.from(objects.values())) {
    if (!/\/Type\s*\/ObjStm/.test(obj.head)) continue;
    const data = decodeStream(obj);
    if (!data) continue;

    const n = Number(obj.head.match(/\/N\s+(\d+)/)?.[1] || 0);
    const first = Number(obj.head.match(/\/First\s+(\d+)/)?.[1] || 0);
    if (!n || !first) continue;

    const src = toLatin1(data);
    const pairs = src.slice(0, first).trim().split(/\s+/).map(Number);

    for (let i = 0; i < n; i++) {
      const num = pairs[i * 2];
      const offset = pairs[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(offset)) continue;
      // Each body runs to the start of the next one, or to the end.
      const nextOffset = i + 1 < n ? pairs[(i + 1) * 2 + 1] : src.length - first;
      const body = src.slice(first + offset, first + (nextOffset ?? src.length));
      // A packed object is never itself a stream, so head is the whole body.
      // Top-level objects win on a collision: they are the newer revision.
      if (!objects.has(num)) objects.set(num, { num, head: body, stream: null });
    }
  }
}

// Inflate, tolerating the truncated final block that some writers produce.
function inflate(data: Buffer): Buffer | null {
  const attempts: Array<() => Buffer> = [
    () => inflateSync(data),
    () => unzipSync(data),
    // A stream whose /Length overshot picks up trailing bytes; raw-deflate and
    // a partial flush both recover the part that did decompress.
    () => inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH */ }),
  ];
  for (const attempt of attempts) {
    try {
      const out = attempt();
      if (out.length) return out;
    } catch {
      // try the next strategy
    }
  }
  return null;
}

function decodeStream(obj: PdfObject): Buffer | null {
  if (!obj.stream) return null;
  const filter = obj.head.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
  const filters = filter ? filter[1] : "";
  // Images and embedded font programs are not text; skip rather than waste an
  // inflate on every one of them.
  if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(filters)) return null;
  if (/FlateDecode/.test(filters)) return inflate(obj.stream);
  if (!filters) return obj.stream; // uncompressed content stream
  return null;
}

/* --------------------------------------------------------- ToUnicode */

/**
 * Parse a ToUnicode CMap into a code -> string map.
 *
 * Subset fonts (the norm in anything exported from Word or a signing tool) map
 * glyph ids that mean nothing on their own, so without this the text comes back
 * as mojibake. Both `bfchar` and `bfrange` forms are handled.
 */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();

  const hexToStr = (hex: string): string => {
    // UTF-16BE, which is what a bfchar destination is.
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (!Number.isNaN(code)) out += String.fromCharCode(code);
    }
    return out;
  };

  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    const pairs = block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g) || [];
    for (const pair of pairs) {
      const m = pair.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/);
      if (!m) continue;
      map.set(parseInt(m[1], 16), hexToStr(m[2]));
    }
  }

  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    // <lo> <hi> <dstStart>
    const ranges = block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g) || [];
    for (const range of ranges) {
      const m = range.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/);
      if (!m) continue;
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const dst = parseInt(m[3], 16);
      // A pathological range would otherwise allocate for a very long time.
      if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo || hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
    }
    // <lo> <hi> [<d1> <d2> ...]
    for (const arrForm of block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g) || []) {
      const m = arrForm.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/);
      if (!m) continue;
      const lo = parseInt(m[1], 16);
      const items = m[3].match(/<([0-9a-fA-F]*)>/g) || [];
      items.forEach((item, i) => {
        const hex = item.slice(1, -1);
        map.set(lo + i, hexToStr(hex));
      });
    }
  }

  return map;
}

interface FontInfo {
  toUnicode: Map<number, string> | null;
  /** Two-byte codes, i.e. a CID font. */
  twoByte: boolean;
}

// Every font in the file, keyed by object number. Resolving which resource name
// points at which font per page would be more correct, but font resource names
// are near-universally unique per document in practice, and building one flat
// name -> font map keeps this to a fraction of the code for the same result.
function collectFonts(objects: Map<number, PdfObject>): Map<string, FontInfo> {
  const byName = new Map<string, FontInfo>();

  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Font/.test(obj.head)) continue;

    let toUnicode: Map<number, string> | null = null;
    const ref = obj.head.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (ref) {
      const target = objects.get(Number(ref[1]));
      const data = target ? decodeStream(target) : null;
      if (data) {
        const parsed = parseToUnicode(toLatin1(data));
        if (parsed.size) toUnicode = parsed;
      }
    }
    const twoByte =
      /\/Subtype\s*\/Type0/.test(obj.head) || /\/Encoding\s*\/Identity-[HV]/.test(obj.head);

    byName.set(String(obj.num), { toUnicode, twoByte });
  }

  // Map the resource names used inside content streams (/F1, /TT2, /C0_0) onto
  // the font objects they refer to.
  const resolved = new Map<string, FontInfo>();
  for (const obj of objects.values()) {
    const fontDict = obj.head.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (!fontDict) continue;
    const entries = fontDict[1].match(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g) || [];
    for (const entry of entries) {
      const m = entry.match(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/);
      if (!m) continue;
      const info = byName.get(m[2]);
      if (info) resolved.set(m[1], info);
    }
  }
  return resolved;
}

/* ------------------------------------------------------ content streams */

// PDF string literal escapes, per the spec's Table 3.
const ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\",
};

// Read a `(...)` literal starting at `i` (the opening paren). Returns the raw
// byte string and the index just past the closing paren.
function readLiteral(src: string, i: number): { bytes: string; next: number } {
  let out = "";
  let depth = 1;
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      const esc = src[j + 1];
      if (esc in ESCAPES) {
        out += ESCAPES[esc];
        j += 2;
        continue;
      }
      // Octal escape, one to three digits.
      const octal = src.slice(j + 1, j + 4).match(/^[0-7]{1,3}/);
      if (octal) {
        out += String.fromCharCode(parseInt(octal[0], 8));
        j += 1 + octal[0].length;
        continue;
      }
      // A backslash before a newline is a line continuation: emit nothing.
      if (esc === "\n" || esc === "\r") {
        j += 2;
        if (esc === "\r" && src[j] === "\n") j++;
        continue;
      }
      out += esc ?? "";
      j += 2;
      continue;
    }
    if (ch === "(") { depth++; out += ch; j++; continue; }
    if (ch === ")") {
      depth--;
      if (depth === 0) return { bytes: out, next: j + 1 };
      out += ch;
      j++;
      continue;
    }
    out += ch;
    j++;
  }
  return { bytes: out, next: j };
}

function readHexString(src: string, i: number): { bytes: string; next: number } {
  const end = src.indexOf(">", i);
  const hex = (end === -1 ? src.slice(i + 1) : src.slice(i + 1, end)).replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  // An odd final digit is padded with zero, per the spec.
  const padded = hex.length % 2 ? hex + "0" : hex;
  for (let k = 0; k < padded.length; k += 2) {
    out += String.fromCharCode(parseInt(padded.slice(k, k + 2), 16));
  }
  return { bytes: out, next: end === -1 ? src.length : end + 1 };
}

function decodeBytes(bytes: string, font: FontInfo | undefined): string {
  if (!font?.toUnicode) {
    if (font?.twoByte) {
      // Identity encoding with no ToUnicode: the codes are glyph ids and there
      // is nothing to map them through. Emitting the raw values would be noise.
      return "";
    }
    return bytes; // single-byte, effectively WinAnsi/Latin-1
  }
  const map = font.toUnicode;
  const step = font.twoByte ? 2 : 1;
  let out = "";
  for (let i = 0; i < bytes.length; i += step) {
    const code =
      step === 2
        ? (bytes.charCodeAt(i) << 8) | (bytes.charCodeAt(i + 1) || 0)
        : bytes.charCodeAt(i);
    const mapped = map.get(code);
    out += mapped !== undefined ? mapped : step === 1 ? bytes[i] : "";
  }
  return out;
}

/**
 * Pull the shown text out of one content stream.
 *
 * Two things a PDF does not contain: newlines and, often, spaces. Both have to
 * be inferred from the positioning operators, and getting it right is what makes
 * the contract parser able to work line by line.
 *
 * **Line breaks** come from a downward move: `Td`/`TD` with a non-zero vertical
 * operand, `T*`, `'`, `"`, or a `Tm` that lands on a different line than the last.
 *
 * **Spaces** are the subtle half. Writers fall into two camps, and the same rule
 * has to serve both:
 *
 *   - *Word at a time* (Word, most report generators): `(Scope of) Tj` then a
 *     `Td` to skip the gap to the next word. Here the horizontal move IS the
 *     space, and dropping it runs every word together.
 *   - *Glyph at a time* (Google Docs, Chrome's print-to-PDF): `<0036> Tj`, a
 *     `Td` of exactly that glyph's width, `<0057> Tj`, and so on — with the
 *     spaces present as their own glyphs. Here a space per move would put one
 *     between every letter.
 *
 * The tell is the length of the string just shown: a writer emitting one glyph at
 * a time is emitting its spaces too, so only a multi-character show is followed
 * by a gap worth reading as a space.
 */
function textFromContentStream(src: string, fonts: Map<string, FontInfo>): string {
  let out = "";
  let font: FontInfo | undefined;
  let i = 0;
  // Whether the last thing appended already ended the line, so repeated
  // positioning operators do not stack up blank lines.
  let atLineStart = true;
  // Characters produced by the most recent show operator. See the note above.
  let lastShown = 0;
  // Vertical position of the last `Tm`, to tell a new line from a mid-line jump.
  let lastTmY: number | null = null;

  const newline = () => {
    if (!atLineStart) {
      out += "\n";
      atLineStart = true;
    }
    lastShown = 0;
  };
  const append = (text: string) => {
    if (!text) return;
    out += text;
    atLineStart = false;
  };
  // A horizontal-only move: a space if the writer works word at a time.
  const gap = () => {
    if (lastShown > 1 && !atLineStart && !out.endsWith(" ")) append(" ");
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === "(") {
      const { bytes, next } = readLiteral(src, i);
      const text = decodeBytes(bytes, font);
      append(text);
      lastShown = text.length;
      i = next;
      continue;
    }
    if (ch === "<" && src[i + 1] !== "<") {
      const { bytes, next } = readHexString(src, i);
      const text = decodeBytes(bytes, font);
      append(text);
      lastShown = text.length;
      i = next;
      continue;
    }
    if (ch === "%") {
      // Comment to end of line.
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }

    // Operators and operands are whitespace-delimited tokens.
    const tokenMatch = src.slice(i).match(/^[^\s()<>[\]{}/%]+/);
    if (!tokenMatch) { i++; continue; }
    const token = tokenMatch[0];
    const before = src.slice(Math.max(0, i - 200), i);

    if (token === "Td" || token === "TD") {
      // The two numbers immediately before the operator are its operands.
      const nums = before.match(/(-?[\d.]+)\s+(-?[\d.]+)\s*$/);
      const ty = nums ? Number(nums[2]) : 0;
      if (ty !== 0) newline();
      else gap();
    } else if (token === "'" || token === '"' || token === "T*") {
      newline();
    } else if (token === "ET" || token === "BT") {
      newline();
      lastTmY = null;
    } else if (token === "Tf") {
      const name = before.match(/\/([^\s/<>[\]]+)\s+[\d.]+\s*$/);
      if (name) font = fonts.get(name[1]);
    } else if (token === "Tm") {
      // `a b c d e f Tm` — f is the vertical translation. Same line means this is
      // a mid-line jump (a style change, a tab stop), not a new line.
      const nums = before.match(
        /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/
      );
      const ty = nums ? Number(nums[6]) : null;
      if (ty === null || lastTmY === null || Math.abs(ty - lastTmY) > 0.5) newline();
      else gap();
      lastTmY = ty;
    }
    // Tj / TJ need no handling: the strings were appended as they were read, and
    // the kerning numbers inside a TJ array are skipped as plain tokens.

    i += token.length;
  }
  return out;
}

/* ------------------------------------------------------------- cleanup */

// Rejoins the words a PDF split across positioning operators and drops the
// artefacts (page numbers on their own line, repeated spaces) that would
// otherwise look like content to the contract parser.
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Ligatures, so "office" does not arrive as "oﬃce".
    .replace(/ﬀ/g, "ff").replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl")
    .replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    // Typographic punctuation to plain ASCII, so pattern matching is simple.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "•") // keep bullets: the parser uses them
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "") // collapse blank runs
    // A filled form field carries several appearance streams that all draw the
    // same value, so its text arrives two to four times over. Collapsing a line
    // that immediately repeats itself removes that without touching prose, where
    // back-to-back identical lines effectively do not occur.
    .filter((line, i, arr) => line === "" || line !== arr[i - 1])
    .join("\n")
    .trim();
}

/* -------------------------------------------------------------- public */

export interface PdfTextResult {
  text: string;
  pages: number;
  /**
   * True when the file parsed but yielded almost no text, which in practice
   * means a scan or an image-only export. The caller should tell the user to
   * paste the text rather than reporting a generic failure.
   */
  looksScanned: boolean;
}

/** Whether a buffer is a PDF at all, before any work is spent on it. */
export function isPdf(buf: Buffer): boolean {
  // The header is allowed a little junk in front of it.
  return buf.subarray(0, 1024).includes("%PDF-");
}

/**
 * Extract the text of a PDF.
 *
 * Throws only for a file that is not a PDF. A PDF this cannot read comes back
 * with empty text and `looksScanned`, because "we could not read it, paste it
 * instead" is a better answer than an exception at the top of a form.
 */
export function extractPdfText(buf: Buffer): PdfTextResult {
  if (!isPdf(buf)) {
    throw new Error("That file is not a PDF.");
  }

  const objects = indexObjects(buf);
  const fonts = collectFonts(objects);
  const pages = (toLatin1(buf).match(/\/Type\s*\/Page[^s]/g) || []).length || 1;

  const parts: string[] = [];
  for (const obj of objects.values()) {
    if (!obj.stream) continue;
    // A font program or an image can inflate to something huge; only content
    // streams are wanted, and they are the ones with text operators in them.
    const data = decodeStream(obj);
    if (!data) continue;
    const src = toLatin1(data);
    if (!/\bBT\b/.test(src) || !/\b(Tj|TJ)\b/.test(src)) continue;
    parts.push(textFromContentStream(src, fonts));
  }

  const text = tidy(parts.join("\n"));
  // A contract has hundreds of words. Anything under a couple of lines' worth of
  // letters is a scan or an extraction we should not pretend succeeded.
  const letters = (text.match(/[A-Za-z]/g) || []).length;

  return { text, pages, looksScanned: letters < 200 };
}
