import { useState } from "react";

import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { BackLink, Field, Notice, SubmitButton } from "../parts";

type LoginOtpKcContext = Extract<KcContext, { pageId: "login-otp.ftl" }>;

// Hosted twin of the web login's code step; field names follow keycloakify's default page.
export default function LoginOtp(props: PageProps<LoginOtpKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { otpLogin, url, messagesPerField } = kcContext;
  const { msg, msgStr } = i18n;

  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const otpError = messagesPerField.existsError("totp") ? messagesPerField.get("totp") : undefined;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!otpError}
      headerNode={msg("adaOtpTitle")}
    >
      <form
        id="kc-otp-login-form"
        className="ada-form"
        action={url.loginAction}
        method="post"
        onSubmit={() => {
          setSubmitting(true);
          return true;
        }}
      >
        {otpError ? (
          <Notice tone="error" title={msg("adaErrorHeading")} html={otpError} />
        ) : (
          kcContext.message?.type !== "error" && <Notice tone="info">{msg("adaOtpBody")}</Notice>
        )}

        {otpLogin.userOtpCredentials.length > 1 && (
          <fieldset className="ada-field ada-credentials">
            <legend className="ada-label">{msg("adaOtpDeviceLabel")}</legend>
            {otpLogin.userOtpCredentials.map((credential, index) => (
              <label key={credential.id} htmlFor={`kc-otp-credential-${index}`} className="ada-radio">
                <input
                  id={`kc-otp-credential-${index}`}
                  type="radio"
                  name="selectedCredentialId"
                  value={credential.id}
                  defaultChecked={credential.id === otpLogin.selectedCredentialId}
                />
                <span>{credential.userLabel}</span>
              </label>
            ))}
          </fieldset>
        )}

        <Field id="otp" label={msg("loginOtpOneTime")}>
          <input
            id="otp"
            name="otp"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            placeholder={msgStr("adaOtpPlaceholder")}
            className="ada-input ada-input--code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={!!otpError}
          />
        </Field>

        <SubmitButton
          id="kc-login"
          name="login"
          busy={submitting}
          label={submitting ? msgStr("adaOtpVerifyBusy") : msgStr("adaOtpVerify")}
        />
        <BackLink href={url.loginRestartFlowUrl}>{msg("adaBackToLogin")}</BackLink>
      </form>
    </Template>
  );
}
