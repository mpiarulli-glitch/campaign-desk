import { getAttachment } from "@/lib/campaigns";

type Params = { params: Promise<{ id: string }> };

// Serves a comment image by its opaque id. No auth: the id is a random 16-char
// token (same unguessable-link model as campaign magic tokens), and the image
// must be viewable from both the token-based review page and the admin view.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const att = getAttachment(id);
  if (!att) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = Buffer.from(att.data, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
