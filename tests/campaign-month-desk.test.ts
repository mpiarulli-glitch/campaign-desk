import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  MONTH_DESK_CLIENT_DONE_STATUSES,
  MONTH_DESK_NEXT_MONTH_RULE,
  MONTH_DESK_SENT_FOR_INTERNAL_APPROVAL,
  MONTH_DESK_THIS_MONTH_RULE,
  buildMonthDesk,
  countsForMonth,
  countsTowardNextMonthDesk,
  countsTowardThisMonthDesk,
  deliverableText,
  deliverableTone,
  needsApprovalByTheFirst,
  sortDeskCards,
  type MonthDeskClientInput,
} from "../src/lib/campaign-month-desk";

const NOW = new Date("2026-10-27T17:00:00.000Z");

describe("campaign month desk", () => {
  test("the status rules are the ones on the cards", () => {
    assert.equal(
      MONTH_DESK_NEXT_MONTH_RULE,
      "Next month counts once sent for internal approval"
    );
    assert.equal(
      MONTH_DESK_THIS_MONTH_RULE,
      "This month counts once the client approves"
    );
    assert.deepEqual(MONTH_DESK_SENT_FOR_INTERNAL_APPROVAL, [
      "internal_review",
      "needs_revisions_internal",
      "revisions_made",
      "in_review",
      "needs_changes",
      "approved",
      "scheduled",
      "sent",
      "live",
    ]);
    assert.deepEqual(MONTH_DESK_CLIENT_DONE_STATUSES, ["scheduled", "sent", "live"]);
  });

  test("next month counts from internal review onward, and flags only what is earlier", () => {
    for (const status of MONTH_DESK_SENT_FOR_INTERNAL_APPROVAL) {
      assert.equal(countsTowardNextMonthDesk(status), true, status);
      assert.equal(needsApprovalByTheFirst(status), false, status);
    }
    assert.equal(countsTowardNextMonthDesk("draft"), false);
    assert.equal(needsApprovalByTheFirst("draft"), true);
    assert.equal(countsTowardNextMonthDesk("building"), false);
    assert.equal(needsApprovalByTheFirst("building"), true);
    assert.equal(countsTowardNextMonthDesk("approved", "internal"), true);
    assert.equal(needsApprovalByTheFirst("approved", "internal"), false);
  });

  test("this month counts client approval, scheduled, sent, and live only", () => {
    assert.equal(countsTowardThisMonthDesk("approved", "client"), true);
    assert.equal(countsTowardThisMonthDesk("approved", null), true);
    assert.equal(countsTowardThisMonthDesk("approved", ""), true);
    assert.equal(countsTowardThisMonthDesk("scheduled"), true);
    assert.equal(countsTowardThisMonthDesk("sent"), true);
    assert.equal(countsTowardThisMonthDesk("live"), true);

    assert.equal(countsTowardThisMonthDesk("approved", "internal"), false);
    assert.equal(countsTowardThisMonthDesk("draft"), false);
    assert.equal(countsTowardThisMonthDesk("internal_review"), false);
    assert.equal(countsTowardThisMonthDesk("needs_revisions_internal"), false);
    assert.equal(countsTowardThisMonthDesk("revisions_made"), false);
    assert.equal(countsTowardThisMonthDesk("in_review"), false);
    assert.equal(countsTowardThisMonthDesk("needs_changes"), false);
  });

  test("progress colors: green when complete, amber when partial, red only when this month is empty", () => {
    assert.equal(deliverableTone("this", 2, 2), "complete");
    assert.equal(deliverableTone("next", 2, 2), "complete");
    assert.equal(deliverableTone("this", 1, 2), "partial");
    assert.equal(deliverableTone("next", 1, 2), "partial");
    assert.equal(deliverableTone("next", 0, 2), "partial");
    assert.equal(deliverableTone("this", 0, 2), "behind");
    assert.equal(deliverableTone("this", 2, 0), "unset");
    assert.equal(deliverableText(2, 2), "2/2");
    assert.equal(deliverableText(1, 2), "1/2");
    assert.equal(deliverableText(2, 0), "2");
  });

  test("counts for month prefers the stored month, then the send, then created", () => {
    assert.equal(
      countsForMonth(
        {
          board_period: "2026-12",
          scheduled_send_at: "2026-11-15T20:00:00.000Z",
          created_at: "2026-10-02T18:00:00.000Z",
        },
        NOW
      ),
      "2026-12"
    );
    assert.equal(
      countsForMonth(
        {
          board_period: null,
          scheduled_send_at: "2026-11-01T06:30:00.000Z",
          created_at: "2026-10-02T18:00:00.000Z",
        },
        NOW
      ),
      "2026-10"
    );
    assert.equal(
      countsForMonth(
        {
          scheduled_send_at: null,
          email_sends: [null, "2026-11-15T20:00:00.000Z"],
          created_at: "2026-10-02T18:00:00.000Z",
        },
        NOW
      ),
      "2026-11"
    );
    assert.equal(
      countsForMonth(
        {
          created_at: "2026-09-15T18:00:00.000Z",
        },
        NOW
      ),
      "2026-09"
    );
    // A due date is a calendar day. The 1st must stay in that month, not slip
    // back a day when it is read as a UTC instant in Pacific time.
    assert.equal(
      countsForMonth(
        {
          board_period: null,
          scheduled_send_at: null,
          due_on: "2026-11-01",
          created_at: "2026-10-02T18:00:00.000Z",
        },
        NOW
      ),
      "2026-11"
    );
    assert.equal(
      countsForMonth(
        {
          scheduled_send_at: "2026-10-15T18:00:00.000Z",
          due_on: "2026-11-12",
          created_at: "2026-09-01T18:00:00.000Z",
        },
        NOW
      ),
      "2026-10"
    );
    assert.equal(
      countsForMonth(
        {
          due_on: "next friday",
          created_at: "2026-09-15T18:00:00.000Z",
        },
        NOW
      ),
      "2026-09"
    );
  });

  test("a batch of 5 emails counts each email, and the folder lists those same emails", () => {
    const clients: MonthDeskClientInput[] = [
      { id: "eco", name: "Ecoworkz", active: true, monthly_email_quota: 2 },
      { id: "due", name: "Due Date Co", active: true, monthly_email_quota: 2 },
    ];
    const desk = buildMonthDesk({
      now: NOW,
      includeEmptyClients: true,
      clients,
      campaigns: [
        {
          id: "batch",
          title: "November batch",
          client_id: "eco",
          client_name: "Ecoworkz",
          status: "internal_review",
          approved_channel: null,
          board_period: "2026-11",
          created_at: "2026-10-02T18:00:00.000Z",
          emails: [
            { id: "e1", title: "Welcome", kind: "email", scheduled_send_at: "2026-11-03T18:00:00.000Z" },
            { id: "e2", title: "Reminder", kind: "email", scheduled_send_at: "2026-11-10T18:00:00.000Z" },
            { id: "e3", title: "Offer", kind: "email", scheduled_send_at: "2026-11-17T18:00:00.000Z" },
            { id: "e4", title: "Last call", kind: "email", scheduled_send_at: "2026-11-24T18:00:00.000Z" },
            { id: "e5", title: "P.S.", kind: "email", scheduled_send_at: "2026-11-26T18:00:00.000Z" },
            { id: "sms", title: "Text nudge", kind: "sms" },
          ],
        },
        {
          id: "october",
          title: "October batch",
          client_id: "eco",
          client_name: "Ecoworkz",
          status: "approved",
          approved_channel: "client",
          board_period: "2026-10",
          created_at: "2026-09-02T18:00:00.000Z",
          emails: [
            { id: "o1", title: "One", kind: "email" },
            { id: "o2", title: "Two", kind: "email" },
            { id: "o3", title: "Three", kind: "email" },
            { id: "o4", title: "Four", kind: "email" },
            { id: "o5", title: "Five", kind: "email" },
          ],
        },
        {
          id: "internal",
          title: "October internal",
          client_id: "eco",
          client_name: "Ecoworkz",
          status: "approved",
          approved_channel: "internal",
          board_period: "2026-10",
          created_at: "2026-09-02T18:00:00.000Z",
          emails: [
            { id: "i1", title: "A", kind: "email" },
            { id: "i2", title: "B", kind: "email" },
            { id: "i3", title: "C", kind: "email" },
            { id: "i4", title: "D", kind: "email" },
          ],
        },
        {
          id: "pinned-later",
          title: "December batch",
          client_id: "eco",
          client_name: "Ecoworkz",
          status: "internal_review",
          approved_channel: null,
          board_period: "2026-12",
          scheduled_send_at: null,
          created_at: "2026-10-02T18:00:00.000Z",
          emails: [
            { id: "d1", title: "Early", kind: "email", scheduled_send_at: "2026-11-04T18:00:00.000Z" },
            { id: "d2", title: "Mid", kind: "email", scheduled_send_at: "2026-11-11T18:00:00.000Z" },
            { id: "d3", title: "Late", kind: "email", scheduled_send_at: "2026-11-18T18:00:00.000Z" },
            { id: "d4", title: "Final", kind: "email", scheduled_send_at: "2026-11-25T18:00:00.000Z" },
          ],
        },
        {
          id: "due-batch",
          title: "Due batch",
          client_id: "due",
          client_name: "Due Date Co",
          status: "in_review",
          approved_channel: null,
          board_period: null,
          scheduled_send_at: null,
          due_on: "2026-11-18",
          created_at: "2026-10-02T18:00:00.000Z",
          emails: [
            { id: "u1", title: "One", kind: "email" },
            { id: "u2", title: "Two", kind: "email" },
            { id: "u3", title: "Three", kind: "email" },
            { id: "u4", title: "Four", kind: "email" },
          ],
        },
      ],
    });

    const eco = desk.clients.find((client) => client.name === "Ecoworkz")!;
    assert.equal(eco.target, 2);
    assert.equal(eco.nextMonth.done, 5);
    assert.equal(deliverableText(eco.nextMonth.done, eco.target), "5/2");
    assert.equal(eco.nextMonth.tone, "complete");
    assert.equal(eco.nextMonth.needsApproval, 0);
    assert.deepEqual(
      eco.nextMonth.statuses.map((status) => `${status.count} ${status.label}`),
      ["5 Internal Review"]
    );
    const november = eco.months.find((month) => month.period === "2026-11")!;
    assert.equal(november.role, "next");
    assert.equal(november.done, eco.nextMonth.done);
    assert.equal(november.campaigns.length, 5);
    assert.deepEqual(
      november.campaigns.map((campaign) => campaign.emailId),
      ["e1", "e2", "e3", "e4", "e5"]
    );
    assert.deepEqual(
      november.campaigns.map((campaign) => campaign.title),
      [
        "November batch — Welcome",
        "November batch — Reminder",
        "November batch — Offer",
        "November batch — Last call",
        "November batch — P.S.",
      ]
    );
    assert.equal(november.campaigns.every((campaign) => campaign.id === "batch"), true);

    // This month counts client approval only. Five client-approved emails
    // count. Four that are only approved internally do not. The number is
    // the real count over the quota, not capped at 2.
    assert.equal(eco.thisMonth.done, 5);
    assert.equal(deliverableText(eco.thisMonth.done, eco.target), "5/2");
    assert.equal(eco.thisMonth.tone, "complete");
    const october = eco.months.find((month) => month.period === "2026-10")!;
    assert.equal(october.done, eco.thisMonth.done);
    assert.equal(october.campaigns.length, 9);

    const december = eco.months.find((month) => month.period === "2026-12")!;
    assert.equal(december.campaigns.length, 4);
    assert.equal(eco.nextMonth.done, 5);

    const due = desk.clients.find((client) => client.name === "Due Date Co")!;
    assert.equal(due.nextMonth.done, 4);
    const dueNovember = due.months.find((month) => month.period === "2026-11")!;
    assert.equal(dueNovember.done, due.nextMonth.done);
    assert.equal(dueNovember.campaigns.length, 4);
    assert.equal(due.thisMonth.done, 0);
  });

  test("one pass builds every client card, including 2/2, 1/2, and an unset target", () => {
    const clients: MonthDeskClientInput[] = [
      { id: "harbor", name: "Harbor & Co", active: true, monthly_email_quota: 2 },
      { id: "lumen", name: "Lumen Studio", active: true, monthly_email_quota: 2 },
      { id: "north", name: "Northwind Plumbing", active: true, monthly_email_quota: 0 },
      { id: "quiet", name: "Quiet Client", active: true, monthly_email_quota: 2 },
    ];
    const desk = buildMonthDesk({
      now: NOW,
      includeEmptyClients: true,
      clients,
      campaigns: [
        row("h1", "harbor", "Harbor & Co", "approved", "client", "2026-10"),
        row("h2", "harbor", "Harbor & Co", "sent", null, "2026-10"),
        row("h3", "harbor", "Harbor & Co", "internal_review", null, "2026-11"),
        row("h4", "harbor", "Harbor & Co", "draft", null, "2026-11"),
        row("h5", "harbor", "Harbor & Co", "sent", null, "2026-09"),
        row("l1", "lumen", "Lumen Studio", "approved", "client", "2026-10"),
        row("l2", "lumen", "Lumen Studio", "approved", "internal", "2026-10"),
        row("l3", "lumen", "Lumen Studio", "internal_review", null, "2026-11"),
        row("l4", "lumen", "Lumen Studio", "in_review", null, "2026-11"),
        row("n1", "north", "Northwind Plumbing", "sent", null, "2026-10"),
        row("n2", "north", "Northwind Plumbing", "live", null, "2026-10"),
        row("n3", "north", "Northwind Plumbing", "internal_review", null, "2026-11"),
      ],
    });

    assert.equal(desk.period, "2026-10");
    assert.equal(desk.nextPeriod, "2026-11");
    const byName = new Map(desk.clients.map((client) => [client.name, client]));
    assert.equal(byName.size, 4);

    const harbor = byName.get("Harbor & Co")!;
    assert.equal(deliverableText(harbor.thisMonth.done, harbor.target), "2/2");
    assert.equal(harbor.thisMonth.tone, "complete");
    assert.equal(deliverableText(harbor.nextMonth.done, harbor.target), "1/2");
    assert.equal(harbor.nextMonth.tone, "partial");
    assert.equal(harbor.nextMonth.needsApproval, 1);
    assert.deepEqual(
      harbor.nextMonth.statuses.map((status) => `${status.count} ${status.label}`),
      ["1 Draft", "1 Internal Review"]
    );
    assert.deepEqual(
      harbor.months.map((month) => month.period),
      ["2026-11", "2026-10", "2026-09"]
    );
    assert.equal(harbor.months[0].role, "next");
    assert.equal(harbor.months[0].campaigns.length, 2);
    assert.equal(harbor.months[2].campaigns[0].title, "Past");

    const lumen = byName.get("Lumen Studio")!;
    assert.equal(deliverableText(lumen.thisMonth.done, lumen.target), "1/2");
    assert.equal(lumen.thisMonth.tone, "partial");
    assert.equal(deliverableText(lumen.nextMonth.done, lumen.target), "2/2");
    assert.equal(lumen.nextMonth.tone, "complete");
    assert.equal(lumen.nextMonth.needsApproval, 0);

    const north = byName.get("Northwind Plumbing")!;
    assert.equal(north.target, 0);
    assert.equal(deliverableText(north.thisMonth.done, north.target), "2");
    assert.equal(north.thisMonth.tone, "unset");
    assert.equal(deliverableText(north.nextMonth.done, north.target), "1");
    assert.equal(north.nextMonth.tone, "unset");

    const quiet = byName.get("Quiet Client")!;
    assert.equal(quiet.thisMonth.done, 0);
    assert.equal(quiet.thisMonth.tone, "behind");
    assert.equal(quiet.nextMonth.done, 0);
    assert.equal(quiet.nextMonth.needsApproval, 0);

    const attention = sortDeskCards(desk.clients, "attention").map((client) => client.name);
    assert.equal(attention[0], "Harbor & Co");
    assert.ok(attention.indexOf("Harbor & Co") < attention.indexOf("Lumen Studio"));
  });
});

function row(
  id: string,
  clientId: string,
  clientName: string,
  status: string,
  channel: string | null,
  period: string
) {
  return {
    id,
    title: id === "h5" ? "Past" : id,
    client_id: clientId,
    client_name: clientName,
    status,
    approved_channel: channel,
    board_period: period,
    created_at: "2026-08-01T18:00:00.000Z",
  };
}

describe("campaign month desk loader", { concurrency: 1 }, () => {
  test("reuses board_period, does not backfill it, and applies account-manager filtering", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-month-desk-"));
    process.chdir(tmp);

    const { closeDbForTests, getDb } = await import("../src/lib/db");
    const campaigns = await import("../src/lib/campaigns");
    const { createRevClient, updateRevClient } = await import("../src/lib/revenue");
    const { loadCampaignMonthDesk } = await import("../src/lib/campaign-month-desk-load");

    t.after(() => {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const harbor = createRevClient({ name: "Harbor & Co", businessModel: "home_service" });
    const luisClient = createRevClient({ name: "Luis Only Co", businessModel: "home_service" });
    updateRevClient(harbor.id, {
      monthlyEmailQuota: 2,
      accountManager: "cassidy",
      website: "harbor.example",
    });
    updateRevClient(luisClient.id, { monthlyEmailQuota: 2, accountManager: "luis" });
    const { saveClientLogo } = await import("../src/lib/client-logos");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const logo = saveClientLogo(luisClient.id, png, "image/png");
    assert.equal(logo.ok, true);
    if (logo.ok) updateRevClient(luisClient.id, { logoPath: logo.filename });

    const pinned = campaigns.createCampaign({
      title: "November promo",
      clientName: harbor.name,
      clientId: harbor.id,
      htmlContent: "<p>November</p>",
      boardPeriod: "2026-11",
    });
    campaigns.recordInternalReviewTodo(pinned.id, { assignee: "cassidy" });
    campaigns.applyOperatorCampaignStatus(pinned.id, "internal_review");

    const unpinned = campaigns.createCampaign({
      title: "Send in November",
      clientName: harbor.name,
      clientId: harbor.id,
      htmlContent: "<p>Send</p>",
    });
    getDb()
      .prepare(
        `UPDATE campaigns
            SET scheduled_send_at = ?, created_at = ?, board_period = NULL
          WHERE id = ?`
      )
      .run("2026-11-15T20:00:00.000Z", "2026-10-02T18:00:00.000Z", unpinned.id);
    campaigns.applyOperatorCampaignStatus(unpinned.id, "approved", "Client");

    const hidden = campaigns.createCampaign({
      title: "Luis draft",
      clientName: luisClient.name,
      clientId: luisClient.id,
      htmlContent: "<p>Luis</p>",
      boardPeriod: "2026-11",
    });
    campaigns.recordInternalReviewTodo(hidden.id, { assignee: "luis_romero" });
    campaigns.applyOperatorCampaignStatus(hidden.id, "internal_review");

    const ecoworkz = createRevClient({ name: "Ecoworkz", businessModel: "home_service" });
    updateRevClient(ecoworkz.id, { monthlyEmailQuota: 2 });
    const batch = campaigns.createCampaign({
      title: "November batch",
      emailTitle: "Welcome",
      clientName: ecoworkz.name,
      clientId: ecoworkz.id,
      htmlContent: "<p>Welcome</p>",
      boardPeriod: "2026-11",
    });
    for (const title of ["Reminder", "Offer", "Last call", "P.S."]) {
      campaigns.addEmail({
        campaignId: batch.id,
        title,
        htmlContent: `<p>${title}</p>`,
      });
    }
    campaigns.addEmail({
      campaignId: batch.id,
      title: "Text nudge",
      htmlContent: "nudge",
      kind: "sms",
    });
    campaigns.recordInternalReviewTodo(batch.id, { assignee: "cassidy" });
    campaigns.applyOperatorCampaignStatus(batch.id, "internal_review");

    const dueClient = createRevClient({ name: "Due Date Co", businessModel: "home_service" });
    updateRevClient(dueClient.id, { monthlyEmailQuota: 2 });
    const dueBatch = campaigns.createCampaign({
      title: "Due batch",
      emailTitle: "One",
      clientName: dueClient.name,
      clientId: dueClient.id,
      htmlContent: "<p>One</p>",
    });
    for (const title of ["Two", "Three", "Four"]) {
      campaigns.addEmail({
        campaignId: dueBatch.id,
        title,
        htmlContent: `<p>${title}</p>`,
      });
    }
    getDb()
      .prepare(
        `UPDATE campaigns
            SET board_period = NULL, scheduled_send_at = NULL, basecamp_due_on = ?, created_at = ?
          WHERE id = ?`
      )
      .run("2026-11-18", "2026-10-02T18:00:00.000Z", dueBatch.id);
    campaigns.applyOperatorCampaignStatus(dueBatch.id, "in_review");

    assert.equal(campaigns.getCampaignById(pinned.id)!.board_period, "2026-11");
    assert.equal(campaigns.getCampaignById(unpinned.id)!.board_period, null);

    const admin = loadCampaignMonthDesk(
      { role: "admin", person: null },
      null,
      NOW
    );
    const adminHarbor = admin.clients.find((client) => client.id === harbor.id)!;
    const adminLuis = admin.clients.find((client) => client.id === luisClient.id)!;
    assert.ok(adminHarbor);
    assert.ok(adminLuis);
    assert.equal(adminHarbor.target, 2);
    assert.equal(adminHarbor.website, "harbor.example");
    assert.equal(adminHarbor.logoUrl, null);
    assert.match(adminLuis.logoUrl || "", new RegExp(`/api/clients/${luisClient.id}/logo`));
    assert.equal(adminHarbor.nextMonth.done, 2);
    assert.equal(adminHarbor.thisMonth.done, 0);
    const november = adminHarbor.months.find((month) => month.period === "2026-11")!;
    assert.deepEqual(
      november.campaigns.map((campaign) => campaign.title).sort(),
      ["November promo", "Send in November"]
    );

    const adminEco = admin.clients.find((client) => client.id === ecoworkz.id)!;
    assert.equal(adminEco.target, 2);
    assert.equal(adminEco.nextMonth.done, 5);
    assert.equal(deliverableText(adminEco.nextMonth.done, adminEco.target), "5/2");
    assert.equal(adminEco.nextMonth.tone, "complete");
    const ecoNovember = adminEco.months.find((month) => month.period === "2026-11")!;
    assert.equal(ecoNovember.done, adminEco.nextMonth.done);
    assert.equal(ecoNovember.campaigns.length, 5);
    assert.deepEqual(
      ecoNovember.campaigns.map((campaign) => campaign.title).sort(),
      [
        "November batch — Last call",
        "November batch — Offer",
        "November batch — P.S.",
        "November batch — Reminder",
        "November batch — Welcome",
      ]
    );
    assert.equal(
      ecoNovember.campaigns.every((campaign) => campaign.id === batch.id),
      true
    );

    const adminDue = admin.clients.find((client) => client.id === dueClient.id)!;
    assert.equal(adminDue.nextMonth.done, 4);
    assert.equal(adminDue.thisMonth.done, 0);
    const dueNovember = adminDue.months.find((month) => month.period === "2026-11")!;
    assert.equal(dueNovember.done, adminDue.nextMonth.done);
    assert.equal(dueNovember.campaigns.length, 4);

    const cassidy = loadCampaignMonthDesk(
      { role: "admin", person: "cassidy" },
      null,
      NOW
    );
    assert.equal(
      cassidy.clients.some((client) => client.id === luisClient.id),
      false
    );
    const cassidyHarbor = cassidy.clients.find((client) => client.id === harbor.id);
    assert.ok(cassidyHarbor);
    assert.equal(cassidyHarbor!.nextMonth.needsApproval, 0);
    assert.ok(cassidyHarbor!.months.some((month) =>
      month.campaigns.some((campaign) => campaign.id === pinned.id)
    ));
    assert.equal(
      cassidyHarbor!.months.some((month) =>
        month.campaigns.some((campaign) => campaign.id === hidden.id)
      ),
      false
    );
  });
});
