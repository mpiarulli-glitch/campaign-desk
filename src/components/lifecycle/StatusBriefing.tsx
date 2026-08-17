"use client";

import Link from "next/link";
import { FollowUpButton } from "./FollowUpButton";
import type { ApprovalRow, BriefingItem, GhlSection, LinkedInSection, LifecycleDashboard } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function quotaLabel(item: BriefingItem): string {
  if (item.quota <= 0) return item.columnLabel;
  return `${item.delivered}/${item.quota} emails · ${item.why}`;
}

function Queue({
  items,
  onOpenBoard,
}: {
  items: BriefingItem[];
  onOpenBoard: () => void;
}) {
  return (
    <div className="hud-queue">
      {items.map((item, i) => (
        <button key={item.clientId} type="button" className="hud-q hud-q-btn" onClick={onOpenBoard}>
          <span className="hud-q-rank hud-num">{pad(i + 1)}</span>
          <div>
            <div className="hud-q-name">{item.clientName}</div>
            <div className="hud-q-meta">
              {quotaLabel(item)}
              {item.campaigns.length
                ? ` · ${item.campaigns.map((c) => c.title).join(", ")}`
                : ""}
            </div>
          </div>
          <div className="hud-q-faults">
            <span
              className={`hud-chip ${
                item.columnKey === "needs_revisions" ? "hud-chip-crit" : "hud-chip-warn"
              }`}
            >
              {item.columnLabel}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function StatusBriefing({
  data,
  onOpenBoard,
  onOpenLinkedIn,
  onChanged,
}: {
  data: LifecycleDashboard;
  onOpenBoard: () => void;
  onOpenLinkedIn: () => void;
  onChanged?: () => void;
}) {
  const c = data.counts;
  const b = data.briefing;
  const li = data.linkedIn;
  const ghl: GhlSection = data.ghl;
  const approvals: ApprovalRow[] = data.approvals;
  const liAlerts: LinkedInSection["needsRefresh"] = li.needsRefresh;
  const clear =
    b.myQueue.length === 0 &&
    b.behindQuota.length === 0 &&
    approvals.length === 0 &&
    liAlerts.length === 0 &&
    li.brokenSeats === 0 &&
    ghl.failures.length === 0;

  return (
    <div className="hud-stack">
      <div className="hud-readouts hud-in hud-in-2">
        <div className={`hud-readout ${c.myQueue > 0 ? "alert" : ""}`}>
          <b>{pad(c.myQueue)}</b>
          <span>Do now</span>
        </div>
        <div className={`hud-readout ${c.behindQuota > 0 ? "warn" : ""}`}>
          <b>{pad(c.behindQuota)}</b>
          <span>Behind quota</span>
        </div>
        <div className="hud-readout">
          <b>{pad(c.waitingOnClientBoard)}</b>
          <span>With the client</span>
        </div>
        <div className={`hud-readout ${c.pendingApprovals > 0 ? "warn" : ""}`}>
          <b>{pad(c.pendingApprovals)}</b>
          <span>Approvals open</span>
        </div>
        <div className={`hud-readout ${c.campaignsNeedingRefresh > 0 ? "warn" : ""}`}>
          <b>{pad(c.campaignsNeedingRefresh)}</b>
          <span>LI refresh</span>
        </div>
      </div>

      <p className="hud-eyebrow" style={{ margin: "-8px 0 0" }}>
        {b.periodLabel} · {b.met} met · {b.inPipeline} in pipeline
        {b.notStarted ? ` · ${b.notStarted} still in triage` : ""}
      </p>

      {clear ? (
        <div className="hud-panel hud-in hud-in-3">
          <p className="hud-empty" style={{ margin: 0 }}>
            Nothing is blocked. Open Deliverables if you want to pull the next client out of triage.
          </p>
        </div>
      ) : null}

      {b.myQueue.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">Do now</h2>
            <span className="hud-eyebrow">Worst first · this month</span>
          </div>
          <Queue items={b.myQueue} onOpenBoard={onOpenBoard} />
        </div>
      ) : null}

      {b.behindQuota.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">Behind on contracted emails</h2>
            <button type="button" className="hud-link" onClick={onOpenBoard}>
              Open board
            </button>
          </div>
          {b.behindQuota.slice(0, 12).map((item) => (
            <div key={item.clientId} className="hud-row">
              <button type="button" className="hud-linklike" onClick={onOpenBoard}>
                {item.clientName}
              </button>
              <span className="hud-row-meta">
                {item.delivered}/{item.quota} · {item.remaining} short · {item.columnLabel}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {b.waitingOnClient.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">Waiting on the client</h2>
            <span className="hud-eyebrow">Follow up if it has gone quiet</span>
          </div>
          {b.waitingOnClient.map((item) => {
            const camps = item.campaigns.length
              ? item.campaigns
              : [{ id: "", title: "", hasCard: false }];
            return camps.map((camp) => (
              <div key={`${item.clientId}-${camp.id || "none"}`} className="hud-row">
                <span>
                  {item.clientName}
                  {camp.title ? ` · ${camp.title}` : ""}
                </span>
                {camp.hasCard && camp.id ? (
                  <FollowUpButton campaignId={camp.id} onDone={() => onChanged?.()} />
                ) : (
                  <span className="hud-row-meta">{item.why}</span>
                )}
              </div>
            ));
          })}
        </div>
      ) : null}

      {approvals.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">Awaiting a decision</h2>
            <span className="hud-eyebrow">Longest wait first</span>
          </div>
          {approvals.slice(0, 8).map((a) => (
            <div key={a.id} className="hud-row">
              <Link href={`/admin/campaigns/${a.id}`}>{a.title}</Link>
              <span className="hud-row-meta">
                {a.clientName} · {a.waitingDays}d ·{" "}
                {a.status === "in_review" ? "client" : "us"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {li.brokenSeats > 0 || liAlerts.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">LinkedIn</h2>
            <button type="button" className="hud-link" onClick={onOpenLinkedIn}>
              Open LinkedIn
            </button>
          </div>
          {li.brokenSeats > 0 ? (
            <div className="hud-row">
              <span>{li.brokenSeats} seat{li.brokenSeats === 1 ? "" : "s"} cannot send</span>
              <span className="hud-row-meta">Auth, 2FA, or jail</span>
            </div>
          ) : null}
          {liAlerts.slice(0, 6).map((row) => (
            <div key={row.id} className="hud-row">
              <span>{row.name}</span>
              <span className="hud-row-meta">
                {row.clientName || row.seatName}
                {row.verdict.reasons[0] ? ` · ${row.verdict.reasons[0].label}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {ghl.failures.length > 0 ? (
        <div className="hud-panel hud-in hud-in-3">
          <div className="hud-panel-head">
            <h2 className="hud-panel-title">GoHighLevel could not load</h2>
          </div>
          {ghl.failures.map((f) => (
            <div key={f.name} className="hud-row">
              <span>{f.name}</span>
              <span className="hud-row-meta">{f.error}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
