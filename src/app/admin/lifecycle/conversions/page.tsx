import Link from "next/link";
import { ConversionLogPanel } from "@/components/lifecycle/ConversionLogPanel";

export default function LifecycleConversionsPage() {
  return (
    <div className="lh-page">
      <header className="lh-page-bar">
        <div>
          <p className="lh-kicker">
            <Link href="/admin/lifecycle">Lifecycle</Link>
            {" / Conversion log"}
          </p>
          <h1>Conversion log</h1>
          <p className="muted">
            Email-attributed bookings and form fills across every account.
          </p>
        </div>
        <div className="lh-page-bar-right">
          <Link href="/admin/lifecycle" className="btn btn-ghost">
            Back to clients
          </Link>
        </div>
      </header>

      <div className="hud">
        <div className="hud-page">
          <ConversionLogPanel />
        </div>
      </div>
    </div>
  );
}
