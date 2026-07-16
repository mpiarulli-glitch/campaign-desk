import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { listRevClients } from "@/lib/revenue";
import { computeCycleStatus, findSendForWindow, nextWindow, todayYmd } from "@/lib/cadence";
import { getReminder } from "@/lib/reminders";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = todayYmd();
  const clients = listRevClients(true).map((client) => {
    const window = nextWindow(client, today);
    const status = computeCycleStatus(client, window, today);
    const existingSend = window ? findSendForWindow(client.id, window.start) : null;
    const reminder = window ? getReminder(client.id, window.start) : null;
    return {
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        color_week: client.color_week,
        production_cadence: client.production_cadence,
        last_production_date: client.last_production_date,
        schedule_token: client.schedule_token,
        contact_email: client.contact_email,
      },
      window,
      status,
      existingSend: existingSend
        ? { sendDate: existingSend.send_date, status: existingSend.status }
        : null,
      reminder: reminder
        ? { lastSent: reminder.last_sent, count: reminder.count }
        : null,
    };
  });
  return NextResponse.json({ clients, today });
}
