import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { forecastPickerForPerson, reconcileClients } from "@/lib/basecamp-clients";
import { isValidPerson } from "@/lib/forecast";

// Forecast add-task picker: clients and internal projects this person can
// open in Basecamp. GET is the initial load; POST also imports any new client
// projects (kept off the production schedule) then returns the same filtered
// list.
async function pickerResponse(person: string) {
  const picker = await forecastPickerForPerson(person);
  return NextResponse.json(picker);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }

  try {
    return await pickerResponse(person);
  } catch {
    return NextResponse.json({ clients: [], internals: [] });
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }

  try {
    const report = await reconcileClients({ createMissing: true });
    if (!report.projects) {
      return NextResponse.json({ error: "No Basecamp projects returned." }, { status: 502 });
    }
    const picker = await forecastPickerForPerson(person);
    return NextResponse.json({
      created: report.created,
      linked: report.linked,
      ...picker,
    });
  } catch {
    return NextResponse.json({ error: "Could not sync projects." }, { status: 502 });
  }
}
