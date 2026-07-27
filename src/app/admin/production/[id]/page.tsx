"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status = "requested" | "planned" | "scheduled" | "sent";

type ProductionData = {
  send: {
    id: string;
    client_name: string;
    title: string;
    send_date: string;
    send_time: string;
    duration: string;
    status: Status;
    note: string;
    production_brief: string;
    created_at: string;
  };
  client: {
    id: string;
    name: string;
    accountManager: string;
    videographer: string;
  } | null;
};

const BRIEF_SECTIONS: Array<{
  title: string;
  fields: Array<[string, string]>;
}> = [
  {
    title: "Essential details",
    fields: [
      ["locations", "Production location(s)"],
      ["onsiteContactName", "On-site contact"],
      ["onsiteContactPhone", "Contact phone"],
    ],
  },
  {
    title: "Access and environment",
    fields: [
      ["locationState", "Location on production day"],
      ["powerAccess", "Power access"],
      ["timeRestrictions", "Time restrictions"],
      ["parking", "Parking"],
    ],
  },
  {
    title: "People and permissions",
    fields: [
      ["onCameraPeople", "On camera / on site"],
      ["participantsConsent", "Consent to film"],
      ["mediaRelease", "Customers on camera"],
      ["propertyApproval", "Private property approval"],
    ],
  },
  {
    title: "Production direction",
    fields: [
      ["safetyCompliance", "Safety requirements"],
      ["captureRequests", "Requested shots"],
      ["offersPromotions", "Offers or promotions"],
      ["avoidRequests", "Avoid capturing"],
      ["additionalNotes", "Additional notes"],
    ],
  },
];

function fmtDate(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtTime(hhmm: string): string {
  if (!hhmm) return "Not selected";
  const hour = Number(hhmm.split(":")[0]);
  return `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`;
}

export default function ProductionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProductionData | null>(null);
  const [status, setStatus] = useState<Status>("requested");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch(`/api/calendar/${id}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (!res.ok) throw new Error("Could not load production");
        return (await res.json()) as ProductionData;
      })
      .then((result) => {
        if (!mounted || !result) return;
        setData(result);
        setStatus(result.send.status);
      })
      .catch(() => {
        if (mounted) setMessage("Could not load this production.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id, router]);

  async function saveStatus() {
    if (!data || status === data.send.status) return;
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/calendar/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage("Could not update the production status.");
      return;
    }
    const body = await res.json();
    setData((current) =>
      current ? { ...current, send: body.send } : current
    );
    setMessage("Status updated.");
  }

  let brief: Record<string, string> = {};
  if (data?.send.production_brief) {
    try {
      brief = JSON.parse(data.send.production_brief) as Record<string, string>;
    } catch {
      brief = {};
    }
  }

  return (
    <div className="app-shell">
      <main className="container stack">
        <div>
          <Link href="/admin/production" className="muted">
            ← Back to production
          </Link>
        </div>

        {loading ? <p className="muted">Loading production details...</p> : null}
        {!loading && !data ? <p className="error">{message}</p> : null}

        {data ? (
          <>
            <div className="page-hero">
              <p className="eyebrow">Production request</p>
              <h1 className="h1">{data.client?.name || data.send.client_name}</h1>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Requested {fmtDate(data.send.send_date)} at{" "}
                {fmtTime(data.send.send_time)}
              </p>
            </div>

            <section className="card card-pad stack">
              <div className="rev-form-grid">
                <Detail label="Date" value={fmtDate(data.send.send_date)} />
                <Detail label="Start time" value={fmtTime(data.send.send_time)} />
                <Detail
                  label="Length"
                  value={data.send.duration === "full" ? "Full day" : "4 hours"}
                />
                <Detail
                  label="Videographer"
                  value={data.client?.videographer || "Unassigned"}
                />
                <Detail
                  label="Account manager"
                  value={data.client?.accountManager || "Not set"}
                />
              </div>

              <div className="field">
                <label>Production status</label>
                <div className="row">
                  <select
                    className="select-clean"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as Status)}
                    style={{ maxWidth: 240 }}
                  >
                    <option value="requested">Requested</option>
                    <option value="planned">Planned</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="sent">Completed</option>
                  </select>
                  <button
                    className="btn btn-sm"
                    disabled={saving || status === data.send.status}
                    onClick={saveStatus}
                  >
                    {saving ? "Saving..." : "Update status"}
                  </button>
                  {message ? <span className="muted">{message}</span> : null}
                </div>
              </div>
            </section>

            {BRIEF_SECTIONS.map((section) => {
              const populated = section.fields.filter(([key]) => brief[key]);
              if (!populated.length) return null;
              return (
                <section key={section.title} className="card card-pad stack">
                  <h2 className="h2">{section.title}</h2>
                  <div className="stack" style={{ gap: 14 }}>
                    {populated.map(([key, label]) => (
                      <Detail key={key} label={label} value={brief[key]} />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        ) : null}
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {value || "—"}
      </div>
    </div>
  );
}
