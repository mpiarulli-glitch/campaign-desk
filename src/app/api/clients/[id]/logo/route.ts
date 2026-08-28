import { getRevClient } from "@/lib/revenue";
import { readClientLogo } from "@/lib/client-logos";

type Params = { params: Promise<{ id: string }> };

// Serves an uploaded client logo. Public so img tags work without auth; the
// client id is an opaque token and the file only exists when someone uploaded it.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const client = getRevClient(id);
  if (!client?.logo_path) {
    return new Response("Not found", { status: 404 });
  }
  const file = readClientLogo(id, client.logo_path);
  if (!file) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.buffer.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
