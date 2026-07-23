"use client";

import { Brand } from "@/components/Brand";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="login-wrap">
      <div className="card login-card stack" style={{ gap: 16 }}>
        <Brand />
        <div>
          <h1>Something went wrong</h1>
          <p className="muted">
            That page hit an unexpected error. Try again, or head back to the
            dashboard.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => reset()}>Try again</button>
          <a className="btn btn-secondary" href="/admin">Back to dashboard</a>
        </div>
      </div>
    </div>
  );
}
