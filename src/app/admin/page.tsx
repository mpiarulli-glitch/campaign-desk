import { redirect } from "next/navigation";

// Home is the MEG Team Hub. Keep /admin working for old bookmarks and for
// page-gate refusals that still send people here.
export default function AdminHomePage() {
  redirect("/admin/hub");
}
