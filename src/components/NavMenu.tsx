"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { entryLevelPeople, hasProductionAccess, personLabel as forecastPersonLabel } from "@/lib/people";
import { CommandPalette } from "./CommandPalette";

const NAV_ITEMS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/production", label: "Production" },
  { href: "/admin/forecast", label: "Forecast" },
  { href: "/admin/todos", label: "To-dos" },
  { href: "/admin/snapshot", label: "Snapshots" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/activity", label: "Activity" },
];

const FORECAST_NAV_ITEMS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/forecast", label: "Forecast" },
  { href: "/admin/todos", label: "To-dos" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/snapshot", label: "Snapshot" },
];

// Single dropdown standing in for the old per-page row of nav links, so the
// topbar doesn't wrap into a tall multi-line mess on narrow screens.
export function NavMenu({ current }: { current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<{
    role: "admin" | "forecast" | null;
    person: string | null;
    owner: boolean;
    impersonating: boolean;
  }>({
    role: null,
    person: null,
    owner: false,
    impersonating: false,
  });
  const [switching, setSwitching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data?.authenticated) {
          setSession({
            role: data.role,
            person: data.person || null,
            owner: Boolean(data.owner),
            impersonating: Boolean(data.impersonating),
          });
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  async function viewAs(person: string, role: "admin" | "forecast" = "admin") {
    if (!person || switching) return;
    setSwitching(true);
    const res = await fetch("/api/auth/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, role }),
    });
    if (res.ok) {
      window.location.assign(role === "forecast" ? `/admin/forecast/${person}` : "/admin");
      return;
    }
    setSwitching(false);
  }

  // Combined dropdown option values are "role:slug" so one <select> can pick
  // between the two distinct account systems (full admin vs restricted team
  // member) without a second control.
  function onViewAsChange(value: string) {
    const [role, person] = value.split(":");
    if (role === "admin" || role === "forecast") viewAs(person, role);
  }

  async function returnToOwner() {
    if (switching) return;
    setSwitching(true);
    const res = await fetch("/api/auth/impersonate", { method: "DELETE" });
    if (res.ok) {
      window.location.assign("/admin");
      return;
    }
    setSwitching(false);
  }

  const personLabel = session.person
    ? ADMIN_PEOPLE.find((p) => p.slug === session.person)?.label ||
      (session.role === "forecast" ? forecastPersonLabel(session.person) : session.person)
    : session.person;

  const items =
    session.role === "admin"
      ? NAV_ITEMS
      : (() => {
          const base = FORECAST_NAV_ITEMS.map((item) =>
            item.href === "/admin/forecast" && session.person
              ? { ...item, href: `/admin/forecast/${session.person}` }
              : item
          );
          return session.person && hasProductionAccess(session.person)
            ? [...base, { href: "/admin/production", label: "Production" }]
            : base;
        })();

  return (
    <div className="nav-menu" ref={wrapRef}>
      <CommandPalette />
      <button
        type="button"
        className="btn btn-ghost btn-sm nav-search-trigger"
        onClick={() => document.dispatchEvent(new CustomEvent("cmdk:open"))}
        title="Search (⌘K)"
      >
        <span aria-hidden="true">⌕</span> Search
        <kbd className="nav-search-kbd">⌘K</kbd>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm nav-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Menu <span className="nav-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="nav-menu-panel" role="menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={`nav-menu-item ${current === item.href ? "is-current" : ""}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          {session.owner ? (
            <div className="nav-menu-view-as">
              <label htmlFor="view-as-person">View as</label>
              <select
                id="view-as-person"
                value=""
                disabled={switching}
                onChange={(event) => onViewAsChange(event.target.value)}
              >
                <option value="">Choose a person...</option>
                <optgroup label="Admin accounts">
                  {ADMIN_PEOPLE.map((person) => (
                    <option key={person.slug} value={`admin:${person.slug}`}>
                      {person.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Team members">
                  {entryLevelPeople().map((person) => (
                    <option key={person.slug} value={`forecast:${person.slug}`}>
                      {person.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          ) : null}
          {session.impersonating ? (
            <div className="nav-menu-viewing">
              <span>Viewing as {personLabel}</span>
              <button
                type="button"
                className="nav-menu-return"
                disabled={switching}
                onClick={returnToOwner}
              >
                {switching ? "Returning..." : "Return to Michael"}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="nav-menu-item nav-menu-signout"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
