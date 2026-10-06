"use client";

export const CLIENT_VIEWS = [
  { id: "month", label: "Month" },
  { id: "brand", label: "Brand" },
  { id: "mood", label: "Mood board" },
  { id: "offers", label: "Offers" },
] as const;

export type ClientView = (typeof CLIENT_VIEWS)[number]["id"];

export function ClientSectionNav({
  view,
  onView,
}: {
  view: ClientView;
  onView: (view: ClientView) => void;
}) {
  return (
    <nav className="lh-client-nav" aria-label="Client">
      {CLIENT_VIEWS.map((item) => {
        const current = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={current ? "on" : ""}
            aria-current={current ? "page" : undefined}
            onClick={() => onView(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
