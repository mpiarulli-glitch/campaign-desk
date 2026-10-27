import { getRevClient } from "@/lib/revenue";
import { logoResponseHeaders, readClientLogo } from "@/lib/client-logos";

type Params = { params: Promise<{ id: string }> };

// Serves a stored client logo (uploaded or fetched). Public so img tags work
// without auth; the client id is an opaque token and the file only exists
// after a logo was saved for that client. SVG is served as an image.
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
    headers: logoResponseHeaders(file.mime, file.buffer.length),
  });
}
