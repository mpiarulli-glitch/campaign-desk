// Every subject line the agency has written, in one searchable place.
//
// Two sources, because subjects get written at two different moments and both
// are worth keeping:
//
//   scheduled_sends  a planned or sent campaign on the calendar. Carries the
//                    strategy around the line too — purpose, offer, audience.
//   email_subjects   the options attached to a review package, which is where
//                    A/B variants live. Several rows per email by design.
//
// Read-only. Nothing here writes, and no row is invented: a subject with no
// context shows blank context rather than a guess.

import { getDb } from "./db";

export interface SubjectLine {
  id: string;
  subject: string;
  previewText: string;
  clientId: string | null;
  clientName: string;
  /** "calendar" (scheduled_sends) or "review" (email_subjects). */
  source: "calendar" | "review";
  /** Send date for calendar rows, created date for review rows. */
  date: string;
  /** planned / scheduled / sent, or "" for review rows. */
  status: string;
  purpose: string;
  offer: string;
  audience: string;
  /**
   * The account's open rate for the month this went out, as a percentage, or
   * null when there is no metric for that client and month.
   *
   * This is the ACCOUNT's monthly rate, not this email's. Per-email stats are
   * not in this database, so treat it as the context the line went out in
   * rather than a measure of the line itself. It is labelled that way in the UI
   * for the same reason.
   */
  monthOpenRate: number | null;
}

function monthOf(date: string): string {
  return (date || "").slice(0, 7);
}

/**
 * Every subject on record, newest first.
 *
 * The open-rate lookup is done once into a map rather than per row, so this
 * stays a handful of queries no matter how many subjects accumulate.
 */
export function listSubjectLines(): SubjectLine[] {
  const db = getDb();

  const openRates = new Map<string, number>();
  for (const m of db
    .prepare(
      `SELECT client_id, month, recipients, opens FROM rev_metrics WHERE recipients > 0`
    )
    .all() as Array<{ client_id: string; month: string; recipients: number; opens: number }>) {
    openRates.set(`${m.client_id}:${m.month}`, (m.opens / m.recipients) * 100);
  }

  const rateFor = (clientId: string | null, date: string): number | null => {
    if (!clientId) return null;
    const r = openRates.get(`${clientId}:${monthOf(date)}`);
    return r === undefined ? null : r;
  };

  const calendar = (
    db
      .prepare(
        `SELECT id, client_id, client_name, send_date, status, subject, preview_text,
                purpose, offer, audience
           FROM scheduled_sends
          WHERE TRIM(COALESCE(subject, '')) <> ''`
      )
      .all() as Array<{
      id: string;
      client_id: string | null;
      client_name: string;
      send_date: string;
      status: string;
      subject: string;
      preview_text: string | null;
      purpose: string | null;
      offer: string | null;
      audience: string | null;
    }>
  ).map<SubjectLine>((r) => ({
    id: `send:${r.id}`,
    subject: r.subject,
    previewText: r.preview_text || "",
    clientId: r.client_id,
    clientName: r.client_name || "No client",
    source: "calendar",
    date: r.send_date || "",
    status: r.status || "",
    purpose: r.purpose || "",
    offer: r.offer || "",
    audience: r.audience || "",
    monthOpenRate: rateFor(r.client_id, r.send_date || ""),
  }));

  const review = (
    db
      .prepare(
        `SELECT s.id, s.subject, s.preview_text, s.created_at,
                c.client_id, c.client_name, c.title
           FROM email_subjects s
           JOIN campaigns c ON c.id = s.campaign_id
          WHERE TRIM(COALESCE(s.subject, '')) <> ''
            AND c.archived_at IS NULL`
      )
      .all() as Array<{
      id: string;
      subject: string;
      preview_text: string;
      created_at: string;
      client_id: string | null;
      client_name: string;
      title: string;
    }>
  ).map<SubjectLine>((r) => ({
    id: `review:${r.id}`,
    subject: r.subject,
    previewText: r.preview_text || "",
    clientId: r.client_id,
    clientName: r.client_name || "No client",
    source: "review",
    date: (r.created_at || "").slice(0, 10),
    status: "",
    // The package title is the nearest thing a review subject has to a stated
    // purpose, and it beats leaving the column empty.
    purpose: r.title || "",
    offer: "",
    audience: "",
    monthOpenRate: rateFor(r.client_id, r.created_at || ""),
  }));

  return [...calendar, ...review].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface SubjectBank {
  lines: SubjectLine[];
  clients: string[];
  totals: {
    lines: number;
    fromCalendar: number;
    fromReview: number;
    withOpenRate: number;
  };
}

export function buildSubjectBank(): SubjectBank {
  const lines = listSubjectLines();
  return {
    lines,
    clients: [...new Set(lines.map((l) => l.clientName))].sort(),
    totals: {
      lines: lines.length,
      fromCalendar: lines.filter((l) => l.source === "calendar").length,
      fromReview: lines.filter((l) => l.source === "review").length,
      withOpenRate: lines.filter((l) => l.monthOpenRate !== null).length,
    },
  };
}
