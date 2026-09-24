import { i18nBuilder } from "keycloakify/login";
import type { ThemeName } from "../kc.gen";

// Wording mirrors apps/web/src/routes/login-labels.en.ts so the hosted pages read as the same screen.
const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({
    en: {
      doLogIn: "Login",
      doForgotPassword: "Forgot password ?",
      loginAccountTitle: "Login",
      usernameOrEmail: "Email ID",
      username: "Email ID",
      email: "Email ID",
      password: "Password",
      rememberMe: "Remember me",
      loginTotpTitle: "Link your authenticator",
      loginOtpOneTime: "Authenticator code",
      passwordNew: "New password",
      passwordConfirm: "Confirm password",
      logoutOtherSessions: "Sign out from other devices",

      adaBrandShort: "ICMS-",
      adaBrandRest: "Illegal Construction Monitoring System",
      adaSupportPrefix: "Facing issues? Contact support at",
      adaSupportNumber: "1800-123-4567",
      adaSupportLinkLabel: "Call support on 1800 123 4567",
      adaErrorHeading: "Sign-in problem",
      adaUsernamePlaceholder: "Enter here",
      adaContinue: "Continue",
      adaContinueBusy: "Saving…",
      adaLoginBusy: "Signing in…",
      adaSigningInAs: "Signing in as",
      adaBackToLogin: "Back to login",
      adaPasswordAgain: "Enter your password to continue.",

      adaUpdatePasswordTitle: "Set your password",
      adaUpdatePasswordNoticeTitle: "Account setup",
      adaUpdatePasswordNoticeBody:
        "This account needs a new password before it can be used. Choose one below and you will go straight on to ICMS.",
      adaPasswordPlaceholder: "••••••••",

      adaTotpIntro:
        "Scan this QR code with an authenticator app on your phone, then type the 6-digit code it shows.",
      adaTotpQrAlt: "QR code for linking your authenticator app",
      adaTotpCantScan: "Can't scan?",
      adaTotpManualHint: "Type this key into your authenticator app instead:",
      adaTotpOpenApp: "Open authenticator app",
      adaTotpAppsHint: "No app yet? Install one of these:",
      adaTotpDevicePlaceholder: "e.g. My phone",
      adaOtpPlaceholder: "6-digit code",

      adaVerifyEmailTitle: "Verify your e-mail",
      adaVerifyEmailResendPrefix: "No e-mail yet?",
      adaVerifyEmailResend: "Send it again",

      adaOtpTitle: "Enter your code",
      adaOtpBody: "Open your authenticator app and type the current 6-digit code for ICMS.",
      adaOtpDeviceLabel: "Authenticator",
      adaOtpVerify: "Verify",
      adaOtpVerifyBusy: "Verifying…",
    },
  })
  .build();

type I18n = typeof ofTypeI18n;

export { useI18n, type I18n };
