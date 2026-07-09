"use client";

import { useMemo, useState } from "react";

type LinkRow = {
  text: string;
  href: string;
};

// Pull every anchor out of the email HTML so a reviewer can confirm each link
// points where it should. Runs in the browser (DOMParser). The VML/Outlook
// button markup lives inside <!--[if mso]--> comments, so DOMParser ignores it
// and we read the real <a> fallback once, avoiding duplicates.
function extractLinks(html: string): LinkRow[] {
  if (typeof window === "undefined" || !html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }

  const rows: LinkRow[] = [];
  const seen = new Set<string>();

  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") || "").trim();
    if (!href || href === "#" || href.toLowerCase().startsWith("javascript:")) {
      return;
    }

    let text = (a.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) {
      const img = a.querySelector("img");
      const alt = img?.getAttribute("alt")?.trim();
      text = alt ? `Image: ${alt}` : "(image or button link)";
    }

    const key = `${text}||${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ text, href });
  });

  return rows;
}

export function EmailLinks({ html }: { html: string }) {
  const links = useMemo(() => extractLinks(html), [html]);
  const [open, setOpen] = useState(true);

  return (
    <div className="card card-pad stack">
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <h2 className="h2" style={{ margin: 0 }}>
          Links in this email{" "}
          <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>
            ({links.length})
          </span>
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open ? (
        links.length === 0 ? (
          <div className="empty">No links found in this email.</div>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Check that each link goes to the right place. Click a URL to open
              it in a new tab.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {links.map((link, i) => (
                <div
                  key={`${link.href}-${i}`}
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid #eef0f2",
                    paddingTop: i === 0 ? 0 : 10,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {link.text}
                  </div>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 13,
                      wordBreak: "break-all",
                      lineHeight: 1.5,
                    }}
                  >
                    {link.href}
                  </a>
                </div>
              ))}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
