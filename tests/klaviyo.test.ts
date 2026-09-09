import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  htmlToText,
  isKlaviyoApiKey,
  isKlaviyoPublicSiteId,
  klaviyoKeyHint,
  klaviyoTemplatePayload,
  normalizeKlaviyoApiKey,
  templateEditorUrl,
} from "../src/lib/klaviyo";

test("isKlaviyoApiKey accepts private keys only", () => {
  assert.equal(isKlaviyoApiKey("pk_abcdefghijklmnopqrstuv"), true);
  assert.equal(isKlaviyoApiKey(" pk_abcdefghijklmnopqrstuv "), true);
  assert.equal(
    isKlaviyoApiKey("pk_abc123def456ghi789jkl0mno123pqrst4"),
    true
  );
  assert.equal(isKlaviyoApiKey("pk_abc-def_ghi1234567890"), true);
  assert.equal(isKlaviyoApiKey("sk_abcdefghijklmnopqrstuv"), false);
  assert.equal(isKlaviyoApiKey("Ecoworkz"), false);
  assert.equal(isKlaviyoApiKey("AbC123"), false);
  assert.equal(isKlaviyoApiKey(""), false);
});

test("normalizeKlaviyoApiKey strips paste junk", () => {
  assert.equal(
    normalizeKlaviyoApiKey('  "pk_abcdefghijklmnopqrstuv"  '),
    "pk_abcdefghijklmnopqrstuv"
  );
  assert.equal(
    normalizeKlaviyoApiKey("Klaviyo-API-Key pk_abcdefghijklmnopqrstuv"),
    "pk_abcdefghijklmnopqrstuv"
  );
  assert.equal(
    normalizeKlaviyoApiKey("pk_\nabcdefghijklmnopqrstuv"),
    "pk_abcdefghijklmnopqrstuv"
  );
  assert.equal(isKlaviyoPublicSiteId("AbC123"), true);
  assert.equal(isKlaviyoPublicSiteId("pk_abcdefghijklmnopqrstuv"), false);
});

test("htmlToText strips markup for the Klaviyo text version", () => {
  assert.equal(
    htmlToText("<p>Hello <strong>there</strong></p><p>Second</p>"),
    "Hello there\nSecond"
  );
  assert.match(htmlToText("<style>.x{color:red}</style><p>Keep</p>"), /Keep/);
  assert.doesNotMatch(htmlToText("<style>.x{color:red}</style><p>Keep</p>"), /color:red/);
});

test("klaviyoTemplatePayload is a CODE HTML template", () => {
  const payload = klaviyoTemplatePayload({
    name: "Ecoworkz September - Welcome",
    html: "<p>Hi {{ first_name|default:'there' }}</p>",
  });
  assert.equal(payload.data.type, "template");
  assert.equal(payload.data.attributes.editor_type, "CODE");
  assert.equal(payload.data.attributes.name, "Ecoworkz September - Welcome");
  assert.match(payload.data.attributes.html, /first_name/);
  assert.match(payload.data.attributes.text, /Hi/);
});

test("template editor URL and key hint do not leak the full secret", () => {
  assert.equal(
    templateEditorUrl("01ABC"),
    "https://www.klaviyo.com/email-editor/01ABC"
  );
  const hint = klaviyoKeyHint("pk_abcdefghijklmnopqrstuv");
  assert.equal(hint.includes("pk_abcdefghijklmnopqrstuv"), false);
  assert.match(hint, /••••/);
});

test("resolveKlaviyoApiKey prefers a saved client key over env", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-klaviyo-"));
  const originalCwd = process.cwd();
  const originalEnv = process.env.KLAVIYO_API_KEY;
  process.chdir(tmp);
  const { getDb, closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();
  getDb();
  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    process.env.KLAVIYO_API_KEY = originalEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const klaviyo = await import("../src/lib/klaviyo");
  process.env.KLAVIYO_API_KEY = "pk_envkeyenvkeyenvkeyenv";
  assert.equal(
    klaviyo.resolveKlaviyoApiKey("missing", ""),
    "pk_envkeyenvkeyenvkeyenv"
  );
  assert.equal(
    klaviyo.resolveKlaviyoApiKey("c1", "pk_accountkeyaccountkey12"),
    "pk_accountkeyaccountkey12"
  );
  klaviyo.setClientKlaviyoApiKey("c1", "pk_savedkeysavedkeysavedk");
  assert.equal(
    klaviyo.resolveKlaviyoApiKey("c1", "pk_accountkeyaccountkey12"),
    "pk_savedkeysavedkeysavedk"
  );
});
