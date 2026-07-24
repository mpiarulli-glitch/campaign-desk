"use client";

// Generic, non-photographic "mood sim" avatar. Expression is derived purely
// from allocation % — same person always renders as a faceless placeholder,
// the face is the data.
export type Mood = "relaxed" | "focused" | "stressed" | "overwhelmed";

export function moodForPct(pct: number): Mood {
  if (pct > 130) return "overwhelmed";
  if (pct > 100) return "stressed";
  if (pct >= 80) return "focused";
  return "relaxed";
}

const MOOD_COLORS: Record<Mood, { skin: string; ring: string; accent: string }> = {
  relaxed: { skin: "#bfe8d6", ring: "#1f9d63", accent: "#0f6e42" },
  focused: { skin: "#bfe3e8", ring: "#04808d", accent: "#04606a" },
  stressed: { skin: "#f4dcb0", ring: "#c48900", accent: "#8f6300" },
  overwhelmed: { skin: "#f3c2c2", ring: "#d64545", accent: "#a12f2f" },
};

export const MOOD_LABEL: Record<Mood, string> = {
  relaxed: "Relaxed",
  focused: "Focused",
  stressed: "Stressed",
  overwhelmed: "Overwhelmed",
};

function Face({ mood, accent }: { mood: Mood; accent: string }) {
  switch (mood) {
    case "relaxed":
      return (
        <g stroke={accent} strokeWidth="2.6" strokeLinecap="round" fill="none">
          {/* soft closed, content eyes */}
          <path d="M23 41c3-3 7-3 10 0" />
          <path d="M47 41c3-3 7-3 10 0" />
          {/* gentle smile */}
          <path d="M28 54c6 6 18 6 24 0" />
        </g>
      );
    case "focused":
      return (
        <g stroke={accent} strokeWidth="2.6" strokeLinecap="round" fill="none">
          {/* level brows */}
          <path d="M21 35h11" />
          <path d="M48 35h11" />
          {/* open, forward eyes */}
          <circle cx="27" cy="42" r="3" fill={accent} stroke="none" />
          <circle cx="53" cy="42" r="3" fill={accent} stroke="none" />
          {/* neutral, determined mouth */}
          <path d="M29 56h22" />
        </g>
      );
    case "stressed":
      return (
        <g stroke={accent} strokeWidth="2.6" strokeLinecap="round" fill="none">
          {/* furrowed brows */}
          <path d="M20 38l12 4" />
          <path d="M60 38l-12 4" />
          <circle cx="28" cy="44" r="2.6" fill={accent} stroke="none" />
          <circle cx="52" cy="44" r="2.6" fill={accent} stroke="none" />
          {/* flat, tense mouth */}
          <path d="M28 57c6-3 18-3 24 0" />
          {/* single sweat drop */}
          <path d="M62 30c2 3 2 6-1 6s-3-3-1-6z" fill={accent} stroke="none" />
        </g>
      );
    case "overwhelmed":
      return (
        <g stroke={accent} strokeWidth="2.8" strokeLinecap="round" fill="none">
          {/* steep, alarmed brows */}
          <path d="M18 33l14 8" />
          <path d="M62 33l-14 8" />
          {/* wide eyes */}
          <circle cx="27" cy="45" r="4.4" fill="none" />
          <circle cx="27" cy="45" r="1.8" fill={accent} stroke="none" />
          <circle cx="53" cy="45" r="4.4" fill="none" />
          <circle cx="53" cy="45" r="1.8" fill={accent} stroke="none" />
          {/* wavering, overwhelmed mouth */}
          <path d="M27 58c3-4 6 4 9 0s6-4 9 0s6-4 9 0" />
          {/* multiple sweat drops */}
          <path d="M64 28c2 3 2 6-1 6s-3-3-1-6z" fill={accent} stroke="none" />
          <path d="M14 36c2 3 2 5-1 5s-3-2-1-5z" fill={accent} stroke="none" />
        </g>
      );
  }
}

export function MoodAvatar({ pct, size = 56 }: { pct: number; size?: number }) {
  const mood = moodForPct(pct);
  const c = MOOD_COLORS[mood];
  return (
    <div
      className={`mood-avatar mood-avatar--${mood}`}
      style={{ width: size, height: size }}
      title={`${MOOD_LABEL[mood]} · ${pct}% allocated`}
    >
      <svg viewBox="0 0 80 80" width="100%" height="100%" aria-hidden>
        <circle cx="40" cy="40" r="38" fill={c.skin} />
        <circle cx="40" cy="40" r="38" fill="none" stroke={c.ring} strokeWidth="2" opacity="0.5" />
        <Face mood={mood} accent={c.accent} />
      </svg>
    </div>
  );
}
