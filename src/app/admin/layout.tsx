import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { sessionUserSlug } from "@/lib/auth";
import { setupStateFor } from "@/lib/setup";

// App-wide chrome for every internal page: persistent left sidebar + top bar
// (search, notifications, profile). Individual pages render only their content.
//
// This is also where account setup is enforced. Every internal page lives under
// /admin, so one check here covers the app, and the setup pages themselves sit
// outside it and stay reachable. sessionUserSlug is null while impersonating,
// which is deliberate: an admin looking at somebody else's view is not the
// person who has to connect that account's Basecamp.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await sessionUserSlug();
  if (slug && setupStateFor(slug)?.complete === false) {
    redirect("/account/setup");
  }
  return <AppShell>{children}</AppShell>;
}
