import { redirect } from "next/navigation";

// Account snapshots moved into the Client Services Hub as its second tab.
// Kept as a redirect because this path is in muscle memory and in old links.
export default function SnapshotAccountsPage() {
  redirect("/admin/client-services");
}
