import assert from "node:assert/strict";
import test from "node:test";
import { agencyFrom } from "../src/lib/email";

test("every send is from Marketing Empire Group", () => {
  assert.equal(
    agencyFrom("hello@marketingempiregroup.com"),
    "Marketing Empire Group <hello@marketingempiregroup.com>"
  );
  assert.equal(
    agencyFrom("Cassidy (Marketing Empire Group) <hello@marketingempiregroup.com>"),
    "Marketing Empire Group <hello@marketingempiregroup.com>"
  );
  assert.equal(
    agencyFrom("Marketing Empire <scheduling@yourdomain.com>"),
    "Marketing Empire Group <scheduling@yourdomain.com>"
  );
});
