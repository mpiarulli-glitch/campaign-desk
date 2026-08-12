// CSV parsing for spreadsheet imports. No dependency: the files we take are
// exports from Google Sheets, Excel, and Airtable, which all stay inside
// RFC 4180 (quoted fields, doubled quotes to escape, CRLF or LF line endings).
//
// Pure functions only, so this is safe to import from a client component when a
// preview needs to be built without a round trip.

/** The delimiters we sniff for. Excel in a European locale writes semicolons. */
const DELIMITERS = [",", ";", "\t", "|"] as const;

// Counts a candidate delimiter in the first line only, skipping anything inside
// quotes so a title like "Summer sale, part two" doesn't win the vote for comma.
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const n = countOutsideQuotes(firstLine, d);
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Parse CSV text into rows of raw cell strings.
 *
 * Blank lines are dropped rather than returned as a one-empty-cell row, because
 * spreadsheet exports pad the bottom of the file with them and every caller
 * would otherwise have to filter the same noise out.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  // Excel prefixes a UTF-8 BOM, which would otherwise become part of the first
  // header and stop it matching any alias.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = delimiter || sniffDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // this field started with a quote
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
    quoted = false;
  };
  const endRow = () => {
    endField();
    // A row of nothing but empty cells is padding, not data.
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // A quote only opens a quoted field at the start of that field. Mid-field
    // quotes are literal, which is what unescaped exports produce.
    if (ch === '"' && field === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Whatever is left when the file doesn't end in a newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/** Header text reduced to letters and digits, so "Send Date" matches "send_date". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map a field name to the column index it was found at.
 *
 * `aliases` lists, per field, the normalized headers that mean it. The first
 * alias that appears in the sheet wins, so a file carrying both "subject" and
 * "subjectline" resolves predictably rather than by column order.
 */
export function mapColumns<F extends string>(
  headerRow: string[],
  aliases: Record<F, readonly string[]>
): Record<F, number> {
  const seen = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normalizeHeader(h);
    // First occurrence wins: duplicated headers are a spreadsheet accident.
    if (key && !seen.has(key)) seen.set(key, i);
  });

  const out = {} as Record<F, number>;
  for (const field of Object.keys(aliases) as F[]) {
    out[field] = -1;
    for (const alias of aliases[field]) {
      const idx = seen.get(alias);
      if (idx !== undefined) {
        out[field] = idx;
        break;
      }
    }
  }
  return out;
}

/** The cell at `index`, trimmed. Missing column or short row reads as "". */
export function cell(row: string[], index: number): string {
  if (index < 0 || index >= row.length) return "";
  return (row[index] ?? "").trim();
}
