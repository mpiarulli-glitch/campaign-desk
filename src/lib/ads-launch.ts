// Detect "we launched ads" in a Basecamp subject or body without catching
// ordinary email launches.

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeAdsLaunch(text: string): boolean {
  const t = text.toLowerCase();
  if (!t) return false;
  if (/\bads?\s+(are\s+|have\s+been\s+|went\s+)?(live|launched|launching)\b/.test(t)) {
    return true;
  }
  if (/\b(launched|launching|went live with)\s+(the\s+)?(meta\s+|google\s+|facebook\s+|paid\s+)?ads?\b/.test(t)) {
    return true;
  }
  if (/\b(ad|ads)\s+launch(ed|ing)?\b/.test(t)) return true;
  if (/\bwent\s+live\b/.test(t) && /\bads?\b/.test(t)) return true;
  return false;
}
