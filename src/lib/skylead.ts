/**
 * Skylead (Multilead) Open API client.
 *
 * Docs: https://documenter.getpostman.com/view/7428744/UV5ZAGMg
 * Auth is a raw API key in the Authorization header (no "Bearer" prefix).
 * Keys are managed at https://app.multilead.co/settings/api
 *
 * Everything the Lifecycle dashboard needs comes from two cheap endpoints:
 *   GET /accounts                                   -> every LinkedIn seat
 *   GET /users/:userId/accounts/:accountId/campaigns -> campaigns + campaignStats
 *
 * The API is rate limited (429 + Retry-After), so responses are cached in
 * memory and a full sweep is fanned out with a small concurrency cap.
 */

// Everything the dashboard reads lives on v1. The v2 base is only needed for
// mutations (activate/deactivate a campaign), which we don't do from here yet.
const V1 = process.env.SKYLEAD_API_URL || "https://api.multilead.io/api/open-api/v1";

// How long a sweep stays warm before we hit Skylead again.
const CACHE_TTL_MS = 5 * 60 * 1000;
// Skylead rate limits, so we never blast every seat at once.
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20_000;

export function isSkyleadConfigured(): boolean {
  return Boolean(process.env.SKYLEAD_API_KEY);
}

/* --------------------------------------------------------------- shapes */

/**
 * Seat status enums, from GET /enums/connection-statuses and
 * /enums/account-global-statuses. A seat only actually sends when its
 * connection is ACTIVE *and* its global status is AUTH_OK, so both are
 * checked. Everything else is a specific, fixable failure.
 */
export const CONNECTION_STATUS = {
  0: "Unknown",
  1: "Active",
  2: "Pending",
  3: "Processing",
  4: "Inactive",
  5: "Errored",
} as const;

export const ACCOUNT_GLOBAL_STATUS: Record<number, string> = {
  0: "Unknown",
  1: "Created, not signed in",
  2: "Wrong LinkedIn password",
  3: "PIN requested",
  4: "Captcha requested",
  5: "Signed in",
  6: "Offline",
  7: "Payment required",
  8: "Cancelled",
  9: "Restricted by LinkedIn",
  10: "Two-factor auth needed",
  11: "Invalid subscription",
  12: "Verifying PIN",
  13: "Wrong PIN",
  14: "Scheduled execution",
  15: "Initialising connection",
  16: "Checking connectivity",
  17: "Logging in to LinkedIn",
  18: "Wrong two-factor code",
  19: "Verifying two-factor code",
  20: "Two-factor queued",
  21: "Two-factor error",
  22: "Login failed",
  23: "Identity verification needed",
  24: "Set up two-factor auth",
  25: "Phone number needed",
};

const CONNECTION_ACTIVE = 1;
const GLOBAL_AUTH_OK = 5;

/**
 * Seats whose Skylead subscription is gone: cancelled outright, unpaid, or
 * lapsed into an invalid subscription. These are not work anybody can do from
 * this console, so they are dropped from the sweep entirely rather than shown
 * as faults to fix. Everything else that cannot send (PIN, 2FA, jail, wrong
 * password, connection errors) is a fixable fault and stays visible.
 */
const DEAD_SUBSCRIPTION_STATUS = new Set([
  7, // Payment required
  8, // Cancelled
  11, // Invalid subscription
]);

/** True when a seat is billing-dead rather than merely broken. */
export function isSubscriptionDead(seat: { accountGlobalStatusId: number }): boolean {
  return DEAD_SUBSCRIPTION_STATUS.has(seat.accountGlobalStatusId);
}

/** A LinkedIn seat. Skylead calls these "accounts". */
export interface SkyleadSeat {
  id: number;
  fullName: string;
  email: string;
  /** 1 = ACTIVE. See CONNECTION_STATUS. */
  connectionStatusId: number;
  /** 5 = AUTH_OK. See ACCOUNT_GLOBAL_STATUS. */
  accountGlobalStatusId: number;
  isInJail: boolean;
  /** True only when the seat can actually send right now. */
  healthy: boolean;
  /** Why it isn't sending, in plain English. Empty when healthy. */
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decide whether a seat is genuinely able to send, and if not, say why.
 * LinkedIn jail wins over auth problems because it's the more urgent one.
 */
export function seatHealth(seat: {
  connectionStatusId: number;
  accountGlobalStatusId: number;
  isInJail: boolean;
}): { healthy: boolean; statusLabel: string } {
  if (seat.isInJail) {
    return { healthy: false, statusLabel: "In LinkedIn jail" };
  }
  if (seat.accountGlobalStatusId !== GLOBAL_AUTH_OK) {
    return {
      healthy: false,
      statusLabel:
        ACCOUNT_GLOBAL_STATUS[seat.accountGlobalStatusId] ??
        `Status ${seat.accountGlobalStatusId}`,
    };
  }
  if (seat.connectionStatusId !== CONNECTION_ACTIVE) {
    const label =
      CONNECTION_STATUS[seat.connectionStatusId as keyof typeof CONNECTION_STATUS] ??
      `Status ${seat.connectionStatusId}`;
    return { healthy: false, statusLabel: `Connection ${label.toLowerCase()}` };
  }
  return { healthy: true, statusLabel: "" };
}

export interface SkyleadCampaignStats {
  campaignId: number;
  profileViewsMade: number;
  inmailsSent: number;
  emailsSent: number;
  connectionsRequested: number;
  messagesSent: number;
  connectionRequestsAccepted: number;
  connectionReplies: number;
  /** Skylead returns these as strings. Normalised to numbers below. */
  responseRate: number;
  acceptanceRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  totalLeads: number;
  remainingLeads: number;
  isActive: boolean;
}

export interface SkyleadCampaign {
  id: number;
  name: string;
  linkedinAccountId: number;
  /** 1 = running. Mirrors campaignStats.isActive in practice. */
  stateId: number;
  statusId: number;
  createdAt: string;
  updatedAt: string;
  /** Epoch ms of the last time Skylead processed the campaign. 0 = never. */
  lastProcessingTimestamp: number;
  stats: SkyleadCampaignStats;
}

export class SkyleadError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SkyleadError";
  }
}

/* ------------------------------------------------------------- fetching */

function num(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function call<T>(url: string, attempt = 0): Promise<T> {
  const key = process.env.SKYLEAD_API_KEY;
  if (!key) throw new SkyleadError("SKYLEAD_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: key, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "network error";
    throw new SkyleadError(`Skylead request ${reason}`);
  }
  clearTimeout(timer);

  // Back off once on a rate limit, honouring Retry-After when it is sane.
  if (res.status === 429 && attempt < 1) {
    const retryAfter = num(res.headers.get("Retry-After"));
    const waitMs = Math.min(Math.max(retryAfter, 1), 10) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    return call<T>(url, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    throw new SkyleadError("Skylead rejected the API key", res.status);
  }
  if (!res.ok) {
    throw new SkyleadError(`Skylead returned ${res.status}`, res.status);
  }

  return (await res.json()) as T;
}

/* ------------------------------------------------------------ endpoints */

interface MeResponse {
  id: number;
  email: string;
  fullName: string;
}

export async function getMe(): Promise<MeResponse> {
  return call<MeResponse>(`${V1}/user/me`);
}

/**
 * Every seat on the account. Skylead paginates, so this walks until the page
 * comes back short.
 */
export async function listSeats(): Promise<SkyleadSeat[]> {
  const limit = 50;
  const out: SkyleadSeat[] = [];

  for (let offset = 0; offset < 500; offset += limit) {
    const res = await call<{ result?: { items?: unknown[] } }>(
      `${V1}/accounts?offset=${offset}&limit=${limit}`
    );
    const items = res.result?.items ?? [];
    for (const raw of items) {
      const s = raw as Record<string, unknown>;
      const base = {
        connectionStatusId: num(s.connectionStatusId),
        accountGlobalStatusId: num(s.accountGlobalStatusId),
        isInJail: Boolean(s.isInJail),
      };
      out.push({
        id: Number(s.id),
        fullName: String(s.fullName || "").trim() || String(s.email || "Unnamed seat"),
        email: String(s.email || ""),
        ...base,
        ...seatHealth(base),
        createdAt: String(s.createdAt || ""),
        updatedAt: String(s.updatedAt || ""),
      });
    }
    if (items.length < limit) break;
  }

  return out;
}

/** Campaigns for one seat, with their rolled-up stats. */
export async function listCampaigns(userId: number, seatId: number): Promise<SkyleadCampaign[]> {
  const res = await call<{ result?: { campaigns?: unknown[] } }>(
    `${V1}/users/${userId}/accounts/${seatId}/campaigns`
  );

  return (res.result?.campaigns ?? []).map((raw) => {
    const c = raw as Record<string, unknown>;
    const st = (c.campaignStats || {}) as Record<string, unknown>;
    return {
      id: Number(c.id),
      name: String(c.name || "Untitled campaign"),
      linkedinAccountId: num(c.linkedinAccountId),
      stateId: num(c.stateId),
      statusId: num(c.statusId),
      createdAt: String(c.createdAt || ""),
      updatedAt: String(c.updatedAt || ""),
      lastProcessingTimestamp: num(c.lastProcessingTimestamp),
      stats: {
        campaignId: Number(c.id),
        profileViewsMade: num(st.profileViewsMade),
        inmailsSent: num(st.inmailsSent),
        emailsSent: num(st.emailsSent),
        connectionsRequested: num(st.connectionsRequested),
        messagesSent: num(st.messagesSent),
        connectionRequestsAccepted: num(st.connectionRequestsAccepted),
        connectionReplies: num(st.connectionReplies),
        responseRate: num(st.responseRate),
        acceptanceRate: num(st.acceptanceRate),
        openRate: num(st.openRate),
        clickRate: num(st.clickRate),
        bounceRate: num(st.bounceRate),
        totalLeads: num(st.totalLeads),
        remainingLeads: num(st.remainingLeads),
        isActive: Boolean(st.isActive),
      },
    };
  });
}

/* ------------------------------------------------------------- sequence */

/**
 * `statistics/steps` returns each step keyed by step id, with metrics keyed by
 * a numeric index and no documentation of what the indices mean.
 *
 * These were derived by summing each index across every step of a campaign and
 * comparing to that campaign's own `campaignStats`. Verified against all 7
 * active campaigns on the account: requests, accepted, messages sent and
 * replies matched exactly, to the unit, in every case.
 */
const STEP_METRIC = {
  views: "1",
  requestsSent: "3",
  messagesSent: "4",
  accepted: "6",
  replies: "7",
  acceptanceRate: "8",
  responseRate: "9",
} as const;

export interface SkyleadStep {
  id: number;
  /** Position in the sequence as Skylead numbers it. */
  step: number;
  /** view, connect, condition, message, email, inmail… */
  action: string;
  /** Wait before this step runs, in ms. 0 for the first. */
  delayMs: number;
  /** The message body, with {{merge}} tags intact. Empty for non-message steps. */
  copy: string;
  subject: string;
  views: number;
  requestsSent: number;
  messagesSent: number;
  accepted: number;
  replies: number;
  acceptanceRate: number;
  responseRate: number;
}

export interface SkyleadSequence {
  campaignId: number;
  name: string;
  steps: SkyleadStep[];
}

/**
 * Flatten Skylead's step tree.
 *
 * `campaignSteps` nests each step under the previous one via `nextSteps`, and
 * the same step appears more than once when branches reconverge, so dedupe by
 * id rather than trusting the shape.
 */
function flattenSteps(nodes: unknown[], seen = new Map<number, Record<string, unknown>>()) {
  for (const raw of nodes) {
    const n = raw as Record<string, unknown>;
    const id = num(n.id);
    if (id && !seen.has(id)) seen.set(id, n);
    const next = n.nextSteps;
    if (Array.isArray(next)) flattenSteps(next, seen);
  }
  return seen;
}

/**
 * One campaign's sequence: every step, its copy, and how that specific step
 * performed. This is what turns "the campaign is underperforming" into "the
 * connect request is the problem".
 */
export async function getSequence(
  userId: number,
  seatId: number,
  campaignId: number
): Promise<SkyleadSequence> {
  const [detail, stats] = await Promise.all([
    call<{ result?: Record<string, unknown> }>(
      `${V1}/users/${userId}/accounts/${seatId}/campaigns/${campaignId}/details`
    ),
    call<{ result?: Record<string, Record<string, number>> }>(
      `${V1}/users/${userId}/accounts/${seatId}/statistics/steps?campaignId=${campaignId}`
    ).catch(() => ({ result: {} as Record<string, Record<string, number>> })),
  ]);

  const result = detail.result ?? {};
  const byId = flattenSteps((result.campaignSteps as unknown[]) ?? []);
  const perStep = stats.result ?? {};

  const steps: SkyleadStep[] = [...byId.entries()].map(([id, n]) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const m = perStep[String(id)] ?? {};
    const pick = (key: keyof typeof STEP_METRIC) => num(m[STEP_METRIC[key]]);
    return {
      id,
      step: num(n.step),
      action: String(n.action ?? "unknown"),
      delayMs: num(n.doAfterPreviousStep),
      copy: String(data.message ?? ""),
      subject: String(data.subject ?? ""),
      views: pick("views"),
      requestsSent: pick("requestsSent"),
      messagesSent: pick("messagesSent"),
      accepted: pick("accepted"),
      replies: pick("replies"),
      acceptanceRate: pick("acceptanceRate"),
      responseRate: pick("responseRate"),
    };
  });

  steps.sort((a, b) => a.step - b.step || a.id - b.id);

  return {
    campaignId,
    name: String(result.name ?? "Untitled campaign"),
    steps,
  };
}

/* ---------------------------------------------------------------- sweep */

export interface SkyleadSweep {
  fetchedAt: string;
  userId: number;
  seats: Array<{ seat: SkyleadSeat; campaigns: SkyleadCampaign[]; error?: string }>;
  /** Seats left out because their subscription is dead. See isSubscriptionDead. */
  hiddenSeats: number;
}

let cache: { at: number; data: SkyleadSweep } | null = null;

/** Run `tasks` with a small concurrency cap so we stay under the rate limit. */
async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Pull every seat and its campaigns in one pass.
 *
 * A seat that fails is captured on that seat rather than failing the sweep, so
 * one disconnected LinkedIn account can't blank the whole dashboard.
 */
export async function sweep(force = false): Promise<SkyleadSweep> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const me = await getMe();
  const all = await listSeats();
  // Drop dead-subscription seats before the campaign fan-out, so they cost no
  // API calls on an endpoint that already rate-limits us.
  const seats = all.filter((s) => !isSubscriptionDead(s));

  const rows = await pooled(seats, async (seat) => {
    try {
      return { seat, campaigns: await listCampaigns(me.id, seat.id) };
    } catch (err) {
      return {
        seat,
        campaigns: [] as SkyleadCampaign[],
        error: err instanceof Error ? err.message : "Failed to load campaigns",
      };
    }
  });

  const data: SkyleadSweep = {
    fetchedAt: new Date().toISOString(),
    userId: me.id,
    seats: rows,
    hiddenSeats: all.length - seats.length,
  };
  cache = { at: Date.now(), data };
  return data;
}

export function clearSkyleadCache(): void {
  cache = null;
}
