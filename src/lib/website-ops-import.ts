// Turn a pasted CSV into website-desk drafts. Parsing does not write anything.
// Recognized header rows match the sheets the web team already keeps:
// production, the landing-page list, completed projects, and a coverage list.

import {
  blankDraft,
  parseDeskDate,
  type WebsiteBoard,
  type WebsiteDraft,
  type WebsitePriority,
} from "./website-ops-model";

export type WebsiteImportRow = {
  draft: WebsiteDraft;
  warning: string;
};

export type WebsiteImportPreview = {
  format: string;
  rows: WebsiteImportRow[];
  errors: string[];
};

const WEBSITE_STAGE_ALIASES: Record<string, string> = {
  briefing: "briefing",
  discovery: "briefing",
  design: "design",
  "content review": "content_review",
  development: "development",
  qa: "qa",
  "final qa": "qa",
  launched: "launched",
};

const LANDING_STAGE_ALIASES: Record<string, string> = {
  "needs information": "needs_information",
  "needs info": "needs_information",
  "in progress": "in_progress",
  "under review": "under_review",
  paused: "paused",
  unknown: "needs_information",
  done: "done",
};

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function records(grid: string[][]): Array<Record<string, string>> {
  if (!grid.length) return [];
  const headers = grid[0].map(headerKey);
  return grid.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] || "").trim();
    });
    return record;
  });
}

function detectFormat(headers: string[]): string {
  const has = (name: string) => headers.includes(name);
  if (has("what needs to happen")) return "coverage";
  if (has("link to to-do") || (has("task") && has("due date") && has("status"))) return "ooo";
  if (has("launch date") && has("project name")) return "completed";
  if (has("project stage") && has("project name")) return "production";
  if (has("status") && (has("landing page / task") || has("client account"))) return "landing";
  return "";
}

function priorityOf(value: string): { priority: WebsitePriority; pastDue: boolean } {
  const text = value.trim().toLowerCase();
  if (text === "high") return { priority: "high", pastDue: false };
  if (text === "low") return { priority: "low", pastDue: false };
  if (text === "past due") return { priority: "high", pastDue: true };
  return { priority: "medium", pastDue: false };
}

function splitNotes(notes: string): { url: string; text: string } {
  const match = notes.match(/https?:\/\/\S+/);
  if (!match) return { url: "", text: notes.trim() };
  const url = match[0].replace(/[.,)]+$/, "");
  const text = notes.replace(match[0], "").replace(/^[\s—–:-]+/, "").trim();
  return { url, text };
}

function stageFor(board: WebsiteBoard, label: string): string | null {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const table = board === "website" ? WEBSITE_STAGE_ALIASES : LANDING_STAGE_ALIASES;
  return table[key] || null;
}

function withNotes(draft: WebsiteDraft, notes: string, pastDue: boolean): string {
  const { url, text } = splitNotes(notes);
  if (url && !draft.basecampUrl) draft.basecampUrl = url;
  const parts = [text];
  if (pastDue) parts.push("Marked past due on the sheet.");
  draft.blockers = parts.filter(Boolean).join(" ");
  return "";
}

export function parseWebsiteCsv(
  csv: string,
  fileAs: "auto" | "non_responsive" = "auto"
): WebsiteImportPreview {
  const grid = parseCsv(csv);
  if (!grid.length) return { format: "", rows: [], errors: ["That file is empty."] };
  const headers = grid[0].map(headerKey);
  const format = detectFormat(headers);
  if (!format) {
    return {
      format: "",
      rows: [],
      errors: [
        "Use a header row from Production, the landing-page list, completed projects, or the coverage list.",
      ],
    };
  }

  const rows: WebsiteImportRow[] = [];
  const errors: string[] = [];
  let group: "web" | "custom" = "web";

  if (format === "production" || format === "completed") {
    for (const record of records(grid)) {
      const name = record["project name"] || "";
      const only = Object.values(record).filter(Boolean);
      if (/^custom projects$/i.test(name) || (only.length === 1 && /^custom projects$/i.test(only[0] || ""))) {
        group = "custom";
        continue;
      }
      if (!name || /^project name$/i.test(name) || /^website production$/i.test(name)) continue;
      const board: WebsiteBoard = "website";
      const stage = stageFor(board, record["project stage"] || (format === "completed" ? "Launched" : ""));
      if (!stage) {
        errors.push(`Skipped ${name}: unknown stage “${record["project stage"] || ""}”.`);
        continue;
      }
      const draft = blankDraft(board);
      draft.name = name;
      draft.clientName = name;
      draft.projectGroup = group === "custom" || /^(meg website|empire analytics|inframe)/i.test(name) ? "custom" : "web";
      draft.tier = record.tiers || record.tier || "";
      draft.platform = record.platform || "";
      draft.deliverables = record.deliverables || "";
      draft.stage = stage;
      draft.owners = record["internal support"] || record["team member"] || "";
      draft.outsource = record.outsource || "";
      draft.startOn = parseDeskDate(record["start date"] || "");
      const targetRaw = record["target launch date"] || "";
      draft.targetOn = parseDeskDate(targetRaw);
      draft.launchOn = parseDeskDate(record["launch date"] || "");
      const touchRaw = record["last touchpoint"] || "";
      draft.lastTouchpoint = parseDeskDate(touchRaw);
      const { priority, pastDue } = priorityOf(record.priority || "");
      draft.priority = priority;
      draft.quarter = record["quarter period"] || "";
      let warning = withNotes(draft, record["notes / blockers"] || "", pastDue);
      if (targetRaw && !draft.targetOn) warning = warning || `Target was “${targetRaw}”, not a date.`;
      if (touchRaw && !draft.lastTouchpoint && !draft.blockers.includes(touchRaw)) {
        draft.blockers = [draft.blockers, touchRaw].filter(Boolean).join(" ");
      }
      if (format === "completed") {
        draft.disposition = "launched";
        if (draft.stage !== "launched") draft.stage = "launched";
      } else if (draft.stage === "launched") {
        draft.disposition = "launched";
      }
      if (fileAs === "non_responsive") draft.disposition = "non_responsive";
      rows.push({ draft, warning });
    }
  }

  if (format === "landing") {
    for (const record of records(grid)) {
      const name = record["landing page / task"] || "";
      const client = record["client account"] || "";
      if (!name) continue;
      const stage = stageFor("landing", record.status || "");
      if (!stage) {
        errors.push(`Skipped ${client || name}: unknown status “${record.status || ""}”.`);
        continue;
      }
      const draft = blankDraft("landing");
      draft.name = client && !name.toLowerCase().startsWith(client.toLowerCase()) ? `${client} — ${name}` : name;
      draft.clientName = client;
      draft.stage = stage;
      draft.disposition = stage === "done" ? "launched" : stage === "paused" ? "paused" : "active";
      if (fileAs === "non_responsive") draft.disposition = "non_responsive";
      const dates = record["dates (pt)"] || "";
      draft.targetOn = parseDeskDate(dates.split(/[–-]/)[0] || dates);
      draft.basecampUrl = splitNotes(record.link || "").url;
      draft.blockers = record["pending on"] || "";
      draft.owners = "";
      rows.push({
        draft,
        warning: dates && !draft.targetOn ? `Date was “${dates}”.` : "",
      });
    }
  }

  if (format === "coverage" || format === "ooo") {
    for (const record of records(grid)) {
      const title = record["client — page"] || record["client - page"] || record.task || "";
      const client = record.client || "";
      if (!title && !client) continue;
      const draft = blankDraft("landing");
      const page = title || record.task || "";
      draft.name = client && page && !page.toLowerCase().includes(client.toLowerCase()) ? `${client} — ${page}` : page || client;
      draft.clientName = client || draft.name.split(/\s+[—-]\s+/)[0] || "";
      const status = (record.status || "").toLowerCase();
      if (status === "done") {
        draft.stage = "done";
        draft.disposition = "launched";
      } else if (status.includes("waiting")) {
        draft.stage = "under_review";
      } else if (status === "paused") {
        draft.stage = "paused";
        draft.disposition = "paused";
      } else {
        draft.stage = "in_progress";
      }
      const ownerWait = record["owner → waiting on"] || record["owner -> waiting on"] || "";
      if (ownerWait) {
        const [owners, waiting] = ownerWait.split(/\s*(?:→|->)\s*/);
        draft.owners = (owners || "").trim();
        draft.waitingOn = (waiting || "").trim();
      }
      draft.nextStep = record["what needs to happen"] || "";
      draft.targetOn = parseDeskDate(record["due date"] || "");
      draft.coverage = true;
      draft.coverageWhen = record.when || "";
      const { priority } = priorityOf(record.priority || "");
      draft.priority = record.priority ? priority : "medium";
      draft.basecampUrl = splitNotes(record.basecamp || record.link || record["link to to-do"] || "").url;
      if (fileAs === "non_responsive") draft.disposition = "non_responsive";
      rows.push({ draft, warning: "" });
    }
  }

  if (!rows.length && !errors.length) errors.push("No project rows found under that header.");
  return { format, rows, errors };
}
