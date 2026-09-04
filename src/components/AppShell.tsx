"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { entryLevelPeople, isValidPerson, personLabel as forecastPersonLabel } from "@/lib/people";
import { CommandPalette } from "./CommandPalette";
import { TimerDock } from "./TimerDock";
import { ActivityBell } from "./ActivityBell";
import {
  applyTheme,
  readThemeChoice,
  storeThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

type Session = {
  role: "admin" | "forecast" | null;
  person: string | null;
  owner: boolean;
  impersonating: boolean;
  mustSetPassword: boolean;
  forecastGoogle: boolean;
  // Whose weeks this session may open. Used so the Forecast sidebar link
  // stays on the team board when someone (Roy) can see a teammate too.
  forecastSubjects: "*" | Array<{ slug: string; label: string }>;
  // The sidebar, already resolved against this person's permissions by
  // /api/auth. Empty until that response lands, which is deliberate: guessing
  // the nav from the role would flash links somebody is not allowed to open.
  pages: NavItem[];
  capabilities: Record<string, boolean>;
};

type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

// The nav is no longer built here. Which pages a person can see is one answer,
// owned by src/lib/access.ts and resolved per session by /api/auth, so the
// sidebar and the route gates can never disagree. The owner edits it on
// /admin/access.
//
// Still true and still enforced there: Revenue and the in-app To-dos were
// sunset on 2026-07-31 and are absent from the registry entirely, so no toggle
// can bring them back. Snapshots is in the registry without an href, so it
// stays gateable without returning to the sidebar that Client Services
// replaced.

const ICONS = {
  home: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  clients: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>,
  social: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  video: <><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  board: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M7.5 11c1.6-2.2 3.2-2.2 4.8 0s3.2 2.2 4.8 0" /></>,
  check: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  funnel: <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />,
  ads: <><path d="M3 11v2a1 1 0 0 0 1 1h2l6 6V4L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M18.07 5.93a9 9 0 0 1 0 12.14" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  ring: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></>,
  forecast: <><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></>,
  note: <><path d="M12 20h9M4 20V4h11l5 5" /><path d="M14 4v6h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  bell2: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
} as const;

function Svg({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

function initials(label: string): string {
  const p = label.trim().split(/\s+/);
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session>({
    role: null,
    person: null,
    owner: false,
    impersonating: false,
    mustSetPassword: false,
    forecastGoogle: false,
    forecastSubjects: [],
    pages: [],
    capabilities: {},
  });
  const [menuOpen, setMenuOpen] = useState(false);
  // Mobile nav drawer. Above the breakpoint the sidebar is always in the layout
  // and this class does nothing, so desktop is unaffected either way.
  const [navOpen, setNavOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  // Starts as "system" to match what the boot script assumed; the effect below
  // corrects it from localStorage once mounted. Reading storage during render
  // would mismatch the server-rendered HTML.
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setCollapsed(localStorage.getItem("cd-sidebar") !== "expanded");
    setThemeChoice(readThemeChoice());
  }, []);

  // While the choice is "System", follow the OS live rather than only at load,
  // so the app changes with the person's schedule without a refresh.
  useEffect(() => {
    if (themeChoice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeChoice]);

  function pickTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    storeThemeChoice(choice);
    applyTheme(choice);
  }
  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("cd-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (on && d?.authenticated) {
          setSession({
            role: d.role,
            person: d.person || null,
            owner: Boolean(d.owner),
            impersonating: Boolean(d.impersonating),
            mustSetPassword: Boolean(d.mustSetPassword),
            forecastGoogle: Boolean(d.forecastGoogle),
            forecastSubjects:
              d.forecastSubjects === "*"
                ? "*"
                : Array.isArray(d.forecastSubjects)
                  ? d.forecastSubjects
                  : [],
            // Only pages whose icon is one this shell can actually draw, so a
            // capability added to the registry without an icon degrades to
            // being absent rather than to a crash.
            pages: Array.isArray(d.pages)
              ? d.pages
                  .filter((p: NavItem) => p?.href && p?.icon && p.icon in ICONS)
                  .map((p: NavItem) => ({ href: p.href, label: p.label, icon: p.icon }))
              : [],
            capabilities: d.capabilities && typeof d.capabilities === "object" ? d.capabilities : {},
          });
        }
      })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Escape closes the drawer, which is the expected way out of an overlay.
  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Forecast is the one page whose href depends on who is looking. People who
  // can only see themselves go straight to their week; anyone granted a
  // teammate (or the whole roster) keeps the team board at /admin/forecast.
  const subjects = session.forecastSubjects;
  const onlyOwnForecast =
    Boolean(session.person) &&
    isValidPerson(session.person!) &&
    Array.isArray(subjects) &&
    subjects.length === 1 &&
    subjects[0]?.slug === session.person;
  const forecastHref = onlyOwnForecast
    ? `/admin/forecast/${session.person}`
    : "/admin/forecast";

  const items: NavItem[] = session.pages.map((item) =>
    item.href === "/admin/forecast" ? { ...item, href: forecastHref } : item
  );

  const can = (key: string) => Boolean(session.capabilities[key]);

  const meLabel = session.person
    ? (ADMIN_PEOPLE.find((p) => p.slug === session.person)?.label ||
       (session.role === "forecast" ? forecastPersonLabel(session.person) : session.person))
    : "Owner";

  function isActive(href: string): boolean {
    if (href === "/admin/hub") {
      return (
        pathname === "/admin/hub" ||
        pathname.startsWith("/admin/hub/") ||
        pathname.startsWith("/admin/courses/")
      );
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }
  async function viewAs(person: string, role: "admin" | "forecast") {
    if (!person || switching) return;
    setSwitching(true);
    const res = await fetch("/api/auth/impersonate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, role }),
    });
    if (res.ok) { window.location.assign("/admin/hub"); return; }
    setSwitching(false);
  }
  async function returnToOwner() {
    if (switching) return;
    setSwitching(true);
    const res = await fetch("/api/auth/impersonate", { method: "DELETE" });
    if (res.ok) { window.location.assign("/admin/hub"); return; }
    setSwitching(false);
  }

  return (
    <div className="cd-shell">
      <CommandPalette />
      {/* Tapping the page behind an open drawer closes it. Rendered only while
          open so it cannot swallow clicks on desktop. */}
      {navOpen ? (
        <div
          className="side-scrim"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside className={`side ${collapsed ? "is-collapsed" : ""} ${navOpen ? "is-open" : ""}`}>
        {/* Two marks, one shown at a time: the full wordmark needs the expanded
            sidebar's width, and the square mark carries the brand when it's
            collapsed to 56px, where a 4:1 wordmark would be illegible. */}
        <Link href="/admin/hub" className="side-brand" title="BUILD YOUR EMPIRE">
          <span className="side-mark" aria-hidden="true">M</span>
          <span className="side-brand-copy">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/meg-logo.png"
              alt="Marketing Empire Group"
              className="side-logo"
              width={180}
              height={45}
            />
            <span className="side-tagline empire-mark nav-label">BUILD YOUR EMPIRE</span>
          </span>
        </Link>
        <nav className="side-nav">
          {items.map((it) => (
            <Link key={it.href} href={it.href} title={it.label} className={`nav-i ${isActive(it.href) ? "on" : ""}`}>
              <Svg name={it.icon} />
              <span className="nav-label">{it.label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-viewas nav-label">
            {session.impersonating ? `Viewing as ${meLabel}` : session.owner ? "Owner" : meLabel}
          </div>
          <button className="side-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span className="side-toggle-icon" aria-hidden="true">{collapsed ? "»" : "«"}</span>
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="app-body">
        <header className="app-top">
          {/* Shown only under the mobile breakpoint, where the sidebar is a
              drawer rather than a rail. */}
          <button
            className="app-hamburger"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            <Svg name="menu" />
          </button>
          <button className="app-search" onClick={() => document.dispatchEvent(new CustomEvent("cmdk:open"))}>
            <span aria-hidden="true">⌕</span> Search clients, campaigns…
            <kbd>⌘K</kbd>
          </button>

          <div className="app-top-right">
            {session.role === "admin" ? <ActivityBell /> : null}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button className="app-avatarbtn" onClick={() => setMenuOpen((v) => !v)}>
                <span className="app-ava">{initials(meLabel)}</span>
                <span className="app-caret" aria-hidden="true">▾</span>
              </button>
              {menuOpen ? (
                <div className="app-menu" role="menu">
                  <div className="app-menu-head">
                    <span className="app-ava">{initials(meLabel)}</span>
                    <div><b>{meLabel}</b><small>{session.owner ? "Owner" : session.role === "admin" ? "Admin" : "User"}</small></div>
                  </div>

                  <div className="app-menu-sec">Appearance</div>
                  <div className="app-theme-row" role="group" aria-label="Appearance">
                    {THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`app-theme-btn ${themeChoice === opt.value ? "is-on" : ""}`}
                        aria-pressed={themeChoice === opt.value}
                        onClick={() => pickTheme(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="app-menu-div" />

                  <div className="app-menu-sec">Personal tools</div>
                  <Link href={forecastHref} className="app-menu-i" onClick={() => setMenuOpen(false)}><Svg name="forecast" />Forecast</Link>
                  {/* Hidden while impersonating: the password isn't theirs to change. */}
                  {session.impersonating ? null : (
                    <Link href="/account/password" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="eye" />{session.mustSetPassword ? "Set your password" : "Change password"}
                    </Link>
                  )}
                  {session.impersonating ? null : (
                    <Link href="/account/security" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="eye" />Two-factor
                    </Link>
                  )}
                  {session.impersonating ? null : (
                    <Link href="/account/basecamp" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="check" />Basecamp connection
                    </Link>
                  )}
                  {session.impersonating || !session.forecastGoogle ? null : (
                    <Link href="/account/google" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="calendar" />Google Calendar
                    </Link>
                  )}
                  {session.owner || can("tool.accounts") ? (
                    <Link href="/admin/users" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="clients" />Accounts
                    </Link>
                  ) : null}
                  {session.owner ? (
                    <Link href="/admin/access" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="gear" />Permissions
                    </Link>
                  ) : null}

                  <div className="app-menu-div" />

                  {session.owner || can("tool.impersonate") ? (
                    <div className="app-menu-viewas">
                      <label htmlFor="app-view-as"><Svg name="eye" /> View as</label>
                      <select id="app-view-as" value="" disabled={switching} onChange={(e) => {
                        const [role, person] = e.target.value.split(":");
                        if (role === "admin" || role === "forecast") viewAs(person, role);
                      }}>
                        <option value="">Choose a person…</option>
                        <optgroup label="Admin accounts">
                          {ADMIN_PEOPLE.map((p) => <option key={p.slug} value={`admin:${p.slug}`}>{p.label}</option>)}
                        </optgroup>
                        <optgroup label="Users">
                          {entryLevelPeople().map((p) => <option key={p.slug} value={`forecast:${p.slug}`}>{p.label}</option>)}
                        </optgroup>
                      </select>
                    </div>
                  ) : null}
                  {session.impersonating ? (
                    <button className="app-menu-i" onClick={returnToOwner} disabled={switching}>
                      <Svg name="eye" />{switching ? "Returning…" : "Return to Michael"}
                    </button>
                  ) : null}

                  <div className="app-menu-div" />
                  <button className="app-menu-i danger" onClick={signOut}><Svg name="logout" />Log out</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* Anyone still on a shared env-var password gets a standing reminder,
            since their activity is not yet attributable to them alone. */}
        {session.mustSetPassword && pathname !== "/account/password" ? (
          <div className="app-banner">
            <span>
              You are signing in with a shared password. Set your own so your
              work is recorded as yours.
            </span>
            <Link href="/account/password" className="btn btn-sm">
              Set password
            </Link>
          </div>
        ) : null}

        <main className="app-content">{children}</main>
      </div>
      {/* Global: a running forecast timer has to stay visible on every signed-in
          page, not only /admin/forecast/[person]. Last in the shell so it sits
          above page content without covering the left nav. */}
      {session.role ? <TimerDock /> : null}
    </div>
  );
}
