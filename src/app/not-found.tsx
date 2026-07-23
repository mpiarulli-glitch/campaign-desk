import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card login-card stack" style={{ gap: 16 }}>
        <Brand />
        <div>
          <h1>Page not found</h1>
          <p className="muted">
            That link doesn&apos;t match anything here. It may have been moved,
            reset, or mistyped.
          </p>
        </div>
        <Link className="btn" href="/admin">Back to dashboard</Link>
      </div>
    </div>
  );
}
