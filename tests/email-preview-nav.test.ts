import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";
import { adjacentPackageId } from "../src/lib/email-package";

test("adjacentPackageId steps through a package and stops at the ends", () => {
  const ids = ["a", "b", "c"];
  assert.equal(adjacentPackageId(ids, "a", -1), null);
  assert.equal(adjacentPackageId(ids, "a", 1), "b");
  assert.equal(adjacentPackageId(ids, "b", -1), "a");
  assert.equal(adjacentPackageId(ids, "b", 1), "c");
  assert.equal(adjacentPackageId(ids, "c", 1), null);
  assert.equal(adjacentPackageId(["only"], "only", 1), null);
  assert.equal(adjacentPackageId(ids, "missing", 1), null);
});

test("campaign and review previews pass packageNav into the device bar", () => {
  const campaign = fs.readFileSync(
    path.join("src/app/admin/campaigns/[id]/page.tsx"),
    "utf8"
  );
  const review = fs.readFileSync(
    path.join("src/app/review/[token]/page.tsx"),
    "utf8"
  );
  const preview = fs.readFileSync(
    path.join("src/components/EmailPreview.tsx"),
    "utf8"
  );

  assert.match(preview, /packageNav/);
  assert.match(preview, /preview-package-btn/);
  assert.match(campaign, /packageNav=/);
  assert.match(review, /packageNav=/);
});
