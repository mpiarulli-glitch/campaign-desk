import { NextResponse } from "next/server";
import { can, isOwner } from "@/lib/auth";

export async function klaviyoViewer(): Promise<NextResponse | null> {
  if (!(await can("page.klaviyo"))) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  return null;
}

export async function klaviyoOwner(): Promise<NextResponse | null> {
  const denied = await klaviyoViewer();
  if (denied) return denied;
  if (!(await isOwner())) {
    return NextResponse.json(
      { error: "Only the owner can change Klaviyo accounts." },
      { status: 403 }
    );
  }
  return null;
}
