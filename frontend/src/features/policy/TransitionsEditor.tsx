/**
 * The workflow table — the highest blast radius in the system.
 *
 * A wrong click here silently changes who may act on enforcement cases that are
 * open right now, and there is no undo. Three things follow, and they are the
 * whole design of this screen:
 *
 *  1. **The confirmation names the consequence, not the field.** "Field
 *     Surveyor will no longer be able to submit an inspection" — never "Are you
 *     sure?", and never "roles: [-field-surveyor]". An admin cannot weigh a
 *     diff of column names; they can weigh a sentence about an officer.
 *  2. **`note` is shown on every row.** It is the reason the rule exists and
 *     the only thing on screen that can stop a change that looks harmless.
 *  3. **Four fields are editable and no others.** `action_cd`,
 *     `source_status`, `target_status` and `stage_no` are what the product
 *     means by a stage; `TransitionUpdate` has no field for them at all, so the
 *     server refuses them by name. They are shown, fixed, with that said.
 *
 * The PATCH carries only the keys that changed: the server reads it with
 * `model_dump(exclude_unset=True)`, so an unchanged field sent anyway would
 * still be written and `updated_by` would credit the wrong edit.
 */

import { useMemo, useState } from "react";
import type { CaseStatus } from "@/api/icms/cases";
import { IcmsApiError } from "@/api/icms/http";
import type { PolicyTransition, TransitionPatch } from "@/api/icms/policy";
import { EmptyState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCaseStatusLabels, type PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { Code, PolicyLoadError, PolicyPanel, PolicyRefusal } from "./parts";
import { usePatchTransition, useRoleGrants, useTransitions } from "./usePolicy";

/** The four editable fields, plus the note. Nothing else is in this type. */
type Draft = {
  roles: string[];
  requires: string[];
  assignee_only: boolean;
  active: boolean;
  note: string;
};

/** `Code` in icms_admin.py. A field the server would 422 is refused in the box. */
const FIELD_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;

type Sentence = { key: string; text: string; tone: "add" | "remove" | "warn" };

function draftOf(row: PolicyTransition): Draft {
  return {
    roles: [...row.roles].sort(),
    requires: [...row.requires],
    assignee_only: row.assignee_only,
    active: row.active,
    note: row.note ?? "",
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Only the keys that actually moved — see the note at the top of this file. */
function patchOf(row: PolicyTransition, draft: Draft): TransitionPatch {
  const patch: TransitionPatch = {};
  if (!sameSet(draft.roles, row.roles)) patch.roles = [...draft.roles];
  if (draft.requires.join("\u0000") !== row.requires.join("\u0000")) {
    patch.requires = [...draft.requires];
  }
  if (draft.assignee_only !== row.assignee_only) patch.assignee_only = draft.assignee_only;
  if (draft.active !== row.active) patch.active = draft.active;
  if (draft.note !== (row.note ?? "")) patch.note = draft.note === "" ? null : draft.note;
  return patch;
}

export default function TransitionsEditor({
  labels,
  canManage,
  onSaved,
}: {
  labels: PolicyLabels;
  canManage: boolean;
  onSaved: () => void;
}) {
  const narrow = useIsNarrow();
  const transitions = useTransitions();
  const roles = useRoleGrants();
  const statusLabels = useCaseStatusLabels();
  const [editing, setEditing] = useState<PolicyTransition | null>(null);

  const text = labels.transitions;
  const rows = transitions.data ?? [];
  const roleRows = roles.data ?? [];

  const roleLabel = (roleCd: string): string => {
    const row = roleRows.find((role) => role.role_cd === roleCd);
    return labels.role(roleCd, row?.label ?? roleCd);
  };

  // `source_status` is null on `raise`: the case does not exist yet, which is a
  // different sentence from an unknown status, not a blank cell.
  const statusLabel = (value: string | null): string =>
    value === null ? text.initialStatus : (statusLabels[value as CaseStatus] ?? value);

  const status =
    transitions.status === "error" || roles.status === "error"
      ? "error"
      : transitions.status === "pending" || roles.status === "pending"
        ? "pending"
        : "success";

  const shared = { labels, roleLabel, statusLabel, canManage, onEdit: setEditing };

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
      {status === "pending" && (
        <div className="flex flex-col gap-2" aria-busy aria-live="polite">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <PolicyLoadError
          error={transitions.error ?? roles.error}
          labels={labels}
          onRetry={() => {
            void transitions.refetch();
            void roles.refetch();
          }}
        />
      )}

      {status === "success" && rows.length === 0 && (
        <EmptyState size="compact" title={text.emptyTitle} description={text.emptyBody} />
      )}

      {status === "success" && rows.length > 0 && (
        <>
          <p className="max-w-prose rounded-md border border-status-warning-border bg-status-warning p-3 text-sm text-status-warning-fg text-pretty">
            <Icon name="feedback.warning" className="me-2 inline size-4 align-[-2px]" />
            {text.confirmBody}
          </p>
          {narrow ? (
            <NarrowTransitions rows={rows} {...shared} />
          ) : (
            <WideTransitions rows={rows} {...shared} />
          )}
        </>
      )}

      {editing && (
        <TransitionDialog
          row={editing}
          roleCds={roleRows.map((role) => role.role_cd)}
          labels={labels}
          roleLabel={roleLabel}
          statusLabel={statusLabel}
          canManage={canManage}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={onSaved}
        />
      )}
    </PolicyPanel>
  );
}

type RowProps = {
  rows: readonly PolicyTransition[];
  labels: PolicyLabels;
  roleLabel: (roleCd: string) => string;
  statusLabel: (value: string | null) => string;
  canManage: boolean;
  onEdit: (row: PolicyTransition) => void;
};

/** The rules that are not roles, as chips, so a row reads at a glance. */
function RuleChips({ row, labels }: { row: PolicyTransition; labels: PolicyLabels }) {
  const text = labels.transitions;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={row.active ? "secondary" : "destructive"}>
        {row.active ? text.active : text.inactive}
      </Badge>
      {row.assignee_only && <Badge variant="outline">{text.assigneeOnly}</Badge>}
      {row.opens_round && <Badge variant="outline">{text.opensRound}</Badge>}
    </span>
  );
}

/**
 * At `md` and above: the table, with each row's `note` in a second row beneath
 * it rather than behind a disclosure. The note is the reason the rule exists;
 * putting it behind a click is how a rule gets changed without it being read.
 */
function WideTransitions({ rows, labels, roleLabel, statusLabel, canManage, onEdit }: RowProps) {
  const text = labels.transitions;
  return (
    // Two layers, as components/data-table/DataTable.tsx does it. The OUTER
    // `overflow-hidden` is load-bearing: without it a table wider than the
    // viewport propagates its overflow to <html> and the whole page scrolls
    // sideways, even though the inner scroller is clipping correctly.
    <div className="min-w-0 overflow-hidden rounded-md border border-line-subtle">
      <div className="relative w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b border-line-subtle bg-surface-sunken text-2xs text-fg-muted">
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.stage}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.action}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.from}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.to}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.roles}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.requires}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {text.columns.rules}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              <span className="sr-only">{text.edit}</span>
            </th>
          </tr>
        </thead>
        {rows.map((row) => (
          // One tbody per step, so the note row is grouped with the row it
          // explains rather than floating as a sibling of the next step.
          <tbody key={row.id} className="border-b border-line-subtle last:border-b-0">
            <tr className={row.active ? "" : "bg-surface-2 text-fg-muted"}>
              <td className="px-3 py-2 align-top text-2xs whitespace-nowrap text-fg-muted tabular">
                {text.stage(row.stage_no)}
              </td>
              <td className="px-3 py-2 align-top">
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg-strong">
                    {labels.actionName(row.action_cd)}
                  </span>
                  <Code>{row.action_cd}</Code>
                </span>
              </td>
              <td className="px-3 py-2 align-top text-fg-base">
                {statusLabel(row.source_status)}
              </td>
              <td className="px-3 py-2 align-top text-fg-base">
                {statusLabel(row.target_status)}
              </td>
              <td className="px-3 py-2 align-top">
                {row.roles.length === 0 ? (
                  <span className="text-status-danger-fg">{text.noRoles}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {row.roles.map((roleCd) => (
                      <Badge key={roleCd} variant="outline">
                        {roleLabel(roleCd)}
                      </Badge>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                {row.requires.length === 0 ? (
                  <span className="text-2xs text-fg-faint">{text.noRequires}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {row.requires.map((name) => (
                      <Code key={name}>{name}</Code>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <RuleChips row={row} labels={labels} />
              </td>
              <td className="px-3 py-2 text-end align-top">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canManage}
                  aria-label={text.editLabel(labels.actionName(row.action_cd))}
                  onClick={() => {
                    onEdit(row);
                  }}
                >
                  <Icon name="action.edit" className="size-4" />
                  {text.edit}
                </Button>
              </td>
            </tr>
            {row.note && (
              <tr className={row.active ? "" : "bg-surface-2"}>
                <td />
                <td colSpan={7} className="px-3 pb-2 align-top">
                  <p className="max-w-prose text-2xs text-fg-faint text-pretty">
                    <span className="font-semibold">{text.noteLabel}: </span>
                    {row.note}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        ))}
        </table>
      </div>
    </div>
  );
}

/** Below `md`: one card per step. Same content, stacked, nothing dropped. */
function NarrowTransitions({
  rows,
  labels,
  roleLabel,
  statusLabel,
  canManage,
  onEdit,
}: RowProps) {
  const text = labels.transitions;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-w-0 flex-col gap-2 rounded-md border border-line-subtle bg-surface-2 p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-fg-strong">{labels.actionName(row.action_cd)}</p>
              <span className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-fg-muted">
                <Code>{row.action_cd}</Code>
                <span className="tabular">{text.stage(row.stage_no)}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage}
              aria-label={text.editLabel(labels.actionName(row.action_cd))}
              onClick={() => {
                onEdit(row);
              }}
            >
              <Icon name="action.edit" className="size-4" />
              {text.edit}
            </Button>
          </div>

          <p className="flex flex-wrap items-center gap-1 text-sm text-fg-base">
            <span>{statusLabel(row.source_status)}</span>
            <Icon name="action.forward" className="size-3.5 text-fg-faint" />
            <span>{statusLabel(row.target_status)}</span>
          </p>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-2xs font-semibold text-fg-muted">{text.columns.roles}</span>
            {row.roles.length === 0 ? (
              <span className="text-sm text-status-danger-fg">{text.noRoles}</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {row.roles.map((roleCd) => (
                  <Badge key={roleCd} variant="outline">
                    {roleLabel(roleCd)}
                  </Badge>
                ))}
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-2xs font-semibold text-fg-muted">{text.columns.requires}</span>
            {row.requires.length === 0 ? (
              <span className="text-2xs text-fg-faint">{text.noRequires}</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {row.requires.map((name) => (
                  <Code key={name}>{name}</Code>
                ))}
              </span>
            )}
          </div>

          <RuleChips row={row} labels={labels} />

          <p className="text-2xs text-fg-faint text-pretty">
            <span className="font-semibold">{text.noteLabel}: </span>
            {row.note ?? text.noNote}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Edit, then confirm, in one dialog.
 *
 * Two steps rather than one: the edit step is where the admin expresses an
 * intention, the confirm step is where they read what it does to officers. A
 * single screen with a Save button lets them do the first without the second.
 */
function TransitionDialog({
  row,
  roleCds,
  labels,
  roleLabel,
  statusLabel,
  canManage,
  onClose,
  onSaved,
}: {
  row: PolicyTransition;
  roleCds: readonly string[];
  labels: PolicyLabels;
  roleLabel: (roleCd: string) => string;
  statusLabel: (value: string | null) => string;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = labels.transitions;
  const patchTransition = usePatchTransition();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [field, setField] = useState("");
  const [refused, setRefused] = useState<IcmsApiError | null>(null);

  const phrase = labels.actionPhrase(row.action_cd);
  const patch = useMemo(() => patchOf(row, draft), [row, draft]);
  const dirty = Object.keys(patch).length > 0;
  const fieldValid = field === "" || FIELD_PATTERN.test(field);
  const id = String(row.id);

  /* ---- the consequence, in sentences ------------------------------------ */
  const sentences = useMemo<Sentence[]>(() => {
    const out: Sentence[] = [];

    if (draft.active !== row.active) {
      out.push(
        draft.active
          ? { key: "active-on", text: text.changeActiveOn, tone: "add" }
          : { key: "active-off", text: text.changeActiveOff(phrase), tone: "warn" },
      );
    }

    for (const roleCd of draft.roles) {
      if (!row.roles.includes(roleCd)) {
        out.push({
          key: `role+${roleCd}`,
          text: text.changeRoleAdded(roleLabel(roleCd), phrase),
          tone: "add",
        });
      }
    }
    for (const roleCd of row.roles) {
      if (!draft.roles.includes(roleCd)) {
        out.push({
          key: `role-${roleCd}`,
          text: text.changeRoleRemoved(roleLabel(roleCd), phrase),
          tone: "remove",
        });
      }
    }

    if (draft.assignee_only !== row.assignee_only) {
      out.push({
        key: "assignee",
        text: draft.assignee_only
          ? text.changeAssigneeOnlyOn(phrase)
          : text.changeAssigneeOnlyOff(phrase),
        tone: draft.assignee_only ? "warn" : "remove",
      });
    }

    for (const name of draft.requires) {
      if (!row.requires.includes(name)) {
        out.push({ key: `req+${name}`, text: text.changeRequiresAdded(name, phrase), tone: "add" });
      }
    }
    for (const name of row.requires) {
      if (!draft.requires.includes(name)) {
        out.push({
          key: `req-${name}`,
          text: text.changeRequiresRemoved(name, phrase),
          tone: "remove",
        });
      }
    }

    if (draft.note !== (row.note ?? "")) {
      out.push({ key: "note", text: text.changeNote, tone: "remove" });
    }

    // Not a change in itself — a state the change would leave behind, and the
    // one an admin is most likely to reach by unticking one box too many.
    if (draft.roles.length === 0) {
      out.push({ key: "nobody", text: text.nobodyWarning(phrase), tone: "warn" });
    }

    return out;
  }, [draft, row, phrase, roleLabel, text]);

  const apply = () => {
    patchTransition.mutate(
      { id: row.id, patch },
      {
        onSuccess: () => {
          onSaved();
          onClose();
        },
        onError: (cause) => {
          setStep("edit");
          if (cause instanceof IcmsApiError) setRefused(cause);
        },
      },
    );
  };

  const addField = () => {
    const value = field.trim();
    if (value === "" || !FIELD_PATTERN.test(value) || draft.requires.includes(value)) return;
    setDraft((current) => ({ ...current, requires: [...current.requires, value] }));
    setField("");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.actionName(row.action_cd)}</DialogTitle>
          <DialogDescription>
            {statusLabel(row.source_status)} → {statusLabel(row.target_status)} ·{" "}
            {text.stage(row.stage_no)}
          </DialogDescription>
        </DialogHeader>

        {refused && (
          <PolicyRefusal
            labels={labels}
            title={text.refusedTitle}
            body={refused.message}
            requestId={refused.requestId}
          />
        )}

        {step === "edit" ? (
          <div className="flex min-w-0 flex-col gap-5">
            {/* What cannot be changed, said before the things that can. */}
            <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
              <p className="text-sm font-medium text-fg-strong">{text.fixedTitle}</p>
              <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">
                {text.fixedBody}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-fg-faint">{text.columns.action}</dt>
                  <dd>
                    <Code>{row.action_cd}</Code>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-fg-faint">{text.columns.from}</dt>
                  <dd className="text-fg-base">{statusLabel(row.source_status)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-fg-faint">{text.columns.to}</dt>
                  <dd className="text-fg-base">{statusLabel(row.target_status)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-fg-faint">{text.columns.stage}</dt>
                  <dd className="text-fg-base tabular">{text.stage(row.stage_no)}</dd>
                </div>
              </dl>
            </div>

            {row.note && (
              <p className="max-w-prose text-2xs text-fg-muted text-pretty">
                <span className="font-semibold">{text.noteLabel}: </span>
                {row.note}
              </p>
            )}

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="text-sm font-medium text-fg-strong">{text.rolesLabel}</legend>
              {roleCds.map((roleCd) => (
                <label
                  key={roleCd}
                  htmlFor={`t-${id}-role-${roleCd}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`t-${id}-role-${roleCd}`}
                    checked={draft.roles.includes(roleCd)}
                    disabled={!canManage}
                    onCheckedChange={(next) => {
                      setDraft((current) => ({
                        ...current,
                        roles:
                          next === true
                            ? [...current.roles, roleCd].sort()
                            : current.roles.filter((value) => value !== roleCd),
                      }));
                    }}
                  />
                  <span className="text-fg-base">{roleLabel(roleCd)}</span>
                  <Code>{roleCd}</Code>
                </label>
              ))}
            </fieldset>

            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`t-${id}-field`}>{text.requiresLabel}</Label>
              <p className="max-w-prose text-2xs text-fg-faint text-pretty">
                {text.requiresHint}
              </p>
              {draft.requires.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {draft.requires.map((name) => (
                    <li key={name}>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!canManage}
                        aria-label={text.requiresRemove(name)}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            requires: current.requires.filter((value) => value !== name),
                          }));
                        }}
                      >
                        <span className="font-mono">{name}</span>
                        <Icon name="action.close" className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-start gap-2">
                <Input
                  id={`t-${id}-field`}
                  className="max-w-[16rem] font-mono"
                  value={field}
                  disabled={!canManage}
                  placeholder={text.requiresPlaceholder}
                  aria-invalid={!fieldValid}
                  onChange={(event) => {
                    setField(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addField();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  disabled={!canManage || field.trim() === "" || !fieldValid}
                  onClick={addField}
                >
                  <Icon name="action.add" className="size-4" />
                  {text.requiresAdd}
                </Button>
              </div>
              {!fieldValid && (
                <p className="text-2xs text-status-danger-fg">{text.requiresInvalid}</p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor={`t-${id}-assignee`}>{text.assigneeOnlyLabel}</Label>
                  <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">
                    {text.assigneeOnlyHint}
                  </p>
                </div>
                <Switch
                  id={`t-${id}-assignee`}
                  checked={draft.assignee_only}
                  disabled={!canManage}
                  onCheckedChange={(next) => {
                    setDraft((current) => ({ ...current, assignee_only: next }));
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor={`t-${id}-active`}>{text.activeLabel}</Label>
                  <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">
                    {text.activeHint}
                  </p>
                </div>
                <Switch
                  id={`t-${id}-active`}
                  checked={draft.active}
                  disabled={!canManage}
                  onCheckedChange={(next) => {
                    setDraft((current) => ({ ...current, active: next }));
                  }}
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`t-${id}-note`}>{text.noteEditLabel}</Label>
              <p className="max-w-prose text-2xs text-fg-faint text-pretty">
                {text.noteEditHint}
              </p>
              <Textarea
                id={`t-${id}-note`}
                rows={3}
                maxLength={2000}
                value={draft.note}
                disabled={!canManage}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, note: event.target.value }));
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm font-medium text-fg-strong text-pretty">{text.confirmTitle}</p>
            <ul className="flex flex-col gap-2">
              {sentences.map((sentence) => (
                <li
                  key={sentence.key}
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm text-pretty ${
                    sentence.tone === "warn"
                      ? "border-status-danger-border bg-status-danger text-status-danger-fg"
                      : sentence.tone === "add"
                        ? "border-status-success-border bg-status-success text-status-success-fg"
                        : "border-line-subtle bg-surface-2 text-fg-base"
                  }`}
                >
                  <Icon
                    name={
                      sentence.tone === "warn"
                        ? "feedback.warning"
                        : sentence.tone === "add"
                          ? "action.confirm"
                          : "form.minus"
                    }
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>{sentence.text}</span>
                </li>
              ))}
            </ul>
            <p className="max-w-prose text-2xs text-fg-faint text-pretty">{text.confirmBody}</p>
          </div>
        )}

        <DialogFooter>
          {step === "edit" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {text.cancel}
              </Button>
              <Button
                disabled={!canManage || !dirty}
                onClick={() => {
                  setRefused(null);
                  setStep("confirm");
                }}
              >
                {dirty ? text.review : text.noChanges}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={patchTransition.isPending}
                onClick={() => {
                  setStep("edit");
                }}
              >
                <Icon name="action.back" className="size-4" />
                {text.cancel}
              </Button>
              <Button disabled={patchTransition.isPending} onClick={apply}>
                <Icon
                  name={patchTransition.isPending ? "feedback.loading" : "action.confirm"}
                  spin={patchTransition.isPending}
                  className="size-4"
                />
                {patchTransition.isPending ? text.confirming : text.confirmAction}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
