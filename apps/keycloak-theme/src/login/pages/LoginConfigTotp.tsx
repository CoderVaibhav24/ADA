import { useState } from "react";

import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { Icon } from "../icons";
import { BackLink, Field, Notice, SubmitButton } from "../parts";

type ConfigTotpKcContext = Extract<KcContext, { pageId: "login-config-totp.ftl" }>;

// Where each app Keycloak lists can be installed from; unknown keys fall back to plain text.
const APP_LINKS: Record<string, string> = {
  totpAppFreeOTPName: "https://freeotp.github.io/",
  totpAppGoogleName: "https://support.google.com/accounts/answer/1066447",
  totpAppMicrosoftAuthenticatorName: "https://www.microsoft.com/security/mobile-authenticator-app",
};

// Rebuilds the otpauth:// URI Keycloak encodes in the QR, so a phone can open the app directly.
function otpauthUri(ctx: ConfigTotpKcContext): string | null {
  const { totp, realm } = ctx;
  if (totp.policy.type !== "totp") return null;
  let algorithm = "SHA1";
  try {
    algorithm = totp.policy.getAlgorithmKey();
  } catch {
    // Older serialisations ship the key without the helper; SHA1 is Keycloak's default.
  }
  const issuer = encodeURIComponent(realm.displayName || realm.name);
  const account = encodeURIComponent(totp.username);
  const secret = totp.totpSecretEncoded.replace(/\s+/g, "");
  return (
    `otpauth://totp/${issuer}:${account}?secret=${secret}&digits=${totp.policy.digits}` +
    `&algorithm=${algorithm}&issuer=${issuer}&period=${totp.policy.period}`
  );
}

// CONFIGURE_TOTP required action: QR on a white tile, manual key, code and device name.
export default function LoginConfigTotp(props: PageProps<ConfigTotpKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { url, isAppInitiatedAction, totp, mode, messagesPerField, message } = kcContext;
  const { msg, msgStr, advancedMsgStr } = i18n;

  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const hasFieldError = messagesPerField.existsError("totp", "userLabel");
  const deepLink = otpauthUri(kcContext);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!hasFieldError && message?.type !== "warning"}
      headerNode={msg("loginTotpTitle")}
    >
      <div className="ada-form">
        <Notice tone="info">{msg("adaTotpIntro")}</Notice>

        <div id="kc-totp-settings" className="ada-qr">
          <div className="ada-qr__tile">
            <img
              id="kc-totp-secret-qr-code"
              src={`data:image/png;base64, ${totp.totpSecretQrCode}`}
              alt={msgStr("adaTotpQrAlt")}
              width={180}
              height={180}
            />
          </div>

          {deepLink && (
            <a href={deepLink} className="ada-open-app">
              {msg("adaTotpOpenApp")}
              <Icon name="arrowRight" className="ada-open-app__icon" />
            </a>
          )}

          <details className="ada-disclosure" open={mode === "manual"}>
            <summary>{msg("adaTotpCantScan")}</summary>
            <p className="ada-hint">{msg("adaTotpManualHint")}</p>
            <p id="kc-totp-secret-key" className="ada-secret">
              {totp.totpSecretEncoded}
            </p>
          </details>

          {totp.supportedApplications.length > 0 && (
            <p id="kc-totp-supported-apps" className="ada-hint ada-apps">
              {msg("adaTotpAppsHint")}{" "}
              {totp.supportedApplications.map((app, i) => (
                <span key={app}>
                  {i > 0 && ", "}
                  {APP_LINKS[app] ? (
                    <a href={APP_LINKS[app]} target="_blank" rel="noreferrer noopener" className="ada-link">
                      {advancedMsgStr(app)}
                    </a>
                  ) : (
                    advancedMsgStr(app)
                  )}
                </span>
              ))}
            </p>
          )}
        </div>

        <form
          action={url.loginAction}
          className="ada-form"
          id="kc-totp-settings-form"
          method="post"
          onSubmit={() => {
            setSubmitting(true);
            return true;
          }}
        >
          <Field
            id="totp"
            label={msg("authenticatorCode")}
            error={messagesPerField.existsError("totp") ? messagesPerField.get("totp") : undefined}
          >
            <input
              type="text"
              id="totp"
              name="totp"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={totp.policy.digits || 6}
              placeholder={msgStr("adaOtpPlaceholder")}
              className="ada-input ada-input--code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              aria-invalid={messagesPerField.existsError("totp")}
            />
          </Field>
          <input type="hidden" id="totpSecret" name="totpSecret" value={totp.totpSecret} />
          {mode && <input type="hidden" id="mode" value={mode} />}

          <Field
            id="userLabel"
            label={msg("loginTotpDeviceName")}
            error={messagesPerField.existsError("userLabel") ? messagesPerField.get("userLabel") : undefined}
          >
            <input
              type="text"
              id="userLabel"
              name="userLabel"
              autoComplete="off"
              placeholder={msgStr("adaTotpDevicePlaceholder")}
              required={totp.otpCredentials.length >= 1}
              className="ada-input"
              aria-invalid={messagesPerField.existsError("userLabel")}
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
            id="saveTOTPBtn"
            busy={submitting}
            label={submitting ? msgStr("adaContinueBusy") : msgStr("adaContinue")}
          />
          {isAppInitiatedAction ? (
            <button
              type="submit"
              id="cancelTOTPBtn"
              name="cancel-aia"
              value="true"
              className="ada-text-button"
            >
              {msg("doCancel")}
            </button>
          ) : (
            <BackLink href={url.loginRestartFlowUrl}>{msg("adaBackToLogin")}</BackLink>
          )}
        </form>
      </div>
    </Template>
  );
}
