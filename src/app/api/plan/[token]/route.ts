import { NextResponse } from "next/server";
import { getClientByCalendarToken, listFeedback, planSends } from "@/lib/plan";

type Params = { params: Promise<{ token: string }> };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Public, read-only. The token is the access grant. Defaults to the next
// 90 days when no window is given.
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByCalendarToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const qStart = url.searchParams.get("start");
  const qEnd = url.searchParams.get("end");
  const start = qStart && YMD.test(qStart) ? qStart : todayYmd();
  const end = qEnd && YMD.test(qEnd) ? qEnd : plusDays(start, 90);

  return NextResponse.json({
    client: { name: client.name },
    start,
    end,
    approvedAt: client.calendar_approved_at,
    approvedBy: client.calendar_approved_by,
    sends: planSends(client.id, start, end),
    feedback: listFeedback(client.id),
  });
}
