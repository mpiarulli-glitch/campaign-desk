// Add someone to the weekly snapshot roster from the short Client Services form.
//
// A pasted Basecamp project URL is accepted. The project has to exist before
// anyone is created. A client that already has that name or that project is
// enrolled instead of duplicated.

import { canonicalBasecampProjectId, getBasecampProjectName } from "./basecamp";
import { normalizePhoneE164 } from "./phone";
import { createRevClient, getRevClient, listRevClients, updateRevClient } from "./revenue";
import { enrollSnapshotClient } from "./snapshot-enrollment";

export type AddSnapshotClientInput = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  basecampProjectId: string;
  enrolledBy?: string;
};

export type AddSnapshotClientResult =
  | { ok: true; linked: boolean; clientId: string; projectId: string; projectName: string }
  | { ok: false; field: "name" | "contactName" | "email" | "phone" | "basecampProjectId"; error: string };

export function snapshotProjectId(raw: string): string {
  const text = (raw || "").trim();
  const fromProject = text.match(/projects\/(\d+)/);
  if (fromProject) return fromProject[1];
  const fromBucket = text.match(/buckets\/(\d+)/);
  if (fromBucket) return fromBucket[1];
  return canonicalBasecampProjectId(text);
}

function emailOk(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function lookupSnapshotProject(
  raw: string,
  projectName: (id: string) => Promise<string> = getBasecampProjectName
): Promise<
  | { ok: true; projectId: string; projectName: string }
  | { ok: false; error: string }
> {
  const projectId = snapshotProjectId(raw);
  if (!projectId) {
    return { ok: false, error: "Enter a Basecamp project ID or paste the project URL." };
  }
  let name = "";
  try {
    name = (await projectName(projectId)).trim();
  } catch {
    name = "";
  }
  if (!name) {
    return { ok: false, error: "That Basecamp project was not found." };
  }
  return { ok: true, projectId, projectName: name };
}

export async function addSnapshotClient(
  input: AddSnapshotClientInput,
  projectName?: (id: string) => Promise<string>
): Promise<AddSnapshotClientResult> {
  const name = input.name.trim();
  const contactName = input.contactName.trim();
  const email = input.email.trim();
  const phoneRaw = input.phone.trim();
  if (!name) return { ok: false, field: "name", error: "Enter the business name." };
  if (!contactName) return { ok: false, field: "contactName", error: "Enter the point of contact." };
  if (!emailOk(email)) return { ok: false, field: "email", error: "Enter a real email address." };
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    return { ok: false, field: "phone", error: "Enter a phone number with an area code." };
  }
  const looked = await lookupSnapshotProject(input.basecampProjectId, projectName);
  if (!looked.ok) return { ok: false, field: "basecampProjectId", error: looked.error };

  const clients = listRevClients(true);
  const byProject = clients.find(
    (client) => (client.basecamp_project_id || "").trim() === looked.projectId
  );
  const byName = clients.find((client) => client.name.trim().toLowerCase() === name.toLowerCase());
  if (byProject && byName && byProject.id !== byName.id) {
    return {
      ok: false,
      field: "name",
      error: `${byName.name} already exists, and that Basecamp project is linked to ${byProject.name}.`,
    };
  }
  const existing = byProject || byName;
  if (existing) {
    const storedProject = (existing.basecamp_project_id || "").trim();
    if (storedProject && storedProject !== looked.projectId) {
      return {
        ok: false,
        field: "name",
        error: `${existing.name} is already linked to a different Basecamp project.`,
      };
    }
    updateRevClient(existing.id, {
      basecampProjectId: looked.projectId,
      contactName,
      contactEmail: email,
      contactPhone: phone,
      poc: contactName,
      active: true,
    });
    enrollSnapshotClient(existing.id, input.enrolledBy || "");
    return {
      ok: true,
      linked: true,
      clientId: existing.id,
      projectId: looked.projectId,
      projectName: looked.projectName,
    };
  }

  const created = createRevClient({ name, businessModel: "home_service" });
  const saved = updateRevClient(created.id, {
    basecampProjectId: looked.projectId,
    contactName,
    contactEmail: email,
    contactPhone: phone,
    poc: contactName,
  });
  if (!saved || !getRevClient(created.id)) {
    return { ok: false, field: "name", error: "Could not save that client." };
  }
  enrollSnapshotClient(created.id, input.enrolledBy || "");
  return {
    ok: true,
    linked: false,
    clientId: created.id,
    projectId: looked.projectId,
    projectName: looked.projectName,
  };
}
