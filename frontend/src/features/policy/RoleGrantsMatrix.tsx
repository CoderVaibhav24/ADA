/**
 * The role × permission matrix.
 *
 * ## The edit model: overrides, not a copy of the table
 *
 * Local state holds ONLY the roles the admin has touched. Every other role
 * renders straight from the server's answer. That is what makes a partial save
 * survivable: when the PUT succeeds for two roles and is refused for a third,
 * the two are dropped from `overrides` and immediately show the server's new
 * value, while the refused role keeps the admin's edit on screen. A local copy
 * of the whole table cannot express that without a second bookkeeping
 * structure that then has to be kept honest.
 *
 * ## Saving sends the COMPLETE set
 *
 * `PUT /admin/policy/roles/{role_cd}/permissions` replaces the role's grant
 * list outright — there is no delta form, because two admins patching one role
 * with add/remove deltas is how a revoked grant comes back from the dead. So:
 * one request per CHANGED role, each carrying every code that role keeps, and
 * roles nobody touched are not sent at all.
 *
 * ## Never autosave
 *
 * A checkbox here can stop a district office working. Nothing leaves the
 * browser until Save is pressed, and what will be sent is listed in words first.
 */

import { useMemo, useState } from "react";
import { IcmsApiError } from "@/api/icms/http";
import {
  POLICY_LOCKOUT,
  POLICY_MANAGE,
  type PolicyPermission,
  type RoleGrants,
} from "@/api/icms/policy";
import { EmptyState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { Code, PolicyLoadError, PolicyPanel, PolicyRefusal } from "./parts";
import {
  RoleGrantSaveError,
  useRoleGrants,
  usePermissionCatalogue,
  useSaveRoleGrants,
  type RoleGrantWrite,
} from "./usePolicy";

type Overrides = Readonly<Record<string, readonly string[]>>;
type GrantChange = { roleCd: string; permissionCd: string; granted: boolean };
type Group = { resource: string; items: PolicyPermission[] };

/** Permissions in the order the API sends them, bracketed by resource. */
function groupByResource(permissions: readonly PolicyPermission[]): Group[] {
  const groups: Group[] = [];
  for (const permission of permissions) {
    const last = groups.at(-1);
    if (last && last.resource === permission.resource) last.items.push(permission);
    else groups.push({ resource: permission.resource, items: [permission] });
  }
  return groups;
}

export default function RoleGrantsMatrix({
  labels,
  canManage,
  onSaved,
}: {
  labels: PolicyLabels;
  canManage: boolean;
  onSaved: () => void;
}) {
  const narrow = useIsNarrow();
  const roles = useRoleGrants();
  const permissions = usePermissionCatalogue();
  const save = useSaveRoleGrants();

  const [overrides, setOverrides] = useState<Overrides>({});
  const [openRole, setOpenRole] = useState<string | null>(null);

  const text = labels.grants;
  // Both memoised on the query's own `data`: a fresh `[]` on every render would
  // rebuild the column groups and re-diff the whole matrix on every keystroke
  // elsewhere on the screen.
  const roleRows = useMemo(() => roles.data ?? [], [roles.data]);
  const permissionRows = useMemo(() => permissions.data ?? [], [permissions.data]);
  const groups = useMemo(() => groupByResource(permissionRows), [permissionRows]);

  /** What the screen shows for a role: their edit, or the server's row. */
  const effective = (role: RoleGrants): readonly string[] =>
    overrides[role.role_cd] ?? role.permission_cds;

  const isGranted = (role: RoleGrants, permissionCd: string): boolean =>
    effective(role).includes(permissionCd);

  const toggle = (role: RoleGrants, permissionCd: string, granted: boolean) => {
    setOverrides((current) => {
      const now = new Set(current[role.role_cd] ?? role.permission_cds);
      if (granted) now.add(permissionCd);
      else now.delete(permissionCd);
      return { ...current, [role.role_cd]: [...now].sort() };
    });
  };

  /* ---- what changed ----------------------------------------------------- */

  const changes = useMemo<GrantChange[]>(() => {
    const out: GrantChange[] = [];
    for (const role of roleRows) {
      const draft = overrides[role.role_cd];
      if (!draft) continue;
      const before = new Set(role.permission_cds);
      const after = new Set(draft);
      for (const code of after) {
        if (!before.has(code)) out.push({ roleCd: role.role_cd, permissionCd: code, granted: true });
      }
      for (const code of before) {
        if (!after.has(code)) {
          out.push({ roleCd: role.role_cd, permissionCd: code, granted: false });
        }
      }
    }
    return out;
  }, [overrides, roleRows]);

  const changedRoles = useMemo(
    () => [...new Set(changes.map((change) => change.roleCd))],
    [changes],
  );

  /**
   * The same arithmetic `_refuse_lockout` does, run before the request rather
   * than instead of it. "Other roles" is read from the SERVER's rows, never
   * from the draft, because the server counts the table and not this screen.
   */
  const lockoutRole = useMemo(() => {
    const othersHoldIt = (roleCd: string) =>
      roleRows.some(
        (role) =>
          role.role_cd !== roleCd &&
          role.active &&
          role.permission_cds.includes(POLICY_MANAGE),
      );
    return (
      roleRows.find(
        (role) =>
          role.active &&
          role.permission_cds.includes(POLICY_MANAGE) &&
          !(overrides[role.role_cd] ?? role.permission_cds).includes(POLICY_MANAGE) &&
          !othersHoldIt(role.role_cd),
      )?.role_cd ?? null
    );
  }, [roleRows, overrides]);

  const roleLabel = (roleCd: string): string => {
    const row = roleRows.find((role) => role.role_cd === roleCd);
    return labels.role(roleCd, row?.label ?? roleCd);
  };

  const permissionLabel = (permissionCd: string): string => {
    const row = permissionRows.find((item) => item.permission_cd === permissionCd);
    return row ? labels.permission(row.resource, row.action, row.label) : permissionCd;
  };

  /* ---- saving ----------------------------------------------------------- */

  const handleSave = () => {
    // Ordered so a legal end state is reached legally: a role GAINING
    // policy.manage is written first and a role LOSING it last. Written in
    // input order, moving that grant from one role to another would trip the
    // lockout guard halfway and leave the transfer half done.
    const rank = (roleCd: string): number => {
      const row = roleRows.find((role) => role.role_cd === roleCd);
      if (!row) return 1;
      const had = row.permission_cds.includes(POLICY_MANAGE);
      const has = (overrides[roleCd] ?? row.permission_cds).includes(POLICY_MANAGE);
      if (!had && has) return 0;
      if (had && !has) return 2;
      return 1;
    };

    const writes: RoleGrantWrite[] = [...changedRoles]
      .sort((a, b) => rank(a) - rank(b))
      // The COMPLETE list this role keeps, not the difference.
      .map((roleCd) => ({ roleCd, permissionCds: overrides[roleCd] ?? [] }));

    save.mutate(writes, {
      onSuccess: () => {
        setOverrides({});
        onSaved();
      },
      onError: (cause) => {
        // Drop only the roles that landed; the refused one stays dirty so the
        // admin can see and fix exactly what was rejected.
        setOverrides((current) => {
          const next = { ...current };
          for (const roleCd of cause.saved) delete next[roleCd];
          return next;
        });
        if (cause.saved.length > 0) onSaved();
      },
    });
  };

  const failure = save.error instanceof RoleGrantSaveError ? save.error : null;
  const apiFailure = failure?.reason instanceof IcmsApiError ? failure.reason : null;
  const lockedOut = apiFailure?.code === POLICY_LOCKOUT;

  const status =
    roles.status === "error" || permissions.status === "error"
      ? "error"
      : roles.status === "pending" || permissions.status === "pending"
        ? "pending"
        : "success";

  const shared = {
    roleRows,
    groups,
    labels,
    canManage,
    isGranted,
    effective,
    onToggle: toggle,
    lockoutRole,
    changedRoles,
  };

  return (
    <PolicyPanel
      title={text.title}
      subtitle={text.subtitle}
      aside={
        changes.length > 0 ? (
          <Badge variant="default">
            {text.changeCount(changes.length, changedRoles.length)}
          </Badge>
        ) : null
      }
    >
      {failure && (
        <PolicyRefusal
          labels={labels}
          title={lockedOut ? text.lockoutTitle : text.failedTitle(roleLabel(failure.roleCd))}
          body={lockedOut ? text.lockoutBody(roleLabel(failure.roleCd)) : failure.reason.message}
          hint={
            <>
              {lockedOut && <span className="block">{text.lockoutFix}</span>}
              {failure.saved.length > 0 && (
                <span className="mt-1 block">
                  {text.partialBody(
                    failure.saved.map(roleLabel).join(", "),
                    roleLabel(failure.roleCd),
                  )}
                </span>
              )}
            </>
          }
          requestId={apiFailure?.requestId}
        />
      )}

      {status === "pending" && (
        <div className="flex flex-col gap-2" aria-busy aria-live="polite">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <PolicyLoadError
          error={roles.error ?? permissions.error}
          labels={labels}
          onRetry={() => {
            void roles.refetch();
            void permissions.refetch();
          }}
        />
      )}

      {status === "success" && (roleRows.length === 0 || permissionRows.length === 0) && (
        <EmptyState
          size="compact"
          title={labels.permissions.emptyTitle}
          description={labels.permissions.emptyBody}
        />
      )}

      {status === "success" && roleRows.length > 0 && permissionRows.length > 0 && (
        <>
          {narrow ? (
            <NarrowRoles {...shared} openRole={openRole} onOpenRole={setOpenRole} />
          ) : (
            <WideMatrix {...shared} permissionCount={permissionRows.length} />
          )}

          {lockoutRole && (
            <p className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning p-3 text-sm text-status-warning-fg">
              <Icon name="feedback.warning" className="mt-0.5 size-4 shrink-0" />
              <span className="text-pretty">{text.lockoutHint}</span>
            </p>
          )}

          {/* What is about to be sent, in words, before anything is sent. */}
          <div className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-2 p-3">
            <p className="text-sm font-medium text-fg-strong">{text.reviewTitle}</p>
            {changes.length === 0 ? (
              <p className="text-sm text-fg-muted">{text.noChanges}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {changes.map((change) => (
                  <li
                    key={`${change.roleCd}:${change.permissionCd}`}
                    className="flex items-start gap-2 text-sm text-fg-base"
                  >
                    <Icon
                      name={change.granted ? "action.confirm" : "form.minus"}
                      className={`mt-0.5 size-4 shrink-0 ${
                        change.granted ? "text-status-success-fg" : "text-status-danger-fg"
                      }`}
                    />
                    <span className="min-w-0 text-pretty">
                      {change.granted
                        ? text.added(
                            roleLabel(change.roleCd),
                            permissionLabel(change.permissionCd),
                          )
                        : text.removed(
                            roleLabel(change.roleCd),
                            permissionLabel(change.permissionCd),
                          )}{" "}
                      <Code>{change.permissionCd}</Code>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="max-w-prose text-2xs text-fg-faint text-pretty">{text.fullSetNote}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!canManage || changes.length === 0 || save.isPending}
                onClick={handleSave}
              >
                <Icon
                  name={save.isPending ? "feedback.loading" : "action.save"}
                  spin={save.isPending}
                  className="size-4"
                />
                {save.isPending ? text.saving : text.save}
              </Button>
              <Button
                variant="outline"
                disabled={changes.length === 0 || save.isPending}
                onClick={() => {
                  setOverrides({});
                }}
              >
                {text.discard}
              </Button>
            </div>
          </div>
        </>
      )}
    </PolicyPanel>
  );
}

type MatrixProps = {
  roleRows: readonly RoleGrants[];
  groups: readonly Group[];
  labels: PolicyLabels;
  canManage: boolean;
  isGranted: (role: RoleGrants, permissionCd: string) => boolean;
  effective: (role: RoleGrants) => readonly string[];
  onToggle: (role: RoleGrants, permissionCd: string, granted: boolean) => void;
  lockoutRole: string | null;
  changedRoles: readonly string[];
};

/**
 * The grid, at `md` and above.
 *
 * Two header rows: each resource spans its own actions, so fifteen narrow
 * columns read as ten groups. The role column is sticky because a checkbox in
 * the eleventh column with the role name scrolled out of view is a coin toss.
 */
function WideMatrix({
  roleRows,
  groups,
  permissionCount,
  labels,
  canManage,
  isGranted,
  effective,
  onToggle,
  lockoutRole,
  changedRoles,
}: MatrixProps & { permissionCount: number }) {
  const text = labels.grants;
  return (
    // Two layers, as components/data-table/DataTable.tsx does it. The OUTER
    // `overflow-hidden` is load-bearing: without it a table wider than the
    // viewport propagates its overflow to <html> and the whole page scrolls
    // sideways, even though the inner scroller is clipping correctly.
    // `border-separate border-spacing-0` rather than `border-collapse`, because
    // Chromium will not honour `position: sticky` on a cell in a collapsed table.
    <div className="min-w-0 overflow-hidden rounded-md border border-line-subtle">
      <div className="relative w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b border-line-subtle bg-surface-sunken">
            <th
              rowSpan={2}
              scope="col"
              className="sticky left-0 z-[1] min-w-[11rem] border-e border-line-subtle bg-surface-sunken px-3 py-2 text-start font-medium text-fg-muted"
            >
              {text.roleColumn}
            </th>
            {groups.map((group) => (
              <th
                key={group.resource}
                colSpan={group.items.length}
                scope="colgroup"
                className="border-s border-line-subtle px-2 py-1.5 text-center text-2xs font-semibold text-fg-muted"
              >
                {labels.resource(group.resource)}
              </th>
            ))}
            <th
              rowSpan={2}
              scope="col"
              className="border-s border-line-subtle px-3 py-2 text-end font-medium text-fg-muted"
            >
              <span className="sr-only">{text.granted}</span>
            </th>
          </tr>
          <tr className="border-b border-line-subtle bg-surface-sunken">
            {groups.flatMap((group) =>
              group.items.map((permission, index) => (
                <th
                  key={permission.permission_cd}
                  scope="col"
                  title={permission.permission_cd}
                  className={`px-2 py-1.5 text-center text-2xs font-normal text-fg-faint ${
                    index === 0 ? "border-s border-line-subtle" : ""
                  }`}
                >
                  {labels.permissionAction(permission.action)}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {roleRows.map((role) => {
            const granted = effective(role);
            const dirty = changedRoles.includes(role.role_cd);
            return (
              <tr
                key={role.role_cd}
                className={`border-b border-line-subtle last:border-b-0 ${
                  dirty ? "bg-accent-soft" : ""
                }`}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-[1] border-e border-line-subtle px-3 py-2 text-start font-normal ${
                    dirty ? "bg-accent-soft" : "bg-surface-1"
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-fg-strong">
                      {labels.role(role.role_cd, role.label)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Code>{role.role_cd}</Code>
                      {!role.active && <Badge variant="outline">{text.inactiveRole}</Badge>}
                      {role.role_cd === lockoutRole && (
                        <Icon
                          name="feedback.warning"
                          label={text.lockoutHint}
                          className="size-3.5 text-status-warning-fg"
                        />
                      )}
                    </span>
                  </span>
                </th>

                {groups.flatMap((group) =>
                  group.items.map((permission, index) => (
                    <td
                      key={permission.permission_cd}
                      className={`px-2 py-2 text-center ${
                        index === 0 ? "border-s border-line-subtle" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isGranted(role, permission.permission_cd)}
                        disabled={!canManage}
                        aria-label={text.cell(
                          labels.permission(
                            permission.resource,
                            permission.action,
                            permission.label,
                          ),
                          labels.role(role.role_cd, role.label),
                        )}
                        onCheckedChange={(next) => {
                          onToggle(role, permission.permission_cd, next === true);
                        }}
                      />
                    </td>
                  )),
                )}

                <td className="border-s border-line-subtle px-3 py-2 text-end text-2xs text-fg-muted tabular">
                  {text.roleTotal(granted.length, permissionCount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Below `md`: one card per role, its permissions folded inside.
 *
 * The same move `components/data-table` makes when the columns stop fitting —
 * the identity column stays and everything else goes into a per-record sheet. A
 * fifteen-column grid at 360px is not a grid, it is a horizontal scrollbar with
 * checkboxes in it.
 */
function NarrowRoles({
  roleRows,
  groups,
  labels,
  canManage,
  openRole,
  onOpenRole,
  isGranted,
  effective,
  onToggle,
  lockoutRole,
  changedRoles,
}: MatrixProps & {
  openRole: string | null;
  onOpenRole: (roleCd: string | null) => void;
}) {
  const text = labels.grants;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <>
      <p className="text-2xs text-fg-faint text-pretty">{text.narrowHint}</p>
      <ul className="flex flex-col gap-2">
        {roleRows.map((role) => {
          const open = openRole === role.role_cd;
          const granted = effective(role);
          const dirty = changedRoles.includes(role.role_cd);
          return (
            <li
              key={role.role_cd}
              className={`rounded-md border p-3 ${
                dirty
                  ? "border-accent-soft-border bg-accent-soft"
                  : "border-line-subtle bg-surface-2"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-fg-strong">
                    {labels.role(role.role_cd, role.label)}
                  </p>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <Code>{role.role_cd}</Code>
                    {!role.active && <Badge variant="outline">{text.inactiveRole}</Badge>}
                    {dirty && <Badge variant="default">{text.changedBadge}</Badge>}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-2xs text-fg-muted tabular">
                    {text.roleTotal(granted.length, total)}
                  </span>
                  {/* Icon-only when closed: the accessible name names the ROLE,
                      so a screen reader never reads five identical "Edit"s. */}
                  <Button
                    variant="outline"
                    size={open ? "sm" : "icon-sm"}
                    aria-expanded={open}
                    aria-label={
                      open
                        ? undefined
                        : text.openRole(labels.role(role.role_cd, role.label))
                    }
                    onClick={() => {
                      onOpenRole(open ? null : role.role_cd);
                    }}
                  >
                    <Icon
                      name={open ? "form.chevronUp" : "form.chevronDown"}
                      className="size-4"
                    />
                    {open ? text.closeRole : null}
                  </Button>
                </div>
              </div>

              {role.role_cd === lockoutRole && (
                <p className="mt-2 flex items-start gap-2 text-2xs text-status-warning-fg">
                  <Icon name="feedback.warning" className="mt-0.5 size-3.5 shrink-0" />
                  <span className="text-pretty">{text.lockoutHint}</span>
                </p>
              )}

              {open && (
                <div className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
                  {groups.map((group) => (
                    <fieldset key={group.resource} className="flex min-w-0 flex-col gap-2">
                      <legend className="text-2xs font-semibold text-fg-muted">
                        {labels.resource(group.resource)}
                      </legend>
                      {group.items.map((permission) => {
                        const id = `grant-${role.role_cd}-${permission.permission_cd}`;
                        return (
                          <label
                            key={permission.permission_cd}
                            htmlFor={id}
                            className="flex items-start gap-2 text-sm text-fg-base"
                          >
                            <Checkbox
                              id={id}
                              className="mt-0.5 shrink-0"
                              checked={isGranted(role, permission.permission_cd)}
                              disabled={!canManage}
                              onCheckedChange={(next) => {
                                onToggle(role, permission.permission_cd, next === true);
                              }}
                            />
                            {/* Code on its own line: inline after the label it
                                wraps mid-token at 360px ("d / ashboard.read"). */}
                            <span className="flex min-w-0 flex-col items-start gap-0.5">
                              <span className="text-pretty">
                                {labels.permission(
                                  permission.resource,
                                  permission.action,
                                  permission.label,
                                )}
                              </span>
                              <Code>{permission.permission_cd}</Code>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
