import { Suspense, lazy } from "react";

import type { ClassKey } from "keycloakify/login";
import DefaultPage from "keycloakify/login/DefaultPage";
import Template from "keycloakify/login/Template";
import UserProfileFormFields from "keycloakify/login/UserProfileFormFields";

import type { KcContext } from "./KcContext";
import { useI18n } from "./i18n";
import "./styles.css";

const Login = lazy(() => import("./pages/Login"));

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
