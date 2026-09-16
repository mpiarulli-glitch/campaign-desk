"use client";

import { useRef } from "react";
import { htmlClipboardToMarkdown, looksLikeRichHtml } from "@/lib/html-to-markdown";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minHeight?: number;
};

type Range = { start: number; end: number };

function lineBounds(value: string, start: number, end: number): Range {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  return { start: lineStart, end: nextBreak === -1 ? value.length : nextBreak };
}

function mapLines(block: string, map: (line: string, i: number) => string): string {
  return block.split("\n").map(map).join("\n");
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder,
  required,
  minHeight = 220,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function apply(next: string, select: Range) {
    onChange(next);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(select.start, select.end);
    });
  }

  function selection(): Range {
    const ta = taRef.current;
    if (!ta) return { start: value.length, end: value.length };
    return { start: ta.selectionStart, end: ta.selectionEnd };
  }

  function wrapInline(before: string, after: string, emptyLabel: string) {
    const { start, end } = selection();
    const selected = value.slice(start, end);
    const inner = selected || emptyLabel;
    const inserted = `${before}${inner}${after}`;
    apply(value.slice(0, start) + inserted + value.slice(end), {
      start: start + before.length,
      end: start + before.length + inner.length,
    });
  }

  function setHeading(level: 1 | 2 | 3) {
    const prefix = `${"#".repeat(level)} `;
    const { start, end } = selection();
    const bounds = lineBounds(value, start, end);
    const block = value.slice(bounds.start, bounds.end);
    const nextBlock = mapLines(block, (line) => {
      const stripped = line.replace(/^#{1,6}\s+/, "");
      return stripped ? `${prefix}${stripped}` : `${prefix}Heading`;
    });
    apply(value.slice(0, bounds.start) + nextBlock + value.slice(bounds.end), {
      start: bounds.start,
      end: bounds.start + nextBlock.length,
    });
  }

  function toggleList(ordered: boolean) {
    const { start, end } = selection();
    const bounds = lineBounds(value, start, end);
    const block = value.slice(bounds.start, bounds.end) || (ordered ? "Item" : "Item");
    const lines = block.split("\n");
    const allOn = lines.every((line) =>
      ordered ? /^\d+\.\s+/.test(line) : /^[-*]\s+/.test(line)
    );
    const nextBlock = mapLines(block || "Item", (line, i) => {
      const stripped = line.replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, "");
      if (allOn) return stripped;
      return ordered ? `${i + 1}. ${stripped || "Item"}` : `- ${stripped || "Item"}`;
    });
    apply(value.slice(0, bounds.start) + nextBlock + value.slice(bounds.end), {
      start: bounds.start,
      end: bounds.start + nextBlock.length,
    });
  }

  function insertTable() {
    const snippet =
      "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n";
    const { start, end } = selection();
    const before = value.slice(0, start);
    const needsBreak = before.length > 0 && !before.endsWith("\n");
    const inserted = `${needsBreak ? "\n\n" : ""}${snippet}`;
    const offset = start + inserted.indexOf("Column 1");
    apply(before + inserted + value.slice(end), {
      start: offset,
      end: offset + "Column 1".length,
    });
  }

  function insertLink() {
    const { start, end } = selection();
    const selected = value.slice(start, end) || "link text";
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const inserted = `[${selected}](${url.trim()})`;
    apply(value.slice(0, start) + inserted + value.slice(end), {
      start: start + 1,
      end: start + 1 + selected.length,
    });
  }

  function insertImageFromUrl() {
    const url = window.prompt("Image URL", "https://");
    if (!url) return;
    const alt = window.prompt("Image description", "Image") || "Image";
    insertImageMarkdown(alt, url.trim());
  }

  function insertImageMarkdown(alt: string, src: string) {
    const { start, end } = selection();
    const before = value.slice(0, start);
    const needsBreak = before.length > 0 && !before.endsWith("\n");
    const inserted = `${needsBreak ? "\n\n" : ""}![${alt}](${src})\n\n`;
    apply(before + inserted + value.slice(end), {
      start: start + inserted.length,
      end: start + inserted.length,
    });
  }

  function onImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (!src) return;
      const alt = file.name.replace(/\.[^.]+$/, "") || "Image";
      insertImageMarkdown(alt, src);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="md-editor">
      <div className="md-toolbar" role="toolbar" aria-label="Article formatting">
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => setHeading(1)}>
          H1
        </button>
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => setHeading(2)}>
          H2
        </button>
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => setHeading(3)}>
          H3
        </button>
        <span className="md-tool-gap" />
        <button
          type="button"
          className="md-tool"
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrapInline("**", "**", "bold")}
        >
          Bold
        </button>
        <button
          type="button"
          className="md-tool"
          title="Bullet list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleList(false)}
        >
          Bullets
        </button>
        <button
          type="button"
          className="md-tool"
          title="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleList(true)}
        >
          Numbers
        </button>
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={insertTable}>
          Table
        </button>
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={insertLink}>
          Link
        </button>
        <button type="button" className="md-tool" onMouseDown={(e) => e.preventDefault()} onClick={insertImageFromUrl}>
          Image URL
        </button>
        <button
          type="button"
          className="md-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
        >
          Upload image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImageFile(file);
            e.target.value = "";
          }}
        />
      </div>
      <textarea
        id={id}
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const html = e.clipboardData.getData("text/html");
          if (!html || !looksLikeRichHtml(html)) return;
          const md = htmlClipboardToMarkdown(html);
          if (!md.trim()) return;
          e.preventDefault();
          const { start, end } = selection();
          apply(value.slice(0, start) + md + value.slice(end), {
            start: start + md.length,
            end: start + md.length,
          });
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            wrapInline("**", "**", "bold");
          }
        }}
        placeholder={placeholder}
        required={required}
        style={{ minHeight, fontSize: 14, lineHeight: 1.6 }}
      />
    </div>
  );
}
