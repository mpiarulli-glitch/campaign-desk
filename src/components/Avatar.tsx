"use client";

// Team member profile picture. Shows the headshot at /avatars/{slug}.png when
// one exists, otherwise a colored initials circle derived from the label. Slug
// is optional so it also works for ad-hoc names (e.g. a client author).
const PALETTE = [
  "#04808d", "#1f9d63", "#c48900", "#7a5cc4", "#c25d8a", "#3a7bd5",
];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({
  label,
  src = null,
  size = 28,
  title,
}: {
  label: string;
  src?: string | null;
  size?: number;
  title?: string;
}) {
  const dim = { width: size, height: size } as const;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="avatar avatar-img"
        src={src}
        alt={label}
        title={title || label}
        style={dim}
      />
    );
  }
  return (
    <span
      className="avatar avatar-initials"
      style={{ ...dim, background: colorFor(label), fontSize: Math.round(size * 0.4) }}
      title={title || label}
      aria-label={label}
    >
      {initials(label)}
    </span>
  );
}
