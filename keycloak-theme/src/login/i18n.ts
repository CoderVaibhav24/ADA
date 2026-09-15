/**
 * Wording overrides.
 *
 * Keycloak ships every string for every page in every language it supports.
 * Overriding one is how the page says what ADA means by it without forking the
 * page: `doLogIn` is Keycloak's key for the submit button, and an officer
 * signing in to a change-detection console is better served by "Sign in" than
 * by the default "Sign In".
 */
import { i18nBuilder } from "keycloakify/login";
import type { ThemeName } from "../kc.gen";

const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({
    en: {
      doLogIn: "Sign in",
      doForgotPassword: "Forgot your password?",
      loginAccountTitle: "Sign in to ADA",
      // Said in ADA's terms rather than Keycloak's. The officer does not think
      // of themselves as having a "realm".
      usernameOrEmail: "Username or email",
      password: "Password",
      rememberMe: "Keep me signed in",
      // The TOTP prompt. Every account carries CONFIGURE_TOTP as a required
      // action, so this is the second step of the ordinary path, not an
      // exception.
      loginTotpTitle: "Two-factor authentication",
      loginOtpOneTime: "Authenticator code",
    },
  })
  .build();

type I18n = typeof ofTypeI18n;

export { useI18n, type I18n };
