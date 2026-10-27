import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  fetchPublicBuffer,
  fetchStoredLogo,
  isBlockedIp,
  logoAttempts,
  publicWebsiteUrl,
  pullMissingClientLogos,
  validateLogoUrl,
  type LogoTransport,
} from "../src/lib/client-logo-fetch";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const PAGE = `<!doctype html><html><head>
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
<link rel="apple-touch-icon" href="/apple-120.png" sizes="120x120">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="http://127.0.0.1/secret.png">
<meta property="og:image" content="https://cdn.example.com/og.jpg">
</head></html>`;

test("private and loopback addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.9",
    "172.16.5.5",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("172.32.0.1"), false);
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
});

test("logo urls are http(s) and public", () => {
  assert.equal(validateLogoUrl("https://example.com/a.png").ok, true);
  assert.equal(validateLogoUrl("http://example.com").ok, true);
  assert.equal(publicWebsiteUrl("example.com")?.href, "https://example.com/");
  for (const raw of [
    "file:///etc/passwd",
    "ftp://example.com/a.png",
    "https://user:pass@example.com/a.png",
    "https://127.0.0.1/secret",
    "https://localhost/secret",
    "https://example.com:8080/a.png",
    "http://169.254.169.254/",
    "https://metadata.google.internal/",
    "javascript:alert(1)",
  ]) {
    assert.equal(validateLogoUrl(raw).ok, false, raw);
  }
  assert.equal(publicWebsiteUrl(""), null);
  assert.equal(publicWebsiteUrl("http://10.0.0.5"), null);
});

test("fetch order prefers the apple icon and skips private urls", () => {
  const attempts = logoAttempts("https://example.com", PAGE);
  assert.deepEqual(
    attempts.map((item) => `${item.source} ${item.url}`),
    [
      "apple-touch-icon https://example.com/apple-180.png",
      "apple-touch-icon https://example.com/apple-120.png",
      "favicon https://example.com/favicon-32.png",
      "og:image https://cdn.example.com/og.jpg",
      "site-icon https://example.com/apple-touch-icon.png",
      "site-icon https://example.com/apple-touch-icon-precomposed.png",
      "site-icon https://example.com/favicon.png",
      "site-icon https://example.com/favicon.svg",
      "favicon-service https://www.google.com/s2/favicons?domain=example.com&sz=128",
    ]
  );
  assert.equal(attempts.some((item) => item.url.includes("127.0.0.1")), false);
  assert.equal(attempts.some((item) => item.url.endsWith(".ico")), false);
});

test("fetch uses the first real image and never requests a private host", async () => {
  const calls: string[] = [];
  const transport: LogoTransport = async (url) => {
    calls.push(url);
    if (url.includes("127.0.0.1") || url.includes("10.") || url.includes("localhost")) {
      throw new Error(`SSRF ${url}`);
    }
    if (url.endsWith("/apple-180.png")) {
      return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
    }
    if (url === "https://example.com/") {
      return { ok: true, status: 200, contentType: "text/html", body: Buffer.from(PAGE), url };
    }
    return { ok: false, error: "miss" };
  };
  const result = await fetchStoredLogo("example.com", transport);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "apple-touch-icon");
  assert.equal(result.mime, "image/png");
  assert.deepEqual(calls, ["https://example.com/", "https://example.com/apple-180.png"]);
});

test("a loopback url is refused before any connection", async () => {
  const result = await fetchPublicBuffer("http://127.0.0.1:9/logo.png");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not allowed/i);
});

test("a direct image url is stored without scraping", async () => {
  const transport: LogoTransport = async (url) => ({
    ok: true,
    status: 200,
    contentType: "image/png",
    body: PNG,
    url,
  });
  const result = await fetchStoredLogo("https://cdn.example.com/logo.png", transport);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.source, "website-image");
});

describe("pull missing client logos", { concurrency: 1 }, () => {
  test("skips clients with no website or an existing file, and can run again", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-pull-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    const { createRevClient, updateRevClient } = await import("../src/lib/revenue");
    const { readClientLogo } = await import("../src/lib/client-logos");

    t.after(() => {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const harbor = createRevClient({ name: "Harbor & Co", businessModel: "home_service" });
    const quiet = createRevClient({ name: "Quiet Client", businessModel: "b2b" });
    updateRevClient(harbor.id, { website: "https://harbor.example" });

    const calls: string[] = [];
    const transport: LogoTransport = async (url) => {
      calls.push(url);
      if (url === "https://harbor.example/") {
        return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
      }
      return { ok: false, error: "miss" };
    };

    const dry = await pullMissingClientLogos({ dryRun: true, transport });
    assert.equal(dry.planned.length, 1);
    assert.equal(dry.planned[0].name, "Harbor & Co");
    assert.equal(calls.length, 0);
    assert.ok(dry.skipped.some((row) => row.name === "Quiet Client"));

    const first = await pullMissingClientLogos({ transport });
    assert.equal(first.fetched.length, 1);
    assert.equal(first.fetched[0].source, "website-image");
    assert.equal(first.failed.length, 0);
    const stored = readClientLogo(harbor.id, `${harbor.id}.png`);
    assert.ok(stored);
    assert.equal(stored!.buffer.equals(PNG), true);

    const again = await pullMissingClientLogos({ transport });
    assert.equal(again.fetched.length, 0);
    assert.ok(again.skipped.some((row) => row.reason === "Already has a stored logo."));
    const callsAfterFirst = calls.length;
    await pullMissingClientLogos({ force: true, clientId: harbor.id, transport });
    assert.ok(calls.length > callsAfterFirst);
  });
});
