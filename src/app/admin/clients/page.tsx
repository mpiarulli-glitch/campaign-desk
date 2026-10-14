import { redirect } from "next/navigation";

// The All clients roster is retired from the sidebar. Client hubs still live
// under /admin/clients/[id]; the list itself sends people to Lifecycle.
export default function AllClientsPage() {
  redirect("/admin/lifecycle");
}
