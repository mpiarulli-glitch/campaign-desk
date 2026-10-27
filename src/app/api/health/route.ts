import { NextResponse } from "next/server";

// Railway hits this within 30 seconds of container start and marks the deploy
// failed if it gets no answer. Do not open the database here. The first
// getDb() applies the schema synchronously, and startup repairs used to run
// on that same call, before Next was listening.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
