"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { PEOPLE } from "@/lib/people";
import { SOCIAL_CHANNELS } from "@/lib/social-qa-meta";

type RevClientOption = { id: string; name: string };
type DraftPost = {
  title: string;
  channel: string;
  goLiveOn: string;
  createdBy: string;
};

const CREATORS = [
  ...ADMIN_PEOPLE.map((p) => ({ slug: p.slug, label: p.label })),
  ...PEOPLE.filter((p) => !ADMIN_PEOPLE.some((a) => a.slug === p.slug)).map((p) => ({
    slug: p.slug,
    label: p.label,
  })),
];

export default function NewSocialBatchPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clients, setClients] = useState<RevClientOption[]>([]);
  const [clientName, setClientName] = useState("");
  const [sproutUrl, setSproutUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [posts, setPosts] = useState<DraftPost[]>([
    { title: "", channel: "Instagram", goLiveOn: "", createdBy: "" },
  ]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setClients(d.clients.map((c: RevClientOption) => ({ id: c.id, name: c.name })));
      });
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const slug = d?.owner ? "michael" : d?.person || "";
        if (slug) {
          setPosts((rows) =>
            rows.map((row) => (row.createdBy ? row : { ...row, createdBy: slug }))
          );
        }
      });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/social-qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        clientName,
        clientId:
          clients.find((c) => c.name.toLowerCase() === clientName.trim().toLowerCase())
            ?.id || null,
        sproutUrl,
        notes,
        posts: posts.filter((p) => p.title.trim()),
      }),
    });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not create the batch.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    router.push(`/admin/social-qa/${data.batch.id}`);
  }

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/social-qa">
          Back
        </Link>
      </div>
      <main className="container">
        <form
          className="card card-pad stack"
          onSubmit={onSubmit}
          style={{ maxWidth: 720, margin: "0 auto" }}
        >
          <div>
            <h1 className="h1">New social batch</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Paste the Sprout link, log the posts, then send a teammate to QA.
            </p>
          </div>
          {error ? <div className="banner banner-danger">{error}</div> : null}
          <div className="field">
            <label htmlFor="sq-title">Title</label>
            <input
              id="sq-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Humble Somm — week of Sep 8"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sq-client">Client</label>
            <input
              id="sq-client"
              list="sq-clients"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Start typing a client"
            />
            <datalist id="sq-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="sq-sprout">Sprout Social link</label>
            <input
              id="sq-sprout"
              type="url"
              value={sproutUrl}
              onChange={(e) => setSproutUrl(e.target.value)}
              placeholder="https://app.sproutsocial.com/..."
            />
          </div>
          <div className="field">
            <label htmlFor="sq-notes">Notes</label>
            <textarea
              id="sq-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label>Posts</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setPosts((rows) => [
                    ...rows,
                    {
                      title: "",
                      channel: "Instagram",
                      goLiveOn: "",
                      createdBy: rows[0]?.createdBy || "",
                    },
                  ])
                }
              >
                Add post
              </button>
            </div>
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              {posts.map((post, i) => (
                <div key={i} className="card card-pad stack" style={{ gap: 8 }}>
                  <input
                    value={post.title}
                    onChange={(e) =>
                      setPosts((rows) =>
                        rows.map((r, idx) => (idx === i ? { ...r, title: e.target.value } : r))
                      )
                    }
                    placeholder="Reel — patio cocktail"
                  />
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <select
                      value={post.channel}
                      onChange={(e) =>
                        setPosts((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, channel: e.target.value } : r
                          )
                        )
                      }
                    >
                      {SOCIAL_CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={post.goLiveOn}
                      onChange={(e) =>
                        setPosts((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, goLiveOn: e.target.value } : r
                          )
                        )
                      }
                    />
                    <select
                      value={post.createdBy}
                      onChange={(e) =>
                        setPosts((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, createdBy: e.target.value } : r
                          )
                        )
                      }
                    >
                      <option value="">Created by</option>
                      {CREATORS.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Create batch"}
          </button>
        </form>
      </main>
    </div>
  );
}
