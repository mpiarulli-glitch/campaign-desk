import { NextResponse } from "next/server";
import { isOwner, sessionActor } from "@/lib/auth";
import {
  CAMPAIGN_KIND_CHOICES,
  FORECAST_ALL,
  campaignKindStored,
  clearCampaignKind,
  clearForecastSubjects,
  clearOverrides,
  effectiveCampaignKind,
  forecastRoster,
  forecastSubjectsFor,
  forecastVisibility,
  isGrantable,
  manageableAccounts,
  resolveAll,
  setCampaignKind,
  setForecastSubjects,
  setOverride,
  subjectFor,
  type CampaignKindChoice,
} from "@/lib/access";
import { campaignKindFor } from "@/lib/people";
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
  const kindStored = campaignKindStored(slug);
  const kindEffective = effectiveCampaignKind(who);
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
    campaigns: {
      // null = still on the TEAM_FOCUS default (blog for SEO, all otherwise).
      stored: kindStored,
      // What the list actually filters to right now. null means every kind.
      effective: kindEffective,
      // Role default, so the Default button can say what it would do.
      byDefault: campaignKindFor(slug),
      choices: CAMPAIGN_KIND_CHOICES,
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

      case "set_campaign_kind": {
        const kind = body.kind;
        if (kind === null) {
          clearCampaignKind(person);
        } else if (
          kind === "all" ||
          kind === "blog" ||
          kind === "interactive"
        ) {
          setCampaignKind(person, kind as CampaignKindChoice, by);
        } else {
          return NextResponse.json(
            { error: "Pick All, Blog posts, or Forms / quizzes." },
            { status: 400 }
          );
        }
        break;
      }

      case "reset": {
        clearOverrides(person);
        clearForecastSubjects(person);
        clearCampaignKind(person);
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
