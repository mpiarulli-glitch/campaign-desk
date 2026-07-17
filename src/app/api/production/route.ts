import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { listRevClients } from "@/lib/revenue";
import { computeCycleStatus, findSendForWindow, nextWindow, todayYmd } from "@/lib/cadence";
import { getReminder, getLatestReminder } from "@/lib/reminders";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = todayYmd();
  const clients = listRevClients(true).map((client) => {
    const window = nextWindow(client, today);
    const status = computeCycleStatus(client, window, today);
    const existingSend = window ? findSendForWindow(client.id, window.start) : null;
    const currentReminder = window ? getReminder(client.id, window.start) : null;
    const latestReminder = getLatestReminder(client.id);
    return {
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        contact_name: client.contact_name,
        contact_email: client.contact_email,
        color_week: client.color_week,
        production_cadence: client.production_cadence,
        last_production_date: client.last_production_date,
        schedule_token: client.schedule_token,
        production_enrolled: client.production_enrolled,
      },
      window,
      status,
      existingSend: existingSend
        ? { sendDate: existingSend.send_date, status: existingSend.status }
        : null,
      // Reminder emails: count on the current window, plus the most recent
      // send date and which window it was for (mirrors the tracker sheet).
      currentReminderCount: currentReminder?.count || 0,
      lastEmailSent: latestReminder?.last_sent || null,
      lastWindowEmailed: latestReminder?.window_start || null,
    };
  });
  return NextResponse.json({ clients, today });
}
