"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

// What the crew needs on the day, grouped so the essentials are first and read
// on a phone from the van. Same field list as the admin view, minus anything
// only an admin would act on.
const SECTIONS: Array<{ title: string; fields: Array<[string, string]> }> = [
  {
    title: "Where to go",
    fields: [
      ["locations", "Location"],
      ["onsiteContactName", "On-site contact"],
      ["onsiteContactPhone", "Contact phone"],
      ["parking", "Parking"],
    ],
  },
  {
    title: "On arrival",
    fields: [
      ["locationState", "Location on the day"],
      ["powerAccess", "Power access"],
      ["timeRestrictions", "Time restrictions"],
      ["safetyCompliance", "Safety requirements"],
    ],
  },
  {
    title: "Who is on camera",
    fields: [
      ["onCameraPeople", "On camera or on site"],
      ["participantsConsent", "Consent to film"],
      ["mediaRelease", "Customers on camera"],
      ["propertyApproval", "Private property approval"],
    ],
  },
  {
    title: "What to capture",
    fields: [
      ["captureRequests", "Requested shots"],
      ["offersPromotions", "Offers or promotions"],
      ["avoidRequests", "Avoid capturing"],
      ["additionalNotes", "Additional notes"],
    ],
  },
];

type Data = {
  production: {
    date: string;
    time: string;
    duration: string;
    status: string;
    needsApproval: boolean;
    approvedAt: string | null;
    note: string;
  };
  client: { name: string; accountManager: string };
  videographer: string;
  brief: Record<string, string>;
};

function longDate(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function slot(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  return `${h % 12 || 12}:${hhmm.split(":")[1] || "00"} ${h >= 12 ? "PM" : "AM"}`;
}

export default function CrewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve() {
    setApproving(true);
    setApproveError("");
    const res = await fetch(`/api/crew/${token}/approve`, { method: "POST" });
    setApproving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setApproveError(body.error || "Could not approve this production.");
      return;
    }
    load();
  }

  if (notFound) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">
            This production link is no longer valid. Ask your account manager for
            a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Pinned light: this gets opened from a Basecamp notification on whatever
    // phone somebody is holding, and it should look the same every time.
    <div className="app-shell client-light">
      <header className="topbar">
        <Brand href="/" />
        <span className="snap-topbar-tag">Production details</span>
      </header>

      <main className="container stack sched-main">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : !data ? (
          <p className="error">Could not load this production.</p>
        ) : (
          <>
            <div className="sched-hero">
              <p className="eyebrow">{data.client.name}</p>
              <h1 className="h1">
                {longDate(data.production.date)}
                {data.production.time ? `, ${slot(data.production.time)}` : ""}
              </h1>
              <p className="sched-sub">
                {data.production.duration === "full" ? "Full day" : "4 hours"}
                {data.videographer ? ` · ${data.videographer}` : ""}
                {data.client.accountManager ? ` · ${data.client.accountManager}` : ""}
              </p>
            </div>

            {data.production.needsApproval ? (
              <section className="card card-pad stack">
                <h2 className="h2">Can you take this one?</h2>
                <p style={{ margin: 0, lineHeight: 1.6 }}>
                  This is a request, not a scheduled production yet. Approving it
                  books it in, tells the client it is confirmed, and lets the
                  account manager know.
                </p>
                {approveError ? <p className="error">{approveError}</p> : null}
                <div className="row">
                  <button className="btn" onClick={approve} disabled={approving}>
                    {approving ? "Approving..." : "Approve this production"}
                  </button>
                </div>
              </section>
            ) : data.production.approvedAt ? (
              <section className="card card-pad">
                <p style={{ margin: 0, lineHeight: 1.6 }}>
                  <strong>Approved.</strong> This is on the schedule and the client
                  has been told.
                </p>
              </section>
            ) : null}

            {data.production.note ? (
              <section className="card card-pad stack">
                <h2 className="h2">Note</h2>
                <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {data.production.note}
                </p>
              </section>
            ) : null}

            {SECTIONS.map((section) => {
              const filled = section.fields.filter(([key]) => data.brief[key]);
              if (!filled.length) return null;
              return (
                <section key={section.title} className="card card-pad stack">
                  <h2 className="h2">{section.title}</h2>
                  <div className="stack" style={{ gap: 14 }}>
                    {filled.map(([key, label]) => (
                      <div key={key}>
                        <div
                          className="muted"
                          style={{ fontSize: 12, marginBottom: 3 }}
                        >
                          {label}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                          {data.brief[key]}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {Object.keys(data.brief).length === 0 ? (
              <div className="empty">
                <p>
                  No brief was filled in for this production yet. Your account
                  manager can add the location and on-site contact.
                </p>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
