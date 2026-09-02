import { requireOwnerPage } from "@/lib/page-gate";

// Not grantable, and deliberately so: anyone who can edit the access matrix can
// grant themselves everything else in it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return children;
}
