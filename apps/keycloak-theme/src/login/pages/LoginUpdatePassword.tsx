import { useState } from "react";

import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { Icon } from "../icons";
import { Field, Notice, PasswordInput, SubmitButton } from "../parts";

type UpdatePasswordKcContext = Extract<KcContext, { pageId: "login-update-password.ftl" }>;

// UPDATE_PASSWORD required action in the ICMS card; ids and names follow keycloakify's default page.
export default function LoginUpdatePassword(props: PageProps<UpdatePasswordKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { url, messagesPerField, isAppInitiatedAction, message } = kcContext;
  const { msg, msgStr } = i18n;

  const [submitting, setSubmitting] = useState(false);
  const hasFieldError = messagesPerField.existsError("password", "password-confirm");

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!hasFieldError && message?.type !== "warning"}
      headerNode={msg("adaUpdatePasswordTitle")}
    >
      <form
        id="kc-passwd-update-form"
        className="ada-form"
        action={url.loginAction}
        method="post"
        onSubmit={() => {
          setSubmitting(true);
          return true;
        }}
      >
        {!isAppInitiatedAction && (
          <Notice tone="error" title={msg("adaUpdatePasswordNoticeTitle")}>
            {msg("adaUpdatePasswordNoticeBody")}
          </Notice>
        )}

        <Field
          id="password-new"
          label={msg("passwordNew")}
          error={messagesPerField.existsError("password") ? messagesPerField.get("password") : undefined}
        >
          <PasswordInput
            id="password-new"
            name="password-new"
            i18n={i18n}
            autoFocus
            autoComplete="new-password"
            placeholder={msgStr("adaPasswordPlaceholder")}
            aria-invalid={hasFieldError}
          />
        </Field>

        <Field
          id="password-confirm"
          label={msg("passwordConfirm")}
          error={
            messagesPerField.existsError("password-confirm")
              ? messagesPerField.get("password-confirm")
              : undefined
          }
        >
          <PasswordInput
            id="password-confirm"
            name="password-confirm"
            i18n={i18n}
            autoComplete="new-password"
            placeholder={msgStr("adaPasswordPlaceholder")}
            aria-invalid={hasFieldError}
          />
        </Field>

        <div id="kc-form-options" className="ada-options">
          <label htmlFor="logout-sessions" className="ada-check">
            <span className="ada-check__box">
              <input type="checkbox" id="logout-sessions" name="logout-sessions" value="on" />
              <Icon name="check" className="ada-check__tick" />
            </span>
            <span className="ada-check__label">{msg("logoutOtherSessions")}</span>
          </label>
        </div>

        <SubmitButton
          busy={submitting}
          label={submitting ? msgStr("adaContinueBusy") : msgStr("adaContinue")}
        />
        {isAppInitiatedAction && (
          <button type="submit" name="cancel-aia" value="true" className="ada-text-button">
            {msg("doCancel")}
          </button>
        )}
      </form>
    </Template>
  );
}
