import { redirect } from "next/navigation";

// Reports is off the sidebar. The address sends people home.
export default function ReportsPage() {
  redirect("/admin/hub");
}
