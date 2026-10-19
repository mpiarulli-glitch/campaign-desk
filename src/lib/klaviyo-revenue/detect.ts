import type { CatalogMetric, MetricChoice, MetricDetection } from "./types";

const BOOKING_NOISE =
  /\b(remind(?:er)?|cancel(?:led|ed|lation)?|no[-\s]?show|reschedul\w*|received|clicked|opened|bounced|unsubscrib\w*|failed|sent)\b/i;

function choice(metric: CatalogMetric, score: number): MetricChoice {
  return { id: metric.id, name: metric.name.trim(), score };
}

export function scoreBookingMetric(name: string): number {
  const n = name.trim();
  if (!n || BOOKING_NOISE.test(n)) return 0;
  if (/^booked appointments?$/i.test(n)) return 100;
  if (/^appointment booked$/i.test(n)) return 96;
  if (/\b(appointment|reservation|session|consult)\b/i.test(n) && /\b(booked|scheduled|confirmed)\b/i.test(n)) {
    return 90;
  }
  if (/\bbooked\b/i.test(n) && /\b(appoint\w*|session|consult|reserv\w*)\b/i.test(n)) return 88;
  if (/^appointments?$/i.test(n)) return 70;
  if (/\b(schedule confirmed|booking confirmed|class booked)\b/i.test(n)) return 64;
  if (/\bbook(?:ed|ing)\b/i.test(n)) return 40;
  if (/\bappointments?\b/i.test(n)) return 35;
  if (/\breservations?\b/i.test(n)) return 35;
  if (/\bschedul(?:e|ed|ing)\b/i.test(n)) return 30;
  return 0;
}

export function scoreFormMetric(name: string): number {
  const n = name.trim().toLowerCase();
  if (n === "submitted form") return 100;
  if (n === "form submitted by profile") return 90;
  if (n === "filled out form") return 80;
  if (n === "form submit") return 75;
  if (/\bform\b/.test(n) && /\b(submit\w*|filled)\b/.test(n)) return 50;
  return 0;
}

export function scoreConversionMetric(name: string): number {
  const n = name.trim();
  if (/^placed order$/i.test(n)) return 100;
  if (/^ordered product$/i.test(n)) return 15;
  if (/^fulfilled order$/i.test(n)) return 30;
  if (/^cancelled order$/i.test(n) || /^refunded order$/i.test(n)) return 0;
  if (/^started checkout$/i.test(n) || /^checkout started$/i.test(n)) return 0;
  if (/\brevenue\b/i.test(n) && !/view/i.test(n)) return 45;
  return 0;
}

export function scoreSmsMetric(name: string): number {
  const n = name.trim();
  if (!/\b(sms|text message|text)\b/i.test(n)) return 0;
  if (/\b(clicked|received|sent)\b/i.test(n) && /\bemail\b/i.test(n) && !/\bsms\b/i.test(n)) {
    return 0;
  }
  if (/^received sms$/i.test(n)) return 100;
  if (/^received text message$/i.test(n)) return 96;
  if (/\breceived\b/i.test(n) && /\b(sms|text)\b/i.test(n)) return 90;
  if (/^clicked sms$/i.test(n) || /^clicked text message$/i.test(n)) return 55;
  if (/\bclicked\b/i.test(n) && /\b(sms|text)\b/i.test(n)) return 45;
  if (/\bsent\b/i.test(n) && /\b(sms|text)\b/i.test(n)) return 8;
  return 0;
}

function best(metrics: CatalogMetric[], score: (name: string) => number, floor: number): MetricChoice | null {
  const ranked = rank(metrics, score);
  return ranked[0] && ranked[0].score >= floor ? ranked[0] : null;
}

function rank(metrics: CatalogMetric[], score: (name: string) => number): MetricChoice[] {
  return metrics
    .map((metric) => choice(metric, score(metric.name)))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Pick the metrics that should drive the dashboard.
 * Booking and SMS only auto-select when the name is specific enough that a
 * store full of "Clicked Email" rows will not be mistaken for an appointment.
 * Form picks a single metric so two Klaviyo form events are not double counted.
 */
export function detectMetrics(metrics: CatalogMetric[]): MetricDetection {
  const bookingSuggestions = rank(metrics, scoreBookingMetric).filter((row) => row.score >= 30);
  const formSuggestions = rank(metrics, scoreFormMetric);
  const smsSuggestions = rank(metrics, scoreSmsMetric).filter((row) => row.score >= 40);
  return {
    booking: best(metrics, scoreBookingMetric, 60),
    bookingSuggestions,
    form: best(metrics, scoreFormMetric, 50),
    formSuggestions,
    conversion: best(metrics, scoreConversionMetric, 80),
    sms: best(metrics, scoreSmsMetric, 40),
    smsSuggestions,
  };
}
