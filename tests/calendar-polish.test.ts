import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The editorial calendar polish is presentation. These checks keep the
// workflow that presentation sits on: who can add a campaign, the client
// page staying off the snapshot stylesheet, and the 90-day review link.

const admin = fs.readFileSync("src/app/admin/calendar/page.tsx", "utf8");
const plan = fs.readFileSync("src/app/plan/[token]/page.tsx", "utf8");
const planApi = fs.readFileSync("src/app/api/plan/[token]/route.ts", "utf8");

test("the admin planner still adds and edits only for an admin", () => {
  assert.match(admin, /const isAdmin = role === "admin"/);
  assert.match(admin, /\{isAdmin \? \([\s\S]*Add campaign/);
  assert.match(admin, /if \(isAdmin\) openEdit\(s\)/);
  assert.match(admin, /if \(isAdmin\) openNew\(date\)/);
  assert.doesNotMatch(admin, /Email name is required/);
});

test("the client plan stays a calendar or a list, off the snapshot page", () => {
  assert.match(plan, /className="plan-page"/);
  assert.doesNotMatch(plan, /snap-client/);
  assert.match(plan, /<CalendarViewToggle/);
  assert.match(plan, /<CalendarTypeFilter/);
  assert.match(plan, /\/api\/plan\/\$\{token\}\/feedback/);
  assert.match(plan, /\/api\/plan\/\$\{token\}\/approve/);
  assert.match(plan, /setDetail\(s\)/);
});

test("the shared plan is still the next 90 days", () => {
  assert.match(planApi, /plusDays\(start, 90\)/);
  assert.match(admin, /next 90 days/);
});
