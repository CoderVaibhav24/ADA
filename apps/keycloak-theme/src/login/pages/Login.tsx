import { useState } from "react";

import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { Icon } from "../icons";
import { Field, Notice, PasswordInput, SubmitButton } from "../parts";

type LoginKcContext = Extract<KcContext, { pageId: "login.ftl" }>;

// Hosted twin of apps/web/src/routes/Login.tsx step one; field names are Keycloak's.
export default function Login(props: PageProps<LoginKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { social, realm, url, usernameHidden, login, messagesPerField } = kcContext;
  const { msg, msgStr } = i18n;

  const [submitting, setSubmitting] = useState(false);
  const fieldError = messagesPerField.existsError("username", "password")
    ? messagesPerField.getFirstError("username", "password")
    : undefined;
  // A prefilled name means the web login handed over (login_hint), so the password is what is owed.
  const handedOver = !usernameHidden && !!login.username && !fieldError && !kcContext.message;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!fieldError}
      headerNode={msg("loginAccountTitle")}
      displayInfo={realm.password && realm.registrationAllowed && !kcContext.registrationDisabled}
      infoNode={
        <div id="kc-registration">
          <span>
            {msg("noAccount")}{" "}
            <a tabIndex={8} href={url.registrationUrl} className="ada-link">
              {msg("doRegister")}
            </a>
          </span>
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
      {realm.password && (
        <form
          id="kc-form-login"
          className="ada-form"
          action={url.loginAction}
          method="post"
          onSubmit={() => {
            setSubmitting(true);
            return true;
          }}
        >
          {fieldError && (
            <Notice tone="error" title={msg("adaErrorHeading")} html={fieldError} />
          )}
          {handedOver && <Notice tone="info">{msg("adaPasswordAgain")}</Notice>}

          {!usernameHidden && (
            <Field id="username" label={msg(!realm.loginWithEmailAllowed ? "username" : "usernameOrEmail")}>
              <input
                tabIndex={2}
                id="username"
                className="ada-input"
                name="username"
                defaultValue={login.username ?? ""}
                type="text"
                autoFocus={!handedOver}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={msgStr("adaUsernamePlaceholder")}
                aria-invalid={!!fieldError}
              />
            </Field>
          )}

          <Field id="password" label={msg("password")} labelClassName="ada-label--password">
            <PasswordInput
              tabIndex={3}
              id="password"
              name="password"
              i18n={i18n}
              autoFocus={handedOver || usernameHidden}
              autoComplete="current-password"
              placeholder={msgStr("adaPasswordPlaceholder")}
              aria-invalid={!!fieldError}
            />
          </Field>

          <div id="kc-form-options" className="ada-options">
            {realm.rememberMe && !usernameHidden ? (
              <label htmlFor="rememberMe" className="ada-check">
                <span className="ada-check__box">
                  <input
                    tabIndex={5}
                    id="rememberMe"
                    name="rememberMe"
                    type="checkbox"
                    defaultChecked={!!login.rememberMe}
                  />
                  <Icon name="check" className="ada-check__tick" />
                </span>
                <span className="ada-check__label">{msg("rememberMe")}</span>
              </label>
            ) : (
              <span />
            )}
            {realm.resetPasswordAllowed && (
              <a tabIndex={6} href={url.loginResetCredentialsUrl} className="ada-forgot">
                {msg("doForgotPassword")}
              </a>
            )}
          </div>

          <input
            type="hidden"
            id="id-hidden-input"
            name="credentialId"
            value={kcContext.auth?.selectedCredential ?? ""}
          />
          <SubmitButton
            id="kc-login"
            name="login"
            busy={submitting}
            label={submitting ? msgStr("adaLoginBusy") : msgStr("doLogIn")}
          />
        </form>
      )}
    </Template>
  );
}
