import { NextResponse } from "next/server";
import { getSendByCrewToken } from "@/lib/calendar";
import { getRevClient } from "@/lib/revenue";
import { listVideographers } from "@/lib/videographers";

// The crew's read-only view of a production, opened from the Basecamp
// notification with no sign-in. Same trust model as the client scheduling and
// review links: possession of a random token, and nothing here is writable.
//
// Returns only what somebody needs to turn up and shoot. No client economics, no
// other productions, no way to reach another record from this one.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const send = getSendByCrewToken(token);
  if (!send || send.cancelled_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = send.client_id ? getRevClient(send.client_id) : null;
  const videographer = client?.videographer_id
    ? listVideographers(true).find((p) => p.id === client.videographer_id)
    : null;

  let brief: Record<string, string> = {};
  try {
    brief = send.production_brief
      ? (JSON.parse(send.production_brief) as Record<string, string>)
      : {};
  } catch {
    brief = {};
  }

  return NextResponse.json({
    production: {
      date: send.send_date,
      time: send.send_time,
      duration: send.duration,
      status: send.status,
      note: send.note,
    },
    client: {
      name: client?.name || send.client_name,
      accountManager: client?.account_manager || "",
    },
    videographer: videographer?.name || "",
    brief,
  });
}
