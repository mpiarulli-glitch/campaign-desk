import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { CLIENT_WEBSITE_SEED } from "../src/data/client-website-seed";
import {
  CLIENT_WEBSITE_SEED_KEY,
  CLIENT_WEBSITE_SEED_MAX_ATTEMPTS,
  matchClientWebsites,
  runClientWebsiteSeed,
  runClientWebsiteSeedOnStartup,
  type ClientWebsiteSeedClient,
  type ClientWebsiteSeedEntry,
} from "../src/lib/client-website-seed";
import type { LogoTransport } from "../src/lib/client-logo-fetch";
import { solidPng } from "./solid-png";

const PNG = solidPng(180, 180, [20, 80, 180, 255]);

const EXCLUDED = [
  "Milan and Associates",
  "My 401k PEP Solution",
  "Looda House Auction",
  "News & Views Podcast",
  "Orangecrest Club",
  "Continental Villages",
  "American Made Blue Collar LLC",
  "27th Street Bakery",
  "Paychex Empire Partnership",
  "Curt's Floor Covering",
  "Maya's Construction",
  "Best U",
];

function client(
  partial: Partial<ClientWebsiteSeedClient> & Pick<ClientWebsiteSeedClient, "id" | "name">
): ClientWebsiteSeedClient {
  return { website: "", ...partial };
}

test("the researched list is the domains to load, and the omitted names stay off it", () => {
  const byName = new Map(CLIENT_WEBSITE_SEED.map((entry) => [entry.name, entry.domain]));
  assert.equal(byName.size, 54);
  assert.equal(byName.get("Trinity Hub"), "trinityhub.ai");
  assert.equal(byName.get("Swing Inn Cafe & BBQ"), "swinginncafe.com");
  assert.equal(byName.get("Law Offices of Giselle Rodriguez, PC"), "gisellerlaw.com");
  assert.equal(byName.get("Top Notch Auto"), "topnotch-auto.com");
  for (const name of [
    "Krak Boba Corporate",
    "Krak Boba Piscataway",
    "Krak Boba Oceanside",
    "Krak Boba Temecula",
  ]) {
    assert.equal(byName.get(name), "krakboba.com", name);
  }
  const domains = CLIENT_WEBSITE_SEED.map((entry) => entry.domain);
  const dupes = domains.filter((domain, index) => domains.indexOf(domain) !== index);
  assert.deepEqual([...new Set(dupes)], ["krakboba.com"]);
  for (const name of EXCLUDED) assert.equal(byName.has(name), false, name);
});

test("client website seed is deferred until after the server is listening", () => {
  const root = fs.readFileSync("instrumentation.ts", "utf8");
  const src = fs.readFileSync("src/instrumentation.ts", "utf8");
  assert.match(root, /enqueueDeferredStartupJob\(\s*"client-websites"/);
  assert.match(src, /enqueueDeferredStartupJob\(\s*"client-websites"/);
  assert.match(root, /import\(\s*"\.\/src\/lib\/client-website-seed"\s*\)/);
  assert.match(src, /import\(\s*"\.\/lib\/client-website-seed"\s*\)/);
  assert.equal(root.includes('from "./src/lib/client-website-seed"'), false);
  assert.equal(src.includes('from "./lib/client-website-seed"'), false);
  assert.ok(root.indexOf("ready to listen") > root.indexOf("client-websites"));
  assert.ok(src.indexOf("ready to listen") > src.indexOf("client-websites"));
});

test("names fold the way the desk stores them, and a miss is not a guess", () => {
  const seeds: ClientWebsiteSeedEntry[] = [
    { name: "Stephanie's Construction", domain: "stephaniesconstructioninc.com" },
    { name: "Black's Shutters Shades & Blinds", domain: "blacksblinds.com" },
    { name: "Law Offices of Giselle Rodriguez, PC", domain: "gisellerlaw.com" },
    { name: "GenEX Cleaning Services (Azteca Cleaning)", domain: "aztecacleaningservices.com", also: ["GenX Cleaning Services"] },
    { name: "Swing Inn Cafe & BBQ", domain: "swinginncafe.com" },
    { name: "Housecleaning by Christina", domain: "cleaningbychristina.com" },
    { name: "The HR Innovator Group", domain: "hrinnovatorsgroup.com" },
    { name: "Hendo's Barrel House", domain: "hendosbarrelhouse.com" },
    { name: "ALL-IN-1 Construction", domain: "allinone-const.com" },
    { name: "NORLO Peptides", domain: "norlopeptides.com" },
    { name: "Beyond the Walls Community Church", domain: "beyondthewallschurch.org", also: ["Beyond The Walls Church"] },
    { name: "Our Watch w/Tim Thompson", domain: "ourwatch.com" },
    { name: "Not A Client", domain: "missing.example" },
    { name: "Acme", domain: "acme.example" },
  ];
  const clients: ClientWebsiteSeedClient[] = [
    client({ id: "steph", name: "Stephanies Construction" }),
    client({ id: "black", name: "Blacks Shutters Shades and Blinds" }),
    client({ id: "law", name: "Law Offices of Giselle Rodriguez" }),
    client({ id: "genex", name: "GenEX Cleaning Services" }),
    client({ id: "swing", name: "Swing Inn Cafe" }),
    client({ id: "clean", name: "House Cleaning by Christina" }),
    client({ id: "hr", name: "HR Innovator Group" }),
    client({ id: "hendo", name: "Hendos Barrel House" }),
    client({ id: "all", name: "All In 1 Construction" }),
    client({ id: "norlo-west", name: "NORLO Peptides West" }),
    client({ id: "norlo", name: "NORLO" }),
    client({ id: "walls", name: "Beyond The Walls Church" }),
    client({ id: "watch", name: "Our Watch" }),
    client({ id: "acme-a", name: "Acme LLC" }),
    client({ id: "acme-b", name: "Acme, Inc." }),
    client({ id: "kept", name: "Swing Inn Cafe & BBQ", website: "https://keep.example/menu" }),
  ];
  const rows = matchClientWebsites(clients, seeds);
  const status = (name: string) => rows.find((row) => row.name === name);
  assert.equal(status("Stephanie's Construction")?.clientId, "steph");
  assert.equal(status("Black's Shutters Shades & Blinds")?.status, "filled");
  assert.equal(status("Law Offices of Giselle Rodriguez, PC")?.clientId, "law");
  assert.equal(status("GenEX Cleaning Services (Azteca Cleaning)")?.clientId, "genex");
  assert.equal(status("Swing Inn Cafe & BBQ")?.status, "already-set");
  assert.equal(status("Swing Inn Cafe & BBQ")?.clientId, "kept");
  assert.equal(status("Swing Inn Cafe & BBQ")?.website, "https://keep.example/menu");
  assert.equal(status("Housecleaning by Christina")?.clientId, "clean");
  assert.equal(status("The HR Innovator Group")?.clientId, "hr");
  assert.equal(status("Hendo's Barrel House")?.clientId, "hendo");
  assert.equal(status("ALL-IN-1 Construction")?.clientId, "all");
  assert.equal(status("Beyond the Walls Community Church")?.clientId, "walls");
  assert.equal(status("Our Watch w/Tim Thompson")?.clientId, "watch");
  assert.equal(status("NORLO Peptides")?.status, "no-match");
  assert.equal(status("Not A Client")?.status, "no-match");
  assert.equal(status("Acme")?.status, "no-match");
  assert.equal(clients.find((row) => row.id === "acme-a")?.website, "");
  assert.equal(clients.find((row) => row.id === "norlo")?.website, "");
});

test("an alias is used only when the researched name is not on the desk", () => {
  const seeds: ClientWebsiteSeedEntry[] = [
    {
      name: "GenEX Cleaning Services (Azteca Cleaning)",
      domain: "aztecacleaningservices.com",
      also: ["GenX Cleaning Services"],
    },
  ];
  const rows = matchClientWebsites(
    [client({ id: "genx", name: "GenX Cleaning Services" })],
    seeds
  );
  assert.equal(rows[0].status, "filled");
  assert.equal(rows[0].clientId, "genx");
  assert.equal(rows[0].domain, "aztecacleaningservices.com");
});

describe("client website seed", { concurrency: 1 }, () => {
  async function withDesk(fn: () => Promise<void>): Promise<void> {
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-website-seed-"));
    process.chdir(tmp);
    const { closeDbForTests } = await import("../src/lib/db");
    closeDbForTests();
    try {
      await fn();
    } finally {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("fills blanks, keeps an existing website, shares a domain, and ignores a miss", async () => {
    await withDesk(async () => {
      const { createRevClient, getRevClient, updateRevClient } = await import("../src/lib/revenue");
      const { getDb } = await import("../src/lib/db");
      const swing = createRevClient({ name: "Swing Inn Cafe", businessModel: "home_service" });
      updateRevClient(swing.id, { website: "https://keep.example/menu" });
      const names = [
        "Krak Boba Corporate",
        "Krak Boba Piscataway",
        "Krak Boba Oceanside",
        "Krak Boba Temecula",
      ];
      for (const name of names) {
        createRevClient({ name, businessModel: "home_service" });
      }
      createRevClient({ name: "Milan and Associates", businessModel: "b2b" });

      const seeds: ClientWebsiteSeedEntry[] = [
        { name: "Swing Inn Cafe & BBQ", domain: "swinginncafe.com" },
        ...names.map((name) => ({ name, domain: "krakboba.com" })),
        { name: "Not A Client", domain: "missing.example" },
      ];
      const first = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(first.skipped, false);
      assert.equal(first.done, false);
      assert.deepEqual(first.pending, ["Not A Client"]);
      const swingRow = first.rows.find((row) => row.name.startsWith("Swing"));
      assert.equal(swingRow?.status, "already-set");
      assert.equal(getRevClient(swing.id)?.website, "https://keep.example/menu");
      for (const name of names) {
        const row = first.rows.find((item) => item.name === name);
        assert.equal(row?.status, "filled", name);
        assert.equal(getRevClient(row?.clientId || "")?.website, "krakboba.com");
      }
      assert.equal(
        getRevClient(
          (
            getDb().prepare(`SELECT id FROM rev_clients WHERE name = ?`).get("Milan and Associates") as {
              id: string;
            }
          ).id
        )?.website,
        ""
      );
      assert.equal(first.rows.find((row) => row.name === "Not A Client")?.status, "no-match");

      const again = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(again.rows.filter((row) => row.status === "filled").length, 0);
      assert.equal(getRevClient(swing.id)?.website, "https://keep.example/menu");
    });
  });

  test("a finished seed does not run again, and a missing name is retried then stopped", async () => {
    await withDesk(async () => {
      const { createRevClient, getRevClient, updateRevClient } = await import("../src/lib/revenue");
      const { getDb } = await import("../src/lib/db");
      const seeds: ClientWebsiteSeedEntry[] = [
        { name: "Harbor Co", domain: "harbor.example" },
        { name: "Missing Co", domain: "missing.example" },
      ];
      createRevClient({ name: "Harbor Co", businessModel: "b2b" });
      const first = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(first.done, false);
      assert.equal(first.attempts, 1);
      assert.equal(getRevClient(first.rows[0].clientId || "")?.website, "harbor.example");

      const harbor = getRevClient(first.rows[0].clientId || "");
      assert.ok(harbor);
      updateRevClient(harbor.id, { website: "" });
      const second = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(second.skipped, false);
      assert.equal(getRevClient(harbor.id)?.website, "harbor.example");

      for (let attempt = 3; attempt <= CLIENT_WEBSITE_SEED_MAX_ATTEMPTS; attempt++) {
        const report = await runClientWebsiteSeed({ seeds, pullLogos: false });
        assert.equal(report.attempts, attempt);
      }
      const stopped = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(stopped.skipped, true);
      assert.equal(stopped.done, true);
      updateRevClient(harbor.id, { website: "" });
      const after = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(after.skipped, true);
      assert.equal(getRevClient(harbor.id)?.website, "");
      const stored = getDb()
        .prepare(`SELECT value FROM app_settings WHERE key = ?`)
        .get(CLIENT_WEBSITE_SEED_KEY) as { value: string };
      assert.equal(JSON.parse(stored.value).done, true);
    });
  });

  test("a missing client is filled on a later boot once the row exists", async () => {
    await withDesk(async () => {
      const { createRevClient, getRevClient } = await import("../src/lib/revenue");
      const seeds: ClientWebsiteSeedEntry[] = [{ name: "Kentina", domain: "kentinahospitality.com" }];
      const waiting = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(waiting.rows[0].status, "no-match");
      assert.equal(waiting.done, false);
      const client = createRevClient({ name: "Kentina", businessModel: "home_service" });
      const found = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(found.rows[0].status, "filled");
      assert.equal(found.done, true);
      assert.equal(getRevClient(client.id)?.website, "kentinahospitality.com");
      const skipped = await runClientWebsiteSeed({ seeds, pullLogos: false });
      assert.equal(skipped.skipped, true);
    });
  });

  test("logos are pulled for matched clients and an existing file is not fetched again", async () => {
    await withDesk(async () => {
      const { createRevClient } = await import("../src/lib/revenue");
      const { readClientLogo } = await import("../src/lib/client-logos");
      const { resetClientLogoResolveForTests } = await import("../src/lib/client-logo-fetch");
      resetClientLogoResolveForTests();
      const harbor = createRevClient({ name: "Harbor Co", businessModel: "b2b" });
      const calls: string[] = [];
      const transport: LogoTransport = async (url) => {
        calls.push(url);
        if (url === "https://harbor.example/") {
          return { ok: true, status: 200, contentType: "image/png", body: PNG, url };
        }
        return { ok: false, error: "miss" };
      };
      const seeds: ClientWebsiteSeedEntry[] = [
        { name: "Harbor Co", domain: "harbor.example" },
        { name: "Missing Co", domain: "missing.example" },
      ];
      const first = await runClientWebsiteSeed({
        seeds,
        transport,
        pullLogos: true,
        logoGapMs: 0,
      });
      assert.equal(first.rows[0].status, "filled");
      assert.ok(readClientLogo(harbor.id, `${harbor.id}.png`));
      const after = calls.length;
      assert.ok(after > 0);
      await runClientWebsiteSeed({ seeds, transport, pullLogos: true, logoGapMs: 0 });
      assert.equal(calls.length, after);
      resetClientLogoResolveForTests();
    });
  });

  test("a thrown seed error is logged and does not reject startup", async () => {
    await withDesk(async () => {
      const { getDb } = await import("../src/lib/db");
      getDb().exec(`DROP TABLE app_settings`);
      const report = await runClientWebsiteSeedOnStartup({ pullLogos: false, seeds: [] });
      assert.equal(report.failed, true);
    });
  });
});
