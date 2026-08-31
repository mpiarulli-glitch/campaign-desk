"use client";

import { useCallback, useEffect, useState } from "react";

type WorkflowRow = {
  id: string;
  name: string;
  status: string;
  live: boolean;
  updatedAt: string;
};

type WorkflowsPayload = {
  live: number;
  total: number;
  fetchedAt: string;
  workflows: WorkflowRow[];
};

function prettyWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ClientWorkflowsPanel({
  clientId,
  memberIds = [],
  ghlLinked,
}: {
  clientId: string;
  memberIds?: string[];
  ghlLinked: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<WorkflowsPayload | null>(null);

  const pull = useCallback(async () => {
    if (!ghlLinked) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (memberIds.length) params.set("members", memberIds.join(","));
      const qs = params.toString();
      const res = await fetch(
        `/api/lifecycle/hub/${clientId}/workflows${qs ? `?${qs}` : ""}`
      );
      const body = (await res.json().catch(() => ({}))) as WorkflowsPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error || "Could not load workflows.");
        setData(null);
        return;
      }
      setData({
        live: body.live,
        total: body.total,
        fetchedAt: body.fetchedAt,
        workflows: body.workflows || [],
      });
    } catch {
      setError("Could not reach GoHighLevel.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, ghlLinked, memberIds]);

  useEffect(() => {
    setData(null);
    setError("");
    if (ghlLinked) void pull();
  }, [clientId, ghlLinked, pull]);

  return (
    <section className="lh-card lh-workflows">
      <div className="lh-card-head">
        <h3>Automations</h3>
        {ghlLinked ? (
          <button
            type="button"
            className="lh-link"
            disabled={loading}
            onClick={() => void pull()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {!ghlLinked ? (
        <p className="lh-card-note">
          Link a GoHighLevel location from Lifecycle → Tools to pull live workflows for this
          account.
        </p>
      ) : error ? (
        <p className="lh-error">{error}</p>
      ) : loading && !data ? (
        <p className="lh-card-note">Pulling workflows from GoHighLevel…</p>
      ) : data ? (
        <>
          <p className="lh-workflows-summary">
            <strong>{data.live}</strong> live
            <span className="muted"> · {data.total} total</span>
            {data.fetchedAt ? (
              <span className="muted"> · {prettyWhen(data.fetchedAt)}</span>
            ) : null}
          </p>
          {data.workflows.length === 0 ? (
            <p className="lh-card-note">No workflows on this location yet.</p>
          ) : (
            <ul className="lh-workflows-list">
              {data.workflows.map((w) => (
                <li key={w.id} className={w.live ? "is-live" : "is-off"}>
                  <span className="lh-wf-name">{w.name}</span>
                  <span className={`lh-wf-status ${w.live ? "is-live" : ""}`}>
                    {w.live ? "On" : w.status || "Off"}
                  </span>
                  {w.updatedAt ? (
                    <span className="lh-wf-updated muted">{prettyWhen(w.updatedAt)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
