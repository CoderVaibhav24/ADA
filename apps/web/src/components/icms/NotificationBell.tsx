import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  listNotifications,
  markNotificationRead,
  type InboxItem,
  type InboxPage,
} from "@/api/notifications";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";

const POLL_MS = 60_000;
const KNOWN_TYPES: readonly string[] = [
  "case_raised",
  "inspection_submitted",
  "resurvey_refused",
  "case_handed_over",
  "case_confirmed",
  "notice_issued",
  "inspection_overdue",
  "verification_pending",
  "resurvey_decision_pending",
  "notice_compliance_due",
];

// Where an item leads: the case first, else a same-origin route the server supplied.
function targetOf(item: InboxItem): string | null {
  const caseRef = item.case_ref ?? item.data?.case_ref;
  if (caseRef) return ROUTES.complaint(encodeURIComponent(caseRef));
  const route = item.data?.route;
  if (route && route.startsWith("/") && !route.startsWith("//")) return route;
  return null;
}

// "5 min ago" inside a week, the absolute IST date-time after that.
function useWhen(locale: string, dateTime: (v: string) => string): (iso: string) => string {
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return (iso: string) => {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return "";
      const secs = Math.round((then - Date.now()) / 1000);
      const abs = Math.abs(secs);
      if (abs < 60) return rtf.format(secs, "second");
      if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
      if (abs < 86_400) return rtf.format(Math.round(secs / 3600), "hour");
      if (abs < 7 * 86_400) return rtf.format(Math.round(secs / 86_400), "day");
      return dateTime(iso);
    };
  }, [locale, dateTime]);
}

// The header bell: unread badge, and a popover listing the newest inbox items.
export function NotificationBell({ ariaLabel }: { ariaLabel: (unread: number) => string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { language, locale, dateTime } = useFormats();
  const when = useWhen(locale, dateTime);
  const [open, setOpen] = useState(false);

  const notifyLocale = language.startsWith("hi") ? "hi" : "en";
  const queryKey = useMemo(() => ["notify", "inbox", "ada", notifyLocale] as const, [notifyLocale]);

  const inbox = useQuery({
    queryKey,
    queryFn: ({ signal }) => listNotifications(notifyLocale, signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<InboxPage>(queryKey, (page) => {
        if (!page) return page;
        const target = page.items.find((i) => i.id === id);
        if (!target || target.read) return page;
        return {
          ...page,
          unread_count: Math.max(0, page.unread_count - 1),
          items: page.items.map((i) =>
            i.id === id ? { ...i, read: true, read_at: new Date().toISOString() } : i,
          ),
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notify", "inbox"] });
    },
  });

  const unread = inbox.data?.unread_count ?? 0;
  const items = inbox.data?.items ?? [];
  const badge = unread > 9 ? "9+" : String(unread);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void inbox.refetch();
  };

  const handleSelect = (item: InboxItem) => {
    if (!item.read) markRead.mutate(item.id);
    setOpen(false);
    const target = targetOf(item);
    if (target) void navigate(target);
  };

  const fallbackTitle = (item: InboxItem): string => {
    const type = item.type || item.data?.type || "";
    const key = KNOWN_TYPES.includes(type) ? type : "other";
    const label = t(`notificationsPanel.types.${key}`);
    const ref = item.case_ref ?? item.data?.case_ref;
    return ref ? `${label} · ${ref}` : label;
  };

  const note = (key: string) => (
    <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
      {t(key)}
    </p>
  );

  let body: ReactNode;
  if (inbox.isPending) body = note("notificationsPanel.loading");
  else if (inbox.isError && !inbox.data) body = note("notificationsPanel.unavailable");
  else if (items.length === 0) body = note("notificationsPanel.empty");
  else {
    const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    body = (
      <ul className="max-h-96 divide-y overflow-y-auto">
        {sorted.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => handleSelect(item)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden ${
                item.read ? "" : "bg-accent/40"
              }`}
            >
              <span
                aria-hidden
                className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-primary"}`}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`text-sm ${item.read ? "" : "font-semibold"}`}>
                  {item.title || fallbackTitle(item)}
                  {!item.read && (
                    <span className="sr-only">
                      {", "}
                      {t("notificationsPanel.unread")}
                    </span>
                  )}
                </span>
                {item.body && (
                  <span className="line-clamp-2 text-xs text-fg-muted">{item.body}</span>
                )}
                <time dateTime={item.created_at} className="text-2xs text-fg-muted">
                  {when(item.created_at)}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={ariaLabel(unread)}>
          <Icon name="nav.notifications" className="size-5" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs text-destructive-foreground tabular"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 sm:w-96"
        aria-label={t("notificationsPanel.title")}
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t("notificationsPanel.title")}</h2>
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}
