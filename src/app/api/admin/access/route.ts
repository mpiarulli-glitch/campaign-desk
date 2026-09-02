import { NextResponse } from "next/server";
import { isOwner, sessionActor } from "@/lib/auth";
import {
  FORECAST_ALL,
  clearForecastSubjects,
  clearOverrides,
  forecastRoster,
  forecastSubjectsFor,
  forecastVisibility,
  isGrantable,
  manageableAccounts,
  resolveAll,
  setForecastSubjects,
  setOverride,
  subjectFor,
} from "@/lib/access";
import { getUser } from "@/lib/users";

// Owner only, for the same reason /api/users is: anyone who can edit the access
// matrix can grant themselves the rest of the app.
async function requireOwner() {
  return (await isOwner())
    ? null
    : NextResponse.json({ error: "Owner access required" }, { status: 403 });
}

function payloadFor(slug: string) {
  const who = subjectFor(slug);
  const stored = forecastSubjectsFor(slug);
  const visible = forecastVisibility(who);
  return {
    person: slug,
    role: who.role,
    capabilities: resolveAll(who),
    forecast: {
      // null means no rows, i.e. still following the role default. The UI shows
      // that as "Default" rather than as an empty selection, so the owner can
      // tell "never decided" from "deliberately nobody".
      stored,
      everyone: visible === FORECAST_ALL,
      subjects: visible === FORECAST_ALL ? [] : visible,
    },
  };
}

export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const accounts = manageableAccounts().map((a) => {
    const user = getUser(a.slug);
    return {
      ...a,
      active: user ? Boolean(user.active) : false,
      // Surfaced so the owner is not tuning permissions for somebody who has
      // never signed in and may not need an account at all.
      lastLoginAt: user?.last_login_at || null,
    };
  });

  const person = new URL(request.url).searchParams.get("person");
  if (!person) {
    return NextResponse.json({ accounts, roster: forecastRoster() });
  }
  if (!accounts.some((a) => a.slug === person)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }
  return NextResponse.json({
    accounts,
    roster: forecastRoster(),
    ...payloadFor(person),
  });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const person = typeof body.person === "string" ? body.person : "";
  const by = await sessionActor();

  if (!manageableAccounts().some((a) => a.slug === person)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }

  try {
    switch (action) {
      case "set": {
        const capability = typeof body.capability === "string" ? body.capability : "";
        if (!isGrantable(capability)) {
          return NextResponse.json(
            { error: "That is not something you can toggle." },
            { status: 400 }
          );
        }
        // Three states, not two: true and false pin the answer, null drops the
        // row so the person follows their role default again.
        const allowed =
          body.allowed === null ? null : body.allowed === true ? true : false;
        setOverride(person, capability, allowed, by);
        break;
      }

      case "set_forecast": {
        const subjects: string[] = Array.isArray(body.subjects)
          ? body.subjects.filter((s: unknown) => typeof s === "string")
          : [];
        if (body.everyone === true) {
          setForecastSubjects(person, [FORECAST_ALL], by);
        } else {
          setForecastSubjects(person, subjects, by);
        }
        break;
      }

      case "reset_forecast":
        clearForecastSubjects(person);
        break;

      case "reset": {
        clearOverrides(person);
        clearForecastSubjects(person);
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That did not work." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, ...payloadFor(person) });
}
