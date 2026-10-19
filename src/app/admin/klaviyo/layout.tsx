import { requirePage } from "@/lib/page-gate";
import "./revenue.css";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePage("page.klaviyo");
  return children;
}
