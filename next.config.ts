import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Safe, non-breaking security headers. (A strict Content-Security-Policy is a
// deliberate follow-up — it needs testing against the whiteboard/email-preview
// features before enabling.)
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Every page reachable with only a share token, and no login. A magic link is a
// private URL, so it must not be indexed: a token pasted into a chat window that
// syncs to a crawler, or forwarded into a public thread, is enough for a client
// snapshot or an editorial plan to turn up in search results. `noindex` is sent as
// a header rather than a meta tag because these pages are client components and
// the header also covers the JSON their fetches return.
const MAGIC_LINK_PATHS = [
  "/snapshot/:path*",
  "/plan/:path*",
  "/review/:path*",
  "/dashboard/:path*",
  "/schedule/:path*",
  "/crew/:path*",
  "/invite/:path*",
  "/strategy-meeting/:path*",
  "/api/snapshot/shared/:path*",
  "/api/plan/:path*",
];

const noIndexHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...MAGIC_LINK_PATHS.map((source) => ({ source, headers: noIndexHeaders })),
    ];
  },
};

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true })
  : nextConfig;
