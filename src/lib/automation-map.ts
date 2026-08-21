// Automation review map: trigger, waits, emails, and if/else branches.
//
// Kept free of Node-only imports so the review page and admin editor can
// share the same tree and delay labels.

export type Presentation = "package" | "automation";

export type TriggerKind = "tag" | "form" | "purchase" | "date" | "custom";

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: "tag", label: "Tag added" },
  { value: "form", label: "Form submitted" },
  { value: "purchase", label: "Purchase" },
  { value: "date", label: "Date / anniversary" },
  { value: "custom", label: "Custom" },
];

const TRIGGER_KIND_SET = new Set<TriggerKind>(
  TRIGGER_KINDS.map((k) => k.value)
);

export function coercePresentation(value: unknown): Presentation {
  return value === "automation" ? "automation" : "package";
}

export function coerceTriggerKind(value: unknown): TriggerKind {
  return typeof value === "string" && TRIGGER_KIND_SET.has(value as TriggerKind)
    ? (value as TriggerKind)
    : "custom";
}

export function triggerKindLabel(kind: TriggerKind): string {
  return TRIGGER_KINDS.find((k) => k.value === kind)?.label ?? "Custom";
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type DelayUnit = "minutes" | "hours" | "days";

export function delayToMs(amount: number, unit: DelayUnit): number {
  const n = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  if (unit === "days") return n * DAY_MS;
  if (unit === "hours") return n * HOUR_MS;
  return n * MINUTE_MS;
}

export function splitDelay(ms: number): { amount: number; unit: DelayUnit } {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n === 0) return { amount: 0, unit: "days" };
  if (n % DAY_MS === 0) return { amount: n / DAY_MS, unit: "days" };
  if (n % HOUR_MS === 0) return { amount: n / HOUR_MS, unit: "hours" };
  return { amount: Math.max(1, Math.round(n / MINUTE_MS)), unit: "minutes" };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Human wait label, the way a client would read it on the map. */
export function delayLabel(ms: number): string {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n <= 0) return "Immediately";
  const days = Math.floor(n / DAY_MS);
  const hours = Math.floor((n % DAY_MS) / HOUR_MS);
  const minutes = Math.round((n % HOUR_MS) / MINUTE_MS);
  const parts: string[] = [];
  if (days) parts.push(plural(days, "day", "days"));
  if (hours) parts.push(plural(hours, "hour", "hours"));
  if (minutes && parts.length < 2) parts.push(plural(minutes, "minute", "minutes"));
  return parts.join(" ");
}

export type FlowStepType = "wait" | "email" | "condition";
export type FlowBranch = "" | "yes" | "no";
export type ConditionKind =
  | "opened"
  | "clicked"
  | "replied"
  | "tagged"
  | "booked"
  | "custom";

export const CONDITION_KINDS: { value: ConditionKind; label: string }[] = [
  { value: "opened", label: "Email opened" },
  { value: "clicked", label: "Link clicked" },
  { value: "replied", label: "Replied" },
  { value: "tagged", label: "Has tag" },
  { value: "booked", label: "Booked" },
  { value: "custom", label: "Custom" },
];

const STEP_TYPE_SET = new Set<FlowStepType>(["wait", "email", "condition"]);
const BRANCH_SET = new Set<FlowBranch>(["", "yes", "no"]);
const CONDITION_KIND_SET = new Set<ConditionKind>(
  CONDITION_KINDS.map((k) => k.value)
);

export function coerceFlowStepType(value: unknown): FlowStepType | null {
  return typeof value === "string" && STEP_TYPE_SET.has(value as FlowStepType)
    ? (value as FlowStepType)
    : null;
}

export function coerceFlowBranch(value: unknown): FlowBranch {
  return typeof value === "string" && BRANCH_SET.has(value as FlowBranch)
    ? (value as FlowBranch)
    : "";
}

export function coerceConditionKind(value: unknown): ConditionKind {
  return typeof value === "string" &&
    CONDITION_KIND_SET.has(value as ConditionKind)
    ? (value as ConditionKind)
    : "custom";
}

export function conditionKindLabel(kind: ConditionKind): string {
  return CONDITION_KINDS.find((k) => k.value === kind)?.label ?? "Custom";
}

export function defaultConditionLabel(kind: ConditionKind): string {
  if (kind === "opened") return "Opened the last email?";
  if (kind === "clicked") return "Clicked a link?";
  if (kind === "replied") return "Replied?";
  if (kind === "tagged") return "Has tag?";
  if (kind === "booked") return "Booked an appointment?";
  return "If this is true";
}

export type AutomationEmail = {
  id: string;
  title: string;
  kind?: string | null;
  delay_ms?: number | null;
  approved_at?: string | null;
  open_comments?: number;
  purpose?: string | null;
  subject?: string | null;
};

export type FlowStepRecord = {
  id: string;
  campaign_id?: string;
  parent_id: string | null;
  branch: string;
  sort_order?: number;
  step_type: string;
  delay_ms: number;
  email_id: string | null;
  condition_kind: string;
  condition_label: string;
};

export type FlowTreeNode =
  | {
      type: "wait";
      id: string;
      delayMs: number;
      label: string;
    }
  | {
      type: "email";
      id: string;
      emailId: string;
      email: AutomationEmail | null;
    }
  | {
      type: "condition";
      id: string;
      kind: ConditionKind;
      label: string;
      yes: FlowTreeNode[];
      no: FlowTreeNode[];
    };

export function defaultTriggerLabel(kind: TriggerKind): string {
  return triggerKindLabel(kind);
}

function childrenOf(
  steps: FlowStepRecord[],
  parentId: string | null,
  branch: FlowBranch
): FlowStepRecord[] {
  return steps
    .filter((step) => {
      const sameParent =
        parentId === null
          ? !step.parent_id
          : step.parent_id === parentId;
      return sameParent && coerceFlowBranch(step.branch) === branch;
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function nodeFromStep(
  step: FlowStepRecord,
  steps: FlowStepRecord[],
  emailsById: Map<string, AutomationEmail>
): FlowTreeNode | null {
  const type = coerceFlowStepType(step.step_type);
  if (type === "wait") {
    const delayMs = Math.max(0, Math.round(Number(step.delay_ms) || 0));
    return {
      type: "wait",
      id: step.id,
      delayMs,
      label: delayLabel(delayMs),
    };
  }
  if (type === "email") {
    const emailId = step.email_id || "";
    return {
      type: "email",
      id: step.id,
      emailId,
      email: (emailId && emailsById.get(emailId)) || null,
    };
  }
  if (type === "condition") {
    const kind = coerceConditionKind(step.condition_kind);
    const label =
      (step.condition_label || "").trim() || defaultConditionLabel(kind);
    return {
      type: "condition",
      id: step.id,
      kind,
      label,
      yes: buildFlowBranch(steps, emailsById, step.id, "yes"),
      no: buildFlowBranch(steps, emailsById, step.id, "no"),
    };
  }
  return null;
}

export function buildFlowBranch(
  steps: FlowStepRecord[],
  emailsById: Map<string, AutomationEmail>,
  parentId: string | null,
  branch: FlowBranch
): FlowTreeNode[] {
  const nodes: FlowTreeNode[] = [];
  for (const step of childrenOf(steps, parentId, branch)) {
    const node = nodeFromStep(step, steps, emailsById);
    if (node) nodes.push(node);
  }
  return nodes;
}

function emailsByIdMap(emails: AutomationEmail[]): Map<string, AutomationEmail> {
  return new Map(emails.map((email) => [email.id, email]));
}

/**
 * When a campaign has no stored flow yet, recover a linear path from the
 * emails themselves. A wait node is only added when delay_ms is greater than
 * zero — blank waits are something you add on purpose.
 */
export function fallbackFlowFromEmails(emails: AutomationEmail[]): FlowTreeNode[] {
  const nodes: FlowTreeNode[] = [];
  for (const email of emails) {
    const delayMs = Math.max(0, Math.round(Number(email.delay_ms) || 0));
    if (delayMs > 0) {
      nodes.push({
        type: "wait",
        id: `legacy-wait-${email.id}`,
        delayMs,
        label: delayLabel(delayMs),
      });
    }
    nodes.push({
      type: "email",
      id: `legacy-email-${email.id}`,
      emailId: email.id,
      email,
    });
  }
  return nodes;
}

export function buildAutomationTree(input: {
  triggerLabel?: string | null;
  triggerKind?: string | null;
  emails: AutomationEmail[];
  steps?: FlowStepRecord[] | null;
}): {
  trigger: { kind: TriggerKind; label: string };
  nodes: FlowTreeNode[];
} {
  const kind = coerceTriggerKind(input.triggerKind);
  const trigger = {
    kind,
    label: (input.triggerLabel || "").trim() || defaultTriggerLabel(kind),
  };
  const steps = input.steps || [];
  const nodes =
    steps.length > 0
      ? buildFlowBranch(steps, emailsByIdMap(input.emails), null, "")
      : fallbackFlowFromEmails(input.emails);
  return { trigger, nodes };
}

/** @deprecated Use buildAutomationTree. Kept for older linear maps. */
export function buildAutomationNodes(input: {
  triggerLabel?: string | null;
  triggerKind?: string | null;
  emails: AutomationEmail[];
  steps?: FlowStepRecord[] | null;
}): Array<
  | { type: "trigger"; kind: TriggerKind; label: string }
  | FlowTreeNode
> {
  const tree = buildAutomationTree(input);
  return [{ type: "trigger", kind: tree.trigger.kind, label: tree.trigger.label }, ...tree.nodes];
}
