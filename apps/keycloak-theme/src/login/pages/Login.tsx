import { useState } from "react";

import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { getKcClsx } from "keycloakify/login/lib/kcClsx";
import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";

type LoginKcContext = Extract<KcContext, { pageId: "login.ftl" }>;

export default function Login(props: PageProps<LoginKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { kcClsx } = getKcClsx({ doUseDefaultCss, classes });

  const { social, realm, url, usernameHidden, login, messagesPerField } = kcContext;
  const { msg, msgStr } = i18n;

  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!messagesPerField.existsError("username", "password")}
      headerNode={msg("loginAccountTitle")}
      displayInfo={realm.password && realm.registrationAllowed && !kcContext.registrationDisabled}
      infoNode={
        <div id="kc-registration-container">
          <div id="kc-registration">
            <span>
              {msg("noAccount")}{" "}
              <a tabIndex={8} href={url.registrationUrl}>
                {msg("doRegister")}
              </a>
            </span>
          </div>
        </div>
      }
      socialProvidersNode={
        realm.password && social?.providers?.length ? (
          <div id="kc-social-providers" className="ada-social">
            <div className="ada-divider">
              <span>or</span>
            </div>
            <ul className="ada-social-list">
              {social.providers.map((p) => (
                <li key={p.alias}>
                  <a id={`social-${p.alias}`} className="ada-social-link" href={p.loginUrl}>
                    {p.iconClasses && <i className={p.iconClasses} aria-hidden="true" />}
                    <span dangerouslySetInnerHTML={{ __html: kcSanitize(p.displayName) }} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
    >
      <div id="kc-form">
        <div id="kc-form-wrapper">
          {realm.password && (
            <form
              id="kc-form-login"
              className="ada-login-form"
              action={url.loginAction}
              method="post"
              onSubmit={() => {
                setSubmitting(true);
                return true;
              }}
            >
              {!usernameHidden && (
                <div className={kcClsx("kcFormGroupClass")}>
                  <label htmlFor="username" className={kcClsx("kcLabelClass")}>
                    {!realm.loginWithEmailAllowed
                      ? msg("username")
                      : !realm.registrationEmailAsUsername
                        ? msg("usernameOrEmail")
                        : msg("email")}
                  </label>
                  <input
                    tabIndex={2}
                    id="username"
                    className="ada-input"
                    name="username"
                    defaultValue={login.username ?? ""}
                    type="text"
                    autoFocus
                    autoComplete="username"
                    aria-invalid={messagesPerField.existsError("username", "password")}
                  />
                  {messagesPerField.existsError("username", "password") && (
                    <span
                      id="input-error"
                      className="ada-field-error"
                      aria-live="polite"
                      dangerouslySetInnerHTML={{
                        __html: kcSanitize(
                          messagesPerField.getFirstError("username", "password"),
                        ),
                      }}
                    />
                  )}
                </div>
              )}

              <div className={kcClsx("kcFormGroupClass")}>
                <label htmlFor="password" className={kcClsx("kcLabelClass")}>
                  {msg("password")}
                </label>
                <div className="ada-password-wrapper">
                  <input
                    tabIndex={3}
                    id="password"
                    className="ada-input"
                    name="password"
                    type={revealed ? "text" : "password"}
                    autoComplete="current-password"
                    aria-invalid={messagesPerField.existsError("username", "password")}
                  />
                  <button
                    type="button"
                    className="ada-reveal"
                    aria-label={revealed ? "Hide password" : "Show password"}
                    aria-controls="password"
                    onClick={() => setRevealed((on) => !on)}
                  >
                    {revealed ? "Hide" : "Show"}
                  </button>
                </div>
                {usernameHidden && messagesPerField.existsError("username", "password") && (
                  <span
                    id="input-error"
                    className="ada-field-error"
                    aria-live="polite"
                    dangerouslySetInnerHTML={{
                      __html: kcSanitize(messagesPerField.getFirstError("username", "password")),
                    }}
                  />
                )}
              </div>

              <div className={kcClsx("kcFormGroupClass")}>
                <div id="kc-form-options" className="ada-form-options">
                  {realm.rememberMe && !usernameHidden && (
                    <label className="ada-checkbox">
                      <input
                        tabIndex={5}
                        id="rememberMe"
                        name="rememberMe"
                        type="checkbox"
                        defaultChecked={!!login.rememberMe}
                      />
                      {msg("rememberMe")}
                    </label>
                  )}
                  {realm.resetPasswordAllowed && (
                    <a tabIndex={6} href={url.loginResetCredentialsUrl} className="ada-link">
                      {msg("doForgotPassword")}
                    </a>
                  )}
                </div>
              </div>

              <div id="kc-form-buttons" className={kcClsx("kcFormGroupClass")}>
                <input
                  type="hidden"
                  id="id-hidden-input"
                  name="credentialId"
                  value={kcContext.auth?.selectedCredential ?? ""}
                />
                <button
                  tabIndex={7}
                  disabled={submitting}
                  className="ada-button ada-button-primary ada-button-block"
                  name="login"
                  id="kc-login"
                  type="submit"
                >
                  {submitting ? `${msgStr("doLogIn")}…` : msgStr("doLogIn")}
                </button>
              </div>
              <p className="ada-note">You will be asked for your authenticator code next.</p>
            </form>
          )}
        </div>
      </div>
    </Template>
  );
}
