import { Link } from "react-router-dom";
import type { CasePage } from "@/api/icms/cases";
import { StatusChip } from "@/components/icms/StatusChip";
import { CASE_STATUS_META, toCaseStatus } from "@/features/complaints/caseStatus";
import { useFormats } from "@/i18n";
import { useCaseStatusLabels } from "@/i18n/labels";
import { ROUTES } from "@/routes/paths";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";
import { daysAgo } from "./trendModel";

// The newest complaints from the case register. Gated on `case.read` on top of the
// dashboard's own permission, since these are rows rather than aggregates.

export type StatusFeedPanelProps = {
  page: CasePage | undefined;
  pending: boolean;
  error: Error | null;
  /** When the page was fetched; relative times are measured from it. */
  loadedAt: number;
  allowed: boolean;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function StatusFeedPanel({
  page,
  pending,
  error,
  loadedAt,
  allowed,
  labels,
  onRetry,
  className,
}: StatusFeedPanelProps) {
  const { number } = useFormats();
  const statusLabels = useCaseStatusLabels();
  const rows = page?.items ?? [];

  const relative = (iso: string): string => {
    const days = daysAgo(iso, loadedAt);
    if (days === null) return "";
    return days === 0 ? labels.feed.today : labels.feed.daysAgo(number(days));
  };

  return (
    <Panel
      id="dashboard-feed"
      className={className}
      title={labels.feed.title}
      titleClassName="text-sm font-medium tracking-wider text-ochre-500 uppercase"
      pending={allowed && pending}
      error={allowed ? error : null}
      empty={!allowed || (page !== undefined && rows.length === 0)}
      emptyText={allowed ? labels.feed.empty : labels.feed.noPermission}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 grow flex-col gap-3">
        <ul className="flex flex-col divide-y divide-line-subtle border-b border-line-subtle">
          {rows.map((row) => {
            // An unrecognised status reads as its own code in a neutral chip.
            const known = toCaseStatus(row.status);
            return (
              <li key={row.case_ref}>
                <Link
                  to={ROUTES.complaint(row.case_ref)}
                  className="flex flex-col gap-0.5 rounded-sm py-3 outline-none hover:bg-surface-2/40 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-sm text-status-accent-fg">
                      {row.case_ref}
                    </span>
                    <StatusChip
                      status={known ? CASE_STATUS_META[known].chip : "unknown"}
                      size="sm"
                      uppercase
                    >
                      {known ? statusLabels[known] : row.status}
                    </StatusChip>
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {row.property_address ?? row.landmark ?? labels.feed.noAddress}
                  </span>
                  <span className="font-mono text-xs text-status-info-fg">
                    {relative(row.raised_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          to={ROUTES.complaints}
          className="mt-auto self-start text-xs text-fg-link hover:underline"
        >
          {labels.feed.viewAll}
        </Link>
      </div>
    </Panel>
  );
}
