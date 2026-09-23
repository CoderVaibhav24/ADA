import { Cell, Pie, PieChart } from "recharts";
import { MAX_GROUPS, type TypeCount } from "@/api/icms/dashboard";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormats } from "@/i18n";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";
import { groupTotal, seriesVar, shareOf } from "./trendModel";

/**
 * `GET /dashboard/by-type` — the complaint-type breakdown.
 *
 * ## The ring is decoration; the table is the panel
 *
 * The donut is `aria-hidden` and carries no labels of its own. Every figure it
 * encodes — the count, the share, the open/closed split — is in the table
 * beside it, which is what a reader who cannot tell the fifth hue from the
 * first gets, and what anyone after the actual numbers wants anyway. That is
 * this screen's colour rule in full: nothing means anything by hue alone.
 *
 * ## This breakdown has no period, and says so
 *
 * Figma badges the sibling panel "FY 2025-26" (`23:2487`). This endpoint takes
 * no parameters at all: it counts every case in the caller's scope at every
 * stage, lifetime to date. The description states that, because the period
 * select on the trend panel above is the obvious thing for a reader to assume
 * applies here, and it does not.
 *
 * ## A case with no type is a row, not a rounding error
 *
 * `by_type` keeps the null group deliberately — a case filed before its type
 * was chosen still counts, and this panel and the counter cards have to agree.
 * It is labelled as untyped rather than dropped or folded into another row.
 */

export type TypePanelProps = {
  rows: TypeCount[] | undefined;
  pending: boolean;
  error: Error | null;
  labels: DashboardLabels;
  onRetry: () => void;
};

export function TypePanel({ rows, pending, error, labels, onRetry }: TypePanelProps) {
  const { number } = useFormats();
  const data = rows ?? [];
  const total = groupTotal(data);

  const named = data.map((row, index) => ({
    key: row.complaint_type_cd ?? "__untyped__",
    name: row.label ?? row.complaint_type_cd ?? labels.byType.untyped,
    fill: seriesVar(index),
    total: row.total,
    open: row.open,
    resolved: row.resolved,
  }));

  const config = Object.fromEntries(
    named.map((entry) => [entry.key, { label: entry.name, color: entry.fill }]),
  ) satisfies ChartConfig;

  return (
    <Panel
      id="dashboard-by-type"
      title={labels.byType.title}
      description={labels.byType.description}
      pending={pending}
      error={error}
      empty={rows !== undefined && data.length === 0}
      emptyText={labels.byType.empty}
      footnote={labels.byType.cap(number(MAX_GROUPS))}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-center">
        <div aria-hidden className="shrink-0 2xl:w-56">
          <ChartContainer config={config} className="mx-auto aspect-square h-48 w-48">
            <PieChart>
              <Pie
                data={named}
                dataKey="total"
                nameKey="name"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={1}
                isAnimationActive={false}
              >
                {named.map((entry) => (
                  <Cell key={entry.key} fill={entry.fill} stroke="var(--color-surface-1)" />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>

        <div className="min-w-0 grow overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.byType.columns.type}</TableHead>
                <TableHead className="text-end">{labels.byType.columns.total}</TableHead>
                <TableHead className="text-end">{labels.byType.columns.share}</TableHead>
                <TableHead className="text-end">{labels.byType.columns.open}</TableHead>
                <TableHead className="text-end">{labels.byType.columns.resolved}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {named.map((entry) => (
                <TableRow key={entry.key}>
                  <TableCell className="min-w-40">
                    <span className="flex items-center gap-2">
                      {/* Keyed to the ring slice. Decorative: the name is beside it. */}
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: entry.fill }}
                      />
                      <span className="min-w-0 break-words">{entry.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(entry.total)}</TableCell>
                  <TableCell className="text-end tabular-nums text-fg-muted">
                    {labels.byType.share(number(shareOf(entry.total, total)))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(entry.open)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(entry.resolved)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Panel>
  );
}
