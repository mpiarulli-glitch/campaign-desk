// Split a day's hours across N todos so the weekly gauge still adds up.
// Slices are tenths of an hour; leftover tenths go to the first rows
// (4 hours / 3 todos → 1.4, 1.3, 1.3). Empty when total or count can't
// produce a positive split — the caller decides how to tell the person.
export function splitHours(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total <= 0 || count < 1) return [];
  if (count === 1) return [Math.round(total * 10) / 10];
  const tenths = Math.round(total * 10);
  const base = Math.floor(tenths / count);
  const rem = tenths % count;
  return Array.from({ length: count }, (_, i) => (base + (i < rem ? 1 : 0)) / 10);
}

export function minHoursForTodos(count: number): number {
  return Math.max(1, count) * 0.1;
}
