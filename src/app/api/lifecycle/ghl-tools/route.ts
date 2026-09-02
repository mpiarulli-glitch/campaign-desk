import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured, listLocations } from "@/lib/ghl";
import { listRevClients, updateRevClient } from "@/lib/revenue";
import {
  accountReport,
  applyTagPlan,
  auditTags,
  hotContacts,
  planLinks,
  tagContacts,
  type TagAction,
} from "@/lib/ghl-tools";

// The lifecycle Tools panel. Admin-only for every action, read or write: these
// reports span every subaccount on the agency, and the writes rename and delete
// tags that campaigns may be filtering on.
//
// Reads are GET so they can be cached and re-run cheaply. Writes are POST and
// only ever act on a list of actions the caller ticked, never on the audit's
// own suggestions.

function mappedLocationIds(): Set<string> {
  return new Set(
    listRevClients()
      .map((c) => (c.ghl_location_id || "").trim())
      .filter(Boolean)
  );
}

export async function GET(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const tool = url.searchParams.get("tool") || "";
  const force = url.searchParams.get("force") === "1";

  try {
    // Just enough to fill the account picker, so the panel does not need the
    // full report run before "who to call" is usable.
    if (tool === "locations") {
      const mapped = mappedLocationIds();
      const all = await listLocations();
      return NextResponse.json({
        locations: all
          .map((l) => ({ id: l.id, name: l.name, mapped: mapped.has(l.id) }))
          .sort((a, b) => Number(b.mapped) - Number(a.mapped) || a.name.localeCompare(b.name)),
      });
    }
    // Which clients have no GoHighLevel location id, and which location looks
    // like theirs. Read-only: applying is a separate POST.
    if (tool === "links") {
      const clients = listRevClients().map((c) => ({
        id: c.id,
        name: c.name,
        ghl_location_id: c.ghl_location_id || "",
      }));
      const locs = (await listLocations()).map((l) => ({ id: l.id, name: l.name }));
      return NextResponse.json(planLinks(clients, locs));
    }
    if (tool === "accounts") {
      return NextResponse.json(await accountReport(mappedLocationIds(), force));
    }
    if (tool === "tags") {
      return NextResponse.json(await auditTags(force));
    }
    if (tool === "hot") {
      const locationId = url.searchParams.get("locationId") || "";
      if (!locationId) {
        return NextResponse.json({ error: "locationId is required" }, { status: 400 });
      }
      // The client-record lookup only resolves accounts that are mapped, which
      // is precisely the set that is not the problem. So fall through to the
      // GoHighLevel location list before showing a raw id.
      let name =
        url.searchParams.get("locationName") ||
        listRevClients().find((c) => c.ghl_location_id === locationId)?.name ||
        "";
      if (!name) {
        name =
          (await listLocations()).find((l) => l.id === locationId)?.name || locationId;
      }
      return NextResponse.json(await hotContacts(locationId, name));
    }
    return NextResponse.json(
      { error: "tool must be locations, links, accounts, tags or hot" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That report failed." },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));

  try {
    // Apply an approved tag plan. Renames and deletes only, and only the exact
    // actions handed in.
    if (body.action === "apply-tag-plan") {
      const actions = Array.isArray(body.actions) ? (body.actions as TagAction[]) : [];
      if (actions.length === 0) {
        return NextResponse.json({ error: "Nothing to apply" }, { status: 400 });
      }
      if (actions.length > 200) {
        return NextResponse.json(
          { error: `That is ${actions.length} changes. Do it in batches of 200 or fewer.` },
          { status: 400 }
        );
      }
      return NextResponse.json(await applyTagPlan(actions));
    }

    // Write one tag onto the scored contacts, so a smart list can be built on
    // it once in the GoHighLevel UI. GoHighLevel has no API for creating the
    // smart list itself.
    if (body.action === "tag-hot") {
      const locationId = typeof body.locationId === "string" ? body.locationId : "";
      const tag = typeof body.tag === "string" ? body.tag.trim() : "";
      const ids = Array.isArray(body.contactIds) ? body.contactIds.map(String) : [];
      if (!locationId || !tag || ids.length === 0) {
        return NextResponse.json(
          { error: "locationId, tag and contactIds are all required" },
          { status: 400 }
        );
      }
      if (ids.length > 200) {
        return NextResponse.json(
          { error: `That is ${ids.length} contacts. Cap is 200 per run.` },
          { status: 400 }
        );
      }
      return NextResponse.json(await tagContacts(locationId, ids, tag));
    }

    // Write the approved client-to-location links. Guarded so an approved pair
    // can never overwrite a client that already points somewhere, and so two
    // clients cannot be pointed at the same subaccount: either would silently
    // show one business another's numbers.
    if (body.action === "apply-links") {
      const pairs = Array.isArray(body.links)
        ? (body.links as Array<{ clientId?: unknown; locationId?: unknown }>)
        : [];
      if (pairs.length === 0) {
        return NextResponse.json({ error: "Nothing to link" }, { status: 400 });
      }

      const clients = listRevClients();
      const taken = new Map(
        clients
          .filter((c) => (c.ghl_location_id || "").trim())
          .map((c) => [c.ghl_location_id.trim(), c.name])
      );

      let linked = 0;
      const skipped: string[] = [];
      for (const pair of pairs) {
        const clientId = typeof pair.clientId === "string" ? pair.clientId : "";
        const locationId = typeof pair.locationId === "string" ? pair.locationId.trim() : "";
        const client = clients.find((c) => c.id === clientId);
        if (!client || !locationId) {
          skipped.push("A link was missing its client or location");
          continue;
        }
        if ((client.ghl_location_id || "").trim()) {
          skipped.push(`${client.name} already points at a subaccount`);
          continue;
        }
        const owner = taken.get(locationId);
        if (owner) {
          skipped.push(`That subaccount is already ${owner}'s`);
          continue;
        }
        updateRevClient(client.id, { ghlLocationId: locationId });
        taken.set(locationId, client.name);
        linked++;
      }
      return NextResponse.json({ linked, skipped });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That did not work." },
      { status: 502 }
    );
  }
}
