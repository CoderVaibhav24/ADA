/**
 * `users.*`, typed, for the officer-administration screen only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` for the
 * reason `features/inspections/detailLabels.ts` gives: that module is the
 * shared surface — the hooks more than one screen renders — and what only this
 * screen reads belongs next to this screen.
 *
 * Two vocabularies are NOT re-derived here. `usePaginationLabels` already
 * exists in `@/i18n/labels` and the register uses it as it is, and the
 * capability gate's copy is composed from `users.gate.*` rather than from the
 * policy area's, because the two areas name different permissions in their
 * refusals.
 *
 * `role` falls back to the code rather than to a missing key: the four codes
 * are fixed by the realm today, but a fifth arriving from a realm ICMS was not
 * configured for should render as `something-else` and not as
 * `users.roleLabels.something-else`.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, useLanguage } from "@/i18n";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Same bridge as `i18n/labels.ts` uses: `t` plus the active number formatter. */
function useI18n(): { t: Translate; n: (value: number) => string } {
  const { t } = useTranslation();
  const { language } = useLanguage();
  return useMemo(
    () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        t(key, options ?? {}) as unknown as string,
      n: (value: number) => formatNumber(language, value),
    }),
    [t, language],
  );
}

export type UserLabels = {
  title: string;
  subtitle: string;
  advisory: string;
  policyLink: string;

  gate: { checking: string; deniedTitle: string; deniedBody: string };
  error: {
    title: string;
    body: string;
    retry: string;
    requestId: string;
    refusedTitle: string;
  };

  /** The realm role code, in words. Falls back to the code itself. */
  role: (roleCd: string) => string;
  /** One line on what the role is for. Empty for a code we do not know. */
  roleHint: (roleCd: string) => string;
  /** A Keycloak required action, in words. Falls back to the raw name. */
  requiredAction: (action: string) => string;

  register: {
    title: string;
    count: (n: number) => string;
    searchLabel: string;
    searchPlaceholder: string;
    searchHint: string;
    stateLabel: string;
    stateAll: string;
    stateEnabled: string;
    stateDisabled: string;
    stateNote: (shown: number, onPage: number) => string;
    roleNote: string;
    columns: {
      officer: string;
      username: string;
      email: string;
      signIn: string;
      created: string;
      manage: string;
    };
    enabled: string;
    disabled: string;
    emailVerified: string;
    emailUnverified: string;
    noEmail: string;
    noName: string;
    noDate: string;
    self: string;
    manage: string;
    manageLabel: (name: string) => string;
    create: string;
    createDenied: string;
    emptyTitle: string;
    emptyBody: string;
    noResultsTitle: string;
    noResultsBody: string;
    clear: string;
  };

  create: {
    title: string;
    description: string;
    usernameLabel: string;
    usernameHint: string;
    usernameInvalid: string;
    emailLabel: string;
    emailHint: string;
    emailInvalid: string;
    firstNameLabel: string;
    lastNameLabel: string;
    enabledLabel: string;
    enabledHint: string;
    rolesLegend: string;
    rolesHint: string;
    rolesEmpty: string;
    credentialLegend: string;
    credentialSelf: string;
    credentialSelfHint: string;
    credentialTemporary: string;
    credentialTemporaryHint: string;
    passwordLabel: string;
    passwordConfirmLabel: string;
    passwordHint: (n: number) => string;
    passwordTooShort: (n: number) => string;
    passwordMismatch: string;
    submit: string;
    submitting: string;
    cancel: string;
    close: string;
    createdTitle: (username: string) => string;
    createdBody: string;
    createdOpen: (username: string) => string;
    partialTitle: string;
    partialHint: string;
    takenUsername: string;
    takenEmail: string;
  };

  detail: {
    openLabel: string;
    close: string;
    loading: string;
    notFoundTitle: string;
    notFoundBody: string;
    created: (at: string) => string;
    createdUnknown: string;
    subject: string;
    self: string;
    requiredActionsTitle: string;
    requiredActionsNone: string;
  };

  identity: {
    title: string;
    subtitle: string;
    firstNameLabel: string;
    lastNameLabel: string;
    emailLabel: string;
    emailHint: string;
    emailRequired: string;
    usernameLabel: string;
    usernameFixed: string;
    enabledLabel: string;
    enabledOn: string;
    enabledOff: string;
    leaveHint: string;
    selfDisableWarning: string;
    save: string;
    saving: string;
    discard: string;
    noChanges: string;
    savedTitle: string;
    savedBody: string;
  };

  roles: {
    title: string;
    subtitle: string;
    fullSetNote: string;
    reviewTitle: string;
    noChanges: string;
    added: (role: string) => string;
    removed: (role: string) => string;
    emptyWarning: string;
    selfWarning: string;
    save: string;
    saving: string;
    discard: string;
    cell: (role: string, name: string) => string;
    savedTitle: string;
    savedBody: (name: string) => string;
    denied: string;
  };

  password: {
    title: string;
    subtitle: string;
    passwordLabel: string;
    confirmLabel: string;
    hint: (n: number) => string;
    tooShort: (n: number) => string;
    mismatch: string;
    temporaryLabel: string;
    temporaryOn: string;
    temporaryOff: string;
    submit: string;
    submitting: string;
    doneTitle: (username: string) => string;
    doneBody: (at: string) => string;
    doneTemporary: string;
    donePermanent: string;
    denied: string;
  };
};

export function useUserLabels(): UserLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("users.title"),
      subtitle: t("users.subtitle"),
      advisory: t("users.advisory"),
      policyLink: t("users.policyLink"),

      gate: {
        checking: t("users.gate.checking"),
        deniedTitle: t("users.gate.deniedTitle"),
        deniedBody: t("users.gate.deniedBody"),
      },

      error: {
        title: t("users.error.title"),
        body: t("users.error.body"),
        retry: t("users.error.retry"),
        requestId: t("users.error.requestId"),
        refusedTitle: t("users.error.refusedTitle"),
      },

      role: (roleCd: string) => t(`users.roleLabels.${roleCd}`, { defaultValue: roleCd }),
      roleHint: (roleCd: string) => t(`users.roleHints.${roleCd}`, { defaultValue: "" }),
      requiredAction: (action: string) =>
        t(`users.requiredActions.${action}`, { defaultValue: action }),

      register: {
        title: t("users.register.title"),
        count: (value: number) =>
          value === 1
            ? t("users.register.countOne")
            : t("users.register.count", { n: n(value) }),
        searchLabel: t("users.register.searchLabel"),
        searchPlaceholder: t("users.register.searchPlaceholder"),
        searchHint: t("users.register.searchHint"),
        stateLabel: t("users.register.stateLabel"),
        stateAll: t("users.register.stateAll"),
        stateEnabled: t("users.register.stateEnabled"),
        stateDisabled: t("users.register.stateDisabled"),
        stateNote: (shown: number, onPage: number) =>
          t("users.register.stateNote", { shown: n(shown), onPage: n(onPage) }),
        roleNote: t("users.register.roleNote"),
        columns: {
          officer: t("users.register.columns.officer"),
          username: t("users.register.columns.username"),
          email: t("users.register.columns.email"),
          signIn: t("users.register.columns.signIn"),
          created: t("users.register.columns.created"),
          manage: t("users.register.columns.manage"),
        },
        enabled: t("users.register.enabled"),
        disabled: t("users.register.disabled"),
        emailVerified: t("users.register.emailVerified"),
        emailUnverified: t("users.register.emailUnverified"),
        noEmail: t("users.register.noEmail"),
        noName: t("users.register.noName"),
        noDate: t("users.register.noDate"),
        self: t("users.register.self"),
        manage: t("users.register.manage"),
        manageLabel: (name: string) => t("users.register.manageLabel", { name }),
        create: t("users.register.create"),
        createDenied: t("users.register.createDenied"),
        emptyTitle: t("users.register.emptyTitle"),
        emptyBody: t("users.register.emptyBody"),
        noResultsTitle: t("users.register.noResultsTitle"),
        noResultsBody: t("users.register.noResultsBody"),
        clear: t("users.register.clear"),
      },

      create: {
        title: t("users.create.title"),
        description: t("users.create.description"),
        usernameLabel: t("users.create.usernameLabel"),
        usernameHint: t("users.create.usernameHint"),
        usernameInvalid: t("users.create.usernameInvalid"),
        emailLabel: t("users.create.emailLabel"),
        emailHint: t("users.create.emailHint"),
        emailInvalid: t("users.create.emailInvalid"),
        firstNameLabel: t("users.create.firstNameLabel"),
        lastNameLabel: t("users.create.lastNameLabel"),
        enabledLabel: t("users.create.enabledLabel"),
        enabledHint: t("users.create.enabledHint"),
        rolesLegend: t("users.create.rolesLegend"),
        rolesHint: t("users.create.rolesHint"),
        rolesEmpty: t("users.create.rolesEmpty"),
        credentialLegend: t("users.create.credentialLegend"),
        credentialSelf: t("users.create.credentialSelf"),
        credentialSelfHint: t("users.create.credentialSelfHint"),
        credentialTemporary: t("users.create.credentialTemporary"),
        credentialTemporaryHint: t("users.create.credentialTemporaryHint"),
        passwordLabel: t("users.create.passwordLabel"),
        passwordConfirmLabel: t("users.create.passwordConfirmLabel"),
        passwordHint: (value: number) => t("users.create.passwordHint", { n: n(value) }),
        passwordTooShort: (value: number) =>
          t("users.create.passwordTooShort", { n: n(value) }),
        passwordMismatch: t("users.create.passwordMismatch"),
        submit: t("users.create.submit"),
        submitting: t("users.create.submitting"),
        cancel: t("users.create.cancel"),
        close: t("users.create.close"),
        createdTitle: (username: string) => t("users.create.createdTitle", { username }),
        createdBody: t("users.create.createdBody"),
        createdOpen: (username: string) => t("users.create.createdOpen", { username }),
        partialTitle: t("users.create.partialTitle"),
        partialHint: t("users.create.partialHint"),
        takenUsername: t("users.create.takenUsername"),
        takenEmail: t("users.create.takenEmail"),
      },

      detail: {
        openLabel: t("users.detail.openLabel"),
        close: t("users.detail.close"),
        loading: t("users.detail.loading"),
        notFoundTitle: t("users.detail.notFoundTitle"),
        notFoundBody: t("users.detail.notFoundBody"),
        created: (at: string) => t("users.detail.created", { at }),
        createdUnknown: t("users.detail.createdUnknown"),
        subject: t("users.detail.subject"),
        self: t("users.detail.self"),
        requiredActionsTitle: t("users.detail.requiredActionsTitle"),
        requiredActionsNone: t("users.detail.requiredActionsNone"),
      },

      identity: {
        title: t("users.identity.title"),
        subtitle: t("users.identity.subtitle"),
        firstNameLabel: t("users.identity.firstNameLabel"),
        lastNameLabel: t("users.identity.lastNameLabel"),
        emailLabel: t("users.identity.emailLabel"),
        emailHint: t("users.identity.emailHint"),
        emailRequired: t("users.identity.emailRequired"),
        usernameLabel: t("users.identity.usernameLabel"),
        usernameFixed: t("users.identity.usernameFixed"),
        enabledLabel: t("users.identity.enabledLabel"),
        enabledOn: t("users.identity.enabledOn"),
        enabledOff: t("users.identity.enabledOff"),
        leaveHint: t("users.identity.leaveHint"),
        selfDisableWarning: t("users.identity.selfDisableWarning"),
        save: t("users.identity.save"),
        saving: t("users.identity.saving"),
        discard: t("users.identity.discard"),
        noChanges: t("users.identity.noChanges"),
        savedTitle: t("users.identity.savedTitle"),
        savedBody: t("users.identity.savedBody"),
      },

      roles: {
        title: t("users.roles.title"),
        subtitle: t("users.roles.subtitle"),
        fullSetNote: t("users.roles.fullSetNote"),
        reviewTitle: t("users.roles.reviewTitle"),
        noChanges: t("users.roles.noChanges"),
        added: (role: string) => t("users.roles.added", { role }),
        removed: (role: string) => t("users.roles.removed", { role }),
        emptyWarning: t("users.roles.emptyWarning"),
        selfWarning: t("users.roles.selfWarning"),
        save: t("users.roles.save"),
        saving: t("users.roles.saving"),
        discard: t("users.roles.discard"),
        cell: (role: string, name: string) => t("users.roles.cell", { role, name }),
        savedTitle: t("users.roles.savedTitle"),
        savedBody: (name: string) => t("users.roles.savedBody", { name }),
        denied: t("users.roles.denied"),
      },

      password: {
        title: t("users.password.title"),
        subtitle: t("users.password.subtitle"),
        passwordLabel: t("users.password.passwordLabel"),
        confirmLabel: t("users.password.confirmLabel"),
        hint: (value: number) => t("users.password.hint", { n: n(value) }),
        tooShort: (value: number) => t("users.password.tooShort", { n: n(value) }),
        mismatch: t("users.password.mismatch"),
        temporaryLabel: t("users.password.temporaryLabel"),
        temporaryOn: t("users.password.temporaryOn"),
        temporaryOff: t("users.password.temporaryOff"),
        submit: t("users.password.submit"),
        submitting: t("users.password.submitting"),
        doneTitle: (username: string) => t("users.password.doneTitle", { username }),
        doneBody: (at: string) => t("users.password.doneBody", { at }),
        doneTemporary: t("users.password.doneTemporary"),
        donePermanent: t("users.password.donePermanent"),
        denied: t("users.password.denied"),
      },
    }),
    [t, n],
  );
}
