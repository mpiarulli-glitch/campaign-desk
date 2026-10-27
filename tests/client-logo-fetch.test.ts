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
  logoFetchHeaders,
  publicWebsiteUrl,
  pullClientLogosInBatches,
  pullMissingClientLogos,
  refreshClientLogo,
  resetClientLogoResolveForTests,
  scheduleMissingClientLogos,
  validateLogoUrl,
  type LogoTransport,
} from "../src/lib/client-logo-fetch";
import { pickLifecycleLogoDomain } from "../src/lib/client-logo-domain";
import { assessLogoBytes, faviconCacheHost, saveCachedFavicon } from "../src/lib/client-logos";
import { solidPng } from "./solid-png";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG = solidPng(180, 180, [20, 80, 180, 255]);
const WHITE_PNG = solidPng(180, 180, [255, 255, 255, 255]);
const SMALL_PNG = solidPng(64, 64, [200, 40, 40, 255]);
const WIDE_PNG = solidPng(1200, 630, [10, 20, 30, 255]);

const PAGE = `<!doctype html><html><head>
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
<link rel="apple-touch-icon" href="/apple-120.png" sizes="120x120">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="http://127.0.0.1/secret.png">
<link rel="logo" href="/brand-logo.png">
<img alt="logo" src="http://127.0.0.1/logo.png">
<img class="site-logo" src="/header-logo.png">
<meta property="og:image" content="https://cdn.example.com/og.jpg">
</head></html>`;

test("lifecycle domain prefers the website, then the account links", () => {
  assert.equal(
    pickLifecycleLogoDomain({
      website: "https://harbor.example/menu",
      logoAssetsUrl: "https://other.example",
    })?.source,
    "website"
  );
  assert.equal(
    pickLifecycleLogoDomain({
      website: "https://harbor.example/menu",
    })?.host,
    "harbor.example"
  );
  assert.equal(
    pickLifecycleLogoDomain({
      website: "",
      logoAssetsUrl: "https://loodahousepawn.com",
    })?.source,
    "brand-kit"
  );
  assert.equal(
    pickLifecycleLogoDomain({
      logoAssetsUrl: "https://docs.google.com/document/d/abc",
      replyToEmail: "Hello <studio@lumen.example>",
    })?.source,
    "reply-to"
  );
  assert.equal(
    pickLifecycleLogoDomain({
      logoAssetsUrl: "http://127.0.0.1/logo.png",
      offerUrls: ["https://offers.example/spring"],
    })?.source,
    "offer"
  );
  assert.equal(
    pickLifecycleLogoDomain({
      optInUrls: ["https://join.example"],
    })?.host,
    "join.example"
  );
  assert.equal(
    pickLifecycleLogoDomain({ replyToEmail: "owner@gmail.com" }),
    null
  );
  assert.equal(pickLifecycleLogoDomain({ website: "", replyToEmail: "" }), null);
  assert.equal(faviconCacheHost("../etc/passwd"), null);
  assert.equal(faviconCacheHost("harbor.example"), "harbor.example");
});

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
      "logo https://example.com/brand-logo.png",
      "logo https://example.com/header-logo.png",
      "og:image https://cdn.example.com/og.jpg",
      "favicon https://example.com/favicon-32.png",
      "site-icon https://example.com/apple-touch-icon.png",
      "site-icon https://example.com/apple-touch-icon-precomposed.png",
      "site-icon https://example.com/favicon.png",
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

test("tiny and blank images are rejected in favor of a square mark", () => {
  assert.equal(assessLogoBytes(TINY_PNG)?.tiny, true);
  assert.equal(assessLogoBytes(WHITE_PNG)?.blank, true);
  assert.equal(assessLogoBytes(solidPng(180, 180, [0, 0, 0, 0]))?.blank, true);
  const square = assessLogoBytes(PNG);
  const wide = assessLogoBytes(WIDE_PNG);
  const small = assessLogoBytes(SMALL_PNG);
  assert.equal(square?.blank, false);
  assert.equal(square?.tiny, false);
  assert.ok((square?.score || 0) > (wide?.score || 0));
  assert.ok((small?.score || 0) > (wide?.score || 0));
});

test("logo requests use a browser user agent", () => {
  const headers = logoFetchHeaders(new URL("https://example.com/a.png"));
  assert.match(headers["User-Agent"], /Mozilla\/5.0/);
  assert.equal(headers["User-Agent"].includes("CampaignDesk"), false);
  assert.match(headers.Accept, /text\/html/);
});

test("a tiny apple icon loses to a square logo, and a blank one is skipped", async () => {
  const calls: string[] = [];
  const transport: LogoTransport = async (url) => {
    calls.push(url);
    if (url.endsWith("/apple-180.png")) {
      return { ok: true, status: 200, contentType: "image/png", body: TINY_PNG, url };
    }
    if (url.endsWith("/brand-logo.png")) {
      return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
    }
    if (url === "https://example.com/") {
      return { ok: true, status: 200, contentType: "text/html", body: Buffer.from(PAGE), url };
    }
    return { ok: false, error: "miss" };
  };
  const result = await fetchStoredLogo("example.com", transport);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.source, "logo");
  assert.equal(calls.includes("https://example.com/favicon-32.png"), false);

  const blankThenSmall: LogoTransport = async (url) => {
    if (url.endsWith("/apple-180.png")) {
      return { ok: true, status: 200, contentType: "image/png", body: WHITE_PNG, url };
    }
    if (url.endsWith("/favicon-32.png")) {
      return { ok: true, status: 200, contentType: "image/png", body: SMALL_PNG, url };
    }
    if (url === "https://example.com/") {
      return { ok: true, status: 200, contentType: "text/html", body: Buffer.from(PAGE), url };
    }
    return { ok: false, error: "miss" };
  };
  const fallback = await fetchStoredLogo("example.com", blankThenSmall);
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.source, "favicon");
});

test("a 403 from the site still stores the favicon service image", async () => {
  const transport: LogoTransport = async (url) => {
    if (url.includes("google.com/s2/favicons")) {
      return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
    }
    return { ok: false, error: "Logo request failed (403)." };
  };
  const result = await fetchStoredLogo("https://blocked.example", transport);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.source, "favicon-service");
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
    assert.ok(dry.skipped.some((row) => row.id === quiet.id));

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

  test("an empty website uses the lifecycle brand kit, then the card shows the stored logo", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-brand-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    const { createRevClient, getRevClient } = await import("../src/lib/revenue");
    const { saveAccountBrandGuidelines } = await import("../src/lib/lifecycle-account-playbook");
    const { loadCampaignMonthDesk } = await import("../src/lib/campaign-month-desk-load");

    t.after(() => {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const harbor = createRevClient({ name: "Harbor & Co", businessModel: "home_service" });
    const northwind = createRevClient({ name: "Northwind", businessModel: "b2b" });
    assert.equal(getRevClient(harbor.id)?.website, "");
    saveAccountBrandGuidelines(harbor.id, {
      logoAssetsUrl: "https://harbor.example/about",
    });

    const transport: LogoTransport = async (url) => {
      if (url.startsWith("https://harbor.example")) {
        return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
      }
      return { ok: false, error: "miss" };
    };

    const report = await pullMissingClientLogos({ transport });
    assert.equal(report.fetched.length, 1);
    assert.equal(report.fetched[0].source, "website-image");
    assert.equal(getRevClient(harbor.id)?.website, "harbor.example");
    assert.ok((getRevClient(harbor.id)?.logo_path || "").endsWith(".png"));
    assert.ok(report.unresolved.some((row) => row.name === "Northwind"));

    const desk = loadCampaignMonthDesk({ role: "admin", person: null }, null);
    const card = desk.clients.find((client) => client.id === harbor.id);
    const blank = desk.clients.find((client) => client.id === northwind.id);
    assert.match(card?.logoUrl || "", new RegExp(`/api/clients/${harbor.id}/logo`));
    assert.equal(/google\.com/.test(card?.logoUrl || ""), false);
    assert.equal(blank?.logoUrl, null);

    const refreshed = await refreshClientLogo(harbor.id, transport);
    assert.equal(refreshed.ok, true);
    if (refreshed.ok) {
      assert.match(refreshed.logoUrl, new RegExp(`/api/clients/${harbor.id}/logo`));
    }
  });

  test("a cached favicon shows when the logo file is not stored yet", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-favicon-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    const { createRevClient } = await import("../src/lib/revenue");
    const { saveAccountBrandGuidelines } = await import("../src/lib/lifecycle-account-playbook");
    const { loadCampaignMonthDesk } = await import("../src/lib/campaign-month-desk-load");

    t.after(() => {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const lumen = createRevClient({ name: "Lumen Studio", businessModel: "b2b" });
    saveAccountBrandGuidelines(lumen.id, { replyToEmail: "hello@lumen.example" });
    assert.equal(saveCachedFavicon("lumen.example", PNG), true);

    const desk = loadCampaignMonthDesk({ role: "admin", person: null }, null);
    const card = desk.clients.find((client) => client.id === lumen.id);
    assert.equal(card?.website, "");
    assert.equal(card?.logoUrl, "/api/client-favicons/lumen.example");
  });

  test("a page load resolves a limited, deduped batch and skips clients with no domain", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-batch-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    resetClientLogoResolveForTests();
    const { createRevClient, updateRevClient } = await import("../src/lib/revenue");

    t.after(() => {
      resetClientLogoResolveForTests();
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const client = createRevClient({ name: `Client ${i}`, businessModel: "home_service" });
      updateRevClient(client.id, { website: `https://c${i}.example` });
      ids.push(client.id);
    }
    const quiet = createRevClient({ name: "No Domain", businessModel: "b2b" });
    const pages: string[] = [];
    const transport: LogoTransport = async (url) => {
      if (/^https:\/\/c\d\.example\/$/.test(url)) {
        pages.push(url);
        return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
      }
      return { ok: false, error: "miss" };
    };

    const first = scheduleMissingClientLogos([quiet.id, ...ids], {
      transport,
      limit: 4,
      gapMs: 0,
    });
    const second = scheduleMissingClientLogos([quiet.id, ...ids], {
      transport,
      limit: 4,
      gapMs: 0,
    });
    const [startedFirst, startedSecond] = await Promise.all([first, second]);
    assert.equal(startedFirst.length, 4);
    assert.equal(startedFirst.includes(quiet.id), false);
    assert.equal(startedSecond.length, 1);
    assert.equal(new Set([...startedFirst, ...startedSecond]).size, 5);
    assert.equal(pages.length, 5);

    const again = await scheduleMissingClientLogos(ids, { transport, limit: 4, gapMs: 0 });
    assert.deepEqual(again, []);
    assert.equal(pages.length, 5);
  });

  test("a batch keeps going when one logo fetch throws", async (t) => {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-batch-throw-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    resetClientLogoResolveForTests();
    const { createRevClient, updateRevClient } = await import("../src/lib/revenue");
    const { readClientLogo } = await import("../src/lib/client-logos");

    t.after(() => {
      resetClientLogoResolveForTests();
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const boom = createRevClient({ name: "Boom", businessModel: "b2b" });
    const ok = createRevClient({ name: "Ok", businessModel: "b2b" });
    updateRevClient(boom.id, { website: "https://boom.example" });
    updateRevClient(ok.id, { website: "https://ok.example" });
    const transport: LogoTransport = async (url) => {
      if (url.startsWith("https://boom.example")) throw new Error("blocked");
      if (url.startsWith("https://ok.example")) {
        return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
      }
      return { ok: false, error: "miss" };
    };
    await pullClientLogosInBatches([boom.id, ok.id], { transport, batchSize: 2, gapMs: 0 });
    assert.equal(readClientLogo(boom.id, `${boom.id}.png`), null);
    assert.ok(readClientLogo(ok.id, `${ok.id}.png`));
  });
});
