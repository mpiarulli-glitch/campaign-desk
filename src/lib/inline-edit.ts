// Applying copy edits made in the preview back into an email's source HTML.
//
// The preview is a live DOM, but the stored email is a string of hand-tuned
// markup: a full document more often than not, with a <head> carrying the
// mobile media queries and Outlook conditional comments carrying the VML
// buttons. Re-serialising that DOM back over the source would reformat all of
// it and, for a full document nested inside the preview's <body>, would drop
// the <head> entirely.
//
// So nothing here parses or re-serialises. An edit names the exact text it is
// replacing and which occurrence of it to replace, and only that slice of the
// string changes. Everything the reviewer did not touch comes out byte for
// byte identical.

export type TextEdit = {
  // The text node's content as the browser reported it, entities decoded.
  oldText: string;
  newText: string;
  // Which occurrence of oldText this is, counting only the parts of the source
  // a text node can come from. Comments are excluded because their contents
  // never become text nodes, so including them would shift every index.
  ordinal: number;
};

export type EditOutcome = {
  html: string;
  applied: number;
  // Edits whose text could not be located, returned rather than forced. A miss
  // means the assumption behind this whole approach did not hold for that node,
  // and guessing at a position would corrupt the markup.
  skipped: TextEdit[];
  // How many Outlook copies were updated alongside their visible counterparts.
  outlookCopiesUpdated: number;
};

type Range = { start: number; end: number };

// Comment spans in the source, including the Outlook conditionals. Written as a
// scan rather than a regex so an unterminated comment runs to the end of the
// string instead of silently matching across the rest of the document.
function commentRanges(html: string): Range[] {
  const ranges: Range[] = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<!--", from);
    if (open === -1) break;
    const close = html.indexOf("-->", open + 4);
    const end = close === -1 ? html.length : close + 3;
    ranges.push({ start: open, end });
    from = end;
  }
  return ranges;
}

function inRanges(index: number, ranges: Range[]): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

// Tag spans, so an occurrence sitting in an attribute is not mistaken for one
// the reviewer can see. `<a title="Book now">Book now</a>` holds the same words
// twice but is a single text node, and counting the attribute would push every
// later edit onto the wrong element.
function tagRanges(html: string, comments: Range[]): Range[] {
  const ranges: Range[] = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open === -1) break;
    if (inRanges(open, comments)) {
      from = open + 1;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    const end = close === -1 ? html.length : close + 1;
    ranges.push({ start: open, end });
    from = end;
  }
  return ranges;
}

// The browser hands back a text node with its entities already decoded, so the
// copy it reports is not the copy the source is written in. A headline held
// together with &nbsp; to keep the last two words on one line arrives here as a
// U+00A0, and searching the source for that character finds nothing.
//
// Rather than guess at one encoding, every character with a common entity form
// is matched either way, so a run written with any mix of the two is still
// found exactly once.
const ENTITY_FORMS: Record<string, string[]> = {
  " ": ["&nbsp;", "&#160;", "&#xa0;", "&#xA0;"],
  "&": ["&amp;"],
  "<": ["&lt;"],
  ">": ["&gt;"],
  '"': ["&quot;", "&#34;"],
  "'": ["&apos;", "&#39;"],
  "’": ["&rsquo;", "&#8217;"],
  "‘": ["&lsquo;", "&#8216;"],
  "“": ["&ldquo;", "&#8220;"],
  "”": ["&rdquo;", "&#8221;"],
  "–": ["&ndash;", "&#8211;"],
  "—": ["&mdash;", "&#8212;"],
  "…": ["&hellip;", "&#8230;"],
  "©": ["&copy;"],
  "®": ["&reg;"],
  "™": ["&trade;"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourcePattern(text: string): RegExp {
  let out = "";
  for (const ch of text) {
    const forms = ENTITY_FORMS[ch];
    out += forms
      ? `(?:${[ch, ...forms].map(escapeRegExp).join("|")})`
      : escapeRegExp(ch);
  }
  return new RegExp(out, "g");
}

// Text going back into markup. Ampersands and angle brackets would otherwise
// end the text run and change the document's structure, and a non-breaking
// space is written as its entity so the source stays readable and keeps doing
// its job of holding the last two words of a line together.
function toSource(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
}

function occurrences(html: string, needle: string): Range[] {
  if (!needle) return [];
  const found: Range[] = [];
  const re = sourcePattern(needle);
  for (let m = re.exec(html); m; m = re.exec(html)) {
    found.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return found;
}

export function applyTextEdits(html: string, edits: TextEdit[]): EditOutcome {
  const comments = commentRanges(html);
  const tags = tagRanges(html, comments);
  const replacements: Array<Range & { with: string }> = [];
  const skipped: TextEdit[] = [];
  let outlookCopiesUpdated = 0;

  for (const edit of edits) {
    if (edit.oldText === edit.newText) continue;
    if (!edit.oldText.trim()) {
      skipped.push(edit);
      continue;
    }

    const all = occurrences(html, edit.oldText);
    const visible = all.filter(
      (r) => !inRanges(r.start, comments) && !inRanges(r.start, tags)
    );
    const target = visible[edit.ordinal];
    if (target === undefined) {
      skipped.push(edit);
      continue;
    }

    const replacement = toSource(edit.newText);
    replacements.push({ ...target, with: replacement });

    // The same label usually appears twice: once in the anchor a reviewer can
    // see and click, and once inside an <!--[if mso]> block as the VML button
    // Outlook renders instead. Updating only the visible one leaves Outlook
    // showing the old copy, with the preview looking perfectly correct.
    for (const r of all) {
      if (!inRanges(r.start, comments)) continue;
      replacements.push({ ...r, with: replacement });
      outlookCopiesUpdated++;
    }
  }

  // Right to left, so each splice leaves the offsets of the ones still to come
  // untouched. Overlaps would mean two edits claimed the same run; the later
  // one is dropped rather than half-applied over the other.
  replacements.sort((a, b) => b.start - a.start);
  let out = html;
  let lastStart = Number.POSITIVE_INFINITY;
  let applied = 0;
  for (const r of replacements) {
    if (r.end > lastStart) continue;
    out = out.slice(0, r.start) + r.with + out.slice(r.end);
    lastStart = r.start;
    applied++;
  }

  return {
    html: out,
    applied: applied - outlookCopiesUpdated,
    skipped,
    outlookCopiesUpdated,
  };
}

/**
 * Put a preview body's HTML back into the stored email without touching the
 * <head>. Used when the reviewer rewrote structure (new lines, replaced
 * images) — those cannot be expressed as text-run splices.
 */
export function replaceBodyInnerHtml(
  sourceHtml: string,
  bodyInnerHtml: string
): string {
  const bodyOpen = sourceHtml.match(/<body\b[^>]*>/i);
  if (bodyOpen && bodyOpen.index != null) {
    const start = bodyOpen.index + bodyOpen[0].length;
    const close = sourceHtml.slice(start).search(/<\/body>/i);
    if (close !== -1) {
      return (
        sourceHtml.slice(0, start) + bodyInnerHtml + sourceHtml.slice(start + close)
      );
    }
  }
  // Fragment emails are the body. Keep whatever the preview produced.
  return bodyInnerHtml;
}

/** Strip the chrome the live editor paints onto the preview DOM before save. */
export function stripPreviewEditChrome(root: ParentNode): void {
  const nodes =
    "querySelectorAll" in root
      ? root.querySelectorAll("[data-cd-editable], [data-cd-img-edit]")
      : [];
  for (const node of Array.from(nodes)) {
    node.removeAttribute("data-cd-editable");
    node.removeAttribute("contenteditable");
    node.removeAttribute("data-cd-img-edit");
  }
  if ("getElementById" in root && typeof root.getElementById === "function") {
    root.getElementById("cd-edit-style")?.remove();
  } else if ("querySelector" in root) {
    root.querySelector("#cd-edit-style")?.remove();
  }
}
