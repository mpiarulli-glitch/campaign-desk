// Highlight a passage of copy in a campaign preview and attach a comment to it.
//
// The stored locator is the selected string plus which occurrence of that
// exact string it is, counting in document order. Same idea as inline-edit:
// the live DOM is a different tree from the source HTML, so a character offset
// into the source would drift. The selected text itself is what the reviewer
// saw, and the ordinal tells two identical lines apart.
//
// When the copy later changes and the passage is gone, the highlight simply
// does not paint. The comment still shows the quoted text in the sidebar.

export const MAX_QUOTE_CHARS = 2000;

export type CopyQuote = {
  text: string;
  ordinal: number;
};

export type QuoteMark = CopyQuote & {
  id: string;
  resolved?: boolean;
  active?: boolean;
  pending?: boolean;
  number?: number;
};

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TITLE",
  "HEAD",
  "META",
  "LINK",
  "NOSCRIPT",
]);

export const QUOTE_MARK_ATTR = "data-cd-quote";

export function isCopyQuote(comment: {
  quote_text?: string | null;
}): boolean {
  return Boolean(comment.quote_text && comment.quote_text.trim());
}

export function quotedFeedback(quoteText: string | null | undefined, body: string): string {
  const quote = (quoteText || "").trim();
  const note = body.trim();
  if (!quote) return note;
  if (!note) return `On the highlighted copy: "${quote}"`;
  return `On the highlighted copy: "${quote}"\n\n${note}`;
}

// Which occurrence of `needle` begins at `start`. 0 when this is the first.
export function ordinalOfSlice(
  haystack: string,
  needle: string,
  start: number
): number {
  if (!needle) return 0;
  let ordinal = 0;
  let from = 0;
  while (from < start) {
    const at = haystack.indexOf(needle, from);
    if (at === -1 || at >= start) break;
    ordinal += 1;
    from = at + Math.max(1, needle.length);
  }
  return ordinal;
}

export function findNthOccurrence(
  haystack: string,
  needle: string,
  ordinal: number
): { start: number; end: number } | null {
  if (!needle) return null;
  let from = 0;
  let seen = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return null;
    if (seen === ordinal) {
      return { start: at, end: at + needle.length };
    }
    seen += 1;
    from = at + Math.max(1, needle.length);
  }
  return null;
}

function skipTextNode(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    el = el.parentElement;
  }
  return false;
}

export function collectTextRuns(root: Node): Text[] {
  const doc = root.ownerDocument || (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (skipTextNode(n)) continue;
    runs.push(n as Text);
  }
  return runs;
}

export function flattenRuns(runs: Text[]): string {
  let out = "";
  for (const run of runs) out += run.nodeValue || "";
  return out;
}

function pointToOffset(runs: Text[], node: Node, offset: number): number | null {
  if (node.nodeType === 3) {
    let acc = 0;
    for (const run of runs) {
      const len = (run.nodeValue || "").length;
      if (run === node) {
        return acc + Math.max(0, Math.min(offset, len));
      }
      acc += len;
    }
    return null;
  }

  const child = node.childNodes[offset] || null;
  if (child && child.nodeType === 3) {
    return pointToOffset(runs, child, 0);
  }
  if (child) {
    let acc = 0;
    let seen = false;
    for (const run of runs) {
      if (child === run || (child.contains && child.contains(run))) {
        return acc;
      }
      acc += (run.nodeValue || "").length;
      if (run.parentNode && child.compareDocumentPosition) {
        const pos = child.compareDocumentPosition(run);
        if (pos & 2) seen = true;
      }
    }
    if (seen) return acc;
  }

  if (offset >= node.childNodes.length) {
    let acc = 0;
    let found = false;
    for (const run of runs) {
      if (node === run || (node.contains && node.contains(run))) {
        found = true;
        acc += (run.nodeValue || "").length;
        continue;
      }
      if (found) break;
      acc += (run.nodeValue || "").length;
    }
    return found ? acc : null;
  }

  return null;
}

export function quoteFromRange(root: Node, range: Range): CopyQuote | null {
  if (range.collapsed) return null;
  const ancestor = range.commonAncestorContainer;
  if (ancestor !== root && !(root.contains && root.contains(ancestor))) {
    return null;
  }

  const runs = collectTextRuns(root);
  const start = pointToOffset(runs, range.startContainer, range.startOffset);
  const end = pointToOffset(runs, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;

  const concat = flattenRuns(runs);
  let text = concat.slice(start, end);
  if (!text.trim()) return null;
  if (text.length > MAX_QUOTE_CHARS) {
    text = text.slice(0, MAX_QUOTE_CHARS);
  }

  return {
    text,
    ordinal: ordinalOfSlice(concat, text, start),
  };
}

export function quoteFromSelection(
  root: Node,
  selection: Selection | null
): CopyQuote | null {
  if (!selection || selection.rangeCount === 0) return null;
  return quoteFromRange(root, selection.getRangeAt(0));
}

export function clearQuoteMarks(root: ParentNode): void {
  const marks = Array.from(root.querySelectorAll(`mark[${QUOTE_MARK_ATTR}]`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function wrapOffsets(
  doc: Document,
  runs: Text[],
  start: number,
  end: number,
  mark: QuoteMark
): void {
  let acc = 0;
  const pieces: { node: Text; from: number; to: number }[] = [];
  for (const run of runs) {
    const len = (run.nodeValue || "").length;
    const runStart = acc;
    const runEnd = acc + len;
    acc = runEnd;
    const from = Math.max(start, runStart);
    const to = Math.min(end, runEnd);
    if (to <= from) continue;
    pieces.push({
      node: run,
      from: from - runStart,
      to: to - runStart,
    });
  }

  // Wrap from the end of each node so earlier splits in the same node do
  // not shift later offsets.
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i];
    let node = piece.node;
    if (piece.to < (node.nodeValue || "").length) {
      node.splitText(piece.to);
    }
    if (piece.from > 0) {
      node = node.splitText(piece.from);
    }
    const wrapper = doc.createElement("mark");
    wrapper.setAttribute(QUOTE_MARK_ATTR, mark.id);
    if (mark.resolved) wrapper.classList.add("is-resolved");
    if (mark.active) wrapper.classList.add("is-active");
    if (mark.pending) wrapper.classList.add("is-pending");
    if (mark.number) wrapper.setAttribute("data-n", String(mark.number));
    const parent = node.parentNode;
    if (!parent) continue;
    parent.insertBefore(wrapper, node);
    wrapper.appendChild(node);
  }
}

export function applyQuoteMarks(root: ParentNode, quotes: QuoteMark[]): void {
  clearQuoteMarks(root);
  const doc = root.ownerDocument || (root as Document);
  const firstRuns = collectTextRuns(root);
  const firstConcat = flattenRuns(firstRuns);

  const located: { start: number; mark: QuoteMark }[] = [];
  for (const mark of quotes) {
    if (!mark.text) continue;
    const range = findNthOccurrence(firstConcat, mark.text, mark.ordinal);
    if (!range) continue;
    located.push({ start: range.start, mark });
  }

  // Later offsets first, so wrapping one mark does not shift an earlier one.
  located.sort((a, b) => b.start - a.start);
  for (const item of located) {
    const runs = collectTextRuns(root);
    const concat = flattenRuns(runs);
    const range = findNthOccurrence(concat, item.mark.text, item.mark.ordinal);
    if (!range) continue;
    wrapOffsets(doc, runs, range.start, range.end, item.mark);
  }
}

export function selectionViewportRect(selection: Selection | null): DOMRect | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return rect;
}
