import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterConversionLogRows,
  sortConversionLogRows,
  type ConversionLogRow,
} from "../src/lib/conversion-log";

function row(
  partial: Partial<ConversionLogRow> &
    Pick<ConversionLogRow, "id" | "conversionAt" | "clientName" | "kind">
): ConversionLogRow {
  return {
    clientId: "c1",
    contactId: null,
    contactName: null,
    contactEmail: null,
    formFilledAt: null,
    sendId: "s1",
    sendName: "Send",
    sendChannel: "campaign",
    sendOn: "2026-09-01",
    subject: null,
    emailTouchDay: null,
    ...partial,
  };
}

describe("sortConversionLogRows", () => {
  it("orders newest conversion first", () => {
    const a = row({
      id: "a",
      conversionAt: "2026-09-01",
      clientName: "Alpha",
      kind: "form_fill",
    });
    const b = row({
      id: "b",
      conversionAt: "2026-09-10",
      clientName: "Beta",
      kind: "appointment",
    });
    assert.deepEqual([b, a].sort(sortConversionLogRows), [b, a]);
    assert.deepEqual([a, b].sort(sortConversionLogRows), [b, a]);
  });
});

describe("filterConversionLogRows", () => {
  it("filters by kind", () => {
    const rows = [
      row({
        id: "1",
        conversionAt: "2026-09-10",
        clientName: "A",
        kind: "appointment",
      }),
      row({
        id: "2",
        conversionAt: "2026-09-09",
        clientName: "B",
        kind: "form_fill",
      }),
    ];
    assert.equal(filterConversionLogRows(rows, "all").length, 2);
    assert.equal(filterConversionLogRows(rows, "appointment").length, 1);
    assert.equal(filterConversionLogRows(rows, "form_fill")[0].id, "2");
  });
});
