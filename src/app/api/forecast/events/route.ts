import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { eventHours, lastEventSyncAt, listEventsForDay } from "@/lib/basecamp-events";
import { isValidPerson, personLabel } from "@/lib/forecast";
import { isoToStartTime } from "@/lib/forecast-time";
import { APP_TIME_ZONE } from "@/lib/cadence";
import type { BasecampEvent } from "@/lib/db";

// Basecamp schedule entries for one day, so someone can book a meeting into
// their forecast without inventing a todo for it.
//
// Reads the local basecamp_events cache rather than calling Basecamp, so it
// answers instantly. Like the todo picker, every empty case answers 200 with a
// `reason` instead of an error: the form always has a manual fallback and only
// needs to explain why there is nothing to pick.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function timeLabel(event: BasecampEvent): string {
  if (event.all_day) return "All day";
  const d = new Date(event.starts_at);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function shape(event: BasecampEvent) {
  return {
    id: event.id,
    title: event.title,
    clientId: event.client_id,
    clientName: event.client_name,
    projectName: event.project_name,
    projectId: event.project_id,
    allDay: Boolean(event.all_day),
    time: timeLabel(event),
    startTime: event.all_day ? "" : isoToStartTime(event.starts_at, APP_TIME_ZONE),
    hours: eventHours(event),
    participants: event.participants,
    appUrl: event.app_url,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";
  const date = url.searchParams.get("date") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  // No sync has ever run, so an empty list means "unknown", not "no meetings".
  if (!lastEventSyncAt()) {
    return NextResponse.json({ mine: [], others: [], reason: "never-synced" });
  }

  const { mine, others } = listEventsForDay(date, [personLabel(person), person]);
  return NextResponse.json({
    mine: mine.map(shape),
    others: others.map(shape),
    reason: mine.length || others.length ? null : "no-events",
  });
}
