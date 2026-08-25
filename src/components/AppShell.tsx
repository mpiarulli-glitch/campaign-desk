"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { doesCampaignWork, entryLevelPeople, hasProductionAccess, campaignKindFor, isValidPerson, personLabel as forecastPersonLabel } from "@/lib/people";
import { CommandPalette } from "./CommandPalette";
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
  // True while this person is still signing in with a shared env-var password
  // instead of one they set themselves.
  mustSetPassword: boolean;
};

type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

// Sunset (2026-07-31), hidden from every role including the owner: Revenue and
// the in-app To-dos. Their routes now redirect to Home. The /api/revenue
// endpoints stay put, because /api/revenue/clients is the client registry the
// rest of the app reads from and is not a revenue feature. Forecast to-dos are
// a separate, still-live feature backed by Basecamp.
const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Home", icon: "home" },
  { href: "/admin/clients", label: "Clients", icon: "clients" },
  { href: "/admin/campaigns", label: "Campaigns", icon: "mail" },
  // Admin-only: aggregates every client's approvals, outreach and economics.
  { href: "/admin/lifecycle", label: "Lifecycle", icon: "funnel" },
  { href: "/admin/calendar", label: "Calendar", icon: "calendar" },
  // Production is spliced in below for the people on PRODUCTION_ACCESS only, so
  // it is deliberately absent here.
  { href: "/admin/hub", label: "MEG Team Hub", icon: "users" },
  { href: "/admin/onboarding", label: "Onboarding", icon: "check" },
  { href: "/admin/whiteboard", label: "Whiteboard", icon: "board" },
  { href: "/admin/client-services", label: "Client Services", icon: "ring" },
  // Aggregates across every client and person, so admin nav only.
  { href: "/admin/reports", label: "Reports", icon: "note" },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
];

// Whiteboard is open to every role. Its API already authorised both admin and
// forecast sessions (isWorkflowAuthenticated) and neither page has a role check,
// so only the sidebar link was missing.
const FORECAST_NAV: NavItem[] = [
  { href: "/admin", label: "Home", icon: "home" },
  { href: "/admin/hub", label: "MEG Team Hub", icon: "users" },
  { href: "/admin/calendar", label: "Calendar", icon: "calendar" },
  { href: "/admin/whiteboard", label: "Whiteboard", icon: "board" },
  { href: "/admin/client-services", label: "Client Services", icon: "ring" },
];

const ICONS = {
  home: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  clients: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  video: <><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  board: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M7.5 11c1.6-2.2 3.2-2.2 4.8 0s3.2 2.2 4.8 0" /></>,
  check: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  funnel: <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />,
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
  const [session, setSession] = useState<Session>({ role: null, person: null, owner: false, impersonating: false, mustSetPassword: false });
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
          setSession({ role: d.role, person: d.person || null, owner: Boolean(d.owner), impersonating: Boolean(d.impersonating), mustSetPassword: Boolean(d.mustSetPassword) });
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

  // Forecast is per-person, so its href depends on the session and it can't live
  // in the static arrays above. Team members get it second, since it's their
  // daily view; admins get it grouped with the other team tools.
  const forecastHref =
    session.person && isValidPerson(session.person)
      ? `/admin/forecast/${session.person}`
      : "/admin/forecast";
  const forecastItem: NavItem = {
    href: forecastHref,
    label: "Forecast",
    icon: "forecast",
  };

  // Production scheduling is on an explicit person list, so it is spliced in for
  // both roles rather than being implied by being an admin. The owner's session
  // carries a null person, hence the separate check.
  const productionItem: NavItem = {
    href: "/admin/production",
    label: "Production",
    icon: "video",
  };
  const canSeeProduction =
    session.owner || (Boolean(session.person) && hasProductionAccess(session.person!));

  // Campaign features follow TEAM_FOCUS. Someone with a narrowed focus that
  // still includes campaign work (the SEO side) gets Campaigns even on the
  // forecast role; someone with an empty focus (the web team) loses the campaign
  // pages entirely, Calendar included, since it is the campaign calendar.
  const ownsCampaignWork = session.owner || doesCampaignWork(session.person);
  const focusedOnCampaigns = campaignKindFor(session.person) !== null;
  const campaignsItem: NavItem = {
    href: "/admin/campaigns",
    label: "Campaigns",
    icon: "mail",
  };

  const items: NavItem[] = session.role === "forecast"
    ? [
        FORECAST_NAV[0],
        forecastItem,
        ...(focusedOnCampaigns ? [campaignsItem] : []),
        ...FORECAST_NAV.slice(1).filter(
          (item) => ownsCampaignWork || item.href !== "/admin/calendar"
        ),
        ...(canSeeProduction ? [productionItem] : []),
      ]
    : ADMIN_NAV.flatMap((item) => {
        if (!ownsCampaignWork && (item.href === "/admin/campaigns" || item.href === "/admin/calendar")) {
          return [];
        }
        return item.href === "/admin/hub"
          ? [...(canSeeProduction ? [productionItem] : []), forecastItem, item]
          : [item];
      });

  const meLabel = session.person
    ? (ADMIN_PEOPLE.find((p) => p.slug === session.person)?.label ||
       (session.role === "forecast" ? forecastPersonLabel(session.person) : session.person))
    : "Owner";

  function isActive(href: string): boolean {
    if (href === "/admin") return pathname === "/admin";
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
    if (res.ok) { window.location.assign(role === "forecast" ? `/admin/forecast/${person}` : "/admin"); return; }
    setSwitching(false);
  }
  async function returnToOwner() {
    if (switching) return;
    setSwitching(true);
    const res = await fetch("/api/auth/impersonate", { method: "DELETE" });
    if (res.ok) { window.location.assign("/admin"); return; }
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
        <Link href="/admin" className="side-brand" title="Campaign Desk">
          <span className="side-mark" aria-hidden="true">M</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/meg-logo.png"
            alt="Marketing Empire Group"
            className="side-logo"
            width={180}
            height={45}
          />
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
                  {session.owner ? (
                    <Link href="/admin/users" className="app-menu-i" onClick={() => setMenuOpen(false)}>
                      <Svg name="clients" />Accounts
                    </Link>
                  ) : null}

                  <div className="app-menu-div" />

                  {session.owner ? (
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
    </div>
  );
}
