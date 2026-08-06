// A direct, standalone connection to GHL's Opportunities API — deliberately
// separate from lib/ghl.ts's agency-OAuth client (which only reads workflows
// today). Auth is a single Private Integration Token scoped to one location
// (Marketing Empire Group's own GHL account, where new-client opportunities
// live), not the OAuth/location-token dance the Automations tab uses.
const API_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

function token(): string {
  return process.env.GHL_OPPORTUNITIES_TOKEN || "";
}

export function isGhlOpportunitiesConfigured(): boolean {
  return Boolean(
    process.env.GHL_OPPORTUNITIES_TOKEN &&
      process.env.GHL_OPPORTUNITIES_LOCATION_ID &&
      process.env.GHL_OPPORTUNITIES_PIPELINE_ID
  );
}

export class GhlOpportunitiesError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function ghlFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const t = token();
  if (!t) throw new GhlOpportunitiesError("GHL_OPPORTUNITIES_TOKEN is not set", 0);
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${t}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GhlOpportunitiesError(
      `GHL ${path} ${res.status}: ${body.slice(0, 300)}`,
      res.status
    );
  }
  return res.json() as Promise<T>;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface PipelinesResponse {
  pipelines: Pipeline[];
}

export async function getConfiguredPipeline(): Promise<Pipeline | null> {
  const locationId = process.env.GHL_OPPORTUNITIES_LOCATION_ID || "";
  const pipelineId = process.env.GHL_OPPORTUNITIES_PIPELINE_ID || "";
  const { pipelines } = await ghlFetch<PipelinesResponse>("/opportunities/pipelines", {
    locationId,
  });
  return pipelines.find((p) => p.id === pipelineId) || null;
}

export interface GhlOpportunity {
  id: string;
  name: string;
  monetaryValue: number;
  pipelineStageId: string;
  status: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactId: string;
}

interface RawOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineStageId: string;
  status: string;
  contactId: string;
  contact?: { name?: string; email?: string; phone?: string };
}

interface OpportunitiesSearchResponse {
  opportunities: RawOpportunity[];
  meta: { total: number; nextPageUrl?: string; startAfter?: number; startAfterId?: string };
}

// Every open opportunity in the configured pipeline. GHL paginates at up to
// 100; this pipeline runs single digits to low dozens, so one extra page
// covers any realistic growth without building full cursor pagination yet.
export async function listPipelineOpportunities(): Promise<GhlOpportunity[]> {
  const locationId = process.env.GHL_OPPORTUNITIES_LOCATION_ID || "";
  const pipelineId = process.env.GHL_OPPORTUNITIES_PIPELINE_ID || "";
  const out: GhlOpportunity[] = [];
  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  for (let page = 0; page < 5; page++) {
    const { opportunities, meta } = await ghlFetch<OpportunitiesSearchResponse>(
      "/opportunities/search",
      {
        location_id: locationId,
        pipeline_id: pipelineId,
        limit: "100",
        ...(startAfter ? { startAfter } : {}),
        ...(startAfterId ? { startAfterId } : {}),
      }
    );
    for (const o of opportunities) {
      out.push({
        id: o.id,
        name: o.name,
        monetaryValue: o.monetaryValue || 0,
        pipelineStageId: o.pipelineStageId,
        status: o.status,
        contactName: o.contact?.name || "",
        contactEmail: o.contact?.email || "",
        contactPhone: o.contact?.phone || "",
        contactId: o.contactId,
      });
    }
    if (!meta.nextPageUrl || !opportunities.length) break;
    startAfter = String(meta.startAfter || "");
    startAfterId = meta.startAfterId;
  }
  return out;
}

export async function getOpportunity(id: string): Promise<GhlOpportunity> {
  const { opportunity } = await ghlFetch<{ opportunity: RawOpportunity }>(
    `/opportunities/${id}`
  );
  return {
    id: opportunity.id,
    name: opportunity.name,
    monetaryValue: opportunity.monetaryValue || 0,
    pipelineStageId: opportunity.pipelineStageId,
    status: opportunity.status,
    contactName: opportunity.contact?.name || "",
    contactEmail: opportunity.contact?.email || "",
    contactPhone: opportunity.contact?.phone || "",
    contactId: opportunity.contactId,
  };
}
