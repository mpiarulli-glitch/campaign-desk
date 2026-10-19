import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  describeProductionSmsLocations,
  formatSampleLog,
  plainSmsFailure,
  sampleHttpStatus,
  scheduleSmsEnabled,
  sendSampleScheduleSms,
  type ScheduleSmsResult,
} from "@/lib/production-sms";

// Constant-time compare so the secret can't be probed by timing.
function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = createHmac("sha256", expected).update(provided).digest();
  const b = createHmac("sha256", expected).update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

/**
 * Read-only look at which GoHighLevel locations look like the agency's own
 * sub-account, and whether each has an SMS-capable number. Does not send.
 */
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await describeProductionSmsLocations();
  return NextResponse.json({
    ...report,
    clientSendsEnabled: scheduleSmsEnabled(),
  });
}

/**
 * One sample scheduling text to a phone typed by hand. Does not look up a
 * client, and does not require PRODUCTION_SMS_ENABLED. Client sends stay off
 * until that switch is 1.
 */
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? body.phone : "";
  const contactName =
    typeof body.contactName === "string" ? body.contactName : "";
  const email = typeof body.email === "string" ? body.email : "";
  const includeLink = body.includeLink !== false;
  if (!phone.trim()) {
    const missing = {
      status: "skipped" as const,
      reason: "invalid_phone" as const,
    };
    console.log(formatSampleLog(missing));
    return NextResponse.json(
      { ...missing, error: "phone is required", plain: plainSmsFailure(missing) },
      { status: 400 }
    );
  }
  const result = await sendSampleScheduleSms({
    phone,
    contactName,
    email,
    includeLink,
  });
  console.log(formatSampleLog(result));
  return NextResponse.json(
    {
      ...result,
      clientSendsEnabled: scheduleSmsEnabled(),
      error: sampleError(result),
      plain: plainSmsFailure(result),
    },
    { status: sampleHttpStatus(result) }
  );
}

function sampleError(result: ScheduleSmsResult): string | undefined {
  if (result.status === "sent") return undefined;
  if (result.status === "failed") return result.error;
  if (result.reason === "no_location") {
    return "PRODUCTION_SMS_LOCATION_ID is not set. This sample did not text anyone. Client texts stay off until PRODUCTION_SMS_ENABLED=1.";
  }
  if (result.reason === "invalid_phone") {
    return "Enter a phone number with an area code.";
  }
  return "Text was not sent.";
}
