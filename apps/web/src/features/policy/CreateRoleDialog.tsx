import { useState, type FormEvent } from "react";
import { IcmsApiError } from "@/api/icms/http";
import type { RoleGrants } from "@/api/icms/policy";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextField } from "@/features/users/parts";
import type { PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { PolicyRefusal } from "./parts";
import { useCreateRole } from "./usePolicy";

const CODE_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;
const NO_COPY = "__none__";

// "Zone Inspector" -> "zone-inspector"; only a suggestion, the admin can edit it.
function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Creates a Keycloak realm role plus its row; its grants start as a copy of an existing role, or empty.
export default function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
  labels,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: readonly RoleGrants[];
  labels: PolicyLabels;
  onCreated: (role: RoleGrants) => void;
}) {
  const text = labels.createRole;
  const create = useCreateRole();
  const [label, setLabel] = useState("");
  const [labelHi, setLabelHi] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [copyFrom, setCopyFrom] = useState(NO_COPY);
  const [submitted, setSubmitted] = useState(false);

  const effectiveCode = codeTouched ? code : slugOf(label);
  const labelError = submitted && label.trim().length < 2 ? text.labelRequired : null;
  const codeError = submitted && !CODE_PATTERN.test(effectiveCode) ? text.codeInvalid : null;

  const reset = () => {
    setLabel("");
    setLabelHi("");
    setCode("");
    setCodeTouched(false);
    setCopyFrom(NO_COPY);
    setSubmitted(false);
    create.reset();
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (label.trim().length < 2 || !CODE_PATTERN.test(effectiveCode)) return;
    const source = roles.find((role) => role.role_cd === copyFrom);
    create.mutate(
      {
        role_cd: effectiveCode,
        label: label.trim(),
        label_hi: labelHi.trim() || null,
        permission_cds: source ? [...source.permission_cds] : [],
      },
      {
        onSuccess: (role) => {
          reset();
          onOpenChange(false);
          onCreated(role);
        },
      },
    );
  };

  const failure = create.error;
  const apiFailure = failure instanceof IcmsApiError ? failure : null;

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

        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          {failure && (
            <PolicyRefusal
              labels={labels}
              title={text.failedTitle}
              body={failure.message}
              requestId={apiFailure?.requestId}
            />
          )}

          <TextField
            label={text.label}
            value={label}
            onChange={setLabel}
            error={labelError}
            required
            maxLength={80}
            disabled={create.isPending}
          />
          <TextField
            label={text.labelHi}
            value={labelHi}
            onChange={setLabelHi}
            maxLength={80}
            disabled={create.isPending}
          />
          <TextField
            label={text.code}
            value={effectiveCode}
            onChange={(value) => {
              setCodeTouched(true);
              setCode(value.toLowerCase());
            }}
            hint={text.codeHint}
            error={codeError}
            required
            maxLength={40}
            disabled={create.isPending}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-role-copy">{text.copyFrom}</Label>
            <Select value={copyFrom} onValueChange={setCopyFrom} disabled={create.isPending}>
              <SelectTrigger id="create-role-copy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COPY}>{text.copyNone}</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.role_cd} value={role.role_cd}>
                    {labels.role(role.role_cd, role.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
              {text.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              <Icon
                name={create.isPending ? "feedback.loading" : "action.add"}
                spin={create.isPending}
                className="size-4"
              />
              {create.isPending ? text.creating : text.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
