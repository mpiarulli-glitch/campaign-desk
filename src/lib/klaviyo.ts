/**
 * Push HTML email templates into a client's Klaviyo account.
 *
 * Klaviyo private API keys are per-account (one client = one pk_ key), so they
 * live in app_settings keyed by client id — the same place GHL tokens live,
 * because the Railway filesystem is ephemeral. A key pasted on the campaign
 * page is saved against that client and reused next time.
 */

import { getDb, nowIso } from "./db";

const KEYS_SETTING = "klaviyo_api_keys";
const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = process.env.KLAVIYO_API_REVISION || "2024-10-15";
const REQUEST_TIMEOUT_MS = 25_000;

export class KlaviyoError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "KlaviyoError";
  }
}

export type KlaviyoTemplatePush = {
  emailId: string;
  title: string;
  ok: boolean;
  templateId?: string;
  previewUrl?: string;
  error?: string;
};

function loadKeyMap(): Record<string, string> {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(KEYS_SETTING) as { value: string } | undefined;
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

function saveKeyMap(map: Record<string, string>): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(KEYS_SETTING, JSON.stringify(map), nowIso());
}

export function normalizeKlaviyoApiKey(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^Klaviyo-API-Key\s+/i, "")
    .replace(/\s+/g, "");
}

/** 6-character public company/site ID — not usable for /api calls. */
export function isKlaviyoPublicSiteId(value: string): boolean {
  return /^[A-Za-z0-9]{6}$/.test(normalizeKlaviyoApiKey(value));
}

export function isKlaviyoApiKey(value: string): boolean {
  return /^pk_[A-Za-z0-9_-]{16,}$/i.test(normalizeKlaviyoApiKey(value));
}

function klaviyoKeyShapeError(value: string): string | null {
  const trimmed = normalizeKlaviyoApiKey(value);
  if (!trimmed) return "Paste a Klaviyo private API key first.";
  if (isKlaviyoPublicSiteId(trimmed)) {
    return "That's the 6-character public site ID. Create a private API key in Klaviyo → Settings → API keys. It starts with pk_.";
  }
  if (isKlaviyoApiKey(trimmed) || trimmed.length >= 20) return null;
  return "That does not look like a Klaviyo private API key. It should start with pk_ — not the 6-character public site ID.";
}

export function klaviyoKeyHint(key: string): string {
  const trimmed = normalizeKlaviyoApiKey(key);
  if (trimmed.length < 8) return "pk_••••";
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function resolveKlaviyoApiKey(
  clientId: string,
  klaviyoAccount?: string | null
): string | null {
  const stored = normalizeKlaviyoApiKey(loadKeyMap()[clientId] || "");
  if (stored) return stored;
  const account = normalizeKlaviyoApiKey(klaviyoAccount || "");
  if (isKlaviyoApiKey(account)) return account;
  const envKey = normalizeKlaviyoApiKey(process.env.KLAVIYO_API_KEY || "");
  if (isKlaviyoApiKey(envKey)) return envKey;
  return null;
}

export function setClientKlaviyoApiKey(clientId: string, apiKey: string): void {
  const trimmed = normalizeKlaviyoApiKey(apiKey);
  const shapeError = klaviyoKeyShapeError(trimmed);
  if (shapeError) throw new KlaviyoError(shapeError);
  const map = loadKeyMap();
  map[clientId] = trimmed;
  saveKeyMap(map);
}

export function templateEditorUrl(templateId: string): string {
  return `https://www.klaviyo.com/email-editor/${templateId}`;
}

export function klaviyoTemplatePayload(input: {
  name: string;
  html: string;
}): { data: { type: "template"; attributes: Record<string, string> } } {
  const name = input.name.trim().slice(0, 255) || "Untitled email";
  const html = input.html.trim() || "<p></p>";
  return {
    data: {
      type: "template",
      attributes: {
        name,
        editor_type: "CODE",
        html,
        text: htmlToText(html) || name,
      },
    },
  };
}

async function klaviyoRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: "application/vnd.api+json",
    revision: KLAVIYO_REVISION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/vnd.api+json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${KLAVIYO_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new KlaviyoError("Klaviyo timed out.");
    }
    throw new KlaviyoError(
      err instanceof Error ? err.message : "Could not reach Klaviyo."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new KlaviyoError(formatKlaviyoError(res.status, text), res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function formatKlaviyoError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{ detail?: string; title?: string }>;
    };
    const detail = parsed.errors
      ?.map((e) => e.detail || e.title)
      .filter(Boolean)
      .join(" ");
    if (detail) return `Klaviyo (${status}): ${detail}`;
  } catch {
    // Fall through to the truncated body.
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  return `Klaviyo API error (${status})${snippet ? `: ${snippet}` : ""}`;
}

/** Confirm a private key can read templates before we store it. */
export async function verifyKlaviyoApiKey(apiKey: string): Promise<string> {
  const trimmed = normalizeKlaviyoApiKey(apiKey);
  const shapeError = klaviyoKeyShapeError(trimmed);
  if (shapeError) throw new KlaviyoError(shapeError);
  await klaviyoRequest(trimmed, "GET", "/templates?page[size]=1");
  return trimmed;
}

export async function pushKlaviyoTemplate(args: {
  apiKey: string;
  name: string;
  html: string;
}): Promise<{ id: string; previewUrl: string }> {
  const payload = klaviyoTemplatePayload({ name: args.name, html: args.html });
  const result = await klaviyoRequest<{ data?: { id?: string } }>(
    args.apiKey,
    "POST",
    "/templates",
    payload
  );
  const id = String(result.data?.id || "").trim();
  if (!id) throw new KlaviyoError("Klaviyo created a template but did not return an id.");
  return { id, previewUrl: templateEditorUrl(id) };
}
