"use client";

import { useEffect, useState } from "react";

// Agency-wide GoHighLevel tools. Three buttons, each running one report across
// every subaccount, and two of them able to write once a person approves what
// they see.
//
// Every report is a deliberate button press rather than something that runs on
// mount, because a full sweep is roughly 150 API calls and nobody wants that
// firing every time they open the lifecycle page.

type Tool = "accounts" | "tags" | "hot" | null;

type AccountRow = {
  locationId: string;
  locationName: string;
  mapped: boolean;
  tagCount: number;
  contactCount: number | null;
  error?: string;
};

type AccountReport = {
  fetchedAt: string;
  rows: AccountRow[];
  totals: { locations: number; mapped: number; unmapped: number; tags: number };
};

type TagMember = { locationId: string; locationName: string; tagId: string; name: string };

type TagIssue = {
  kind: "duplicate" | "test" | "dated" | "empty-name";
  canonical: string;
  members: TagMember[];
  why: string;
};

type TagAudit = {
  fetchedAt: string;
  locationsScanned: number;
  locationsFailed: Array<{ locationId: string; locationName: string; error: string }>;
  totalTags: number;
  distinctNames: number;
  issues: TagIssue[];
};

type ScoredContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  dateAdded: string;
  score: number;
  reasons: string[];
  blocked: string;
};

type HotList = {
  locationId: string;
  locationName: string;
  scanned: number;
  contacts: ScoredContact[];
};

const KIND_LABEL: Record<TagIssue["kind"], string> = {
  duplicate: "Same tag, different spellings",
  test: "Test or placeholder",
  dated: "Date-based",
  "empty-name": "Empty name",
};

function fmtWhen(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LocationRef = { id: string; name: string; mapped: boolean };

export function ToolsPanel() {
  const [running, setRunning] = useState<Tool>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [accounts, setAccounts] = useState<AccountReport | null>(null);
  const [tags, setTags] = useState<TagAudit | null>(null);
  const [hot, setHot] = useState<HotList | null>(null);

  // Which tag fixes have been ticked. Keyed by locationId + tagId so the same
  // tag name in two subaccounts is approved separately, because it is a
  // separate row over there.
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [hotPick, setHotPick] = useState<Set<string>>(new Set());
  const [hotTag, setHotTag] = useState("hot-now");
  const [location, setLocation] = useState("");

  const [locations, setLocations] = useState<LocationRef[]>([]);

  // The picker list is cheap and cached server-side, so it loads on mount. The
  // three reports do not, because each is a full sweep of the agency.
  useEffect(() => {
    fetch("/api/lifecycle/ghl-tools?tool=locations")
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => setLocations(d.locations || []))
      .catch(() => {});
  }, []);

  async function run(tool: Exclude<Tool, null>, extra = "") {
    setRunning(tool);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/lifecycle/ghl-tools?tool=${tool}${extra}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "That report failed.");
        return;
      }
      if (tool === "accounts") setAccounts(data);
      if (tool === "tags") {
        setTags(data);
        setApproved(new Set());
      }
      if (tool === "hot") {
        setHot(data);
        setHotPick(new Set());
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setRunning(null);
    }
  }

  function toggle(set: Set<string>, key: string, fn: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    fn(next);
  }

  // A duplicate collapses by renaming the odd spellings onto the canonical one.
  // Everything else is a delete. Both are built here rather than server-side so
  // the button can say exactly how many changes it is about to make.
  function plannedActions() {
    if (!tags) return [];
    const out: Array<Record<string, string>> = [];
    for (const issue of tags.issues) {
      for (const m of issue.members) {
        if (!approved.has(`${m.locationId}:${m.tagId}`)) continue;
        if (issue.kind === "duplicate" && issue.canonical) {
          out.push({
            type: "rename",
            locationId: m.locationId,
            tagId: m.tagId,
            from: m.name,
            to: issue.canonical,
          });
        } else {
          out.push({
            type: "delete",
            locationId: m.locationId,
            tagId: m.tagId,
            name: m.name,
          });
        }
      }
    }
    return out;
  }

  async function applyPlan() {
    const actions = plannedActions();
    if (actions.length === 0) return;
    if (
      !confirm(
        `Apply ${actions.length} tag change${actions.length === 1 ? "" : "s"} across ` +
          `GoHighLevel? Renames and deletes cannot be undone from here.`
      )
    ) {
      return;
    }
    setRunning("tags");
    const res = await fetch("/api/lifecycle/ghl-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply-tag-plan", actions }),
    });
    const data = await res.json();
    setRunning(null);
    if (!res.ok) {
      setError(data.error || "That did not apply.");
      return;
    }
    setMessage(
      `Applied ${data.applied}.` +
        (data.failures?.length ? ` ${data.failures.length} failed.` : "")
    );
    void run("tags", "&force=1");
  }

  async function tagHot() {
    if (!hot || hotPick.size === 0 || !hotTag.trim()) return;
    setRunning("hot");
    const res = await fetch("/api/lifecycle/ghl-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "tag-hot",
        locationId: hot.locationId,
        tag: hotTag.trim(),
        contactIds: [...hotPick],
      }),
    });
    const data = await res.json();
    setRunning(null);
    if (!res.ok) {
      setError(data.error || "Tagging failed.");
      return;
    }
    setMessage(
      `Tagged ${data.tagged} contact${data.tagged === 1 ? "" : "s"} with "${hotTag.trim()}". ` +
        `Build a smart list on that tag once and it will stay current.`
    );
    setHotPick(new Set());
  }

  const planCount = plannedActions().length;

  return (
    <div className="lc-tools">
      <p className="lc-tools-intro">
        Each button runs one pass across every GoHighLevel subaccount, not just
        the ones mapped to a client here. Reports are read-only. The two that can
        write show you what they would change first, and nothing happens until
        you approve it.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}

      {/* ---- accounts */}
      <section className="lc-tool">
        <div className="lc-tool-head">
          <div>
            <h3>Account report</h3>
            <p>Every location, its contact count, its tag count, and whether a client here points at it.</p>
          </div>
          <button className="btn btn-sm" disabled={running !== null} onClick={() => run("accounts", "&force=1")}>
            {running === "accounts" ? "Scanning..." : "Run report"}
          </button>
        </div>

        {accounts ? (
          <>
            <div className="lc-tool-stats">
              <span><strong>{accounts.totals.locations}</strong> locations</span>
              <span><strong>{accounts.totals.mapped}</strong> mapped</span>
              <span className={accounts.totals.unmapped ? "is-warn" : ""}>
                <strong>{accounts.totals.unmapped}</strong> unmapped
              </span>
              <span><strong>{accounts.totals.tags}</strong> tags total</span>
            </div>
            <div className="lc-tool-rows">
              <table>
                <thead>
                  <tr><th>Location</th><th>Contacts</th><th>Tags</th><th>Mapped</th></tr>
                </thead>
                <tbody>
                  {accounts.rows.slice(0, 40).map((r) => (
                    <tr key={r.locationId} className={r.error ? "is-bad" : ""}>
                      <td>
                        {r.locationName}
                        {r.error ? <span className="lc-tool-prob">{r.error}</span> : null}
                      </td>
                      <td>{r.contactCount ?? "-"}</td>
                      <td>{r.tagCount}</td>
                      <td>{r.mapped ? "yes" : <span className="is-warn">no</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {accounts.rows.length > 40 ? (
                <p className="lc-tool-note">Showing the 40 largest of {accounts.rows.length}.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {/* ---- tags */}
      <section className="lc-tool">
        <div className="lc-tool-head">
          <div>
            <h3>Tag cleanup</h3>
            <p>Finds duplicate spellings, test tags and date-based tags across every account. Tick what to fix.</p>
          </div>
          <button className="btn btn-sm" disabled={running !== null} onClick={() => run("tags", "&force=1")}>
            {running === "tags" ? "Auditing..." : "Audit tags"}
          </button>
        </div>

        {tags ? (
          <>
            <div className="lc-tool-stats">
              <span><strong>{tags.totalTags}</strong> tags</span>
              <span><strong>{tags.distinctNames}</strong> distinct names</span>
              <span className={tags.issues.length ? "is-warn" : ""}>
                <strong>{tags.issues.length}</strong> issues
              </span>
              <span>{tags.locationsScanned} accounts scanned</span>
            </div>

            {tags.locationsFailed.length ? (
              <p className="lc-tool-note">
                {tags.locationsFailed.length} account
                {tags.locationsFailed.length === 1 ? "" : "s"} could not be read and were skipped.
              </p>
            ) : null}

            <div className="lc-tool-issues">
              {tags.issues.slice(0, 30).map((issue, i) => (
                <div key={i} className="lc-issue">
                  <div className="lc-issue-head">
                    <span className="cs-pill is-warn">{KIND_LABEL[issue.kind]}</span>
                    {issue.canonical ? (
                      <span className="lc-issue-canon">
                        collapse to <strong>{issue.canonical}</strong>
                      </span>
                    ) : null}
                  </div>
                  <p className="lc-issue-why">{issue.why}</p>
                  {issue.members.map((m) => {
                    const key = `${m.locationId}:${m.tagId}`;
                    return (
                      <label key={key} className="lc-issue-row">
                        <input
                          type="checkbox"
                          checked={approved.has(key)}
                          onChange={() => toggle(approved, key, setApproved)}
                        />
                        <span className="lc-issue-tag">{m.name}</span>
                        <span className="lc-issue-loc">{m.locationName}</span>
                        <span className="lc-issue-act">
                          {issue.kind === "duplicate" && issue.canonical ? "rename" : "delete"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
              {tags.issues.length > 30 ? (
                <p className="lc-tool-note">Showing 30 of {tags.issues.length} issues.</p>
              ) : null}
            </div>

            {planCount > 0 ? (
              <div className="lc-tool-foot">
                <span className="lc-tool-note">
                  {planCount} change{planCount === 1 ? "" : "s"} selected. Renames and deletes
                  cannot be undone from here.
                </span>
                <button className="btn btn-sm" disabled={running !== null} onClick={applyPlan}>
                  Apply {planCount}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {/* ---- hot contacts */}
      <section className="lc-tool">
        <div className="lc-tool-head">
          <div>
            <h3>Who to call right now</h3>
            <p>
              Scores one account&apos;s contacts on booking-flow signals, then tags the ones
              you pick so you can build a smart list on that tag once.
            </p>
          </div>
          <div className="lc-tool-pick">
            <select
              className="select-clean"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">Pick an account</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.mapped ? "" : " (unmapped)"}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm"
              disabled={running !== null || !location}
              onClick={() => run("hot", `&locationId=${encodeURIComponent(location)}`)}
            >
              {running === "hot" ? "Scoring..." : "Score"}
            </button>
          </div>
        </div>

        {hot ? (
          hot.contacts.length === 0 ? (
            <p className="lc-tool-note">
              Nothing scored above zero in {hot.locationName}. {hot.scanned} contacts looked at.
            </p>
          ) : (
            <>
              <div className="lc-tool-stats">
                <span><strong>{hot.contacts.length}</strong> worth a call</span>
                <span>{hot.scanned} scanned</span>
                <span>{hot.locationName}</span>
              </div>
              <div className="lc-tool-rows">
                <table>
                  <thead>
                    <tr><th></th><th>Score</th><th>Who</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {hot.contacts.map((c) => (
                      <tr key={c.id} className={c.blocked ? "is-bad" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={hotPick.has(c.id)}
                            onChange={() => toggle(hotPick, c.id, setHotPick)}
                          />
                        </td>
                        <td><strong>{c.score}</strong></td>
                        <td>
                          {c.name || c.email || c.id}
                          {c.companyName ? <span className="lc-tool-sub">{c.companyName}</span> : null}
                          {c.blocked ? <span className="lc-tool-prob">{c.blocked}</span> : null}
                        </td>
                        <td className="lc-tool-why">
                          {c.reasons.slice(0, 2).join(". ")}
                          {c.dateAdded ? ` (${fmtWhen(c.dateAdded)})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="lc-tool-foot">
                <label className="field lc-tool-tagname">
                  <span>Tag them</span>
                  <input value={hotTag} onChange={(e) => setHotTag(e.target.value)} />
                </label>
                <button
                  className="btn btn-sm"
                  disabled={running !== null || hotPick.size === 0 || !hotTag.trim()}
                  onClick={tagHot}
                >
                  Tag {hotPick.size} contact{hotPick.size === 1 ? "" : "s"}
                </button>
              </div>
              <p className="lc-tool-note">
                GoHighLevel has no API for creating a smart list, so this writes the tag
                instead. Build one smart list on that tag in the GoHighLevel UI and it stays
                current on its own from then on.
              </p>
            </>
          )
        ) : null}
      </section>
    </div>
  );
}
