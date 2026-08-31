import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated } from "@/lib/auth";
import {
  BOARD_COLUMNS,
  currentPeriod,
  isValidPeriod,
  listBoardCards,
} from "@/lib/lifecycle-board";
import { addClientToHub } from "@/lib/lifecycle-hub";
import { isEmailPlatform, isYmd } from "@/lib/email-launch";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const requested = new URL(request.url).searchParams.get("period") || "";
  const period = isValidPeriod(requested) ? requested : currentPeriod();
  return NextResponse.json({
    period,
    columns: BOARD_COLUMNS,
    cards: listBoardCards(period),
  });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const mode = body.mode === "automations" ? "automations" : "launch";
  const launchDate = typeof body.launchDate === "string" ? body.launchDate : "";
  const platform = isEmailPlatform(body.platform) ? body.platform : null;
  const period = isValidPeriod(body.period) ? body.period : currentPeriod();
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  if (mode === "launch") {
    if (!isYmd(launchDate)) {
      return NextResponse.json({ error: "Pick a launch date." }, { status: 400 });
    }
    if (!platform) {
      return NextResponse.json({ error: "Pick a platform." }, { status: 400 });
    }
  }
  const session = await getSession();
  const result = addClientToHub(
    clientId,
    mode === "automations" ? null : launchDate,
    session?.person || "michael",
    period,
    mode === "automations" ? null : platform
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "Unknown client." ? 404 : 400 });
  }
  return NextResponse.json({ period, cards: listBoardCards(period) });
}
