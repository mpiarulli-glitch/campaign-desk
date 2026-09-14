import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORM_FILL_TAGS } from "../src/lib/email-conversion-attribution";

/**
 * Pure helpers mirroring listFormFillEventsFromTags date picking.
 * (Networked listFormSubmissionEvents is covered via integration when GHL is up.)
 */
function pickFormFillDay(input: {
  dateAdded: string | null;
  dateUpdated: string | null;
  start: string;
  end: string;
}): string | null {
  const ymd = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  };
  const inRange = (day: string | null, start: string, end: string) =>
    Boolean(day && day >= start && day <= end);

  const added = ymd(input.dateAdded);
  const updated = ymd(input.dateUpdated);
  if (inRange(added, input.start, input.end)) return added;
  if (inRange(updated, input.start, input.end)) return updated;
  return null;
}

describe("form fill day picking (tag fallback)", () => {
  it("keeps contacts created in-window (Superior Patios style)", () => {
    assert.equal(
      pickFormFillDay({
        dateAdded: "2026-08-01",
        dateUpdated: "2026-08-01",
        start: "2025-09-14",
        end: "2026-09-14",
      }),
      "2026-08-01"
    );
  });

  it("recovers older contacts updated in-window (PCG/Ecoworkz style)", () => {
    // Contact created years ago, form tag applied / contact touched recently.
    assert.equal(
      pickFormFillDay({
        dateAdded: "2022-03-01",
        dateUpdated: "2026-07-15",
        start: "2025-09-14",
        end: "2026-09-14",
      }),
      "2026-07-15"
    );
  });

  it("still drops contacts with no in-window dates", () => {
    assert.equal(
      pickFormFillDay({
        dateAdded: "2022-03-01",
        dateUpdated: "2023-01-01",
        start: "2025-09-14",
        end: "2026-09-14",
      }),
      null
    );
  });

  it("documents the website form submission tag", () => {
    assert.deepEqual([...FORM_FILL_TAGS], ["website form submission"]);
  });
});
