import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { useDashboardLabels } from "./labels";
import { MetricTiles } from "./MetricTiles";
import { StatusPanel } from "./StatusPanel";
import { TrendPanel } from "./TrendPanel";
import { TypePanel } from "./TypePanel";
import { ZonePanel } from "./ZonePanel";
import { periodById, type PeriodId } from "./trendModel";
import {
  oldestLoadedAt,
  useByType,
  useByZone,
  useDashboardGate,
  useRefreshDashboard,
  useSummary,
  useTrend,
} from "./useDashboard";

/**
 * `/dashboard` — the five aggregate panels of ICMS Batch 5.
 *
 * ## Where gating happens, and what each place is worth
 *
 * The same three places `PolicyAdmin` and `UserAdministration` document, with
 * `dashboard.read` in them:
 *
 *   1. the rail — `navForPermissions` drops the entry without `dashboard.read`;
 *   2. here — a typed URL still reaches this component, which refuses to render
 *      any panel without it and never fires the four requests;
 *   3. **ada-api** — `require_permission("dashboard.read")` on all five routes.
 *
 * Only (3) enforces anything. `/me/capabilities` says `advisory: true` in its
 * own payload for exactly this reason. Worth stating plainly: the seed grants
 * `dashboard.read` to Super Admin, the PCS Nodal Officer and the ADA Project
 * Lead and NOT to the Field Surveyor, so a surveyor is refused here today —
 * which is a policy row an admin can change at runtime, not a fact about roles.
 *
 * ## Every number on this screen is scoped, and the page says so once
 *
 * `zone_scope` narrows all four queries to the caller's zones, and a field
 * surveyor holding no supervisory role is narrowed again to the cases assigned
 * to them. The line under the heading states that once, for the whole page,
 * rather than every panel hedging separately — and no panel title anywhere says
 * "zone total" or "district total", because for some callers it would be false.
 *
 * ## What Figma draws that this does not
 *
 * Four things, each because nothing behind it exists:
 *
 *   - the "Run Change Detection" header button — an action on the change
 *     detection console, not a dashboard endpoint;
 *   - the village and status dropdowns in the toolbar — none of the four reads
 *     takes a parameter but `trend`, whose period select therefore sits on the
 *     trend panel itself;
 *   - the "This Financial Year" and "All Time" period options — `days` is
 *     capped at 365 with no since-date and no unbounded mode;
 *   - the "Complaint Status" activity feed of individual cases — every
 *     dashboard endpoint is an aggregate by design. `StatusPanel` draws the
 *     per-status grouping that IS returned in its place.
 *
 * `GET /cases.geojson` is in the same router and is not used: this frame draws
 * no map, and an endpoint existing is not a reason to invent a panel for it.
 *
 * ## "Loaded at" is a client fact, not a server one
 *
 * Figma's subtitle reads "Data as of 07 Sep 2026, 09:15 IST". No endpoint
 * returns a generated-at timestamp, so the line here says when the browser
 * loaded it, taken from the OLDEST of the four queries — see `useDashboard`.
 */

const PERIOD_PARAM = "period";

export default function Dashboard() {
  const labels = useDashboardLabels();
  const gate = useDashboardGate();
  const { dateTime } = useFormats();
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshDashboard();

  // The window is in the URL so a chosen period survives a reload and can be
  // sent to a colleague; an unknown value falls back rather than 422-ing.
  const period = periodById(params.get(PERIOD_PARAM));

  const summary = useSummary(gate.canRead);
  const trend = useTrend({ days: period.days, bucket: period.bucket }, gate.canRead);
  const byType = useByType(gate.canRead);
  const byZone = useByZone(gate.canRead);

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
        <p className="text-sm text-fg-muted text-pretty">{labels.gate.deniedBody}</p>
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
          <p className="mt-1 max-w-prose text-sm text-fg-muted text-pretty">
            {labels.scopeNote}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refresh();
            }}
          >
            <Icon name="action.refresh" className="size-4" spin={busy} />
            {busy ? labels.refreshing : labels.refresh}
          </Button>
          <p aria-live="polite" className="text-2xs text-fg-faint tabular-nums">
            {loadedAt === null ? "" : labels.loadedAt(dateTime(loadedAt))}
          </p>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <MetricTiles
          className="xl:col-span-2"
          summary={summary.data}
          pending={summary.isPending}
          error={summary.error}
          labels={labels}
          onRetry={() => {
            void summary.refetch();
          }}
        />

        <TrendPanel
          className="xl:col-span-2"
          trend={trend.data}
          pending={trend.isPending}
          error={trend.error}
          period={period.id}
          onPeriodChange={setPeriod}
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
          rows={byZone.data}
          pending={byZone.isPending}
          error={byZone.error}
          labels={labels}
          onRetry={() => {
            void byZone.refetch();
          }}
        />

        <StatusPanel
          className="xl:col-span-2"
          summary={summary.data}
          pending={summary.isPending}
          error={summary.error}
          labels={labels}
          onRetry={() => {
            void summary.refetch();
          }}
        />
      </div>
    </div>
  );
}
