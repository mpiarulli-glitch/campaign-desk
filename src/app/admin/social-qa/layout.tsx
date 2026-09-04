import { requirePage } from "@/lib/page-gate";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePage("page.social_qa");
  return children;
}
