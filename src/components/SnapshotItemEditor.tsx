"use client";

import { FormEvent, TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";

const MIN_HEIGHT = 72;

/** Grow a textarea to its text, with a floor so a short line is still easy to edit. */
export function fitSnapshotEditor(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, MIN_HEIGHT)}px`;
}

export function SnapshotEditTextarea({
  value,
  onChange,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    fitSnapshotEditor(ref.current);
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={ref}
      className={["snap-edit-text", rest.className].filter(Boolean).join(" ")}
      rows={rest.rows ?? 3}
      value={value}
      onChange={(event) => {
        fitSnapshotEditor(event.currentTarget);
        onChange?.(event);
      }}
    />
  );
}

/** Department-item editor. Status and the drag grip stay outside this form. */
export function DepartmentItemEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave();
  }
  return (
    <form className="snap-dept-edit" onSubmit={submit}>
      <SnapshotEditTextarea
        value={value}
        aria-label={`Edit ${label} item`}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <div className="snap-edit-actions">
        <button className="btn btn-sm" type="submit">
          Save
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
