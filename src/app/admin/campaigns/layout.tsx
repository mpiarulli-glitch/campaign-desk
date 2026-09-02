import { requirePage } from "@/lib/page-gate";

// Covers this page and everything nested under it. See src/lib/page-gate.ts for
// why a refusal goes to Home rather than to the login page.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePage("page.campaigns");
  return children;
}
