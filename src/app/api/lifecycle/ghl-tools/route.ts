import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured, listLocations } from "@/lib/ghl";
import { listRevClients } from "@/lib/revenue";
import {
  accountReport,
  applyTagPlan,
  auditTags,
  hotContacts,
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
  if (!(await isAdminAuthenticated())) {
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
      const name =
        url.searchParams.get("locationName") ||
        listRevClients().find((c) => c.ghl_location_id === locationId)?.name ||
        locationId;
      return NextResponse.json(await hotContacts(locationId, name));
    }
    return NextResponse.json(
      { error: "tool must be locations, accounts, tags or hot" },
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
  if (!(await isAdminAuthenticated())) {
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That did not work." },
      { status: 502 }
    );
  }
}
