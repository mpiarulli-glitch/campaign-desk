// Pure week helpers (no DB) — safe to import in client components.
// Weeks are keyed by their Monday as YYYY-MM-DD.

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function mondayOf(date: Date): string {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return toYmd(x);
}

export function currentWeek(): string {
  return mondayOf(new Date());
}

export function addWeeks(weekStart: string, n: number): string {
  const d = parseYmd(weekStart);
  d.setDate(d.getDate() + n * 7);
  return toYmd(d);
}

// The workday to plan a todo so it is done before it is due. One calendar day
// earlier, then if that lands on a weekend, the Friday before. Monday-due work
// is therefore planned on Friday, not on Sunday, which the week grid does not
// show.
export function dayBeforeDue(dueOn: string): string {
  const d = parseYmd(dueOn);
  d.setDate(d.getDate() - 1);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() - 1);
  if (day === 0) d.setDate(d.getDate() - 2);
  return toYmd(d);
}

// "Jul 14 – 20, 2026" (or spanning months / years when needed)
export function weekLabel(weekStart: string): string {
  const start = parseYmd(weekStart);
  const end = parseYmd(addWeeks(weekStart, 1));
  end.setDate(end.getDate() - 1);
  const mo = (d: Date) => d.toLocaleString("en-US", { month: "short" });
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth && sameYear) {
    return `${mo(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${mo(start)} ${start.getDate()} – ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${mo(start)} ${start.getDate()}, ${start.getFullYear()} – ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
}

export function isCurrentWeek(weekStart: string): boolean {
  return weekStart === currentWeek();
}
