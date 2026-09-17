"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SnapshotBackfillGrid } from "@/components/SnapshotBackfillGrid";

export default function SnapshotBackfillPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="ops-page snap-desk snap-backfill-page">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/desk">
          All snapshots
        </Link>
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/instructions">
          How to fill
        </Link>
        <Link className="btn btn-secondary btn-sm" href={`/admin/snapshot/${id}`}>
          This week
        </Link>
      </div>

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Account snapshot · History</p>
          <h1 className="ops-title">Past six months</h1>
          <p className="ops-sub">
            One row per deliverable, one column per month. Click Empty to mark
            that week or month done. Click Done to change it or add a note.
          </p>
        </div>
      </div>

      <SnapshotBackfillGrid clientId={id} />
    </div>
  );
}
