import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttributionSend } from "../src/lib/email-conversion-attribution";
import {
  assembleAttribution,
  confirmedCreditForEvent,
  groupAttributionByContent,
  inferCreditFromMessages,
  isHipaaBlockedAccount,
  resolveConvertedFieldIds,
  summarizeAttributionRows,
  type ResolvedConvertedFields,
} from "../src/lib/utm-conversion-attribution";

/**
 * Shapes below follow GoHighLevel contact, custom-field, and conversation
 * payloads (customFields[{id,value|fieldValue}], attributionSource /
 * lastAttributionSource, TYPE_EMAIL / TYPE_SMS).
 */

const FIELD_DEFS = [
  {
    id: "cf_campaign",
    name: "Converted Campaign",
    fieldKey: "contact.converted_campaign",
    dataType: "TEXT",
    model: "contact",
  },
  {
    id: "cf_content",
    name: "Converted Content",
    fieldKey: "contact.converted_content",
    dataType: "TEXT",
  },
  {
    id: "cf_source",
    name: "Converted Source",
    fieldKey: "contact.converted_source",
    dataType: "TEXT",
  },
  {
    id: "cf_date",
    name: "Converted Date",
    fieldKey: "contact.converted_date",
    dataType: "DATE",
  },
];

const SENDS: AttributionSend[] = [
  {
    id: "camp_other",
    name: "Weekly tips for busy families",
    subject: "Weekly tips for busy families today",
    sentOn: "2026-10-11",
    channel: "campaign",
  },
  {
    id: "camp_midterm",
    name: "Krak October midterms",
    subject: "Your October midterm offer is live",
    sentOn: "2026-10-11",
    channel: "campaign",
  },
];

function avaContact(): Record<string, unknown> {
  return {
    id: "contact_ava",
    firstName: "Ava",
    lastName: "Nguyen",
    email: "ava@example.com",
    phone: "+15555550123",
    tags: ["website form submission", "meeting booked", "converted-krak-oct26-midterms"],
    dateAdded: "2026-09-02T15:04:11.000Z",
    dateUpdated: "2026-10-13T18:22:11.000Z",
    customFields: [
      { id: "cf_campaign", value: "krak-oct26-midterms" },
      { id: "cf_content", value: "email-01" },
      { id: "cf_source", value: "email" },
      { id: "cf_date", value: "2026-10-13" },
    ],
    attributionSource: {
      sessionSource: "Paid Search",
      url: "https://offers.example.com/?utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_content=ad-1",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "brand",
      utmContent: "ad-1",
    },
    lastAttributionSource: {
      sessionSource: "Email",
      medium: "email",
      utmSource: "email",
      utmMedium: "email marketing",
      utmCampaign: "krak-oct26-midterms",
      utmContent: "email-02",
      url: "https://offers.example.com/midterms?utm_source=email&utm_medium=email%20marketing&utm_campaign=krak-oct26-midterms&utm_content=email-02",
    },
  };
}

describe("resolveConvertedFieldIds", () => {
  it("maps fields by display name and ignores unrelated fields", () => {
    const ids = resolveConvertedFieldIds([
      ...FIELD_DEFS,
      { id: "cf_other", name: "Favorite location", fieldKey: "contact.favorite_location" },
    ]);
    assert.deepEqual(ids, {
      campaignId: "cf_campaign",
      contentId: "cf_content",
      sourceId: "cf_source",
      dateId: "cf_date",
    });
  });

  it("falls back to fieldKey when the label is missing", () => {
    const ids = resolveConvertedFieldIds([
      { id: "a", fieldKey: "contact.converted_content" },
      { id: "b", name: "Converted Source" },
    ]);
    assert.equal(ids.contentId, "a");
    assert.equal(ids.sourceId, "b");
    assert.equal(ids.campaignId, null);
  });
});

describe("confirmed UTM credit", () => {
  const ids = resolveConvertedFieldIds(FIELD_DEFS);

  it("prefers Converted fields over Latest attribution", () => {
    const credit = confirmedCreditForEvent(avaContact(), "2026-10-13T18:11:00.000Z", ids, 1);
    assert.equal(credit?.basis, "converted_fields");
    assert.equal(credit?.confidence, "confirmed");
    assert.equal(credit?.source, "email");
    assert.equal(credit?.content, "email-01");
    assert.equal(credit?.campaign, "krak-oct26-midterms");
    assert.equal(credit?.convertedOn, "2026-10-13");
  });

  it("reads fieldValue and a US date", () => {
    const contact = {
      id: "contact_fieldvalue",
      customFields: [
        { id: "cf_campaign", fieldValue: "krak-oct26" },
        { id: "cf_content", fieldValue: "sms-1013" },
        { id: "cf_source", fieldValue: "SMS" },
        { id: "cf_date", fieldValue: "10/13/2026" },
      ],
    };
    const credit = confirmedCreditForEvent(contact, "2026-10-13", ids, 1);
    assert.equal(credit?.source, "sms");
    assert.equal(credit?.content, "sms-1013");
    assert.equal(credit?.convertedOn, "2026-10-13");
  });

  it("uses Latest, then First, when Converted fields are absent", () => {
    const latestOnly = {
      id: "contact_latest",
      last_attribution_source: {
        utm_source: "sms",
        utm_campaign: "krak-oct26",
        utm_content: "sms-1013",
      },
      attributionSource: {
        utmSource: "email",
        utmCampaign: "older",
        utmContent: "email-00",
      },
    };
    const latest = confirmedCreditForEvent(latestOnly, "2026-10-13", ids, 1);
    assert.equal(latest?.basis, "latest_utm");
    assert.equal(latest?.source, "sms");
    assert.equal(latest?.content, "sms-1013");

    const firstOnly = {
      id: "contact_first",
      lastAttributionSource: {
        utmSource: "google",
        utmCampaign: "brand",
        utmContent: "ad-1",
      },
      attributionSource: {
        utmSource: "email",
        utmCampaign: "krak-oct26-midterms",
        utmContent: "email-01",
      },
    };
    const first = confirmedCreditForEvent(firstOnly, "2026-10-13", ids, 1);
    assert.equal(first?.basis, "first_utm");
    assert.equal(first?.content, "email-01");
    assert.equal(first?.source, "email");
  });

  it("parses UTMs from the landing URL when the fields are blank", () => {
    const contact = {
      id: "contact_url",
      lastAttributionSource: {
        sessionSource: "Email",
        url: "https://offers.example.com/midterms?utm_source=email&utm_medium=email%20marketing&utm_campaign=krak-oct26-midterms&utm_content=email-02",
      },
    };
    const credit = confirmedCreditForEvent(contact, "2026-10-12", ids, 1);
    assert.equal(credit?.basis, "latest_utm");
    assert.equal(credit?.content, "email-02");
    assert.equal(credit?.campaign, "krak-oct26-midterms");
  });

  it("does not treat a paid click as an email or SMS", () => {
    const contact = {
      id: "contact_ads",
      attributionSource: {
        utmSource: "facebook",
        utmMedium: "paid",
        utmCampaign: "retargeting",
        utmContent: "video-3",
      },
      lastAttributionSource: {
        utmSource: "google",
        utmCampaign: "brand",
        utmContent: "ad-1",
      },
    };
    assert.equal(confirmedCreditForEvent(contact, "2026-10-13", ids, 1), null);
  });

  it("keeps Converted fields on the stamped day and uses Latest for an earlier event", () => {
    const contact = avaContact();
    const booking = confirmedCreditForEvent(contact, "2026-10-13T18:00:00.000Z", ids, 2);
    const form = confirmedCreditForEvent(contact, "2026-10-01T15:00:00.000Z", ids, 2);
    assert.equal(booking?.basis, "converted_fields");
    assert.equal(booking?.content, "email-01");
    assert.equal(form?.basis, "latest_utm");
    assert.equal(form?.content, "email-02");
  });
});

describe("inferred thread credit", () => {
  const openedEmail = {
    id: "msg_email_1",
    contactId: "contact_ava",
    conversationId: "conv_ava",
    direction: "outbound",
    messageType: "TYPE_EMAIL",
    type: 3,
    status: "opened",
    source: "campaign",
    subject: "Your October midterm offer is live",
    body: "Book here before Friday.",
    dateAdded: "2026-10-11T16:02:00.000Z",
    campaignId: "camp_midterm",
    meta: { emailStatus: "opened" },
  };

  it("credits the opened email on the thread, not the other blast sent that day", () => {
    const credit = inferCreditFromMessages({
      messages: [openedEmail],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:11:00.000Z",
      kind: "form_fill",
      sends: SENDS,
    });
    assert.equal(credit?.confidence, "inferred");
    assert.equal(credit?.source, "email");
    assert.equal(credit?.sendId, "camp_midterm");
    assert.equal(credit?.matchedBy, "campaign_id");
    assert.equal(credit?.content, "Your October midterm offer is live");
    assert.notEqual(credit?.sendId, "camp_other");
  });

  it("names the thread subject when no send matches, and ignores the account blast", () => {
    const credit = inferCreditFromMessages({
      messages: [{ ...openedEmail, campaignId: "", subject: "Your October midterm offer is live" }],
      contactId: "contact_ava",
      eventAt: "2026-10-13",
      kind: "form_fill",
      sends: [SENDS[0]],
    });
    assert.equal(credit?.sendId, null);
    assert.equal(credit?.matchedBy, "thread");
    assert.equal(credit?.content, "Your October midterm offer is live");
  });

  it("does not credit a form when the email was only delivered", () => {
    const credit = inferCreditFromMessages({
      messages: [{ ...openedEmail, status: "delivered", meta: { emailStatus: "delivered" } }],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:11:00.000Z",
      kind: "form_fill",
      sends: SENDS,
    });
    assert.equal(credit, null);
  });

  it("counts an unopened marketing email toward a booking", () => {
    const credit = inferCreditFromMessages({
      messages: [{ ...openedEmail, status: "delivered", meta: { status: "delivered" } }],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:11:00.000Z",
      kind: "appointment",
      sends: SENDS,
    });
    assert.equal(credit?.source, "email");
    assert.equal(credit?.sendId, "camp_midterm");
  });

  it("drops mail from outside the 5-day window and mail after the form", () => {
    const early = inferCreditFromMessages({
      messages: [{ ...openedEmail, dateAdded: "2026-10-01T16:00:00.000Z" }],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:11:00.000Z",
      kind: "form_fill",
      sends: SENDS,
    });
    assert.equal(early, null);
    const after = inferCreditFromMessages({
      messages: [{ ...openedEmail, dateAdded: "2026-10-13T19:00:00.000Z" }],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:11:00.000Z",
      kind: "form_fill",
      sends: SENDS,
    });
    assert.equal(after, null);
  });

  it("does not count an empty thread just because the account mailed that day", () => {
    const credit = inferCreditFromMessages({
      messages: [],
      contactId: "contact_ava",
      eventAt: "2026-10-13",
      kind: "appointment",
      sends: SENDS,
    });
    assert.equal(credit, null);
  });

  it("credits an outbound SMS on the thread and reads UTMs from its link", () => {
    const credit = inferCreditFromMessages({
      messages: [
        {
          id: "msg_sms_1",
          contactId: "contact_ava",
          direction: "outbound",
          messageType: "TYPE_SMS",
          type: 2,
          status: "delivered",
          body: "Midterms this week. https://offers.example.com/book?utm_source=sms&utm_medium=sms&utm_campaign=krak-oct26&utm_content=sms-1013",
          dateAdded: "2026-10-12T15:04:00.000Z",
        },
      ],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:00:00.000Z",
      kind: "form_fill",
      sends: SENDS,
    });
    assert.equal(credit?.source, "sms");
    assert.equal(credit?.content, "sms-1013");
    assert.equal(credit?.campaign, "krak-oct26");
    assert.equal(credit?.matchedBy, "thread");
    assert.equal(credit?.sendId, null);
  });

  it("ignores inbound SMS, failed SMS, and appointment confirmations", () => {
    const base = {
      contactId: "contact_ava",
      messageType: "TYPE_SMS",
      type: 2,
      dateAdded: "2026-10-12T15:04:00.000Z",
    };
    assert.equal(
      inferCreditFromMessages({
        messages: [{ ...base, direction: "inbound", body: "YES book me", status: "delivered" }],
        contactId: "contact_ava",
        eventAt: "2026-10-13",
        kind: "appointment",
      }),
      null
    );
    assert.equal(
      inferCreditFromMessages({
        messages: [{ ...base, direction: "outbound", body: "See you soon", status: "undelivered" }],
        contactId: "contact_ava",
        eventAt: "2026-10-13",
        kind: "appointment",
      }),
      null
    );
    assert.equal(
      inferCreditFromMessages({
        messages: [
          {
            ...base,
            direction: "outbound",
            status: "delivered",
            body: "Your consultation has been scheduled.",
          },
        ],
        contactId: "contact_ava",
        eventAt: "2026-10-13",
        kind: "appointment",
      }),
      null
    );
  });

  it("does not let a post-form confirmation email count as the booking driver", () => {
    const credit = inferCreditFromMessages({
      messages: [
        {
          id: "msg_confirm",
          contactId: "contact_ava",
          direction: "outbound",
          messageType: "TYPE_EMAIL",
          type: 3,
          status: "delivered",
          source: "workflow",
          subject: "Your consultation has been scheduled",
          body: "We booked your visit.",
          dateAdded: "2026-10-12T17:00:00.000Z",
        },
      ],
      contactId: "contact_ava",
      eventAt: "2026-10-13T18:00:00.000Z",
      kind: "appointment",
      formFilledAt: "2026-10-12",
      sends: SENDS,
    });
    assert.equal(credit, null);
  });
});

describe("assembleAttribution", () => {
  const ids: ResolvedConvertedFields = resolveConvertedFieldIds(FIELD_DEFS);

  it("keeps confirmed credit and does not also infer the same event", () => {
    const rows = assembleAttribution({
      contacts: [avaContact()],
      fieldIds: ids,
      events: [
        {
          id: "form:ava",
          contactId: "contact_ava",
          at: "2026-10-13T18:11:00.000Z",
          kind: "form_fill",
        },
      ],
      inferredByEventId: {
        "form:ava": {
          confidence: "inferred",
          basis: "inferred",
          source: "sms",
          campaign: "should-not-win",
          content: "sms-should-not-win",
          sendId: null,
          sendOn: "2026-10-12",
          subject: null,
          matchedBy: "thread",
        },
      },
      start: "2026-10-01",
      end: "2026-10-16",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].confidence, "confirmed");
    assert.equal(rows[0].content, "email-01");
    assert.equal(rows[0].contactName, "Ava Nguyen");
  });

  it("uses inference only when UTM credit is missing", () => {
    const rows = assembleAttribution({
      contacts: [{ id: "contact_ava", firstName: "Ava", email: "ava@example.com" }],
      fieldIds: ids,
      events: [
        {
          id: "appt:ava",
          contactId: "contact_ava",
          at: "2026-10-13",
          kind: "appointment",
        },
      ],
      inferredByEventId: {
        "appt:ava": {
          confidence: "inferred",
          basis: "inferred",
          source: "email",
          campaign: "Krak October midterms",
          content: "Your October midterm offer is live",
          sendId: "camp_midterm",
          sendOn: "2026-10-11",
          subject: "Your October midterm offer is live",
          matchedBy: "subject",
        },
      },
      start: "2026-10-01",
      end: "2026-10-16",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].confidence, "inferred");
    assert.equal(rows[0].matchedBy, "subject");
    assert.equal(rows[0].sendId, "camp_midterm");
  });

  it("adds one confirmed row from Converted Date when the event APIs returned nothing", () => {
    const rows = assembleAttribution({
      contacts: [
        {
          ...avaContact(),
          tags: ["meeting booked", "converted-krak-oct26-midterms"],
        },
      ],
      fieldIds: ids,
      events: [],
      start: "2026-10-01",
      end: "2026-10-16",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "appointment");
    assert.equal(rows[0].basis, "converted_fields");
    assert.equal(rows[0].content, "email-01");
  });

  it("groups by content, source, campaign, and proof", () => {
    const rows = assembleAttribution({
      contacts: [
        avaContact(),
        {
          id: "contact_ben",
          firstName: "Ben",
          email: "ben@example.com",
          tags: ["website form submission"],
          customFields: [
            { id: "cf_campaign", value: "krak-oct26" },
            { id: "cf_content", value: "sms-1013" },
            { id: "cf_source", value: "sms" },
            { id: "cf_date", value: "2026-10-12" },
          ],
        },
      ],
      fieldIds: ids,
      events: [
        {
          id: "form:ava",
          contactId: "contact_ava",
          at: "2026-10-13",
          kind: "form_fill",
        },
        {
          id: "form:ben",
          contactId: "contact_ben",
          at: "2026-10-12",
          kind: "form_fill",
        },
        {
          id: "appt:ava",
          contactId: "contact_ava",
          at: "2026-10-13",
          kind: "appointment",
        },
      ],
      start: "2026-10-01",
      end: "2026-10-16",
    });
    const summary = summarizeAttributionRows(rows);
    assert.equal(summary.confirmedFormFills, 2);
    assert.equal(summary.confirmedAppointments, 1);
    assert.equal(summary.inferredAppointments, 0);
    assert.equal(summary.emailFormFills, 1);
    assert.equal(summary.smsFormFills, 1);
    assert.equal(summary.attributedAppointments, 1);
    const groups = groupAttributionByContent(
      rows.map((row) => ({ ...row, clientId: "krak", clientName: "Krak Boba" }))
    );
    const email = groups.find((group) => group.content === "email-01");
    const sms = groups.find((group) => group.content === "sms-1013");
    assert.equal(email?.source, "email");
    assert.equal(email?.confidence, "confirmed");
    assert.equal(email?.appointments, 1);
    assert.equal(email?.formFills, 1);
    assert.equal(email?.campaign, "krak-oct26-midterms");
    assert.equal(sms?.source, "sms");
    assert.equal(sms?.formFills, 1);
    assert.equal(sms?.campaign, "krak-oct26");
  });
});

describe("HIPAA account guard", () => {
  it("blocks Trailhead Family Chiropractic and not nearby names", () => {
    assert.equal(isHipaaBlockedAccount("Trailhead Family Chiropractic"), true);
    assert.equal(isHipaaBlockedAccount("  trailhead family chiropractic "), true);
    assert.equal(isHipaaBlockedAccount("Trailhead Family Chiropractic LLC"), true);
    assert.equal(isHipaaBlockedAccount("Trailhead Marketing"), false);
    assert.equal(isHipaaBlockedAccount("Family Chiropractic"), false);
    assert.equal(isHipaaBlockedAccount("MEG Ops"), false);
  });
});
