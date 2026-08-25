export function adjacentPackageId(
  ids: string[],
  activeId: string,
  dir: -1 | 1
): string | null {
  if (ids.length < 2) return null;
  const i = ids.indexOf(activeId);
  if (i < 0) return null;
  const next = i + dir;
  if (next < 0 || next >= ids.length) return null;
  return ids[next] ?? null;
}
