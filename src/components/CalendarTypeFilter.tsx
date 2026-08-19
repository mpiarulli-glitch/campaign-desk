"use client";

import {
  CALENDAR_TYPE_KEYS,
  CALENDAR_TYPE_LABEL,
  type CalendarTypeKey,
} from "@/lib/calendar-type-filter";

export function CalendarTypeFilter({
  selected,
  onChange,
}: {
  selected: CalendarTypeKey[];
  onChange: (next: CalendarTypeKey[]) => void;
}) {
  function toggle(key: CalendarTypeKey) {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    );
  }

  return (
    <div className="view-toggle" role="group" aria-label="Filter by content type">
      <button
        type="button"
        className={`view-toggle-btn ${selected.length === 0 ? "is-on" : ""}`}
        onClick={() => onChange([])}
        aria-pressed={selected.length === 0}
      >
        All
      </button>
      {CALENDAR_TYPE_KEYS.map((key) => {
        const on = selected.includes(key);
        return (
          <button
            key={key}
            type="button"
            className={`view-toggle-btn ${on ? "is-on" : ""}`}
            onClick={() => toggle(key)}
            aria-pressed={on}
          >
            {CALENDAR_TYPE_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarViewToggle({
  view,
  onChange,
}: {
  view: "calendar" | "list";
  onChange: (view: "calendar" | "list") => void;
}) {
  return (
    <div className="view-toggle" role="group" aria-label="Calendar layout">
      <button
        type="button"
        className={`view-toggle-btn ${view === "calendar" ? "is-on" : ""}`}
        onClick={() => onChange("calendar")}
        aria-pressed={view === "calendar"}
      >
        Calendar
      </button>
      <button
        type="button"
        className={`view-toggle-btn ${view === "list" ? "is-on" : ""}`}
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
      >
        List
      </button>
    </div>
  );
}
