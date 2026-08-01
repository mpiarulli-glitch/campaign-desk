import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPasswordHash,
} from "../src/lib/password";

test("a hashed password verifies and a wrong one does not", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.equal(verifyPasswordHash("correct horse battery staple", hash), true);
  assert.equal(verifyPasswordHash("Correct horse battery staple", hash), false);
  assert.equal(verifyPasswordHash("", hash), false);
});

test("the same password hashes differently every time (unique salt)", () => {
  const a = hashPassword("correct horse battery staple");
  const b = hashPassword("correct horse battery staple");
  assert.notEqual(a, b);
  // Both still verify, so the salt is stored with the hash.
  assert.equal(verifyPasswordHash("correct horse battery staple", a), true);
  assert.equal(verifyPasswordHash("correct horse battery staple", b), true);
});

test("the stored format carries its own scrypt parameters", () => {
  const parts = hashPassword("correct horse battery staple").split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.ok(Number(parts[1]) >= 16384, "cost should not regress below 16384");
  // Nothing resembling the plaintext survives.
  assert.doesNotMatch(parts[5], /horse/);
});

test("a null or malformed hash never verifies and never throws", () => {
  assert.equal(verifyPasswordHash("anything", null), false);
  assert.equal(verifyPasswordHash("anything", ""), false);
  assert.equal(verifyPasswordHash("anything", "not-a-hash"), false);
  assert.equal(verifyPasswordHash("anything", "scrypt$1$2$3$zz$zz"), false);
  // Right shape, wrong field count.
  assert.equal(verifyPasswordHash("anything", "scrypt$16384$8$1$abcd"), false);
});

test("unicode passwords normalize so the same typed password still works", () => {
  // Composed vs decomposed forms of the same string.
  const composed = "contraseña-larga-1";
  const decomposed = "contraseña-larga-1";
  const hash = hashPassword(composed);
  assert.equal(verifyPasswordHash(decomposed, hash), true);
});

test("short, empty and obvious passwords are rejected", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1)));
  assert.ok(passwordProblem("            "), "whitespace only should fail");
  assert.ok(passwordProblem("mypassword123"), "contains 'password'");
  assert.ok(passwordProblem("campaign-desk-2026"), "contains the app name");
  assert.ok(passwordProblem("x".repeat(300)), "absurdly long should fail");
});

test("a reasonable password passes", () => {
  assert.equal(passwordProblem("purple-tractor-Monday-4"), null);
  assert.equal(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH)), null);
});
