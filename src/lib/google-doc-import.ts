/**
 * Pull a public Google Doc into the markdown subset the blog editor stores.
 *
 * Sharing must be "Anyone with the link can view". The export URL is built
 * from the document id only, so a pasted link cannot send the server anywhere
 * except docs.google.com. Google's HTML is class-styled; those classes become
 * headings, bold, italic, underline, lists, links, tables, and images.
 * Scripts, iframes, and stylesheet text are dropped.
 */

export const GOOGLE_DOC_SHARE_ERROR =
  "This doc isn't viewable. Set sharing to Anyone with the link can view.";

const DOC_ID = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{25,})/;
const SKIP_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "link",
  "meta",
  "svg",
  "canvas",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "head",
]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "hr",
]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

type Marks = { bold: boolean; italic: boolean; underline: boolean };
type StyleMarks = Marks & {
  setBold: boolean;
  setItalic: boolean;
  setUnderline: boolean;
};
type TextNode = { type: "text"; text: string };
type El = { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] };
type Node = TextNode | El;
type Ctx = { classMap: Map<string, StyleMarks>; title: string };

const EMPTY_MARKS: Marks = { bold: false, italic: false, underline: false };

export function googleDocIdFromLink(input: string): string | null {
  const raw = input.trim().replace(/^<|>$/g, "");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "docs.google.com" && url.hostname !== "www.docs.google.com") {
    return null;
  }
  const fromPath = url.pathname.match(DOC_ID);
  if (fromPath) return fromPath[1];
  if (url.pathname === "/open" || url.pathname === "/open/") {
    const id = url.searchParams.get("id") || "";
    if (/^[a-zA-Z0-9_-]{25,}$/.test(id)) return id;
  }
  return null;
}

export function googleDocHtmlToArticle(html: string): { markdown: string; title: string } {
  const root = parseHtml(html);
  const ctx: Ctx = { classMap: classStyleMap(collectStyle(root)), title: "" };
  const body = findFirst(root, "body") ?? root;
  let markdown = renderBlocks(body.children, ctx).replace(/\n{3,}/g, "\n\n").trim();
  if (markdown) markdown += "\n";
  return { markdown, title: ctx.title || cleanedDocumentTitle(root) };
}

export async function importPublicGoogleDoc(
  link: string,
  fetchImpl: typeof fetch = fetch
): Promise<
  { ok: true; markdown: string; title: string } | { ok: false; error: string }
> {
  const id = googleDocIdFromLink(link);
  if (!id) return { ok: false, error: "Paste a Google Doc link." };
  const fetched = await fetchPublicGoogleDoc(id, fetchImpl);
  if (!fetched.ok) return fetched;
  const article = googleDocHtmlToArticle(fetched.html);
  if (!article.markdown.trim()) {
    return { ok: false, error: "That document doesn't have any article text." };
  }
  const markdown = await inlineGoogleDocImages(article.markdown, fetchImpl);
  return { ok: true, markdown, title: article.title };
}

async function fetchPublicGoogleDoc(
  id: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  let current = `https://docs.google.com/document/d/${encodeURIComponent(id)}/export?format=html`;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "CampaignDesk",
        },
      });
    } catch {
      return { ok: false, error: "Could not download that Google Doc. Try again." };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: GOOGLE_DOC_SHARE_ERROR };
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { ok: false, error: GOOGLE_DOC_SHARE_ERROR };
      }
      if (next.protocol !== "https:" || next.hostname !== "docs.google.com") {
        return { ok: false, error: GOOGLE_DOC_SHARE_ERROR };
      }
      current = next.toString();
      continue;
    }
    const html = await res.text();
    if (html.length > 4_000_000) {
      return { ok: false, error: "That document is too large to import." };
    }
    if (
      res.status === 401 ||
      res.status === 403 ||
      res.status === 404 ||
      googleDocShareProblem(html)
    ) {
      return { ok: false, error: GOOGLE_DOC_SHARE_ERROR };
    }
    if (!res.ok) {
      return { ok: false, error: "Could not download that Google Doc. Try again." };
    }
    return { ok: true, html };
  }
  return { ok: false, error: GOOGLE_DOC_SHARE_ERROR };
}

function googleDocShareProblem(html: string): boolean {
  const head = html.slice(0, 12000);
  if (/accounts\.google\.com\/(?:v3\/signin|ServiceLogin|signin|AccountChooser)/i.test(head)) {
    return true;
  }
  return /You need permission|Request access|You need access/i.test(head);
}

export async function inlineGoogleDocImages(
  markdown: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)];
  let out = markdown;
  let attempts = 0;
  let inlined = 0;
  for (const match of matches) {
    if (inlined >= 6 || attempts >= 12) break;
    attempts += 1;
    let parsed: URL;
    try {
      parsed = new URL(match[2]);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || !isGoogleImageHost(parsed.hostname)) continue;
    const data = await fetchImageDataUrl(parsed, fetchImpl);
    if (!data) continue;
    const token = match[0];
    const at = out.indexOf(token);
    if (at < 0) continue;
    const alt = match[1];
    out = `${out.slice(0, at)}![${alt}](${data})${out.slice(at + token.length)}`;
    inlined += 1;
  }
  return out;
}

function isGoogleImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) return true;
  if (host === "ggpht.com" || host.endsWith(".ggpht.com")) return true;
  if (host === "drive.google.com" || host === "docs.google.com") return true;
  return /^lh\d+\.google\.com$/.test(host);
}

async function fetchImageDataUrl(url: URL, fetchImpl: typeof fetch): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return null;
      }
      if (next.protocol !== "https:" || !isGoogleImageHost(next.hostname)) return null;
      current = next;
      continue;
    }
    if (!res.ok) return null;
    const mime = imageMime((res.headers.get("content-type") || "").split(";")[0].trim());
    if (!mime) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 1_200_000) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  return null;
}

function imageMime(type: string): string | null {
  const t = type.toLowerCase();
  if (t === "image/jpg" || t === "image/jpeg" || t === "image/pjpeg") return "image/jpeg";
  if (t === "image/png" || t === "image/gif" || t === "image/webp") return t;
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  amp: "&",
  iquest: "¿",
  iexcl: "¡",
  acute: "´",
  deg: "°",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  middot: "·",
  times: "×",
  divide: "÷",
  pound: "£",
  euro: "€",
  yen: "¥",
  sect: "§",
  para: "¶",
  szlig: "ß",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  agrave: "à",
  egrave: "è",
  igrave: "ì",
  ograve: "ò",
  ugrave: "ù",
  Agrave: "À",
  Egrave: "È",
  Igrave: "Ì",
  Ograve: "Ò",
  Ugrave: "Ù",
  acirc: "â",
  ecirc: "ê",
  icirc: "î",
  ocirc: "ô",
  ucirc: "û",
  atilde: "ã",
  otilde: "õ",
  ntilde: "ñ",
  Ntilde: "Ñ",
  ccedil: "ç",
  Ccedil: "Ç",
  auml: "ä",
  euml: "ë",
  iuml: "ï",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Euml: "Ë",
  Iuml: "Ï",
  Ouml: "Ö",
  Uuml: "Ü",
};

function decodeEntities(text: string): string {
  const numeric = text
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)));
  const named = numeric.replace(/&([a-zA-Z]+);/g, (entity, name: string) => {
    if (name === "amp") return entity;
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
      ? NAMED_ENTITIES[name]
      : entity;
  });
  return named.replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function parseHtml(html: string): El {
  const root: El = { type: "el", tag: "root", attrs: {}, children: [] };
  const stack: El[] = [root];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", i)) {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const raw = html.slice(i, next === -1 ? html.length : next);
      i = next === -1 ? html.length : next;
      if (raw) {
        stack[stack.length - 1].children.push({ type: "text", text: decodeEntities(raw) });
      }
      continue;
    }
    const closing = html[i + 1] === "/";
    const nameStart = closing ? i + 2 : i + 1;
    let nameEnd = nameStart;
    while (nameEnd < html.length && /[A-Za-z0-9]/.test(html[nameEnd])) nameEnd += 1;
    const tag = html.slice(nameStart, nameEnd).toLowerCase();
    if (!tag || (closing && html[nameEnd] !== ">" && !/\s/.test(html[nameEnd]))) {
      stack[stack.length - 1].children.push({ type: "text", text: "<" });
      i += 1;
      continue;
    }
    if (closing) {
      const end = html.indexOf(">", nameEnd);
      i = end === -1 ? html.length : end + 1;
      while (stack.length > 1) {
        const popped = stack.pop()!;
        if (popped.tag === tag) break;
      }
      continue;
    }
    const parsed = parseAttributes(html, nameEnd);
    i = parsed.next;
    const el: El = { type: "el", tag, attrs: parsed.attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    const rawText = tag === "style" || tag === "script";
    if (!parsed.selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(el);
      if (rawText) {
        const closeAt = indexOfCloseTag(html, tag, i);
        const inner = html.slice(i, closeAt === -1 ? html.length : closeAt);
        if (inner) el.children.push({ type: "text", text: inner });
        i = closeAt === -1 ? html.length : closeAt;
      }
    }
  }
  return root;
}

function indexOfCloseTag(html: string, tag: string, from: number): number {
  const re = new RegExp(`</${tag}\\s*>`, "i");
  const match = re.exec(html.slice(from));
  return match ? from + match.index : -1;
}

function parseAttributes(
  html: string,
  start: number
): { attrs: Record<string, string>; next: number; selfClosing: boolean } {
  const attrs: Record<string, string> = {};
  let i = start;
  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (i >= html.length) break;
    if (html[i] === ">") return { attrs, next: i + 1, selfClosing: false };
    if (html[i] === "/" && html[i + 1] === ">") {
      return { attrs, next: i + 2, selfClosing: true };
    }
    const nameStart = i;
    while (i < html.length && /[^\s=/>]/.test(html[i])) i += 1;
    const name = html.slice(nameStart, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (html[i] !== "=") {
      if (name) attrs[name] = "";
      continue;
    }
    i += 1;
    while (i < html.length && /\s/.test(html[i])) i += 1;
    let value = "";
    if (html[i] === '"' || html[i] === "'") {
      const quote = html[i];
      i += 1;
      const end = html.indexOf(quote, i);
      value = html.slice(i, end === -1 ? html.length : end);
      i = end === -1 ? html.length : end + 1;
    } else {
      const valueStart = i;
      while (i < html.length && /[^\s>]/.test(html[i])) i += 1;
      value = html.slice(valueStart, i);
    }
    if (name) attrs[name] = decodeEntities(value);
  }
  return { attrs, next: i, selfClosing: false };
}

function collectStyle(node: Node, out: string[] = []): string {
  if (node.type === "el") {
    if (node.tag === "style") {
      out.push(node.children.map((child) => (child.type === "text" ? child.text : "")).join(""));
    } else {
      for (const child of node.children) collectStyle(child, out);
    }
  }
  return out.join("\n");
}

function classStyleMap(css: string): Map<string, StyleMarks> {
  const map = new Map<string, StyleMarks>();
  const re = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    map.set(match[1], readStyle(match[2]));
  }
  return map;
}

function readStyle(style: string): StyleMarks {
  const weight = /font-weight:\s*([^;!}]+)/i.exec(style);
  const fontStyle = /font-style:\s*([^;!}]+)/i.exec(style);
  const deco = /text-decoration(?:-line)?:\s*([^;!}]+)/i.exec(style);
  return {
    bold: weight ? isBoldWeight(weight[1]) : false,
    italic: fontStyle ? /italic|oblique/i.test(fontStyle[1]) : false,
    underline: deco ? /underline/i.test(deco[1]) : false,
    setBold: Boolean(weight),
    setItalic: Boolean(fontStyle),
    setUnderline: Boolean(deco),
  };
}

function isBoldWeight(value: string): boolean {
  const v = value.trim().toLowerCase().split(/\s+/)[0];
  if (v === "bold" || v === "bolder") return true;
  if (v === "normal" || v === "lighter") return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 600;
}

function findFirst(node: Node, tag: string): El | null {
  if (node.type !== "el") return null;
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const found = findFirst(child, tag);
    if (found) return found;
  }
  return null;
}

function classTokens(el: El): string[] {
  return (el.attrs.class || "").split(/\s+/).filter(Boolean);
}

function marksFor(el: El, parent: Marks, classMap: Map<string, StyleMarks>): Marks {
  const next = { ...parent };
  for (const token of classTokens(el)) {
    const style = classMap.get(token);
    if (!style) continue;
    if (style.setBold) next.bold = style.bold;
    if (style.setItalic) next.italic = style.italic;
    if (style.setUnderline) next.underline = style.underline;
  }
  const inline = readStyle(el.attrs.style || "");
  if (inline.setBold) next.bold = inline.bold;
  if (inline.setItalic) next.italic = inline.italic;
  if (inline.setUnderline) next.underline = inline.underline;
  if (el.tag === "b" || el.tag === "strong") next.bold = true;
  if (el.tag === "i" || el.tag === "em") next.italic = true;
  if (el.tag === "u") next.underline = true;
  return next;
}

function renderBlocks(nodes: Node[], ctx: Ctx): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const block = renderBlock(node, ctx).trim();
    if (block) parts.push(block);
  }
  return parts.join("\n\n");
}

function renderBlock(node: Node, ctx: Ctx): string {
  if (node.type === "text") return node.text.replace(/\s+/g, " ").trim();
  const tag = node.tag;
  if (SKIP_TAGS.has(tag)) return "";
  if (/^h[1-6]$/.test(tag)) {
    const text = stripUniformMarks(inlineString(node.children, EMPTY_MARKS, ctx))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    if (tag === "h1") noteTitle(ctx, text);
    const level = tag === "h1" ? "#" : tag === "h2" ? "##" : "###";
    return `${level} ${text}`;
  }
  if (tag === "p") {
    const marks = marksFor(node, EMPTY_MARKS, ctx.classMap);
    const tokens = classTokens(node);
    if (tokens.includes("title")) {
      const text = stripUniformMarks(inlineString(node.children, marks, ctx))
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return "";
      noteTitle(ctx, text);
      return `# ${text}`;
    }
    if (containsBlock(node)) return renderBlocks(node.children, ctx);
    const inner = inlineString(node.children, marks, ctx).replace(/[ \t]{2,}/g, " ").trim();
    return inner;
  }
  if (tag === "ul" || tag === "ol") return renderList(node, 0, ctx);
  if (tag === "table") return renderTable(node, ctx);
  if (tag === "blockquote") {
    const inner = renderBlocks(node.children, ctx);
    if (!inner) return "";
    return inner
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
  }
  if (tag === "img") return imageMarkdown(node);
  if (tag === "hr" || tag === "br") return "";
  return renderBlocks(node.children, ctx);
}

function containsBlock(el: El): boolean {
  return el.children.some((child) => child.type === "el" && BLOCK_TAGS.has(child.tag));
}

function renderList(el: El, depth: number, ctx: Ctx): string {
  const ordered = el.tag === "ol";
  const lines: string[] = [];
  let n = 1;
  for (const child of el.children) {
    if (child.type !== "el" || child.tag !== "li") continue;
    lines.push(renderListItem(child, ordered, n, depth, ctx));
    n += 1;
  }
  return lines.filter(Boolean).join("\n");
}

function renderListItem(
  li: El,
  ordered: boolean,
  index: number,
  depth: number,
  ctx: Ctx
): string {
  const parts = listItemParts(li);
  const text = inlineString(parts.nodes, marksFor(li, EMPTY_MARKS, ctx.classMap), ctx)
    .replace(/\s+/g, " ")
    .trim();
  const indent = "  ".repeat(depth);
  const marker = ordered ? `${index}. ` : "- ";
  const lines = [`${indent}${marker}${text}`];
  for (const nested of parts.lists) {
    const rendered = renderList(nested, depth + 1, ctx);
    if (rendered) lines.push(rendered);
  }
  return lines.join("\n");
}

function listItemParts(li: El): { nodes: Node[]; lists: El[] } {
  const nodes: Node[] = [];
  const lists: El[] = [];
  const walk = (el: El) => {
    for (const child of el.children) {
      if (child.type === "text") {
        nodes.push(child);
        continue;
      }
      if (child.tag === "ul" || child.tag === "ol") {
        lists.push(child);
        continue;
      }
      if (
        (child.tag === "p" || child.tag === "div" || child.tag === "span") &&
        hasNestedList(child)
      ) {
        walk(child);
        continue;
      }
      if (child.tag === "p" || child.tag === "div") {
        nodes.push(...child.children);
        nodes.push({ type: "text", text: " " });
        continue;
      }
      nodes.push(child);
    }
  };
  walk(li);
  return { nodes, lists };
}

function hasNestedList(el: El): boolean {
  for (const child of el.children) {
    if (child.type !== "el") continue;
    if (child.tag === "ul" || child.tag === "ol") return true;
    if (hasNestedList(child)) return true;
  }
  return false;
}

function renderTable(table: El, ctx: Ctx): string {
  const rows = rowsOf(table)
    .map((tr) => cellsOf(tr, ctx))
    .filter((row) => row.length > 0);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] || ""));
  const header = padded[0];
  const sep = header.map(() => "---");
  const body = padded.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function rowsOf(table: El): El[] {
  const rows: El[] = [];
  const visit = (el: El) => {
    for (const child of el.children) {
      if (child.type !== "el") continue;
      if (child.tag === "tr") rows.push(child);
      else if (child.tag === "thead" || child.tag === "tbody" || child.tag === "tfoot") {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

function cellsOf(tr: El, ctx: Ctx): string[] {
  const cells: string[] = [];
  for (const child of tr.children) {
    if (child.type !== "el" || (child.tag !== "td" && child.tag !== "th")) continue;
    cells.push(
      renderBlocks(child.children, ctx).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()
    );
  }
  return cells;
}

type Seg = { text: string; marks: Marks };

function marksEqual(a: Marks, b: Marks): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
}

function pushSeg(segs: Seg[], text: string, marks: Marks) {
  if (!text) return;
  const prev = segs[segs.length - 1];
  if (prev && marksEqual(prev.marks, marks)) prev.text += text;
  else segs.push({ text, marks: { ...marks } });
}

function inlineString(nodes: Node[], parent: Marks, ctx: Ctx): string {
  const segs: Seg[] = [];
  const walk = (list: Node[], marks: Marks) => {
    for (const node of list) {
      if (node.type === "text") {
        pushSeg(segs, node.text.replace(/[ \t]*\n[ \t]*/g, " "), marks);
        continue;
      }
      if (SKIP_TAGS.has(node.tag)) continue;
      if (node.tag === "br") {
        pushSeg(segs, " ", marks);
        continue;
      }
      if (node.tag === "img") {
        pushSeg(segs, imageMarkdown(node), EMPTY_MARKS);
        continue;
      }
      if (node.tag === "a") {
        pushSeg(segs, linkMarkdown(node, marks, ctx), EMPTY_MARKS);
        continue;
      }
      walk(node.children, marksFor(node, marks, ctx.classMap));
    }
  };
  walk(nodes, parent);
  return segs.map((seg) => applyMarks(seg.text, seg.marks)).join("");
}

function linkMarkdown(el: El, parent: Marks, ctx: Ctx): string {
  const marks = marksFor(el, parent, ctx.classMap);
  const href = safeHttpUrl(el.attrs.href || "");
  const label = inlineString(el.children, marks, ctx).replace(/\s+/g, " ").trim();
  if (!href) return label;
  const safeLabel = (label || href).replace(/[\[\]]/g, "");
  return `[${safeLabel}](${href})`;
}

function imageMarkdown(el: El): string {
  const raw = (el.attrs.src || "").trim();
  const src = dataImageUrl(raw) || safeHttpUrl(raw);
  if (!src) return "";
  const alt =
    (el.attrs.alt || "Image").replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim() || "Image";
  return `![${alt}](${src})`;
}

function dataImageUrl(raw: string): string {
  const compact = raw.replace(/\s+/g, "");
  const match = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([a-z0-9+/=]+)$/i.exec(compact);
  if (!match) return "";
  if (Math.floor(match[2].length * 0.75) > 1_200_000) return "";
  const mime = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  return `data:image/${mime};base64,${match[2]}`;
}

function safeHttpUrl(raw: string): string {
  const unwrapped = unwrapGoogleRedirect(raw.trim());
  if (!unwrapped) return "";
  if (/^mailto:[^\s<>]+$/i.test(unwrapped)) return unwrapped;
  let url: URL;
  try {
    url = new URL(unwrapped);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return url.toString();
}

function unwrapGoogleRedirect(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "google.com" && (url.pathname === "/url" || url.pathname === "/url/")) {
      const target = url.searchParams.get("q") || url.searchParams.get("url") || "";
      if (/^https?:\/\//i.test(target)) return target;
    }
  } catch {
    return raw;
  }
  return raw;
}

function applyMarks(text: string, marks: Marks): string {
  const normalized = text.replace(/\s+/g, " ");
  if (!normalized) return "";
  const lead = normalized.match(/^\s*/)?.[0] ?? "";
  const trailLen = normalized.match(/\s*$/)?.[0].length ?? 0;
  const core = normalized.slice(lead.length, normalized.length - trailLen);
  if (!core) return normalized;
  let out = core.replace(/\+\+/g, "+\u2060+");
  if (marks.bold && marks.italic) out = `***${out}***`;
  else if (marks.bold) out = `**${out}**`;
  else if (marks.italic) out = `*${out}*`;
  if (marks.underline) out = `++${out}++`;
  return lead + out + normalized.slice(normalized.length - trailLen);
}

function stripUniformMarks(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 4; i++) {
    if (t.startsWith("++") && t.endsWith("++") && t.length > 4 && !t.slice(2, -2).includes("++")) {
      t = t.slice(2, -2).trim();
      continue;
    }
    if (
      t.startsWith("***") &&
      t.endsWith("***") &&
      t.length > 6 &&
      !t.slice(3, -3).includes("***")
    ) {
      t = t.slice(3, -3).trim();
      continue;
    }
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4 && !t.slice(2, -2).includes("**")) {
      t = t.slice(2, -2).trim();
      continue;
    }
    if (
      t.startsWith("*") &&
      t.endsWith("*") &&
      !t.startsWith("**") &&
      t.length > 2 &&
      !t.slice(1, -1).includes("*")
    ) {
      t = t.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return t;
}

function noteTitle(ctx: Ctx, text: string) {
  if (ctx.title) return;
  const plain = stripUniformMarks(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain) ctx.title = plain;
}

function cleanedDocumentTitle(root: El): string {
  const titleEl = findFirst(root, "title");
  if (!titleEl) return "";
  const text = titleEl.children
    .map((child) => (child.type === "text" ? child.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+-\s+Google Docs\s*$/i, "")
    .trim();
  if (!text || /^google docs$/i.test(text)) return "";
  return text;
}
