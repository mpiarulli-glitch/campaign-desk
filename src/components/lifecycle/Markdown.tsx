"use client";

import type { ReactNode } from "react";

/**
 * A deliberately small markdown renderer for the newsletter archive.
 *
 * The scraper emits a known, narrow subset: headings, paragraphs, images,
 * bullet lists, rules, blockquotes, and inline bold / italic / links. Handling
 * exactly that is a fraction of the weight of a full parser, and nothing here
 * renders raw HTML, so scraped content can never inject markup.
 */

type Token =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "list"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];

  for (const raw of source.split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;

    if (block === "---") {
      tokens.push({ kind: "rule" });
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(block);
    if (image) {
      tokens.push({ kind: "image", alt: image[1], src: image[2] });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(block);
    if (heading) {
      tokens.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const lines = block.split("\n");
    if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
      tokens.push({ kind: "list", items: lines.map((l) => l.trim().replace(/^[-*]\s+/, "")) });
      continue;
    }

    if (lines.every((l) => l.trim().startsWith(">"))) {
      tokens.push({ kind: "quote", text: lines.map((l) => l.replace(/^>\s?/, "")).join(" ") });
      continue;
    }

    tokens.push({ kind: "para", text: block });
  }

  return tokens;
}

/** Splits inline markdown into React nodes. Links, bold, italic, images. */
function inline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|(?<![\w_])_([^_]+)_(?![\w_])/g;

  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}i${n++}`;

    if (match[2] !== undefined) {
      out.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img key={key} className="hud-read-img" src={match[2]} alt={match[1]} />,
      );
    } else if (match[4] !== undefined) {
      out.push(
        <a key={key} href={match[4]} target="_blank" rel="noreferrer">
          {match[3]}
        </a>,
      );
    } else if (match[5] !== undefined) {
      out.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6] !== undefined) {
      out.push(<em key={key}>{match[6]}</em>);
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const tokens = tokenize(source);

  return (
    <div className="hud-prose">
      {tokens.map((t, i) => {
        const key = `b${i}`;
        switch (t.kind) {
          case "rule":
            return <hr key={key} />;
          case "image":
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={key} className="hud-read-img" src={t.src} alt={t.alt} />
            );
          case "heading": {
            const Tag = `h${Math.min(t.level + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
            return <Tag key={key}>{inline(t.text, key)}</Tag>;
          }
          case "list":
            return (
              <ul key={key}>
                {t.items.map((item, j) => (
                  <li key={`${key}l${j}`}>{inline(item, `${key}l${j}`)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={key}>{inline(t.text, key)}</blockquote>;
          default:
            return <p key={key}>{inline(t.text, key)}</p>;
        }
      })}
    </div>
  );
}
