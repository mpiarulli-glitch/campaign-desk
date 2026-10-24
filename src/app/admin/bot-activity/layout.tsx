import { requireOwnerPage } from "@/lib/page-gate";

// Owner only. A named admin, a forecast user, an account manager, or a
// signed-out visitor is sent away before this page renders. See page-gate.ts.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return children;
}
