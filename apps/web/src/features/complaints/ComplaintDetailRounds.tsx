/**
 * The round history — the one panel that makes the re-survey loop legible.
 *
 * A case that has been surveyed twice is two inspections, not a duplicate, and
 * the difference between them is a number. So round 1 keeps its own row, its
 * own status and its own link forever: it is what round 2 was opened to
 * correct, and nothing in it is ever edited or removed. A history that
 * collapsed to "latest round" would throw away the only record of what the
 * first survey found.
 *
 * Ascending, oldest first, because that is the order the loop happened in. The
 * open round is marked rather than moved.
 *
 * `CaseDetail.rounds` arrives with the case, so this table has no request of
 * its own — it is handed the case query's state, and owns an empty, a loading
 * and an error rendering of it all the same.
 */

import { Link } from "react-router-dom";
import { toInspectionStatus } from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { EmptyState, ErrorState, TableLoadingRows } from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInspectionStatusLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { ActorName } from "@/components/icms/ActorName";
import { INSPECTION_STATUS_META } from "../inspections/inspectionStatus";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import { roundsAscending, type CaseRound } from "./ComplaintDetailModel";
import { Absent, DetailPanel } from "./ComplaintDetailParts";

const COLUMNS = 6;

export function ComplaintDetailRounds({
  rounds,
  currentRound,
  status,
  error,
  onRetry,
  labels,
  notRecorded,
  formatDate,
  formatNumber,
}: {
  rounds: readonly CaseRound[];
  currentRound: number;
  status: "pending" | "error" | "success";
  error: unknown;
  onRetry: () => void;
  labels: ComplaintDetailLabels;
  notRecorded: string;
  formatDate: (value: string) => string;
  formatNumber: (value: number) => string;
}) {
  const statusLabels = useInspectionStatusLabels();
  const api = error instanceof IcmsApiError ? error : null;
  const ordered = roundsAscending(rounds);

  return (
    <DetailPanel
      title={labels.panels.rounds}
      description={labels.rounds.body}
      aside={
        <span className="text-2xs text-fg-faint tabular">
          {labels.rounds.count(ordered.length)}
        </span>
      }
    >
      {status === "error" ? (
        <ErrorState
          size="compact"
          title={labels.errorTitle}
          description={api?.message ?? labels.errorBody}
          detail={api?.requestId ?? undefined}
          onRetry={onRetry}
          retryLabel={labels.errorRetry}
        />
      ) : status === "success" && ordered.length === 0 ? (
        <EmptyState
          size="compact"
          icon="inspection.schedule"
          title={labels.rounds.emptyTitle}
          description={labels.rounds.emptyBody}
        />
      ) : (
        // Scrolls rather than reflowing into cards: these are register columns
        // and an officer compares them DOWN the page between two rounds.
        <div className="-mx-1 min-w-0 overflow-x-auto px-1">
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{labels.rounds.columns.round}</TableHead>
                <TableHead scope="col">{labels.rounds.columns.inspectionRef}</TableHead>
                <TableHead scope="col">{labels.rounds.columns.status}</TableHead>
                <TableHead scope="col">{labels.rounds.columns.surveyor}</TableHead>
                <TableHead scope="col">{labels.rounds.columns.submitted}</TableHead>
                <TableHead scope="col">{labels.rounds.columns.area}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {status === "pending" ? (
                <TableLoadingRows rows={2} columns={COLUMNS} />
              ) : (
                ordered.map((round) => {
                  const inspectionStatus = toInspectionStatus(round.status);
                  const open = round.round_no === currentRound;
                  // Both are optional on the wire as well as nullable; absent
                  // and null are the same thing to read.
                  const submitted = round.submitted_at ?? null;
                  const area = round.measured_area_sqm ?? null;

                  return (
                    <TableRow key={round.inspection_ref} data-current={open || undefined}>
                      <TableCell className="tabular">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {labels.values.round(round.round_no)}
                          {/* The open round is named, not just tinted. */}
                          {open && (
                            <Badge variant="outline" className="text-2xs">
                              {labels.rounds.current}
                            </Badge>
                          )}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Link
                          to={ROUTES.inspection(round.inspection_ref)}
                          className="rounded-xs font-mono text-xs font-medium text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {round.inspection_ref}
                        </Link>
                      </TableCell>

                      <TableCell>
                        {/* Chip AND label: the tone repeats the state, never carries it. */}
                        {inspectionStatus === null ? (
                          <Badge variant="outline">{round.status}</Badge>
                        ) : (
                          <StatusChip
                            size="sm"
                            status={INSPECTION_STATUS_META[inspectionStatus].chip}
                          >
                            {statusLabels[inspectionStatus]}
                          </StatusChip>
                        )}
                      </TableCell>

                      <TableCell>
                        <ActorName name={round.surveyor_name} id={round.surveyor_user_id} />
                      </TableCell>

                      <TableCell>
                        {submitted === null ? (
                          <Absent>{notRecorded}</Absent>
                        ) : (
                          <time dateTime={submitted} className="tabular">
                            {formatDate(submitted)}
                          </time>
                        )}
                      </TableCell>

                      <TableCell>
                        {area === null ? (
                          <Absent>{notRecorded}</Absent>
                        ) : (
                          <span className="tabular">
                            {labels.values.area(formatNumber(area))}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-2xs text-fg-faint text-pretty">
        <Icon name="feedback.info" className="mt-0.5 size-3.5 shrink-0" />
        {labels.rounds.open}
      </p>
    </DetailPanel>
  );
}
