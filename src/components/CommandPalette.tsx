"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Hit = {
  kind: "client" | "campaign";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// Static destinations always offered so the palette doubles as quick-nav even
// with an empty query.
const QUICK_LINKS: Hit[] = [
  { kind: "client", id: "nav-home", title: "Home", subtitle: "Dashboard", href: "/admin" },
  { kind: "client", id: "nav-campaigns", title: "Campaigns", subtitle: "All campaigns", href: "/admin/campaigns" },
  { kind: "client", id: "nav-calendar", title: "Calendar", subtitle: "Send calendar", href: "/admin/calendar" },
  { kind: "client", id: "nav-production", title: "Production", subtitle: "Scheduler", href: "/admin/production" },
  { kind: "client", id: "nav-forecast", title: "Forecast", subtitle: "Team allocation", href: "/admin/forecast" },
  { kind: "client", id: "nav-todos", title: "To-dos", subtitle: "Team tasks", href: "/admin/todos" },
  { kind: "client", id: "nav-clients", title: "Clients", subtitle: "All clients", href: "/admin/clients" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>(QUICK_LINKS);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits(QUICK_LINKS);
    setActive(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("cmdk:open", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("cmdk:open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits(QUICK_LINKS);
      setActive(0);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((data) => {
          if (id !== reqId.current) return;
          setHits(data.hits || []);
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  function go(hit: Hit) {
    close();
    router.push(hit.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onMouseDown={close} role="dialog" aria-modal="true">
      <div className="cmdk-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search clients, campaigns, or jump to…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
        />
        <div className="cmdk-results">
          {hits.length === 0 ? (
            <p className="cmdk-empty">No matches for “{q}”.</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                className={`cmdk-item ${i === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
              >
                <span className={`cmdk-kind cmdk-kind-${hit.kind}`}>
                  {hit.kind === "campaign" ? "Campaign" : "Client"}
                </span>
                <span className="cmdk-title">{hit.title}</span>
                <span className="cmdk-sub">{hit.subtitle}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
