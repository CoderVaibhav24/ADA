import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { BackLink, Notice } from "../parts";

type VerifyEmailKcContext = Extract<KcContext, { pageId: "login-verify-email.ftl" }>;

// VERIFY_EMAIL required action: instructions and the resend link inside the ICMS card.
export default function LoginVerifyEmail(props: PageProps<VerifyEmailKcContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { url, user, message } = kcContext;
  const { msg, msgStr } = i18n;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={message?.type !== "warning"}
      headerNode={msg("adaVerifyEmailTitle")}
    >
      <div className="ada-form">
        <Notice tone="info">
          <span className="instruction">{msgStr("emailVerifyInstruction1", user?.email ?? "")}</span>
        </Notice>
        <p className="ada-hint instruction">
          {msg("adaVerifyEmailResendPrefix")}{" "}
          <a href={url.loginAction} className="ada-link">
            {msg("adaVerifyEmailResend")}
          </a>
        </p>
        <BackLink href={url.loginRestartFlowUrl}>{msg("adaBackToLogin")}</BackLink>
      </div>
    </Template>
  );
}
