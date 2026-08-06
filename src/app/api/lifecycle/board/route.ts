import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  addBoardCard,
  BOARD_COLUMNS,
  currentPeriod,
  isValidPeriod,
  listBoardCards,
} from "@/lib/lifecycle-board";

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
  const period = isValidPeriod(body.period) ? body.period : currentPeriod();
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  const ok = addBoardCard(clientId, period);
  if (!ok) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  return NextResponse.json({ period, cards: listBoardCards(period) });
}
