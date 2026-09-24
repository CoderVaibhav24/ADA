/**
 * `/reports` — an index of what this register can produce, and a way to produce it.
 *
 * ## Why it looks nothing like the Dashboard
 *
 * Reports has no Figma frame and no endpoint of its own. Every figure on it is
 * read from an endpoint that already exists, and it is rendered as a table with
 * a total and a download rather than as a chart: the Dashboard answers "how are
 * we doing", this answers "give me the numbers, in a file, with the caveats
 * attached". The one control Figma does draw for a period — 134:2479 — is here
 * on the throughput panel, minus its "All Time" entry, which the trend endpoint
 * cannot serve.
 *
 * ## The four sections, and what each is gated on
 *
 *   - throughput and the two breakdowns — `dashboard.read`;
 *   - register exports — `case.export` for complaints, `inspection.read` and
 *     `notice.read` for the other two, each row saying so for itself;
 *   - change-detection reports — the older console routes, which no ICMS
 *     permission governs;
 *   - the gap list, which is not gated because it is a statement about the
 *     system rather than about the data.
 *
 * A half the officer may not use is a stated refusal, never an error page: the
 * point of gating per section is that `case.export` without `dashboard.read`
 * still gets the exports.
 *
 * `period` and `bucket` live in the URL so a report is a link. The export
 * filters do not — see `RegisterExports.tsx`.
 */

import { useSearchParams } from "react-router-dom";
import { EmptyState, LoadingState } from "@/components/icms/states";
import AnalysisReports from "./AnalysisReports";
import Breakdowns from "./Breakdowns";
import { DEFAULT_BUCKET, DEFAULT_PERIOD, isBucket, isPeriodId } from "./period";
import { ReportNote, ReportSection, SectionError } from "./parts";
import RegisterExports from "./RegisterExports";
import { GAP_IDS, useGapLabels, useReportShellLabels } from "./reportLabels";
import Throughput from "./Throughput";
import { useReportsGate } from "./useReports";

/** The reports that need an endpoint, each named with the endpoint it needs. */
function Gaps() {
  const labels = useGapLabels();
  return (
    <ReportSection icon="feedback.info" title={labels.title} description={labels.description}>
      <ul className="flex flex-col gap-3">
        {GAP_IDS.map((id) => {
          const item = labels.items[id];
          return (
            <li
              key={id}
              className="flex flex-col gap-1 rounded-md border border-line-subtle bg-surface-2 p-3"
            >
              <h3 className="font-display text-sm font-semibold text-fg-strong">{item.title}</h3>
              <p className="max-w-prose text-xs text-fg-muted text-pretty">{item.note}</p>
              <p className="font-mono text-2xs text-fg-faint break-all">
                {labels.needs(item.endpoint)}
              </p>
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}

export default function Reports() {
  const labels = useReportShellLabels();
  const gate = useReportsGate();
  const [params, setParams] = useSearchParams();

  // An unknown value in the URL falls back to the default rather than reaching
  // the endpoint as a 422.
  const rawPeriod = params.get("period");
  const period = isPeriodId(rawPeriod) ? rawPeriod : DEFAULT_PERIOD;
  const rawBucket = params.get("bucket");
  const bucket = isBucket(rawBucket) ? rawBucket : DEFAULT_BUCKET;

  // Pushed, not replaced: the back button undoes a period change, the same rule
  // the registers follow for a filter.
  const setParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  };

  const canExportSomething =
    (gate.canReadCases && gate.canExportCases) || gate.canReadInspections || gate.canReadNotices;
  const nothingInTheRegister = !gate.canReadAggregates && !canExportSomething;

  return (
    // No gutter and no max-width here: AppShell's `main` supplies both, once,
    // for every screen.
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
          {labels.title}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-fg-canvas-muted text-pretty">{labels.subtitle}</p>
      </header>

      {gate.loading ? (
        <LoadingState label={labels.gate.loading} lines={3} />
      ) : (
        <>
          {gate.refused && (
            <SectionError
              title={labels.gate.refusedTitle}
              body={labels.gate.refusedBody}
              cause={gate.refused}
            />
          )}

          {/* The scope caveat is stated once, above every count on the screen:
              for a field surveyor these are their own cases, not their zone's. */}
          {gate.canReadAggregates && <ReportNote>{labels.scopeNote}</ReportNote>}

          {nothingInTheRegister ? (
            <EmptyState
              icon="nav.report"
              title={labels.gate.noneTitle}
              description={labels.gate.noneBody}
            />
          ) : (
            <>
              {gate.canReadAggregates ? (
                <>
                  <Throughput
                    period={period}
                    bucket={bucket}
                    onPeriodChange={(next) => {
                      setParam("period", next);
                    }}
                    onBucketChange={(next) => {
                      setParam("bucket", next);
                    }}
                    enabled
                  />
                  <Breakdowns enabled />
                </>
              ) : (
                <ReportNote>{labels.gate.aggregatesDenied}</ReportNote>
              )}

              {canExportSomething ? (
                <RegisterExports gate={gate} />
              ) : (
                <ReportNote>{labels.gate.exportsDenied}</ReportNote>
              )}
            </>
          )}

          <AnalysisReports />
          <Gaps />
        </>
      )}
    </div>
  );
}
