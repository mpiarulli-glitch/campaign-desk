"use client";

import {
  SEO_OPS_SYNC_MARKER,
  UNMATCHED_CLIENT_LABEL,
  type ForecastSyncItemView,
} from "@/lib/forecast-sync-view";

function marker(item: ForecastSyncItemView) {
  return (
    <span className="fc-sync-marker">
      {SEO_OPS_SYNC_MARKER}
      {item.unmatched ? (
        <span className="fc-sync-unmatched">{UNMATCHED_CLIENT_LABEL}</span>
      ) : null}
    </span>
  );
}

/** Read-only rows in the Today and List stacks. No checkbox, timer, or edit. */
export function SyncedForecastRows({
  items,
  taskFirst,
}: {
  items: ForecastSyncItemView[];
  taskFirst: boolean;
}) {
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => {
        const title = <span className="fc-sync-text">{item.title}</span>;
        const client = <span className="fc-sync-text">{item.clientName}</span>;
        return (
          <div key={item.id} className="ops-task-block">
            <div className="ops-list-row is-synced" aria-readonly="true">
              <div className="ops-list-lead">
                <span className="ops-list-check-spacer" aria-hidden="true" />
                {taskFirst ? title : client}
              </div>
              {taskFirst ? client : title}
              <div className="row ops-hrs" style={{ gap: 2 }}>
                <span className="fc-sync-hours">{item.hours}</span>
                <span className="muted">h</span>
              </div>
              <span className="ops-row-actions fc-sync-actions">{marker(item)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Read-only list for the Tasks view. Hand-made Basecamp tasks stay above this. */
export function SyncedForecastSection({ items }: { items: ForecastSyncItemView[] }) {
  if (!items.length) return null;
  return (
    <section className="fc-sync-section" aria-label={SEO_OPS_SYNC_MARKER}>
      <header className="fc-sync-section-head">
        <h2>{SEO_OPS_SYNC_MARKER}</h2>
        <span>{items.length}</span>
      </header>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span>{item.clientName}</span>
            <span className="muted">
              {item.date}
              {item.startTime ? ` · ${item.startTime}` : ""} · {item.hours}h
            </span>
            {marker(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}
