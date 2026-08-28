"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SnapshotBackfillGrid } from "@/components/SnapshotBackfillGrid";

export default function SnapshotBackfillPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="ops-page snap-desk snap-backfill-page">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/client-services">
          All accounts
        </Link>
        <Link className="btn btn-secondary btn-sm" href={`/admin/snapshot/${id}`}>
          This week
        </Link>
      </div>

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Account snapshot · Backfill</p>
          <h1 className="ops-title">6-month progress grid</h1>
          <p className="ops-sub">
            Update status, work done, and notes across the last ~26 weeks from one page.
            Click a cell to edit; changes save immediately via the same entry API as the
            weekly fill desk.
          </p>
        </div>
      </div>

      <SnapshotBackfillGrid clientId={id} />
    </div>
  );
}
