import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { addBoardItem } from "@/lib/lifecycle-board";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  const label = typeof body.label === "string" ? body.label : "";
  if (!cardId || !label.trim()) {
    return NextResponse.json({ error: "Add a label for the deliverable." }, { status: 400 });
  }
  const item = addBoardItem(cardId, label);
  if (!item) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  return NextResponse.json({ item });
}
