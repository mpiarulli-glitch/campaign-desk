import fs from "node:fs";
import path from "node:path";

const LOGO_DIR = "client-logos";
const MAX_BYTES = 2 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function clientLogosRoot(): string {
  return path.join(process.cwd(), "data", LOGO_DIR);
}

export function clientLogoPublicUrl(clientId: string, version?: string): string {
  const base = `/api/clients/${clientId}/logo`;
  if (!version) return base;
  return `${base}?v=${encodeURIComponent(version)}`;
}

export function extForLogoMime(mime: string): string | null {
  return MIME_EXT[mime.toLowerCase()] || null;
}


/** Stored filename relative to data/client-logos, e.g. "cl_abc.png". */
export function logoFilename(clientId: string, ext: string): string {
  return `${clientId}.${ext}`;
}

export function readClientLogo(
  clientId: string,
  stored: string
): { buffer: Buffer; mime: string } | null {
  if (!stored || stored.includes("..") || stored.includes("/")) return null;
  const file = path.join(clientLogosRoot(), stored);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(stored).slice(1).toLowerCase();
  const mime =
    ext === "svg"
      ? "image/svg+xml"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : "application/octet-stream";
  return { buffer: fs.readFileSync(file), mime };
}

export function removeClientLogoFiles(clientId: string): void {
  const root = clientLogosRoot();
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(`${clientId}.`)) {
      try {
        fs.unlinkSync(path.join(root, name));
      } catch {
        /* already gone */
      }
    }
  }
}

export function saveClientLogo(
  clientId: string,
  data: Buffer,
  mime: string
): { ok: true; filename: string } | { ok: false; error: string } {
  const ext = extForLogoMime(mime);
  if (!ext) {
    return { ok: false, error: "Use a PNG, JPG, WebP, GIF, or SVG logo." };
  }
  if (data.length > MAX_BYTES) {
    return { ok: false, error: "Logo must be 2 MB or smaller." };
  }
  const root = clientLogosRoot();
  fs.mkdirSync(root, { recursive: true });
  removeClientLogoFiles(clientId);
  const filename = logoFilename(clientId, ext);
  fs.writeFileSync(path.join(root, filename), data);
  return { ok: true, filename };
}
