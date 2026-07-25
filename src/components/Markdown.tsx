"use client";

import React from "react";

// A deliberately small Markdown renderer for lesson bodies. It builds React
// nodes (no dangerouslySetInnerHTML) and supports the subset we author with:
// ## / ### headings, - and 1. lists, > callouts, **bold**, and paragraphs.

function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<strong key={`${keyBase}-b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p${k++}`}>{inline(para.join(" "), `p${k}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, idx) => (
        <li key={`li${k}-${idx}`}>{inline(it, `li${k}-${idx}`)}</li>
      ));
      blocks.push(
        list.ordered ? (
          <ol key={`l${k++}`} className="md-list">{items}</ol>
        ) : (
          <ul key={`l${k++}`} className="md-list">{items}</ul>
        )
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(
        <blockquote key={`q${k++}`} className="md-quote">
          {inline(quote.join(" "), `q${k}`)}
        </blockquote>
      );
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (line.startsWith("### ")) {
      flushAll();
      blocks.push(<h3 key={`h${k++}`} className="md-h3">{inline(line.slice(4), `h${k}`)}</h3>);
      continue;
    }
    if (line.startsWith("## ")) {
      flushAll();
      blocks.push(<h2 key={`h${k++}`} className="md-h2">{inline(line.slice(3), `h${k}`)}</h2>);
      continue;
    }
    if (line.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(line.slice(2));
      continue;
    }
    const ordered = /^\d+\.\s+/.test(line);
    const bullet = /^[-*]\s+/.test(line);
    if (ordered || bullet) {
      flushPara();
      flushQuote();
      const item = line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line);
  }
  flushAll();

  return <div className="md">{blocks}</div>;
}
