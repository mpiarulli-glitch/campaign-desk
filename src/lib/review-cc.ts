// Campaign review notes (internal to-do and client approval card) always CC
// Sylvia. The visible copy is "CC: @Sylvia"; the ping is a real Basecamp
// mention when we can resolve her on the account.

import { SYLVIA_BASECAMP_NAME } from "./people";

export const SYLVIA_CC_TEXT = "CC: @Sylvia";

export function findSylviaOnRoster<
  T extends { name: string; client?: boolean; isClient?: boolean },
>(people: T[]): T | null {
  const team = people.filter((person) => !person.client && !person.isClient);
  if (!team.length) return null;

  const mapped = SYLVIA_BASECAMP_NAME.trim().toLowerCase();
  const exact = team.find((person) => person.name.trim().toLowerCase() === mapped);
  if (exact) return exact;

  const byFirst = team.filter(
    (person) => person.name.trim().toLowerCase().split(/\s+/)[0] === "sylvia"
  );
  return byFirst.length === 1 ? byFirst[0] : null;
}

export function sylviaCcHtml(mention?: string): string {
  const tag = (mention || "").trim() || "@Sylvia";
  return `<p>CC: ${tag}</p>`;
}

export function stripSylviaCcLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^CC:\s*@Sylvia\s*$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
