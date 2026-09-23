/**
 * The permission catalogue — read-mostly, because that is what it is.
 *
 * A permission is created by the endpoint that names it in the server's source,
 * never here; `0003` seeds all fifteen with `is_system = true`, and
 * `delete_permission` refuses a system row with 409 `permission_is_system`. So
 * in practice every Delete on this screen is disabled, and the screen says why
 * on the control rather than letting an admin click into a refusal.
 *
 * The 409 handler below is still wired and is not dead code: `is_system` is
 * read from a response that may be seconds old, and a later migration can seed
 * a non-system row. If the refusal does arrive it is shown as the guard rail it
 * is, not as "something went wrong".
 */

import { useState } from "react";
import { IcmsApiError } from "@/api/icms/http";
import { PERMISSION_IS_SYSTEM, type PolicyPermission } from "@/api/icms/policy";
import { EmptyState } from "@/components/icms/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { Code, PolicyLoadError, PolicyPanel, PolicyRefusal } from "./parts";
import { useDeletePermission, usePermissionCatalogue } from "./usePolicy";

export default function PermissionsCatalogue({
  labels,
  canManage,
  onSaved,
}: {
  labels: PolicyLabels;
  canManage: boolean;
  onSaved: () => void;
}) {
  const narrow = useIsNarrow();
  const { data, status, error, refetch } = usePermissionCatalogue();
  const remove = useDeletePermission();
  const [pending, setPending] = useState<PolicyPermission | null>(null);
  const [refused, setRefused] = useState<{ code: string; error: IcmsApiError } | null>(null);

  const rows = data ?? [];
  const text = labels.permissions;

  const confirmDelete = () => {
    if (!pending) return;
    const code = pending.permission_cd;
    setPending(null);
    remove.mutate(code, {
      onSuccess: () => {
        setRefused(null);
        onSaved();
      },
      onError: (cause) => {
        if (cause instanceof IcmsApiError) setRefused({ code, error: cause });
      },
    });
  };

  return (
    <PolicyPanel
      title={text.title}
      subtitle={text.subtitle}
      aside={
        status === "success" ? (
          <span className="text-sm text-fg-muted tabular">{text.count(rows.length)}</span>
        ) : null
      }
    >
      {refused && (
        <PolicyRefusal
          labels={labels}
          title={text.refusedTitle(refused.code)}
          body={refused.error.message}
          hint={refused.error.code === PERMISSION_IS_SYSTEM ? text.systemHint : undefined}
          requestId={refused.error.requestId}
        />
      )}

      {status === "pending" && (
        <div className="flex flex-col gap-2" aria-busy aria-live="polite">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <PolicyLoadError
          error={error}
          labels={labels}
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {status === "success" && rows.length === 0 && (
        <EmptyState size="compact" title={text.emptyTitle} description={text.emptyBody} />
      )}

      {status === "success" && rows.length > 0 && (
        <>
          <p className="max-w-prose text-2xs text-fg-faint text-pretty">{text.systemHint}</p>
          {narrow ? (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li
                  key={row.permission_cd}
                  className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Code>{row.permission_cd}</Code>
                    <KindBadge row={row} labels={labels} />
                  </div>
                  <p className="text-sm text-fg-base text-pretty">
                    {labels.permission(row.resource, row.action, row.label)}
                  </p>
                  <p className="text-2xs text-fg-faint">
                    {labels.resource(row.resource)} · {labels.permissionAction(row.action)}
                  </p>
                  <DeleteButton
                    row={row}
                    labels={labels}
                    canManage={canManage}
                    busy={remove.isPending}
                    onSelect={setPending}
                    full
                  />
                </li>
              ))}
            </ul>
          ) : (
            // Two layers, copied from components/data-table/DataTable.tsx: the
            // OUTER `overflow-hidden` is what stops a wide table propagating its
            // overflow up to <html> and giving the whole page a sideways
            // scrollbar. `<Table>` supplies the inner scroller itself.
            <div className="min-w-0 overflow-hidden rounded-md border border-line-subtle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{text.columns.code}</TableHead>
                    <TableHead>{text.columns.resource}</TableHead>
                    <TableHead>{text.columns.action}</TableHead>
                    <TableHead>{text.columns.label}</TableHead>
                    <TableHead>{text.columns.kind}</TableHead>
                    <TableHead className="text-end">
                      <span className="sr-only">{text.delete}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.permission_cd}>
                      <TableCell>
                        <Code>{row.permission_cd}</Code>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {labels.resource(row.resource)}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {labels.permissionAction(row.action)}
                      </TableCell>
                      <TableCell className="text-fg-base">
                        {labels.permission(row.resource, row.action, row.label)}
                      </TableCell>
                      <TableCell>
                        <KindBadge row={row} labels={labels} />
                      </TableCell>
                      <TableCell className="text-end">
                        <DeleteButton
                          row={row}
                          labels={labels}
                          canManage={canManage}
                          busy={remove.isPending}
                          onSelect={setPending}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {text.confirmTitle(pending?.permission_cd ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>{text.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{text.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{text.confirmAction}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PolicyPanel>
  );
}

function KindBadge({ row, labels }: { row: PolicyPermission; labels: PolicyLabels }) {
  return row.is_system ? (
    <Badge variant="secondary">{labels.permissions.systemBadge}</Badge>
  ) : (
    <Badge variant="outline">{labels.permissions.customBadge}</Badge>
  );
}

// Disabled with the reason on the control itself, rather than behind a click.
function DeleteButton({
  row,
  labels,
  canManage,
  busy,
  onSelect,
  full,
}: {
  row: PolicyPermission;
  labels: PolicyLabels;
  canManage: boolean;
  busy: boolean;
  onSelect: (row: PolicyPermission) => void;
  full?: boolean;
}) {
  const blocked = row.is_system || !canManage;
  return (
    <Button
      variant="outline"
      size="sm"
      className={full ? "w-full" : undefined}
      disabled={blocked || busy}
      aria-label={labels.permissions.deleteLabel(row.permission_cd)}
      title={row.is_system ? labels.permissions.deleteDisabled : undefined}
      onClick={() => {
        onSelect(row);
      }}
    >
      <Icon name="action.delete" className="size-4" />
      {busy ? labels.permissions.deleting : labels.permissions.delete}
    </Button>
  );
}
