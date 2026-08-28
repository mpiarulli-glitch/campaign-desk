import { redirect } from "next/navigation";
import { isOwnerToolsAuthenticated } from "@/lib/auth";

export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isOwnerToolsAuthenticated())) {
    redirect("/admin");
  }
  return children;
}
