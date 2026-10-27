import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyLogoBytes,
  extForLogoMime,
  logoFilename,
  readClientLogo,
  removeClientLogoFiles,
  sanitizeSvg,
  saveClientLogo,
} from "../src/lib/client-logos";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
import { resolveClientLogoUrl } from "../src/lib/revenue";

test("logo mime and filename helpers", () => {
  assert.equal(extForLogoMime("image/png"), "png");
  assert.equal(extForLogoMime("image/svg+xml"), "svg");
  assert.equal(extForLogoMime("text/plain"), null);
  assert.equal(logoFilename("cl_1", "png"), "cl_1.png");
});

test("resolveClientLogoUrl prefers upload over website favicon", () => {
  assert.equal(
    resolveClientLogoUrl({
      id: "cl_1",
      website: "example.com",
      logo_path: "cl_1.png",
      updated_at: "2026-08-28T12:00:00.000Z",
    }),
    "/api/clients/cl_1/logo?v=2026-08-28T12%3A00%3A00.000Z"
  );
  assert.match(
    resolveClientLogoUrl({
      id: "cl_1",
      website: "example.com",
      logo_path: "",
      updated_at: "2026-08-28T12:00:00.000Z",
    }) || "",
    /google\.com/
  );
});

test("save and read client logo files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-logo-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const saved = saveClientLogo("cl_x", PNG, "image/png");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const read = readClientLogo("cl_x", saved.filename);
    assert.ok(read);
    assert.equal(read!.mime, "image/png");
    assert.equal(read!.buffer.equals(PNG), true);
    assert.equal(saveClientLogo("cl_y", Buffer.from("not an image"), "image/png").ok, false);
    removeClientLogoFiles("cl_x");
    assert.equal(readClientLogo("cl_x", saved.filename), null);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("svg logos drop scripts and event handlers", () => {
  const raw = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10" onclick="alert(1)"/></svg>`;
  const clean = sanitizeSvg(raw);
  assert.ok(clean);
  assert.equal(/<script/i.test(clean!), false);
  assert.equal(/onclick/i.test(clean!), false);
  assert.match(clean!, /<svg/i);
  const classified = classifyLogoBytes(Buffer.from(raw));
  assert.equal(classified?.mime, "image/svg+xml");
  assert.equal(classifyLogoBytes(Buffer.from("<html><svg></svg></html>")), null);
});
