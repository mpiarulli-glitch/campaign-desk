import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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

const FAVICON_EXTS = ["png", "jpg", "webp", "gif", "svg"] as const;

/** Hostname safe to use as a favicon cache filename. Null when it is not. */
export function faviconCacheHost(host: string): string | null {
  const safe = (host || "").trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!safe || safe.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(safe)) return null;
  if (safe.startsWith(".") || safe.endsWith(".") || safe.includes("..")) return null;
  return safe;
}

export function faviconPublicUrl(host: string): string | null {
  const safe = faviconCacheHost(host);
  if (!safe) return null;
  return `/api/client-favicons/${safe}`;
}

function faviconCacheDir(): string {
  return path.join(clientLogosRoot(), "favicons");
}

/** A favicon we downloaded earlier. Never triggers a network fetch. */
export function readCachedFavicon(host: string): { buffer: Buffer; mime: string } | null {
  const safe = faviconCacheHost(host);
  if (!safe) return null;
  const dir = faviconCacheDir();
  for (const ext of FAVICON_EXTS) {
    const file = path.join(dir, `${safe}.${ext}`);
    if (!fs.existsSync(file)) continue;
    const buffer = fs.readFileSync(file);
    const classified = classifyLogoBytes(buffer);
    if (!classified) return null;
    return { buffer: classified.data, mime: classified.mime };
  }
  return null;
}

/** Writes a favicon under data/client-logos/favicons. Bytes must be a real image. */
export function saveCachedFavicon(host: string, data: Buffer): boolean {
  const safe = faviconCacheHost(host);
  if (!safe) return false;
  const classified = classifyLogoBytes(data);
  if (!classified) return false;
  const ext = extForLogoMime(classified.mime);
  if (!ext) return false;
  const dir = faviconCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const old of FAVICON_EXTS) {
    const prior = path.join(dir, `${safe}.${old}`);
    if (old !== ext && fs.existsSync(prior)) {
      try {
        fs.unlinkSync(prior);
      } catch {
        /* already gone */
      }
    }
  }
  fs.writeFileSync(path.join(dir, `${safe}.${ext}`), classified.data);
  return true;
}

/** Shorter side below this is a tracking pixel or a tiny icon, not a card logo. */
export const LOGO_MIN_PX = 24;

export type LogoByteAssessment = {
  width: number;
  height: number;
  /** min(width, height) / max(width, height). 1 is square. */
  ratio: number;
  /** Higher is a better card logo. Negative means reject. */
  score: number;
  blank: boolean;
  tiny: boolean;
};

function finishLogoSize(
  width: number,
  height: number,
  blank: boolean
): LogoByteAssessment | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0 || width > 8000 || height > 8000) {
    return { width: 0, height: 0, ratio: 0, score: -1, blank: false, tiny: true };
  }
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);
  const ratio = minSide / maxSide;
  const tiny = minSide < LOGO_MIN_PX;
  const squareWeight = ratio >= 0.85 ? 1 : 0.2;
  const score = blank || tiny ? -1 : minSide * ratio * ratio * squareWeight;
  return { width, height, ratio, score, blank, tiny };
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function unfilterPng(raw: Buffer, height: number, stride: number, bpp: number): Buffer | null {
  const expected = height * (stride + 1);
  if (raw.length < expected) return null;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    for (let x = 0; x < stride; x++) {
      const byte = raw[src++];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = prev >= 0 ? out[prev + x] : 0;
      const upLeft = prev >= 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let value = byte;
      if (filter === 1) value = (byte + left) & 255;
      else if (filter === 2) value = (byte + up) & 255;
      else if (filter === 3) value = (byte + ((left + up) >> 1)) & 255;
      else if (filter === 4) value = (byte + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) return null;
      out[row + x] = value;
    }
  }
  return out;
}

function pngLooksBlank(pixels: Buffer, channels: number): boolean {
  let visible = 0;
  let colored = 0;
  for (let i = 0; i + channels <= pixels.length; i += channels) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (channels === 4) {
      r = pixels[i];
      g = pixels[i + 1];
      b = pixels[i + 2];
      a = pixels[i + 3];
    } else if (channels === 3) {
      r = pixels[i];
      g = pixels[i + 1];
      b = pixels[i + 2];
    } else if (channels === 2) {
      r = g = b = pixels[i];
      a = pixels[i + 1];
    } else {
      r = g = b = pixels[i];
    }
    if (a <= 16) continue;
    visible += 1;
    if (r < 245 || g < 245 || b < 245) colored += 1;
  }
  return visible === 0 || colored === 0;
}

type PngChunk = { type: string; data: Buffer };

function pngChunks(data: Buffer): PngChunk[] | null {
  if (data.length < 8 || !data.subarray(0, PNG_SIG.length).equals(PNG_SIG)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length < 0 || offset + 12 + length > data.length) return chunks.length ? chunks : null;
    const type = data.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: data.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function assessPng(data: Buffer): LogoByteAssessment | null {
  const chunks = pngChunks(data);
  if (!chunks) return null;
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return null;
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const color = ihdr.data[9];
  const interlace = ihdr.data[12];
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : color === 0 ? 1 : 0;
  const sized = finishLogoSize(width, height, false);
  if (!sized || sized.tiny || sized.score < 0) return sized;
  if (
    !channels ||
    depth !== 8 ||
    interlace !== 0 ||
    width * height > 1_500_000
  ) {
    return sized;
  }
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)
  );
  if (!idat.length) return sized;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(idat);
  } catch {
    return sized;
  }
  const pixels = unfilterPng(raw, height, width * channels, channels);
  if (!pixels) return sized;
  return finishLogoSize(width, height, pngLooksBlank(pixels, channels));
}

function assessGif(data: Buffer): LogoByteAssessment | null {
  const sig = data.subarray(0, 6).toString("ascii");
  if ((sig !== "GIF87a" && sig !== "GIF89a") || data.length < 10) return null;
  return finishLogoSize(data.readUInt16LE(6), data.readUInt16LE(8), false);
}

function assessJpeg(data: Buffer): LogoByteAssessment | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (i + 4 > data.length) break;
    const len = data.readUInt16BE(i + 2);
    if (len < 2) break;
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (sof) {
      return finishLogoSize(data.readUInt16BE(i + 7), data.readUInt16BE(i + 5), false);
    }
    i += 2 + len;
  }
  return null;
}

function assessWebp(data: Buffer): LogoByteAssessment | null {
  if (data.length < 30) return null;
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  if (data.toString("ascii", 12, 16) !== "VP8X") return null;
  const width = 1 + data.readUIntLE(24, 3);
  const height = 1 + data.readUIntLE(27, 3);
  return finishLogoSize(width, height, false);
}

function assessSvg(data: Buffer): LogoByteAssessment | null {
  const text = data.toString("utf8");
  const head = text.trimStart().slice(0, 400).toLowerCase();
  if (!(head.startsWith("<svg") || head.startsWith("<?xml"))) return null;
  if (!/<svg[\s>]/i.test(text)) return null;
  const blank = !/<(path|rect|circle|ellipse|polygon|polyline|image|text|use|line)\b/i.test(text);
  let width = 0;
  let height = 0;
  const viewBox = text.match(
    /viewBox\s*=\s*["']\s*[-+\d.]+\s+[-+\d.]+\s+([+\d.]+)\s+([+\d.]+)\s*["']/i
  );
  if (viewBox) {
    width = Number(viewBox[1]);
    height = Number(viewBox[2]);
  } else {
    const w = text.match(/\bwidth\s*=\s*["']\s*([+\d.]+)/i);
    const h = text.match(/\bheight\s*=\s*["']\s*([+\d.]+)/i);
    if (w && h) {
      width = Number(w[1]);
      height = Number(h[1]);
    }
  }
  if (!(width > 0 && height > 0)) {
    return blank ? finishLogoSize(1, 1, true) : finishLogoSize(128, 128, false);
  }
  return finishLogoSize(width, height, blank);
}

/**
 * Size and emptiness of a logo file. Null when the format is an image we
 * accept but cannot measure. A negative score, `tiny`, or `blank` should not
 * be stored as the client's mark.
 */
export function assessLogoBytes(data: Buffer): LogoByteAssessment | null {
  if (!data.length) return null;
  return assessPng(data) || assessGif(data) || assessJpeg(data) || assessWebp(data) || assessSvg(data);
}
