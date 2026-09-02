import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { removeClientLogoFiles, saveClientLogo } from "@/lib/client-logos";
import { getRevClient, updateRevClient } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await can("tool.client_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a logo file to upload." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = saveClientLogo(id, buffer, file.type || "application/octet-stream");
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  const client = updateRevClient(id, { logoPath: saved.filename });
  return NextResponse.json({
    client,
    logo_url: client ? `/api/clients/${id}/logo?v=${encodeURIComponent(client.updated_at)}` : null,
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await can("tool.client_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  removeClientLogoFiles(id);
  const client = updateRevClient(id, { logoPath: "" });
  return NextResponse.json({ client });
}
