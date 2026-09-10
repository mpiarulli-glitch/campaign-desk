import type { CadenceUnit, DeliverableKind } from "./db";

/** Language that means this deliverable resets on a schedule. */
const RECURRING_PHRASE =
  /\b(?:weekly|bi-?weekly|every other week|fortnightly|monthly|bi-?monthly|per month|each month|every month|\/\s*mo(?:nth)?\b|x\s*\/\s*mo|times a month|hours?\/mo|hrs\/mo|hours?\s*(?:per|\/)\s*mo(?:nth)?|hours?\s+monthly|\d+\s*hours?\s+monthly|quarterly|per quarter|each quarter|every quarter|updated quarterly|annually|yearly|per year|ongoing|recurring|continuous|posts?\/(?:wk|week)|x\/wk|per week|each week|every week|\/(?:wk|week))\b/i;

export function isExplicitlyRecurring(
  name: string,
  cadence = ""
): boolean {
  return RECURRING_PHRASE.test(`${name} ${cadence}`.trim());
}

export function inferDeliverableKind(
  name: string,
  cadence = "",
  requested?: DeliverableKind | null
): DeliverableKind {
  if (requested === "one_time") return "one_time";
  if (isExplicitlyRecurring(name, cadence)) return "recurring";
  if (requested === "recurring") return "recurring";
  return "one_time";
}

export function inferDeliverableCadenceLabel(
  name: string,
  cadence: string,
  kind?: DeliverableKind
): string {
  const trimmed = cadence.trim();
  const recurring =
    kind === "recurring" || isExplicitlyRecurring(name, trimmed);
  if (recurring) {
    if (trimmed && !/^daily$/i.test(trimmed) && !/^one[- ]?time$/i.test(trimmed)) {
      return trimmed;
    }
    return trimmed && !/^daily$/i.test(trimmed) ? trimmed : "Monthly";
  }
  if (!trimmed || /^daily$/i.test(trimmed) || /^ongoing$/i.test(trimmed)) {
    return "One-time";
  }
  return trimmed;
}

export function inferCadenceUnit(name: string, cadence = ""): CadenceUnit {
  const blob = `${name} ${cadence}`.toLowerCase();
  if (/\b(weekly|bi-?weekly|every other week|fortnightly|per week|\/wk|posts?\/wk)\b/.test(blob)) {
    return "weekly";
  }
  if (/\b(quarterly|per quarter|updated quarterly|annually|yearly|per year)\b/.test(blob)) {
    return "quarterly";
  }
  return "monthly";
}
