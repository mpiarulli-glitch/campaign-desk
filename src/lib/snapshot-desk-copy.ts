// Copy and layout text for the This Week desk only.
// Account snapshot pages keep their own labels.

export function deskDepartmentHeading(label: string): string {
  return label.replace(/ Department$/, " department");
}

export function deskWinNeededLine(count: number): string {
  if (count <= 0) return "Your weekly win is in on every account in this list.";
  if (count === 1) return "1 account still needs a win this week.";
  return `${count} accounts still need a win this week.`;
}

/** Helper line under a department field: matched to-dos, then ones with no department. */
export function deskTodoCountLine(matched: number, unmatched: number): string {
  const parts: string[] = [];
  if (matched > 0) {
    parts.push(`${matched} to-do${matched === 1 ? "" : "s"} in this department`);
  }
  if (unmatched > 0) parts.push(`${unmatched} unassigned`);
  return parts.join(" · ");
}

/**
 * A logged line is one stored string. A blank line or "Description:" splits a
 * title from the rest for the card. Otherwise the whole line is the title.
 */
export function deskItemParts(body: string): { title: string; description: string } {
  const text = body.trim();
  const line = text.indexOf("\n");
  if (line > 0) {
    return {
      title: text.slice(0, line).trim(),
      description: text.slice(line + 1).trim(),
    };
  }
  const marker = text.match(/\s+description:\s+/i);
  if (marker && marker.index !== undefined && marker.index > 0) {
    return {
      title: text.slice(0, marker.index).trim(),
      description: text.slice(marker.index + marker[0].length).trim(),
    };
  }
  return { title: text, description: "" };
}

export function deskCustomItemLabel(query: string): string {
  return `Add "${query.trim()}" as a custom item`;
}
