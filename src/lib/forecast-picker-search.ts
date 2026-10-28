// Search for the Forecast add-task project picker.
//
// Case-insensitive. A query matches when it is a substring of the name, when
// it is a substring after punctuation is folded away ("todo" hits "To-Do's"),
// or when any word in the name starts with it ("leader" hits "Leadership").
// Several words must each match. This file stays free of server imports so the
// forecast page can use it.

export type ForecastPickerMatchRank = 0 | 1 | 2;

function wordsOf(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function folded(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function tokenRank(name: string, token: string): ForecastPickerMatchRank | null {
  const raw = name.toLowerCase();
  if (raw.startsWith(token)) return 0;
  if (wordsOf(raw).some((word) => word.startsWith(token))) return 1;
  if (raw.includes(token) || folded(raw).includes(folded(token))) return 2;
  return null;
}

/**
 * 0 when the name starts with the query, 1 when a word does, 2 for a
 * substring anywhere, or null when it does not match.
 */
export function forecastPickerMatchRank(
  name: string,
  query: string
): ForecastPickerMatchRank | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const raw = (name || "").toLowerCase();
  if (raw.startsWith(query.trim().toLowerCase())) return 0;
  let worst: ForecastPickerMatchRank = 0;
  for (const token of tokens) {
    const rank = tokenRank(name || "", token);
    if (rank == null) return null;
    if (rank > worst) worst = rank;
  }
  return worst;
}

export function forecastPickerMatches(name: string, query: string): boolean {
  return forecastPickerMatchRank(name, query) != null;
}

/** Leading matches, then word-start matches, then substring matches. */
export function rankForecastPickerOptions<T extends { name: string }>(
  options: readonly T[],
  query: string
): T[] {
  const q = query.trim();
  if (!q) return [...options];
  const ranked: [T[], T[], T[]] = [[], [], []];
  for (const option of options) {
    const rank = forecastPickerMatchRank(option.name, q);
    if (rank == null) continue;
    ranked[rank].push(option);
  }
  return [...ranked[0], ...ranked[1], ...ranked[2]];
}
