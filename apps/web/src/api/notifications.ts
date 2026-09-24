import { authHeader } from "./client";

export type InboxItemData = {
  type: string;
  case_ref?: string;
  inspection_ref?: string;
  notice_ref?: string;
  route?: string;
};

export type InboxItem = {
  id: string;
  project: string;
  type: string;
  case_ref: string | null;
  title: string | null;
  body: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
  data: InboxItemData;
};

export type InboxPage = {
  items: InboxItem[];
  next_cursor: string | null;
  unread_count: number;
};

export class NotifyUnavailableError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`notify ${status}`);
    this.name = "NotifyUnavailableError";
    this.status = status;
  }
}

const NOTIFY_BASE: string = String(import.meta.env.VITE_NOTIFY_URL ?? "/notify-api").replace(/\/+$/, "");

// Fetch that never logs out on 401: ada-notify being down or unconfigured is not a session end.
async function notifyFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${NOTIFY_BASE}${path}`, {
      ...init,
      headers: { ...(await authHeader()), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new NotifyUnavailableError(0);
  }
  if (!res.ok) throw new NotifyUnavailableError(res.status);
  return res;
}

// The newest page of this officer's ADA inbox.
export async function listNotifications(
  locale: "en" | "hi",
  signal?: AbortSignal,
  limit = 20,
): Promise<InboxPage> {
  const qs = new URLSearchParams({ limit: String(limit), project: "ada", locale });
  const res = await notifyFetch(`/v1/me/notifications?${qs.toString()}`, { signal });
  const page = (await res.json()) as Partial<InboxPage>;
  return {
    items: Array.isArray(page.items) ? page.items : [],
    next_cursor: page.next_cursor ?? null,
    unread_count: typeof page.unread_count === "number" ? page.unread_count : 0,
  };
}

// Idempotent on the server, so a repeat click is harmless.
export async function markNotificationRead(id: string): Promise<void> {
  await notifyFetch(`/v1/me/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}
