import { Cell, Pie, PieChart } from "recharts";
import { MAX_GROUPS, type TypeCount } from "@/api/icms/dashboard";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useFormats } from "@/i18n";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";
import { groupTotal, seriesVar, shareOf } from "./trendModel";

// `GET /dashboard/by-type`: lifetime counts per complaint type. The ring is decorative;
// the legend list under it names every group and its share, so hue never carries meaning alone.

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

  // A case with no type is its own row, not dropped.
  const named = data.map((row, index) => ({
    key: row.complaint_type_cd ?? "__untyped__",
    name: row.label ?? row.complaint_type_cd ?? labels.byType.untyped,
    fill: seriesVar(index),
    total: row.total,
  }));

  const config = Object.fromEntries(
    named.map((entry) => [entry.key, { label: entry.name, color: entry.fill }]),
  ) satisfies ChartConfig;

  return (
    <Panel
      id="dashboard-by-type"
      title={labels.byType.title}
      pending={pending}
      error={error}
      empty={rows !== undefined && data.length === 0}
      emptyText={labels.byType.empty}
      footnote={labels.byType.cap(number(MAX_GROUPS))}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div aria-hidden>
          <ChartContainer config={config} className="mx-auto aspect-square h-[150px] w-[150px]">
            <PieChart>
              <Pie
                data={named}
                dataKey="total"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                label={false}
                labelLine={false}
                isAnimationActive={false}
              >
                {named.map((entry) => (
                  <Cell key={entry.key} fill={entry.fill} stroke="none" />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>

        <ul className="flex flex-col gap-1.5">
          {named.map((entry) => (
            <li
              key={entry.key}
              title={labels.byType.count(number(entry.total))}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: entry.fill }}
                />
                <span className="min-w-0 truncate text-sm text-fg-muted">{entry.name}</span>
                <span className="sr-only">{labels.byType.count(number(entry.total))}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-faint tabular-nums">
                {labels.byType.share(number(shareOf(entry.total, total)))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
