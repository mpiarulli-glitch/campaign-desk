import { redirect } from "next/navigation";
import { isAdsDashboardAuthenticated } from "@/lib/auth";

export default async function AdsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdsDashboardAuthenticated())) {
    redirect("/admin");
  }
  return children;
}
