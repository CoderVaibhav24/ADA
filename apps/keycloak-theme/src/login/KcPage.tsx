import { Suspense, lazy } from "react";

import type { ClassKey } from "keycloakify/login";
import DefaultPage from "keycloakify/login/DefaultPage";
import UserProfileFormFields from "keycloakify/login/UserProfileFormFields";

import type { KcContext } from "./KcContext";
import Template from "./Template";
import { useI18n } from "./i18n";
import "./styles.css";

const Login = lazy(() => import("./pages/Login"));
const LoginUpdatePassword = lazy(() => import("./pages/LoginUpdatePassword"));
const LoginConfigTotp = lazy(() => import("./pages/LoginConfigTotp"));
const LoginVerifyEmail = lazy(() => import("./pages/LoginVerifyEmail"));
const LoginOtp = lazy(() => import("./pages/LoginOtp"));

const doMakeUserConfirmPassword = false;

// Our own pages carry every style they need, so PatternFly is only loaded for Keycloakify's defaults.
export default function KcPage(props: { kcContext: KcContext }) {
  const { kcContext } = props;
  const { i18n } = useI18n({ kcContext });
  const common = { i18n, classes, Template, doUseDefaultCss: false } as const;

  return (
    <Suspense>
      {(() => {
        switch (kcContext.pageId) {
          case "login.ftl":
            return <Login kcContext={kcContext} {...common} />;
          case "login-update-password.ftl":
            return <LoginUpdatePassword kcContext={kcContext} {...common} />;
          case "login-config-totp.ftl":
            return <LoginConfigTotp kcContext={kcContext} {...common} />;
          case "login-verify-email.ftl":
            return <LoginVerifyEmail kcContext={kcContext} {...common} />;
          case "login-otp.ftl":
            return <LoginOtp kcContext={kcContext} {...common} />;
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

const classes = {
  kcHtmlClass: "ada-html",
  kcBodyClass: "ada-body",
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
