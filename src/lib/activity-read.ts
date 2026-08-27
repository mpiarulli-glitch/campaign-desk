// Client-side read/hidden state for the activity feed. Shared by the home
// sidebar and the top-bar bell so marking one as read updates the other.

export const ACTIVITY_READ_IDS_KEY = "cd_activity_read_ids";
export const ACTIVITY_HIDDEN_IDS_KEY = "cd_activity_hidden_ids";
const CHANGED_EVENT = "cd-activity-read";

export type ActivityFeedItem = {
  kind: "feedback" | "approved";
  id: string;
  campaign_id: string;
  campaign_title: string;
  client_name: string;
  actor: string | null;
  body: string | null;
  comment_type: "general" | "inline" | null;
  email_title: string | null;
  resolved: number | null;
  star_rating: number | null;
  attachment_count: number;
  approved_channel?: string | null;
  at: string;
};

export function activityItemKey(item: Pick<ActivityFeedItem, "kind" | "id">): string {
  return `${item.kind}-${item.id}`;
}

export function loadActivityIdSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveActivityIdSet(key: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function onActivityReadChange(handler: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (
      event.key === ACTIVITY_READ_IDS_KEY ||
      event.key === ACTIVITY_HIDDEN_IDS_KEY
    ) {
      handler();
    }
  }
  window.addEventListener(CHANGED_EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}

export function relativeActivityTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
