import { Link, useSearchParams } from "react-router-dom";
import { CASE_READ } from "@/api/icms/cases";
import { INSPECTION_READ } from "@/api/icms/inspections";
import { NOTICE_READ } from "@/api/icms/notices";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { useDashboardLabels } from "./labels";
import { MetricTiles } from "./MetricTiles";
import { StatusFeedPanel } from "./StatusFeedPanel";
import { TrendPanel } from "./TrendPanel";
import { TypePanel } from "./TypePanel";
import { ZonePanel } from "./ZonePanel";
import { PERIODS, periodById, trendTotals, type PeriodId } from "./trendModel";
import {
  oldestLoadedAt,
  useByType,
  useByZone,
  useDashboardGate,
  useInspectionsScheduled,
  useNewDetections,
  useNoticesIssued,
  useRecentCases,
  useRefreshDashboard,
  useSummary,
  useTrend,
} from "./useDashboard";

// `/dashboard` (Figma 3:1302). Gated on `dashboard.read` here and in the rail, but only
// ada-api enforces it; tiles and the feed that read other registers need their own permission.
// "Data as of" is when the browser loaded the oldest panel, not a server timestamp.

const PERIOD_PARAM = "period";

export default function Dashboard() {
  const labels = useDashboardLabels();
  const gate = useDashboardGate();
  const { dateTime } = useFormats();
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshDashboard();

  // The window is in the URL so a chosen period survives a reload; unknown values fall back.
  const period = periodById(params.get(PERIOD_PARAM));
  const can = {
    cases: gate.permissions.includes(CASE_READ),
    inspections: gate.permissions.includes(INSPECTION_READ),
    notices: gate.permissions.includes(NOTICE_READ),
  };

  const summary = useSummary(gate.canRead);
  const trend = useTrend({ days: period.days, bucket: period.bucket }, gate.canRead);
  const byType = useByType(gate.canRead);
  const byZone = useByZone(gate.canRead);
  const newDetections = useNewDetections(gate.canRead && can.cases);
  const inspectionsScheduled = useInspectionsScheduled(gate.canRead && can.inspections);
  const noticesIssued = useNoticesIssued(gate.canRead && can.notices);
  const recent = useRecentCases(gate.canRead && can.cases);

  const setPeriod = (next: PeriodId) => {
    setParams(
      (current) => {
        const search = new URLSearchParams(current);
        search.set(PERIOD_PARAM, next);
        return search;
      },
      { replace: true },
    );
  };

  const loadedAt = oldestLoadedAt([
    summary.dataUpdatedAt,
    trend.dataUpdatedAt,
    byType.dataUpdatedAt,
    byZone.dataUpdatedAt,
  ]);
  const busy =
    summary.isFetching || trend.isFetching || byType.isFetching || byZone.isFetching;

  const raisedInPeriod = trend.data
    ? trendTotals(trend.data.points).raised
    : trend.error
      ? null
      : undefined;

  if (gate.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.loading" spin className="size-4" />
          {labels.gate.checking}
        </span>
      </div>
    );
  }

  // Not a redirect to the login screen: the officer IS signed in, they are
  // simply not allowed here, and a login form they already passed reads as a bug.
  if (!gate.canRead) {
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[40vh] max-w-prose flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
          <Icon name="user.password" className="size-5" />
        </span>
        <h1 className="font-display text-xl font-bold text-balance text-fg-strong">
          {labels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{labels.gate.deniedBody}</p>
      </section>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-fg-strong sm:text-3xl">
            {labels.heading}
          </h1>
          <p aria-live="polite" className="mt-1 min-h-5 text-sm text-fg-canvas-muted tabular-nums">
            {loadedAt === null ? "" : labels.subtitle(dateTime(loadedAt))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={busy}
            aria-label={busy ? labels.refreshing : labels.refresh}
            title={busy ? labels.refreshing : labels.refresh}
            onClick={() => {
              void refresh();
            }}
          >
            <Icon name="action.refresh" className="size-4" spin={busy} />
          </Button>
          <Button asChild className="shadow-lg shadow-accent-solid/40">
            <Link to={ROUTES.changeDetection}>
              {labels.runChangeDetection}
              <Icon name="map.layers" className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <div
        role="toolbar"
        aria-label={labels.toolbar.label}
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-4 py-2"
      >
        <p className="max-w-prose text-xs text-fg-faint text-pretty">{labels.scopeNote}</p>
        <div className="flex items-center gap-2">
          <Label htmlFor="dashboard-period" className="text-xs text-fg-muted">
            {labels.trend.periodLabel}
          </Label>
          <Select
            value={period.id}
            onValueChange={(next) => {
              setPeriod(next as PeriodId);
            }}
          >
            <SelectTrigger id="dashboard-period" size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {labels.trend.period(option.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <MetricTiles
        summary={summary}
        raisedInPeriod={raisedInPeriod}
        periodLabel={labels.trend.periodShort(period.id)}
        newDetections={newDetections}
        inspectionsScheduled={inspectionsScheduled}
        noticesIssued={noticesIssued}
        can={can}
        labels={labels}
      />

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-3">
        <TrendPanel
          className="xl:col-span-2"
          trend={trend.data}
          pending={trend.isPending}
          error={trend.error}
          period={period.id}
          labels={labels}
          onRetry={() => {
            void trend.refetch();
          }}
        />

        <TypePanel
          rows={byType.data}
          pending={byType.isPending}
          error={byType.error}
          labels={labels}
          onRetry={() => {
            void byType.refetch();
          }}
        />

        <ZonePanel
          className="xl:col-span-2"
          rows={byZone.data}
          pending={byZone.isPending}
          error={byZone.error}
          labels={labels}
          onRetry={() => {
            void byZone.refetch();
          }}
        />

        <StatusFeedPanel
          page={recent.data}
          pending={recent.isPending}
          error={recent.error}
          loadedAt={recent.dataUpdatedAt}
          allowed={can.cases}
          labels={labels}
          onRetry={() => {
            void recent.refetch();
          }}
        />
      </div>
    </div>
  );
}
