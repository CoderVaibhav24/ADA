/**
 * The pieces the register, the create form and the detail panel share.
 *
 * Two are worth reading before changing anything.
 *
 * `SignInState` is a chip of its own rather than `components/icms/StatusChip`.
 * That primitive takes a `StatusValue` from the case, inspection and notice
 * vocabularies — `completed`, `overdue`, `noticeIssued` — and stamps it into a
 * `data-status` attribute. "Can sign in" is none of those, and borrowing the
 * nearest-looking one would put a lie in the DOM for the sake of a colour.
 *
 * `PasswordPair` keeps the credential OUT of React state. The inputs are
 * uncontrolled and the parent reads them through refs at submit; what this
 * component tracks is two booleans — too short, and the two entries differ —
 * which is enough for live validation and is not a password. A controlled
 * input would put the credential in the component tree, in every render's
 * props, and in any state snapshot a devtool takes.
 */

import { useId, useState, type ReactNode, type RefObject } from "react";
import { IcmsApiError } from "@/api/icms/http";
import { MIN_PASSWORD_LENGTH } from "@/api/icms/users";
import { ErrorState } from "@/components/icms/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/lib/icons";
import type { UserLabels } from "./labels";

/** A code an officer reads down a phone, so it never gets a display font. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-2xs break-all text-fg-base">
      {children}
    </code>
  );
}

/** The card each section sits in, so the register and the panels match. */
export function UserPanel({
  title,
  subtitle,
  aside,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose min-w-0">
          <h2 className="font-display text-lg font-semibold text-fg-strong">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-fg-muted text-pretty">{subtitle}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** A load that failed. The request id is what ties it to the server's log line. */
export function UserLoadError({
  error,
  onRetry,
  labels,
}: {
  error: unknown;
  onRetry: () => void;
  labels: UserLabels;
}) {
  const api = error instanceof IcmsApiError ? error : null;
  return (
    <ErrorState
      size="compact"
      title={labels.error.title}
      description={api?.message ?? labels.error.body}
      detail={api?.requestId ?? undefined}
      onRetry={onRetry}
      retryLabel={labels.error.retry}
    />
  );
}

/** A refusal the server made on purpose — a decision, not a malfunction. */
export function UserRefusal({
  title,
  body,
  hint,
  requestId,
  labels,
  tone = "danger",
}: {
  title: ReactNode;
  body: ReactNode;
  hint?: ReactNode;
  requestId?: string | null;
  labels: UserLabels;
  tone?: "danger" | "warning";
}) {
  return (
    <Alert
      role="alert"
      className={
        tone === "warning"
          ? "border-status-warning-border bg-status-warning text-status-warning-fg"
          : "border-status-danger-border bg-status-danger text-status-danger-fg"
      }
    >
      <Icon name="feedback.warning" className="size-4" />
      <AlertTitle className="text-pretty">{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="text-pretty">{body}</span>
        {hint && <span className="text-pretty">{hint}</span>}
        {requestId && (
          <span className="text-2xs opacity-80">
            {labels.error.requestId} <Code>{requestId}</Code>
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

// Polite rather than assertive: it follows an action the admin took on purpose.
export function UserSaved({
  title,
  body,
  onDismiss,
  dismissLabel,
}: {
  title: ReactNode;
  body?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <Alert
      aria-live="polite"
      className="relative border-status-success-border bg-status-success text-status-success-fg"
    >
      <Icon name="feedback.success" className="size-4" />
      <AlertTitle className={onDismiss ? "pe-20" : undefined}>{title}</AlertTitle>
      {body && (
        <AlertDescription className={onDismiss ? "pe-20" : undefined}>
          <span className="text-pretty">{body}</span>
        </AlertDescription>
      )}
      {onDismiss && dismissLabel && (
        <Button variant="ghost" size="xs" className="absolute end-2 top-2" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      )}
    </Alert>
  );
}

/** Colour is the second signal here; the word is the first. */
export function SignInState({ enabled, labels }: { enabled: boolean; labels: UserLabels }) {
  return (
    <span
      data-enabled={enabled}
      className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium break-words ${
        enabled
          ? "border-status-success-border bg-status-success text-status-success-fg"
          : "border-status-neutral-border bg-status-neutral text-status-neutral-fg"
      }`}
    >
      <Icon
        name={enabled ? "action.confirm" : "user.password"}
        className="size-3.5 shrink-0"
      />
      {enabled ? labels.register.enabled : labels.register.disabled}
    </span>
  );
}

/** A labelled input whose hint and error are both named by `aria-describedby`. */
export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  required = false,
  disabled = false,
  type = "text",
  autoComplete,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-status-danger-fg">*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={described === "" ? undefined : described}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint && (
        <p id={hintId} className="text-2xs text-fg-faint text-pretty">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-2xs text-status-danger-fg text-pretty">
          {error}
        </p>
      )}
    </div>
  );
}

export type RoleSetEditorProps = {
  /** The complete set currently ticked. This IS what the PUT will carry. */
  selected: readonly string[];
  onToggle: (roleCd: string, held: boolean) => void;
  roles: readonly string[];
  labels: UserLabels;
  disabled?: boolean;
  /** Names the officer in each checkbox's accessible name. */
  officerName?: string;
  legend: string;
  hint: ReactNode;
};

/** A checkbox per role and nothing else: the write replaces the whole set. */
export function RoleSetEditor({
  selected,
  onToggle,
  roles,
  labels,
  disabled = false,
  officerName,
  legend,
  hint,
}: RoleSetEditorProps) {
  const prefix = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="text-sm font-medium text-fg-strong">{legend}</legend>
      <p className="max-w-prose text-2xs text-fg-faint text-pretty">{hint}</p>
      <ul className="flex flex-col gap-2">
        {roles.map((roleCd) => {
          const id = `${prefix}-${roleCd}`;
          const roleName = labels.role(roleCd);
          const roleHint = labels.roleHint(roleCd);
          return (
            <li key={roleCd}>
              <label
                htmlFor={id}
                className="flex items-start gap-2 rounded-md border border-line-subtle bg-surface-2 p-3 text-sm text-fg-base"
              >
                <Checkbox
                  id={id}
                  className="mt-0.5 shrink-0"
                  checked={selected.includes(roleCd)}
                  disabled={disabled}
                  aria-label={
                    officerName === undefined
                      ? undefined
                      : labels.roles.cell(roleName, officerName)
                  }
                  onCheckedChange={(next) => {
                    onToggle(roleCd, next === true);
                  }}
                />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="font-medium text-fg-strong">{roleName}</span>
                  {roleHint !== "" && (
                    <span className="text-2xs text-fg-muted text-pretty">{roleHint}</span>
                  )}
                  <Code>{roleCd}</Code>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export type PasswordValidity = { tooShort: boolean; mismatch: boolean };

/** Uncontrolled: the parent reads them at submit — see the note at the top. */
export function PasswordPair({
  passwordRef,
  confirmRef,
  passwordLabel,
  confirmLabel,
  hint,
  tooShortMessage,
  mismatchMessage,
  validity,
  onValidityChange,
  disabled = false,
}: {
  passwordRef: RefObject<HTMLInputElement | null>;
  confirmRef: RefObject<HTMLInputElement | null>;
  passwordLabel: string;
  confirmLabel: string;
  hint: ReactNode;
  tooShortMessage: string;
  mismatchMessage: string;
  validity: PasswordValidity;
  onValidityChange: (validity: PasswordValidity) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const shortId = `${id}-short`;
  const matchId = `${id}-match`;
  // Only after the officer has left a field once: flagging "too short" on the
  // first keystroke is a red message under every password ever typed.
  const [touched, setTouched] = useState(false);

  const check = () => {
    const password = passwordRef.current?.value ?? "";
    const confirm = confirmRef.current?.value ?? "";
    onValidityChange({
      tooShort: password.length > 0 && password.length < MIN_PASSWORD_LENGTH,
      mismatch: confirm.length > 0 && password !== confirm,
    });
  };

  const showShort = touched && validity.tooShort;
  const showMismatch = touched && validity.mismatch;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-password`}>
          {passwordLabel}
          <span className="text-status-danger-fg">*</span>
        </Label>
        <Input
          id={`${id}-password`}
          ref={passwordRef}
          type="password"
          required
          disabled={disabled}
          // `new-password`, so the browser offers to generate one and never
          // autofills the ADMIN's own saved credential into an officer's form.
          autoComplete="new-password"
          spellCheck={false}
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={showShort ? true : undefined}
          aria-describedby={showShort ? `${hintId} ${shortId}` : hintId}
          onChange={check}
          onBlur={() => {
            setTouched(true);
            check();
          }}
        />
        <p id={hintId} className="text-2xs text-fg-faint text-pretty">
          {hint}
        </p>
        {showShort && (
          <p id={shortId} className="text-2xs text-status-danger-fg text-pretty">
            {tooShortMessage}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-confirm`}>
          {confirmLabel}
          <span className="text-status-danger-fg">*</span>
        </Label>
        <Input
          id={`${id}-confirm`}
          ref={confirmRef}
          type="password"
          required
          disabled={disabled}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={showMismatch ? true : undefined}
          aria-describedby={showMismatch ? matchId : undefined}
          onChange={check}
          onBlur={() => {
            setTouched(true);
            check();
          }}
        />
        {showMismatch && (
          <p id={matchId} className="text-2xs text-status-danger-fg text-pretty">
            {mismatchMessage}
          </p>
        )}
      </div>
    </div>
  );
}
