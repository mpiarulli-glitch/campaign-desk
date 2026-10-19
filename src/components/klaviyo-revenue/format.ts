export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatMoney(value: number, currency: string | null): string {
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    });
  } catch {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
}

export function formatRate(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${(ratio * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function countDelta(current: number | null, previous: number | null): {
  text: string;
  tone: "up" | "down" | "flat" | "na";
} {
  if (current == null || previous == null) return { text: "No prior period", tone: "na" };
  if (previous === 0) {
    if (current === 0) return { text: "Flat vs prior", tone: "flat" };
    return { text: "New vs prior", tone: "up" };
  }
  const ratio = (current - previous) / previous;
  const pct = `${ratio > 0 ? "+" : ""}${(ratio * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (Math.abs(ratio) < 0.005) return { text: "Flat vs prior", tone: "flat" };
  return { text: `${pct} vs prior`, tone: ratio > 0 ? "up" : "down" };
}

export function rateDelta(current: number | null, previous: number | null): {
  text: string;
  tone: "up" | "down" | "flat" | "na";
} {
  if (current == null || previous == null) return { text: "No prior period", tone: "na" };
  const points = (current - previous) * 100;
  if (Math.abs(points) < 0.05) return { text: "Flat vs prior", tone: "flat" };
  const text = `${points > 0 ? "+" : ""}${points.toLocaleString("en-US", { maximumFractionDigits: 1 })} pts vs prior`;
  return { text, tone: points > 0 ? "up" : "down" };
}
