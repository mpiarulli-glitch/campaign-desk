"use client";

type Props = {
  hasB: boolean;
  variant: "a" | "b";
  onChange: (variant: "a" | "b") => void;
  hypothesis?: string;
};

export function AbVariantBar({ hasB, variant, onChange, hypothesis }: Props) {
  if (!hasB) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className={`tab ${variant === "a" ? "active" : ""}`}
          onClick={() => onChange("a")}
        >
          Version A
        </button>
        <button
          type="button"
          className={`tab ${variant === "b" ? "active" : ""}`}
          onClick={() => onChange("b")}
        >
          Version B
        </button>
      </div>
      {hypothesis?.trim() ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <strong>Hypothesis:</strong> {hypothesis.trim()}
        </p>
      ) : null}
    </div>
  );
}
