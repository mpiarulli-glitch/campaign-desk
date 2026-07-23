import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await getSession();
  if (session?.role === "admin") {
    redirect("/admin");
  }
  if (session?.role === "forecast") {
    redirect(`/admin/forecast/${session.person}`);
  }
  redirect("/login");
}
