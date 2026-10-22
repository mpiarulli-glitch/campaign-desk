import { isAssetKind, type AssetKind } from "./asset-kinds";
import {
  isListStatusFilter,
  type ListStatusFilter,
} from "./campaign-status";

export const CAMPAIGN_LIST_FILTERS_KEY = "cd-campaigns-filters";

export const CAMPAIGN_LIST_UPDATED_PRESETS = [
  "any",
  "7d",
  "30d",
  "90d",
  "month",
] as const;

export type CampaignListUpdated = (typeof CAMPAIGN_LIST_UPDATED_PRESETS)[number];

export type CampaignListFilterState = {
  status: ListStatusFilter;
  client: string;
  owner: string;
  type: "all" | AssetKind;
  updated: CampaignListUpdated;
};

export type StoredCampaignListFilters = {
  status?: Exclude<ListStatusFilter, "all">;
  client?: string;
  owner?: string;
  type?: AssetKind;
  updated?: Exclude<CampaignListUpdated, "any">;
};

const UPDATED_SAVED = new Set<string>(
  CAMPAIGN_LIST_UPDATED_PRESETS.filter((preset) => preset !== "any")
);

export function isCampaignListUpdated(value: string): value is CampaignListUpdated {
  return (CAMPAIGN_LIST_UPDATED_PRESETS as readonly string[]).includes(value);
}

export function emptyCampaignListFilters(): CampaignListFilterState {
  return {
    status: "all",
    client: "all",
    owner: "all",
    type: "all",
    updated: "any",
  };
}

// Defaults are not stored. Setting a dropdown back to All drops that field,
// and clearing the last one removes the saved blob.
export function campaignListFiltersToStore(
  filters: CampaignListFilterState
): StoredCampaignListFilters | null {
  const stored: StoredCampaignListFilters = {};
  if (filters.status !== "all") stored.status = filters.status;
  if (filters.client !== "all") stored.client = filters.client;
  if (filters.owner !== "all") stored.owner = filters.owner;
  if (filters.type !== "all") stored.type = filters.type;
  if (filters.updated !== "any") stored.updated = filters.updated;
  return Object.keys(stored).length ? stored : null;
}

export function parseStoredCampaignListFilters(
  raw: string | null
): StoredCampaignListFilters {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const record = parsed as Record<string, unknown>;
  const stored: StoredCampaignListFilters = {};
  if (typeof record.status === "string" && isListStatusFilter(record.status)) {
    stored.status = record.status;
  }
  if (
    typeof record.client === "string" &&
    record.client.trim() &&
    record.client !== "all"
  ) {
    stored.client = record.client;
  }
  if (
    typeof record.owner === "string" &&
    record.owner.trim() &&
    record.owner !== "all"
  ) {
    stored.owner = record.owner;
  }
  if (typeof record.type === "string" && isAssetKind(record.type)) {
    stored.type = record.type;
  }
  if (
    typeof record.updated === "string" &&
    UPDATED_SAVED.has(record.updated)
  ) {
    stored.updated = record.updated as Exclude<CampaignListUpdated, "any">;
  }
  return stored;
}

// An explicit ?kind= wins, including kind=all. A missing or unknown kind
// falls through to the saved type.
export function resolveListKindFilter(
  param: string | null,
  saved?: string
): "all" | AssetKind {
  if (param === "all") return "all";
  if (isAssetKind(param)) return param;
  if (isAssetKind(saved)) return saved;
  return "all";
}

export function readCampaignListFilters(
  storage: Pick<Storage, "getItem"> | null
): StoredCampaignListFilters {
  if (!storage) return {};
  try {
    return parseStoredCampaignListFilters(
      storage.getItem(CAMPAIGN_LIST_FILTERS_KEY)
    );
  } catch {
    return {};
  }
}

export function writeCampaignListFilters(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  filters: CampaignListFilterState
): void {
  if (!storage) return;
  const stored = campaignListFiltersToStore(filters);
  try {
    if (!stored) storage.removeItem(CAMPAIGN_LIST_FILTERS_KEY);
    else storage.setItem(CAMPAIGN_LIST_FILTERS_KEY, JSON.stringify(stored));
  } catch {
    // Private browsing can block storage. The URL still records status and type.
  }
}
