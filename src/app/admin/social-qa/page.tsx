import { redirect } from "next/navigation";

// Social QA is off the sidebar. A saved batch link still opens that batch.
export default function SocialQaPage() {
  redirect("/admin/hub");
}
