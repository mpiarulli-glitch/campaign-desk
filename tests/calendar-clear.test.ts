import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REAL_BRIEF = JSON.stringify({
  locations: "Main shop",
  onsiteContactName: "Dana",
});

test("clearing the editorial calendar spares productions and campaign sends", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-cal-clear-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  try {
    const { getDb, nowIso } = await import("../src/lib/db");
    const { clearEditorialCalendar, createSend, clientCalendarSummary } =
      await import("../src/lib/calendar");

    const now = nowIso();
    const clientId = "clear_client";
    getDb()
      .prepare(
        `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(clientId, "Clear Client", now, now);

    const newsletter = createSend({
      clientId,
      title: "September newsletter",
      sendDate: "2026-09-01",
    });
    const promo = createSend({
      clientId,
      title: "Fall promo",
      sendDate: "2026-09-08",
    });
    const shoot = createSend({
      clientId,
      title: "September shoot",
      sendDate: "2026-09-10",
      requestedByClient: true,
    });
    const briefed = createSend({
      clientId,
      title: "October shoot",
      sendDate: "2026-10-08",
    });
    getDb()
      .prepare(`UPDATE scheduled_sends SET production_brief = ? WHERE id = ?`)
      .run(REAL_BRIEF, briefed.id);

    const campaignLinked = createSend({
      clientId,
      title: "Campaign package send",
      sendDate: "2026-09-20",
      status: "scheduled",
    });
    getDb()
      .prepare(
        `INSERT INTO campaigns
           (id, title, client_name, client_id, status, magic_token, external_token,
            scheduled_send_at, scheduled_send_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "camp_linked",
        "Campaign package send",
        "Clear Client",
        clientId,
        "mt_clear",
        "et_clear",
        "2026-09-20T16:00:00.000Z",
        campaignLinked.id,
        now,
        now
      );

    const otherClient = "other_client";
    getDb()
      .prepare(
        `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(otherClient, "Other", now, now);
    const otherSend = createSend({
      clientId: otherClient,
      title: "Keep me",
      sendDate: "2026-09-01",
    });

    getDb()
      .prepare(
        `UPDATE rev_clients
         SET calendar_approved_at = ?, calendar_approved_by = ?
         WHERE id = ?`
      )
      .run("2026-08-01T00:00:00.000Z", "Kelly", clientId);

    const result = clearEditorialCalendar(clientId);
    assert.equal(result.deleted, 2);
    assert.equal(result.keptForCampaigns, 1);
    assert.equal(result.keptProductions, 2);
    assert.equal(result.approvalCleared, true);

    const remaining = getDb()
      .prepare(
        `SELECT id FROM scheduled_sends WHERE client_id = ? ORDER BY send_date`
      )
      .all(clientId) as Array<{ id: string }>;
    const ids = remaining.map((r) => r.id);
    assert.ok(!ids.includes(newsletter.id));
    assert.ok(!ids.includes(promo.id));
    assert.ok(ids.includes(shoot.id), "client-booked production stays");
    assert.ok(ids.includes(briefed.id), "briefed production stays");
    assert.ok(ids.includes(campaignLinked.id), "campaign-tab send stays");

    const otherStillThere = getDb()
      .prepare(`SELECT id FROM scheduled_sends WHERE id = ?`)
      .get(otherSend.id);
    assert.ok(otherStillThere, "other clients are untouched");

    const campaign = getDb()
      .prepare(
        `SELECT status, scheduled_send_at, scheduled_send_id FROM campaigns WHERE id = ?`
      )
      .get("camp_linked") as {
        status: string;
        scheduled_send_at: string;
        scheduled_send_id: string;
      };
    assert.equal(campaign.status, "scheduled");
    assert.equal(campaign.scheduled_send_at, "2026-09-20T16:00:00.000Z");
    assert.equal(campaign.scheduled_send_id, campaignLinked.id);

    const summary = clientCalendarSummary(clientId);
    assert.equal(summary.total, 1, "only the campaign-linked editorial row remains");
    assert.equal(summary.productions, 2);

    const approval = getDb()
      .prepare(`SELECT calendar_approved_at FROM rev_clients WHERE id = ?`)
      .get(clientId) as { calendar_approved_at: string | null };
    assert.equal(approval.calendar_approved_at, null);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
