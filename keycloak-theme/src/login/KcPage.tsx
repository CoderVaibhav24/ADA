/**
 * The theme's router: Keycloak names a page, this picks the component.
 *
 * Only `login.ftl` is ours. Every other page — the TOTP prompt, the password
 * reset, the "update your password" screen, the error page — falls through to
 * Keycloakify's DefaultPage, which renders Keycloak's own markup inside our
 * Template. That is deliberate, and it is the whole reason this approach was
 * chosen over building a login form in the SPA:
 *
 *   Keycloak keeps every security decision. The brute-force lockout, the
 *   password policy, the TOTP requirement, the CSRF token on the form, the
 *   session cookie, the authentication flow itself — all server-side, all
 *   unchanged. This project replaces the HTML and nothing else.
 *
 * A page we have not styled therefore still WORKS; it just looks like stock
 * Keycloak. That is the right failure mode: the alternative to a plain
 * password-reset page is no password reset.
 */

import { Suspense, lazy } from "react";

import type { ClassKey } from "keycloakify/login";
import DefaultPage from "keycloakify/login/DefaultPage";
import Template from "keycloakify/login/Template";
import UserProfileFormFields from "keycloakify/login/UserProfileFormFields";

import type { KcContext } from "./KcContext";
import { useI18n } from "./i18n";
import "./styles.css";

const Login = lazy(() => import("./pages/Login"));

// The realm disables registration, and no flow asks for a confirmed password.
const doMakeUserConfirmPassword = false;

export default function KcPage(props: { kcContext: KcContext }) {
  const { kcContext } = props;
  const { i18n } = useI18n({ kcContext });

  return (
    <Suspense>
      {(() => {
        switch (kcContext.pageId) {
          case "login.ftl":
            return (
              <Login
                kcContext={kcContext}
                i18n={i18n}
                classes={classes}
                Template={Template}
                doUseDefaultCss={true}
              />
            );
          default:
            return (
              <DefaultPage
                kcContext={kcContext}
                i18n={i18n}
                classes={classes}
                Template={Template}
                doUseDefaultCss={true}
                UserProfileFormFields={UserProfileFormFields}
                doMakeUserConfirmPassword={doMakeUserConfirmPassword}
              />
            );
        }
      })()}
    </Suspense>
  );
}

/**
 * Our class names layered onto Keycloak's.
 *
 * doUseDefaultCss stays true on purpose. Dropping Keycloak's stylesheet means
 * owning the appearance of every page it ships — including ones nobody has
 * looked at, like the "you are already logged in" notice — and any page added
 * by a future Keycloak upgrade would arrive unstyled. Keeping it and adding on
 * top means an unstyled page is merely plain rather than broken.
 */
const classes = {
  kcBodyClass: "ada-body",
  kcHtmlClass: "ada-html",
  kcFormCardClass: "ada-card",
  kcHeaderWrapperClass: "ada-header",
  kcFormGroupClass: "ada-form-group",
  kcLabelClass: "ada-label",
  kcInputClass: "ada-input",
  kcButtonClass: "ada-button",
  kcButtonPrimaryClass: "ada-button-primary",
  kcButtonBlockClass: "ada-button-block",
  kcButtonLargeClass: "ada-button-large",
  kcFormOptionsClass: "ada-form-options",
  kcFormButtonsClass: "ada-form-buttons",
  kcInputWrapperClass: "ada-input-wrapper",
  kcAlertClass: "ada-alert",
  kcFeedbackAreaClass: "ada-feedback",
} satisfies { [key in ClassKey]?: string };
