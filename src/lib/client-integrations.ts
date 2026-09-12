/**
 * Optional per-client CRM connections for Lifecycle tracking.
 *
 * GHL stays on rev_clients.ghl_location_id. Everything else (Housecall Pro,
 * HubSpot, future CRMs) lives here so we can link only the accounts that need
 * it without growing more required columns on rev_clients.
 *
 * API keys / tokens are stored in app_settings, keyed by provider — never in
 * this table.
 */

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";

export const INTEGRATION_PROVIDERS = [
  {
    id: "housecall",
    label: "Housecall Pro",
    tracks: "Jobs / appointments",
    credentialLabel: "API key",
    credentialHint:
      "Housecall Pro → My Apps → API Key Management. Prefer a read-only key.",
  },
  {
    id: "hubspot",
    label: "HubSpot",
    tracks: "Forms / deals",
    credentialLabel: "Private app token",
    credentialHint:
      "HubSpot → Settings → Integrations → Private Apps. Needs forms + CRM read scopes.",
  },
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]["id"];

export type ClientIntegration = {
  id: string;
  client_id: string;
  provider: IntegrationProvider;
  external_id: string;
  label: string;
  status: "linked" | "error" | "disabled";
  last_verified_at: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
  /** Masked credential hint for the UI — never the raw secret. */
  credentialHint: string | null;
  linked: boolean;
};

const SECRET_KEYS: Record<IntegrationProvider, string> = {
  housecall: "housecall_api_keys",
  hubspot: "hubspot_api_tokens",
};

function isProvider(value: string): value is IntegrationProvider {
  return INTEGRATION_PROVIDERS.some((p) => p.id === value);
}

function loadSecretMap(provider: IntegrationProvider): Record<string, string> {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SECRET_KEYS[provider]) as { value: string } | undefined;
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) out[id] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function saveSecretMap(
  provider: IntegrationProvider,
  map: Record<string, string>
): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(SECRET_KEYS[provider], JSON.stringify(map), nowIso());
}

export function maskCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 8) return "••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function getIntegrationSecret(
  clientId: string,
  provider: IntegrationProvider
): string | null {
  const value = (loadSecretMap(provider)[clientId] || "").trim();
  return value || null;
}

export function setIntegrationSecret(
  clientId: string,
  provider: IntegrationProvider,
  secret: string
): void {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("Paste an API credential first.");
  const map = loadSecretMap(provider);
  map[clientId] = trimmed;
  saveSecretMap(provider, map);
}

export function clearIntegrationSecret(
  clientId: string,
  provider: IntegrationProvider
): void {
  const map = loadSecretMap(provider);
  if (!(clientId in map)) return;
  delete map[clientId];
  saveSecretMap(provider, map);
}

function toRow(
  row: Omit<ClientIntegration, "credentialHint" | "linked">
): ClientIntegration {
  const secret = getIntegrationSecret(row.client_id, row.provider);
  return {
    ...row,
    credentialHint: secret ? maskCredential(secret) : null,
    linked: row.status === "linked" && Boolean(secret),
  };
}

export function listClientIntegrations(clientId: string): ClientIntegration[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_integrations WHERE client_id = ? ORDER BY provider ASC`
    )
    .all(clientId) as Array<Omit<ClientIntegration, "credentialHint" | "linked">>;
  return rows.filter((r) => isProvider(r.provider)).map((r) => toRow({ ...r, provider: r.provider }));
}

export function getClientIntegration(
  clientId: string,
  provider: IntegrationProvider
): ClientIntegration | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM client_integrations WHERE client_id = ? AND provider = ?`
    )
    .get(clientId, provider) as
    | Omit<ClientIntegration, "credentialHint" | "linked">
    | undefined;
  return row && isProvider(row.provider)
    ? toRow({ ...row, provider: row.provider })
    : null;
}

export function upsertClientIntegration(input: {
  clientId: string;
  provider: IntegrationProvider;
  externalId?: string;
  label?: string;
  status?: ClientIntegration["status"];
  lastError?: string;
  verified?: boolean;
}): ClientIntegration {
  const db = getDb();
  const ts = nowIso();
  const existing = getClientIntegration(input.clientId, input.provider);
  if (existing) {
    db.prepare(
      `UPDATE client_integrations SET
         external_id = ?, label = ?, status = ?, last_verified_at = ?,
         last_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.externalId?.trim() ?? existing.external_id,
      input.label?.trim() ?? existing.label,
      input.status ?? existing.status,
      input.verified ? ts : existing.last_verified_at,
      input.lastError ?? (input.verified ? "" : existing.last_error),
      ts,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO client_integrations
         (id, client_id, provider, external_id, label, status, last_verified_at,
          last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      input.clientId,
      input.provider,
      (input.externalId || "").trim(),
      (input.label || "").trim(),
      input.status || "linked",
      input.verified ? ts : null,
      input.lastError || "",
      ts,
      ts
    );
  }
  return getClientIntegration(input.clientId, input.provider)!;
}

export function disconnectClientIntegration(
  clientId: string,
  provider: IntegrationProvider
): boolean {
  clearIntegrationSecret(clientId, provider);
  return (
    getDb()
      .prepare(`DELETE FROM client_integrations WHERE client_id = ? AND provider = ?`)
      .run(clientId, provider).changes > 0
  );
}

export function providerLabel(provider: IntegrationProvider): string {
  return INTEGRATION_PROVIDERS.find((p) => p.id === provider)?.label || provider;
}
