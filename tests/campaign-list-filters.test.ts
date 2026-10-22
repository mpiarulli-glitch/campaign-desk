import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_LIST_FILTERS_KEY,
  campaignListFiltersToStore,
  emptyCampaignListFilters,
  parseStoredCampaignListFilters,
  readCampaignListFilters,
  resolveListKindFilter,
  writeCampaignListFilters,
  type CampaignListFilterState,
} from "../src/lib/campaign-list-filters";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial != null) data.set(CAMPAIGN_LIST_FILTERS_KEY, initial);
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    dump() {
      return data.get(CAMPAIGN_LIST_FILTERS_KEY) ?? null;
    },
  };
}

test("campaign list filters forget a dropdown set back to All", () => {
  const filters: CampaignListFilterState = {
    status: "draft",
    client: "Acme",
    owner: "unassigned",
    type: "email",
    updated: "30d",
  };
  assert.deepEqual(campaignListFiltersToStore(filters), {
    status: "draft",
    client: "Acme",
    owner: "unassigned",
    type: "email",
    updated: "30d",
  });
  assert.equal(
    campaignListFiltersToStore({ ...filters, status: "all" })?.status,
    undefined
  );
  assert.equal(campaignListFiltersToStore(emptyCampaignListFilters()), null);

  const storage = memoryStorage();
  writeCampaignListFilters(storage, filters);
  assert.deepEqual(readCampaignListFilters(storage), {
    status: "draft",
    client: "Acme",
    owner: "unassigned",
    type: "email",
    updated: "30d",
  });
  writeCampaignListFilters(storage, { ...filters, status: "all", type: "all" });
  assert.equal(readCampaignListFilters(storage).status, undefined);
  assert.equal(readCampaignListFilters(storage).type, undefined);
  assert.equal(readCampaignListFilters(storage).client, "Acme");
  writeCampaignListFilters(storage, emptyCampaignListFilters());
  assert.equal(storage.dump(), null);
  assert.deepEqual(readCampaignListFilters(storage), {});
});

test("stored campaign list filters ignore junk and keep real choices", () => {
  assert.deepEqual(parseStoredCampaignListFilters(null), {});
  assert.deepEqual(parseStoredCampaignListFilters("not-json"), {});
  assert.deepEqual(
    parseStoredCampaignListFilters(
      JSON.stringify({
        status: "in_progress",
        client: "all",
        owner: "  ",
        type: "newsletter",
        updated: "custom",
        extra: true,
      })
    ),
    {}
  );
  assert.deepEqual(
    parseStoredCampaignListFilters(
      JSON.stringify({
        status: "approved_internally",
        client: "Northwind",
        owner: "michael",
        type: "linkedin",
        updated: "month",
      })
    ),
    {
      status: "approved_internally",
      client: "Northwind",
      owner: "michael",
      type: "linkedin",
      updated: "month",
    }
  );
  assert.equal(parseStoredCampaignListFilters(JSON.stringify({ status: "sent" })).status, undefined);
  assert.equal(parseStoredCampaignListFilters(JSON.stringify({ status: "live" })).status, undefined);
});

test("kind query param wins over the saved campaign type", () => {
  assert.equal(resolveListKindFilter("sms", "email"), "sms");
  assert.equal(resolveListKindFilter("all", "email"), "all");
  assert.equal(resolveListKindFilter(null, "blog"), "blog");
  assert.equal(resolveListKindFilter("nope", "cold_email"), "cold_email");
  assert.equal(resolveListKindFilter(null, "newsletter"), "all");
  assert.equal(resolveListKindFilter(null, undefined), "all");
});
