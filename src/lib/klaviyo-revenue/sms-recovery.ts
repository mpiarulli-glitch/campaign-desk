import {
  SMS_ABANDON_GAP_MS,
  SMS_RECOVERY_WINDOW_MS,
  type DailyPoint,
  type TimelineEvent,
} from "./types";
import { dateKeyInZone } from "./window";

export type SmsRecoveryCompute = {
  formFills: number;
  directBookings: number;
  /** Fills that never became a direct booking or a recovery. */
  abandoned: number;
  recovered: number;
  /** recovered / (abandoned + recovered). Null when nobody missed a direct booking. */
  recoveryRate: number | null;
  attributedValue: number;
  series: DailyPoint[];
  /** Recovered bookings that landed after the selected window. */
  tailRecoveries: number;
};

function rate(recovered: number, abandoned: number): number | null {
  const denom = recovered + abandoned;
  if (denom <= 0) return null;
  return recovered / denom;
}

function kindOrder(kind: TimelineEvent["kind"]): number {
  if (kind === "form") return 0;
  if (kind === "sms") return 1;
  return 2;
}

/**
 * Attribute abandoned-booking SMS recoveries from profile timelines.
 *
 * Per profile, in time order:
 * - Each in-window form opens an opportunity. A newer form closes the previous
 *   one as abandoned (superseded) so one person cannot be recovered twice for
 *   the same booking.
 * - A booking before any text, or inside 15 minutes of the form, is direct.
 * - A booking after a text, within 7 days of that text, and outside the
 *   15-minute session, is recovered. Its event value is the attributed value.
 * - A text after the booking (confirmation) is ignored because the opportunity
 *   is already closed.
 * - Forms outside [startMs, endMs) do not count. Texts and bookings after
 *   endMs still close an in-window form, so a fill on the last day can recover.
 */
export function attributeSmsRecoveries(
  events: TimelineEvent[],
  range: { startMs: number; endMs: number; timeZone: string },
  opts?: { recoveryWindowMs?: number; abandonGapMs?: number }
): SmsRecoveryCompute {
  const recoveryWindowMs = opts?.recoveryWindowMs ?? SMS_RECOVERY_WINDOW_MS;
  const abandonGapMs = opts?.abandonGapMs ?? SMS_ABANDON_GAP_MS;
  const byProfile = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    if (!event.profileId) continue;
    const list = byProfile.get(event.profileId);
    if (list) list.push(event);
    else byProfile.set(event.profileId, [event]);
  }

  let formFills = 0;
  let directBookings = 0;
  let abandoned = 0;
  let recovered = 0;
  let attributedValue = 0;
  let tailRecoveries = 0;
  const byDay = new Map<string, DailyPoint>();

  for (const list of byProfile.values()) {
    list.sort((a, b) => a.at - b.at || kindOrder(a.kind) - kindOrder(b.kind));
    let open: { formAt: number; smsAt: number | null } | null = null;

    const closeAbandoned = () => {
      abandoned += 1;
      open = null;
    };

    for (const event of list) {
      if (event.kind === "form") {
        if (event.at < range.startMs || event.at >= range.endMs) continue;
        if (open) closeAbandoned();
        formFills += 1;
        open = { formAt: event.at, smsAt: null };
        continue;
      }
      if (!open) continue;
      if (event.at <= open.formAt) continue;

      if (event.kind === "sms") {
        if (open.smsAt == null) open.smsAt = event.at;
        continue;
      }

      const sinceForm = event.at - open.formAt;
      const smsAt = open.smsAt;
      const afterSms = smsAt != null && event.at > smsAt;
      const withinRecovery = smsAt != null && event.at - smsAt <= recoveryWindowMs;
      const sameSession = sinceForm < abandonGapMs;

      if (afterSms && withinRecovery && !sameSession) {
        recovered += 1;
        const value = typeof event.value === "number" && Number.isFinite(event.value) ? event.value : 0;
        attributedValue += value;
        if (event.at >= range.endMs) {
          tailRecoveries += 1;
        } else {
          const date = dateKeyInZone(event.at, range.timeZone);
          const row = byDay.get(date) ?? { date, count: 0, sumValue: 0 };
          row.count += 1;
          row.sumValue += value;
          byDay.set(date, row);
        }
      } else if (!afterSms || sameSession) {
        directBookings += 1;
      } else {
        abandoned += 1;
      }
      open = null;
    }
    if (open) closeAbandoned();
  }

  return {
    formFills,
    directBookings,
    abandoned,
    recovered,
    recoveryRate: rate(recovered, abandoned),
    attributedValue,
    series: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tailRecoveries,
  };
}
