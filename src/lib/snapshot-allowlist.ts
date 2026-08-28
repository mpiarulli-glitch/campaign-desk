// Visible allowlist for team-facing account snapshots.
//
// Other clients stay in the database and in the rest of the app (revenue,
// calendar, the weekly Client Services ask). They just do not appear on the
// snapshot pick-list, the behind report, or the team fill desk until they are
// added here. Phrases are what Michael typed; matching is fuzzy because the
// stored name may differ in punctuation, spelling, or a word ("Medspa" vs "Spa").

export const SNAPSHOT_ALLOWLIST_NAMES = [
  "Betterlife Coach",
  "Pacific Coast Generation",
  "HR Innovator Group",
  "Looda House Pawn",
  "Our Watch / tim thompson",
  "Hendo's Barrel House",
  "Ecoworkz",
  "CISCo Restauraunt + Bar",
  "Pipe It Right",
  "CIPO Cloud Software",
  "Guardian Plumbers",
  "Vitatherapy Wellness Spa",
  "12 Volt Power",
  "Kentina Hospitality",
  "Krak Boba Corporate",
] as const;

function fold(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(raw: string): string[] {
  return fold(raw).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function similarToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 5 && Math.abs(a.length - b.length) <= 2 && levenshtein(a, b) <= 2) return true;
  return false;
}

/** One allowlist phrase against one stored client name. */
export function allowlistPhraseMatches(phrase: string, clientName: string): boolean {
  const pFold = fold(phrase);
  const cFold = fold(clientName);
  if (!pFold || !cFold) return false;
  if (pFold === cFold) return true;
  if (cFold.includes(pFold) || pFold.includes(cFold)) return true;
  for (const part of phrase.split("/")) {
    const f = fold(part);
    if (f && (cFold === f || cFold.includes(f) || f.includes(cFold))) return true;
  }
  const pt = tokens(phrase);
  const ct = tokens(clientName);
  if (!pt.length) return false;
  return pt.every((t) => ct.some((c) => similarToken(t, c)));
}

export function isSnapshotAllowlisted(name: string): boolean {
  return SNAPSHOT_ALLOWLIST_NAMES.some((phrase) => allowlistPhraseMatches(phrase, name));
}

export function unmatchedAllowlistNames(clientNames: string[]): string[] {
  return SNAPSHOT_ALLOWLIST_NAMES.filter(
    (phrase) => !clientNames.some((name) => allowlistPhraseMatches(phrase, name))
  );
}

export function filterSnapshotAllowlisted<T extends { name: string }>(rows: T[]): T[] {
  return rows.filter((row) => isSnapshotAllowlisted(row.name));
}
