"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type CadenceUnit = "weekly" | "monthly" | "quarterly";
const CADENCE_UNIT_LABEL: Record<CadenceUnit, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

type BehindItem = {
  deliverable_id: string;
  category: string;
  name: string;
  kind: "recurring" | "one_time";
  cadence_unit: CadenceUnit | null;
  due_date: string;
  status: string;
};
type ClientReport = { client_id: string; client_name: string; items: BehindItem[] };

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function BehindReportPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/snapshot/behind-report");
        if (res.status === 401) return router.push("/login");
        if (!res.ok) { setError("Failed to load."); return; }
        setClients((await res.json()).clients || []);
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalItems = clients.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/snapshot">All accounts</Link>
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Client reporting</p>
          <h1 className="h1">Behind report</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Every deliverable that missed its deadline: a recurring item once its week,
            month, or quarter fully ends without a completed entry, or a one-time item
            past its manually-set due date.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : clients.length === 0 ? (
          <div className="empty"><p>Nothing overdue across any account. Nice.</p></div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            <span className="muted">
              {totalItems} overdue item{totalItems === 1 ? "" : "s"} across {clients.length} client
              {clients.length === 1 ? "" : "s"}
            </span>
            {clients.map((c) => (
              <div key={c.client_id} className="card card-pad stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{c.client_name}</strong>
                  <Link className="btn btn-ghost btn-sm" href={`/admin/snapshot/${c.client_id}`}>
                    Open snapshot
                  </Link>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  {c.items.map((it) => (
                    <div
                      key={it.deliverable_id}
                      className="row"
                      style={{ justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}
                    >
                      <div>
                        <strong>{it.name}</strong>
                        <span className="muted">
                          {" "}
                          — {it.category || "Other"} ·{" "}
                          {it.kind === "one_time" ? "One-time" : CADENCE_UNIT_LABEL[it.cadence_unit!]}
                        </span>
                      </div>
                      <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                        Due {fmtDate(it.due_date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
