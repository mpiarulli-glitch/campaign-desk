/**
 * Turn pasted HTML (Word, Docs, a live webpage) into the markdown subset the
 * blog editor understands: headings, lists, tables, bold, links, images.
 * Runs in the browser against a DOMParser document.
 */

function textOf(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function inlineOf(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      out += (node.textContent || "").replace(/\s+/g, " ");
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") {
      const inner = inlineOf(node).trim();
      out += inner ? `**${inner}**` : "";
    } else if (tag === "em" || tag === "i") {
      const inner = inlineOf(node).trim();
      out += inner ? `*${inner}*` : "";
    } else if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const inner = inlineOf(node).trim() || href;
      out += href ? `[${inner}](${href})` : inner;
    } else if (tag === "br") {
      out += "\n";
    } else if (tag === "img") {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "";
      if (src) out += `![${alt}](${src})`;
    } else {
      out += inlineOf(node);
    }
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

function tableToMd(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  const cells = rows.map((tr) =>
    Array.from(tr.querySelectorAll("th,td")).map((cell) =>
      textOf(cell).replace(/\|/g, "\\|")
    )
  );
  const width = Math.max(...cells.map((row) => row.length), 0);
  if (width === 0) return "";
  const padded = cells.map((row) =>
    Array.from({ length: width }, (_, i) => row[i] || "")
  );
  const header = padded[0];
  const sep = header.map(() => "---");
  const body = padded.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function blockOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "meta" || tag === "noscript") {
    return "";
  }
  if (tag === "h1") return `# ${inlineOf(el)}\n\n`;
  if (tag === "h2") return `## ${inlineOf(el)}\n\n`;
  if (tag === "h3") return `### ${inlineOf(el)}\n\n`;
  if (tag === "p") {
    const inner = inlineOf(el);
    return inner ? `${inner}\n\n` : "";
  }
  if (tag === "blockquote") {
    const inner = inlineOf(el);
    return inner ? `> ${inner}\n\n` : "";
  }
  if (tag === "ul") {
    const items = Array.from(el.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((li) => `- ${inlineOf(li)}`)
      .join("\n");
    return items ? `${items}\n\n` : "";
  }
  if (tag === "ol") {
    const items = Array.from(el.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((li, i) => `${i + 1}. ${inlineOf(li)}`)
      .join("\n");
    return items ? `${items}\n\n` : "";
  }
  if (tag === "table") {
    const md = tableToMd(el);
    return md ? `${md}\n\n` : "";
  }
  if (tag === "img") {
    const src = el.getAttribute("src") || "";
    const alt = el.getAttribute("alt") || "";
    return src ? `![${alt}](${src})\n\n` : "";
  }
  if (tag === "br") return "\n";
  return Array.from(el.childNodes)
    .map((node) => {
      if (node.nodeType === 3) {
        const t = (node.textContent || "").trim();
        return t ? `${t}\n\n` : "";
      }
      if (node instanceof Element) return blockOf(node);
      return "";
    })
    .join("");
}

export function looksLikeRichHtml(html: string): boolean {
  return /<(h[1-3]|ul|ol|table|thead|tbody|img)\b/i.test(html);
}

export function htmlClipboardToMarkdown(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return "";
  const md = Array.from(body.childNodes)
    .map((node) => {
      if (node.nodeType === 3) {
        const t = (node.textContent || "").trim();
        return t ? `${t}\n\n` : "";
      }
      if (node instanceof Element) return blockOf(node);
      return "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return md ? `${md}\n` : "";
}
