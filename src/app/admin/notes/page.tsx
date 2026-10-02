import { redirect } from "next/navigation";
import { NotesDesk } from "@/components/NotesDesk";
import { getSession, sessionUserSlug } from "@/lib/auth";

// Personal notebook. Every signed-in person has one. sessionUserSlug is null
// while impersonating, and the desk stays closed rather than opening the
// person being viewed.
export default async function NotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const slug = await sessionUserSlug();
  return <NotesDesk locked={!slug} />;
}
