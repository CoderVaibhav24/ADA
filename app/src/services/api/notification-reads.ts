import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import { NOTIFY_PATHS, NOTIFY_PROJECT, pushEnv } from '@/services/push/constants';
import { notifyRequest } from '@/services/push/registration';

import { authenticatedRequest } from './client';
import { queryClient } from './query-client';

/*
 * The surveyor's inbox in ada-notify: `GET /v1/me/notifications` and the read
 * receipt. ada-notify is not in the generated ada-api schema, so the two shapes
 * below are `InboxItem` and `InboxPage` in `backend/notify/app/schemas.py`.
 *
 * An item is a routing hint plus display text. Nothing in it is case data: a tap
 * opens the case, and the case screen reads the case from ada-api.
 */
export type InboxItem = {
  readonly id: string;
  readonly project: string;
  readonly type: string;
  readonly case_ref: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly read: boolean;
  readonly read_at: string | null;
  readonly created_at: string;
};

export type InboxPage = {
  readonly items: InboxItem[];
  readonly next_cursor: string | null;
  readonly unread_count: number;
};

export const INBOX_PAGE_SIZE = 20;

export const notificationKeys = {
  all: ['notify', 'inbox'] as const,
  list: ['notify', 'inbox', 'list'] as const,
};

// False in a build without `notifyBaseUrl`; the inbox then has nothing to call.
export const inboxConfigured = pushEnv.notifyBaseUrl !== null;

// One page of the inbox, newest first; `cursor` is the server's opaque `next_cursor`.
export function fetchInboxPage(cursor: string | null, signal?: AbortSignal): Promise<InboxPage> {
  return authenticatedRequest<InboxPage>(pushEnv.notifyBaseUrl ?? '', NOTIFY_PATHS.notifications, {
    query: { limit: INBOX_PAGE_SIZE, cursor, project: NOTIFY_PROJECT },
    signal,
  });
}

// The whole inbox as cursor pages. Home reads the first page; the Notifications screen scrolls on.
export function useInbox(): UseInfiniteQueryResult<InfiniteData<InboxPage, string | null>, Error> {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam, signal }) => fetchInboxPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: InboxPage) => last.next_cursor ?? undefined,
    enabled: inboxConfigured,
  });
}

// Flips one cached item to read and takes it off the unread count, until the refetch confirms.
function markReadInCache(id: string): void {
  queryClient.setQueryData<InfiniteData<InboxPage, string | null>>(notificationKeys.list, (data) => {
    if (data === undefined) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        unread_count: Math.max(0, page.unread_count - 1),
        items: page.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
      })),
    };
  });
}

// Fire-and-forget read receipt through push's notify call; the inbox is refetched once it lands.
export function markNotificationRead(item: InboxItem): void {
  if (!item.read) markReadInCache(item.id);
  void notifyRequest(NOTIFY_PATHS.markRead(item.id)).finally(() => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  });
}
