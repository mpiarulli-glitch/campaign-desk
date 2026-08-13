// Telling a production shoot apart from a planned piece of content.
//
// The two share the scheduled_sends table and there is no column that says which
// is which, so it is inferred from the production brief. The original rule was
// "the brief is not empty", and it turned out to be wrong for every row in the
// database that it flagged: an editorial import had written each entry's
// description, hook, and CTA into production_brief instead of note, so an entire
// year of videos, SMS, and social posts rendered as camera shoots, complete with
// "Full day (9 AM to 5:30 PM)" where the asset type and offer should be.
//
// A real brief is always machine-written: the client intake form and the admin
// edit both store `JSON.stringify(brief)`. Freeform prose never is. So the test is
// "does this parse as a JSON object", which separates the two by how the value got
// there rather than by whether somebody typed something.
//
// This is still inference. The durable fix is an explicit column on the row, which
// is worth doing before anything else starts depending on the distinction.

/** The known-shape brief an intake form or an admin edit stores. */
export type ProductionBrief = Record<string, string>;

/**
 * Whether a production_brief value is a real, structured brief.
 *
 * Requires a leading `{` before parsing so that a bare JSON string or number in
 * the column cannot pass as a brief.
 */
export function isProductionBrief(raw: string | null | undefined): boolean {
  return parseProductionBrief(raw) !== null;
}

/** The brief as an object, or null when the value is not a structured brief. */
export function parseProductionBrief(
  raw: string | null | undefined
): ProductionBrief | null {
  const text = (raw || "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ProductionBrief;
  } catch {
    return null;
  }
}

/**
 * SQL fragment matching a row that carries a real structured brief.
 *
 * `json_valid` is paired with a leading-brace check rather than with `json_type`,
 * because json_type raises on malformed input and SQLite does not promise to
 * short-circuit AND. json_valid never raises.
 *
 * Pass the table alias when the query uses one.
 */
export function hasProductionBriefSql(alias = ""): string {
  const col = alias ? `${alias}.production_brief` : "production_brief";
  return `(json_valid(${col}) AND substr(TRIM(${col}), 1, 1) = '{')`;
}

export const HAS_PRODUCTION_BRIEF_SQL = hasProductionBriefSql();
