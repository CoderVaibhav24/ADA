/**
 * The change-detection reports — `GET /api/analyses/{job_id}/report.{csv,geojson}`.
 *
 * Both endpoints are mounted and, before this screen, neither had a caller
 * anywhere in the portal. They belong here: they are the only two reports the
 * system produces that the case register knows nothing about.
 *
 * This is the OTHER transport. `/api/analyses/*` are the older console routes:
 * they answer `{"detail": ...}`, they are reached through `api/client.ts`
 * rather than `icmsRequest`, they take no `AbortSignal`, and they are scoped by
 * project rather than by zone. `download()` in that module already fetches with
 * the bearer token and hands the bytes to the save dialog through a blob URL —
 * the same shape `downloadNoticePdf` uses — because a bare `<a href>` on an
 * authenticated route downloads a 401 page.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, download, downloadUrl } from "@/api/client";
import type { Analysis, Project } from "@/api/types";
import { EmptyState, LoadingState } from "@/components/icms/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { describeError } from "./errors";
import { FieldLabel, ReportNote, ReportSection, SectionError } from "./parts";
import { useAnalysisReportLabels } from "./reportLabels";

type Format = "csv" | "geojson";

export default function AnalysisReports() {
  const labels = useAnalysisReportLabels();
  const formats = useFormats();

  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [runChoice, setRunChoice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [failure, setFailure] = useState<{ message: string; requestId: string | null } | null>(
    null,
  );

  const projects = useQuery<Project[], Error>({
    queryKey: ["analyses", "projects"],
    queryFn: () => api.listProjects(),
    staleTime: 60_000,
    retry: false,
  });

  // Chosen if the officer has chosen; otherwise the first, so the panel opens
  // on something rather than on a placeholder.
  const projectId = projectChoice ?? (projects.data?.[0] ? String(projects.data[0].id) : null);

  const runs = useQuery<Analysis[], Error>({
    queryKey: ["analyses", "runs", projectId],
    queryFn: () => api.listAnalyses(projectId ?? ""),
    enabled: projectId !== null,
    staleTime: 30_000,
    retry: false,
  });

  // A finished run is the one worth opening on: it is the only kind with a
  // report behind it.
  const defaultRun = useMemo(() => {
    const list = runs.data ?? [];
    return list.find((item) => item.status === "done") ?? list[0];
  }, [runs.data]);

  const runId = runChoice ?? (defaultRun ? String(defaultRun.id) : null);
  const run = (runs.data ?? []).find((item) => String(item.id) === runId);
  const finished = run?.status === "done";

  const startDownload = (format: Format) => {
    if (runId === null) return;
    setDownloading(format);
    setFailure(null);
    void download(
      format === "csv" ? downloadUrl.reportCsv(runId) : downloadUrl.reportGeojson(runId),
      // The same name the Change Detection screen saves under, so two screens
      // do not produce two spellings of one file.
      `ada_analysis_${runId}.${format}`,
    )
      .catch((cause: unknown) => {
        const described = describeError(cause);
        setFailure({
          message: described.message ?? labels.failed,
          requestId: described.requestId,
        });
      })
      .finally(() => {
        setDownloading(null);
      });
  };

  const runLabel = (item: Analysis) =>
    item.status === "done"
      ? labels.runOption(String(item.id), formats.date(item.created_at))
      : labels.runOptionUnfinished(
          String(item.id),
          formats.date(item.created_at),
          labels.status(item.status),
        );

  return (
    <ReportSection
      icon="nav.changeDetection"
      title={labels.title}
      description={labels.description}
    >
      {projects.error ? (
        <SectionError
          title={labels.errorTitle}
          body={labels.errorBody}
          cause={projects.error}
          onRetry={() => {
            void projects.refetch();
          }}
          retryLabel={labels.retry}
        />
      ) : projects.isPending ? (
        <LoadingState label={labels.loading} lines={2} />
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState
          icon="map.layers"
          title={labels.noProjectsTitle}
          description={labels.noProjectsBody}
          size="compact"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <FieldLabel htmlFor="report-analysis-project">{labels.projectLabel}</FieldLabel>
              <Select
                value={projectId ?? ""}
                onValueChange={(next) => {
                  setProjectChoice(next);
                  // The runs belong to the old project; keeping the choice
                  // would point at a run this project does not have.
                  setRunChoice(null);
                  setFailure(null);
                }}
              >
                <SelectTrigger
                  id="report-analysis-project"
                  size="sm"
                  className="w-full min-w-[12rem] sm:w-[16rem]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((project) => (
                    <SelectItem key={String(project.id)} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <FieldLabel htmlFor="report-analysis-run">{labels.runLabel}</FieldLabel>
              <Select
                value={runId ?? ""}
                disabled={(runs.data ?? []).length === 0}
                onValueChange={(next) => {
                  setRunChoice(next);
                  setFailure(null);
                }}
              >
                <SelectTrigger
                  id="report-analysis-run"
                  size="sm"
                  className="w-full min-w-[12rem] sm:w-[18rem]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(runs.data ?? []).map((item) => (
                    <SelectItem key={String(item.id)} value={String(item.id)}>
                      {runLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!finished || downloading !== null}
                onClick={() => {
                  startDownload("csv");
                }}
              >
                <Icon
                  name={downloading === "csv" ? "feedback.loading" : "action.download"}
                  className="size-4"
                  spin={downloading === "csv"}
                />
                {labels.csv}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!finished || downloading !== null}
                onClick={() => {
                  startDownload("geojson");
                }}
              >
                <Icon
                  name={downloading === "geojson" ? "feedback.loading" : "action.download"}
                  className="size-4"
                  spin={downloading === "geojson"}
                />
                {labels.geojson}
              </Button>
            </div>
          </div>

          {runs.error ? (
            <SectionError
              title={labels.errorTitle}
              body={labels.errorBody}
              cause={runs.error}
              onRetry={() => {
                void runs.refetch();
              }}
              retryLabel={labels.retry}
            />
          ) : runs.isPending ? (
            <LoadingState label={labels.loading} lines={2} />
          ) : (runs.data ?? []).length === 0 ? (
            <EmptyState
              icon="data.records"
              title={labels.noRunsTitle}
              description={labels.noRunsBody}
              size="compact"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {/* Announced: this line is how an officer learns that the two
                  buttons are disabled for a reason rather than broken. */}
              <p role="status" className="text-xs text-fg-muted">
                {downloading !== null
                  ? labels.downloading
                  : run && !finished
                    ? labels.notFinished(labels.status(run.status))
                    : run?.stats
                      ? labels.detections(
                          formats.number(run.stats.polygons),
                          formats.number(run.stats.illegal),
                        )
                      : ""}
              </p>
              {failure && (
                <p className="text-xs text-status-danger-fg">
                  {failure.message}
                  {failure.requestId !== null && (
                    <span className="mt-1 block font-mono text-2xs text-fg-faint break-all">
                      {failure.requestId}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <ReportNote>{labels.note}</ReportNote>
    </ReportSection>
  );
}
