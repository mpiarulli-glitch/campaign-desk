"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

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
    cadence_window_start: string | null;
  };
  client: {
    id: string;
    name: string;
    accountManager: string;
    videographer: string;
  } | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00"];

// What an admin can change about a production after the fact. The videographer
// is a client-level setting and stays on the Client setup tab.
type EditForm = {
  sendDate: string;
  sendTime: string;
  duration: "half" | "full";
  note: string;
  brief: Record<string, string>;
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
  const [isAdmin, setIsAdmin] = useState(false);

  // Editing the production itself, for shoots arranged off-app where the client
  // never filled in a brief. Null until "Edit details" is pressed, so the page
  // stays a clean read-only view for the crew.
  const [form, setForm] = useState<EditForm | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (mounted) setIsAdmin(session?.role === "admin");
      })
      .catch(() => {});
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

  function beginEdit() {
    if (!data) return;
    setMessage("");
    setForm({
      sendDate: data.send.send_date,
      sendTime: data.send.send_time,
      duration: data.send.duration === "full" ? "full" : "half",
      note: data.send.note || "",
      brief: { ...brief },
    });
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    if (!DATE_RE.test(form.sendDate)) {
      setMessage("Production date must be a real date.");
      return;
    }
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/calendar/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sendDate: form.sendDate,
        sendTime: form.sendTime,
        duration: form.duration,
        note: form.note,
        brief: form.brief,
        status,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.error || "Could not save this production.");
      return;
    }
    const body = await res.json();
    setData((current) => (current ? { ...current, send: body.send } : current));
    setStatus(body.send.status);
    setForm(null);
    setMessage("Production saved.");
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
              <p className="eyebrow">
                Production request
                {!data.send.cadence_window_start ? (
                  <span
                    className="pcon-pill is-quiet"
                    style={{ marginLeft: 8, verticalAlign: "middle" }}
                    title="Requested outside the client's regular cadence. Does not affect their normal schedule."
                  >
                    Out of cycle
                  </span>
                ) : null}
              </p>
              <h1 className="h1">{data.client?.name || data.send.client_name}</h1>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Requested {fmtDate(data.send.send_date)} at{" "}
                {fmtTime(data.send.send_time)}
              </p>
            </div>

            <section className="card card-pad stack">
              {form ? (
                <div className="rev-form-grid">
                  <div className="field">
                    <label htmlFor="ed-date">Date</label>
                    <input
                      id="ed-date"
                      type="date"
                      value={form.sendDate}
                      onChange={(e) => setForm({ ...form, sendDate: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ed-time">Start time</label>
                    <select
                      id="ed-time"
                      className="select-clean"
                      value={form.sendTime}
                      onChange={(e) => setForm({ ...form, sendTime: e.target.value })}
                    >
                      <option value="">No time set</option>
                      {SLOTS.map((t) => (
                        <option key={t} value={t}>{fmtTime(t)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ed-len">Length</label>
                    <select
                      id="ed-len"
                      className="select-clean"
                      value={form.duration}
                      onChange={(e) =>
                        setForm({ ...form, duration: e.target.value as "half" | "full" })
                      }
                    >
                      <option value="half">4 hours</option>
                      <option value="full">Full day</option>
                    </select>
                  </div>
                  <Detail
                    label="Videographer"
                    value={data.client?.videographer || "Unassigned"}
                  />
                  <Detail
                    label="Account manager"
                    value={data.client?.accountManager || "Not set"}
                  />
                </div>
              ) : (
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
              )}

              {isAdmin ? (
                <div className="field">
                  <label htmlFor="ed-status">Production status</label>
                  <div className="row">
                    <select
                      id="ed-status"
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
                    {form ? null : (
                      <button
                        className="btn btn-sm"
                        disabled={saving || status === data.send.status}
                        onClick={saveStatus}
                      >
                        {saving ? "Saving..." : "Update status"}
                      </button>
                    )}
                    {form ? null : (
                      <button className="btn btn-secondary btn-sm" onClick={beginEdit}>
                        Edit details
                      </button>
                    )}
                    {message ? <span className="muted">{message}</span> : null}
                  </div>
                  {status === "sent" && status !== data.send.status ? (
                    <p className="muted" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6 }}>
                      Marking this completed moves the client&apos;s last production
                      date to {fmtDate(form ? form.sendDate : data.send.send_date)}.
                      That is what the cadence counts forward from, so it decides
                      which month their next window lands in. The color week still
                      sets which week of that month.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {form ? (
                <div className="field">
                  <label htmlFor="ed-note">Note for the crew</label>
                  <textarea
                    id="ed-note"
                    rows={2}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="Anything the videographer should know before they arrive."
                  />
                </div>
              ) : data.send.note ? (
                <Detail label="Note" value={data.send.note} />
              ) : null}
            </section>

            {BRIEF_SECTIONS.map((section) => {
              // Read-only hides empty fields to keep the crew's view tight.
              // Editing shows every field, since blanks are the whole point of
              // filling a brief in yourself.
              const populated = section.fields.filter(([key]) => brief[key]);
              if (!form && !populated.length) return null;
              return (
                <section key={section.title} className="card card-pad stack">
                  <h2 className="h2">{section.title}</h2>
                  <div className="stack" style={{ gap: 14 }}>
                    {form
                      ? section.fields.map(([key, label]) => (
                          <div className="field" key={key}>
                            <label htmlFor={`ed-${key}`}>{label}</label>
                            <textarea
                              id={`ed-${key}`}
                              rows={2}
                              value={form.brief[key] || ""}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  brief: { ...form.brief, [key]: e.target.value },
                                })
                              }
                            />
                          </div>
                        ))
                      : populated.map(([key, label]) => (
                          <Detail key={key} label={label} value={brief[key]} />
                        ))}
                  </div>
                </section>
              );
            })}

            {form ? (
              <div className="row" style={{ gap: 10 }}>
                <button className="btn" onClick={saveDetails} disabled={saving}>
                  {saving ? "Saving..." : "Save production"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setForm(null);
                    setStatus(data.send.status);
                    setMessage("");
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : null}
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
