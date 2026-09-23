/**
 * The round history — the one panel that makes the re-survey loop legible.
 *
 * A case that has been surveyed twice is two inspections, not a duplicate, and
 * the difference between them is a number. So round 1 keeps its own row, its
 * own status and its own link forever: it is what round 2 was opened to
 * correct, and evidence is append-only (contract §4.2), so nothing in it is
 * ever edited or removed. A history that collapsed to "latest round" would
 * throw away the only record of what the first survey found.
 *
 * Ascending order, oldest first, because that is the order the loop happened
 * in. The open round is marked rather than moved.
 *
 * The columns are the register's, translated by the register's own hook. Nine
 * strings that already exist in both bundles, and a header that cannot drift
 * from the table it mirrors.
 */

import { Link } from "react-router-dom";
import type { InspectionRow } from "@/api/icms/inspections";
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
import { useInspectionStatusLabels, useInspectionsLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import type { InspectionDetailLabels } from "./detailLabels";
import { DetailPanel } from "./detailParts";
import { INSPECTION_STATUS_META } from "./inspectionStatus";

const COLUMNS = 7;

export function RoundHistory({
  rounds,
  currentRef,
  status,
  error,
  onRetry,
  labels,
  formatDate,
}: {
  rounds: readonly InspectionRow[];
  currentRef: string;
  status: "pending" | "error" | "success";
  error: unknown;
  onRetry: () => void;
  labels: InspectionDetailLabels;
  formatDate: (value: string) => string;
}) {
  const register = useInspectionsLabels();
  const statusLabels = useInspectionStatusLabels();
  const api = error instanceof IcmsApiError ? error : null;

  return (
    <DetailPanel title={labels.rounds.title} description={labels.rounds.body}>
      {status === "error" ? (
        <ErrorState
          size="compact"
          title={register.errorTitle}
          description={api?.message ?? register.errorBody}
          detail={api?.requestId ?? undefined}
          onRetry={onRetry}
          retryLabel={register.errorRetry}
        />
      ) : (
        // Scrolls rather than reflowing into cards: these are register columns
        // and an officer compares them DOWN the page between two rounds.
        <div className="-mx-1 min-w-0 overflow-x-auto px-1">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{register.columns.round}</TableHead>
                <TableHead scope="col">{register.columns.inspectionRef}</TableHead>
                <TableHead scope="col">{register.columns.status}</TableHead>
                <TableHead scope="col">{register.columns.surveyor}</TableHead>
                <TableHead scope="col">{register.columns.submitted}</TableHead>
                <TableHead scope="col">{register.columns.evidence}</TableHead>
                <TableHead scope="col">{register.columns.checkIn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status === "pending" && <TableLoadingRows rows={2} columns={COLUMNS} />}

              {status === "success" && rounds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS}>
                    <EmptyState
                      size="compact"
                      icon="inspection.schedule"
                      title={labels.rounds.title}
                      description={labels.rounds.body}
                    />
                  </TableCell>
                </TableRow>
              )}

              {status === "success" &&
                rounds.map((round) => {
                  const current = round.inspection_ref === currentRef;
                  const value = toInspectionStatus(round.status);
                  return (
                    <TableRow key={round.inspection_ref} data-current={current || undefined}>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="tabular">
                            {labels.rounds.item(round.round_no)}
                          </Badge>
                          {/* Text, not a highlight: "this one" has to survive
                              a greyscale print and a screen reader. */}
                          {current && (
                            <span className="text-2xs font-medium text-fg-link">
                              {labels.rounds.current}
                            </span>
                          )}
                        </span>
                      </TableCell>

                      <TableCell>
                        {current ? (
                          <span className="font-medium text-fg-strong">
                            {round.inspection_ref}
                          </span>
                        ) : (
                          <Link
                            to={ROUTES.inspection(round.inspection_ref)}
                            className="rounded-xs font-medium text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {round.inspection_ref}
                          </Link>
                        )}
                      </TableCell>

                      <TableCell>
                        {value === null ? (
                          <span className="text-fg-faint">{round.status}</span>
                        ) : (
                          <StatusChip status={INSPECTION_STATUS_META[value].chip} size="sm">
                            {statusLabels[value]}
                          </StatusChip>
                        )}
                      </TableCell>

                      <TableCell className="text-fg-base">
                        {round.surveyor_name ?? round.surveyor_user_id}
                      </TableCell>

                      <TableCell>
                        {round.submitted_at == null ? (
                          <span className="text-fg-faint">{register.notRecorded}</span>
                        ) : (
                          <time dateTime={round.submitted_at} className="tabular">
                            {formatDate(round.submitted_at)}
                          </time>
                        )}
                      </TableCell>

                      <TableCell className="tabular">{round.evidence_count}</TableCell>

                      <TableCell>
                        <span className="flex items-center gap-1.5 text-2xs">
                          <Icon
                            name={round.has_check_in ? "inspection.checkIn" : "map.pin"}
                            className={
                              round.has_check_in
                                ? "size-3.5 text-status-success-fg"
                                : "size-3.5 text-fg-faint"
                            }
                          />
                          {round.has_check_in ? register.checkedIn : register.notCheckedIn}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      )}
    </DetailPanel>
  );
}
