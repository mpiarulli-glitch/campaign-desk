// Pair package emails with GoHighLevel scheduled blasts by title or subject.
// Used when an operator marks a multi-email package Scheduled and wants each
// item to pick up the date GHL already has, instead of one date for the batch.

export type MatchableEmail = {
  id: string;
  title: string;
  subjects?: string[];
};

export type MatchableSchedule = {
  id: string;
  name: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
};

export type EmailScheduleMatch = {
  emailId: string;
  schedule: MatchableSchedule | null;
  score: number;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\s*\d+[\.\):\-]\s*/, "")
    .replace(/\s*[|\u2013\u2014\-]\s*[^|]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scorePair(email: MatchableEmail, schedule: MatchableSchedule): number {
  const title = normalize(email.title);
  const name = normalize(schedule.name);
  const ghlSubject = normalize(schedule.subject);
  const emailSubjects = (email.subjects || []).map(normalize).filter(Boolean);
  if (!title && !emailSubjects.length) return 0;
  if (title && name && title === name) return 100;
  if (title && ghlSubject && title === ghlSubject) return 92;
  if (emailSubjects.some((s) => s && (s === name || s === ghlSubject))) return 90;
  if (title && name && (name.includes(title) || title.includes(name))) {
    return Math.min(89, 70 + Math.min(title.length, name.length));
  }
  if (
    title &&
    ghlSubject &&
    (ghlSubject.includes(title) || title.includes(ghlSubject))
  ) {
    return Math.min(85, 60 + Math.min(title.length, ghlSubject.length));
  }
  return 0;
}

const MIN_SCORE = 60;

export function matchEmailsToGhlSchedules(
  emails: MatchableEmail[],
  schedules: MatchableSchedule[]
): EmailScheduleMatch[] {
  const used = new Set<string>();
  const pairs: Array<{ emailId: string; scheduleId: string; score: number }> =
    [];
  for (const email of emails) {
    for (const schedule of schedules) {
      const score = scorePair(email, schedule);
      if (score >= MIN_SCORE) {
        pairs.push({ emailId: email.id, scheduleId: schedule.id, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const assigned = new Map<string, { scheduleId: string; score: number }>();
  for (const pair of pairs) {
    if (assigned.has(pair.emailId) || used.has(pair.scheduleId)) continue;
    assigned.set(pair.emailId, {
      scheduleId: pair.scheduleId,
      score: pair.score,
    });
    used.add(pair.scheduleId);
  }
  const byId = new Map(schedules.map((s) => [s.id, s]));
  return emails.map((email) => {
    const hit = assigned.get(email.id);
    const schedule = hit ? byId.get(hit.scheduleId) || null : null;
    return { emailId: email.id, schedule, score: hit?.score || 0 };
  });
}
