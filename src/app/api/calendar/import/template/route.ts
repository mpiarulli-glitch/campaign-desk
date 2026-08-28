import { isOwnerToolsAuthenticated } from "@/lib/auth";
import { csvTemplate } from "@/lib/calendar-import";

// The starter sheet, so somebody building a calendar from scratch starts with
// columns the importer already understands rather than guessing at them.
export async function GET() {
  if (!(await isOwnerToolsAuthenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }
  return new Response(csvTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="editorial-calendar-template.csv"',
    },
  });
}
