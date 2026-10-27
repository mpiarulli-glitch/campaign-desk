import fs from "node:fs";
import path from "node:path";

const LOGO_DIR = "client-logos";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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
  const base = mime.toLowerCase().split(";")[0].trim();
  return MIME_EXT[base] || null;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Drop script, foreign content, and event handlers. The file is also served
 * with a locked-down content security policy so a direct visit cannot run it.
 */
export function sanitizeSvg(input: string): string | null {
  let text = input.replace(/^\uFEFF/, "");
  const head = text.trimStart().slice(0, 400).toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return null;
  if (!(head.startsWith("<svg") || head.startsWith("<?xml"))) return null;
  text = text.replace(/<\?xml[\s\S]*?\?>/gi, "");
  text = text.replace(/<!doctype[\s\S]*?>/gi, "");
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
  text = text.replace(
    /<(iframe|embed|object|audio|video|canvas|link|meta|style)\b[\s\S]*?<\/\1>/gi,
    ""
  );
  text = text.replace(
    /<(iframe|embed|object|audio|video|canvas|link|meta|style)\b[^>]*\/?>/gi,
    ""
  );
  text = text.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  text = text.replace(
    /\s(?:href|xlink:href|src)\s*=\s*(["'])\s*(?:javascript:|data:(?!image\/))[^"']*\1/gi,
    ""
  );
  if (/<script\b/i.test(text) || /\son[a-z]+\s*=/i.test(text)) return null;
  if (!/<svg[\s>]/i.test(text)) return null;
  return text.trim();
}

/** Accept only real PNG, JPG, WebP, GIF, or SVG bytes. SVG is sanitized. */
export function classifyLogoBytes(data: Buffer): { mime: string; data: Buffer } | null {
  if (!data.length || data.length > LOGO_MAX_BYTES) return null;
  if (data.length >= PNG_SIG.length && data.subarray(0, PNG_SIG.length).equals(PNG_SIG)) {
    return { mime: "image/png", data };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: "image/jpeg", data };
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", data };
  }
  const gif = data.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") return { mime: "image/gif", data };
  const svg = sanitizeSvg(data.toString("utf8"));
  if (!svg) return null;
  const cleaned = Buffer.from(svg, "utf8");
  if (cleaned.length > LOGO_MAX_BYTES) return null;
  return { mime: "image/svg+xml", data: cleaned };
}

export function logoResponseHeaders(
  mime: string,
  byteLength: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(byteLength),
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (mime === "image/svg+xml") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    headers["Content-Disposition"] = "inline";
  }
  return headers;
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
  // The declared type is untrusted. Bytes decide the format; this keeps the
  // call shape the upload route already uses.
  void mime;
  if (data.length > LOGO_MAX_BYTES) {
    return { ok: false, error: "Logo must be 2 MB or smaller." };
  }
  const classified = classifyLogoBytes(data);
  if (!classified) {
    return { ok: false, error: "Use a PNG, JPG, WebP, GIF, or SVG logo." };
  }
  const ext = extForLogoMime(classified.mime);
  if (!ext) {
    return { ok: false, error: "Use a PNG, JPG, WebP, GIF, or SVG logo." };
  }
  const root = clientLogosRoot();
  fs.mkdirSync(root, { recursive: true });
  removeClientLogoFiles(clientId);
  const filename = logoFilename(clientId, ext);
  fs.writeFileSync(path.join(root, filename), classified.data);
  return { ok: true, filename };
}
