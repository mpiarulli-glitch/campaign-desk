import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  INTEGRATION_PROVIDERS,
  disconnectClientIntegration,
  getClientIntegration,
  listClientIntegrations,
  providerLabel,
  type IntegrationProvider,
  upsertClientIntegration,
} from "@/lib/client-integrations";
import { getRevClient } from "@/lib/revenue";
import { HousecallError, linkHousecallClient } from "@/lib/housecall";
import { HubSpotError, linkHubSpotClient } from "@/lib/hubspot";

function isProvider(value: unknown): value is IntegrationProvider {
  return (
    typeof value === "string" &&
    INTEGRATION_PROVIDERS.some((p) => p.id === value)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const linked = listClientIntegrations(clientId);
  const byProvider = new Map(linked.map((row) => [row.provider, row]));

  return NextResponse.json({
    clientId,
    clientName: client.name,
    providers: INTEGRATION_PROVIDERS.map((meta) => {
      const row = byProvider.get(meta.id) || null;
      return {
        ...meta,
        integration: row,
      };
    }),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    provider?: unknown;
    credential?: unknown;
  };

  if (!isProvider(body.provider)) {
    return NextResponse.json({ error: "Unknown integration provider." }, { status: 400 });
  }
  const credential =
    typeof body.credential === "string" ? body.credential.trim() : "";
  if (!credential) {
    return NextResponse.json({ error: "Paste an API credential first." }, { status: 400 });
  }

  try {
    if (body.provider === "housecall") {
      const company = await linkHousecallClient(clientId, credential);
      return NextResponse.json({
        ok: true,
        provider: body.provider,
        label: company.name,
        integration: getClientIntegration(clientId, "housecall"),
      });
    }

    const account = await linkHubSpotClient(clientId, credential);
    return NextResponse.json({
      ok: true,
      provider: body.provider,
      label: account.name,
      integration: getClientIntegration(clientId, "hubspot"),
    });
  } catch (err) {
    const message =
      err instanceof HousecallError || err instanceof HubSpotError
        ? err.message
        : err instanceof Error
          ? err.message
          : `Could not link ${providerLabel(body.provider)}.`;

    upsertClientIntegration({
      clientId,
      provider: body.provider,
      status: "error",
      lastError: message,
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "Unknown integration provider." }, { status: 400 });
  }

  disconnectClientIntegration(clientId, provider);
  return NextResponse.json({ ok: true, provider });
}
