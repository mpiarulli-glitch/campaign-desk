import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import { getOrCreateDashboardToken } from "@/lib/dashboard";

// Sunset 2026-07-31. The internal client portal (Overview, Flags, Strategy,
// Roadmap, To-dos, Messages, Production, Calendar, Goals) is retired. Clicking a
// client now lands on that client's own dashboard, so the team sees exactly what
// the client sees and there is one version of the truth.
//
// The old page is in git history. The panels it hosted still have their APIs
// (/api/clients/[id]/flags, /strategy, /api/todos), so bringing any of them back
// is a UI job, not a rebuild.
export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Admin only, matching the access the internal portal had before it was
  // retired. Do not loosen this: the page it redirects to is the client's own
  // dashboard link.
  if (!(await isAdminAuthenticated())) {
    redirect("/login");
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    redirect("/admin/clients");
  }

  // Reuse the client's existing link, minting one only if they've never had
  // one, so opening a client here never produces a different link from the one
  // they were already sent.
  const token = getOrCreateDashboardToken(id);
  if (!token) {
    redirect("/admin/clients");
  }
  redirect(`/dashboard/${token}`);
}
