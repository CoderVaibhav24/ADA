import type { DashboardSummary } from "@/api/icms/dashboard";
import { StatusChip } from "@/components/icms/StatusChip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CASE_STATUS_META, toCaseStatus } from "@/features/complaints/caseStatus";
import { useFormats } from "@/i18n";
import { useCaseStatusLabels } from "@/i18n/labels";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";
import { shareOf } from "./trendModel";

/**
 * `summary.by_status` — the table the counter cards are summed from.
 *
 * ## What this replaces, and why
 *
 * Figma's bottom-right panel (`3:1302`, "COMPALINT STATUS") is a feed of
 * individual cases: a reference, an address, a chip and a relative time. No
 * dashboard endpoint returns rows — all five are aggregates, deliberately, and
 * `dashboard_schemas.py` opens by saying so ("Nothing here carries a
 * complainant's name, a phone number or an address"). A feed built from the
 * case register instead would put a different permission (`case.read`) behind a
 * panel gated on `dashboard.read`. So the feed is not built; what IS returned —
 * the per-status grouping the cards are summed from — is drawn in its place,
 * and the register is one rail click away for anyone who wants the rows.
 *
 * ## Colour is not the signal
 *
 * Eleven statuses share six chip tones, so the chip's glyph and its label carry
 * the state and the hue is the last of the three. That is `StatusChip`'s own
 * rule; this panel simply does not override it.
 */

export type StatusPanelProps = {
  summary: DashboardSummary | undefined;
  pending: boolean;
  error: Error | null;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function StatusPanel({
  summary,
  pending,
  error,
  labels,
  onRetry,
  className,
}: StatusPanelProps) {
  const { number } = useFormats();
  const statusLabels = useCaseStatusLabels();

  const rows = [...(summary?.by_status ?? [])].sort((a, b) => b.count - a.count);
  const total = summary?.total ?? 0;
  const highTotal = summary?.high_priority ?? 0;

  return (
    <Panel
      id="dashboard-by-status"
      className={className}
      title={labels.byStatus.title}
      description={labels.byStatus.description}
      pending={pending}
      error={error}
      empty={summary !== undefined && rows.length === 0}
      emptyText={labels.byStatus.empty}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.byStatus.columns.status}</TableHead>
              <TableHead className="text-end">{labels.byStatus.columns.count}</TableHead>
              <TableHead className="text-end">{labels.byStatus.columns.share}</TableHead>
              <TableHead className="text-end">{labels.byStatus.columns.high}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              // A twelfth status from a migration this build has not seen reads
              // as its own code in a neutral chip, rather than blank or crashing.
              const known = toCaseStatus(row.status);
              const meta = known ? CASE_STATUS_META[known] : null;
              return (
                <TableRow key={row.status}>
                  <TableCell className="min-w-48">
                    <StatusChip status={meta ? meta.chip : "unknown"} size="sm">
                      {known ? statusLabels[known] : labels.byStatus.unknown(row.status)}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(row.count)}</TableCell>
                  <TableCell className="text-end tabular-nums text-fg-muted">
                    {labels.byType.share(number(shareOf(row.count, total)))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(row.high_priority)}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="font-semibold">
              <TableCell>{labels.byStatus.totalRow}</TableCell>
              <TableCell className="text-end tabular-nums">{number(total)}</TableCell>
              <TableCell className="text-end tabular-nums text-fg-muted">
                {labels.byType.share(number(shareOf(total, total)))}
              </TableCell>
              <TableCell className="text-end tabular-nums">{number(highTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
