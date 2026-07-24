import { redirect } from "next/navigation";

// Team chat moved into the MEG Team Hub. Keep this path working for old links.
export default function LegacyChatRedirect() {
  redirect("/admin/hub");
}
