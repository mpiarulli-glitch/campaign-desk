import { requirePage } from "@/lib/page-gate";

// Owner only by default. tool.accounts is grantable, so the owner can hand the
// invite-and-reset job to somebody without handing over the whole owner login.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePage("tool.accounts");
  return children;
}
