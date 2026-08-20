import assert from "node:assert/strict";
import test from "node:test";
import { mergePingableDetails, type BcPerson } from "../src/lib/basecamp";

function person(partial: Partial<BcPerson> & Pick<BcPerson, "id" | "name">): BcPerson {
  return {
    email_address: "",
    ...partial,
  };
}

test("mergePingableDetails copies client flag and mention token from pingable", () => {
  const members = [
    person({ id: 1, name: "Abel Miranda", employee: true }),
    person({ id: 2, name: "Brandon Gonzales" }),
  ];
  const pingable = [
    person({
      id: 1,
      name: "Abel Miranda",
      email_address: "abel@meg.test",
      employee: true,
      attachable_sgid: "sgid-abel",
    }),
    person({
      id: 2,
      name: "Brandon Gonzales",
      email_address: "brandon@hendos.test",
      client: true,
      attachable_sgid: "sgid-brandon",
    }),
  ];

  const merged = mergePingableDetails(members, pingable);
  assert.equal(merged[0].client, undefined);
  assert.equal(merged[0].email_address, "abel@meg.test");
  assert.equal(merged[0].attachable_sgid, "sgid-abel");
  assert.equal(merged[1].client, true);
  assert.equal(merged[1].email_address, "brandon@hendos.test");
  assert.equal(merged[1].attachable_sgid, "sgid-brandon");
});

test("mergePingableDetails leaves unmatched members unchanged", () => {
  const members = [person({ id: 9, name: "Only On Project" })];
  const merged = mergePingableDetails(members, []);
  assert.deepEqual(merged, members);
});
