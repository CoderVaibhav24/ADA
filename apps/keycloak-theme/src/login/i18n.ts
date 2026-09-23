import { i18nBuilder } from "keycloakify/login";
import type { ThemeName } from "../kc.gen";

const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({
    en: {
      doLogIn: "Sign in",
      doForgotPassword: "Forgot your password?",
      loginAccountTitle: "Sign in to ADA",
      usernameOrEmail: "Username or email",
      password: "Password",
      rememberMe: "Keep me signed in",
      loginTotpTitle: "Two-factor authentication",
      loginOtpOneTime: "Authenticator code",
    },
  })
  .build();

type I18n = typeof ofTypeI18n;

export { useI18n, type I18n };
