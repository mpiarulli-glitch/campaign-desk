"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type ClientComboboxOption = {
  id: string;
  name: string;
};

type Props = {
  clients: ClientComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  /** When set, shown as the first choice (e.g. "All clients") with this id. */
  allOption?: { id: string; label: string };
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Type-to-filter client picker.
 *
 * Closed, the field shows the current choice. Open, it becomes an empty search
 * box so typing replaces the label instead of making you delete "All clients".
 * Leading name matches rank above matches later in the string.
 */
export function ClientCombobox({
  clients,
  value,
  onChange,
  allOption,
  placeholder,
  ariaLabel = "Client",
  className,
  style,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = useMemo(() => {
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!allOption) return sorted;
    return [{ id: allOption.id, name: allOption.label }, ...sorted];
  }, [clients, allOption]);

  const selected = options.find((c) => c.id === value);
  const selectedLabel = selected?.name || allOption?.label || "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const starts: ClientComboboxOption[] = [];
    const contains: ClientComboboxOption[] = [];
    for (const c of options) {
      const n = c.name.toLowerCase();
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [options, query]);

  useEffect(() => {
    setActive((a) => (a >= matches.length ? 0 : a));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(matches.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const hit = matches[active];
      if (hit) choose(hit.id);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div
      className={`client-combo ${className || ""}`.trim()}
      ref={wrapRef}
      style={style}
    >
      <input
        // Closed: show the choice. Open: empty search so typing starts fresh.
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onKeyDown={onKeyDown}
        placeholder={selectedLabel || placeholder || "Search clients"}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
      />
      <span className="client-combo-chevron" aria-hidden="true" />
      {open ? (
        <ul className="client-combo-list" id={listId} role="listbox">
          {matches.length === 0 ? (
            <li className="client-combo-empty">No matches</li>
          ) : (
            matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === value}
                  className={`client-combo-item ${i === active ? "is-active" : ""} ${
                    c.id === value ? "is-picked" : ""
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c.id);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {c.name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
