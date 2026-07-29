"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  KnowledgeEntryFull,
  KnowledgeIndexPayload,
  KnowledgeListingRow,
  SwipeRow,
} from "./types";
import { Markdown } from "./Markdown";

type View = "today" | "library" | "swipe";

const PAGE = 40;

function fmtDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function KnowledgePanel() {
  const [view, setView] = useState<View>("today");
  const [index, setIndex] = useState<KnowledgeIndexPayload | null>(null);
  const [swipe, setSwipe] = useState<SwipeRow[] | null>(null);
  const [open, setOpen] = useState<KnowledgeEntryFull | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [q, setQ] = useState("");
  const [matchSlugs, setMatchSlugs] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);
  const [topic, setTopic] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState("");

  const loadIndex = useCallback(async () => {
    const res = await fetch("/api/lifecycle/knowledge");
    if (!res.ok) {
      setError("Could not load the knowledge base.");
      return;
    }
    setIndex(await res.json());
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  /**
   * Search runs server-side so it reaches the full text of every issue rather
   * than only the titles the list already holds. Results come back as a slug
   * set applied over the full index, which keeps read-state toggles and today's
   * pick working while a search is active. Debounced so typing is not chatty.
   */
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setMatchSlugs(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/lifecycle/knowledge?q=${encodeURIComponent(term)}`);
        if (!res.ok) return;
        const data: KnowledgeIndexPayload = await res.json();
        setMatchSlugs(new Set(data.entries.map((e) => e.slug)));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const openEntry = useCallback(async (slug: string) => {
    setLoadingEntry(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/knowledge?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setError("Could not open that issue.");
        return;
      }
      const { entry } = await res.json();
      setOpen(entry);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setLoadingEntry(false);
    }
  }, []);

  const toggleRead = useCallback(
    async (slug: string, read: boolean) => {
      // Update in place first so ticking through a reading session feels instant.
      setIndex((prev) =>
        prev
          ? {
              ...prev,
              readCount: prev.readCount + (read ? 1 : -1),
              entries: prev.entries.map((e) => (e.slug === slug ? { ...e, read } : e)),
            }
          : prev,
      );
      setOpen((prev) => (prev && prev.slug === slug ? { ...prev, read } : prev));
      await fetch("/api/lifecycle/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, read }),
      });
    },
    [],
  );

  const loadSwipe = useCallback(async () => {
    if (swipe) return;
    const res = await fetch("/api/lifecycle/knowledge?view=swipe");
    if (res.ok) setSwipe((await res.json()).swipe);
  }, [swipe]);

  useEffect(() => {
    if (view === "swipe") void loadSwipe();
  }, [view, loadSwipe]);

  // Topic and read state are cheap enough to filter here; the search term was
  // resolved to a slug set by the server.
  const filtered = useMemo(() => {
    if (!index) return [];
    return index.entries.filter(
      (e) =>
        !(unreadOnly && e.read) &&
        (!topic || e.topics.includes(topic)) &&
        (!matchSlugs || matchSlugs.has(e.slug)),
    );
  }, [index, topic, unreadOnly, matchSlugs]);

  useEffect(() => {
    setLimit(PAGE);
  }, [q, topic, unreadOnly]);

  if (!index) {
    return (
      <div className="hud-panel">
        <p className="hud-empty">{error || "Loading the archive…"}</p>
      </div>
    );
  }

  const today = index.entries.find((e) => e.slug === index.todaySlug) ?? null;
  const pct = index.total ? Math.round((index.readCount / index.total) * 100) : 0;

  /* ------------------------------------------------------------- reader */

  if (open) {
    return (
      <div className="hud-stack">
        <div className="hud-panel hud-reader-bar">
          <button className="hud-btn" onClick={() => setOpen(null)}>
            ← Back to library
          </button>
          <div className="hud-reader-actions">
            <button
              className={`hud-btn ${open.read ? "" : "hud-btn-quiet"}`}
              onClick={() => void toggleRead(open.slug, !open.read)}
            >
              {open.read ? "✓ Read" : "Mark as read"}
            </button>
            <a className="hud-link" href={open.url} target="_blank" rel="noreferrer">
              Original
            </a>
          </div>
        </div>

        <article className="hud-panel hud-read">
          <div className="hud-eyebrow">
            {fmtDate(open.published)} · {open.readMinutes} min · The Inbox Newsletter
          </div>
          <h1 className="hud-read-title">{open.title}</h1>
          <div className="hud-q-faults" style={{ marginBottom: 22 }}>
            {open.topics.map((t) => (
              <span key={t} className="hud-chip hud-chip-idle">
                {t}
              </span>
            ))}
          </div>

          <Markdown source={open.body} />

          {open.inspiration ? (
            <div className="hud-feature">
              <div className="hud-eyebrow">Email inspiration of the day</div>
              <h3 className="hud-feature-title">{open.inspiration.brand || "Featured brand"}</h3>
              {open.inspiration.note ? (
                <p className="hud-note-body">{open.inspiration.note}</p>
              ) : null}
              {open.inspiration.design ? (
                <a
                  className="hud-link"
                  href={open.inspiration.design}
                  target="_blank"
                  rel="noreferrer"
                >
                  View the design →
                </a>
              ) : null}
            </div>
          ) : null}

          {open.template ? (
            <div className="hud-feature">
              <div className="hud-eyebrow">Template of the day</div>
              <h3 className="hud-feature-title">{open.template.name || "Featured template"}</h3>
              {open.template.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="hud-read-img" src={open.template.image} alt={open.template.name} />
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    );
  }

  /* -------------------------------------------------------------- shell */

  return (
    <div className="hud-stack">
      <div className="hud-panel">
        <div className="hud-panel-head">
          <div>
            <div className="hud-eyebrow">Knowledge base · Max Sturtevant, Well Copy</div>
            <h2 className="hud-panel-title" style={{ marginTop: 6 }}>
              The Inbox Newsletter
            </h2>
          </div>
          <div className="hud-integrity">
            {index.readCount}
            <small> / {index.total}</small>
          </div>
        </div>
        <div className="hud-progress">
          <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="hud-array-legend">
          <span>
            <b>{index.total}</b> issues archived
          </span>
          <span>
            <b>{pct}%</b> read
          </span>
          <span style={{ marginLeft: "auto" }}>
            synced {index.scrapedAt ? fmtDate(index.scrapedAt.slice(0, 10)) : "never"}
          </span>
        </div>
      </div>

      <nav className="hud-channels">
        {(
          [
            ["today", "Today's read"],
            ["library", `Library · ${index.total}`],
            ["swipe", "Swipe file"],
          ] as Array<[View, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={`hud-channel ${view === id ? "on" : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="hud-err">{error}</p> : null}

      {view === "today" ? (
        today ? (
          <div className="hud-panel hud-today">
            <div className="hud-eyebrow">
              Today · {fmtDate(today.published)} · {today.readMinutes} min read
            </div>
            <h2 className="hud-today-title">{today.title}</h2>
            <p className="hud-note-body">{today.summary}</p>
            <div className="hud-q-faults" style={{ margin: "14px 0 18px" }}>
              {today.topics.map((t) => (
                <span key={t} className="hud-chip hud-chip-idle">
                  {t}
                </span>
              ))}
              {today.read ? <span className="hud-chip hud-chip-ok">Read</span> : null}
            </div>
            <button className="hud-btn" disabled={loadingEntry} onClick={() => void openEntry(today.slug)}>
              {loadingEntry ? "Opening" : "Read this issue"}
            </button>
          </div>
        ) : (
          <div className="hud-panel">
            <p className="hud-empty">The archive is empty. Run the scraper to populate it.</p>
          </div>
        )
      ) : null}

      {view === "library" ? (
        <>
          <div className="hud-panel hud-filters">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles and topics…"
            />
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">All topics</option>
              {index.topics.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.count})
                </option>
              ))}
            </select>
            <label className="hud-check">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                style={{ width: "auto" }}
              />
              Unread only
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="hud-empty">{searching ? "Searching…" : "Nothing matches that."}</p>
          ) : (
            <>
              <div className="hud-eyebrow">
                {filtered.length} issue{filtered.length === 1 ? "" : "s"}
                {q.trim() ? " matching full text" : ""}
              </div>
              {filtered.slice(0, limit).map((e: KnowledgeListingRow) => (
                <div key={e.slug} className={`hud-camp hud-issue ${e.read ? "is-read" : ""}`}>
                  <div className="hud-camp-top">
                    <button className="hud-q-name hud-issue-title" onClick={() => void openEntry(e.slug)}>
                      {e.title}
                    </button>
                    <span className="hud-row-meta">
                      {fmtDate(e.published)} · {e.readMinutes} min
                    </span>
                  </div>
                  {e.summary ? <p className="hud-note-body">{e.summary}</p> : null}
                  <div className="hud-camp-sub hud-issue-foot">
                    <span className="hud-q-faults">
                      {e.topics.map((t) => (
                        <span key={t} className="hud-chip hud-chip-idle">
                          {t}
                        </span>
                      ))}
                    </span>
                    <button className="hud-link" onClick={() => void toggleRead(e.slug, !e.read)}>
                      {e.read ? "Mark unread" : "Mark read"}
                    </button>
                  </div>
                </div>
              ))}
              {filtered.length > limit ? (
                <button className="hud-btn" onClick={() => setLimit((n) => n + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - limit)} more
                </button>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {view === "swipe" ? (
        !swipe ? (
          <p className="hud-empty">Loading the swipe file…</p>
        ) : (
          <>
            <div className="hud-eyebrow">
              {swipe.length} featured emails and templates, newest first
            </div>
            {swipe.map((s) => (
              <div key={s.slug} className="hud-camp">
                <div className="hud-camp-top">
                  <b>{s.brand || s.templateName || "Featured"}</b>
                  <span className="hud-row-meta">{fmtDate(s.published)}</span>
                </div>
                {s.note ? <p className="hud-note-body">{s.note}</p> : null}
                <div className="hud-camp-sub hud-issue-foot">
                  <span className="hud-q-faults">
                    {s.design ? (
                      <a className="hud-link" href={s.design} target="_blank" rel="noreferrer">
                        Email design →
                      </a>
                    ) : null}
                    {s.templateName ? (
                      <span className="hud-chip hud-chip-idle">{s.templateName}</span>
                    ) : null}
                  </span>
                  <button className="hud-link" onClick={() => void openEntry(s.slug)}>
                    {s.issueTitle}
                  </button>
                </div>
              </div>
            ))}
          </>
        )
      ) : null}
    </div>
  );
}
