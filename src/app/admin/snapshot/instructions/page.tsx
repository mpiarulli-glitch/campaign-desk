import Link from "next/link";

const SECTIONS = [
  { id: "weekly-pass", label: "Weekly pass" },
  { id: "done-vs-status", label: "Done vs status" },
  { id: "catch-up", label: "Catch up" },
  { id: "backfill", label: "Past six months" },
  { id: "behind", label: "Behind report" },
  { id: "tabs", label: "On the account" },
  { id: "client-view", label: "What clients see" },
] as const;

export default function SnapshotInstructionsPage() {
  return (
    <div className="ops-page snap-desk snap-instructions">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/desk">
          All snapshots
        </Link>
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/behind">
          Behind report
        </Link>
      </div>

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Account snapshot</p>
          <h1 className="ops-title">How to fill Weekly Snapshot</h1>
          <p className="ops-sub">
            Short guide for logging the week, catching up overdue work, and
            keeping the client link honest.
          </p>
        </div>
      </div>

      <nav className="snap-instr-toc" aria-label="On this page">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <div className="snap-instr-stack">
        <section id="weekly-pass" className="snap-instr-card">
          <h2>Weekly pass</h2>
          <ol>
            <li>
              Open{" "}
              <Link href="/admin/snapshot/desk">This week</Link> — every
              client&apos;s deliverables in one list.
            </li>
            <li>
              Use the week picker if you need last week. The list starts on{" "}
              <em>All</em>. Filter to <em>Needs update</em> if you only want
              what still needs a status.
            </li>
            <li>
              For each deliverable: set status. Choose <strong>Completed</strong>{" "}
              when it shipped — you&apos;ll pick the date — then expand the row
              to add <em>What we did</em> / <em>Next steps</em> if the client
              should see context.
            </li>
            <li>
              Open a client name for setup, leads, wins, or the client link.
            </li>
          </ol>
          <p className="snap-instr-note">
            Set the <strong>Launch</strong> date at the top of the account page
            first. Catch-up and overdue math start from launch, not from
            forever.
          </p>
        </section>

        <section id="done-vs-status" className="snap-instr-card">
          <h2>Done vs status</h2>
          <ul>
            <li>
              <strong>Status</strong> is where the work sits (Not started → In
              progress → Scheduled → Sent for approval → Completed → Shared /
              Approved, etc.).
            </li>
            <li>
              <strong>Completed</strong> means this period shipped. It asks{" "}
              <em>when</em> so history lines up with the real date.
            </li>
            <li>
              Recurring items (weekly / monthly / quarterly) reopen next
              period. One-time items stay closed once done.
            </li>
          </ul>
        </section>

        <section id="catch-up" className="snap-instr-card">
          <h2>Catch up (missed weeks)</h2>
          <p>
            Use this when a <strong>recurring</strong> deliverable fell behind
            and you need to mark several past periods done in one shot — not
            for inventing work that never happened.
          </p>
          <ol>
            <li>Open the deliverable row → <strong>Catch up</strong>.</li>
            <li>
              Pick how far back: since launch, or 1 / 2 / 3 / 4 / 6 months.
            </li>
            <li>
              Confirm the range, then <strong>Mark … done</strong>. Periods
              already logged are skipped.
            </li>
          </ol>
          <p className="snap-instr-note">
            Catch up is only on recurring items. One-time deliverables: set
            status / Done on the row (and a due date in Setup if it should
            appear on the Behind report).
          </p>
        </section>

        <section id="backfill" className="snap-instr-card">
          <h2>Past six months</h2>
          <p>
            Admins: from an account, open <strong>Past six months</strong>.
            It’s a list — one row per deliverable, one column per month.
          </p>
          <ul>
            <li>Weekly work shows a chip per week inside that month.</li>
            <li>Monthly work is one cell for the month.</li>
            <li>Empty → click to mark done. A filled cell opens notes.</li>
          </ul>
          <p>
            Prefer Catch up on a single deliverable when you’re cleaning one
            line. Use this list when you’re clearing a whole account’s history.
          </p>
        </section>

        <section id="behind" className="snap-instr-card">
          <h2>Behind report</h2>
          <p>
            <Link href="/admin/snapshot/behind">Behind report</Link> lists every
            deliverable past its deadline across accounts:
          </p>
          <ul>
            <li>
              <strong>Recurring</strong> — the week / month / quarter ended
              without a scheduled, completed, shared, or approved entry.
            </li>
            <li>
              <strong>One-time</strong> — past the due date you set in Setup.
            </li>
          </ul>
          <p>
            Open an account from the report, log or catch up the item, and it
            drops off once the period is properly closed.
          </p>
        </section>

        <section id="tabs" className="snap-instr-card">
          <h2>On the account</h2>
          <p>
            Open a client from the desk. The view dropdown has:
          </p>
          <ul>
            <li>
              <strong>This week</strong> — that account only (same editor as
              the desk).
            </li>
            <li>
              <strong>Leads</strong> — add or update leads; clients can mark
              Converted / Not yet on their link.
            </li>
            <li>
              <strong>Wins</strong> — short wins with a date (shows on the
              client page).
            </li>
            <li>
              <strong>Setup</strong> — deliverables (team, cadence, one-time vs
              recurring, due dates). Keep this accurate or the weekly pass and
              Behind report lie.
            </li>
            <li>
              <strong>Client view</strong> — copy the share link and preview
              what they see.
            </li>
          </ul>
        </section>

        <section id="client-view" className="snap-instr-card">
          <h2>What clients see</h2>
          <p>
            Their token link is read-focused: glance, wins, revenue they
            report, leads they can answer, this week’s logged work, contract
            overview, and performance charts.
          </p>
          <ul>
            <li>They do <strong>not</strong> edit status, catch up, or Setup.</li>
            <li>
              Only write clear <em>What we did</em> / <em>Next steps</em> —
              that’s the story they read.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
