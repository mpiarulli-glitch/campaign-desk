import { redirect } from "next/navigation";

// The company-wide fill desk is the primary snapshot surface.
export default function SnapshotAccountsPage() {
  redirect("/admin/snapshot/desk");
}
