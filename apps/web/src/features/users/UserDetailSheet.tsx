/**
 * One officer: their name and sign-in, their roles, and their credential.
 *
 * ## Three sections, three independent writes
 *
 * PATCH the account, PUT the roles, POST the password. They are three
 * endpoints, three permission checks and three failure modes, so they are three
 * forms with three Save buttons rather than one. A single Save would have to
 * decide what "partly saved" means, and the honest answer — roles landed, the
 * rename did not — is exactly what three buttons say by themselves.
 *
 * ## Drafts are overrides, not copies
 *
 * Each section holds only what the admin has CHANGED; everything else renders
 * from the server's answer. That is what makes a save survivable: clearing the
 * draft shows the server's new value at once, including a name Keycloak
 * canonicalised on the way in, and a refused write leaves the edit on screen
 * where it can be fixed. A local copy of the record cannot express either
 * without a second bookkeeping structure that then has to be kept honest.
 *
 * ## The role editor replaces
 *
 * `PUT /roles` carries the complete set. Every role left unticked is removed,
 * the review list says so in words before anything is sent, and nothing leaves
 * the browser until Save is pressed.
 */

import { useRef, useState } from "react";
import { IcmsApiError } from "@/api/icms/http";
import {
  ASSIGNABLE_ROLES,
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  USER_NOT_FOUND,
  type UserDetail,
  type UserUpdate,
} from "@/api/icms/users";
import { EmptyState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import type { UserLabels } from "./labels";
import { displayName } from "./officer";
import {
  Code,
  PasswordPair,
  RoleSetEditor,
  SignInState,
  TextField,
  UserLoadError,
  UserRefusal,
  UserSaved,
  type PasswordValidity,
} from "./parts";
import { useResetPassword, useSetUserRoles, useUpdateUser, useUserDetail } from "./useUsers";

const SUPER_ADMIN = "super-admin";

export default function UserDetailSheet({
  userId,
  onClose,
  labels,
  canManage,
  selfUserId,
}: {
  userId: string | null;
  onClose: () => void;
  labels: UserLabels;
  canManage: boolean;
  selfUserId: string | null;
}) {
  const { data, status, error, refetch } = useUserDetail(userId);
  const notFound = error instanceof IcmsApiError && error.code === USER_NOT_FOUND;

  return (
    <Sheet
      open={userId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* No aria-label: the SheetTitle below names the panel, and it names it
          with the officer rather than with the word "detail". */}
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {status === "pending" && (
          <div className="flex flex-col gap-4 p-4" aria-busy aria-live="polite">
            <SheetHeader className="px-0">
              <SheetTitle>{labels.detail.openLabel}</SheetTitle>
              <SheetDescription>{labels.detail.loading}</SheetDescription>
            </SheetHeader>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader className="px-0">
              <SheetTitle>{labels.detail.openLabel}</SheetTitle>
              <SheetDescription className="sr-only">
                {labels.detail.notFoundTitle}
              </SheetDescription>
            </SheetHeader>
            {notFound ? (
              <EmptyState
                size="compact"
                icon="feedback.noResults"
                title={labels.detail.notFoundTitle}
                description={labels.detail.notFoundBody}
              />
            ) : (
              <UserLoadError
                error={error}
                labels={labels}
                onRetry={() => {
                  void refetch();
                }}
              />
            )}
          </div>
        )}

        {status === "success" && (
          <OfficerBody
            // Keyed on the id so opening a different officer starts with empty
            // drafts; a refetch of the SAME officer keeps whatever is in hand.
            key={data.id}
            detail={data}
            labels={labels}
            canManage={canManage}
            isSelf={data.id === selfUserId}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OfficerBody({
  detail,
  labels,
  canManage,
  isSelf,
}: {
  detail: UserDetail;
  labels: UserLabels;
  canManage: boolean;
  isSelf: boolean;
}) {
  const formats = useFormats();
  const name = displayName(detail);

  return (
    <>
      <SheetHeader className="gap-2 border-b border-line-subtle">
        <SheetTitle className="font-display text-xl text-balance">{name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <Code>{detail.username}</Code>
              <SignInState enabled={detail.enabled} labels={labels} />
              {isSelf && <Badge variant="secondary">{labels.detail.self}</Badge>}
            </span>
            <span className="text-2xs text-fg-faint">
              {detail.created_at == null
                ? labels.detail.createdUnknown
                : labels.detail.created(formats.dateTime(detail.created_at))}
            </span>
            <span className="flex flex-wrap items-center gap-1 text-2xs text-fg-faint">
              {labels.detail.subject} <Code>{detail.id}</Code>
            </span>
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 p-4">
        <RequiredActions detail={detail} labels={labels} />
        <IdentitySection
          detail={detail}
          labels={labels}
          canManage={canManage}
          isSelf={isSelf}
        />
        <RolesSection detail={detail} labels={labels} canManage={canManage} isSelf={isSelf} />
        <PasswordSection detail={detail} labels={labels} canManage={canManage} />
      </div>
    </>
  );
}

/** What Keycloak will make this officer do before it lets them work. */
function RequiredActions({ detail, labels }: { detail: UserDetail; labels: UserLabels }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-fg-strong">
        {labels.detail.requiredActionsTitle}
      </h3>
      {detail.required_actions.length === 0 ? (
        <p className="text-2xs text-fg-faint">{labels.detail.requiredActionsNone}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.required_actions.map((action) => (
            <li key={action} className="flex items-start gap-2 text-2xs text-fg-muted">
              <Icon name="feedback.info" className="mt-0.5 size-3.5 shrink-0" />
              <span className="text-pretty">{labels.requiredAction(action)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type IdentityDraft = {
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
};

function IdentitySection({
  detail,
  labels,
  canManage,
  isSelf,
}: {
  detail: UserDetail;
  labels: UserLabels;
  canManage: boolean;
  isSelf: boolean;
}) {
  const update = useUpdateUser();
  const [draft, setDraft] = useState<IdentityDraft>({});
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const text = labels.identity;
  const serverFirst = detail.first_name ?? "";
  const serverLast = detail.last_name ?? "";
  const serverEmail = detail.email ?? "";

  const firstName = draft.firstName ?? serverFirst;
  const lastName = draft.lastName ?? serverLast;
  const email = draft.email ?? serverEmail;
  const enabled = draft.enabled ?? detail.enabled;

  const dirty =
    firstName !== serverFirst ||
    lastName !== serverLast ||
    email !== serverEmail ||
    enabled !== detail.enabled;

  const failure = update.error instanceof IcmsApiError ? update.error : null;
  const busy = !canManage || update.isPending;

  const save = () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setEmailError(address === "" ? text.emailRequired : labels.create.emailInvalid);
      return;
    }
    setEmailError(null);

    // Only the keys that actually moved: `UserUpdate` refuses an empty patch,
    // and a key sent unchanged is a write nobody asked for.
    const patch: UserUpdate = {};
    if (firstName !== serverFirst) patch.first_name = firstName.trim() || null;
    if (lastName !== serverLast) patch.last_name = lastName.trim() || null;
    if (address !== serverEmail) patch.email = address;
    if (enabled !== detail.enabled) patch.enabled = enabled;

    update.mutate(
      { userId: detail.id, patch },
      {
        onSuccess: () => {
          setDraft({});
          setSaved(true);
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4">
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-fg-strong">{text.title}</h3>
        <p className="text-2xs text-fg-muted text-pretty">{text.subtitle}</p>
      </header>

      {saved && !dirty && (
        <UserSaved
          title={text.savedTitle}
          body={text.savedBody}
          dismissLabel={labels.detail.close}
          onDismiss={() => {
            setSaved(false);
          }}
        />
      )}

      {failure && (
        <UserRefusal
          labels={labels}
          title={labels.error.refusedTitle}
          body={failure.message}
          requestId={failure.requestId}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{text.usernameLabel}</Label>
        <p className="flex flex-wrap items-center gap-2">
          <Code>{detail.username}</Code>
          <span className="text-2xs text-fg-faint">{text.usernameFixed}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={text.firstNameLabel}
          value={firstName}
          disabled={busy}
          maxLength={200}
          onChange={(value) => {
            setDraft((current) => ({ ...current, firstName: value }));
          }}
        />
        <TextField
          label={text.lastNameLabel}
          value={lastName}
          disabled={busy}
          maxLength={200}
          onChange={(value) => {
            setDraft((current) => ({ ...current, lastName: value }));
          }}
        />
      </div>

      <TextField
        label={text.emailLabel}
        value={email}
        type="email"
        required
        hint={text.emailHint}
        error={emailError ?? (failure?.field === "email" ? failure.message : null)}
        disabled={busy}
        maxLength={254}
        onChange={(value) => {
          setDraft((current) => ({ ...current, email: value }));
        }}
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <Switch
            id={`enabled-${detail.id}`}
            checked={enabled}
            disabled={busy}
            aria-describedby={`enabled-${detail.id}-state`}
            onCheckedChange={(next) => {
              setDraft((current) => ({ ...current, enabled: next }));
            }}
          />
          <Label htmlFor={`enabled-${detail.id}`} className="text-pretty">
            {text.enabledLabel}
          </Label>
        </div>
        {/* The switch's position said in words: a toggle read by a screen reader
            is "on", and "on" is not what this one means. */}
        <p id={`enabled-${detail.id}-state`} className="text-2xs text-fg-faint text-pretty">
          {enabled ? text.enabledOn : text.enabledOff}
        </p>
        <p className="max-w-prose text-2xs text-fg-faint text-pretty">{text.leaveHint}</p>
      </div>

      {isSelf && !enabled && (
        <p className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning p-3 text-2xs text-status-warning-fg">
          <Icon name="feedback.warning" className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-pretty">{text.selfDisableWarning}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !dirty} onClick={save}>
          <Icon
            name={update.isPending ? "feedback.loading" : "action.save"}
            spin={update.isPending}
            className="size-4"
          />
          {update.isPending ? text.saving : text.save}
        </Button>
        <Button
          variant="outline"
          disabled={!dirty || update.isPending}
          onClick={() => {
            setDraft({});
            setEmailError(null);
          }}
        >
          {text.discard}
        </Button>
        {!dirty && <span className="text-2xs text-fg-faint">{text.noChanges}</span>}
      </div>
    </section>
  );
}

function RolesSection({
  detail,
  labels,
  canManage,
  isSelf,
}: {
  detail: UserDetail;
  labels: UserLabels;
  canManage: boolean;
  isSelf: boolean;
}) {
  const save = useSetUserRoles();
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const text = labels.roles;
  const held = detail.realm_roles;
  const selected = draft ?? held;

  const added = selected.filter((role) => !held.includes(role));
  const removed = held.filter((role) => !selected.includes(role));
  const dirty = added.length > 0 || removed.length > 0;

  const failure = save.error instanceof IcmsApiError ? save.error : null;
  const losingSuperAdmin = isSelf && removed.includes(SUPER_ADMIN);
  const officer = displayName(detail);

  const toggle = (roleCd: string, keep: boolean) => {
    const now = new Set(selected);
    if (keep) now.add(roleCd);
    else now.delete(roleCd);
    // Sorted, because this array IS the request body and a stable order makes
    // two identical sets compare equal in a log.
    setDraft([...now].sort());
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4">
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-fg-strong">{text.title}</h3>
        <p className="text-2xs text-fg-muted text-pretty">{text.subtitle}</p>
      </header>

      {saved && !dirty && (
        <UserSaved
          title={text.savedTitle}
          body={text.savedBody(officer)}
          dismissLabel={labels.detail.close}
          onDismiss={() => {
            setSaved(false);
          }}
        />
      )}

      {failure && (
        <UserRefusal
          labels={labels}
          title={labels.error.refusedTitle}
          body={failure.message}
          hint={
            failure.allowed && failure.allowed.length > 0
              ? failure.allowed.map((role) => labels.role(role)).join(", ")
              : undefined
          }
          requestId={failure.requestId}
        />
      )}

      <RoleSetEditor
        roles={ASSIGNABLE_ROLES}
        selected={selected}
        onToggle={toggle}
        labels={labels}
        disabled={!canManage || save.isPending}
        officerName={officer}
        legend={text.title}
        hint={text.fullSetNote}
      />

      {selected.length === 0 && (
        <p className="flex items-start gap-2 text-2xs text-status-warning-fg">
          <Icon name="feedback.warning" className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-pretty">{text.emptyWarning}</span>
        </p>
      )}

      {losingSuperAdmin && (
        <p className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning p-3 text-2xs text-status-warning-fg">
          <Icon name="feedback.warning" className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-pretty">{text.selfWarning}</span>
        </p>
      )}

      {/* What is about to be sent, in words, before anything is sent. */}
      <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-2 p-3">
        <p className="text-sm font-medium text-fg-strong">{text.reviewTitle}</p>
        {dirty ? (
          <ul className="flex flex-col gap-1">
            {added.map((role) => (
              <li key={`add-${role}`} className="flex items-start gap-2 text-sm text-fg-base">
                <Icon
                  name="action.confirm"
                  className="mt-0.5 size-4 shrink-0 text-status-success-fg"
                />
                <span className="text-pretty">{text.added(labels.role(role))}</span>
              </li>
            ))}
            {removed.map((role) => (
              <li
                key={`remove-${role}`}
                className="flex items-start gap-2 text-sm text-fg-base"
              >
                <Icon
                  name="form.minus"
                  className="mt-0.5 size-4 shrink-0 text-status-danger-fg"
                />
                <span className="text-pretty">{text.removed(labels.role(role))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{text.noChanges}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!canManage || !dirty || save.isPending}
          onClick={() => {
            save.mutate(
              { userId: detail.id, realmRoles: selected },
              {
                onSuccess: () => {
                  setDraft(null);
                  setSaved(true);
                },
              },
            );
          }}
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
          disabled={!dirty || save.isPending}
          onClick={() => {
            setDraft(null);
          }}
        >
          {text.discard}
        </Button>
        {!canManage && <span className="text-2xs text-fg-faint">{text.denied}</span>}
      </div>
    </section>
  );
}

function PasswordSection({
  detail,
  labels,
  canManage,
}: {
  detail: UserDetail;
  labels: UserLabels;
  canManage: boolean;
}) {
  const formats = useFormats();
  const reset = useResetPassword();
  const [temporary, setTemporary] = useState(true);
  const [validity, setValidity] = useState<PasswordValidity>({
    tooShort: false,
    mismatch: false,
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const text = labels.password;
  const failure = reset.error instanceof IcmsApiError ? reset.error : null;
  const receipt = reset.result;

  const submit = () => {
    // Read once, here, and dropped when this function returns.
    const password = passwordRef.current?.value ?? "";
    const confirm = confirmRef.current?.value ?? "";
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(text.tooShort(MIN_PASSWORD_LENGTH));
      return;
    }
    if (password !== confirm) {
      setLocalError(text.mismatch);
      return;
    }
    setLocalError(null);

    void reset.submit({ userId: detail.id, password, temporary }).then((answer) => {
      if (answer === null) return;
      if (passwordRef.current) passwordRef.current.value = "";
      if (confirmRef.current) confirmRef.current.value = "";
      setValidity({ tooShort: false, mismatch: false });
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4">
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-fg-strong">{text.title}</h3>
        <p className="text-2xs text-fg-muted text-pretty">{text.subtitle}</p>
      </header>

      {/* The receipt names the officer and the time. It cannot name the
          credential: `PasswordResetOut` does not carry one. */}
      {receipt && (
        <UserSaved
          title={text.doneTitle(receipt.username)}
          body={
            <>
              {text.doneBody(formats.dateTime(receipt.reset_at))}{" "}
              {receipt.temporary ? text.doneTemporary : text.donePermanent}
            </>
          }
        />
      )}

      {failure && (
        <UserRefusal
          labels={labels}
          title={labels.error.refusedTitle}
          body={failure.message}
          requestId={failure.requestId}
        />
      )}

      <PasswordPair
        passwordRef={passwordRef}
        confirmRef={confirmRef}
        passwordLabel={text.passwordLabel}
        confirmLabel={text.confirmLabel}
        hint={text.hint(MIN_PASSWORD_LENGTH)}
        tooShortMessage={text.tooShort(MIN_PASSWORD_LENGTH)}
        mismatchMessage={text.mismatch}
        validity={validity}
        onValidityChange={setValidity}
        disabled={!canManage || reset.pending}
      />

      {localError !== null && (
        <p role="alert" className="text-2xs text-status-danger-fg text-pretty">
          {localError}
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <Switch
            id={`temporary-${detail.id}`}
            checked={temporary}
            disabled={!canManage || reset.pending}
            aria-describedby={`temporary-${detail.id}-state`}
            onCheckedChange={setTemporary}
          />
          <Label htmlFor={`temporary-${detail.id}`} className="text-pretty">
            {text.temporaryLabel}
          </Label>
        </div>
        <p id={`temporary-${detail.id}-state`} className="text-2xs text-fg-faint text-pretty">
          {temporary ? text.temporaryOn : text.temporaryOff}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!canManage || reset.pending} onClick={submit}>
          <Icon
            name={reset.pending ? "feedback.loading" : "user.password"}
            spin={reset.pending}
            className="size-4"
          />
          {reset.pending ? text.submitting : text.submit}
        </Button>
        {!canManage && <span className="text-2xs text-fg-faint">{text.denied}</span>}
      </div>
    </section>
  );
}
