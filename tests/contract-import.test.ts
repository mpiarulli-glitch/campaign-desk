import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Reading a contract's scope of work into snapshot deliverables. The parse only
// ever proposes, so these tests are about what it proposes and what it declines
// to propose — a confident wrong row costs more than a missing one, because a
// missing row is obvious in the review table and a wrong one is not.

test("cadence is read from the way contracts phrase it", async () => {
  const { parseCadence } = await import("../src/lib/contract-import");

  const monthly = parseCadence("4 blog posts per month");
  assert.equal(monthly.unit, "monthly");
  assert.equal(monthly.quantity, 4);
  assert.equal(monthly.kind, "recurring");
  assert.equal(monthly.cadence, "4 per month");

  assert.equal(parseCadence("2x/mo email campaigns").unit, "monthly");
  assert.equal(parseCadence("2x/mo email campaigns").quantity, 2);
  assert.equal(parseCadence("1 per week social post").unit, "weekly");
  assert.equal(parseCadence("Weekly reporting call").unit, "weekly");
  assert.equal(parseCadence("Quarterly strategy review").unit, "quarterly");
  assert.equal(parseCadence("Bi-weekly newsletter").unit, "weekly");
  assert.equal(parseCadence("Twice monthly emails").quantity, 2);

  // Setup work is one-time, and the snapshot must not reset it every month.
  assert.equal(parseCadence("One-time website audit").kind, "one_time");
  assert.equal(parseCadence("Initial CRM setup").kind, "one_time");
  assert.equal(parseCadence("Onboarding and kickoff call").kind, "one_time");

  // But a repeating cadence wins over a setup-sounding word: a monthly audit is
  // recurring work, not a task that gets ticked off once.
  const monthlyAudit = parseCadence("Monthly SEO audit");
  assert.equal(monthlyAudit.kind, "recurring");
  assert.equal(monthlyAudit.unit, "monthly");

  // The app has no yearly cadence, so the approximation is stated rather than
  // applied silently.
  const yearly = parseCadence("Annual brand review");
  assert.equal(yearly.unit, "quarterly");
  assert.ok(yearly.note, "an approximated cadence must say so");

  assert.equal(parseCadence("Account management").cadence, "");
});

test("contract terms are read from the payment section", async () => {
  const { parseContractTerms } = await import("../src/lib/contract-import");

  const terms = parseContractTerms(
    [
      "PAYMENT",
      "Monthly retainer: $4,500.00 due on the first of each month.",
      "A late fee of $50 applies after ten days.",
      "This is a 12-month agreement.",
      "Effective Date: September 1, 2026",
      "Expires on 8/31/2027",
    ].join("\n")
  );

  // The labelled monthly figure wins over the first dollar amount in the file.
  assert.equal(terms.monthlyRetainer, 4500);
  assert.equal(terms.termMonths, 12);
  assert.equal(terms.contractStart, "2026-09-01");
  assert.equal(terms.contractEnd, "2027-08-31");

  const perMonth = parseContractTerms("Fee of $2,000/mo for services rendered.");
  assert.equal(perMonth.monthlyRetainer, 2000);

  const nothing = parseContractTerms("The parties agree to the following.");
  assert.equal(nothing.monthlyRetainer, null);
  assert.equal(nothing.contractStart, null);
});

/* ------------------------------------------------------- against the db */

const CONTRACT = [
  "MARKETING SERVICES AGREEMENT",
  "This agreement is made between Marketing Empire Group and the Client.",
  "",
  "SCOPE OF WORK",
  "Email Marketing",
  "• 4 email campaigns per month",
  "• 1 automated flow build per quarter",
  "• Initial Klaviyo account setup",
  "SEO",
  "• 4 blog posts per month",
  "• Monthly keyword ranking report",
  "Social Media",
  "• 12 social posts per month",
  "• Weekly community management",
  "",
  "PAYMENT TERMS",
  "Monthly retainer: $6,000 due on the first.",
  "Late payments incur a $75 fee.",
  "Client shall indemnify the Agency against all claims arising from the foregoing.",
  "",
  "GOVERNING LAW",
  "This agreement is governed by the laws of the State of California.",
].join("\n");

test("reading a contract into deliverables", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-contract-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const { applyContractDeliverables, parseContractText } = await import(
    "../src/lib/contract-import"
  );
  const { listDeliverables } = await import("../src/lib/snapshot");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const client = (id: string) => {
    const now = nowIso();
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };

  await t.test("the scope section is read and the legal terms are not", () => {
    const id = client("con_scope");
    const result = parseContractText(id, CONTRACT);

    assert.equal(result.foundScopeSection, true);
    const names = result.candidates.map((c) => c.name);
    assert.deepEqual(names, [
      "4 email campaigns per month",
      "1 automated flow build per quarter",
      "Initial Klaviyo account setup",
      "4 blog posts per month",
      "Monthly keyword ranking report",
      "12 social posts per month",
      "Weekly community management",
    ]);

    // Nothing from the payment or legal sections becomes a deliverable, which is
    // the whole reason the scope section is located first.
    const joined = names.join(" ").toLowerCase();
    assert.ok(!joined.includes("retainer"));
    assert.ok(!joined.includes("late payment"));
    assert.ok(!joined.includes("indemnify"));
    assert.ok(!joined.includes("governed"));
  });

  await t.test("each row lands in the right category, team, and cadence", () => {
    const id = client("con_cat");
    const byName = new Map(
      parseContractText(id, CONTRACT).candidates.map((c) => [c.name, c])
    );

    const emails = byName.get("4 email campaigns per month")!;
    assert.equal(emails.category, "Email");
    assert.equal(emails.team, "email");
    assert.equal(emails.cadenceUnit, "monthly");
    assert.equal(emails.kind, "recurring");

    const blogs = byName.get("4 blog posts per month")!;
    assert.equal(blogs.category, "SEO");
    assert.equal(blogs.team, "seo");

    const social = byName.get("12 social posts per month")!;
    assert.equal(social.team, "social");

    const flow = byName.get("1 automated flow build per quarter")!;
    assert.equal(flow.cadenceUnit, "quarterly");

    // Setup work is proposed as one-time, so the snapshot stops resetting it once
    // it is done.
    const setup = byName.get("Initial Klaviyo account setup")!;
    assert.equal(setup.kind, "one_time");

    // The line each row came from travels with it, so a review is checkable.
    assert.equal(setup.sourceLine, "• Initial Klaviyo account setup");
  });

  await t.test("a bare word heading still classifies the rows under it", () => {
    const id = client("con_heading");
    const result = parseContractText(
      id,
      [
        "Scope of Services",
        "Email",
        // Plural nouns have to match the category rules: a contract writes
        // "6 emails per month", never "6 email per month".
        "• 6 emails per month",
        "• 12 social posts per month",
        "Website",
        "• Monthly landing page build",
        "",
        // A signature block must stay excluded even though "Email" and "Date" are
        // also section headings elsewhere in the document.
        "Signature",
        "Name: ______",
        "Email: ______",
        "Date: ______",
      ].join("\n")
    );

    const byName = new Map(result.candidates.map((c) => [c.name, c]));
    assert.equal(byName.get("6 emails per month")?.category, "Email");
    assert.equal(byName.get("6 emails per month")?.team, "email");
    assert.equal(byName.get("12 social posts per month")?.team, "social");
    assert.equal(byName.get("Monthly landing page build")?.team, "web");

    // Nothing from the signature block became a deliverable.
    const names = result.candidates.map((c) => c.name);
    assert.ok(!names.some((n) => /^(Name|Email|Date)\b/.test(n)), names.join(" | "));
  });

  await t.test("a contract with no scope heading reads only cadenced lines", () => {
    const id = client("con_noscope");
    const result = parseContractText(
      id,
      [
        "The Agency will provide 4 email campaigns per month.",
        "The Client agrees to review all work within five business days.",
        "Payment is due on receipt.",
      ].join("\n")
    );

    assert.equal(result.foundScopeSection, false);
    assert.ok(
      result.warnings.some((w) => /no scope-of-work heading/i.test(w)),
      "the narrower read must be stated, not silent"
    );
    // Only the line with a cadence in it is proposed.
    assert.deepEqual(result.candidates.map((c) => c.name), [
      "The Agency will provide 4 email campaigns per month",
    ]);
  });

  await t.test("an unreadable document says so instead of proposing nothing", () => {
    const id = client("con_empty");
    const result = parseContractText(id, "SIGNATURES\nBy:\nDate:\nPage 1 of 3");
    assert.equal(result.candidates.length, 0);
    assert.ok(result.warnings.some((w) => /paste the scope of work/i.test(w)));
  });

  await t.test("saving creates the approved rows and skips duplicates", () => {
    const id = client("con_save");
    const parsed = parseContractText(id, CONTRACT);

    const first = applyContractDeliverables(id, parsed.candidates);
    assert.equal(first.created, 7);
    assert.equal(first.skipped, 0);
    assert.equal(listDeliverables(id).length, 7);

    // Importing the same contract again adds nothing rather than doubling the
    // account's scope of work.
    const second = applyContractDeliverables(id, parsed.candidates);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 7);
    assert.equal(listDeliverables(id).length, 7);

    // A second parse now knows which rows the account already has.
    const reparsed = parseContractText(id, CONTRACT);
    assert.ok(reparsed.candidates.every((c) => c.existingId));
  });

  await t.test("edits made in the review table are what get saved", () => {
    const id = client("con_edit");
    const parsed = parseContractText(id, CONTRACT);
    const edited = parsed.candidates.slice(0, 2).map((c) => ({
      ...c,
      name: `${c.name} (checked)`,
      category: "Retention",
      cadenceUnit: "weekly" as const,
    }));

    assert.equal(applyContractDeliverables(id, edited).created, 2);
    const saved = listDeliverables(id);
    assert.equal(saved.length, 2, "only the selected rows are saved");
    assert.ok(saved.every((d) => d.name.endsWith("(checked)")));
    assert.ok(saved.every((d) => d.category === "Retention"));
    assert.ok(saved.every((d) => d.cadence_unit === "weekly"));
  });

  await t.test("a row with no name is skipped, not saved blank", () => {
    const id = client("con_blank");
    const result = applyContractDeliverables(id, [
      { name: "  " },
      { name: "Real deliverable", cadence: "Monthly" },
    ]);
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal(listDeliverables(id).length, 1);
  });

  await t.test("a bogus team from a stale browser is normalised away", () => {
    const id = client("con_team");
    applyContractDeliverables(id, [{ name: "Something", team: "not-a-team" }]);
    assert.equal(listDeliverables(id)[0].team, "");
  });
});
