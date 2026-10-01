"use client";

import { useState, type ReactNode } from "react";

export function HubFoldCard({
  className,
  title,
  actions,
  children,
  open: openProp,
  onOpenChange,
}: {
  className?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  function setOpen(next: boolean) {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <section className={`lh-card lh-fold${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="lh-card-head">
        <button
          type="button"
          className="lh-fold-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={`lh-fold-caret${open ? " is-open" : ""}`} aria-hidden="true" />
          <span className="lh-fold-title">{title}</span>
        </button>
        {actions}
      </div>
      {open ? <div className="lh-fold-body">{children}</div> : null}
    </section>
  );
}
