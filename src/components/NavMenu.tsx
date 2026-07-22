"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAV_ITEMS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/production", label: "Production" },
  { href: "/admin/forecast", label: "Forecast" },
  { href: "/admin/snapshot", label: "Snapshots" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/activity", label: "Activity" },
];

// Single dropdown standing in for the old per-page row of nav links, so the
// topbar doesn't wrap into a tall multi-line mess on narrow screens.
export function NavMenu({ current }: { current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="nav-menu" ref={wrapRef}>
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
          {NAV_ITEMS.map((item) => (
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
