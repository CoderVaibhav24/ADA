/**
 * Role grants: every role as a row; opening one lists its permissions to tick.
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
import { PRIMARY_NAV } from "@/routes/nav";
import { groupByScreen, partitionByBand, type Band, type ScreenGroup } from "./bands";
import CreateRoleDialog from "./CreateRoleDialog";
import { Code, PolicyLoadError, PolicyPanel, PolicyRefusal } from "./parts";
import {
  RoleGrantSaveError,
  useRoleGrants,
  usePermissionCatalogue,
  useSaveRoleGrants,
  type RoleGrantWrite,
} from "./usePolicy";

// Screens in rail order: each rail entry's `*.access` code names its screen.
const SCREEN_ORDER: readonly string[] = PRIMARY_NAV.flatMap((item) =>
  item.requiresPermission?.endsWith(".access")
    ? [item.requiresPermission.slice(0, -".access".length)]
    : [],
);

type Overrides = Readonly<Record<string, readonly string[]>>;
type GrantChange = { roleCd: string; permissionCd: string; granted: boolean };
type Group = { resource: string; items: PolicyPermission[] };
type BandGroup = { band: Band; codes: readonly string[]; groups: Group[] };

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
  const roles = useRoleGrants();
  const permissions = usePermissionCatalogue();
  const save = useSaveRoleGrants();

  const [overrides, setOverrides] = useState<Overrides>({});
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const text = labels.grants;
  // Both memoised on the query's own `data`: a fresh `[]` on every render would
  // rebuild the column groups and re-diff the whole matrix on every keystroke
  // elsewhere on the screen.
  const roleRows = useMemo(() => roles.data ?? [], [roles.data]);
  const permissionRows = useMemo(() => permissions.data ?? [], [permissions.data]);
  const bands = useMemo<BandGroup[]>(
    () =>
      partitionByBand(permissionRows).map(({ band, items }) => ({
        band,
        codes: items.map((item) => item.permission_cd),
        groups: groupByResource(items),
      })),
    [permissionRows],
  );

  const screens = useMemo(
    () => groupByScreen(permissionRows, SCREEN_ORDER),
    [permissionRows],
  );

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
    bands,
    screens,
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
        <span className="flex flex-wrap items-center gap-2">
          {changes.length > 0 && (
            <Badge variant="default">
              {text.changeCount(changes.length, changedRoles.length)}
            </Badge>
          )}
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <Icon name="action.add" className="size-4" />
              {labels.createRole.newRole}
            </Button>
          )}
        </span>
      }
    >
      <CreateRoleDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roleRows}
        labels={labels}
        onCreated={(role) => {
          setOpenRole(role.role_cd);
          onSaved();
        }}
      />
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
          <RoleList {...shared} openRole={openRole} onOpenRole={setOpenRole} />

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
  bands: readonly BandGroup[];
  screens: readonly ScreenGroup<PolicyPermission>[];
  labels: PolicyLabels;
  canManage: boolean;
  isGranted: (role: RoleGrants, permissionCd: string) => boolean;
  effective: (role: RoleGrants) => readonly string[];
  onToggle: (role: RoleGrants, permissionCd: string, granted: boolean) => void;
  lockoutRole: string | null;
  changedRoles: readonly string[];
};

// Every role from the server; clicking one unfolds its permissions, screen by screen.
function RoleList({
  roleRows,
  bands,
  screens,
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
  const total = bands.reduce((sum, band) => sum + band.codes.length, 0);

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
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-start"
                  aria-expanded={open}
                  onClick={() => {
                    onOpenRole(open ? null : role.role_cd);
                  }}
                >
                  <p className="font-medium text-fg-strong">
                    {labels.role(role.role_cd, role.label)}
                  </p>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <Code>{role.role_cd}</Code>
                    {!role.active && <Badge variant="outline">{text.inactiveRole}</Badge>}
                    {dirty && <Badge variant="default">{text.changedBadge}</Badge>}
                  </span>
                </button>
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
                <ScreenPermissions
                  role={role}
                  screens={screens}
                  labels={labels}
                  canManage={canManage}
                  isGranted={isGranted}
                  onToggle={onToggle}
                />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// One card per screen: the "open this screen" switch, then every action on it.
function ScreenPermissions({
  role,
  screens,
  labels,
  canManage,
  isGranted,
  onToggle,
}: {
  role: RoleGrants;
  screens: readonly ScreenGroup<PolicyPermission>[];
  labels: PolicyLabels;
  canManage: boolean;
  isGranted: (role: RoleGrants, permissionCd: string) => boolean;
  onToggle: (role: RoleGrants, permissionCd: string, granted: boolean) => void;
}) {
  const text = labels.grants;
  const row = (permission: PolicyPermission, strong = false) => {
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
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className={`text-pretty ${strong ? "font-medium text-fg-strong" : ""}`}>
            {labels.permission(permission.resource, permission.action, permission.label)}
          </span>
          <Code>{permission.permission_cd}</Code>
        </span>
      </label>
    );
  };

  return (
    <div className="mt-3 grid min-w-0 gap-3 border-t border-line-subtle pt-3 md:grid-cols-2 xl:grid-cols-3">
      {screens.map((group) => {
        const all = group.access ? [group.access, ...group.actions] : group.actions;
        const held = all.filter((p) => isGranted(role, p.permission_cd)).length;
        const screenOpen = group.access ? isGranted(role, group.access.permission_cd) : true;
        return (
          <section
            key={group.screen ?? "shared"}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-line-subtle bg-surface-1 p-3"
          >
            <header className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg-strong">
                {group.screen ? labels.resource(group.screen) : text.sharedScreen}
              </h3>
              <span className="text-2xs text-fg-muted tabular">
                {text.roleTotal(held, all.length)}
              </span>
            </header>
            {group.access && row(group.access, true)}
            {group.actions.length > 0 && (
              <div
                className={`flex flex-col gap-2 ${
                  group.access ? "border-s border-line-subtle ps-3" : ""
                } ${screenOpen ? "" : "opacity-60"}`}
              >
                {group.actions.map((permission) => row(permission))}
              </div>
            )}
            {!screenOpen && group.actions.some((p) => isGranted(role, p.permission_cd)) && (
              <p className="text-2xs text-fg-faint text-pretty">{text.screenClosedHint}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
