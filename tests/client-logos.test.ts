import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extForLogoMime,
  logoFilename,
  readClientLogo,
  removeClientLogoFiles,
  saveClientLogo,
} from "../src/lib/client-logos";
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
    const saved = saveClientLogo("cl_x", Buffer.from("fakepng"), "image/png");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const read = readClientLogo("cl_x", saved.filename);
    assert.ok(read);
    assert.equal(read!.buffer.toString(), "fakepng");
    removeClientLogoFiles("cl_x");
    assert.equal(readClientLogo("cl_x", saved.filename), null);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
