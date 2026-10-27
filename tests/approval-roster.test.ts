import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalBasecampProjectId, type BcPerson } from "../src/lib/basecamp";
import {
  pickApprovalRecipient,
  pocFromProjectDescription,
  projectRosterMessage,
} from "../src/lib/approval-roster";

// The live Krak Boba Piscataway project description.
const PISCATAWAY_DESCRIPTION =
  "Meeting: Pending | (T1) Launched: Pending | Grand Opening Strategy | Ad Mgmt (FB: $3k) | POC: Mehtab Singh - piscataway@krakboba.com - (717) 386-6682";

const PISCATAWAY_PROJECT = {
  id: "49040791",
  name: "Krak Boba Piscataway Growth OS – Powered by the Empire Method™",
};

function mehtab(): BcPerson {
  return {
    id: 53278459,
    name: "Mehtab Singh",
    email_address: "piscataway@krakboba.com",
    client: true,
    attachable_sgid: "sgid-mehtab",
  };
}

test("the Piscataway project description names Mehtab Singh", () => {
  assert.deepEqual(pocFromProjectDescription(PISCATAWAY_DESCRIPTION), {
    name: "Mehtab Singh",
    email: "piscataway@krakboba.com",
  });
  assert.equal(canonicalBasecampProjectId("49040791.0"), "49040791");
  assert.equal(
    canonicalBasecampProjectId("https://app.basecamp.com/5338018/projects/49040791"),
    "49040791"
  );
  assert.equal(canonicalBasecampProjectId("Krak Boba Piscataway"), "");
});

test("Send to opens on Mehtab, not the other Krak Boba client users", () => {
  const people: BcPerson[] = [
    { id: 52641763, name: "Ben Pham", email_address: "ben@krakboba.com", client: true },
    { id: 52716449, name: "Van Do", email_address: "van@krakboba.com", client: true },
    mehtab(),
    { id: 48106721, name: "Jack Butler", email_address: "jack@meg.com", employee: true },
  ];
  const picked = pickApprovalRecipient({
    people,
    projectDescription: PISCATAWAY_DESCRIPTION,
  });
  assert.equal(picked?.id, 53278459);
  assert.equal(picked?.name, "Mehtab Singh");
  assert.equal(picked?.email_address, "piscataway@krakboba.com");

  const byEmail = pickApprovalRecipient({
    people,
    contactEmail: "piscataway@krakboba.com",
  });
  assert.equal(byEmail?.name, "Mehtab Singh");
});

test("an empty roster names the project and does not ask anyone to check an id", () => {
  const message = projectRosterMessage({
    clientName: "Krak Boba Piscataway",
    problem: "not_open",
    accounts: ["King Kashflow"],
  });
  assert.match(message, /Krak Boba Piscataway/);
  assert.match(message, /King Kashflow/);
  assert.doesNotMatch(message, /project id/i);
  assert.doesNotMatch(message, /check the/i);
});

test("a company id is replaced with the live project and Mehtab comes back", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-send-roster-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { createRevClient, getRevClient, updateRevClient } = await import("../src/lib/revenue");
  const { loadSendRoster } = await import("../src/lib/approval-roster");

  const krak = createRevClient({ name: "Krak Boba Piscataway", businessModel: "home_service" });
  updateRevClient(krak.id, { basecampProjectId: "4258259" });
  const kept = createRevClient({ name: "Harbor Dental", businessModel: "home_service" });
  updateRevClient(kept.id, { basecampProjectId: "1003" });

  const projects = [
    PISCATAWAY_PROJECT,
    { id: "1003", name: "Harbor Dental Growth OS" },
  ];
  const read = async (
    projectId: string
  ): Promise<{ people: BcPerson[]; problem: "not_open" | null }> => {
    if (projectId === "49040791") return { people: [mehtab()], problem: null };
    if (projectId === "1003") {
      return {
        people: [{ id: 9, name: "Harbor Owner", email_address: "owner@harbor.test", client: true }],
        problem: null,
      };
    }
    return { people: [], problem: "not_open" };
  };

  const loaded = await loadSendRoster(
    {
      clientId: krak.id,
      clientName: "Krak Boba Piscataway",
      projectId: "4258259",
      identities: [{ identity: { kind: "person", slug: "michael" }, account: "Michael" }],
    },
    { read, projectsFor: async () => projects }
  );

  assert.equal(loaded.projectId, "49040791");
  assert.equal(loaded.people[0]?.name, "Mehtab Singh");
  assert.equal(loaded.people[0]?.email_address, "piscataway@krakboba.com");
  assert.equal(getRevClient(krak.id)?.basecamp_project_id, "49040791");
  assert.equal(
    pickApprovalRecipient({
      people: loaded.people,
      projectDescription: PISCATAWAY_DESCRIPTION,
    })?.name,
    "Mehtab Singh"
  );

  const harbor = await loadSendRoster(
    {
      clientId: kept.id,
      clientName: "Harbor Dental",
      projectId: "1003",
      identities: [{ identity: { kind: "service" }, account: "King Kashflow" }],
    },
    {
      read,
      projectsFor: async () => [
        ...projects,
        { id: "1004", name: "Harbor Dental - Marketing" },
      ],
    }
  );
  assert.equal(harbor.projectId, "1003");
  assert.equal(getRevClient(kept.id)?.basecamp_project_id, "1003");
  assert.equal(harbor.people[0]?.name, "Harbor Owner");
});
