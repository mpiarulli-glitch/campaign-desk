import { faviconCacheHost, logoResponseHeaders, readCachedFavicon } from "@/lib/client-logos";

type Params = { params: Promise<{ host: string }> };

// Serves a favicon we already downloaded. It does not fetch. The host is only
// a cache key, and anything that is not a plain hostname is rejected.
export async function GET(_request: Request, { params }: Params) {
  const { host } = await params;
  const safe = faviconCacheHost(decodeURIComponent(host || ""));
  if (!safe) return new Response("Not found", { status: 404 });
  const file = readCachedFavicon(safe);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: logoResponseHeaders(file.mime, file.buffer.length),
  });
}
