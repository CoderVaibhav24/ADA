/**
 * Create an officer.
 *
 * ## The credential decision is the first-class control, not a password box
 *
 * `UserCreate` offers two: `update_password`, which sends NO credential and
 * lets Keycloak require the officer to choose one at first sign-in, and
 * `temporary_password`, which sends one the officer must still replace. The
 * first is the default and is the one a government portal should want — nothing
 * is handled by the portal, so there is nothing to hand over, nothing to
 * transcribe and nothing to leak. The password fields exist only on the second
 * branch, and `UserCreateInput` is a union so that "chose update_password and
 * sent a password" cannot be constructed.
 *
 * ## Why a failure here is not a retry
 *
 * Creation is three Keycloak calls and cannot be a transaction. A break between
 * any two leaves the account existing and DISABLED, which the server answers as
 * 503 `user_partially_created` — and the username is now taken, so sending the
 * form again is refused as a duplicate. That outcome gets its own panel and
 * puts the submit button beyond use, because the one thing an admin must not do
 * after seeing it is press Create again.
 */

import { useRef, useState, type FormEvent } from "react";
import { IcmsApiError } from "@/api/icms/http";
import {
  ASSIGNABLE_ROLES,
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  USERNAME_PATTERN,
  USER_EXISTS,
  USER_PARTIALLY_CREATED,
  type CredentialChoice,
  type UserDetail,
} from "@/api/icms/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/lib/icons";
import type { UserLabels } from "./labels";
import {
  Code,
  PasswordPair,
  RoleSetEditor,
  TextField,
  UserRefusal,
  type PasswordValidity,
} from "./parts";
import { useCreateUser } from "./useUsers";

type FieldErrors = {
  username?: string;
  email?: string;
  password?: string;
};

export default function UserCreateDialog({
  open,
  onOpenChange,
  labels,
  canManage,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: UserLabels;
  canManage: boolean;
  onCreated: (user: UserDetail) => void;
}) {
  const create = useCreateUser();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [credential, setCredential] = useState<CredentialChoice>("update_password");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validity, setValidity] = useState<PasswordValidity>({
    tooShort: false,
    mismatch: false,
  });

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const text = labels.create;
  const failure = create.error instanceof IcmsApiError ? create.error : null;
  const halted = failure?.code === USER_PARTIALLY_CREATED;
  const created = create.result;
  const busy = !canManage || create.pending;

  const close = () => {
    onOpenChange(false);
    // Reset on dismissal rather than on mount, so a refusal stays readable for
    // as long as the panel is open.
    setUsername("");
    setEmail("");
    setFirstName("");
    setLastName("");
    setEnabled(true);
    setRoles([]);
    setCredential("update_password");
    setErrors({});
    setValidity({ tooShort: false, mismatch: false });
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmRef.current) confirmRef.current.value = "";
    create.reset();
  };

  const toggleRole = (roleCd: string, held: boolean) => {
    setRoles((current) => {
      const now = new Set(current);
      if (held) now.add(roleCd);
      else now.delete(roleCd);
      return [...now];
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || halted) return;

    const nextErrors: FieldErrors = {};
    const name = username.trim().toLowerCase();
    const address = email.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(name)) nextErrors.username = text.usernameInvalid;
    if (!EMAIL_PATTERN.test(address)) nextErrors.email = text.emailInvalid;

    // Read once, inside the handler, and never stored: the two inputs are
    // uncontrolled precisely so the credential never becomes component state.
    let password = "";
    if (credential === "temporary_password") {
      password = passwordRef.current?.value ?? "";
      const confirm = confirmRef.current?.value ?? "";
      if (password.length < MIN_PASSWORD_LENGTH) {
        nextErrors.password = text.passwordTooShort(MIN_PASSWORD_LENGTH);
      } else if (password !== confirm) {
        nextErrors.password = text.passwordMismatch;
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const base = {
      username: name,
      email: address,
      firstName,
      lastName,
      enabled,
      realmRoles: roles,
    };

    void create
      .submit(
        credential === "temporary_password"
          ? { ...base, credential: "temporary_password", password }
          : { ...base, credential: "update_password" },
      )
      .then((answer) => {
        if (answer === null) return;
        if (passwordRef.current) passwordRef.current.value = "";
        if (confirmRef.current) confirmRef.current.value = "";
      });
  };

  // The server names the colliding field in `field`; its message is Keycloak's
  // own prose, so for the one refusal we can phrase better we phrase it here.
  const serverFieldError = (field: string): string | null => {
    if (!failure || failure.field !== field) return null;
    if (failure.code === USER_EXISTS) {
      return field === "email" ? text.takenEmail : text.takenUsername;
    }
    return failure.message;
  };

  const passwordError = errors.password ?? serverFieldError("password");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription className="text-pretty">{text.description}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            <div className="flex flex-col items-start gap-2 rounded-md border border-status-success-border bg-status-success p-4 text-status-success-fg">
              <p className="flex items-center gap-2 font-medium">
                <Icon name="feedback.success" className="size-4 shrink-0" />
                {text.createdTitle(created.username)}
              </p>
              <p className="text-sm text-pretty">{text.createdBody}</p>
              <Code>{created.id}</Code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                {text.close}
              </Button>
              <Button
                onClick={() => {
                  close();
                  onCreated(created);
                }}
              >
                {text.createdOpen(created.username)}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
            {halted && failure && (
              <UserRefusal
                labels={labels}
                title={text.partialTitle}
                body={failure.message}
                hint={text.partialHint}
                requestId={failure.requestId}
              />
            )}

            {failure && !halted && failure.field === null && (
              <UserRefusal
                labels={labels}
                title={labels.error.refusedTitle}
                body={failure.message}
                requestId={failure.requestId}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={text.usernameLabel}
                value={username}
                onChange={setUsername}
                hint={text.usernameHint}
                error={errors.username ?? serverFieldError("username")}
                required
                disabled={busy}
                autoComplete="off"
                maxLength={64}
              />
              <TextField
                label={text.emailLabel}
                value={email}
                onChange={setEmail}
                hint={text.emailHint}
                error={errors.email ?? serverFieldError("email")}
                required
                type="email"
                disabled={busy}
                autoComplete="off"
                maxLength={254}
              />
              <TextField
                label={text.firstNameLabel}
                value={firstName}
                onChange={setFirstName}
                disabled={busy}
                autoComplete="off"
                maxLength={200}
              />
              <TextField
                label={text.lastNameLabel}
                value={lastName}
                onChange={setLastName}
                disabled={busy}
                autoComplete="off"
                maxLength={200}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <Switch
                  id="create-enabled"
                  checked={enabled}
                  disabled={busy}
                  aria-describedby="create-enabled-hint"
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="create-enabled" className="text-pretty">
                  {text.enabledLabel}
                </Label>
              </div>
              <p id="create-enabled-hint" className="text-2xs text-fg-faint text-pretty">
                {text.enabledHint}
              </p>
            </div>

            <RoleSetEditor
              roles={ASSIGNABLE_ROLES}
              selected={roles}
              onToggle={toggleRole}
              labels={labels}
              disabled={busy}
              legend={text.rolesLegend}
              hint={text.rolesHint}
            />
            {roles.length === 0 && (
              <p className="flex items-start gap-2 text-2xs text-status-warning-fg">
                <Icon name="feedback.warning" className="mt-0.5 size-3.5 shrink-0" />
                <span className="text-pretty">{text.rolesEmpty}</span>
              </p>
            )}

            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="text-sm font-medium text-fg-strong">
                {text.credentialLegend}
              </legend>
              <RadioGroup
                value={credential}
                disabled={busy}
                className="gap-3"
                onValueChange={(next) => {
                  setCredential(next as CredentialChoice);
                }}
              >
                <div className="flex items-start gap-2 rounded-md border border-line-subtle bg-surface-2 p-3">
                  <RadioGroupItem
                    id="credential-self"
                    value="update_password"
                    className="mt-0.5"
                    aria-describedby="credential-self-hint"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor="credential-self" className="text-pretty">
                      {text.credentialSelf}
                    </Label>
                    <p id="credential-self-hint" className="text-2xs text-fg-muted text-pretty">
                      {text.credentialSelfHint}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-md border border-line-subtle bg-surface-2 p-3">
                  <RadioGroupItem
                    id="credential-temporary"
                    value="temporary_password"
                    className="mt-0.5"
                    aria-describedby="credential-temporary-hint"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor="credential-temporary" className="text-pretty">
                      {text.credentialTemporary}
                    </Label>
                    <p
                      id="credential-temporary-hint"
                      className="text-2xs text-fg-muted text-pretty"
                    >
                      {text.credentialTemporaryHint}
                    </p>
                  </div>
                </div>
              </RadioGroup>

              {credential === "temporary_password" && (
                <>
                  <PasswordPair
                    passwordRef={passwordRef}
                    confirmRef={confirmRef}
                    passwordLabel={text.passwordLabel}
                    confirmLabel={text.passwordConfirmLabel}
                    hint={text.passwordHint(MIN_PASSWORD_LENGTH)}
                    tooShortMessage={text.passwordTooShort(MIN_PASSWORD_LENGTH)}
                    mismatchMessage={text.passwordMismatch}
                    validity={validity}
                    onValidityChange={setValidity}
                    disabled={busy}
                  />
                  {passwordError !== null && (
                    <p role="alert" className="text-2xs text-status-danger-fg text-pretty">
                      {passwordError}
                    </p>
                  )}
                </>
              )}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {text.cancel}
              </Button>
              <Button type="submit" disabled={busy || halted}>
                <Icon
                  name={create.pending ? "feedback.loading" : "action.add"}
                  spin={create.pending}
                  className="size-4"
                />
                {create.pending ? text.submitting : text.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
