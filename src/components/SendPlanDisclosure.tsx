"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Collapsed-by-default schedule on the client review link and the internal
 * campaign page. The header stays useful while closed: the title plus a one
 * line summary. The list underneath is the same markup each page already had.
 */
export function SendPlanDisclosure({
  summary,
  children,
  actions,
  note,
  variant = "review",
  headingId,
}: {
  summary: string;
  children: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  variant?: "review" | "desk";
  headingId?: string;
}) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const listId = `send-plan-list-${reactId.replace(/:/g, "")}`;
  const titleId = headingId || `send-plan-title-${reactId.replace(/:/g, "")}`;

  return (
    <section
      className={`card send-plan send-plan--${variant}${open ? " is-open" : " is-collapsed"}`}
      aria-labelledby={titleId}
    >
      <div className="send-plan-head">
        <h2 id={titleId} className="send-plan-title">
          <button
            type="button"
            className="send-plan-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="send-plan-chevron" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
                <path
                  d="M6 3.5 11 8 6 12.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="send-plan-toggle-copy">
              <span className="send-plan-title-text">When these go out</span>
              <span className="send-plan-summary">{summary}</span>
              {note ? <span className="send-plan-note">{note}</span> : null}
            </span>
          </button>
        </h2>
        {actions ? <div className="send-plan-actions">{actions}</div> : null}
      </div>
      <div
        id={listId}
        className={`send-plan-panel${open ? " is-open" : ""}`}
        inert={!open}
      >
        <div className="send-plan-panel-inner">{children}</div>
      </div>
    </section>
  );
}
