import { NextResponse } from "next/server";
import {
  deleteForecastRun,
  forecastSyncAuthorized,
  upsertForecastRun,
} from "@/lib/forecast-sync";

type Params = { params: Promise<{ runId: string }> };

function denied() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function fromResult(result: {
  ok: boolean;
  status: number;
  error?: string;
  message?: string;
  body?: { runId: string; status: string; idempotent: boolean };
}) {
  if (result.ok && result.body) return NextResponse.json(result.body, { status: result.status });
  const payload: { error: string; message?: string } = { error: result.error || "unavailable" };
  if (result.message) payload.message = result.message;
  return NextResponse.json(payload, { status: result.status });
}

export async function PUT(request: Request, { params }: Params) {
  if (!forecastSyncAuthorized(request.headers.get("authorization"))) return denied();
  const { runId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_payload", message: "Body must be JSON" },
      { status: 422 }
    );
  }
  try {
    return fromResult(upsertForecastRun(runId, body));
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!forecastSyncAuthorized(request.headers.get("authorization"))) return denied();
  const { runId } = await params;
  try {
    return fromResult(deleteForecastRun(runId));
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
