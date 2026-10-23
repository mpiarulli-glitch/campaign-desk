import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { appDateTime } from "@/lib/cadence";
import { getSend } from "@/lib/calendar";
import { getRevClient } from "@/lib/revenue";
import {
  SCHEDULE_UNREACHABLE_ADMIN,
  readVideographerBlocks,
} from "@/lib/production-schedule-sync";
import { isRealDate } from "@/lib/scheduling-rules";

// Times the assigned videographer cannot take on one day, from the Basecamp
// production schedule. The log and edit forms use this to stop offering those
// starts. A failed read comes back with every slot blocked.

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const clientId = (url.searchParams.get("clientId") || "").trim();
  const excludeSendId = (url.searchParams.get("excludeSendId") || "").trim();
  if (!isRealDate(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const client = clientId ? getRevClient(clientId) : null;
  const exclude = excludeSendId ? getSend(excludeSendId) : null;
  if (date < appDateTime().date) {
    return NextResponse.json({
      blockedHalfSlots: [] as string[],
      blockedFullDays: [] as string[],
      message: null,
    });
  }
  const read = await readVideographerBlocks({
    videographerId: client?.videographer_id || "",
    dates: [date],
    excludeEntryId: exclude?.basecamp_schedule_entry_id || "",
  });
  const half = read.blocks.blockedHalfSlots
    .filter((slot) => slot.startsWith(`${date}|`))
    .map((slot) => slot.slice(date.length + 1));
  return NextResponse.json({
    blockedHalfSlots: half,
    fullDayBlocked: read.blocks.blockedFullDays.includes(date),
    message: read.ok ? null : SCHEDULE_UNREACHABLE_ADMIN,
  });
}
