/**
 * Client-side mirrors of the Lifecycle API payloads.
 *
 * These are declared here rather than imported from `@/lib/lifecycle-dashboard`
 * so the browser bundle never reaches into a module that pulls in
 * better-sqlite3.
 */

export type RefreshSeverity = "ok" | "watch" | "refresh" | "off" | "blocked";

export interface RefreshReason {
  code: "exhausted" | "stale" | "low_acceptance" | "low_reply" | "decay";
  label: string;
  detail: string;
  severity: "watch" | "refresh";
}

export interface RefreshVerdict {
  severity: RefreshSeverity;
  reasons: RefreshReason[];
  daysSinceActivity: number | null;
  muted: boolean;
}

export interface ApprovalRow {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  status: string;
  externalToken: string;
  updatedAt: string;
  waitingDays: number;
  openComments: number;
}

export interface LinkedInCampaignRow {
  id: number;
  name: string;
  seatId: number;
  seatName: string;
  clientId: string | null;
  clientName: string | null;
  isActive: boolean;
  totalLeads: number;
  remainingLeads: number;
  connectionsRequested: number;
  connectionRequestsAccepted: number;
  messagesSent: number;
  replies: number;
  acceptanceRate: number;
  responseRate: number;
  verdict: RefreshVerdict;
  note: string;
}

export interface SkyleadSeat {
  id: number;
  fullName: string;
  email: string;
  connectionStatusId: number;
  accountGlobalStatusId: number;
  isInJail: boolean;
  healthy: boolean;
  statusLabel: string;
}

export interface LinkedInSection {
  configured: boolean;
  error: string | null;
  fetchedAt: string | null;
  seats: Array<{
    seat: SkyleadSeat;
    connected: boolean;
    error?: string;
    liveCampaigns: number;
    campaigns: LinkedInCampaignRow[];
  }>;
  campaigns: LinkedInCampaignRow[];
  brokenSeats: number;
  needsRefresh: LinkedInCampaignRow[];
  watch: LinkedInCampaignRow[];
}

export interface Automation {
  id: string;
  client_id: string | null;
  name: string;
  platform: string;
  kind: string;
  status: string;
  account_ref: string;
  description: string;
  link: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  client_id: string | null;
  title: string;
  body: string;
  tags: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface SavedLink {
  id: string;
  client_id: string | null;
  title: string;
  url: string;
  category: string;
  note: string;
  created_at: string;
}

export interface Sop {
  id: string;
  title: string;
  category: string;
  body: string;
  link: string;
}

export interface RefreshSettings {
  staleDays: number;
  minAcceptanceRate: number;
  minResponseRate: number;
  minVolume: number;
  decayDropPercent: number;
}

export interface ClientRef {
  id: string;
  name: string;
}

export interface GhlWorkflowRow {
  id: string;
  name: string;
  status: string;
  live: boolean;
  updatedAt: string;
}

export interface GhlAccountRow {
  locationId: string;
  name: string;
  clientId: string | null;
  workflows: GhlWorkflowRow[];
  live: number;
  error?: string;
}

export interface GhlSection {
  configured: boolean;
  error: string | null;
  fetchedAt: string | null;
  accounts: GhlAccountRow[];
  totals: {
    accounts: number;
    accountsWithWorkflows: number;
    accountsWithLive: number;
    workflows: number;
    live: number;
  };
  failures: Array<{ name: string; error: string }>;
}

export interface LifecycleDashboard {
  approvals: ApprovalRow[];
  linkedIn: LinkedInSection;
  automations: Automation[];
  ghl: GhlSection;
  liveAutomationsByPlatform: Array<{ platform: string; live: number; total: number }>;
  sops: Sop[];
  notes: Note[];
  links: SavedLink[];
  clients: ClientRef[];
  refreshSettings: RefreshSettings;
  counts: {
    pendingApprovals: number;
    waitingOnClient: number;
    waitingOnUs: number;
    liveAutomations: number;
    linkedInLive: number;
    campaignsNeedingRefresh: number;
    brokenSeats: number;
    ghlLive: number;
  };
}

export interface AccountReport {
  clientId: string;
  clientName: string;
  generatedAt: string;
  email: {
    months: number;
    campaignsSent: number;
    recipients: number;
    opens: number;
    clicks: number;
    openRate: number;
    clickRate: number;
    revenue: number;
    leads: number;
  };
  approvals: ApprovalRow[];
  automations: Automation[];
  linkedIn: {
    campaigns: LinkedInCampaignRow[];
    live: number;
    needsRefresh: number;
    connectionsRequested: number;
    accepted: number;
    replies: number;
    acceptanceRate: number;
    responseRate: number;
  };
  notes: Note[];
  links: SavedLink[];
}

export const PLATFORM_LABELS: Record<string, string> = {
  ghl: "GoHighLevel",
  klaviyo: "Klaviyo",
  skylead: "Skylead",
  appfront: "AppFront",
  boulevard: "Boulevard",
  other: "Other",
};

/* ------------------------------------------ knowledge base (The Inbox Newsletter) */

export interface KnowledgeListingRow {
  slug: string;
  url: string;
  title: string;
  published: string;
  summary: string;
  topics: string[];
  words: number;
  readMinutes: number;
  read: boolean;
  inspiration: { brand: string; design: string; note: string } | null;
  template: { name: string; image: string } | null;
}

export interface KnowledgeEntryFull extends KnowledgeListingRow {
  body: string;
}

export interface KnowledgeIndexPayload {
  source: { name: string; author: string; agency: string; url: string };
  scrapedAt: string;
  total: number;
  readCount: number;
  topics: Array<{ name: string; count: number }>;
  todaySlug: string | null;
  entries: KnowledgeListingRow[];
}

export interface SwipeRow {
  slug: string;
  published: string;
  issueTitle: string;
  brand: string;
  design: string;
  note: string;
  templateName: string;
  templateImage: string;
}

export const PLATFORM_LABELS: Record<string, string> = {
  ghl: "GoHighLevel",
  klaviyo: "Klaviyo",
  skylead: "Skylead",
  appfront: "AppFront",
  boulevard: "Boulevard",
  other: "Other",
};
